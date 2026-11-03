# Cursors & Batch Processing

### The Problem
- Sometimes a query returns **a huge number of rows** (millions), or you must process rows **one at a time** with logic SQL can't express easily.
- If you load everything at once, the app **runs out of memory**, and a single giant `UPDATE`/`DELETE` can **lock the table for minutes**, bloat logs and cause replication lag.

```
SELECT * FROM events;            -- 50 million rows
App: loads all rows into memory ──► OutOfMemoryError / swap / crash 💥

DELETE FROM events WHERE created_at < '2025-01-01';   -- 30 million rows
DB : one giant transaction, huge undo/WAL, long locks, replicas fall behind 💥
```

### What It Solves
- **Cursors** read a big result **piece by piece** (a few rows at a time) instead of all at once. Think of reading a book page by page instead of memorizing the whole book.
- **Batching** splits big writes into small chunks so each transaction is short and safe.
- Together they let you process any amount of data with **constant memory** and **small locks**.

### How It Works

#### 1. What is a cursor?
A cursor is a **pointer** to the current position in a query result. You `FETCH` rows from it, then move forward.
```
Result set (conceptually, 1,000,000 rows)
┌─────────────────────────────────────────────┐
│ r1 r2 r3 r4 r5 r6 ... r1000000              │
└─────────────────────────────────────────────┘
        ▲
      cursor  ── FETCH 3 ──► gives r1, r2, r3, cursor moves ──► ▲ at r4
                 FETCH 3 ──► gives r4, r5, r6, cursor moves ...
```
Three places cursors appear:
| Kind | Where | Used for |
|---|---|---|
| **Server-side SQL cursor** | `DECLARE ... CURSOR` in a stored procedure | Row-by-row logic inside the database |
| **Driver-level streaming/cursor** | JDBC fetch size, PDO unbuffered queries | App reads a big result in chunks |
| **Keyset (cursor) pagination** | `WHERE id > :last_id` | APIs/pages (a "logical" cursor; not a DB cursor object) |

---

#### 2. Server-side cursor in a stored procedure
Lifecycle: **DECLARE → OPEN → FETCH (loop) → CLOSE**.
```sql
-- MySQL: give a 5% raise one employee at a time, with a rule that depends on each row
DELIMITER //
CREATE PROCEDURE raise_salaries()
BEGIN
    DECLARE done INT DEFAULT FALSE;
    DECLARE v_id INT;
    DECLARE v_salary INT;

    -- 1. DECLARE: define the query (not run yet)
    DECLARE cur CURSOR FOR SELECT id, salary FROM employees WHERE active = 1;
    -- Handler: when FETCH has no more rows, set done = TRUE
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    OPEN cur;                               -- 2. OPEN: run the query, cursor sits before the first row

    read_loop: LOOP
        FETCH cur INTO v_id, v_salary;      -- 3. FETCH: get next row into variables
        IF done THEN LEAVE read_loop; END IF;

        -- Row-by-row logic
        IF v_salary < 3000 THEN
            UPDATE employees SET salary = v_salary * 1.10 WHERE id = v_id;   -- 10% for low pay
        ELSE
            UPDATE employees SET salary = v_salary * 1.05 WHERE id = v_id;   -- 5% for others
        END IF;
    END LOOP;

    CLOSE cur;                              -- 4. CLOSE: free resources
END //
DELIMITER ;
```
```sql
-- PostgreSQL (PL/pgSQL): a FOR loop is a simpler "implicit cursor"
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN SELECT id, salary FROM employees WHERE active LOOP     -- loops row by row
        UPDATE employees SET salary = r.salary * CASE WHEN r.salary < 3000 THEN 1.10 ELSE 1.05 END
        WHERE id = r.id;
    END LOOP;
END $$;
```

**The big warning: cursors are slow (row-by-row = "RBAR": Row By Agonizing Row).**
```
Set-based (one statement):  UPDATE employees SET salary = salary * CASE WHEN salary < 3000 THEN 1.10 ELSE 1.05 END WHERE active = 1;
Cursor loop:                1 UPDATE per row, 1,000,000 round trips inside the engine
```
The database is built to work on **whole sets** with optimized plans. Same result, but set-based is often **10–1000× faster**.

| Use a cursor when... | Use a set-based statement when... |
|---|---|
| Logic per row is truly sequential (depends on previous row's result) | You can express it with `CASE`, joins, window functions |
| Each row must call something non-SQL (send a message, call a procedure) | Updating / inserting / deleting many rows |
| Rare admin/migration scripts | Anything performance-sensitive |

Often a window function (`LAG`, running total) or a recursive CTE replaces a cursor (see [Window Functions](Data-and-Persistence/advanced-sql/window-functions)).

Cursor options (concepts): forward-only vs scrollable, read-only vs updatable, `WITH HOLD` (survives commit; PostgreSQL), insensitive (snapshot) vs sensitive (sees changes). A cursor usually holds resources/snapshot, so keep it short-lived.

---

#### 3. Streaming a big result in the application
By default drivers often **load the entire result into memory**. Turn on streaming/cursor mode.

**Java (JDBC)**
```java
// PostgreSQL: needs autocommit OFF + a fetch size to use a real server-side cursor
conn.setAutoCommit(false);
try (PreparedStatement ps = conn.prepareStatement("SELECT id, payload FROM events")) {
    ps.setFetchSize(1000);                  // fetch 1000 rows per network round trip, keep ~1000 in memory
    try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
            process(rs.getLong("id"), rs.getString("payload"));   // memory stays flat
        }
    }
}
conn.commit();
// MySQL Connector/J: ps.setFetchSize(Integer.MIN_VALUE) streams row by row (or useCursorFetch=true with a positive size)
```
**PHP (PDO)**
```php
// MySQL: by default PDO buffers the whole result in PHP memory. Turn buffering off to stream.
$pdo->setAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY, false);
$stmt = $pdo->query('SELECT id, payload FROM events');
while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {     // one row at a time from the server
    process($row);
}
// While streaming, you cannot run another query on the same connection until this one is fully read/closed.
// PostgreSQL via PDO: use a real cursor with DECLARE ... CURSOR + FETCH 1000 inside a transaction.
```
```
Memory use:   load all → ████████████████████████ (grows with rows)
              streaming → ██ (constant)
```
**Caveats:** the connection (and often a transaction/snapshot) stays busy until you finish; a long-running streaming read holds an MVCC snapshot (blocks vacuum, see [MVCC & Storage Internals](Data-and-Persistence/advanced-sql/mvcc-and-storage-internals)). For very long jobs, prefer keyset batching (below).

---

#### 4. Keyset (cursor) batching — the robust way
Instead of a database cursor, repeatedly read the **next chunk** after the last ID you saw. Each chunk is a short, independent query. Safe to stop and restart.

```sql
-- First batch
SELECT id, payload FROM events WHERE id > 0        ORDER BY id LIMIT 1000;
-- Last id returned was 1000 → next batch
SELECT id, payload FROM events WHERE id > 1000     ORDER BY id LIMIT 1000;
-- ... repeat until fewer than 1000 rows come back
```
```
Batch 1: ids   1..1000   ─ remember last = 1000
Batch 2: ids 1001..2000   ─ remember last = 2000    (index seek each time = fast)
```
**Why not `OFFSET`?** `LIMIT 1000 OFFSET 5000000` makes the database read and throw away 5,000,000 rows first. Each page gets slower; keyset stays fast (O(log n) seek).
```
OFFSET page 1: reads 1,000    OFFSET page 5000: reads 5,000,000 (throws away 4,999,000)
KEYSET every page: seeks via index, reads 1,000
```
For a non-unique sort column use a tie-breaker: `WHERE (created_at, id) > (:last_created, :last_id) ORDER BY created_at, id`.

---

#### 5. Batched writes (updates / deletes / inserts)
**Rule:** keep each transaction **small** (hundreds to a few thousand rows) and **commit often**.

**Batch delete (old data cleanup):**
```sql
-- Run repeatedly until it affects 0 rows. Each run is a short transaction.
DELETE FROM events
WHERE created_at < '2025-01-01'
ORDER BY id            -- MySQL: allows ORDER BY/LIMIT on DELETE
LIMIT 5000;            -- PostgreSQL: DELETE ... WHERE id IN (SELECT id FROM events WHERE ... LIMIT 5000)
```
```java
// Java loop: delete in chunks, pause briefly so replicas and other queries can breathe
int deleted;
do {
    try (PreparedStatement ps = conn.prepareStatement(
            "DELETE FROM events WHERE created_at < ? LIMIT 5000")) {
        ps.setDate(1, java.sql.Date.valueOf("2025-01-01"));
        deleted = ps.executeUpdate();        // rows removed in this chunk
        conn.commit();                       // end the transaction → locks released
    }
    Thread.sleep(100);                       // small pause = gentler on the server
} while (deleted > 0);
```
```php
// PHP: same idea
do {
    $deleted = $pdo->exec("DELETE FROM events WHERE created_at < '2025-01-01' LIMIT 5000");
    usleep(100000);                          // 100 ms pause between chunks
} while ($deleted > 0);
```

**Batch insert:** many rows per statement or per round trip.
```sql
-- 1 statement, 3 rows (much faster than 3 separate INSERTs: fewer round trips and commits)
INSERT INTO events (type, payload) VALUES ('a','x'), ('b','y'), ('c','z');
```
```java
// JDBC batching: queue many rows, send them together
conn.setAutoCommit(false);
try (PreparedStatement ps = conn.prepareStatement("INSERT INTO events (type, payload) VALUES (?, ?)")) {
    int count = 0;
    for (Event e : events) {
        ps.setString(1, e.type());
        ps.setString(2, e.payload());
        ps.addBatch();                          // add to the batch (not sent yet)
        if (++count % 1000 == 0) {
            ps.executeBatch();                  // send 1000 rows in one go
            conn.commit();
        }
    }
    ps.executeBatch();                          // send the remainder
    conn.commit();
}
// MySQL: add rewriteBatchedStatements=true to the JDBC URL for real multi-row inserts.
```
**Bulk loading** (fastest for millions of rows): `COPY` (PostgreSQL), `LOAD DATA INFILE` (MySQL). These bypass much per-row overhead.
```sql
COPY events (type, payload) FROM '/data/events.csv' WITH (FORMAT csv, HEADER true);   -- PostgreSQL
LOAD DATA INFILE '/data/events.csv' INTO TABLE events FIELDS TERMINATED BY ',' IGNORE 1 LINES;  -- MySQL
```
Tip for huge loads: load into a table with **no secondary indexes**, then create the indexes afterward (much faster than updating them per row).

**Choosing batch size**
```
Time per row
   ▲
   │ \
   │  \__                  ______   <- very large batches: locks, memory, long rollback
   │     '--._____--------'
   └──────────────────────────────► batch size
   1      100   1000-5000   100000
Start around 1,000–5,000 rows and measure.
```

---

#### 6. Making batch jobs safe
| Practice | Why |
|---|---|
| **Idempotent**: safe to run again after a crash | Jobs fail midway; reruns must not duplicate effects |
| **Checkpoint progress** (store `last_id` in a table) | Resume where you stopped instead of restarting |
| **Small transactions** | Short locks, small rollback, less replication lag |
| **Throttle** (sleep, or watch replica lag) | Don't hurt production traffic |
| **Run off-peak** | Less contention |
| **Dry run first** (`SELECT COUNT(*)` with the same `WHERE`) | Avoid deleting the wrong rows |
| **Process in id order using an index** | Predictable and fast |

```sql
-- Progress table for a resumable job
CREATE TABLE job_progress (job_name VARCHAR(50) PRIMARY KEY, last_id BIGINT NOT NULL);
-- At the end of each batch (same transaction as the work):
UPDATE job_progress SET last_id = :max_id_in_batch WHERE job_name = 'recalc_totals';
```

### Time & Space Complexity
| Approach | Time | Memory |
|---|---|---|
| Load whole result | O(n) | **O(n)** ✖ can crash |
| Streaming cursor / fetch size | O(n) | **O(batch size)** ✔ |
| `OFFSET` pagination (page k) | O(k · page size) per page → O(n²/size) over all pages | small |
| Keyset batching | O(log n + size) per batch → O(n) total | small |
| Row-by-row cursor in SQL | O(n) statements (high constant) | small |
| Set-based statement | O(n), optimized, one pass | depends on plan |
| Batched writes | O(n) total; per-batch locks/undo bounded by batch size | O(batch) |

### Alternatives
| Need | Option |
|---|---|
| Per-row logic | Window functions, recursive CTEs, `CASE` |
| Huge ETL | Dedicated tools (Spark, dbt), bulk `COPY` |
| Ongoing processing | Queue (`SKIP LOCKED`, see [Locking & Deadlocks](Data-and-Persistence/advanced-sql/locking-and-deadlocks)) or message broker |
| API pagination | Keyset pagination with opaque cursor tokens |
| Partitioned tables | `DROP PARTITION` instead of deleting millions of rows (instant) — see [Partitioning & Sharding](Data-and-Persistence/advanced-sql/partitioning-and-sharding) |

### Common Mistakes
- Using a cursor loop for something one `UPDATE` can do.
- Fetching millions of rows into memory (forgetting fetch size / unbuffered mode).
- `OFFSET` paging over big tables.
- One enormous `DELETE`/`UPDATE` in a single transaction.
- Keeping a streaming cursor (and its transaction) open for hours.
- Running other queries on a connection that is still streaming (PHP unbuffered).
- No resume point: a failure at 90% means starting over.

### Quick Interview Answers
- **What is a cursor?** A pointer into a query result that lets you fetch rows incrementally (DECLARE, OPEN, FETCH, CLOSE).
- **Why avoid cursors?** Row-by-row processing is far slower than set-based SQL and holds resources open.
- **How do you delete 50 million rows safely?** In small batches with short transactions (or drop a partition), with throttling and progress tracking.
- **OFFSET vs keyset pagination?** OFFSET re-reads and discards skipped rows (slows with depth); keyset seeks via index after the last seen key and stays fast.
- **How do you avoid out-of-memory when reading big results?** Stream with a fetch size/unbuffered query, or process with keyset batches.
