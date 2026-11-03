# LATERAL Joins & Pivot / Unpivot

### The Problem
Two common reporting needs that normal `JOIN` and `GROUP BY` handle badly:

**Problem 1 — "For each row, run a small query that depends on that row."**
Example: *show each customer with their 3 most recent orders.*
```
customers                 orders
+----+-------+            +----+-------------+------------+
| id | name  |            | id | customer_id | created_at |
+----+-------+            +----+-------------+------------+
| 1  | Asha  |            | 10 | 1           | Jan 01     |
| 2  | Ben   |            | 11 | 1           | Jan 05     |
+----+-------+            | 12 | 1           | Jan 09     |  ... and many more
                          | 13 | 2           | Jan 02     |
                          +----+-------------+------------+
```
A normal `JOIN` returns **all** orders. `LIMIT 3` cuts the **whole** result, not each customer's rows. A subquery in the `FROM` clause normally can't refer to columns of tables listed before it.

**Problem 2 — "Turn rows into columns" (or columns into rows).**
```
Data is stored as rows:                  Report wants columns:
+-------+---------+-------+              +-------+------+------+------+------+
| month | product | sales |              | month | Pen  | Book | Bag  | ...  |
+-------+---------+-------+     ──►      +-------+------+------+------+------+
| Jan   | Pen     | 100   |              | Jan   | 100  | 50   | 20   |
| Jan   | Book    | 50    |              | Feb   | 120  | 40   | 25   |
| Jan   | Bag     | 20    |              +-------+------+------+------+------+
| Feb   | Pen     | 120   |
...
```
`GROUP BY` alone gives one long list, not a cross-table (a *pivot table* like in Excel).

### What It Solves
- **LATERAL join** (PostgreSQL / MySQL 8.0.14+: `LATERAL`; SQL Server / Oracle: `CROSS APPLY` / `OUTER APPLY`) lets a subquery on the right side **use columns of the table on its left**, like a `for each` loop in SQL.
- **PIVOT** turns distinct row values into columns (using aggregation). **UNPIVOT** does the reverse. In databases without a `PIVOT` keyword (MySQL, PostgreSQL) we use **conditional aggregation**, which works everywhere.

### How It Works

## Part 1 — LATERAL

#### 1. The idea: "for each row, run this subquery"
```
for each customer c:                      -- the left side drives the loop
    run:  SELECT ... FROM orders o WHERE o.customer_id = c.id ORDER BY created_at DESC LIMIT 3
                                                   ▲ the subquery can SEE c.id (that is "lateral")
    attach the result rows to c
```
```
customers   LATERAL subquery (runs once per customer)
 Asha(1) ─► orders of 1, newest 3 ─► (12, 11, 10)
 Ben(2)  ─► orders of 2, newest 3 ─► (13)
```

#### 2. Top-N per group with LATERAL
```sql
-- PostgreSQL and MySQL 8.0.14+
SELECT c.name, o.id AS order_id, o.created_at
FROM customers c
JOIN LATERAL (                       -- "LATERAL" allows the subquery to see c
    SELECT id, created_at
    FROM orders
    WHERE customer_id = c.id         -- uses the current customer row from the outer query
    ORDER BY created_at DESC         -- newest first
    LIMIT 3                          -- LIMIT now applies PER customer, which a normal join can't do
) o ON TRUE;                         -- the filtering is already inside, so the join condition is always true
```
Result:
```
+-------+----------+------------+
| name  | order_id | created_at |
+-------+----------+------------+
| Asha  | 12       | Jan 09     |
| Asha  | 11       | Jan 05     |
| Asha  | 10       | Jan 01     |
| Ben   | 13       | Jan 02     |
+-------+----------+------------+
```

**`JOIN LATERAL` vs `LEFT JOIN LATERAL`:** like inner vs left join. A customer with **no orders** disappears with `JOIN`; they stay (with NULLs) with `LEFT JOIN LATERAL ... ON TRUE`.
```sql
SELECT c.name, o.id
FROM customers c
LEFT JOIN LATERAL (
    SELECT id FROM orders WHERE customer_id = c.id ORDER BY created_at DESC LIMIT 1
) o ON TRUE;          -- customers without orders still appear, with o.id = NULL
```

**SQL Server / Oracle syntax:**
```sql
SELECT c.name, o.id
FROM customers c
CROSS APPLY (SELECT TOP 3 id FROM orders WHERE customer_id = c.id ORDER BY created_at DESC) o;
-- OUTER APPLY = like LEFT JOIN LATERAL
```

#### 3. Other uses of LATERAL
**a) Reuse a calculation instead of repeating it**
```sql
-- Compute discounted price once, then use it twice
SELECT p.name, calc.final_price, calc.final_price * 0.1 AS tax
FROM products p
CROSS JOIN LATERAL (SELECT p.price * (1 - p.discount) AS final_price) calc;
```
**b) Expand an array / JSON per row** (very common in PostgreSQL)
```sql
-- Each order has a JSON array of items; give one output row per item
SELECT o.id, item->>'sku' AS sku
FROM orders o
CROSS JOIN LATERAL jsonb_array_elements(o.items) AS item;
-- MySQL equivalent uses JSON_TABLE(o.items, '$[*]' COLUMNS(sku VARCHAR(20) PATH '$.sku'))
```
(See [Handling JSON](Data-and-Persistence/advanced-sql/handling-json).)

**c) Nearest-neighbour style queries** ("closest 3 stores to each customer") — a lateral subquery ordered by distance with `LIMIT 3`.

#### 4. LATERAL vs alternatives
| Technique | Top-N per group | Notes |
|---|---|---|
| `LATERAL` + `LIMIT` | Yes, clear | Fast with an index on `(customer_id, created_at DESC)`: each loop step is an index range read |
| Window function `ROW_NUMBER()` + filter | Yes | Ranks **all** rows first, then discards; can be slower when most rows are thrown away (see [Window Functions](Data-and-Persistence/advanced-sql/window-functions)) |
| Correlated subquery in `SELECT` | Only one value per row | Can't return multiple rows/columns |

Rule: with a **small outer set** and a **good index**, LATERAL is excellent. For ranking the *entire* table, window functions are usually better.

---

## Part 2 — PIVOT / UNPIVOT

#### 5. Pivot with conditional aggregation (works in every database)
**Sample data:**
```sql
CREATE TABLE sales (month VARCHAR(3), product VARCHAR(10), amount INT);
INSERT INTO sales VALUES
('Jan','Pen',100), ('Jan','Book',50), ('Jan','Bag',20),
('Feb','Pen',120), ('Feb','Book',40), ('Feb','Bag',25);
```
**Pivot: one row per month, one column per product**
```sql
SELECT
    month,
    -- For each product column: add up amount only when the row matches, otherwise add 0
    SUM(CASE WHEN product = 'Pen'  THEN amount ELSE 0 END) AS Pen,
    SUM(CASE WHEN product = 'Book' THEN amount ELSE 0 END) AS Book,
    SUM(CASE WHEN product = 'Bag'  THEN amount ELSE 0 END) AS Bag,
    SUM(amount)                                             AS total   -- bonus: row total
FROM sales
GROUP BY month;
```
**How it works, step by step:**
```
Step 1: GROUP BY month  -> groups: [Jan rows] and [Feb rows]

Step 2: for the Jan group, each CASE column looks at every row:
  row (Pen ,100): Pen col -> 100, Book col -> 0,  Bag col -> 0
  row (Book, 50): Pen col -> 0,   Book col -> 50, Bag col -> 0
  row (Bag , 20): Pen col -> 0,   Book col -> 0,  Bag col -> 20
  SUM per column: Pen=100, Book=50, Bag=20

Step 3: result
+-------+-----+------+-----+-------+
| month | Pen | Book | Bag | total |
+-------+-----+------+-----+-------+
| Jan   | 100 | 50   | 20  | 170   |
| Feb   | 120 | 40   | 25  | 185   |
+-------+-----+------+-----+-------+
```
- Use `ELSE NULL` (omit ELSE) when you want empty cells to be NULL instead of 0.
- Use `COUNT(CASE WHEN ... THEN 1 END)` to pivot **counts**.
- PostgreSQL shortcut: `SUM(amount) FILTER (WHERE product = 'Pen') AS Pen`.

```sql
-- Count orders per status as columns
SELECT customer_id,
       COUNT(CASE WHEN status = 'PAID'      THEN 1 END) AS paid,
       COUNT(CASE WHEN status = 'CANCELLED' THEN 1 END) AS cancelled
FROM orders
GROUP BY customer_id;
```

#### 6. Native PIVOT (SQL Server / Oracle)
```sql
-- SQL Server
SELECT *
FROM (SELECT month, product, amount FROM sales) src
PIVOT (
    SUM(amount)                        -- aggregate to fill cells
    FOR product IN ([Pen], [Book], [Bag])   -- these row values become columns (must be listed!)
) p;
```
PostgreSQL has the `crosstab()` function in the `tablefunc` extension; it is harder to use than conditional aggregation.

#### 7. The big limitation: columns must be known in advance
SQL needs to know the result columns **before** it runs. If the products change (new product added), your query must change.

**Dynamic pivot (build the SQL text, then run it):**
```sql
-- MySQL: build the column list from the data, then execute
SET @cols = (
  SELECT GROUP_CONCAT(DISTINCT
           CONCAT('SUM(CASE WHEN product = ''', product, ''' THEN amount ELSE 0 END) AS `', product, '`'))
  FROM sales);

SET @sql = CONCAT('SELECT month, ', @cols, ' FROM sales GROUP BY month');

PREPARE stmt FROM @sql;     -- build a prepared statement from the text
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
```
> **Security warning:** when you build SQL from data, **escape/validate** the values (an attacker-controlled product name could inject SQL). See [Database Security](Data-and-Persistence/advanced-sql/database-security). Often it is simpler and safer to run a plain `GROUP BY month, product` query and **pivot in application code**:

```java
// Java: pivot in code: Map<month, Map<product, amount>>
Map<String, Map<String, Integer>> table = new LinkedHashMap<>();
try (ResultSet rs = stmt.executeQuery("SELECT month, product, SUM(amount) a FROM sales GROUP BY month, product")) {
    while (rs.next()) {
        table.computeIfAbsent(rs.getString("month"), k -> new LinkedHashMap<>())
             .put(rs.getString("product"), rs.getInt("a"));      // each (month, product) becomes a cell
    }
}
```
```php
// PHP: same idea
$table = [];
foreach ($pdo->query('SELECT month, product, SUM(amount) a FROM sales GROUP BY month, product') as $r) {
    $table[$r['month']][$r['product']] = (int) $r['a'];   // $table['Jan']['Pen'] = 100
}
```

#### 8. UNPIVOT — columns into rows
**Problem:** a table with a column per quarter.
```
+------+----+----+----+----+
| prod | Q1 | Q2 | Q3 | Q4 |           want:   prod | quarter | amount
+------+----+----+----+----+                   Pen  | Q1      | 10
| Pen  | 10 | 20 | 15 | 30 |  ──►              Pen  | Q2      | 20
+------+----+----+----+----+                   ...
```
**Portable way: `UNION ALL`**
```sql
SELECT prod, 'Q1' AS quarter, Q1 AS amount FROM quarterly
UNION ALL SELECT prod, 'Q2', Q2 FROM quarterly
UNION ALL SELECT prod, 'Q3', Q3 FROM quarterly
UNION ALL SELECT prod, 'Q4', Q4 FROM quarterly;      -- UNION ALL: no duplicate removal, faster
```
**Modern way: LATERAL + VALUES (scans the table once)**
```sql
-- PostgreSQL
SELECT q.prod, v.quarter, v.amount
FROM quarterly q
CROSS JOIN LATERAL (VALUES ('Q1', q.q1), ('Q2', q.q2), ('Q3', q.q3), ('Q4', q.q4)) AS v(quarter, amount);
```
**SQL Server:** `UNPIVOT (amount FOR quarter IN (Q1, Q2, Q3, Q4))`.

> Having to unpivot is often a hint that the table design should store quarters as **rows** in the first place (see [Normalization](Data-and-Persistence/advanced-sql/normalization), 1NF: no repeating column groups).

#### 9. Rollups and totals (often needed in pivot reports)
```sql
-- GROUP BY ROLLUP adds subtotal and grand-total rows
SELECT month, product, SUM(amount) AS amount
FROM sales
GROUP BY ROLLUP (month, product);       -- PostgreSQL. MySQL: GROUP BY month, product WITH ROLLUP
```
```
Jan | Pen  | 100
Jan | Book | 50
Jan | Bag  | 20
Jan | NULL | 170    <- subtotal for Jan (NULL means "all products")
Feb | ...
NULL| NULL | 355    <- grand total
```
Also `CUBE` (all combinations) and `GROUPING SETS` (choose exactly which groupings).

### Time & Space Complexity
- **LATERAL:** the subquery runs once per outer row: cost ≈ **N × (cost of subquery)**. With a good index each run is O(log M + k) (k = rows returned), so total ≈ **O(N · (log M + k))**. Without an index each run may scan the table: **O(N · M)**.
- **Conditional-aggregation pivot:** one pass over the table, O(rows) time, memory proportional to number of groups × columns.
- **UNION ALL unpivot:** scans the table once per column listed (K scans). The LATERAL + VALUES version scans once.
- **Dynamic pivot:** extra step to read distinct values (O(rows) or index-assisted), then the pivot itself.

### Alternatives
| Need | Option |
|---|---|
| Top-N per group | Window functions with `ROW_NUMBER()` |
| Pivot with unknown columns | Pivot in application code, or BI tools (Excel pivot, Metabase, Superset) |
| Heavy cross-tab analytics | Data warehouse with native pivot (BigQuery, Snowflake `PIVOT`) |
| Flexible attributes per row | JSON column instead of many columns |

### Common Mistakes
- Using `LATERAL` without an index on the inner filter/sort columns (loops become full scans).
- Forgetting `ON TRUE` after `JOIN LATERAL` (syntax error) or using inner join and losing rows with no matches.
- Hard-coding pivot columns and forgetting to update them.
- Building dynamic pivot SQL from untrusted values.
- Forgetting that `SUM(CASE...)` with no matching rows gives 0 only if you wrote `ELSE 0`; otherwise NULL.

### Quick Interview Answers
- **What does LATERAL do?** Lets a subquery in `FROM` reference columns from earlier tables, running once per outer row (a SQL `for each`).
- **How do you get the top 3 orders per customer?** `JOIN LATERAL (... WHERE customer_id = c.id ORDER BY created_at DESC LIMIT 3)` or a window function with `ROW_NUMBER()`.
- **How to pivot in MySQL?** Conditional aggregation: `SUM(CASE WHEN col = 'x' THEN val END)` grouped by the row key.
- **Limitation of pivot?** Output columns must be known when the query is written; otherwise use dynamic SQL or do it in the app.
- **What is `CROSS APPLY`?** SQL Server/Oracle's name for `CROSS JOIN LATERAL`.
