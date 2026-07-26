# Digital Wallet (GrabPay) — Low-Level Design

> Technique: [HelloInterview — Low-Level Design Framework](https://www.hellointerview.com/learn/system-design/in-a-hurry/introduction)

---

## Scope

This LLD covers three core flows of GrabPay:

1. **Transfer Service** — P2P transfers (idempotency, row-level locking, double-entry ledger)
2. **QR Payment Service** — Dynamic QR claiming and merchant payment
3. **Service Payment Consumer** — Auto-deduction when Grab ride/food/mart completes (Kafka event-driven)

> Related HLD: `System-Design/Practice-Problems/digital-wallet-hld.md`

---

## Class Design

### Core Domain Classes

```
┌─────────────────────────────────────┐
│              Wallet                 │
├─────────────────────────────────────┤
│ - id: UUID                          │
│ - userId: UUID                      │
│ - balance: Decimal                  │
│ - currency: Currency (enum)         │
│ - version: int          ← optimistic│
│ - createdAt: Timestamp              │
│ - updatedAt: Timestamp              │
├─────────────────────────────────────┤
│ + getBalance(): Decimal             │
│ + canDebit(amount): boolean         │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│            Transaction              │
├─────────────────────────────────────┤
│ - id: UUID                          │
│ - type: TransactionType (enum)      │
│ - status: TransactionStatus (enum)  │
│ - amount: Decimal                   │
│ - currency: Currency                │
│ - senderId: UUID                    │
│ - recipientId: UUID                 │
│ - idempotencyKey: string            │
│ - note: string (nullable)           │
│ - failureReason: string (nullable)  │
│ - createdAt: Timestamp              │
│ - completedAt: Timestamp (nullable) │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│            LedgerEntry              │
├─────────────────────────────────────┤
│ - id: UUID                          │
│ - transactionId: UUID               │
│ - accountId: UUID    ← walletId     │
│ - amount: Decimal    ← + or -       │
│ - type: EntryType (DEBIT | CREDIT)  │
│ - balanceAfter: Decimal             │
│ - createdAt: Timestamp              │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│          IdempotencyRecord          │
├─────────────────────────────────────┤
│ - key: string (PK)                  │
│ - response: JSON                    │
│ - status: IdempotencyStatus         │
│ - createdAt: Timestamp              │
│ - expiresAt: Timestamp              │
└─────────────────────────────────────┘
```

### Grab-Specific Classes

```
┌─────────────────────────────────────┐
│              QRCode                 │
├─────────────────────────────────────┤
│ - token: UUID (PK)                  │
│ - merchantId: UUID                  │
│ - amount: Decimal (null=dynamic)    │
│ - currency: Currency                │
│ - type: QRType (STATIC | DYNAMIC)   │
│ - status: QRStatus                  │
│ - createdBy: UUID (userId/system)   │
│ - claimedBy: UUID (nullable)        │
│ - expiresAt: Timestamp              │
│ - createdAt: Timestamp              │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│         GrabPointsLedger            │
├─────────────────────────────────────┤
│ - id: UUID                          │
│ - userId: UUID                      │
│ - transactionId: UUID (nullable)    │
│ - points: int      ← + earned, -redeemed │
│ - type: PointsType (EARNED|REDEEMED)│
│ - balanceAfter: int                 │
│ - createdAt: Timestamp              │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│       ServicePaymentEvent           │
├─────────────────────────────────────┤
│ - eventId: UUID                     │
│ - eventType: ServiceEventType       │
│   (TRIP_COMPLETED | ORDER_DELIVERED │
│    | MART_DELIVERED)                │
│ - serviceOrderId: string            │
│ - userId: UUID                      │
│ - amount: Decimal                   │
│ - currency: Currency                │
│ - timestamp: Timestamp              │
└─────────────────────────────────────┘
```

### Enums

```
TransactionType:
  TOPUP           ← money coming in from external
  TRANSFER        ← P2P user to user
  QR_PAYMENT      ← user scanning merchant QR
  SERVICE_PAYMENT ← auto-deducted by Grab service
  BILL_PAYMENT    ← bill pay to biller
  WITHDRAWAL      ← money going out to bank

TransactionStatus:
  PENDING     ← created, not yet finalized
  COMPLETED   ← all steps committed
  FAILED      ← error, no money moved
  REVERSED    ← saga compensation completed

EntryType:
  DEBIT       ← money leaving an account (amount stored as negative)
  CREDIT      ← money entering an account (amount stored as positive)

QRType:
  STATIC   ← merchant's permanent QR, user enters amount
  DYNAMIC  ← per-transaction QR, amount pre-filled, expires after 1 use or 5 min

QRStatus:
  PENDING   ← generated, not yet claimed
  CLAIMED   ← payment in progress
  COMPLETED ← payment succeeded
  EXPIRED   ← TTL passed or explicitly cancelled

PointsType:
  EARNED    ← credited after eligible payment
  REDEEMED  ← used for a discount
  EXPIRED   ← points past their validity period

IdempotencyStatus:
  IN_PROGRESS ← first request is being processed right now
  COMPLETED   ← result stored, return cached response
```

### Service Interfaces

```
interface TransferService {
  transfer(request: TransferRequest): TransferResult
}

interface WalletRepository {
  findByUserIdForUpdate(userId: UUID): Wallet   // SELECT FOR UPDATE
  findByUserId(userId: UUID): Wallet
  updateBalance(walletId: UUID, delta: Decimal, version: int): int  // returns rows affected
}

interface TransactionRepository {
  create(tx: Transaction): Transaction
  updateStatus(txId: UUID, status: TransactionStatus, reason?: string): void
  findByIdempotencyKey(key: string): Transaction | null
}

interface LedgerRepository {
  appendEntries(entries: LedgerEntry[]): void   // bulk insert, never update/delete
}

interface IdempotencyStore {
  getOrCreate(key: string): IdempotencyRecord
  complete(key: string, response: JSON): void
  fail(key: string, reason: string): void
}
```

---

## Database Schema

### `wallets`

```sql
CREATE TABLE wallets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL UNIQUE,
  balance       NUMERIC(19, 4) NOT NULL DEFAULT 0,   -- 4 decimal places
  currency      CHAR(3) NOT NULL DEFAULT 'USD',
  version       INT NOT NULL DEFAULT 0,              -- optimistic lock version
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT balance_non_negative CHECK (balance >= 0)  -- DB-level guard
);

CREATE INDEX idx_wallets_user_id ON wallets(user_id);
```

> **Why `NUMERIC(19,4)` not `FLOAT`?** Floating-point types have rounding errors. `NUMERIC` is exact. Never use `FLOAT` or `DOUBLE` for money.

> **Why a `CHECK (balance >= 0)`?** Defense in depth. Even if application code has a bug, the DB refuses to let a balance go negative. This is a hard financial constraint.

---

### `transactions`

```sql
CREATE TABLE transactions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type              VARCHAR(20) NOT NULL,   -- TOPUP | TRANSFER | PAYMENT | WITHDRAWAL
  status            VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  amount            NUMERIC(19, 4) NOT NULL,
  currency          CHAR(3) NOT NULL DEFAULT 'USD',
  sender_id         UUID REFERENCES wallets(id),
  recipient_id      UUID REFERENCES wallets(id),
  idempotency_key   VARCHAR(128) NOT NULL UNIQUE,
  note              TEXT,
  failure_reason    TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ,

  CONSTRAINT amount_positive CHECK (amount > 0)
);

CREATE INDEX idx_transactions_sender    ON transactions(sender_id, created_at DESC);
CREATE INDEX idx_transactions_recipient ON transactions(recipient_id, created_at DESC);
CREATE INDEX idx_transactions_idem_key  ON transactions(idempotency_key);
```

> **Why index on `(sender_id, created_at DESC)`?** Transaction history queries always filter by user and sort by newest first. A composite index satisfies both in one scan.

---

### `ledger_entries`

```sql
CREATE TABLE ledger_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  UUID NOT NULL REFERENCES transactions(id),
  account_id      UUID NOT NULL REFERENCES wallets(id),   -- which wallet
  amount          NUMERIC(19, 4) NOT NULL,                -- negative=debit, positive=credit
  entry_type      CHAR(6) NOT NULL,                       -- DEBIT | CREDIT
  balance_after   NUMERIC(19, 4) NOT NULL,                -- snapshot for audit
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only enforcement: REVOKE UPDATE, DELETE ON ledger_entries FROM app_role;

CREATE INDEX idx_ledger_account   ON ledger_entries(account_id, created_at DESC);
CREATE INDEX idx_ledger_txn       ON ledger_entries(transaction_id);
```

> **Why store `balance_after`?** It lets you reconstruct a wallet's balance at any point in time without replaying all entries: just find the ledger row at or before the target timestamp and read `balance_after`.

---

### `qr_codes` (persistent record for audit — Redis is primary runtime store)

```sql
CREATE TABLE qr_codes (
  token        UUID PRIMARY KEY,
  merchant_id  UUID NOT NULL REFERENCES wallets(id),
  amount       NUMERIC(19, 4),               -- NULL means dynamic (user enters)
  currency     CHAR(3) NOT NULL DEFAULT 'MYR',
  type         VARCHAR(10) NOT NULL,          -- STATIC | DYNAMIC
  status       VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  claimed_by   UUID REFERENCES wallets(id),  -- userId who paid
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_qr_merchant   ON qr_codes(merchant_id, created_at DESC);
CREATE INDEX idx_qr_expires    ON qr_codes(expires_at) WHERE status = 'PENDING';
```

**Redis keys for QR (runtime, fast path):**
```
qr:{token}         → { merchantId, amount, currency, status }  TTL=300s (5 min for dynamic)
qr:{token}:lock    → {userId}   SET NX PX 30000   ← claim lock, 30s to complete payment
```

---

### `grab_points_ledger`

```sql
CREATE TABLE grab_points_ledger (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL,
  transaction_id  UUID REFERENCES transactions(id),  -- which payment earned/used points
  points          INT NOT NULL,                      -- positive=earned, negative=redeemed
  entry_type      VARCHAR(10) NOT NULL,              -- EARNED | REDEEMED | EXPIRED
  balance_after   INT NOT NULL,                      -- snapshot for audit
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only: REVOKE UPDATE, DELETE ON grab_points_ledger FROM app_role;

CREATE INDEX idx_points_user ON grab_points_ledger(user_id, created_at DESC);
```

**Redis key for real-time points balance:**
```
points:{userId}   → INT  (updated atomically with INCRBY on every earn/redeem)
```

---

### `idempotency_keys`

```sql
CREATE TABLE idempotency_keys (
  key         VARCHAR(128) PRIMARY KEY,
  status      VARCHAR(20) NOT NULL DEFAULT 'IN_PROGRESS',
  response    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '72 hours'
);

CREATE INDEX idx_idem_expires ON idempotency_keys(expires_at)
  WHERE status = 'COMPLETED';   -- for cleanup job
```

---

## Transfer Algorithm — Step by Step

This is the core of the system. Walk through it carefully.

### Happy Path

```
Input:  TransferRequest { senderId, recipientId, amount, idempotencyKey }

Step 1 — Idempotency Check (BEFORE anything else)
──────────────────────────────────────────────────
  BEGIN
    SELECT * FROM idempotency_keys WHERE key = :idempotencyKey FOR UPDATE
    IF found AND status = 'COMPLETED'  → return cached response (early exit)
    IF found AND status = 'IN_PROGRESS' → return 409 (request in flight)
    IF not found → INSERT idempotency_keys (key, status='IN_PROGRESS')
  COMMIT

Step 2 — Create Transaction Record (status = PENDING)
──────────────────────────────────────────────────────
  INSERT INTO transactions (id, type='TRANSFER', status='PENDING',
                             amount, senderId, recipientId, idempotencyKey)

Step 3 — Execute Transfer (single ACID transaction)
────────────────────────────────────────────────────
  BEGIN
    -- Lock both wallets in a deterministic order (lower UUID first)
    -- This prevents deadlocks when two transfers try to lock the same pair
    SELECT * FROM wallets WHERE id IN (:senderWalletId, :recipientWalletId)
      ORDER BY id ASC
      FOR UPDATE

    -- Validate
    IF sender.balance < amount → raise InsufficientFundsError

    newSenderBalance    = sender.balance - amount
    newRecipientBalance = recipient.balance + amount

    -- Update balances
    UPDATE wallets SET balance = :newSenderBalance,    version = version + 1,
                       updated_at = now()
      WHERE id = :senderWalletId

    UPDATE wallets SET balance = :newRecipientBalance, version = version + 1,
                       updated_at = now()
      WHERE id = :recipientWalletId

    -- Write ledger entries (immutable, append-only)
    INSERT INTO ledger_entries
      (transaction_id, account_id, amount, entry_type, balance_after)
    VALUES
      (:txnId, :senderWalletId,    -:amount, 'DEBIT',  :newSenderBalance),
      (:txnId, :recipientWalletId, +:amount, 'CREDIT', :newRecipientBalance)

    -- Finalize transaction
    UPDATE transactions SET status = 'COMPLETED', completed_at = now()
      WHERE id = :txnId

  COMMIT

Step 4 — Mark Idempotency Key Complete
────────────────────────────────────────
  UPDATE idempotency_keys
    SET status = 'COMPLETED', response = :serializedResponse
    WHERE key = :idempotencyKey
```

### Failure Path — What Happens When Step 3 Rolls Back?

```
Error during BEGIN...COMMIT block
    ↓
ROLLBACK (DB automatically undoes all Step 3 changes)
    ↓
transaction.status stays PENDING (was set in Step 2, outside the inner txn)
    ↓
UPDATE transactions SET status = 'FAILED', failure_reason = :error
    ↓
UPDATE idempotency_keys SET status = 'COMPLETED',
       response = { error: 'INSUFFICIENT_FUNDS', ... }
```

The client retrying with the same idempotency key now gets the stored `FAILED` response immediately — no double attempt.

### Deadlock Prevention: Why Lock in Sorted Order?

```
Thread A: transfer Alice → Bob
  → tries to lock Alice first, then Bob

Thread B: transfer Bob → Alice
  → tries to lock Bob first, then Alice

Without ordering:
  Thread A locks Alice → waits for Bob
  Thread B locks Bob   → waits for Alice   ← DEADLOCK

With sorted order (lock lower UUID first):
  Assume Alice.id < Bob.id
  Thread A: locks Alice, then Bob  → completes
  Thread B: tries to lock Alice    → blocks (A has it)
                                   → waits → A finishes → B proceeds
```

Always acquire multiple locks in a globally consistent order. This eliminates the circular wait condition that causes deadlocks.

---

## QR Payment Algorithm — Step by Step

### Generating a Dynamic QR (Merchant / System side)

```
Input: { merchantId, amount, currency }

Step 1 — Generate token
  token = UUID v4

Step 2 — Store in Redis (primary runtime store)
  SET qr:{token} JSON({ merchantId, amount, currency, status: "PENDING" })
  EXPIREAT qr:{token} now() + 300   ← 5-minute TTL

Step 3 — Persist to DB for audit
  INSERT INTO qr_codes (token, merchant_id, amount, currency, type='DYNAMIC',
                        status='PENDING', expires_at=now()+5min)

Step 4 — Return QR string to merchant
  "grabpay://pay?token={token}&currency=MYR"
```

### User Scans and Pays

```
Input: { userId, qrToken, amount? }   ← amount only if QR was dynamic

Step 1 — Fetch QR info from Redis
  qrData = GET qr:{qrToken}
  IF not found → return 404 (QR expired or invalid)
  IF qrData.status == "COMPLETED" → return 409 (QR already used)

Step 2 — Atomic claim (prevent double-pay on same QR)
  result = SET qr:{qrToken}:lock {userId} NX PX 30000
  IF result == nil → return 409 (another payment in progress for this QR)

Step 3 — Idempotency check (standard flow)
  idempotencyKey = "qr_pay:" + qrToken + ":" + userId
  Check idempotency_keys → if COMPLETED → return cached response

Step 4 — Execute payment (same ACID transfer as P2P)
  BEGIN
    SELECT wallets WHERE id IN (userWallet, merchantWallet) FOR UPDATE (sorted)
    VALIDATE userWallet.balance >= amount
    UPDATE wallets (debit user, credit merchant)
    INSERT ledger_entries (debit + credit pair)
    UPDATE qr_codes SET status='COMPLETED', claimed_by=userId, completed_at=now()
    UPDATE transactions SET status='COMPLETED'
  COMMIT

Step 5 — Update Redis
  SET qr:{qrToken} status="COMPLETED"
  DEL qr:{qrToken}:lock            ← release claim lock
  INCRBY points:{userId} {earnedPoints}   ← async points update

Step 6 — Complete idempotency key
  UPDATE idempotency_keys SET status='COMPLETED', response=...

Step 7 — Publish events (async, via Kafka)
  - payment.completed → GrabPoints Service (award points)
  - payment.completed → Notification Service (push to user + merchant)
```

### Failure Path

```
If Step 4 (DB transaction) fails:
  - ROLLBACK (DB undoes all changes automatically)
  - DEL qr:{qrToken}:lock    ← must manually release Redis lock
  - qr_codes.status stays PENDING in DB (can retry)
  - UPDATE idempotency_keys SET status='FAILED'

If server crashes after Step 4 COMMIT but before Step 5:
  - Redis still has the lock, but it auto-expires in 30s
  - qr_codes.status = COMPLETED in DB
  - User retries → idempotency key returns COMPLETED → no double charge
  - Background job syncs Redis qr status from DB for stale tokens
```

---

## Service Payment Consumer (Grab Ride / Food / Mart)

This Kafka consumer runs in the Payment Service. It listens for service completion events and auto-deducts the user's wallet.

### Consumer Logic

```
Kafka Topic: grab.service.completed
Consumer Group: payment-service-consumer

For each event received:

Step 1 — Parse event
  event = { eventId, eventType, serviceOrderId, userId, amount, currency }

Step 2 — Build idempotency key
  idempotencyKey = eventType + ":" + serviceOrderId
  // e.g. "TRIP_COMPLETED:trip_abc123"

Step 3 — Check idempotency (same mechanism as transfer flow)
  SELECT * FROM idempotency_keys WHERE key = :idempotencyKey
  IF COMPLETED → log "already processed, skipping" → commit Kafka offset → DONE

Step 4 — Insert idempotency record (IN_PROGRESS)
  INSERT INTO idempotency_keys (key, status='IN_PROGRESS')

Step 5 — Execute payment
  BEGIN
    SELECT wallets WHERE id IN (userWallet, grabPlatformWallet)
      ORDER BY id ASC FOR UPDATE

    IF userWallet.balance < amount:
      → attempt linked card fallback via Payment Processor API
      → IF card also fails → mark FAILED, publish "payment.failed" event
         → STOP (do not commit Kafka offset if we want to retry,
                 OR mark as FAILED and commit — depends on retry policy)

    UPDATE wallets (debit user, credit Grab platform wallet)
    INSERT ledger_entries
    INSERT transactions (type=SERVICE_PAYMENT, status=COMPLETED)
  COMMIT

Step 6 — Mark idempotency COMPLETED
  UPDATE idempotency_keys SET status='COMPLETED', response=...

Step 7 — Publish downstream events
  - payment.completed → GrabPoints Service (award points for eligible service types)
  - payment.completed → Notification Service ("RM 18.50 paid for your GrabCar ride")

Step 8 — Commit Kafka offset
  // Only commit AFTER all above steps succeed
  // If crash before here → event re-delivered → idempotency key prevents double charge
```

### Why Commit Kafka Offset Last?

```
Timeline A — commit offset BEFORE processing:
  Commit offset → crash → event is gone → user never charged
  Result: Grab loses money. Unacceptable.

Timeline B — commit offset AFTER processing:
  Process payment → crash before committing offset
  → Kafka re-delivers event → idempotency check → "already processed, skip"
  → commit offset → done
  Result: No double charge. Safe.
```

**At-least-once delivery + idempotency = exactly-once semantics.**

---

## Idempotency — Implementation Detail

```
Client                    Server                        DB
  │                          │                           │
  │  POST /transfers         │                           │
  │  Idempotency-Key: abc123 │                           │
  │─────────────────────────►│                           │
  │                          │  SELECT idem WHERE key=abc│
  │                          │──────────────────────────►│
  │                          │  ← not found              │
  │                          │  INSERT idem (IN_PROGRESS)│
  │                          │──────────────────────────►│
  │                          │  execute transfer...      │
  │                          │  UPDATE idem (COMPLETED)  │
  │                          │──────────────────────────►│
  │  ← 200 { transactionId } │                           │
  │                          │                           │

  [Network drops. Client retries.]

  │  POST /transfers         │                           │
  │  Idempotency-Key: abc123 │                           │
  │─────────────────────────►│                           │
  │                          │  SELECT idem WHERE key=abc│
  │                          │──────────────────────────►│
  │                          │  ← FOUND (COMPLETED)      │
  │  ← 200 { transactionId } │   return cached response  │
  │  (same response, no dupe)│                           │
```

**Edge Case — Concurrent duplicate requests (same key, two servers):**
```
Server 1 and Server 2 both receive the request simultaneously.

Both do: SELECT ... WHERE key = 'abc123' → both see "not found"
Both try: INSERT INTO idempotency_keys (key, ...)

Only one INSERT succeeds (PRIMARY KEY unique constraint).
The losing server gets a unique violation exception → return 409 to client.
Client retries → by now the winning server has completed → sees COMPLETED → returns cached response.
```

---

## Design Patterns Applied

### 1. Repository Pattern
All DB access goes through typed repository interfaces. Services never write raw SQL directly. This allows swapping the underlying DB or adding caching without changing business logic.

```
TransferService
    → uses WalletRepository  (no SQL knowledge)
    → uses LedgerRepository  (no SQL knowledge)
    → uses TransactionRepository
```

### 2. Unit of Work Pattern
The inner transfer transaction (Step 3) groups all DB writes into a single atomic unit. If any write fails, all writes roll back together. The `UnitOfWork` object is passed through the call and commits/rolls back at the end.

```
unitOfWork.begin()
  walletRepo.updateBalance(sender, ...)   ← within same txn
  walletRepo.updateBalance(recipient, ...) ← within same txn
  ledgerRepo.appendEntries(...)           ← within same txn
  transactionRepo.updateStatus(...)       ← within same txn
unitOfWork.commit()  // or rollback on exception
```

### 3. Idempotency Filter (Decorator Pattern)
Wrap any command handler with an idempotency check. The handler doesn't know about idempotency — the decorator intercepts, checks the key, and either short-circuits or delegates:

```
IdempotencyDecorator.execute(key, handler):
  if cached(key) → return cached result
  result = handler.execute()
  cache(key, result)
  return result
```

### 4. Append-Only Ledger (Event Sourcing Light)
The `ledger_entries` table is an immutable event log. You can always reconstruct wallet balance by replaying entries. This is a simplified version of Event Sourcing — the ledger is the source of truth, the `wallet.balance` is a derived projection.

---

## Error Handling & Edge Cases

| Scenario | Detection | Response |
|---|---|---|
| Insufficient funds (transfer/QR) | `balance < amount` check after `SELECT FOR UPDATE` | 422 `INSUFFICIENT_FUNDS`; if service payment → attempt linked card fallback |
| Duplicate request | Idempotency key found in COMPLETED state | 200 with cached original response |
| Concurrent duplicate | Unique constraint violation on INSERT | 409 Conflict — client retries after short backoff |
| Recipient wallet not found | FK reference missing | 404, transaction set to FAILED |
| DB crash mid-transfer | ROLLBACK by DB; transaction stays PENDING | Background job detects stale PENDING transactions (> 2 min) and marks FAILED |
| Deadlock | DB returns deadlock error | Retry up to 3 times with exponential backoff, then FAILED |
| Amount = 0 | `CHECK (amount > 0)` constraint | 400 Bad Request before any DB write |
| Balance goes negative | `CHECK (balance >= 0)` constraint | DB rejects UPDATE, triggers ROLLBACK |
| QR already claimed | `qr:{token}:lock` exists in Redis (SETNX returns nil) | 409 `QR_IN_USE` — another payment is in progress |
| QR expired | Redis key `qr:{token}` missing (TTL elapsed) | 404 `QR_EXPIRED` — user must ask merchant to regenerate |
| QR already completed | `qr.status = COMPLETED` in Redis | 409 `QR_ALREADY_USED` — show user the completed transaction |
| Ride service payment fails | User wallet insufficient + no linked card | Publish `payment.failed` event; ride app shows "outstanding balance" prompt; block future rides |
| Kafka consumer crash mid-payment | Offset not committed → event re-delivered | Idempotency key prevents double charge; consumer retries cleanly |
| GrabPoints service down | Points Kafka consumer fails | Payment already committed; points retried from Kafka independently (eventual consistency) |
| Biller API down (bill pay) | Timeout / 5xx from biller | Wallet debited; payment queued for retry; compensating refund after 24h of failure |

### Stale PENDING Recovery Job

```
-- Runs every 60 seconds
SELECT * FROM transactions
WHERE status = 'PENDING'
  AND created_at < now() - INTERVAL '2 minutes';

For each stale transaction:
  If sender balance was not debited → mark FAILED (no money moved)
  If sender was debited but recipient not credited → trigger saga compensation
```

---

## Sequence Diagram — QR Payment Flow

```
User App       QR Service      Payment Service     Redis         DB (Postgres)   Kafka
  │                │                  │               │                │            │
  │ scan QR token  │                  │               │                │            │
  │───────────────►│                  │               │                │            │
  │                │  GET qr:{token}  │               │                │            │
  │                │─────────────────────────────────►│                │            │
  │                │  ← {merchant,amt,PENDING}         │                │            │
  │  show confirm  │                  │               │                │            │
  │◄───────────────│                  │               │                │            │
  │  tap "Pay"     │                  │               │                │            │
  │───────────────────────────────────────────────────────────────────►│            │
  │                │  SETNX qr:{t}:lock               │                │            │
  │                │─────────────────────────────────►│                │            │
  │                │  ← OK (claimed)                  │                │            │
  │                │  check idem key                  │                │            │
  │                │──────────────────────────────────────────────────►│            │
  │                │  ← not found                     │                │            │
  │                │  INSERT idem (IN_PROGRESS)        │               │            │
  │                │──────────────────────────────────────────────────►│            │
  │                │  BEGIN TXN                        │               │            │
  │                │  SELECT wallets FOR UPDATE         │               │            │
  │                │──────────────────────────────────────────────────►│            │
  │                │  UPDATE balances + ledger          │               │            │
  │                │  UPDATE qr_codes COMPLETED         │               │            │
  │                │  COMMIT                            │               │            │
  │                │──────────────────────────────────────────────────►│            │
  │                │  SET qr:{token} COMPLETED          │               │            │
  │                │  DEL qr:{token}:lock               │               │            │
  │                │  INCRBY points:{userId}            │               │            │
  │                │─────────────────────────────────►│                │            │
  │                │  UPDATE idem COMPLETED             │               │            │
  │                │──────────────────────────────────────────────────►│            │
  │                │  publish payment.completed         │               │            │
  │                │─────────────────────────────────────────────────────────────►  │
  │  ← success     │                  │               │                │            │
  │  "Paid RM18.50 │                  │               │                │            │
  │  to Merchant"  │                  │               │                │            │
```

## Sequence Diagram — Service Payment (Ride Auto-Deduction)

```
Ride Service    Kafka           Payment Consumer     DB (Postgres)   Notification
     │            │                    │                  │               │
     │  trip ends │                    │                  │               │
     │  publish   │                    │                  │               │
     │  TRIP_COMPLETED                 │                  │               │
     │───────────►│                    │                  │               │
     │            │  consume event     │                  │               │
     │            │───────────────────►│                  │               │
     │            │                    │  check idem key  │               │
     │            │                    │─────────────────►│               │
     │            │                    │  ← not found     │               │
     │            │                    │  INSERT idem     │               │
     │            │                    │─────────────────►│               │
     │            │                    │  BEGIN TXN       │               │
     │            │                    │  SELECT wallets  │               │
     │            │                    │  FOR UPDATE      │               │
     │            │                    │─────────────────►│               │
     │            │                    │  UPDATE balances │               │
     │            │                    │  INSERT ledger   │               │
     │            │                    │  INSERT txn      │               │
     │            │                    │  COMMIT          │               │
     │            │                    │─────────────────►│               │
     │            │                    │  UPDATE idem COMPLETED           │
     │            │                    │─────────────────►│               │
     │            │                    │  publish payment.completed       │
     │            │◄───────────────────│                  │               │
     │            │                    │  COMMIT offset   │               │
     │            │◄───────────────────│                  │               │
     │            │                    │    Notification consumer         │
     │            │────────────────────────────────────────────────────► │
     │            │                    │          "RM 18.50 paid for ride"│
```

## Sequence Diagram — Full Transfer Flow

```
Client          API Gateway      TransferService     DB (Postgres)    Redis
  │                  │                  │                  │             │
  │  POST /transfer  │                  │                  │             │
  │─────────────────►│                  │                  │             │
  │                  │  validate JWT    │                  │             │
  │                  │─────────────────►│                  │             │
  │                  │                  │  check idem key  │             │
  │                  │                  │─────────────────►│             │
  │                  │                  │  ← not found     │             │
  │                  │                  │  INSERT idem     │             │
  │                  │                  │─────────────────►│             │
  │                  │                  │  INSERT txn PEND │             │
  │                  │                  │─────────────────►│             │
  │                  │                  │  BEGIN           │             │
  │                  │                  │  SELECT FOR UPD  │             │
  │                  │                  │─────────────────►│             │
  │                  │                  │  ← wallets locked│             │
  │                  │                  │  UPDATE balances │             │
  │                  │                  │─────────────────►│             │
  │                  │                  │  INSERT ledger×2 │             │
  │                  │                  │─────────────────►│             │
  │                  │                  │  UPDATE txn COMP │             │
  │                  │                  │─────────────────►│             │
  │                  │                  │  COMMIT          │             │
  │                  │                  │─────────────────►│             │
  │                  │                  │  UPDATE idem COMP│             │
  │                  │                  │─────────────────►│             │
  │                  │                  │  INVALIDATE cache│             │
  │                  │                  │─────────────────────────────►  │
  │  ← 200 { txnId } │                  │                  │             │
  │◄─────────────────│                  │                  │             │
```

---

## Reconciliation Service (Background)

The reconciliation service is the safety net that catches any discrepancies between the ledger and the wallet balances.

```
Runs nightly (or every hour in high-volume systems):

SELECT w.id, w.balance AS stored_balance,
       COALESCE(SUM(l.amount), 0) AS ledger_balance
FROM wallets w
LEFT JOIN ledger_entries l ON l.account_id = w.id
GROUP BY w.id
HAVING w.balance != COALESCE(SUM(l.amount), 0);

If any rows returned:
  → alert on-call engineering
  → log discrepancy with full context
  → DO NOT auto-correct (human review required for financial discrepancies)
```

---

## What You Learned — Applied Elsewhere

| Pattern | Used For Here | Apply It To |
|---|---|---|
| `SELECT FOR UPDATE` in deterministic order | Prevents deadlock on dual wallet lock | Any multi-row lock scenario: escrow, inventory swap, seat booking |
| `CHECK (balance >= 0)` at DB layer | Defense-in-depth against negative balance bugs | Any domain invariant that must never be violated: stock ≥ 0, quantity ≥ 1 |
| `NUMERIC(19,4)` not `FLOAT` | Exact decimal arithmetic for money | Any financial, scientific, or precision measurement system |
| Idempotency key + unique constraint | Catch duplicate requests at DB level | Payment APIs, email send, push notification, webhook emission |
| Append-only ledger | Immutable audit trail | Activity logs, change history, GDPR right-to-erasure audit, blockchain-style integrity |
| `balance_after` snapshot in ledger | Point-in-time balance reconstruction | Any event log where you want fast time-travel queries |
| Stale PENDING recovery job | Detect half-complete operations after crash | Order processing, saga orchestration, distributed job queues |
| Reconciliation service | Detect logic bugs in financial calculations | Any system where two representations of the same data must agree |
| Sorted lock acquisition | Eliminate circular wait / deadlock | Any multi-resource locking scenario in concurrent systems |
| Repository + Unit of Work | Clean separation of business logic from persistence | Any domain-driven service: order service, inventory, booking engine |
| Redis SETNX for QR claim | Only one user can claim a dynamic QR | One-time tokens: promo codes, invite links, single-use download URLs |
| QR TTL in Redis | QR auto-expires without a cleanup job | Any time-bounded resource: OTPs, price locks, session tokens |
| At-least-once + idempotency | Kafka re-delivery becomes safe with idempotency key | Any Kafka/SQS consumer: email sender, order processor, invoice generator |
| Commit offset after processing | Guarantees no missed events even after crash | Any event-driven payment, fulfillment, or notification consumer |
| Async GrabPoints ledger | Rewards eventually consistent, payment immediately consistent | Loyalty systems, achievement badges, notification delivery receipts |
| Linked card fallback | Wallet insufficient → charge card automatically | Any system with tiered payment methods: primary fails → secondary |
| Separate points ledger | Track non-monetary balance with same double-entry model | Credits, tokens, XP, loyalty miles — any virtual currency in an app |
