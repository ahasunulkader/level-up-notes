# Window Functions

### The Problem
- You want to keep **every row** in your result *and* also show a calculation that looks at other rows — for example "each employee's salary **and** the average salary of their department", or "each day's sales **and** the running total so far".
- `GROUP BY` can't do this. It **collapses** many rows into one row per group, so the individual rows disappear.

**Picture the problem (GROUP BY loses rows):**
```
employees                         SELECT dept, AVG(salary) ... GROUP BY dept
+-------+------+--------+         +------+------------+
| name  | dept | salary |         | dept | avg_salary |
+-------+------+--------+         +------+------------+
| Asha  | IT   | 5000   |         | IT   | 5500       |   <- Asha and Ben are GONE
| Ben   | IT   | 6000   |  ---->  | HR   | 4000       |   <- Cara is GONE
| Cara  | HR   | 4000   |         +------+------------+
+-------+------+--------+         3 rows became 2 rows. We lost the names.
```

- Old workarounds: a self-join, or a correlated subquery for each calculation. They work, but they are long, slow, and hard to read.

### What It Solves
- A **window function** does a calculation across a set of related rows (the "window") **without collapsing them**. Every input row stays in the output, and a new column is added next to it.
- Think of it like this: for each row, the database opens a small "window" over some neighbouring rows, looks through it, writes down an answer, and then moves to the next row.

**Same data with a window function — nothing is lost:**
```
SELECT name, dept, salary, AVG(salary) OVER (PARTITION BY dept) AS dept_avg

+-------+------+--------+----------+
| name  | dept | salary | dept_avg |
+-------+------+--------+----------+
| Asha  | IT   | 5000   | 5500     |   <- row kept, avg added
| Ben   | IT   | 6000   | 5500     |   <- row kept, avg added
| Cara  | HR   | 4000   | 4000     |   <- row kept, avg added
+-------+------+--------+----------+
3 rows in, 3 rows out.
```

### How It Works

#### The anatomy of a window function
```sql
function_name(column)  OVER (
    PARTITION BY col      -- (optional) split rows into groups. Like GROUP BY, but rows are NOT collapsed
    ORDER BY col          -- (optional) order of rows INSIDE each group
    ROWS BETWEEN ... AND ...   -- (optional) the "frame": which rows around the current row to look at
)
```

| Part | What it does | Easy way to think |
|---|---|---|
| `function_name` | What to calculate (`SUM`, `RANK`, `LAG` ...) | "What do I want to know?" |
| `OVER (...)` | Marks this as a window function | "Look through a window" |
| `PARTITION BY` | Splits rows into separate groups | "Restart the calculation for every group" |
| `ORDER BY` | Sorts rows inside each group | "Which row comes first?" |
| Frame (`ROWS`/`RANGE`) | Which rows are visible from the current row | "How wide is my window?" |

**Visual: PARTITION BY + ORDER BY**
```
Whole table                After PARTITION BY dept       After ORDER BY salary DESC (inside each)
+------+--------+          +---------------------+       +---------------------+
| IT   | 5000   |          | PARTITION: IT       |       | PARTITION: IT       |
| HR   | 4000   |  ----->  |   IT 5000           | ----> |   IT 6000  (1st)    |
| IT   | 6000   |          |   IT 6000           |       |   IT 5000  (2nd)    |
| HR   | 4500   |          | PARTITION: HR       |       | PARTITION: HR       |
+------+--------+          |   HR 4000           |       |   HR 4500  (1st)    |
                           |   HR 4500           |       |   HR 4000  (2nd)    |
                           +---------------------+       +---------------------+
```

#### Sample table used in all examples below
```sql
CREATE TABLE employees (
    id     INT PRIMARY KEY,
    name   VARCHAR(50),
    dept   VARCHAR(20),
    salary INT
);

INSERT INTO employees VALUES
(1, 'Asha', 'IT', 6000),
(2, 'Ben',  'IT', 6000),   -- same salary as Asha on purpose (shows ties)
(3, 'Chen', 'IT', 5000),
(4, 'Dina', 'HR', 4500),
(5, 'Esra', 'HR', 4000);
```

---

#### 1. Aggregate window functions — `SUM / AVG / COUNT / MIN / MAX ... OVER`
Same functions you already know, but they keep the rows.

```sql
SELECT
    name,
    dept,
    salary,
    -- Average of the whole department, shown on every row of that department
    AVG(salary) OVER (PARTITION BY dept)            AS dept_avg,
    -- How far is this person from their department average?
    salary - AVG(salary) OVER (PARTITION BY dept)   AS diff_from_avg,
    -- Share of the department's total payroll
    ROUND(100.0 * salary / SUM(salary) OVER (PARTITION BY dept), 1) AS pct_of_dept
FROM employees;
```
```
+------+------+--------+----------+---------------+-------------+
| name | dept | salary | dept_avg | diff_from_avg | pct_of_dept |
+------+------+--------+----------+---------------+-------------+
| Asha | IT   | 6000   | 5666.67  | +333.33       | 35.3        |
| Ben  | IT   | 6000   | 5666.67  | +333.33       | 35.3        |
| Chen | IT   | 5000   | 5666.67  | -666.67       | 29.4        |
| Dina | HR   | 4500   | 4250.00  | +250.00       | 52.9        |
| Esra | HR   | 4000   | 4250.00  | -250.00       | 47.1        |
+------+------+--------+----------+---------------+-------------+
```

---

#### 2. Ranking functions — `ROW_NUMBER`, `RANK`, `DENSE_RANK`, `NTILE`
These give each row a position number inside its partition. The **only difference is how they treat ties** (same value).

```sql
SELECT
    name, dept, salary,
    ROW_NUMBER() OVER (PARTITION BY dept ORDER BY salary DESC) AS row_num,
    RANK()       OVER (PARTITION BY dept ORDER BY salary DESC) AS rnk,
    DENSE_RANK() OVER (PARTITION BY dept ORDER BY salary DESC) AS dense_rnk
FROM employees;
```
```
IT department (Asha and Ben are tied at 6000)
+------+--------+---------+-----+-----------+
| name | salary | row_num | rnk | dense_rnk |
+------+--------+---------+-----+-----------+
| Asha | 6000   | 1       | 1   | 1         |
| Ben  | 6000   | 2       | 1   | 1         |  <- tie
| Chen | 5000   | 3       | 3   | 2         |  <- RANK skips 2, DENSE_RANK does not
+------+--------+---------+-----+-----------+
```

| Function | Tie handling | Numbers you get | Use it when |
|---|---|---|---|
| `ROW_NUMBER()` | Never ties. Ties get different numbers (order is arbitrary unless you add a tie-breaker) | 1, 2, 3, 4 | You need exactly one row per rank (e.g. "pick the latest row") |
| `RANK()` | Ties share a number, then **gaps** appear | 1, 1, 3, 4 | Olympic-style: two golds, no silver, next is bronze |
| `DENSE_RANK()` | Ties share a number, **no gaps** | 1, 1, 2, 3 | "Top 3 distinct salaries" |
| `NTILE(n)` | Splits rows into `n` equal buckets | 1,1,2,2,3 | Quartiles, percentiles, "top 25%" |

```sql
-- NTILE(2): split each department into top half (1) and bottom half (2)
SELECT name, dept, salary,
       NTILE(2) OVER (PARTITION BY dept ORDER BY salary DESC) AS half
FROM employees;
```

**Classic task: "Top N per group" (very common in interviews)**
```sql
-- Problem: show the top 2 earners in EACH department.
-- You cannot use LIMIT 2 (that limits the whole result, not each group).
-- Solution: rank inside each group, then keep rank <= 2.
SELECT *
FROM (
    SELECT name, dept, salary,
           DENSE_RANK() OVER (PARTITION BY dept ORDER BY salary DESC) AS rnk
    FROM employees
) ranked                 -- a window function can't be used in WHERE directly,
WHERE rnk <= 2;          -- so we wrap it in a subquery (or CTE) first
```

**Classic task: remove duplicates, keep one row**
```sql
-- Keep the newest row for each email, find the rest as "duplicates"
SELECT * FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY email ORDER BY created_at DESC) AS rn
    FROM users
) t
WHERE rn > 1;      -- rn = 1 is the one we keep, rn > 1 are duplicates to delete
```

---

#### 3. Value functions — `LAG`, `LEAD`, `FIRST_VALUE`, `LAST_VALUE`, `NTH_VALUE`
These let a row **peek at another row** (before, after, first or last of the window).

```
Rows in order:      Jan     Feb     Mar     Apr
                     |       |       |       |
LAG(sales)   =       -      Jan     Feb     Mar    <- looks 1 row BACK
LEAD(sales)  =      Feb     Mar     Apr      -     <- looks 1 row FORWARD
```

```sql
CREATE TABLE monthly_sales (month DATE, sales INT);
INSERT INTO monthly_sales VALUES
('2026-01-01', 100), ('2026-02-01', 150), ('2026-03-01', 120), ('2026-04-01', 200);

SELECT
    month,
    sales,
    LAG(sales)  OVER (ORDER BY month)  AS prev_month,     -- NULL for the first row (nothing before it)
    LEAD(sales) OVER (ORDER BY month)  AS next_month,     -- NULL for the last row
    -- Month-over-month change. The 3rd LAG argument (default) makes the first row compare with itself, so change = 0 instead of NULL
    sales - LAG(sales, 1, sales) OVER (ORDER BY month) AS change   -- 3rd arg = default when no previous row
FROM monthly_sales;
```
```
+------------+-------+------------+------------+--------+
| month      | sales | prev_month | next_month | change |
+------------+-------+------------+------------+--------+
| 2026-01-01 | 100   | NULL       | 150        | 0      |
| 2026-02-01 | 150   | 100        | 120        | +50    |
| 2026-03-01 | 120   | 150        | 200        | -30    |
| 2026-04-01 | 200   | 120        | NULL       | +80    |
+------------+-------+------------+------------+--------+
```

- `LAG(col, n, default)` — look `n` rows back (default `n = 1`).
- `LEAD(col, n, default)` — look `n` rows forward.
- `FIRST_VALUE(col)` / `LAST_VALUE(col)` — the first/last row of the **frame** (see the warning in the frame section below, `LAST_VALUE` surprises beginners).

---

#### 4. The frame — `ROWS` vs `RANGE` (the "how wide is the window" part)
When you add `ORDER BY` inside `OVER`, the window is no longer the whole partition. By default it becomes **"from the first row up to the current row"**. That is what makes **running totals** work.

```sql
-- Running total of sales
SELECT month, sales,
       SUM(sales) OVER (ORDER BY month) AS running_total
FROM monthly_sales;
```
```
+------------+-------+---------------+
| month      | sales | running_total |
+------------+-------+---------------+
| 2026-01-01 | 100   | 100           |  = 100
| 2026-02-01 | 150   | 250           |  = 100 + 150
| 2026-03-01 | 120   | 370           |  = 100 + 150 + 120
| 2026-04-01 | 200   | 570           |  = 100 + 150 + 120 + 200
+------------+-------+---------------+
```

**Controlling the frame yourself:**
```
ROWS BETWEEN <start> AND <end>

Start / end choices:
  UNBOUNDED PRECEDING   = the very first row of the partition
  n PRECEDING           = n rows before the current row
  CURRENT ROW           = the row we are on
  n FOLLOWING           = n rows after the current row
  UNBOUNDED FOLLOWING   = the very last row of the partition
```

**Visual — 3-row moving average (`ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING`):**
```
Row:        r1     r2     r3     r4     r5
Value:      10     20     30     40     50

For r3 (current):        [ r2    r3    r4 ]      -> avg(20,30,40) = 30
                           ^             ^
                       1 PRECEDING   1 FOLLOWING

For r1 (edge):        [ r1    r2 ]               -> avg(10,20) = 15   (no row before it)
```

```sql
SELECT month, sales,
       -- 3-month moving average: previous month, this month, next month
       ROUND(AVG(sales) OVER (
           ORDER BY month
           ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING
       ), 1) AS moving_avg_3
FROM monthly_sales;
```

**`ROWS` vs `RANGE` — what's the difference?**

| | `ROWS` | `RANGE` |
|---|---|---|
| Counts by | Physical **row positions** | **Values** of the `ORDER BY` column |
| Rows with the same `ORDER BY` value | Treated one by one | All tied rows are included **together** (they are "peers") |
| Predictable? | Yes | Can surprise you when there are ties |
| Default when `ORDER BY` is present | – | `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW` |

```
Two rows have the same date (tie):

date        amount    SUM ROWS (running)   SUM RANGE (default running)
Jan 1       10        10                   10
Jan 2       20        30                   80   <- RANGE adds BOTH Jan-2 rows at once
Jan 2       50        80                   80
Jan 3       5         85                   85
```
Rule of thumb: **write `ROWS` explicitly** when you want a true row-by-row running total.

> **Warning — `LAST_VALUE` trap.** With the default frame (up to the current row) `LAST_VALUE(x)` just returns the **current** row's value, because the "last visible row" is the current one. Fix it by widening the frame:
> ```sql
> LAST_VALUE(salary) OVER (
>     PARTITION BY dept ORDER BY salary
>     ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING   -- see the whole group
> )
> ```

---

#### 5. Named windows — avoid repeating yourself
```sql
-- Define the window once with the WINDOW clause, reuse it by name
SELECT name, dept, salary,
       RANK()       OVER w AS rnk,
       SUM(salary)  OVER w AS running_payroll
FROM employees
WINDOW w AS (PARTITION BY dept ORDER BY salary DESC);   -- MySQL 8+, PostgreSQL
```

---

#### 6. Gaps and islands (advanced, popular interview puzzle)
**Problem:** find streaks of consecutive days a user logged in. Each streak is an "island"; missing days are "gaps".

```
Login days:   1  2  3     6  7     10
              \_island A_/  \_B_/    C
                       gap       gap
```

**Trick:** `date - ROW_NUMBER()` is the **same value** for every date in one streak.

```sql
-- user_logins(user_id, login_date)  - one row per user per day
WITH numbered AS (
    SELECT user_id, login_date,
           -- 1,2,3,4... per user in date order
           ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY login_date) AS rn
    FROM user_logins
),
grouped AS (
    SELECT user_id, login_date,
           -- Consecutive days minus consecutive numbers = constant => same island id
           -- (PostgreSQL syntax: date - integer. MySQL: DATE_SUB(login_date, INTERVAL rn DAY))
           login_date - rn * INTERVAL '1 day' AS island_id
    FROM numbered
)
SELECT user_id,
       MIN(login_date) AS streak_start,
       MAX(login_date) AS streak_end,
       COUNT(*)        AS streak_days
FROM grouped
GROUP BY user_id, island_id;     -- one output row per streak
```
```
login_date   rn    login_date - rn      island_id
Jan 01       1     Dec 31               Dec 31  \
Jan 02       2     Dec 31               Dec 31   >-- same island (streak of 3)
Jan 03       3     Dec 31               Dec 31  /
Jan 06       4     Jan 02               Jan 02  --- new island (gap broke the pattern)
```

---

#### Where can you use window functions?
```
Order SQL is evaluated (simplified):

 FROM -> WHERE -> GROUP BY -> HAVING -> [ WINDOW FUNCTIONS ] -> SELECT -> ORDER BY -> LIMIT
                                              ^
                       Window functions run AFTER WHERE/GROUP BY/HAVING
```
- You can use them only in `SELECT` and `ORDER BY`.
- You **cannot** write `WHERE rnk <= 2` on a window function in the same query level. Wrap in a subquery or CTE (as shown in "Top N per group").

### Java — running a window query with JDBC
```java
String sql = """
    SELECT name, dept, salary,
           RANK() OVER (PARTITION BY dept ORDER BY salary DESC) AS rnk
    FROM employees
    """;

try (Connection conn = dataSource.getConnection();
     PreparedStatement ps = conn.prepareStatement(sql);
     ResultSet rs = ps.executeQuery()) {
    while (rs.next()) {
        // The window column is read like any normal column
        System.out.println(rs.getString("name") + " rank " + rs.getInt("rnk"));
    }
}
```

### PHP — running a window query with PDO
```php
$sql = "SELECT name, dept, salary,
               RANK() OVER (PARTITION BY dept ORDER BY salary DESC) AS rnk
        FROM employees";

foreach ($pdo->query($sql) as $row) {
    // Window result is just another column in the row
    echo $row['name'] . ' rank ' . $row['rnk'] . PHP_EOL;
}
```

### Time & Space Complexity
- **Time:** the database must group rows by `PARTITION BY` and sort them by `ORDER BY`. Sorting is the expensive part: roughly **O(n log n)** for `n` rows (or much less if an index already gives the order, so it can skip the sort).
- Computing the function after sorting is usually **O(n)**. A sliding frame (moving average) is also O(n) in good engines because they add the new row and remove the old row instead of re-adding everything.
- **Space:** the engine often keeps each partition in memory (or spills to disk). One huge partition (e.g. no `PARTITION BY` on 100M rows) can be very slow and memory-hungry.
- **Tip:** an index on `(partition_col, order_col)` lets the database read rows already in the right order and avoid the sort.

```
Index on (dept, salary)              Without the index
Rows already grouped + sorted        1. read all rows
-> just stream through them          2. sort by dept, salary   <- the slow part
                                     3. compute
```

### Alternatives (and when window functions are better)
| Need | Without window function | Why window is better |
|---|---|---|
| Row + group average | Self-join or correlated subquery | One pass instead of re-querying per row |
| Running total | Self-join `ON b.date <= a.date` (O(n²)) | O(n log n), far shorter SQL |
| Top N per group | Correlated subquery with `COUNT(*)` | Clear and fast |
| Previous row value | Self-join on `id - 1` (breaks with gaps) | `LAG` works even if IDs have gaps |
| Pick one row per group | `GROUP BY` + join back to the table | `ROW_NUMBER() ... WHERE rn = 1` |

Use `GROUP BY` instead when you really **want** fewer rows (a summary report).

### Common Mistakes
- Forgetting `ORDER BY` in `ROW_NUMBER()` — the numbering becomes random.
- Using `RANK` when you need exactly one row per group (use `ROW_NUMBER`).
- Using `RANGE` (the default) for a running total with ties and getting unexpected equal totals.
- Trying to filter a window result in `WHERE` instead of a subquery/CTE.
- `LAST_VALUE` returning the current row because of the default frame.

### Quick Interview Answers
- **Window function vs GROUP BY?** `GROUP BY` collapses rows; a window function keeps every row and adds a computed column.
- **RANK vs DENSE_RANK vs ROW_NUMBER?** Ties: `RANK` shares numbers and leaves gaps; `DENSE_RANK` shares numbers without gaps; `ROW_NUMBER` never shares.
- **How to get the Nth highest salary?** `DENSE_RANK() OVER (ORDER BY salary DESC)` then filter `= N` in an outer query.
- **Availability:** MySQL 8.0+, PostgreSQL 8.4+, SQL Server 2005+, Oracle, SQLite 3.25+. **Not available in MySQL 5.7.**
