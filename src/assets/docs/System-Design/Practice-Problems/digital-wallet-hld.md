# Design a Digital Wallet (like GrabPay / PayPal)

> Technique: [HelloInterview — System Design Framework](https://www.hellointerview.com/learn/system-design/in-a-hurry/introduction)

---

## What It Does

Users store money digitally inside a super-app ecosystem (like Grab). They can top up from a bank or card, send money to friends, pay for rides and food orders automatically when a service completes, scan a merchant QR code to pay offline, earn cashback points (GrabPoints), pay utility bills, and withdraw back to a bank account. Every cent must be accurate, traceable, and never lost — even if servers crash mid-transfer.

---

## Requirements

### Functional

**Above the line (must have):**
- Users can **top up** their wallet from a linked bank account or card
- Users can **send money** to another user (P2P transfer)
- Users can **pay for Grab services** (rides, GrabFood, GrabMart) — automatically deducted when the service completes
- Users can **pay a merchant via QR code** (online and offline)
- Users can **pay bills** (mobile top-up, electricity, water)
- Users can **earn GrabPoints** (cashback) on eligible transactions
- Users can **withdraw** their balance to a bank account
- Users can **view their balance** and **transaction history**

**Below the line (out of scope):**
- Currency conversion / multi-currency support
- Fraud detection ML pipelines
- Scheduled / recurring payments
- Refund flows (mention as a variant)
- GrabPay Later (BNPL credit line)

### Non-Functional

- **Strong consistency** — balance must always be accurate; no double-spending allowed
- **Idempotency** — retried or duplicate requests must never double-charge a user
- **High availability** — wallet reads/writes must be available 24/7 (99.99% uptime)
- **Durability** — no committed transaction can ever be lost (even in crash scenarios)
- **Auditability** — every balance change must be permanently traceable (regulatory requirement)
- **Low latency reads** — balance queries must return in < 100ms

---

## Scale Estimation

```
Registered users:         200M  (Southeast Asia across 8 countries)
Daily active users:       30M
Transactions/day:         80M     →  ~925 writes/sec average
                                     ~10,000 writes/sec peak (pay-day, 12.12 sale)
  Breakdown:
    Ride payments:   ~20M/day  (auto-deducted on trip complete)
    QR payments:     ~15M/day  (offline merchants)
    GrabFood orders: ~25M/day
    Bill payments:   ~5M/day
    P2P transfers:   ~15M/day
Balance reads:            10× transactions → ~9,250 reads/sec
Transaction record size:  ~600 bytes
Storage (5 years):        600B × 80M/day × 365 × 5 ≈ ~87 TB
```

**Key insight:** This is a **write-consistent** system embedded inside a high-traffic super-app. The hard problem is not throughput — it is correctness. Every debit must have a matching credit. No money can be created or destroyed. Additionally, ride and food payments must integrate seamlessly with other Grab services via internal events.

---

## Core Entities

| Entity | Purpose |
|---|---|
| **User** | Account holder: identity, KYC status, linked payment methods |
| **Wallet** | Holds the user's current balance (one per user per currency) |
| **Transaction** | A single financial event (top-up, transfer, ride payment, QR pay, bill pay, withdrawal) with status |
| **LedgerEntry** | Immutable double-entry record: every transaction produces two ledger rows (debit + credit) |
| **QRCode** | Static or dynamic QR tied to a merchant and amount; expires after single use (dynamic) |
| **GrabPointsLedger** | Tracks earned and redeemed GrabPoints per user (separate from money ledger) |
| **BillPayment** | Links a bill payment transaction to a biller ID and account reference |

---

## API Design

```
# Check balance
GET /wallets/{userId}/balance
Response: { balance: 250.00, currency: "MYR", grabPoints: 1200, lastUpdated: "..." }

# Top up from bank/card
POST /wallets/{userId}/topup
Headers: Idempotency-Key: <uuid>
Body:     { amount, currency, paymentMethodId }
Response: { transactionId, status: "PENDING"|"COMPLETED", newBalance }

# P2P transfer (send to friend)
POST /transfers
Headers: Idempotency-Key: <uuid>
Body:     { senderId, recipientId, amount, currency, note? }
Response: { transactionId, status: "COMPLETED", grabPointsEarned: 5 }

# Internal service payment — called by Grab services (ride, food, mart)
# This is an INTERNAL API, not exposed to end users
POST /internal/payments/service
Headers: X-Service-Token: <internal-jwt>
         Idempotency-Key: <uuid>
Body:     { userId, serviceType: "RIDE"|"FOOD"|"MART", serviceOrderId, amount, currency }
Response: { transactionId, status: "COMPLETED" }

# Generate QR code for merchant payment
POST /qr/generate
Body:     { merchantId, amount?, currency, note? }  ← amount null = dynamic QR (user enters amount)
Response: { qrToken, qrImageUrl, expiresAt }

# User scans QR and confirms payment
POST /qr/pay
Headers: Idempotency-Key: <uuid>
Body:     { userId, qrToken, amount? }  ← amount required only if QR was dynamic
Response: { transactionId, status: "COMPLETED", merchantName, grabPointsEarned }

# Pay a bill
POST /bills/pay
Headers: Idempotency-Key: <uuid>
Body:     { userId, billerId, accountReference, amount, currency }
Response: { transactionId, status: "PENDING"|"COMPLETED", referenceNumber }

# Withdraw to bank
POST /wallets/{userId}/withdraw
Headers: Idempotency-Key: <uuid>
Body:     { amount, currency, bankAccountId }
Response: { transactionId, status: "PENDING", estimatedArrival: "2026-03-15" }

# Transaction history (cursor-based pagination)
GET /wallets/{userId}/transactions?cursor=<opaque>&limit=20
Response: { transactions: [...], nextCursor }

# GrabPoints balance and history
GET /wallets/{userId}/points
Response: { balance: 1200, history: [...] }
```

**Why `Idempotency-Key` in the header?**
Mobile networks drop requests. Users tap "Pay" twice. Grab's internal ride service may retry on timeout. The key lets the server detect duplicate submissions and return the original result instead of charging again.

---

## High-Level Design

We start with the **simplest possible design** that satisfies the core requirement (P2P transfer + balance), then evolve it step by step for each additional requirement.

---

### Initial Design — Balance & P2P Transfer

The naive starting point: a single API server talking to a single database.

```
                                                       Wallets
                                                    ┌────────────────┐
┌──────────┐    POST /transfers    ┌─────────────┐  │ id             │
│  Client  │──────────────────────►             │  │ user_id        │
│(Grab App)│                       │  API Server │◄─►│ balance        │
│          │◄──────────────────────│             │  │ currency       │
└──────────┘    { transactionId }  └─────────────┘  └────────────────┘
                                          │          Transactions
              GET /wallets/{id}/balance   │       ┌────────────────┐
              ──────────────────────────► │       │ id             │
              ◄────────────────────────── │       │ type           │
              { balance: 250.00 }         └──────►│ amount         │
                                                  │ sender_id      │
                                                  │ recipient_id   │
                                                  │ status         │
                                                  └────────────────┘

Write (transfer):
  1) SELECT FOR UPDATE (lock sender + recipient rows)
  2) Validate sender balance ≥ amount
  3) UPDATE wallets — debit sender, credit recipient
  4) INSERT ledger entries (double-entry)
  5) Return transactionId

Read (balance):
  1) SELECT balance FROM wallets WHERE user_id = :id
  2) Return balance
```

This handles the core case. But it has problems — no caching for read scale, no async payment processor for top-up, no QR, no Kafka for ride payments. We fix each one below.

---

### Adding Top-Up — Integrating a Payment Processor

Top-up cannot be synchronous. The user's card is charged by an external system (Stripe). We cannot credit the wallet until we confirm the charge succeeded.

```
                              ┌─────────────────────────────────┐
                              │       Payment Processor         │
                              │       (Stripe / Adyen)          │
                              └────────┬────────────────────────┘
                                       │ 1) charge card
                                       │ 2) Webhook callback on success
                                       ▼
┌──────────┐  POST /topup   ┌─────────────────┐
│  Client  │───────────────►│                 │  3) credit wallet balance
│          │◄───────────────│   API Server    │─────────────────►  DB
└──────────┘  { PENDING }   │                 │  4) INSERT ledger row
                            └─────────────────┘  5) UPDATE txn COMPLETED

Rule: Balance is ONLY credited AFTER the payment processor confirms.
      Never credit optimistically.
```

---

### Adding Balance Read Cache — Redis

At 9,250 balance reads/sec we cannot hit the primary DB every time. Add a Redis cache layer.

```
                              ┌─────────────────┐
                              │      Redis      │
                              │  wallet:{id}    │  ← TTL 5 seconds
                              │  → balance      │
                              └────────┬────────┘
                                       │ cache hit → return instantly
                                       │ cache miss → read DB → populate
┌──────────┐  GET /balance   ┌─────────▼───────┐
│  Client  │───────────────►│   API Server    │──────────────────►  DB
│          │◄───────────────│                 │  (only on cache miss)
└──────────┘  { balance }   └─────────────────┘

Write path: UPDATE DB → INVALIDATE Redis key (never trust cached value for correctness)
Read path:  Redis → DB fallback
```

---

### Adding QR Payment — Redis for QR Token State

QR payments need a fast, atomic token claim mechanism. Redis handles both the QR state and the claim lock.

```
┌──────────────┐  POST /qr/generate   ┌──────────────────┐
│ Merchant App │─────────────────────►│   QR Service     │
│              │◄─────────────────────│                  │──► SET qr:{token} Redis TTL=5min
└──────────────┘  { qrToken, image }  └──────────────────┘──► INSERT qr_codes DB (audit)


┌──────────┐  (scan QR)   ┌──────────────────┐
│  User    │─────────────►│                  │  1) GET qr:{token} from Redis
│  App     │              │   Payment        │  2) SET NX qr:{token}:lock  ← atomic claim
│          │◄─────────────│   Service        │  3) Debit user + Credit merchant (DB txn)
└──────────┘  { success } │                  │  4) DEL lock, SET status=COMPLETED
                          └──────────────────┘

Static QR  → no lock needed (each user generates their own payment)
Dynamic QR → Redis SET NX prevents two users paying the same QR simultaneously
```

---

### Adding Ride / Food / Mart Auto-Deduction — Kafka

Grab services (Ride, GrabFood, GrabMart) need to trigger wallet deduction when an order/trip completes. This must be **decoupled** from the Wallet Service — we don't want the Ride Service to directly call the Wallet API (tight coupling, cascading failures).

```
┌─────────────┐  trip ends   ┌───────────┐  grab.service.completed  ┌──────────────────┐
│ Ride Service│─────────────►│           │─────────────────────────►│  Payment Service │
│ Food Service│              │   Kafka   │                          │  (Kafka Consumer)│
│ Mart Service│              │           │                          │                  │
└─────────────┘              └───────────┘                          │  1) Read event   │
                                                                    │  2) Check idem   │
                                                                    │  3) Debit wallet │
                                                                    │  4) Commit offset│
                                                                    └──────────────────┘

Key: idempotencyKey = eventType + ":" + orderId
     Kafka re-delivers on crash → idempotency check → skip → no double charge
     Offset committed AFTER payment → no missed events
```

---

### Adding Bill Payment — Biller APIs

```
┌──────────┐  POST /bills/pay   ┌──────────────────┐
│  User    │──────────────────►│  Bill Pay Service │
│          │◄──────────────────│                   │  1) Debit wallet immediately (DB txn)
└──────────┘  { PENDING }      └────────┬──────────┘  2) Queue biller request (Kafka)
                                        │
                               ┌────────▼──────────┐
                               │  Biller API       │  3) Send payment instruction
                               │  (TNB, Maxis...)  │  4) Webhook on success/failure
                               └────────┬──────────┘
                                        │
                               ┌────────▼──────────┐
                               │  Bill Pay Service │  5) UPDATE txn COMPLETED
                               │  (webhook handler)│     or saga compensate if failed
                               └───────────────────┘
```

---

### Adding GrabPoints — Async Rewards Ledger

Points are **not** money — they have no ACID requirement. They are awarded asynchronously after every eligible payment.

```
                         ┌──────────────────────────────────────┐
                         │              Kafka                   │
                         │  Topic: wallet.transaction.completed │
                         └──────────────────┬───────────────────┘
                                            │
                               ┌────────────▼────────────┐
                               │   GrabPoints Service    │
                               │   (async consumer)      │
                               │                         │
                               │  1) Read payment event  │
                               │  2) Calculate points    │
                               │     (% of amount)       │
                               │  3) INCRBY Redis        │
                               │     points:{userId}     │
                               │  4) INSERT              │
                               │     grab_points_ledger  │
                               └─────────────────────────┘

Decoupled: if GrabPoints service is down, payment already succeeded.
           Points are retried from Kafka independently.
```

---

### Final Evolved Design (all requirements combined)

See **Complete Architecture** diagram below — this is the full system after all requirements are built in.

---

## Deep Dives

### 1. How Do We Prevent Double-Spending?

**The problem:** A user with $100 clicks "Send $100 to Alice" and "Pay merchant $100" within milliseconds of each other. Without protection, both reads see $100 balance → both transfers succeed → wallet goes to -$100.

This is the same TOCTOU (time-of-check to time-of-use) race condition as Uber's driver locking problem.

**Option A — Application-Level Check**
```
if wallet.balance >= amount:
    wallet.balance -= amount  ← race condition here
```
Two requests can both pass the `if` check before either writes. This does not work in a concurrent system.

**Option B — Optimistic Locking (Version Field)**
Add a `version` column to the `Wallet` table:
```sql
UPDATE wallets
SET balance = balance - :amount,
    version = version + 1
WHERE user_id = :userId
  AND version = :expectedVersion  -- only succeeds if no one else updated first
  AND balance >= :amount;
```
Check rows affected → if 0, retry. This works but generates retry traffic under contention.

**Option C — Database Serializable Transaction** ✅ (Recommended)
```sql
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;
  SELECT balance FROM wallets WHERE user_id = :id FOR UPDATE;  -- row-level lock
  -- check balance >= amount
  UPDATE wallets SET balance = balance - :amount WHERE user_id = :id;
COMMIT;
```

`FOR UPDATE` acquires a **row-level exclusive lock** the moment the row is read. Any concurrent transaction trying to touch the same row blocks until this transaction commits or rolls back. The lock is held for milliseconds — this is fast and correct.

**Why not a distributed lock (Redis SET NX)?**
You could, but for a single-database transfer, a SQL row lock is simpler, always consistent with the data, and auto-releases on transaction end. Redis locks are better when you need to coordinate across multiple DB shards.

**For cross-shard transfers (sender and recipient on different DB shards):**
Use a **two-phase commit (2PC)** or the **Saga pattern**:
```
Phase 1 — Prepare:
  Shard A: lock and reserve sender balance (status = PENDING)
  Shard B: lock and reserve recipient slot

Phase 2 — Commit (only if both Prepares succeeded):
  Shard A: finalize debit
  Shard B: finalize credit

On any failure → compensating transactions (rollback each shard separately)
```

---

### 2. How Do We Guarantee Idempotency?

**The problem:** A user's network drops after hitting "Pay" but before receiving the response. The app retries. Without idempotency, the payment is charged twice.

**The solution:** Every mutating request carries an `Idempotency-Key` (a UUID generated by the client). The server stores a mapping of `(idempotency_key → response)`.

```
Client sends: POST /transfers  +  Idempotency-Key: abc-123

Server flow:
  1. Check idempotency_keys table for key "abc-123"
  2. If found → return the stored original response (do not process again)
  3. If not found:
       BEGIN
         execute transfer logic
         INSERT INTO idempotency_keys (key, response, expires_at)
       COMMIT
       return response
```

**Key details:**
- The idempotency key check + business logic + key insertion are all in **one atomic transaction**. If the transaction fails, the key is never stored → the client can safely retry.
- Key expiry: store keys for 24–72 hours. After that, the same key can be reused (the payment attempt window is gone).
- If two concurrent requests arrive with the same key, only one wins the DB INSERT (unique constraint on key). The other receives a 409 Conflict and waits for the first to resolve.

```sql
CREATE TABLE idempotency_keys (
  key         VARCHAR(128) PRIMARY KEY,
  response    JSONB,
  created_at  TIMESTAMP,
  expires_at  TIMESTAMP
);
```

---

### 3. Why Double-Entry Bookkeeping and How Does It Work?

**The problem:** With a single `balance` column, you know the current state but cannot reconstruct history or catch bugs. If a software error sets a balance to the wrong value, you have no way to audit what happened.

**The solution:** Every financial transaction produces **two ledger entries** — one debit, one credit. The sum of all ledger entries must always equal zero (double-entry invariant). This is the same model banks use.

```
Alice sends $50 to Bob:

LedgerEntry 1: account=alice_wallet,  amount= -50.00,  type=DEBIT
LedgerEntry 2: account=bob_wallet,    amount= +50.00,  type=CREDIT

Sum: -50 + 50 = 0 ✓
```

**How is balance computed?**
```sql
-- Option A: compute from ledger (always accurate, slower)
SELECT SUM(amount)
FROM ledger_entries
WHERE account_id = :walletId;

-- Option B: maintain materialized balance in Wallet table (fast reads)
--           Ledger is the source of truth for auditing
SELECT balance FROM wallets WHERE user_id = :userId;
```

In practice: maintain `wallets.balance` as a denormalized cache, updated atomically inside each transaction. The ledger is the audit log. Periodic reconciliation jobs compare `SUM(ledger)` vs `wallet.balance` and alert on discrepancies.

**Why this matters:**
- Regulatory compliance (financial institutions must keep immutable records)
- Debugging: reconstruct any past balance at any point in time
- Fraud detection: spot unusual patterns in the ledger
- Catch software bugs: if `SUM(all ledger entries) ≠ 0`, there is a bug in the system

---

### 4. How Do We Handle Distributed Transfer Consistency?

**The problem:** At scale, wallets are sharded across multiple database nodes. Sender may be on Shard A, recipient on Shard B. A transaction that spans two databases cannot use a single `BEGIN...COMMIT`.

**Option A — Two-Phase Commit (2PC)**
```
Coordinator:
  Phase 1 (Prepare):
    → Shard A: "can you debit $50 from Alice?" → "YES, locked"
    → Shard B: "can you credit $50 to Bob?"   → "YES, ready"
  Phase 2 (Commit):
    → Shard A: "commit" → done
    → Shard B: "commit" → done

If Shard B fails in Phase 2:
    → Shard A: "rollback"
```
- Guarantee: atomic across shards
- Problem: Coordinator becomes a single point of failure. If it crashes between Phase 1 and Phase 2, shards remain locked indefinitely (blocking problem).

**Option B — Saga Pattern (Choreography)** ✅ (Recommended at Scale)
```
Step 1: Debit sender (Shard A)        → publish event "sender_debited"
Step 2: Credit recipient (Shard B)    → publish event "recipient_credited"

If Step 2 fails:
  Compensating transaction: Refund sender (Shard A)  ← undo Step 1
```

Each step is a local ACID transaction. Failures trigger compensating transactions instead of rollbacks. The system is **eventually consistent** but **never incorrect** — money never disappears.

**Why Saga over 2PC at scale?**
- No distributed lock held for extended periods
- Services remain loosely coupled
- Works across microservices and different databases
- Compensating transactions are just normal business logic

---

### 5. How Does QR Code Payment Work at Scale?

**The problem:** Grab merchants (hawker stalls, convenience stores, parking) have static QR codes. Many customers scan the same code simultaneously. Each scan must result in exactly one payment per transaction — no double charges, no race conditions on the QR token.

**Static QR (merchant's permanent code):**
```
QR encodes:  { merchantId, currency }   ← no amount, no expiry
User scans → enters amount in app → taps Pay
Payment Service: debit user, credit merchant (standard transfer flow)
Idempotency key: user-generated UUID per tap
```
Simple — the QR is just a merchant identifier. No concurrency issue because each user generates their own payment.

**Dynamic QR (generated per checkout, e.g. e-commerce, GrabFood):**
```
Merchant/system generates:
  qrToken = UUID (stored in Redis with 5-minute TTL)
  Redis key: qr:{qrToken} → { merchantId, amount, status: "PENDING" }

User scans → confirms → taps Pay:
  Payment Service:
    1. SETNX qr:{qrToken}:claimed → 1   ← atomic claim
    2. If already claimed → reject (409 QR already used)
    3. Execute payment
    4. SET qr:{qrToken} status = "COMPLETED"
    5. DELETE lock after completion
```

**Why Redis SETNX for QR claiming?**
Same principle as Uber's driver locking. Multiple users could try to pay with the same dynamic QR (e.g., someone screenshots it and shares). Redis `SET NX` ensures only the first claimer wins. The QR token expires automatically via TTL — no stale locks.

**QR code format:**
```
QR string: grabpay://pay?token=abc123&merchant=myshop
             └── deep link that opens Grab app
                 └── app extracts token and calls POST /qr/pay
```

---

### 6. How Does Auto-Deduction for Grab Services Work?

**The problem:** When a Grab ride ends, the Ride Service needs to charge the user's wallet. But:
- The Ride Service and Wallet Service are separate systems
- Network failures can cause the payment event to be replayed multiple times
- The user should never be charged twice for the same trip

**The solution: Event-driven payment with idempotent event processing**

```
Ride Service publishes to Kafka:
  Topic: grab.service.completed
  Key: tripId (for ordering)
  Payload: {
    eventId: uuid,
    eventType: "TRIP_COMPLETED",
    tripId: "trip_abc123",
    userId: "user_456",
    amount: 18.50,
    currency: "MYR",
    timestamp: "2026-03-13T10:05:00Z"
  }

Payment Service (Kafka consumer):
  1. Read event from topic
  2. idempotencyKey = "trip_completed:" + tripId
  3. Check idempotency_keys for this key
  4. If exists → skip (already processed) → commit Kafka offset
  5. If not exists → execute payment → store idempotency key
  6. Commit Kafka offset AFTER successful payment
```

**Why commit Kafka offset AFTER payment, not before?**
If the consumer crashes after committing the offset but before completing the payment, the event is lost — the user is never charged. By committing only after successful payment, a crash causes the event to be re-delivered — and the idempotency key prevents double-charging.

**Same pattern applies to GrabFood and GrabMart:**
```
ORDER_DELIVERED event → Payment Service → deduct wallet
FOOD_PICKUP_CONFIRMED event → Payment Service → deduct wallet
```

Each service publishes its own completion event with a unique order ID used as the idempotency key.

---

### 7. How Do We Scale Balance Reads?

**The problem:** With 5,800 balance reads/sec and growing, hitting the primary database for every read is expensive.

**Option A — Read Replicas**
Replicate the wallet DB. Route `GET /balance` to a replica.
- Slightly stale (replication lag ~10–100ms) — acceptable for balance reads
- No extra infrastructure beyond what PostgreSQL natively supports

**Option B — Redis Cache** ✅ (Recommended for hot users)
```
Cache key: wallet:{userId}:balance
TTL: 5 seconds

On read:
  1. Check Redis → cache hit → return balance (< 1ms)
  2. Cache miss → read from DB → populate cache → return

On write (transfer/topup):
  1. Update DB atomically
  2. Invalidate or update Redis key
```

**Why 5-second TTL?**
Short enough that a user refreshing their app sees an up-to-date balance. Long enough to absorb read spikes. For the write path, always go to the database — never trust a cached balance for correctness decisions.

**Option C — Event-Sourced Balance (Advanced)**
Derive balance by replaying all ledger events. Expensive for real-time reads but perfect for reconciliation and audit. Only practical with a CQRS architecture where a read-model is maintained separately.

---

## Complete Architecture

```
  ┌────────────────┐  ┌──────────────┐  ┌──────────────────┐
  │  Grab User App │  │ Merchant App │  │  Grab Internal   │
  │ (ride,food,pay)│  │ (QR display) │  │ Services (Ride,  │
  └───────┬────────┘  └──────┬───────┘  │  Food, Mart)     │
          │                  │          └────────┬──────────┘
          │                  │                   │ events
  ┌───────▼──────────────────▼───────────────────▼──────────┐
  │                    API Gateway                           │
  │        (Auth/JWT, Rate Limiting, TLS termination)        │
  └───┬─────────────┬───────────────┬──────────┬────────────┘
      │             │               │          │
  ┌───▼────┐  ┌─────▼──────┐  ┌────▼───┐  ┌───▼──────────┐
  │ Wallet │  │ Transfer   │  │  QR    │  │  Bill Pay    │
  │ Service│  │ Service    │  │ Service│  │  Service     │
  │(balance│  │(P2P, saga  │  │(generate│ │(biller APIs) │
  │ topup, │  │ coord.)    │  │ /claim) │  └──────┬───────┘
  │withdraw│  └─────┬──────┘  └────┬───┘         │
  └───┬────┘        │              │              │
      │             │              │              │
  ┌───▼─────────────▼──────────────▼──────────────▼────────┐
  │                    Payment Service                      │
  │   (executes debit+credit, writes ledger, idempotency)   │
  └──────────────────────────┬──────────────────────────────┘
                             │
          ┌──────────────────┼──────────────────────┐
          │                  │                      │
  ┌───────▼──────┐   ┌───────▼──────┐    ┌──────────▼───────┐
  │  PostgreSQL  │   │    Redis     │    │  GrabPoints      │
  │  (wallets,   │   │  - balance   │    │  Service         │
  │  txns, ledger│   │    cache 5s  │    │  (async, earned  │
  │  idem_keys)  │   │  - QR tokens │    │   per txn)       │
  │  Sharded by  │   │  - QR locks  │    └──────────────────┘
  │  userId      │   │    (SETNX)   │
  └──────────────┘   └──────────────┘
                             │
  ┌──────────────────────────▼──────────────────────────────┐
  │                       Kafka                             │
  │  Topics:                                                │
  │  - grab.service.completed  (ride/food/mart events)      │
  │  - wallet.transaction.completed  (audit stream)         │
  │  - wallet.notification.events  (push/SMS triggers)      │
  └────────┬──────────────────┬────────────────────┬────────┘
           │                  │                    │
  ┌────────▼────┐   ┌──────────▼─────┐   ┌─────────▼──────┐
  │ Settlement  │   │  Notification  │   │ Reconciliation │
  │  Service    │   │  Service       │   │  Service       │
  │ (merchant   │   │  (push, email, │   │ (nightly audit │
  │  payouts)   │   │   SMS, in-app) │   │  ledger check) │
  └────┬────────┘   └────────────────┘   └────────────────┘
       │
  ┌────▼───────────────────────────┐
  │  External Payment / Bill APIs  │
  │  Stripe/Adyen (topup, payout)  │
  │  Bank FPX / ACH (withdraw)     │
  │  Biller APIs (TNB, Maxis, etc) │
  └────────────────────────────────┘
```

---

## Variant Questions & Short Answers

**Q: What if a user's wallet has insufficient balance when a Grab ride completes?**
> The ride has already happened — the user owes the money. Three strategies: (1) Allow wallet to go negative up to a small limit (e.g. -RM 50) — user must top up before next ride. (2) Automatically charge the user's linked card via Stripe as a fallback. (3) Block new rides until the outstanding balance is paid. In practice, Grab uses a combination — linked card fallback first, then service restriction.

**Q: What if a user scans a QR code but the app crashes before the payment completes?**
> The dynamic QR token in Redis is still in `PENDING` state. The claim lock (SETNX) was not set because the payment never started. The user can re-scan. If the lock WAS set but payment failed, the lock expires automatically via Redis TTL (e.g., 60 seconds) → QR becomes claimable again. The merchant's QR display will timeout and can generate a fresh dynamic QR.

**Q: How do GrabPoints work without affecting payment consistency?**
> Points are awarded asynchronously — they are NOT part of the payment ACID transaction. When a payment completes, the Payment Service publishes a `payment.completed` event to Kafka. The GrabPoints Service consumes this event and appends to the `grab_points_ledger`. If points fail to award (rare), the payment has already succeeded — points are retried from the Kafka event. This decouples rewards from the payment critical path.

**Q: How do you handle a biller API being down during bill payment?**
> The wallet debit happens immediately (user's balance is reduced). The bill payment instruction is queued in Kafka / a retry queue. The Payment Service retries delivery to the Biller API with exponential backoff over 24 hours. If ultimately undeliverable, a saga compensation refunds the user's wallet and sends a failure notification. The transaction is marked `FAILED` with reason `BILLER_UNAVAILABLE`.

**Q: What if a transfer partially fails — sender is debited but recipient is never credited?**
> This is the most important failure case. Solved by the Saga pattern: the "sender_debited" event is published to Kafka. A consumer credits the recipient. If the credit step fails, a compensating consumer refunds the sender. The transaction record stays in `PENDING` until the saga resolves. The idempotency key prevents duplicate processing.

**Q: How do you handle a user exceeding their daily transfer limit?**
> Store a `daily_total_sent` counter in Redis (key: `user:{id}:daily_limit:{date}`, expires at midnight). On each transfer, atomically increment with `INCRBY` and check against the limit before writing to the DB. Redis atomic increment prevents race conditions on the limit check.

**Q: How do you guarantee the ledger is immutable?**
> Ledger entries are append-only — no UPDATE or DELETE is ever issued on that table. At the DB level, grant the application role only INSERT and SELECT on `ledger_entries`. For extra protection, configure DB-level row security policies. Auditors can always run `SUM(amount)` and verify it equals zero.

**Q: How do you scale to Black Friday / Super Bowl levels of payment volume?**
> Transfer and Wallet Services are stateless — auto-scale horizontally behind the API Gateway. PostgreSQL is sharded by `userId` using consistent hashing. Redis Cluster handles balance cache spikes. Rate limiting at the gateway absorbs request bursts. Kafka decouples the heavy downstream work (settlement, notifications) from the hot path.

**Q: How would you design recurring payments / subscriptions?**
> A Scheduler Service stores `recurring_payment` records with `next_run_at`. A cron job runs every minute, finds due payments, and publishes them to Kafka as normal payment events. The Payment Service processes them exactly like a user-initiated payment — idempotency key is derived from `(subscriptionId, scheduledDate)` to prevent duplicates if the cron runs twice.

**Q: What if the Payment Processor webhook for a top-up is delivered twice?**
> The `paymentProcessorTransactionId` in the `transactions` table has a unique constraint. The second webhook triggers an INSERT that violates the unique constraint → returns an error → webhook is safely ignored. This is a second layer of idempotency on top of the `Idempotency-Key` header.

**Q: How do you implement refunds?**
> A refund is a reverse transfer: credit the payer, debit the merchant. Create a new `REFUND` transaction linked to the original `transactionId`. The ledger records the reversal entries. The original transaction is never modified — only a new one is added. This preserves the audit trail.

---

## Technologies & Techniques — What You Learned & Where Else to Use Them

| Technology / Technique | What It Does Here | Use It Elsewhere For |
|---|---|---|
| **Serializable Isolation (SELECT FOR UPDATE)** | Row-level lock prevents double-spending on the same wallet | Any shared mutable resource: inventory hold, seat reservation, coupon claim |
| **Idempotency Keys** | Duplicate requests return the same result without double-charging | Payment APIs, email sending, SMS, any non-idempotent HTTP POST |
| **Double-Entry Ledger** | Two rows (debit + credit) per transaction — sum always zero | Any financial system, accounting software, token/credit systems |
| **Saga Pattern** | Distributed multi-step transaction with compensating rollbacks | Order fulfillment (charge → ship → confirm), hotel booking (reserve room → charge → confirm) |
| **Two-Phase Commit (2PC)** | Atomic cross-shard commit with a coordinator | Distributed databases, XA transactions, any strong-consistency cross-service operation |
| **Idempotent Webhooks** | Unique constraint on external txn ID prevents double-processing | Any system receiving webhooks: Stripe, GitHub, Slack event callbacks |
| **Redis INCRBY + Expiry** | Atomic rate/limit counter that resets daily | Rate limiting, request quotas, daily spend caps, leaderboard scoring |
| **Cursor-Based Pagination** | Stable page through large datasets without OFFSET degradation | Any high-volume history/feed: social feed, audit logs, order history |
| **Kafka (Event Streaming)** | Decouple saga steps, settlement, notifications from the hot path | Any async downstream work: email, push, ML pipeline triggers, audit stream |
| **Read Replicas + Redis Cache** | Absorb high balance-read traffic without hitting the primary DB | User profile reads, product catalog, any frequently-read, infrequently-written data |
| **Compensating Transactions** | Undo a saga step when a downstream step fails | Any distributed workflow that cannot use 2PC (microservices, cross-cloud) |
| **Append-Only Ledger** | Immutable record of every state change | Audit logs, event sourcing, blockchain-like integrity guarantees |
| **Consistent Hashing (DB Sharding)** | Distribute wallets across DB nodes without rehashing all keys on scale | Any sharded data store: user data, session store, distributed cache |
| **Webhook Deduplication** | Unique constraint on external ID catches duplicate deliveries | Payment processors, shipping carriers, any third-party event source |
| **Redis SETNX for QR Claiming** | Only one user can claim a dynamic QR token | Any one-time-use token: promo codes, lottery entries, single-use invite links |
| **Event-Driven Service Payment** | Ride/Food service publishes completion event → wallet deducts | Any payment triggered by a service completion: delivery, subscription renewal |
| **Kafka Offset After Processing** | Commit offset only after payment succeeds to prevent missed events | Any at-least-once consumer that must not miss events: billing, order fulfillment |
| **GrabPoints Async Ledger** | Rewards are eventually consistent, decoupled from payment ACID path | Any loyalty/points system, achievement unlocks, badge awards |
| **Linked Card Fallback** | When wallet balance is insufficient, fall back to card charge | Any multi-payment-method system with graceful degradation |
| **Dynamic QR with TTL** | QR expires after use or timeout — prevents reuse and stale codes | Any single-use token: OTP, password reset link, event entry QR |
