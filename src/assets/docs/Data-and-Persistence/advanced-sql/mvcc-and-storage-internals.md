# MVCC & Storage Internals

### The Problem
- A database has **many users reading and writing at the same moment**. The old simple solution is "lock the row": readers wait for writers, writers wait for readers.
- That makes everything slow: a long report query could freeze all updates, and a long update could freeze all reports.
- On top of that, the database must **never lose committed data** even if the power goes out in the middle of a write, but writing to disk (random writes) is slow.

```
Locking-only world:
  Report (reads 1M rows, takes 30s)  ──► holds read locks
  Customer places order (UPDATE)     ──► WAITS 30 seconds ✖
```

### What It Solves
- **MVCC (Multi-Version Concurrency Control):** instead of overwriting a row, the database keeps **several versions** of it. Each transaction sees the version that was valid when it started.
  - Result: **readers never block writers, and writers never block readers.**
- **Write-Ahead Log (WAL) + buffer pool:** the database changes pages in fast memory and writes a small sequential log to disk first, so it is both **fast and crash-safe**.
- **Vacuum / purge:** cleans up old row versions so storage does not grow forever.

### How It Works

#### 1. MVCC in a story
Imagine a Google Doc with **version history**. Alice is reading version 5 while Bob saves version 6. Alice keeps seeing version 5 until she refreshes. Nobody waited.

```
Time ──────────────────────────────────────────────────────────►

Row: balance=100 (v1)        UPDATE → balance=70 (v2)        COMMIT at t5

TX A (reader) starts t1 ────────────────────────────────────── ends t8
       sees balance = 100 (snapshot taken at t1) every time ✔

TX B (writer) starts t3: UPDATE balance=70 ... COMMIT t5

TX C (reader) starts t6: sees balance = 70
```
- Readers use a **snapshot**: "show me the database as it was when I started (or when this statement started)."
- Which version is visible depends on the **isolation level**:
  - `READ COMMITTED`: a new snapshot **per statement** (you can see other people's commits between statements).
  - `REPEATABLE READ`: one snapshot **per transaction**.

#### 2. How versions are stored — two designs

**Design A: PostgreSQL — keep old versions right in the table (heap)**
Every row version has two hidden columns:
- `xmin` = ID of the transaction that **created** this version.
- `xmax` = ID of the transaction that **deleted/replaced** it (0 if still alive).

```
UPDATE accounts SET balance = 70 WHERE id = 1;   (done by transaction 105)

Table page BEFORE:
+------+----+---------+------+------+
| ctid | id | balance | xmin | xmax |
+------+----+---------+------+------+
| 0,1  | 1  | 100     | 90   | 0    |   <- live version
+------+----+---------+------+------+

Table page AFTER (UPDATE = mark old dead + insert a NEW row version):
+------+----+---------+------+------+
| 0,1  | 1  | 100     | 90   | 105  |   <- old version: "deleted by 105" (DEAD tuple)
| 0,2  | 1  | 70      | 105  | 0    |   <- new version
+------+----+---------+------+------+
```
A transaction decides what it can see by comparing `xmin`/`xmax` to its snapshot: "was the creator committed before my snapshot, and has the deleter not yet committed?"

You can see these hidden columns:
```sql
SELECT xmin, xmax, ctid, * FROM accounts WHERE id = 1;   -- PostgreSQL
```

**Design B: MySQL InnoDB — keep the newest in the table, old versions in an UNDO log**
```
Table (clustered index):  id=1, balance=70, roll_ptr ─┐
                                                      ▼
Undo log:                 [balance=100 (before change)] ──► [older version] ──► ...
```
A reader that needs an older version follows the `roll_ptr` chain **backwards** through the undo log to rebuild the old row.

| | PostgreSQL | MySQL InnoDB |
|---|---|---|
| Old versions live in | The **table itself** | **Undo log** (separate) |
| UPDATE cost | Writes a whole new row version (+ index entries) | Updates in place, writes undo record |
| Cleanup process | **VACUUM** | **Purge thread** |
| Common problem | **Table bloat** | Long undo chains / history list length |
| Rollback | Cheap (just mark version dead) | Must apply undo records (slower for big transactions) |

#### 3. The garbage problem: dead versions, VACUUM and bloat
Old versions that **no running transaction can see anymore** are garbage. If never cleaned, tables and indexes **bloat** (grow with dead data) and queries slow down.

```
A table with 1,000 live rows, updated 10x each, never vacuumed:

Live rows       [████]
Dead versions   [████████████████████████████████████████]  <- 10,000 dead tuples
Table size is ~10x bigger than needed; scans read all that dead data.
```
**PostgreSQL VACUUM:**
| Command | What it does |
|---|---|
| `VACUUM` | Marks dead space reusable (does NOT shrink the file much), updates visibility map, no heavy lock |
| `VACUUM ANALYZE` | Vacuum + refresh planner statistics |
| `VACUUM FULL` | Rewrites the entire table to give space back to the OS. **Takes an exclusive lock** (blocks reads/writes) |
| **autovacuum** | Background worker that runs vacuum automatically (leave it ON; tune it for busy tables) |

```sql
-- How bloated is it? How many dead tuples?
SELECT relname, n_live_tup, n_dead_tup, last_autovacuum
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC LIMIT 10;

-- Make autovacuum more aggressive on a hot table
ALTER TABLE orders SET (autovacuum_vacuum_scale_factor = 0.02);  -- vacuum after 2% of rows are dead (default 20%)
```
**The #1 cause of bloat: long-running transactions.** An old open transaction still "might need" old versions, so VACUUM **cannot remove them**.
```sql
-- Find old open transactions (PostgreSQL)
SELECT pid, now() - xact_start AS age, state, query
FROM pg_stat_activity
WHERE xact_start IS NOT NULL
ORDER BY xact_start LIMIT 5;
```
**Transaction ID wraparound (PostgreSQL):** transaction IDs are 32-bit numbers (~4 billion). Vacuum also "freezes" very old row versions so IDs can be reused. If vacuum is blocked for too long, PostgreSQL may **stop accepting writes** to protect data. Monitor `age(datfrozenxid)`.

**InnoDB equivalent:** watch the **history list length**; a huge value means purge cannot keep up (often caused by a long transaction).
```sql
SHOW ENGINE INNODB STATUS\G   -- look for "History list length"
```

**HOT updates (PostgreSQL):** if you update a column that is **not indexed** and there is space on the same page, PostgreSQL can do a cheap "Heap-Only Tuple" update without touching indexes. Tip: leave free room with `fillfactor = 80` on frequently updated tables.

#### 4. How data is stored on disk: pages
Databases read and write in fixed-size blocks called **pages** (PostgreSQL 8 KB, InnoDB 16 KB). You can't read "just one row" from disk: you read the whole page containing it.

```
One 8 KB page (PostgreSQL heap page)
┌──────────────────────────────────────────────────────┐
│ Page header                                          │
│ Item pointers: [→row1][→row2][→row3] ...  (grow →)   │
│                                                      │
│               free space                             │
│                                                      │
│  ... [row3 data][row2 data][row1 data]   (grow ←)    │
└──────────────────────────────────────────────────────┘
Pointers grow from the front, rows from the back; they meet when the page is full.
```
**Heap vs clustered storage** (also see the [Indexes](Data-and-Persistence/advanced-sql/indexes) page):
| | Heap (PostgreSQL) | Clustered (InnoDB) |
|---|---|---|
| Rows are stored | In any order | **Sorted by primary key** inside the PK B-tree |
| Secondary index points to | Physical location (`ctid`) | The **primary key** value |

**Big values (TOAST / off-page):** large text/JSON/BLOB values are stored out of the main row (PostgreSQL TOAST, InnoDB overflow pages), so the main page stays small and scans stay fast.

#### 5. Buffer pool (the memory cache)
Disk is ~100–1000× slower than RAM. The database keeps recently used pages in a memory area: **shared_buffers** (PostgreSQL) / **innodb_buffer_pool_size** (MySQL).

```
Query needs page #42
   │
   ├─► in buffer pool? ── YES (cache hit) ──► read from RAM  (microseconds)
   │
   └─► NO (cache miss) ──► read from disk (milliseconds) ──► put in buffer pool
                           (if the pool is full: evict the least recently used page;
                            if that page is "dirty" it must be written to disk first)
```
- **Dirty page** = changed in memory but not yet written to the data file.
- **Hit ratio** = cache hits ÷ total reads. Healthy OLTP systems are usually 99%+.
- Sizing: MySQL commonly 60–75% of RAM on a dedicated server; PostgreSQL ~25% for `shared_buffers` (it also relies on the OS file cache).
```sql
-- PostgreSQL cache hit ratio
SELECT sum(heap_blks_hit) / nullif(sum(heap_blks_hit + heap_blks_read), 0) AS hit_ratio
FROM pg_statio_user_tables;
```

#### 6. Write-Ahead Log (WAL) and crash safety
**Problem:** when you COMMIT, writing every changed page to its random place on disk is slow. But if we only keep changes in RAM and the power fails, **committed data is lost**.

**Solution:** write a small, **sequential** description of the change to a log file first, flush that to disk, and only then say "COMMIT OK". Data pages can be written to disk **later**.

```
UPDATE ... ; COMMIT;
   │
   ├─1─► change the page in the buffer pool (RAM) → page becomes DIRTY
   ├─2─► append "what I changed" to the WAL (sequential write) ──► fsync to disk
   ├─3─► return "COMMIT OK" to the client     (durable! even if the power fails now)
   └─4─► LATER (background) write dirty pages to data files  (checkpoint)
```
**Crash recovery:** on restart, the database **replays the WAL** from the last checkpoint, rebuilding the changes that were in RAM. Nothing committed is lost, and uncommitted changes are discarded.

```
Data files:   page state as of last checkpoint (old)
WAL:          [chg1][chg2][chg3][chg4]  <- after the checkpoint
Crash!   ──►  restart: replay chg1..chg4 onto the data files  → consistent again ✔
```
- **Checkpoint:** a periodic moment when all dirty pages are flushed, so recovery has less log to replay. Frequent checkpoints = faster recovery but more I/O; rare = the opposite.
- **Why sequential writes win:** appending to a log is much faster than random page writes (especially on spinning disks, and still better on SSDs).
- WAL is also what powers **replication** and **point-in-time recovery** (see [Replication, HA & Backup](Data-and-Persistence/advanced-sql/replication-and-high-availability)).
- Setting `synchronous_commit = off` / `innodb_flush_log_at_trx_commit = 2` makes commits faster but may lose the last fraction of a second on crash. The default is safe.

```sql
-- MySQL: 1 = flush log to disk at every commit (safe, default), 2 = flush ~every second
SHOW VARIABLES LIKE 'innodb_flush_log_at_trx_commit';
-- PostgreSQL
SHOW synchronous_commit;
SHOW checkpoint_timeout;
```

#### 7. Putting it all together (one UPDATE)
```
  Client: UPDATE accounts SET balance = 70 WHERE id = 1; COMMIT;
     │
     ▼
 ┌─ Parser/Planner ──► finds row via index
 │
 ├─ Buffer pool: load the page if not cached
 ├─ MVCC: create new row version (PG) / write undo + update in place (InnoDB)
 ├─ WAL/redo log: record the change, flush at COMMIT         ◄── durability
 ├─ Reply "OK"
 │
 └─ Background: checkpointer writes dirty pages ; vacuum/purge removes old versions
```

### Java — seeing MVCC isolation in action
```java
// Two connections demonstrate that a REPEATABLE READ reader keeps its snapshot
Connection reader = ds.getConnection();
reader.setAutoCommit(false);
reader.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);

// 1st read: snapshot is taken here, we see balance = 100
long before = queryBalance(reader);

// Another connection changes and COMMITS the balance to 70 in the meantime
try (Connection writer = ds.getConnection()) {
    writer.createStatement().executeUpdate("UPDATE accounts SET balance = 70 WHERE id = 1");
}   // autocommit commits it

long after = queryBalance(reader);   // still 100: reader sees its own snapshot; it did NOT block, either
reader.commit();                     // transaction ends; next read would see 70
```

### PHP — checking for long transactions that block vacuum
```php
// Run from a monitoring script: warn if any transaction has been open > 5 minutes
$sql = "SELECT pid, now() - xact_start AS age, query
        FROM pg_stat_activity
        WHERE xact_start < now() - interval '5 minutes'";
foreach ($pdo->query($sql) as $row) {
    error_log("Long transaction pid={$row['pid']} age={$row['age']}: {$row['query']}");
}
```

### Time & Space Complexity
- **Reads under MVCC:** no lock waiting. Cost is the normal index lookup (O(log n)) plus a **visibility check per row version** (O(1) each). Many dead versions in a table mean more rows to skip, so scans slow down.
- **Writes:** each UPDATE creates a new version, so a row updated `k` times (before cleanup) takes `k` versions of space: space ≈ **O(live rows + dead versions)**.
- **VACUUM / purge:** O(table size) to scan, but incremental (it skips pages marked all-visible).
- **WAL write:** O(size of change), sequential. Recovery time ≈ **O(WAL since last checkpoint)**.
- **Buffer pool access:** O(1) hash lookup for a cached page; a miss costs one disk read.

### Alternatives
| Approach | Idea | Trade-off |
|---|---|---|
| **Lock-based concurrency** (2PL) | Readers take shared locks | Simple but readers and writers block each other |
| **Optimistic concurrency** | Validate at commit time | Good for low conflict; retries on conflict |
| **Append-only / LSM storage** | Never overwrite; compact later (see LSM in [Indexes](Data-and-Persistence/advanced-sql/indexes)) | Great write speed; read and compaction costs |
| **In-memory DBs** | Keep everything in RAM | Fast; limited by memory, durability via log/snapshots |

### Common Mistakes
- Leaving transactions open (idle in transaction): blocks vacuum, causes bloat.
- Turning off autovacuum "to save CPU".
- Running `VACUUM FULL` on a busy production table without planning for its exclusive lock.
- Huge single-transaction updates/deletes: giant undo/dead data. Batch them.
- Making the buffer pool too small (constant disk reads) or `max_connections` huge (memory per connection).
- Disabling fsync/durability for speed in production.

### Quick Interview Answers
- **What is MVCC?** Keeping multiple row versions so each transaction reads a consistent snapshot; readers and writers don't block each other.
- **Why does PostgreSQL need VACUUM?** UPDATE/DELETE leave dead row versions in the table; VACUUM reclaims them and prevents bloat.
- **PostgreSQL vs InnoDB MVCC?** PG stores old versions in the table (needs vacuum); InnoDB keeps the latest in place and old versions in the undo log (purge thread).
- **What is WAL and why?** A sequential log written before data pages so commits are durable and fast; used for crash recovery and replication.
- **What does a checkpoint do?** Flushes dirty pages to data files to limit how much WAL must be replayed after a crash.
- **Why do long transactions hurt?** They keep old versions alive, causing bloat/undo growth and blocking cleanup.
