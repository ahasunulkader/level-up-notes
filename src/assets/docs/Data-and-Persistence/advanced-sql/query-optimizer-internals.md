# Query Optimizer Internals — Join Algorithms & Statistics

### The Problem
- SQL says **what** you want, not **how** to get it. For one query there may be thousands of ways to run it: which index to use, which table to read first, which join method to use.
- A good choice runs in **milliseconds**; a bad choice on the same query runs for **hours**.

```sql
SELECT c.name, SUM(o.total)
FROM customers c
JOIN orders o ON o.customer_id = c.id
WHERE c.country = 'BD' AND o.created_at > '2026-01-01'
GROUP BY c.name;
```
Possible plans (just a few of many):
```
Plan 1: scan customers -> for each BD customer, look up orders by index
Plan 2: scan orders by date -> for each order, look up its customer
Plan 3: hash all BD customers in memory -> scan orders once, probe the hash
Plan 4: sort both tables by customer id -> merge them
```
Which is fastest? It depends on **how many rows** match each filter. The database has to *guess* that before it runs anything.

### What It Solves
- The **query optimizer (planner)** automatically picks a cheap plan by:
  1. Generating candidate plans.
  2. Estimating each plan's **cost** using **statistics** about your data.
  3. Choosing the lowest-cost plan.
- Understanding it lets you read `EXPLAIN`, know *why* a plan is bad, and fix it (stale statistics, missing index, wrong estimate).

### How It Works

#### 1. The journey of a query
```
SQL text
  │ 1. Parse        -> check syntax, build a tree
  │ 2. Rewrite      -> expand views, simplify (WHERE 1=1 removed, subquery -> join)
  │ 3. Optimize     -> choose access methods, join order, join algorithms  ◄── this page
  │ 4. Execute      -> run the chosen plan, return rows
  ▼
Result
```

#### 2. Cost-based optimization
The optimizer gives each plan a **cost number** (an estimate of work: disk page reads, CPU per row).
```
cost ≈ (pages read × page_cost) + (rows processed × cpu_cost) + (index lookups × ...)
```
It picks the plan with the **lowest estimated cost**. The cost is **not milliseconds**, it is a relative unit to compare plans.

#### 3. Statistics — the optimizer's eyes
The optimizer does **not** look at your data when planning. It reads a small summary the database collected earlier:

| Statistic | What it tells the optimizer | Used for |
|---|---|---|
| **Row count** of the table | "orders has ~2,000,000 rows" | Size of scans |
| **Number of distinct values (NDV)** per column | "country has 40 distinct values" | Estimating `=` filters |
| **Histogram** | Distribution of values: how many rows fall in each range | Estimating ranges and skew |
| **Most common values (MCV)** | "country = 'BD' is 35% of rows" | Skewed data |
| **Null fraction** | "5% of rows have NULL here" | `IS NULL` filters |
| **Correlation** | Is physical order similar to index order? | Cost of range index scans |

**Histogram picture:**
```
price distribution (each bar = a bucket with roughly equal rows in an equi-height histogram)
 0─10  │████████████████  (many cheap rows)
10─50  │██████████
50─200 │████
200─1k │██
1k─10k │█
Query: WHERE price > 1000  -> the histogram says "~1% of rows" -> index worth using
```

**Selectivity:** the fraction of rows a filter keeps.
```
selectivity = rows matching / total rows
WHERE country = 'BD'  ->  35%   (low selectivity -> scanning is fine, index not helpful)
WHERE id = 42         ->  0.00005%  (very selective -> index is perfect)
```
**Cardinality estimate** = estimated number of rows after a step:
```
customers: 100,000 rows
country='BD' selectivity 0.35  -> estimated 35,000 rows after the filter
```
For multiple filters it multiplies selectivities (assuming columns are independent):
```
WHERE country='BD' (0.35) AND city='Dhaka' (0.2)  -> 0.35 × 0.2 = 0.07  -> 7,000 rows
Reality: Dhaka is in BD, so the true answer is 20% (20,000 rows). The estimate is 3x too low!
```
This is the #1 source of bad plans: **wrong cardinality estimates**.

**Keeping statistics fresh:**
```sql
-- PostgreSQL
ANALYZE orders;                               -- refresh stats for one table
ALTER TABLE orders ALTER COLUMN status SET STATISTICS 1000;   -- more detail for a tricky column
CREATE STATISTICS s1 (dependencies) ON country, city FROM customers;  -- teach it that columns are correlated

-- MySQL
ANALYZE TABLE orders;
ANALYZE TABLE orders UPDATE HISTOGRAM ON status WITH 64 BUCKETS;  -- 8.0+
```
Autovacuum/auto-stats refresh these, but after a **huge load or delete** run `ANALYZE` manually.

#### 4. Access methods — how to read ONE table
| Method | How | Best when |
|---|---|---|
| **Sequential (full) scan** | Read every page | Need a large part of the table (>~5–10%) or table is tiny |
| **Index scan** | Walk the index, then fetch each row from the table | Few rows (high selectivity) |
| **Index-only scan** | Answer from the index alone (covering index) | All needed columns are in the index |
| **Bitmap scan** (PG) | Collect matching row locations from index(es), sort them, read pages in order | Medium selectivity; combining multiple indexes (`OR`/`AND`) |

```
Reading 30% of a table via index:
  index scan: 300,000 random jumps into the table  ✖ slow
  seq scan  : read the table once in order         ✔ faster
=> The optimizer often (correctly!) ignores your index when the filter isn't selective.
```

#### 5. Join algorithms — the heart of this topic
Joining table A (outer) with table B (inner) can be done in three main ways.

**Sample for all examples:** `customers` (small, 1,000 rows), `orders` (big, 1,000,000 rows).

---
**A) Nested Loop Join**
Idea: for **each row** of the outer table, search the inner table for matches.
```
for each customer c in customers:            -- outer loop
    for each order o in orders:              -- inner loop
        if o.customer_id == c.id: output(c, o)
```
Without an index that is O(N × M) = slow. **With an index on `orders.customer_id`**, the inner step becomes an index lookup:
```
for each customer c (1,000 rows):
    index lookup orders where customer_id = c.id     -- O(log M) each
Total ≈ N × log M  = 1,000 × 20 = 20,000 steps  ✔ fast
```
```
Outer rows      Inner (indexed)
 c1 ──────────► [lookup] ──► o5, o9
 c2 ──────────► [lookup] ──► o1
 c3 ──────────► [lookup] ──► (none)
```
- **Best when:** outer side is **small** (few rows) and inner side has an **index**. Great for OLTP: "get this user and their last 10 orders".
- **Worst when:** both are big and there's no index.

---
**B) Hash Join**
Idea: build an in-memory **hash table** from the smaller table, then scan the bigger table once and probe the hash for each row.
```
Phase 1 (BUILD): read customers, put in hash table keyed by id
   hash: { 1:Asha, 2:Ben, 3:Cara, ... }

Phase 2 (PROBE): scan orders once; for each order look up customer_id in the hash (O(1))
   order(cust 2) -> hash[2] = Ben  ✔ output
   order(cust 9) -> not in hash    ✖ skip
```
- **Cost:** O(N + M) — one pass over each table. No index needed.
- **Best when:** joining large sets, equality joins (`=`), no useful index.
- **Limits:** only for `=` joins; the build side must fit in memory (`work_mem` / `join_buffer_size`) or it **spills to disk** (slower: "batches" in PG's EXPLAIN).

---
**C) Sort-Merge Join**
Idea: sort both inputs by the join key, then walk through both with two pointers, like merging two sorted lists.
```
customers sorted: 1  2  3  5  8
orders sorted   : 1  1  2  2  3  4  5  8
                  ↑ two pointers move forward together, matching equal keys
```
- **Cost:** O(N log N + M log M) for sorting, then O(N + M) to merge. If inputs are **already sorted** (e.g. read via an index), the sort is free.
- **Best when:** both sides are large and already sorted, or the query needs `ORDER BY` on the join key anyway; supports range/inequality joins better than hash.

---
**Comparison**
| | Nested Loop | Hash Join | Merge Join |
|---|---|---|---|
| Time | O(N × log M) with index; O(N × M) without | O(N + M) | O(N log N + M log M) (O(N+M) if pre-sorted) |
| Extra memory | None | Hash table of smaller side | Sort buffers |
| Needs index? | Yes, on inner side (else terrible) | No | Helpful (avoids sort) |
| Join types | Any condition (`=`, `<`, `LIKE`...) | `=` only | `=` and ranges |
| Great for | Small outer, selective lookups | Big joins, analytics | Large pre-sorted inputs |
| First rows returned | **Immediately** (streaming) | After build phase | After sort |

> MySQL traditionally had only nested loop (+ block nested loop); **hash join** arrived in MySQL 8.0.18. PostgreSQL has all three.

#### 6. Join order matters
With 3+ tables the order changes cost massively.
```
A (10 rows) ⨝ B (1,000,000 rows) ⨝ C (50 rows)

Bad order : (B ⨝ C) first -> maybe 1,000,000 intermediate rows -> then join A
Good order: (A ⨝ C) first -> tiny (10 rows) -> then probe B by index
```
The optimizer searches orders using dynamic programming (tries to build the best plan for 2 tables, then 3, ...). With many tables (10+) the number of orders explodes (`n!`), so it switches to heuristics (PG: `geqo`, MySQL: `optimizer_search_depth`). **Rule of thumb:** filter early, join small results first.

#### 7. Reading EXPLAIN with this knowledge
```sql
EXPLAIN ANALYZE
SELECT c.name, o.total
FROM customers c JOIN orders o ON o.customer_id = c.id
WHERE c.country = 'BD';
```
```
Hash Join  (cost=35.00..9200.50 rows=35000 width=40) (actual time=1.2..58.4 rows=21000 loops=1)
  Hash Cond: (o.customer_id = c.id)
  ->  Seq Scan on orders o  (cost=0.00..7500.00 rows=1000000 ...)
  ->  Hash  (cost=30.00..30.00 rows=400 ...)
        ->  Seq Scan on customers c (rows=400) Filter: (country = 'BD')
```
How to read it (bottom → up, inner → outer):
| Piece | Meaning |
|---|---|
| `cost=a..b` | `a` = startup cost, `b` = total cost (relative units) |
| `rows=` (estimate) vs `actual rows=` | **Compare these!** A big difference = bad statistics |
| `loops=` | How many times that node ran (nested loop inner side runs once per outer row) |
| `Seq Scan` / `Index Scan` / `Bitmap Heap Scan` | Access method |
| `Hash Join` / `Nested Loop` / `Merge Join` | Join algorithm |
| `Buffers: shared hit=... read=...` (`EXPLAIN (ANALYZE, BUFFERS)`) | Cache hits vs disk reads |

**Red flags:**
```
Estimated rows = 10, actual rows = 500,000   -> stale stats / correlated columns
Nested Loop with a Seq Scan inner + loops=100000 -> missing index on the inner side
Sort Method: external merge  Disk: 800MB     -> not enough work_mem, spilled to disk
Hash Batches: 16                              -> hash join spilled to disk
```
MySQL: use `EXPLAIN FORMAT=TREE` or `EXPLAIN ANALYZE` (8.0.18+).

#### 8. Fixing a bad plan — checklist (in order)
1. Run `EXPLAIN ANALYZE`; compare estimated vs actual rows.
2. `ANALYZE` the tables (stale statistics are the most common cause).
3. Add or fix indexes (see [Indexes](Data-and-Persistence/advanced-sql/indexes)): composite order, covering.
4. Make filters **sargable** (index-friendly): `WHERE created_at >= '2026-01-01'` not `WHERE YEAR(created_at) = 2026`.
5. Add extended statistics for correlated columns.
6. Rewrite the query (replace `OR` with `UNION`, avoid functions on indexed columns, avoid `SELECT *`).
7. Increase `work_mem` (PG) / `join_buffer_size` (MySQL) for spills.
8. Last resort: **hints** (MySQL `USE INDEX`, `STRAIGHT_JOIN`; PG has `pg_hint_plan` extension / `SET enable_hashjoin = off` for testing only).

```sql
-- Testing only: see what the plan would be without hash joins (PostgreSQL)
SET enable_hashjoin = off;
EXPLAIN ANALYZE SELECT ... ;
RESET enable_hashjoin;
```

#### 9. Prepared statements and plan caching
- A **generic plan** is reused for different parameter values (saves planning time) but might be wrong for skewed values (`status = 'deleted'` is 1% of rows; `status = 'active'` is 90%).
- PostgreSQL may switch between custom and generic plans automatically (`plan_cache_mode`).
- If one parameter value is very different from the rest, a plan that is great for one value can be terrible for another ("parameter sniffing" in SQL Server terms).

### Java — comparing estimated vs actual rows from code
```java
// Quick helper to print the real plan and spot estimate mistakes during development
String sql = "EXPLAIN (ANALYZE, BUFFERS) SELECT c.name FROM customers c " +
             "JOIN orders o ON o.customer_id = c.id WHERE c.country = ?";
try (Connection c = ds.getConnection();
     PreparedStatement ps = c.prepareStatement(sql)) {
    ps.setString(1, "BD");                    // the parameter value affects the estimate!
    try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) System.out.println(rs.getString(1));   // each row is one line of the plan
    }
}
```

### PHP — refresh statistics after a bulk load
```php
// After importing millions of rows, planner stats are stale. Refresh them.
$pdo->exec('ANALYZE orders');            // PostgreSQL & MySQL both support ANALYZE (syntax differs slightly)
$stmt = $pdo->query('EXPLAIN ANALYZE SELECT * FROM orders WHERE customer_id = 42');
foreach ($stmt as $line) echo $line[0] . PHP_EOL;   // check the plan uses the index
```

### Time & Space Complexity
| Operation | Time | Notes |
|---|---|---|
| Seq scan | O(N) | All rows |
| B-tree index lookup | O(log N) | Per lookup |
| Nested loop (indexed) | O(N · log M) | N outer rows |
| Nested loop (no index) | O(N · M) | Avoid for big tables |
| Hash join | O(N + M) | Space: O(smaller table) |
| Merge join | O(N log N + M log M) | O(N + M) when pre-sorted |
| Planning itself | up to O(2ⁿ) / O(n!) in tables joined | Heuristics kick in for large n |

### Alternatives
- **Materialized views / summary tables:** precompute expensive joins (see [Views](Data-and-Persistence/advanced-sql/views)).
- **Denormalization:** avoid the join (see [Normalization](Data-and-Persistence/advanced-sql/normalization)).
- **Columnar/analytic engines** (ClickHouse, BigQuery) with different optimizers designed for huge scans.
- **Adaptive/learned optimizers** in some commercial databases re-plan using runtime feedback.

### Common Mistakes
- Trusting that "an index always makes it faster."
- Never running `ANALYZE` after bulk changes.
- Ignoring the gap between estimated and actual rows.
- Functions on indexed columns (`WHERE LOWER(email) = ...` without an expression index).
- Forcing hints permanently; data changes and the hint becomes wrong.
- Testing on tiny dev data (the optimizer picks completely different plans at production size).

### Quick Interview Answers
- **How does the optimizer pick a plan?** It estimates the cost of candidate plans using table statistics and picks the cheapest.
- **Three join algorithms?** Nested loop (small outer + indexed inner), hash join (large equality joins, no index), merge join (large sorted inputs).
- **Why would the optimizer ignore my index?** Low selectivity (it returns too many rows), stale statistics, a function on the column, or a tiny table where a scan is cheaper.
- **First thing to check on a slow query?** `EXPLAIN ANALYZE`: compare estimated rows with actual rows.
- **What is cardinality estimation?** Predicting how many rows each plan step produces; errors there cause bad plans.
