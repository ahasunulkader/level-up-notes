# Distributed Transactions — 2PC, Saga & Outbox

### The Problem
- A normal transaction (`BEGIN ... COMMIT`) works only inside **one database**. But real systems split data across **many databases and services** (orders service, payment service, inventory service, or sharded databases).
- One business action may need changes in **several places** that must all succeed or all fail.

**Example: "Place an order"**
```
 1. Orders DB     : create order #55 (status = PENDING)
 2. Payment service: charge the customer's card $100
 3. Inventory DB  : reduce stock of the item by 1

What if step 1 and 2 succeed, but step 3 fails?
   -> customer paid, order exists, but item is out of stock. Inconsistent! 💥
There is no single COMMIT that covers three separate systems.
```
Also: the network can fail, a service can crash **after** doing its work but **before** replying, and nobody knows what happened.

### What It Solves
Two main families of solutions:

| Approach | Idea | Guarantee |
|---|---|---|
| **Two-Phase Commit (2PC)** | A coordinator asks everyone "can you commit?" then tells all "commit" | **Strong** consistency (all-or-nothing), but blocking and slow |
| **Saga** | Do local transactions one by one; if one fails, run **compensating** actions to undo the earlier ones | **Eventual** consistency, fast, no global locks |

Plus helper patterns: **Outbox** (reliably send messages), **Idempotency** (safe retries), **Try-Confirm/Cancel (TCC)**.

### How It Works

#### 1. Two-Phase Commit (2PC)
**Roles:** one **Coordinator** (the boss) and several **Participants** (each has its own database).

```
Phase 1: PREPARE (voting)
  Coordinator ── "Can you commit?" ──► Participant A   ── "YES, I'm ready (changes saved + locked)"
              ── "Can you commit?" ──► Participant B   ── "YES"
              ── "Can you commit?" ──► Participant C   ── "YES"

Phase 2: COMMIT (decision)
  All said YES  ──► Coordinator sends "COMMIT" to everyone  ──► all commit  ✔

  Anyone said NO / timed out ──► Coordinator sends "ROLLBACK" to everyone ──► all roll back ✔
```
Timeline view:
```
Coordinator      A            B
    │─prepare──►│            │
    │─prepare──────────────►│
    │◄──YES─────│            │        A and B have written the change to their log
    │◄──YES──────────────────│        and are HOLDING LOCKS, waiting for the decision
    │ (writes decision "COMMIT" to its log)
    │─commit───►│            │
    │─commit───────────────►│
    │◄──ACK─────│◄───ACK─────│
```
**Real SQL support:** PostgreSQL and MySQL have XA / prepared transactions.
```sql
-- PostgreSQL (needs max_prepared_transactions > 0)
BEGIN;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
PREPARE TRANSACTION 'tx-order-55';     -- Phase 1: durably prepared, locks are kept
-- ... later, coordinator decides:
COMMIT PREPARED   'tx-order-55';       -- Phase 2 (success)
-- or
ROLLBACK PREPARED 'tx-order-55';       -- Phase 2 (failure)

-- MySQL XA
XA START 'tx1';
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
XA END 'tx1';
XA PREPARE 'tx1';
XA COMMIT 'tx1';       -- or XA ROLLBACK 'tx1'
```
**Problems with 2PC:**
| Problem | Explanation |
|---|---|
| **Blocking** | If the coordinator crashes after participants voted YES but before sending the decision, participants must **keep holding locks** until it comes back. Others who need those rows wait. |
| **Slow** | At least 2 network round trips + disk flushes; speed = slowest participant |
| **Availability** | Everyone must be up. One slow service blocks the whole transaction |
| **Not supported everywhere** | REST APIs, Kafka, third-party payment gateways don't speak XA |
| **Lock duration** | Locks held across network calls → low concurrency |

(3PC adds another phase to reduce blocking but is rarely used; consensus protocols like **Paxos/Raft** are used inside modern distributed databases such as Spanner, CockroachDB.)

**Use 2PC when:** few participants, all are databases you control, low volume, strong consistency is mandatory. Avoid it across microservices.

---

#### 2. Saga pattern
**Idea:** split the big transaction into a sequence of **small local transactions**. Each one commits immediately (no global locks). If a later step fails, run **compensating transactions** to undo the earlier ones (a business-level "undo").

```
Success path:
 [Create order] ─► [Charge payment] ─► [Reserve stock] ─► [Mark order CONFIRMED]

Failure at step 3 (out of stock):
 [Create order] ─► [Charge payment] ─► [Reserve stock ✖]
        ▲                 ▲
        │ cancel order    │ refund payment      <- compensations run in REVERSE order
        └─────────────────┘
```
| Step | Action | Compensation (undo) |
|---|---|---|
| 1 | Create order (PENDING) | Mark order CANCELLED |
| 2 | Charge card | Refund card |
| 3 | Reserve stock | Release stock |
| 4 | Confirm order | (none; last step) |

> A compensation is **not** a technical rollback: the original change was already committed and maybe visible. A "refund" is a new action. Some steps can't be undone (sending an email), so put them **last**.

**Two ways to coordinate a saga:**

**a) Choreography — services react to events (no boss)**
```
Order service ──OrderCreated──► Payment service ──PaymentDone──► Inventory service
      ▲                                                                  │
      └─────────────── StockReserved / StockFailed ◄────────────────────┘
Each service listens to events and publishes the next one.
```
- ✔ Simple for 2–4 steps, loosely coupled, no single point of failure.
- ✖ Hard to see the whole flow; risk of cyclic event chains; harder to debug as it grows.

**b) Orchestration — a central orchestrator tells services what to do**
```
                ┌─────────────────────────┐
                │ Saga Orchestrator       │  keeps state: "step 2 done, waiting for step 3"
                └──┬─────────┬─────────┬──┘
        "charge"   │         │         │ "reserve"
                   ▼         │         ▼
              Payment        │      Inventory
                          "create"
                             ▼
                          Orders
```
- ✔ Flow is in one place, easy to monitor and test, handles complex branches.
- ✖ The orchestrator is extra code (but can be built on Temporal, Camunda, AWS Step Functions).

**Saga state in a table (orchestrator example):**
```sql
CREATE TABLE saga_instance (
    saga_id     UUID PRIMARY KEY,
    order_id    BIGINT NOT NULL,
    state       VARCHAR(30) NOT NULL,       -- STARTED, PAYMENT_DONE, STOCK_RESERVED, COMPLETED, COMPENSATING, FAILED
    updated_at  TIMESTAMP NOT NULL DEFAULT now()
);
```
**Orchestrator logic (Java, simplified):**
```java
public void runOrderSaga(Order order) {
    List<Runnable> compensations = new ArrayList<>();   // undo actions collected as we go
    try {
        orderService.create(order);
        compensations.add(0, () -> orderService.cancel(order.id()));      // add at the front -> run in reverse

        paymentService.charge(order.id(), order.total());
        compensations.add(0, () -> paymentService.refund(order.id()));

        inventoryService.reserve(order.itemId(), 1);   // may throw "out of stock"
        orderService.confirm(order.id());
    } catch (Exception e) {
        // Something failed: undo everything done so far, newest first
        compensations.forEach(Runnable::run);
        // In production: persist state first so a crash during compensation can resume!
    }
}
```
**Saga downsides:**
- **No isolation:** other transactions can see the in-between state (order PENDING, money charged but stock not reserved). Mitigate with *semantic locks* (status flags like `PENDING`), commutative updates, or re-reading values.
- Compensation logic must be written, tested, and be **idempotent** (safe to run twice).
- More code; eventual consistency must be accepted by the business.

---

#### 3. Idempotency (the key to safe retries)
Networks fail: a request may be delivered **twice**, or you may not know whether it worked. Retries are only safe if repeating an action has the **same effect as doing it once**.

```
Client ── charge $100 ──► Payment service ── (charged ✔, but reply is lost) ──✖ timeout
Client retries ── charge $100 ──► if not idempotent: charged TWICE 💥
```
**Solution: idempotency key** — the client sends a unique ID with each logical operation; the server remembers it.
```sql
CREATE TABLE processed_requests (
    idempotency_key VARCHAR(100) PRIMARY KEY,   -- unique: second insert fails
    response        TEXT,
    created_at      TIMESTAMP DEFAULT now()
);
```
```sql
-- Server side, inside the same transaction as the business change
INSERT INTO processed_requests (idempotency_key) VALUES ('order-55-charge');
-- If this INSERT hits "duplicate key" -> already processed -> return the saved response, do nothing
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
```
```php
// PHP: handle duplicate request safely
try {
    $pdo->beginTransaction();
    $pdo->prepare('INSERT INTO processed_requests (idempotency_key) VALUES (?)')->execute([$key]);
    $pdo->prepare('UPDATE accounts SET balance = balance - ? WHERE id = ?')->execute([100, 1]);
    $pdo->commit();
} catch (PDOException $e) {
    $pdo->rollBack();
    if ($e->getCode() === '23000' || $e->getCode() === '23505') {   // duplicate key: already done
        return previousResponse($key);
    }
    throw $e;
}
```

---

#### 4. Transactional Outbox (never lose or duplicate the event)
**Problem (dual write):** you must update your DB **and** publish a message (Kafka/RabbitMQ). Two systems, no shared transaction:
```
1. UPDATE orders ... COMMIT   ✔
2. publish "OrderCreated"     ✖ app crashes here  -> DB changed, event never sent
(or the reverse order -> event sent, DB change failed)
```
**Solution:** write the event into an **outbox table in the SAME local transaction** as the business data. A separate process reads the outbox and publishes it.

```
┌────────────── ONE local DB transaction ──────────────┐
│ INSERT INTO orders ...                                │
│ INSERT INTO outbox (event_type, payload) ...          │   atomic: both or neither
└───────────────────────────────────────────────────────┘
                         │
          Relay / poller / CDC reads new outbox rows
                         ▼
                  Message broker (Kafka) ──► other services
          (marks the row as sent; may send twice => consumers must be idempotent)
```
```sql
CREATE TABLE outbox (
    id           BIGINT AUTO_INCREMENT PRIMARY KEY,
    aggregate_id VARCHAR(50)  NOT NULL,
    event_type   VARCHAR(50)  NOT NULL,
    payload      JSON         NOT NULL,
    created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    sent_at      TIMESTAMP    NULL        -- NULL = not yet published
);

START TRANSACTION;
INSERT INTO orders (id, customer_id, total) VALUES (55, 7, 100);
INSERT INTO outbox (aggregate_id, event_type, payload)
VALUES ('55', 'OrderCreated', JSON_OBJECT('orderId', 55, 'total', 100));
COMMIT;
```
```java
// Relay: poll unsent events, publish, mark sent. Run in a loop / scheduler.
List<OutboxRow> rows = jdbc.query(
    "SELECT * FROM outbox WHERE sent_at IS NULL ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED", mapper);
for (OutboxRow r : rows) {
    broker.publish(r.eventType(), r.payload());                    // at-least-once: might repeat after a crash
    jdbc.update("UPDATE outbox SET sent_at = NOW() WHERE id = ?", r.id());
}
```
The "poll" can be replaced with **Change Data Capture** (see [Change Data Capture](Data-and-Persistence/advanced-sql/change-data-capture)) for lower latency.

**Inbox pattern (the receiving side):** store processed message IDs so duplicates are ignored (idempotent consumer).

---

#### 5. Try-Confirm/Cancel (TCC)
Each service offers 3 operations: **Try** (reserve resources, e.g. hold $100 / hold 1 item), **Confirm** (make it final), **Cancel** (release the hold).
```
Try:     payment.hold(100)   inventory.hold(1)      <- both "reserved", nothing final yet
All OK -> Confirm both        Any failed -> Cancel both
```
More isolation than a plain saga (resources are reserved), but each service must implement the 3 operations.

---

#### 6. Delivery guarantees (words you will hear)
| Guarantee | Meaning | How |
|---|---|---|
| At-most-once | May lose messages, never duplicates | Send and forget |
| **At-least-once** | Never loses, **may duplicate** | Retry until ACK (most common) |
| Exactly-once | Each message has its effect exactly once | Practically = **at-least-once + idempotent consumer** |

#### 7. Choosing an approach
```
Do all data live in ONE database?  ──YES──► Normal local transaction (done!)
        │ NO
Need strict all-or-nothing, few DBs you control, low volume? ──YES──► 2PC / XA / distributed SQL
        │ NO
Microservices, long flows, can accept temporary inconsistency? ──YES──► Saga (+ Outbox + Idempotency)
```
Another good option: **avoid the problem** — keep data that must change together in the same service/database (draw service boundaries around transactions).

### Time & Space Complexity
- **2PC:** latency ≈ 2 round trips × the slowest participant + log flushes; `O(P)` messages for `P` participants. Locks are held for the whole duration, so throughput drops as latency or participants grow.
- **Saga:** each step is a fast local transaction; total time ≈ **sum of steps** (sequential) but with **no cross-service locks**. Compensation costs up to `O(k)` extra steps if step `k` fails.
- **Outbox:** one extra `INSERT` per business transaction (small), plus relay polling or CDC. Space grows until sent rows are cleaned (delete or partition old rows).
- **Idempotency table:** one row per request. Needs a retention policy (e.g. delete after 7 days).

### Alternatives
| Option | When |
|---|---|
| **Distributed SQL** (Spanner, CockroachDB, YugabyteDB) | You need real ACID across nodes without writing sagas |
| **Single database / modular monolith** | Simplest: use one local transaction |
| **Event sourcing + CQRS** | Store events as truth; derive state |
| **Workflow engines** (Temporal, Camunda, Step Functions) | Durable, retryable saga orchestration |
| **Reconciliation jobs** | Periodically find and fix inconsistencies as a safety net |

### Common Mistakes
- Dual write (DB + broker) without an outbox.
- Retrying non-idempotent operations.
- Compensations that can fail with no retry or alerting.
- Doing irreversible steps (emails, shipping) before the risky steps in a saga.
- Using 2PC across public APIs or many microservices.
- Forgetting that between saga steps other users can see partial state.

### Quick Interview Answers
- **How does 2PC work?** Coordinator asks everyone to prepare/vote; if all say yes it tells all to commit, otherwise all roll back. Downside: blocking and slow.
- **Saga vs 2PC?** Saga uses local commits plus compensating actions (eventual consistency, no global locks); 2PC gives atomic commit but holds locks and can block.
- **Choreography vs orchestration?** Choreography: services react to each other's events. Orchestration: a central coordinator directs the steps.
- **What is the outbox pattern?** Save the event in an outbox table in the same transaction as the data change, then publish it asynchronously, fixing the dual-write problem.
- **How do you get "exactly-once"?** At-least-once delivery plus idempotent processing.
