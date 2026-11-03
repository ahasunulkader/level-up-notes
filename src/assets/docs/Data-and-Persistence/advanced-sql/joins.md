# Joins

### The Problem
- A single real-world thing (like a user and their orders) usually lives across **separate tables**, so data doesn't get duplicated and updates stay safe.
- If you only query one table, you're missing the related data sitting in the other table — you can see orders, but not which user placed each one.
- Matching rows by hand in application code (loop through table A, loop through table B, find matches) is slow and gets worse as tables grow.

### What It Solves
- Joins let the database combine rows from two or more tables in **one query**, matched on a related column (e.g. `user_id`).
- You get back a single result set with the related data already stitched together — no manual matching needed in your code.
- Different join types control what happens to rows that **don't** have a match on the other side: do you drop them, or keep them with `NULL`s?

### How It Works
- Pick the join type based on what you want to happen to unmatched rows:

| Join Type | Returns |
|---|---|
| `INNER JOIN` | Only rows with a match on both sides |
| `LEFT JOIN` | All left rows + matched right rows (NULL if no match) |
| `RIGHT JOIN` | All right rows + matched left rows (NULL if no match) |
| `FULL OUTER JOIN` | All rows from both sides (NULL where no match) — MySQL: emulate with `UNION` of LEFT + RIGHT |
| `CROSS JOIN` | Cartesian product — every row × every row |
| `SELF JOIN` | A table joined to itself (e.g. employee → manager) |

```sql
CREATE TABLE users (id INT PRIMARY KEY, name VARCHAR(100));
CREATE TABLE orders (id INT PRIMARY KEY, user_id INT, total DECIMAL(10,2),
                      FOREIGN KEY (user_id) REFERENCES users(id));

-- INNER JOIN: users who have at least one order
SELECT u.name, o.total
FROM users u
INNER JOIN orders o ON u.id = o.user_id;

-- LEFT JOIN: all users, including those with zero orders
SELECT u.name, COALESCE(SUM(o.total), 0) AS lifetime_value
FROM users u
LEFT JOIN orders o ON u.id = o.user_id
GROUP BY u.id;

-- SELF JOIN: employee and their manager
SELECT e.name AS employee, m.name AS manager
FROM employees e
LEFT JOIN employees m ON e.manager_id = m.id;
```

- **Watch out for:**
  - A missing or wrong `ON` condition silently turns a join into (or close to) a cartesian product — always sanity-check row counts.
  - Putting a filter on a nullable right-side column in `WHERE` (e.g. `WHERE o.status = 'paid'`) **after** a `LEFT JOIN` silently converts it back into an `INNER JOIN`. Put that condition in the `ON` clause instead if you want to keep unmatched left rows.

**Example — trap 1: a missing / wrong `ON` becomes a cartesian product.** With `users` = 1,000 rows and `orders` = 50,000 rows:

```sql
-- BAD: comma-join with the join predicate forgotten -> 1,000 x 50,000 = 50,000,000 rows
SELECT u.name, o.total
FROM users u, orders o;

-- BAD: an ON that is always true is just as bad -> same 50,000,000-row explosion
SELECT u.name, o.total
FROM users u
JOIN orders o ON 1 = 1;

-- GOOD: one row per order -> 50,000 rows
SELECT u.name, o.total
FROM users u
JOIN orders o ON o.user_id = u.id;

-- Sanity check: a 1-to-many FK join must return exactly COUNT(*) of the "many" side.
SELECT COUNT(*) FROM orders;                                     -- 50,000
SELECT COUNT(*) FROM users u JOIN orders o ON o.user_id = u.id;  -- 50,000  (not 50,000,000)
```

**Example — trap 2: a `WHERE` on the right table turns `LEFT JOIN` into `INNER JOIN`.** Goal: list *every* user, plus their paid orders.

```sql
-- BUG: a user with no paid order has o.status = NULL; `NULL = 'paid'` is UNKNOWN,
--      so WHERE drops that user. Result = only users who have a paid order (an INNER JOIN).
SELECT u.id, u.name, o.total
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
WHERE o.status = 'paid';

-- FIX: move the right-table condition into ON -> unmatched users stay, with o.* = NULL
SELECT u.id, u.name, o.total
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
                  AND o.status = 'paid';

-- ALSO OK: keep it in WHERE but explicitly re-admit the unmatched rows
SELECT u.id, u.name, o.total
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
WHERE o.status = 'paid' OR o.id IS NULL;
```

| Query | A user with **no** paid order is... |
|---|---|
| `LEFT JOIN` + `WHERE o.status = 'paid'` | **missing** — silently an inner join |
| `LEFT JOIN` + `AND o.status = 'paid'` inside `ON` | **kept**, with `total` = `NULL` |

### Time & Space Complexity
- **Nested loop join (no index):** for every row in the outer table (`n` rows), scan the whole inner table (`m` rows) looking for a match → **O(n × m) time**. This is what happens with no index on the join column.
- **Nested loop join with an index** on the join column: each of the `n` outer rows does an index seek into the inner table (`O(log m)`) → **O(n log m) time** total, instead of `O(n × m)`. This is the real reason "index your foreign keys" matters so much.
- **Hash join** (the planner's choice when no usable index exists, or for large joins): build an in-memory hash table on the smaller side (`O(m)` time and space), then probe it once per row of the larger side (`O(n)`) → **O(n + m) time, O(m) space**.
- **Merge join** (both sides already sorted, e.g. via an index): walk both sorted lists together once → **O(n + m) time, O(1) extra space**.
- **Why this matters:** the difference between an indexed and unindexed join is the difference between `O(n × m)` (unusable past a few thousand rows per side) and `O(n + m)`/`O(n log m)` (scales to millions of rows). `EXPLAIN` ([Query Performance](Data-and-Persistence/advanced-sql/query-performance)) tells you which one the planner actually picked.

**Example — the same query, four plans.** Query throughout: `SELECT * FROM a JOIN b ON b.a_id = a.id`. Indexes and table sizes decide which strategy the planner picks (PostgreSQL `EXPLAIN`, trimmed):

```text
1. NESTED LOOP, no index  -- tiny outer table, nothing to seek with on the inner side
   a = 5 rows,  b = 1,000,000 rows,  no index on b.a_id

   Nested Loop
     ->  Seq Scan on a            (rows=5)
     ->  Seq Scan on b            (rows=1000000)   <- b fully scanned ONCE PER row of a
           Filter: (a_id = a.id)

   5 x 1,000,000 comparisons  ->  O(n x m).  Let a grow and this plan falls off a cliff.
```

```text
2. NESTED LOOP + index  -- after: CREATE INDEX idx_b_a_id ON b(a_id);
   a = 100,000 rows,  b = 1,000,000 rows

   Nested Loop
     ->  Seq Scan on a                      (rows=100000)
     ->  Index Scan using idx_b_a_id on b   (rows=1)
           Index Cond: (a_id = a.id)        <- O(log m) seek, not a full scan

   100,000 x log(1,000,000)  ->  O(n log m).  This is "index your foreign keys" in action.
```

```text
3. HASH JOIN  -- both sides large, no index worth using
   a = 100,000 rows,  b = 1,000,000 rows

   Hash Join
     Hash Cond: (b.a_id = a.id)
     ->  Seq Scan on b        (rows=1000000)   <- probe side (larger table), scanned once
     ->  Hash                 (rows=100000)    <- build side (smaller table) -> hash table in memory
           ->  Seq Scan on a  (rows=100000)

   build O(m) + probe O(n)  ->  O(n + m) time, O(m) memory (spills to temp files past work_mem)
```

```text
4. MERGE JOIN  -- both inputs already sorted on the join key
   a.id is the PK (sorted);  b.a_id has idx_b_a_id (sorted)

   Merge Join
     Merge Cond: (a.id = b.a_id)
     ->  Index Scan using a_pkey on a         (rows=100000)    <- already in id order
     ->  Index Scan using idx_b_a_id on b     (rows=1000000)   <- already in a_id order

   one linear zip through both ordered streams  ->  O(n + m) time, O(1) extra space (no hash table)
```

- **MySQL / InnoDB note:** the optimizer only has **nested-loop** (plain, plus Block Nested-Loop for un-indexed joins) and, since 8.0.18, **hash join** — there is no merge-join operator. Inspect with `EXPLAIN FORMAT=TREE ...` or `EXPLAIN ANALYZE ...`, which print `Nested loop` / `Hash join` node names.

### Java (JDBC)
```java
String sql = """
    SELECT u.name, COALESCE(SUM(o.total), 0) AS lifetime_value
    FROM users u
    LEFT JOIN orders o ON u.id = o.user_id
    GROUP BY u.id
    """;

try (Connection conn = dataSource.getConnection();
     PreparedStatement ps = conn.prepareStatement(sql);
     ResultSet rs = ps.executeQuery()) {
    while (rs.next()) {
        String name = rs.getString("name");
        BigDecimal ltv = rs.getBigDecimal("lifetime_value");
        System.out.printf("%s: %s%n", name, ltv);
    }
}
```

### PHP (PDO)
```php
$sql = "SELECT u.name, COALESCE(SUM(o.total), 0) AS lifetime_value
        FROM users u
        LEFT JOIN orders o ON u.id = o.user_id
        GROUP BY u.id";

$stmt = $pdo->query($sql);
foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
    echo "{$row['name']}: {$row['lifetime_value']}\n";
}
```

### Joins Visualized — Actual Table Rows

Got it. Here's each join shown with actual table rows, so you can see exactly what ends up in the result. Two tables are used throughout: **`orders`** `(order_id, cust_id)` is the **left** table, **`customers`** `(cust_id, name)` is the **right** table. Cells are colour-coded by which table each value came from, so you can trace every value in the result back to its source.

<style>
.jvbox{border:1px solid #e2e8f0;border-radius:10px;box-shadow:0 1px 2px rgba(15,23,42,.05),0 2px 10px rgba(15,23,42,.05);padding:2px 20px 18px;margin:22px 0;background:#fff}
.jvbox h4{margin:16px 0 2px;font-size:15px}
.jvbox p{margin:8px 0}
.jv{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;margin:10px 0}
.jv .lg{display:flex;gap:14px;flex-wrap:wrap;margin:8px 0 14px;font-size:11px;color:#57606a}
.jv .lg span{display:inline-flex;align-items:center;gap:5px}
.jv .lg i{width:11px;height:11px;border-radius:3px;border:1px solid #d0d7de;display:inline-block}
.jv .row{display:flex;gap:14px;flex-wrap:wrap;align-items:flex-start;margin:6px 0}
.jv table{width:auto;margin:6px 0 0;border-collapse:collapse;table-layout:fixed;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:1.3}
.jv table.o,.jv table.c{width:132px}
.jv table.res{width:198px;margin-top:8px}
.jv table.auto{table-layout:auto;width:auto}
.jv caption{caption-side:top;text-align:left;font-family:system-ui,sans-serif;font-size:10px;font-weight:600;letter-spacing:.03em;text-transform:uppercase;color:#57606a;padding-bottom:3px}
.jv th,.jv td{border:1px solid #d0d7de;padding:3px 8px;text-align:center;color:#1e293b;overflow:hidden;text-overflow:ellipsis}
.jv th{font-family:system-ui,sans-serif;font-size:10px;font-weight:600;color:#57606a;background:#f6f8fa}
.jv table.o th{background:#DDEBC6}
.jv table.c th{background:#D3E6F7}
.jv td.o{background:#EAF3DE}
.jv td.c{background:#E6F1FB}
.jv td.x{background:#F1F3F5;color:#8a919b;font-style:italic}
.jv tr.fade td{opacity:.45}
.jv .none{font-style:italic;color:#8a919b}
</style>

<div class="jv"><div class="lg">
<span><i style="background:#EAF3DE"></i>value from <code>orders</code> (left)</span>
<span><i style="background:#E6F1FB"></i>value from <code>customers</code> (right)</span>
<span><i style="background:#F1F3F5"></i>NULL — no match on that side</span>
<span><i style="opacity:.45;background:#EAF3DE"></i>row that gets dropped</span>
</div></div>

<div class="jvbox">

#### `INNER JOIN` — only rows that exist on **both** sides

**Case 1 — all rows match**

<div class="jv"><div class="row">
<table class="o"><caption>orders</caption>
<tr><th>order_id</th><th>cust_id</th></tr>
<tr><td class="o">1</td><td class="o">10</td></tr>
<tr><td class="o">2</td><td class="o">20</td></tr>
</table>
<table class="c"><caption>customers</caption>
<tr><th>cust_id</th><th>name</th></tr>
<tr><td class="c">10</td><td class="c">Alice</td></tr>
<tr><td class="c">20</td><td class="c">Bob</td></tr>
</table>
</div>
<table class="res"><caption>&rarr; result</caption>
<tr><th>order_id</th><th>cust_id</th><th>name</th></tr>
<tr><td class="o">1</td><td class="o">10</td><td class="c">Alice</td></tr>
<tr><td class="o">2</td><td class="o">20</td><td class="c">Bob</td></tr>
</table>
</div>

Both orders had a matching customer → both rows appear.

**Case 2 — half match**

<div class="jv"><div class="row">
<table class="o"><caption>orders</caption>
<tr><th>order_id</th><th>cust_id</th></tr>
<tr><td class="o">1</td><td class="o">10</td></tr>
<tr class="fade"><td class="o">2</td><td class="o">99</td></tr>
</table>
<table class="c"><caption>customers</caption>
<tr><th>cust_id</th><th>name</th></tr>
<tr><td class="c">10</td><td class="c">Alice</td></tr>
<tr><td class="c">20</td><td class="c">Bob</td></tr>
</table>
</div>
<table class="res"><caption>&rarr; result</caption>
<tr><th>order_id</th><th>cust_id</th><th>name</th></tr>
<tr><td class="o">1</td><td class="o">10</td><td class="c">Alice</td></tr>
</table>
</div>

Order 2 had `cust_id = 99`, which doesn't exist → dropped entirely.

**Case 3 — no match**

<div class="jv"><div class="row">
<table class="o"><caption>orders</caption>
<tr><th>order_id</th><th>cust_id</th></tr>
<tr class="fade"><td class="o">1</td><td class="o">99</td></tr>
</table>
<table class="c"><caption>customers</caption>
<tr><th>cust_id</th><th>name</th></tr>
<tr><td class="c">10</td><td class="c">Alice</td></tr>
</table>
</div>
<table class="res"><caption>&rarr; result</caption>
<tr><th>order_id</th><th>cust_id</th><th>name</th></tr>
<tr><td class="none" colspan="3">0 rows</td></tr>
</table>
</div>

Nothing matched → empty result set.

</div>

<div class="jvbox">

#### `LEFT JOIN` — all **left** rows survive; right side is `NULL` when no match

**Case 1 — all rows match**

<div class="jv"><div class="row">
<table class="o"><caption>orders</caption>
<tr><th>order_id</th><th>cust_id</th></tr>
<tr><td class="o">1</td><td class="o">10</td></tr>
<tr><td class="o">2</td><td class="o">20</td></tr>
</table>
<table class="c"><caption>customers</caption>
<tr><th>cust_id</th><th>name</th></tr>
<tr><td class="c">10</td><td class="c">Alice</td></tr>
<tr><td class="c">20</td><td class="c">Bob</td></tr>
</table>
</div>
<table class="res"><caption>&rarr; result</caption>
<tr><th>order_id</th><th>cust_id</th><th>name</th></tr>
<tr><td class="o">1</td><td class="o">10</td><td class="c">Alice</td></tr>
<tr><td class="o">2</td><td class="o">20</td><td class="c">Bob</td></tr>
</table>
</div>

Same as an inner join when everything matches.

**Case 2 — half match**

<div class="jv"><div class="row">
<table class="o"><caption>orders</caption>
<tr><th>order_id</th><th>cust_id</th></tr>
<tr><td class="o">1</td><td class="o">10</td></tr>
<tr><td class="o">2</td><td class="o">99</td></tr>
</table>
<table class="c"><caption>customers</caption>
<tr><th>cust_id</th><th>name</th></tr>
<tr><td class="c">10</td><td class="c">Alice</td></tr>
<tr><td class="c">20</td><td class="c">Bob</td></tr>
</table>
</div>
<table class="res"><caption>&rarr; result</caption>
<tr><th>order_id</th><th>cust_id</th><th>name</th></tr>
<tr><td class="o">1</td><td class="o">10</td><td class="c">Alice</td></tr>
<tr><td class="o">2</td><td class="o">99</td><td class="x">NULL</td></tr>
</table>
</div>

Order 2 is kept, but `name` is `NULL` because `cust_id = 99` has no match.

**Case 3 — no match**

<div class="jv"><div class="row">
<table class="o"><caption>orders</caption>
<tr><th>order_id</th><th>cust_id</th></tr>
<tr><td class="o">1</td><td class="o">99</td></tr>
</table>
<table class="c"><caption>customers</caption>
<tr><th>cust_id</th><th>name</th></tr>
<tr><td class="c">10</td><td class="c">Alice</td></tr>
</table>
</div>
<table class="res"><caption>&rarr; result</caption>
<tr><th>order_id</th><th>cust_id</th><th>name</th></tr>
<tr><td class="o">1</td><td class="o">99</td><td class="x">NULL</td></tr>
</table>
</div>

The left row always survives. Right columns are all `NULL`.

</div>

<div class="jvbox">

#### `RIGHT JOIN` — all **right** rows survive; left side is `NULL` when no match

**Case 1 — all rows match**

It's the same as previous — when every right row already has a matching left row, there are no `NULL`s to add, so `INNER`, `LEFT` and `RIGHT` all return the identical result. Only the cases below actually differ.

**Case 2 — half match**

<div class="jv"><div class="row">
<table class="o"><caption>orders</caption>
<tr><th>order_id</th><th>cust_id</th></tr>
<tr><td class="o">1</td><td class="o">10</td></tr>
</table>
<table class="c"><caption>customers</caption>
<tr><th>cust_id</th><th>name</th></tr>
<tr><td class="c">10</td><td class="c">Alice</td></tr>
<tr><td class="c">20</td><td class="c">Bob</td></tr>
</table>
</div>
<table class="res"><caption>&rarr; result</caption>
<tr><th>order_id</th><th>cust_id</th><th>name</th></tr>
<tr><td class="o">1</td><td class="o">10</td><td class="c">Alice</td></tr>
<tr><td class="x">NULL</td><td class="c">20</td><td class="c">Bob</td></tr>
</table>
</div>

Bob has no order → `order_id` is `NULL`, and `cust_id` now comes from `customers`, but Bob still appears.

**Case 3 — no match**

<div class="jv"><div class="row">
<table class="o"><caption>orders</caption>
<tr><th>order_id</th><th>cust_id</th></tr>
<tr class="fade"><td class="o">1</td><td class="o">99</td></tr>
</table>
<table class="c"><caption>customers</caption>
<tr><th>cust_id</th><th>name</th></tr>
<tr><td class="c">10</td><td class="c">Alice</td></tr>
</table>
</div>
<table class="res"><caption>&rarr; result</caption>
<tr><th>order_id</th><th>cust_id</th><th>name</th></tr>
<tr><td class="x">NULL</td><td class="c">10</td><td class="c">Alice</td></tr>
</table>
</div>

The right row always survives. Left columns are all `NULL`.

</div>

<div class="jvbox">

#### `FULL OUTER JOIN` — every row from **both** sides; `NULL`s fill wherever there's no match

**Case 1 — all rows match**

It's the same as previous — with every row matched there are no `NULL`s to fill in, so the output is identical to the other joins. Only the cases below differ.

**Case 2 — half match**

<div class="jv"><div class="row">
<table class="o"><caption>orders</caption>
<tr><th>order_id</th><th>cust_id</th></tr>
<tr><td class="o">1</td><td class="o">10</td></tr>
<tr><td class="o">2</td><td class="o">99</td></tr>
</table>
<table class="c"><caption>customers</caption>
<tr><th>cust_id</th><th>name</th></tr>
<tr><td class="c">10</td><td class="c">Alice</td></tr>
<tr><td class="c">20</td><td class="c">Bob</td></tr>
</table>
</div>
<table class="res"><caption>&rarr; result</caption>
<tr><th>order_id</th><th>cust_id</th><th>name</th></tr>
<tr><td class="o">1</td><td class="o">10</td><td class="c">Alice</td></tr>
<tr><td class="o">2</td><td class="o">99</td><td class="x">NULL</td></tr>
<tr><td class="x">NULL</td><td class="c">20</td><td class="c">Bob</td></tr>
</table>
</div>

Order 2 (no customer) and Bob (no order) both appear, each with `NULL`s on the missing side.

**Case 3 — no match at all**

<div class="jv"><div class="row">
<table class="o"><caption>orders</caption>
<tr><th>order_id</th><th>cust_id</th></tr>
<tr><td class="o">1</td><td class="o">99</td></tr>
</table>
<table class="c"><caption>customers</caption>
<tr><th>cust_id</th><th>name</th></tr>
<tr><td class="c">10</td><td class="c">Alice</td></tr>
</table>
</div>
<table class="res"><caption>&rarr; result</caption>
<tr><th>order_id</th><th>cust_id</th><th>name</th></tr>
<tr><td class="o">1</td><td class="o">99</td><td class="x">NULL</td></tr>
<tr><td class="x">NULL</td><td class="c">10</td><td class="c">Alice</td></tr>
</table>
</div>

Both rows appear. Half the columns are `NULL` for each one.

</div>

<div class="jvbox">

#### `CROSS JOIN` — every left row paired with every right row

No `ON` condition, so each row on the left is combined with **every** row on the right. Result size is `left × right`. Here the tables are `sizes` (left) and `colors` (right): 2 × 2 = 4 rows.

<div class="jv"><div class="row">
<table class="o auto"><caption>sizes</caption>
<tr><th>size</th></tr>
<tr><td class="o">S</td></tr>
<tr><td class="o">M</td></tr>
</table>
<table class="c auto"><caption>colors</caption>
<tr><th>color</th></tr>
<tr><td class="c">Red</td></tr>
<tr><td class="c">Blue</td></tr>
</table>
</div>
<table class="res auto"><caption>&rarr; result — 2 &times; 2 = 4</caption>
<tr><th>size</th><th>color</th></tr>
<tr><td class="o">S</td><td class="c">Red</td></tr>
<tr><td class="o">S</td><td class="c">Blue</td></tr>
<tr><td class="o">M</td><td class="c">Red</td></tr>
<tr><td class="o">M</td><td class="c">Blue</td></tr>
</table>
</div>

Every size pairs with every colour. Adding a `WHERE` or `ON` filter is what turns it back into a normal join.

</div>

<div class="jvbox">

#### `SELF JOIN` — one table joined to itself

The same `employees` table is read twice under two aliases: `e` for the employee, `m` for their manager, matching `e.mgr_id` to `m.emp_id`. Dana has no manager, so a `LEFT` self-join keeps Dana with a `NULL` manager (an `INNER` self-join would drop that row).

<div class="jv"><div class="row">
<table class="o auto"><caption>employees e</caption>
<tr><th>emp_id</th><th>name</th><th>mgr_id</th></tr>
<tr><td class="o">1</td><td class="o">Dana</td><td class="x">NULL</td></tr>
<tr><td class="o">2</td><td class="o">Evan</td><td class="o">1</td></tr>
<tr><td class="o">3</td><td class="o">Priya</td><td class="o">1</td></tr>
</table>
<table class="c auto"><caption>employees m</caption>
<tr><th>emp_id</th><th>name</th><th>mgr_id</th></tr>
<tr><td class="c">1</td><td class="c">Dana</td><td class="x">NULL</td></tr>
<tr><td class="c">2</td><td class="c">Evan</td><td class="c">1</td></tr>
<tr><td class="c">3</td><td class="c">Priya</td><td class="c">1</td></tr>
</table>
</div>
<table class="res auto"><caption>&rarr; result</caption>
<tr><th>employee</th><th>manager</th></tr>
<tr><td class="o">Dana</td><td class="x">NULL</td></tr>
<tr><td class="o">Evan</td><td class="c">Dana</td></tr>
<tr><td class="o">Priya</td><td class="c">Dana</td></tr>
</table>
</div>

`e` supplies the `employee` column, `m` supplies the `manager` column — same table, two roles.

</div>

---

*Part of [Advanced SQL & Database Programmability](Data-and-Persistence/advanced-sql-programmability).*
