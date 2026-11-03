# Query Performance — Profiling & Optimization

### The Problem
- Without measuring anything, tuning a slow query is just guessing — you add an index because it "seems like it should help," with no proof it actually changed the access path instead of just adding write overhead for nothing.

### What It Solves
- Profiling tools answer three questions in order, so every tuning change is backed by evidence instead of a hunch:
  1. **Which query is actually slow?** (ranks queries by real cumulative impact, not gut feeling)
  2. **Why is it slow?** (is it scanning the whole table when it should be seeking via an index? is the join order bad? are the row estimates wildly off, meaning stale statistics?)
  3. **Did the fix actually work?** (compare the plan and timing before and after — not just a single "it feels faster")

### How It Works

**Profiling toolkit:**

| Tool | Purpose |
|---|---|
| `EXPLAIN` | Shows the planned execution strategy (which index, join order, estimated rows) |
| `EXPLAIN ANALYZE` (Postgres) | Runs the query for real and shows actual timing per step |
| Slow query log (MySQL) / `pg_stat_statements` (Postgres) | Finds the worst offenders in production over time |
| `SHOW PROFILE` (MySQL, legacy) | Per-stage timing of a single query |

**Step 1 — find the worst offender first, don't profile blind:**
```sql
-- Postgres: requires the pg_stat_statements extension enabled
SELECT query, calls, total_exec_time, mean_exec_time, shared_blks_read
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 5;
```
```sql
-- MySQL: enable and inspect the slow query log
SET GLOBAL slow_query_log = 'ON';
SET GLOBAL long_query_time = 1;  -- log anything over 1 second
-- then read the log file, or query performance_schema directly:
SELECT digest_text, count_star, avg_timer_wait
FROM performance_schema.events_statements_summary_by_digest
ORDER BY avg_timer_wait DESC
LIMIT 5;
```
This tells you *which* query to spend time on — usually the one with the highest `total_exec_time` (cumulative impact across all calls), not necessarily the single slowest one-off run.

**Step 2 — read the plan for that query:**
```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM orders WHERE status = 'COMPLETED' AND created_at > '2026-01-01';
```
Example output, before adding an index:
```
Seq Scan on orders  (cost=0.00..184230.00 rows=1200 width=64) (actual time=812.4..812.9 rows=1180 loops=1)
  Filter: (status = 'COMPLETED' AND created_at > '2026-01-01')
  Rows Removed by Filter: 5998820
  Buffers: shared read=41230
Planning Time: 0.4 ms
Execution Time: 815.1 ms
```
The tell-tale signs, in order of what to check: `Seq Scan` on a large table (`Rows Removed by Filter: 5998820` — it read 6M rows to keep 1,180), a big gap between `Buffers: shared read` (disk/cache misses) and `shared hit` (already cached), and `Execution Time` in the hundreds of ms for a query that should be near-instant.

After adding `CREATE INDEX idx_orders_status_created ON orders (status, created_at);`:
```
Index Only Scan using idx_orders_status_created on orders  (cost=0.43..38.20 rows=1200 width=64) (actual time=0.6..0.9 rows=1180 loops=1)
  Index Cond: (status = 'COMPLETED' AND created_at > '2026-01-01')
  Buffers: shared hit=812
Planning Time: 0.3 ms
Execution Time: 1.1 ms
```
That's the proof the fix worked: the plan *type* changed (`Seq Scan` → `Index Only Scan`), `Buffers` moved from `read` to mostly `hit`, and execution time dropped from ~815ms to ~1ms. Comparing plan shape, not just a single timing number, is what makes this credible instead of "it felt faster."

**Step 3 — MySQL equivalent, same idea:**
```sql
EXPLAIN FORMAT=JSON
SELECT * FROM orders WHERE status = 'COMPLETED' AND created_at > '2026-01-01';
```
Look at `"access_type"`: `ALL` means full table scan (bad on a large table); `ref` or `range` means an index is being used. `"rows_examined_per_scan"` vs. actual matching rows tells you the same "how much did it throw away" story as Postgres's `Rows Removed by Filter`.

**Step 4 — `SHOW PROFILE` (legacy MySQL, superseded by `performance_schema` in modern versions):**
```sql
SET profiling = 1;
SELECT * FROM orders WHERE status = 'COMPLETED';
SHOW PROFILE FOR QUERY 1;
```
Breaks a single query's execution into stages (`starting`, `checking permissions`, `Sending data`, etc.) with per-stage timing — useful for spotting whether time is going into sending a large result set over the network versus the actual row lookup, which a plain `EXPLAIN` won't show you.

- **The habit that matters more than any single tool:** always run `EXPLAIN ANALYZE` (or its MySQL equivalent) *before* changing anything and save that output, then run it again *after* the change. A tuning story with no "before" plan is a claim; one with both plans side by side is proof.

**Optimization techniques:**
1. **Index the right columns** — columns in `WHERE`, `JOIN`, `ORDER BY`; use composite/covering indexes for hot queries.
2. **Avoid `SELECT *`** — fetching unused columns wastes I/O and can prevent a covering index from being used.
3. **Fix N+1 queries** — 1 query for a list + N queries for each item's related data. Fix with a `JOIN`, a single `WHERE id IN (...)`, or ORM eager loading.
4. **Batch writes** instead of one round-trip per row.
5. **Paginate with keyset (cursor) pagination** instead of `OFFSET` for large tables — `OFFSET 1000000` still scans and discards a million rows.
6. **Denormalize deliberately** when reads vastly outnumber writes and joins are the bottleneck.
7. **Connection pooling** to avoid the cost of establishing a new TCP + auth handshake per request.

```sql
-- N+1 turned into 1 query
SELECT * FROM orders WHERE user_id IN (1, 2, 3, 4, 5);

-- Keyset pagination — uses the index, doesn't degrade with page depth
SELECT * FROM orders WHERE id > 48200 ORDER BY id LIMIT 20;
```

### Time & Space Complexity Cheat Sheet

| Pattern | Complexity | Why |
|---|---|---|
| Full table scan (`Seq Scan`) | O(n) | Reads every row to find matches |
| Indexed lookup (`Index Scan`) | O(log n + k) | Tree walk to find the start, then read the k matches |
| Covering index (`Index Only Scan`) | O(log n + k) | Same shape, but skips the extra table lookup — smaller constant factor |
| N+1 queries | O(n) round-trips | 1 query for the list + 1 more per row — the "n" here is network round-trips, not just rows |
| Batched query (`WHERE id IN (...)`) | O(1) round-trip | Same total row-processing work, but 1 round-trip instead of n |
| `OFFSET m LIMIT k` pagination | O(m + k) | Must scan and discard the first m rows every time — gets slower on later pages |
| Keyset pagination (`WHERE id > last_id`) | O(log n + k) | Index seek straight to the right spot — doesn't degrade with page depth |

- **Why this matters:** almost every optimization above is really about moving a query from a worse complexity class (`O(n)`, or `O(n)` round-trips) into a better one (`O(log n)`, or `O(1)` round-trips) — that's a bigger win than any constant-factor tuning, and it's exactly what `EXPLAIN`/`EXPLAIN ANALYZE` lets you prove happened.

### Java — batching + connection pooling
```java
// Batch insert: 1 round-trip instead of 1000
try (PreparedStatement ps = conn.prepareStatement(
        "INSERT INTO order_items (order_id, sku, qty) VALUES (?, ?, ?)")) {
    conn.setAutoCommit(false);
    for (Item item : items) {
        ps.setInt(1, orderId);
        ps.setString(2, item.sku());
        ps.setInt(3, item.qty());
        ps.addBatch();
    }
    ps.executeBatch();
    conn.commit();
}

// HikariCP pool config — reuse connections instead of opening one per request
HikariConfig config = new HikariConfig();
config.setMaximumPoolSize(20);
config.setJdbcUrl(url);
HikariDataSource dataSource = new HikariDataSource(config);
```

### PHP — batching + persistent connections
```php
// Batch insert with a single prepared statement, reused per row (still N round-trips
// unless you build a multi-row VALUES list — do that for real batch performance)
$values = [];
$params = [];
foreach ($items as $item) {
    $values[] = "(?, ?, ?)";
    array_push($params, $orderId, $item['sku'], $item['qty']);
}
$sql = "INSERT INTO order_items (order_id, sku, qty) VALUES " . implode(',', $values);
$pdo->prepare($sql)->execute($params);

// Persistent connection (PHP's equivalent of a lightweight pool per PHP-FPM worker)
$pdo = new PDO($dsn, $user, $pass, [PDO::ATTR_PERSISTENT => true]);
```

---

*Part of [Advanced SQL & Database Programmability](Data-and-Persistence/advanced-sql-programmability).*
