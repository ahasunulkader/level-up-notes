# Locking, Deadlocks & Upsert

### The Problem
- Many users hit the database **at the same time**. If two of them change the same row together, one can silently overwrite the other. This is called a **lost update** or a **race condition**.
- If we solve it by making people wait (locks), a new problem appears: two transactions can end up **waiting for each other forever**. This is a **deadlock**.

**Lost update — a story with a bank balance (balance = 100):**
```
Time   Transaction A (withdraw 30)        Transaction B (withdraw 50)
----   ---------------------------        ---------------------------
 t1    READ balance  -> 100
 t2                                       READ balance  -> 100
 t3    WRITE balance = 100 - 30 = 70
 t4                                       WRITE balance = 100 - 50 = 50   <- overwrites A!
 t5    Final balance = 50   (should be 20!)  A's withdrawal is LOST
```

### What It Solves
- **Locks** make a transaction "reserve" the data it is using. Others must wait until it finishes, so changes happen one after another and nothing is lost.
- There are two main styles:
  - **Pessimistic locking** — "Conflicts will happen, so lock first." Safe but others wait.
  - **Optimistic locking** — "Conflicts are rare, so do not lock; just check at the end that nobody changed it." Fast but you must retry on conflict.
- **Deadlock handling** (ordering, short transactions, retries) keeps waiting from turning into a permanent freeze.
- **Upsert** (insert-or-update in one atomic statement) removes the classic "check then insert" race.

### How It Works

#### 1. Lock types (the basics)

| Lock | Short name | Meaning | Who can share it? |
|---|---|---|---|
| **Shared lock** | S lock / read lock | "I'm reading this. Please don't change it." | Many readers can hold it together |
| **Exclusive lock** | X lock / write lock | "I'm changing this. Stay away." | Only one holder, nobody else can read-lock or write-lock |

**Compatibility table — can the second request proceed?**
```
                       Second request
                    +----------+-----------+
 First holder       | S (read) | X (write) |
+-------------------+----------+-----------+
| S (read)          |   YES    |    WAIT   |
| X (write)         |   WAIT   |    WAIT   |
+-------------------+----------+-----------+
Readers can share. A writer needs to be alone.
```

**Lock granularity — how much is locked?**
```
Table lock      [ ████████████████████████ ]   whole table locked   (simple, blocks everyone)
Page lock       [ ████████ ........ ....... ]   one page locked
Row lock        [ .. ██ ................... ]   one row locked      (best concurrency, InnoDB / Postgres default)
```
Smaller lock = more users work in parallel, but the database must keep track of more locks.

---

#### 2. Pessimistic locking — `SELECT ... FOR UPDATE`
**Idea:** read the row and lock it in one step. Anyone else who wants to change (or lock) it must wait until you `COMMIT` or `ROLLBACK`.

```sql
START TRANSACTION;

-- Lock the row. Any other transaction doing FOR UPDATE / UPDATE on id=1 now waits here.
SELECT balance FROM accounts WHERE id = 1 FOR UPDATE;

-- Safe to calculate: nobody can change this row until we finish.
UPDATE accounts SET balance = balance - 30 WHERE id = 1;

COMMIT;   -- lock released here
```

**The same race, now fixed:**
```
Time   Transaction A                       Transaction B
 t1    SELECT ... FOR UPDATE  (got lock)
 t2                                        SELECT ... FOR UPDATE  -> WAITS (blocked)
 t3    balance = 100 - 30 = 70
 t4    COMMIT (lock released)
 t5                                        (wakes up) reads 70
 t6                                        balance = 70 - 50 = 20     <- correct!
 t7                                        COMMIT
```

**Useful variants:**

| Syntax | What it does | Typical use |
|---|---|---|
| `FOR UPDATE` | Exclusive lock on selected rows | Read-then-modify (transfers, stock) |
| `FOR SHARE` (PG) / `LOCK IN SHARE MODE` (MySQL) | Shared lock: others may read, nobody may change | "Make sure this parent row isn't deleted while I add a child" |
| `FOR UPDATE NOWAIT` | Don't wait; **fail immediately** if locked | Return "busy, try again" to the user |
| `FOR UPDATE SKIP LOCKED` | Skip rows that are already locked | **Job queues** — many workers each grab different jobs |

**Job queue with `SKIP LOCKED` (very practical):**
```sql
-- Many workers run this at the same time. Each one gets a DIFFERENT job; nobody waits.
START TRANSACTION;

SELECT id, payload
FROM jobs
WHERE status = 'pending'
ORDER BY id
LIMIT 1
FOR UPDATE SKIP LOCKED;       -- rows locked by other workers are simply skipped

UPDATE jobs SET status = 'running' WHERE id = :picked_id;   -- :picked_id = id returned above
COMMIT;
```
```
Worker 1 -> locks job 1  \
Worker 2 -> skips 1, locks job 2   >  all work in parallel, no waiting, no duplicate work
Worker 3 -> skips 1,2, locks job 3 /
```

> **Important:** `FOR UPDATE` only works **inside a transaction** (autocommit off). In autocommit mode the lock is released immediately after the statement.

**Gap/next-key locks (MySQL InnoDB):** in `REPEATABLE READ`, `FOR UPDATE` on a *range* also locks the "gaps" between index values so nobody can insert a new row into the range (this prevents phantom reads). Side effect: unrelated inserts into that range can block.

---

#### 3. Optimistic locking — version column
**Idea:** don't hold a lock while the user thinks. Add a `version` column. When saving, say "update only if the version is still what I read". If someone else changed it, 0 rows are updated and you know there was a conflict.

```sql
CREATE TABLE products (
    id      INT PRIMARY KEY,
    stock   INT,
    version INT NOT NULL DEFAULT 0     -- increases by 1 on every change
);
```

```sql
-- Step 1: read (no lock). Say we get stock=10, version=3
SELECT stock, version FROM products WHERE id = 7;

-- Step 2: save only if nobody changed it since we read it
UPDATE products
SET    stock = 9,
       version = version + 1             -- bump the version
WHERE  id = 7
  AND  version = 3;                      -- the version we saw in step 1

-- Step 3: check how many rows changed
--   1 row  -> success
--   0 rows -> someone else got there first -> re-read and retry (or tell the user)
```

**Visual:**
```
        A reads (v=3)           B reads (v=3)
             |                       |
        A saves: WHERE v=3  -> OK, row becomes v=4
                                     |
                                B saves: WHERE v=3 -> 0 rows!  (row is v=4 now)
                                B re-reads (v=4) and retries
```

| | Pessimistic | Optimistic |
|---|---|---|
| Locks held | Yes, while transaction runs | No |
| Conflict handling | Others **wait** | Loser **retries** |
| Best when | Conflicts are common, work is short | Conflicts are rare, users take long (web forms) |
| Risk | Waiting, deadlocks | Many retries if conflicts are frequent |
| Typical in | Banking transfers, inventory | ORMs (`@Version` in JPA), web edit forms |

---

#### 4. Deadlocks
**What:** Transaction A holds lock 1 and waits for lock 2. Transaction B holds lock 2 and waits for lock 1. Both wait forever.

```
        A holds row 1            B holds row 2
        A wants row 2  ------->  (held by B)
        (held by A)   <-------   B wants row 1

        A --waits for--> B --waits for--> A      A circle = DEADLOCK
```

**Real SQL that deadlocks:**
```sql
-- Transaction A                          -- Transaction B
START TRANSACTION;                        START TRANSACTION;
UPDATE accounts SET balance = balance-10  UPDATE accounts SET balance = balance-10
 WHERE id = 1;     -- locks row 1          WHERE id = 2;     -- locks row 2
UPDATE accounts SET balance = balance+10  UPDATE accounts SET balance = balance+10
 WHERE id = 2;     -- WAITS for B          WHERE id = 1;     -- WAITS for A  => DEADLOCK
```

**What the database does:** it detects the circle (a "wait-for graph" with a cycle), picks one transaction as the **victim**, rolls it back, and returns an error. The other continues.
- MySQL: `ERROR 1213 (40001): Deadlock found when trying to get lock; try restarting transaction`
- PostgreSQL: `ERROR: deadlock detected` (SQLSTATE `40P01`)

**How to prevent deadlocks (the practical checklist):**

| Technique | How | Why it helps |
|---|---|---|
| **Same lock order everywhere** | Always lock the lower id first | No circle can form |
| **Short transactions** | Do slow work (HTTP calls, user input) *outside* the transaction | Locks are held for less time |
| **Lock everything at once** | `SELECT ... WHERE id IN (1,2) ORDER BY id FOR UPDATE` | Acquire all locks in a fixed order up front |
| **Use indexes** | Index the `WHERE` columns | Without an index the DB scans and locks many extra rows |
| **Lower isolation** if safe | `READ COMMITTED` takes fewer gap locks | Less lock overlap |
| **Retry on deadlock** | Catch the error, retry the whole transaction | Deadlocks can never be fully removed, so be ready |

**Fix for the transfer example — lock in id order:**
```sql
-- Both A and B lock the smaller id first, no matter which direction money moves
START TRANSACTION;
SELECT id FROM accounts WHERE id IN (1, 2) ORDER BY id FOR UPDATE;   -- same order for everyone
UPDATE accounts SET balance = balance - 10 WHERE id = 1;
UPDATE accounts SET balance = balance + 10 WHERE id = 2;
COMMIT;
```
```
Now both ask for row 1 first:  A gets it, B waits.  A finishes, B continues.   No circle!
```

**Retry pattern (Java):**
```java
int attempts = 0;
while (true) {
    try {
        transferMoney(conn, 1, 2, 10);   // runs the whole transaction
        break;                            // success -> stop retrying
    } catch (SQLException e) {
        // 40001 = serialization failure / MySQL deadlock, 40P01 = PostgreSQL deadlock
        boolean retryable = "40001".equals(e.getSQLState()) || "40P01".equals(e.getSQLState());
        if (!retryable || ++attempts >= 3) throw e;   // give up after 3 tries
        Thread.sleep(50L * attempts);                  // small growing delay (backoff)
    }
}
```

**Retry pattern (PHP):**
```php
$attempts = 0;
while (true) {
    try {
        $pdo->beginTransaction();
        // ... run the statements ...
        $pdo->commit();
        break;                                   // success
    } catch (PDOException $e) {
        $pdo->rollBack();                        // always clean up
        // 1213 = MySQL deadlock, 40P01 = PostgreSQL deadlock
        $retryable = ($e->errorInfo[1] ?? null) == 1213 || $e->getCode() === '40P01';
        if (!$retryable || ++$attempts >= 3) throw $e;
        usleep(50000 * $attempts);               // wait a bit longer each time
    }
}
```

**How to see what is blocked right now:**
```sql
-- MySQL: last deadlock details + who is waiting
SHOW ENGINE INNODB STATUS;                     -- section "LATEST DETECTED DEADLOCK"
SELECT * FROM performance_schema.data_lock_waits;

-- PostgreSQL: who blocks whom
SELECT pid, pg_blocking_pids(pid) AS blocked_by, query
FROM pg_stat_activity
WHERE cardinality(pg_blocking_pids(pid)) > 0;
```

**Related: lock timeouts.** If a lock is held too long, waiters give up instead of hanging:
```sql
SET innodb_lock_wait_timeout = 5;     -- MySQL: wait max 5 seconds
SET lock_timeout = '5s';              -- PostgreSQL
```

---

#### 5. Advisory locks (application-defined locks)
A lock that is **not tied to any row**. You pick a number/name that means "I'm doing job X".
```sql
-- PostgreSQL: only one process at a time runs the nightly report
SELECT pg_try_advisory_lock(42);   -- returns true if you got it, false if someone else has it
-- ... run the job ...
SELECT pg_advisory_unlock(42);

-- MySQL equivalent
SELECT GET_LOCK('nightly_report', 0);   -- 0 = don't wait
SELECT RELEASE_LOCK('nightly_report');
```
Good for cron jobs that must not run twice, or protecting something that isn't a table row.

---

#### 6. Upsert — insert or update in ONE atomic statement
**Problem:** "If the row exists update it, otherwise insert it." The naive way has a race:
```
App: SELECT ... WHERE email = 'a@x.com'   -> not found
                                             (meanwhile another request inserts the same email)
App: INSERT ... email = 'a@x.com'          -> duplicate key error, or a duplicate row
```
**Solution:** let the database do check + write as a single atomic step (needs a `UNIQUE`/`PRIMARY KEY` constraint to detect "already exists").

```sql
-- Table needs a unique key on what defines "same row"
CREATE TABLE page_views (
    page  VARCHAR(100) PRIMARY KEY,
    views INT NOT NULL
);
```

| Database | Syntax |
|---|---|
| **MySQL** | `INSERT ... ON DUPLICATE KEY UPDATE ...` |
| **PostgreSQL / SQLite** | `INSERT ... ON CONFLICT (col) DO UPDATE SET ...` |
| **SQL Server / Oracle / standard SQL** | `MERGE INTO ... USING ... WHEN MATCHED ... WHEN NOT MATCHED ...` |

```sql
-- MySQL: count a page view. First visit inserts 1; later visits add 1.
INSERT INTO page_views (page, views) VALUES ('/home', 1)
ON DUPLICATE KEY UPDATE views = views + 1;       -- runs when the key already exists

-- PostgreSQL: same thing
INSERT INTO page_views (page, views) VALUES ('/home', 1)
ON CONFLICT (page)                               -- which unique key to watch
DO UPDATE SET views = page_views.views + 1;      -- what to do on conflict

-- PostgreSQL: "insert only if missing, otherwise do nothing"
INSERT INTO page_views (page, views) VALUES ('/home', 1)
ON CONFLICT (page) DO NOTHING;

-- Standard MERGE (SQL Server, Oracle, PostgreSQL 15+)
MERGE INTO page_views t
USING (SELECT '/home' AS page) s
   ON t.page = s.page
WHEN MATCHED     THEN UPDATE SET views = t.views + 1
WHEN NOT MATCHED THEN INSERT (page, views) VALUES (s.page, 1);
```

**What it looks like:**
```
Table has '/home' = 5
INSERT '/home',1  --> key exists --> UPDATE views = 5+1 = 6
INSERT '/blog',1  --> new key    --> INSERT row ('/blog', 1)
Both are done safely, even with 100 requests at once.
```

> **Watch out (MySQL):** `REPLACE INTO` looks similar but it **deletes then inserts**, which changes auto-increment ids, fires delete triggers, and breaks foreign keys. Prefer `ON DUPLICATE KEY UPDATE`.

### Time & Space Complexity
- A lock lookup is **O(1)** (hash table of locks), so locking does not slow down a single statement much.
- The real cost is **waiting time**: with `k` transactions fighting for the same hot row, they run one by one, so total time grows roughly **O(k)** instead of running in parallel. This is called lock contention.
- **Space:** each lock uses a small amount of memory. Locking a million rows (e.g. `UPDATE` without an index) can use a lot of lock memory and may escalate to a table lock.
- Optimistic locking costs one extra column and an extra `WHERE` condition: tiny. But under heavy conflict the **retry rate** grows and wasted work grows with it.
- Deadlock detection walks the wait-for graph, roughly **O(T)** for `T` waiting transactions. It runs only when waiting happens.

### Alternatives
| Problem | Option | Trade-off |
|---|---|---|
| Counter updates | Atomic `UPDATE x = x + 1` | No lock code needed; one SQL statement is already atomic |
| Hot row contention | Split counter into N rows and sum them | More reads, far fewer waits |
| Stronger isolation | `SERIALIZABLE` isolation | DB handles conflicts for you, but you must retry failures |
| Distributed lock | Redis lock / ZooKeeper | Works across many databases, more moving parts |
| Queue workloads | Message broker (Kafka, SQS, RabbitMQ) | Better at scale, extra infrastructure |

### Common Mistakes
- Using `FOR UPDATE` outside a transaction (lock disappears instantly).
- Holding a transaction open while calling an external API or waiting for the user.
- Locking rows in a different order in different code paths.
- Updating without an index on the `WHERE` column, which locks far more rows than expected.
- Not retrying after deadlock errors.
- "SELECT then INSERT" instead of a real upsert.

### Quick Interview Answers
- **Pessimistic vs optimistic?** Pessimistic locks first and makes others wait; optimistic checks a version at save time and retries on conflict.
- **What is a deadlock and how do you avoid it?** A circular wait between transactions. Avoid it with consistent lock order, short transactions, good indexes, and retries.
- **How do multiple workers take jobs from one table?** `SELECT ... FOR UPDATE SKIP LOCKED`.
- **How do you implement insert-or-update safely?** Upsert (`ON DUPLICATE KEY UPDATE` / `ON CONFLICT` / `MERGE`) backed by a unique constraint.
