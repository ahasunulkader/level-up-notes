# Advanced SQL & Database Programmability — Joins to Sharding (Java & PHP)

## TL;DR
This is the "everything a Senior Backend Engineer should be fluent in" reference for relational databases — from everyday **Joins** and **Indexes** to database-side programmability (**Views, Triggers, Procedures, Functions, Variables**) and scale-out concerns (**Partitioning, Sharding**). Every topic is written as **Problem → What It Solves → How It Works**, with a runnable SQL example plus how you'd actually touch it from **Java (JDBC)** and **PHP (PDO)** application code, because interviewers at large-scale tech companies care as much about "how does your app talk to the DB safely and fast" as they do about raw SQL syntax.

---

## Roadmap

```
                    DATABASE INTERVIEW SURFACE
                             │
      ┌──────────────┬───────┼───────┬──────────────┐
      │              │               │              │
   Querying     Programmability   Performance     Scale-Out
      │              │               │              │
   Joins         Views           Query Profiling  Partitioning
   Subqueries    Triggers        Indexing         Sharding
   CTEs          Procedures      Batch/Pooling
   Set Ops       Functions
   JSON          Variables
                 Constraints
                 Transactions
```

---

## 1. Joins

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

### Time & Space Complexity
- **Nested loop join (no index):** for every row in the outer table (`n` rows), scan the whole inner table (`m` rows) looking for a match → **O(n × m) time**. This is what happens with no index on the join column.
- **Nested loop join with an index** on the join column: each of the `n` outer rows does an index seek into the inner table (`O(log m)`) → **O(n log m) time** total, instead of `O(n × m)`. This is the real reason "index your foreign keys" matters so much.
- **Hash join** (the planner's choice when no usable index exists, or for large joins): build an in-memory hash table on the smaller side (`O(m)` time and space), then probe it once per row of the larger side (`O(n)`) → **O(n + m) time, O(m) space**.
- **Merge join** (both sides already sorted, e.g. via an index): walk both sorted lists together once → **O(n + m) time, O(1) extra space**.
- **Why this matters:** the difference between an indexed and unindexed join is the difference between `O(n × m)` (unusable past a few thousand rows per side) and `O(n + m)`/`O(n log m)` (scales to millions of rows). `EXPLAIN` (§9) tells you which one the planner actually picked.

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

---

## 2. Indexes

### The Problem
- Without help, the database has to check **every row** in a table to find the ones matching your `WHERE` clause — this is called a full table scan.
- Full table scans are fine on a table with 100 rows, but on a table with 10 million rows, every query gets slower as the table grows.

### What It Solves
- An index is an extra data structure that lets the database **jump straight to matching rows** instead of scanning the whole table.
- The trade-off: reads get much faster, but every `INSERT`/`UPDATE`/`DELETE` now also has to update the index, and the index itself takes up extra disk space.

### How It Works
- Under the hood, an index is usually a **B-Tree** (sometimes a **Hash**, or **GIN**/**GiST** for JSON/full-text) — a structure built to find rows fast without reading the whole table.

```sql
CREATE INDEX idx_orders_user_id ON orders(user_id);          -- single-column
CREATE INDEX idx_orders_user_status ON orders(user_id, status); -- composite — left-prefix rule applies
CREATE UNIQUE INDEX idx_users_email ON users(email);          -- enforces uniqueness too

-- Covering index: query can be answered from the index alone, no table lookup
CREATE INDEX idx_orders_covering ON orders(user_id, status, total);
SELECT status, total FROM orders WHERE user_id = 42;  -- never touches the table

EXPLAIN SELECT * FROM orders WHERE user_id = 42;       -- MySQL/PostgreSQL
EXPLAIN ANALYZE SELECT * FROM orders WHERE user_id = 42; -- PostgreSQL: actual timing, not just plan
```

- **Left-prefix rule:** a composite index on `(user_id, status)` speeds up queries filtering on `user_id` alone or `user_id + status`, but **not** `status` alone.
- **When indexes hurt:**
  - Tables with heavy write volume and few reads — you're paying the index-update cost on every write for little read benefit.
  - Low-cardinality columns (e.g. a boolean `is_active`) — an index barely narrows the search since most rows share the same value.
  - Columns rarely used in `WHERE`/`JOIN`/`ORDER BY` — an unused index is pure overhead.

### Time & Space Complexity
- **Without an index:** the database checks every row → **O(n) time** per query, where `n` is the row count.
- **With a B-Tree index:** a lookup walks down the tree — **O(log n) time** to find the starting point, then `O(k)` to read the `k` matching rows. Going from `O(n)` to `O(log n)` is why a table with a million rows can answer an indexed lookup in microseconds instead of scanning everything.
- **Space cost:** an index is a second, smaller copy of the indexed columns plus pointers back to the real rows — roughly **O(n) extra disk space** per index. Five indexes on one table means five extra `O(n)` structures to store.
- **Write cost:** every `INSERT`/`UPDATE`/`DELETE` also has to update each index on that table — each index adds about **O(log n)** extra work per write. This is why "don't over-index a write-heavy table" matters: it's `O(log n)` extra work, multiplied by every index, on every single write.
- **Why use it:** you're trading `O(n)` reads for `O(log n)` reads, at the cost of `O(log n)` extra work per write and `O(n)` extra disk space per index. On a read-heavy table that trade is almost always worth it; on a write-heavy table with few reads, it can backfire.

### Java (JDBC) — reading a query plan
```java
try (Statement st = conn.createStatement();
     ResultSet rs = st.executeQuery("EXPLAIN SELECT * FROM orders WHERE user_id = 42")) {
    while (rs.next()) {
        System.out.println(rs.getString("key"));   // which index MySQL chose (or null = full scan)
    }
}
```

### PHP (PDO)
```php
$stmt = $pdo->query("EXPLAIN SELECT * FROM orders WHERE user_id = 42");
foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
    echo $row['key'] ?? 'NO INDEX USED (full scan)', "\n";
}
```

---

## 3. Constraints

### The Problem
- If nothing stops it, bad data can land in a column — a duplicate email, a negative balance, a missing required field — no matter which application, script, or person wrote it.
- Relying only on your application code to check data ("app-level validation") isn't enough: a different script, a manual DB edit, or a bug can bypass your app entirely and write bad data straight into the table.

### What It Solves
- Constraints are rules the **database itself** enforces on every write, so invalid data can never land in a column, regardless of what wrote it.
- This is the "belt" that backs up your "suspenders" (application-level validation) — you should have both, but the database should never depend on the app being correct.

### How It Works
- You declare the rule once on the column/table, and the database rejects any write that breaks it.

```sql
CREATE TABLE accounts (
    id         INT PRIMARY KEY AUTO_INCREMENT,
    email      VARCHAR(255) NOT NULL UNIQUE,
    balance    DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
    plan       ENUM('free','pro','enterprise') NOT NULL DEFAULT 'free',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE transfers (
    id           INT PRIMARY KEY AUTO_INCREMENT,
    account_id   INT NOT NULL,
    amount       DECIMAL(10,2) NOT NULL,
    FOREIGN KEY (account_id) REFERENCES accounts(id)
        ON DELETE CASCADE     -- delete transfers when the account is deleted
        ON UPDATE CASCADE
);
```

| Constraint | Purpose |
|---|---|
| `PRIMARY KEY` | Unique row identity, implicitly `NOT NULL` |
| `FOREIGN KEY` | Referential integrity — row must reference an existing row elsewhere |
| `UNIQUE` | No two rows share this value |
| `NOT NULL` | Column must always have a value |
| `CHECK` | Arbitrary boolean condition (e.g. `balance >= 0`) |
| `DEFAULT` | Value used when none is supplied |

- **FK cascade options:** `CASCADE` (propagate the change), `RESTRICT`/`NO ACTION` (block the parent delete), `SET NULL` (orphan the child row instead of deleting it).

### Time & Space Complexity
- **`UNIQUE` / `PRIMARY KEY`:** enforced with a hidden index, so "does this value already exist?" costs **O(log n)** per write — not `O(n)`, the database isn't scanning the whole table.
- **`FOREIGN KEY`:** checking "does the referenced row exist?" is also an index lookup on the parent table — **O(log n)**, assuming the referenced column is indexed (primary keys are, by default).
- **`CHECK` / `NOT NULL` / `DEFAULT`:** just evaluate a condition against the row being written — **O(1)** per row, no lookup involved.
- **Space:** constraints add negligible space themselves — the real cost is the index backing `UNIQUE`/`PRIMARY KEY`/`FOREIGN KEY`, the same **O(n)** as any index (§2).
- **Why this matters:** constraints don't turn writes into slow, unscalable operations — most are `O(1)` or `O(log n)`. "Always use constraints, never rely on app-only validation" is close to a free safety net, not a performance trade-off.

### Java — handling a constraint violation
```java
try (PreparedStatement ps = conn.prepareStatement(
        "INSERT INTO accounts (email, balance) VALUES (?, ?)")) {
    ps.setString(1, "duplicate@example.com");
    ps.setBigDecimal(2, BigDecimal.ZERO);
    ps.executeUpdate();
} catch (SQLIntegrityConstraintViolationException e) {
    // MySQL error code 1062 = duplicate key; PostgreSQL uses SQLState 23505
    throw new ConflictException("Email already registered");
}
```

### PHP (PDO)
```php
try {
    $stmt = $pdo->prepare("INSERT INTO accounts (email, balance) VALUES (?, ?)");
    $stmt->execute(['duplicate@example.com', 0]);
} catch (PDOException $e) {
    if ($e->getCode() === '23000') { // integrity constraint violation (both MySQL & Postgres SQLSTATE)
        throw new ConflictException('Email already registered');
    }
    throw $e;
}
```

---

## 4. Views

### The Problem
- Complex queries (multiple joins, aggregations, `GROUP BY`) are hard to read, easy to get wrong when copy-pasted, and painful to maintain if every caller repeats the whole query.
- Giving a team direct access to raw tables (`orders`, `users`) often means giving them **more** access than they need — every column, every row, no restriction.

### What It Solves
- A view is a **saved, named query** that behaves like a virtual table — callers just do `SELECT * FROM view_name` instead of repeating a complex query.
- Views can hide complexity, restrict which columns/rows are visible, and give a stable interface even while the real tables underneath change.
- Some views also store data physically (materialized views) for speed, and some can even be written through, with guard rails.

### How It Works
- Depending on the type, a view may or may not store data, be writable, or support its own indexes:

| View Type | Stores Data? | Updatable? | Typical Use |
|---|---|---|---|
| Simple View | No (re-run on read) | Usually yes | Thin wrapper over one table — hide columns/rows |
| Complex View | No | Usually no | Joins, aggregates, `GROUP BY` — reporting, hide complexity |
| Updatable View (`WITH CHECK OPTION`) | No | Yes, with rules | Let a client write through a restricted view safely |
| Materialized View | Yes (snapshot) | No (refresh instead) | Expensive aggregates/dashboards, read-heavy analytics |
| Indexed View (SQL Server) | Yes (materialized + indexed) | No | Always-fresh aggregate, no manual refresh needed |
| Recursive View | No | No | Rare — most DBs use a recursive CTE instead (§11) |
| Inline View / Derived Table | No | No | Subquery in `FROM`, scoped to one query, never persisted |
| System / Catalog View | N/A (metadata) | No | `information_schema`, `pg_catalog` — introspect the DB itself |

### Time & Space Complexity (Views, in general)
- **Simple/complex views (non-materialized):** a view has **zero storage cost** of its own, but that also means **zero speed benefit** by itself — querying it costs exactly the same as running its underlying query fresh every time (same complexity as whatever that query would be: `O(n)` for a scan, `O(log n)` for an indexed lookup). A view improves *readability and access control*, not performance.
- **Materialized/Indexed views:** trade **O(n) space** (the stored snapshot) for turning an expensive query into a cheap read (`O(log n)` with an index, close to `O(1)` for a direct lookup) — you pay the computation cost once, at refresh/write time, instead of on every read. See §4.4/§4.5 for exactly where that cost lands.

---

### 4.1 Simple Views

**The Problem**
- You want a stable, simple way to look at "just the active users" without repeating `WHERE status = 'active'` in every query across your codebase.

**What It Solves**
- A simple view wraps **one table** — no joins, no aggregation — and gives it a name you can query like a table.
- Because it's this simple, the database can usually figure out how to translate a write on the view back into a write on the real table, so it stays updatable.

**How It Works**
```sql
CREATE VIEW active_users AS
SELECT id, name, email
FROM users
WHERE status = 'active';

SELECT * FROM active_users;

-- Simple views are usually updatable — this really updates `users`
UPDATE active_users SET name = 'New Name' WHERE id = 1;
```

---

### 4.2 Complex Views

**The Problem**
- Reporting-style queries (joins + `GROUP BY` + aggregates like `SUM`/`COUNT`) are long, easy to get wrong, and painful to repeat across every report or dashboard query.

**What It Solves**
- A complex view saves that whole join/aggregate query under one name, so callers just do `SELECT * FROM the_view` instead of rewriting the join every time.
- Because the query touches multiple tables and aggregates values, the database can no longer figure out one single table to write back to — so these views are read-only by default.

**How It Works**
```sql
CREATE VIEW active_customer_summary AS
SELECT u.id, u.name, COUNT(o.id) AS order_count, SUM(o.total) AS lifetime_value
FROM users u
JOIN orders o ON u.id = o.user_id
WHERE u.status = 'active'
GROUP BY u.id;

SELECT * FROM active_customer_summary WHERE lifetime_value > 1000;

-- Rejected (or silently a no-op, depending on engine) — no single base table to target
-- UPDATE active_customer_summary SET lifetime_value = 0 WHERE id = 1;
```

---

### 4.3 Updatable Views & `WITH CHECK OPTION`

**The Problem**
- A simple view like `active_users` (only rows where `status = 'active'`) is updatable — writes pass through to the real `users` table.
- But what if someone uses that view to update a row's `status` to `'inactive'`? That row no longer matches `WHERE status = 'active'`, so right after the update, the row quietly falls out of the view.
- Nobody sees an error. The row still exists in the real `users` table — it's just no longer visible through `active_users`. If your team only ever looks at data through this view (for example, to keep access limited to active users), that row has effectively become invisible to them.
- This is especially risky when a view is used as a **security boundary** — for example, giving a support team access to only `active_users` so they never see banned/inactive accounts. If they can silently update a row so it disappears from their own view, that's a data-integrity and access-control bug, and it's hard to notice because there's no error at all.

**What It Solves**
- `WITH CHECK OPTION` adds a guard rail to the view: it blocks any write that would make the row disappear from the view's own `WHERE` clause.
- Instead of the row silently vanishing, the database throws a clear error at write time.

**How It Works**
```sql
CREATE VIEW active_users AS
SELECT id, name, status
FROM users
WHERE status = 'active'
WITH CHECK OPTION;

-- This tries to set status to 'inactive', which would make the row
-- disappear from the view's own WHERE status = 'active' condition.
UPDATE active_users SET status = 'inactive' WHERE id = 1;

-- Because of WITH CHECK OPTION, the database blocks it and shows an error
-- instead of silently letting the row vanish from the view:
-- ERROR: new row violates WITH CHECK OPTION for view "active_users"
```

- Step by step, what happens:
  1. We create a view that only shows users with `status = 'active'`.
  2. We add `WITH CHECK OPTION` — a guard rail on the view.
  3. Someone tries to update a row so it becomes `'inactive'`.
  4. Without the guard rail, this update would succeed, and the row would just quietly stop showing up in `active_users` — no error, no warning.
  5. With the guard rail, the database instead stops the update and gives an error, because the new row would break the view's own rule (`status = 'active'`).
- **Interview trap:** a lot of engineers assume a view's `WHERE` clause automatically protects writes too. It doesn't, unless you explicitly add `WITH CHECK OPTION`. Without it, `UPDATE`s can silently slip rows out of a view — a classic "where did my row go" bug, especially painful when the view is the only thing standing between a team and rows they're not supposed to touch.

---

### 4.4 Materialized Views

**The Problem**
- Some queries are expensive to run — heavy aggregations over millions of rows for a dashboard, for example. Running that query fresh on every page load is slow and wastes resources, especially if the underlying data doesn't change every second.

**What It Solves**
- A materialized view stores the query's result as an actual **physical snapshot** on disk. Reading it is as fast as reading a normal table, because there's no recomputation happening.
- The trade-off: the snapshot goes stale until you explicitly refresh it, so it's not the right tool when you need to-the-second freshness.

**How It Works**
```sql
CREATE MATERIALIZED VIEW daily_revenue AS
SELECT DATE(created_at) AS day, SUM(total) AS revenue
FROM orders
GROUP BY DATE(created_at);

-- Blocking refresh — locks the view against reads while it rebuilds
REFRESH MATERIALIZED VIEW daily_revenue;

-- Non-blocking refresh (PostgreSQL) — requires a UNIQUE index on the view first
CREATE UNIQUE INDEX idx_daily_revenue_day ON daily_revenue(day);
REFRESH MATERIALIZED VIEW CONCURRENTLY daily_revenue;

-- It's real, stored data, so you can index it like any other table
CREATE INDEX idx_daily_revenue_day_range ON daily_revenue(day);
```

- Refresh is usually **scheduled** — a cron job, a queue worker, or triggered after a batch ETL load — not something the application runs on every read.

**Time & Space Complexity:** building/refreshing the view costs exactly what running the underlying query once costs (e.g. `O(n)` for a full aggregation) — but that cost is paid **once per refresh**, not once per read. Reading afterward is as cheap as reading any normal table (`O(log n)` with an index). Space cost is **O(result size)**, not `O(source table size)` — a materialized view of daily totals can be far smaller than the orders table it's built from.

---

### 4.5 Indexed Views (SQL Server)

**The Problem**
- Materialized views (§4.4) are fast to read, but they go stale until someone runs `REFRESH`. Some systems need an aggregate that's **always** up to date, without a separate refresh job to manage.

**What It Solves**
- SQL Server's "indexed view" is a materialized view that also carries a **unique clustered index**, which forces the database to keep the stored result automatically in sync every time the underlying table changes — no manual `REFRESH` needed.

**How It Works**
```sql
CREATE VIEW dbo.daily_revenue
WITH SCHEMABINDING AS
SELECT CAST(created_at AS DATE) AS day, SUM(total) AS revenue, COUNT_BIG(*) AS cnt
FROM dbo.orders
GROUP BY CAST(created_at AS DATE);

CREATE UNIQUE CLUSTERED INDEX idx_daily_revenue ON dbo.daily_revenue(day);
```

- **Trade-off vs. Postgres materialized views:** always up to date, no manual refresh — but every write to `orders` now also pays the cost of maintaining the indexed view, closer to a trigger's write-amplification trade-off than a cheap read-side cache.

**Time & Space Complexity:** same **O(result size)** storage as a plain materialized view, but the refresh cost is no longer a scheduled batch — it shifts to every write: each `INSERT`/`UPDATE`/`DELETE` on the base table also pays `O(log n)`-ish work to keep the indexed view in sync, similar to maintaining an extra index (§2) or a trigger (§5). You get always-fresh `O(log n)` reads in exchange for a little extra cost on every write.

---

### 4.6 Recursive Views

**The Problem**
- Hierarchies (an org chart, a category tree, a comment thread) need a query that can walk "up" or "down" an unknown number of levels. A normal view can't express that kind of self-referencing logic.

**What It Solves**
- Standard SQL (and Oracle) technically allows `CREATE RECURSIVE VIEW`, but almost nobody uses it in practice — MySQL and PostgreSQL don't support it directly.
- The practical answer is a **recursive CTE** (§11) — optionally wrapped in a plain view so it's reusable under a simple name.

**How It Works**
```sql
-- PostgreSQL / MySQL 8+: wrap a recursive CTE in a plain view for reuse
CREATE VIEW org_chain AS
WITH RECURSIVE chain AS (
    SELECT id, name, manager_id, 1 AS depth FROM employees WHERE manager_id IS NULL
    UNION ALL
    SELECT e.id, e.name, e.manager_id, c.depth + 1
    FROM employees e JOIN chain c ON e.manager_id = c.id
)
SELECT * FROM chain;

SELECT * FROM org_chain WHERE depth <= 3;
```

---

### 4.7 Inline Views / Derived Tables

**The Problem**
- Sometimes you need an intermediate result (like per-department averages) just to filter or join against it once — but it's not worth permanently saving as a named database object.

**What It Solves**
- An inline view (a.k.a. derived table) is a subquery given an alias inside a `FROM` clause. It behaves like a view but is **scoped to a single query** and disappears once that query finishes — nothing is saved.

**How It Works**
```sql
SELECT dept, avg_salary
FROM (
    SELECT department AS dept, AVG(salary) AS avg_salary
    FROM employees
    GROUP BY department
) AS dept_averages
WHERE avg_salary > 80000;
```

- **Inline view vs. CTE:** functionally similar, but a `WITH` CTE (§11) can be referenced multiple times in the same query and reads top-to-bottom, while a derived table is nested inline and gets hard to read past 1-2 levels of nesting.

---

### 4.8 System / Catalog Views

**The Problem**
- Tools (migration frameworks, schema-diffing tools) and engineers debugging "why isn't my index being used" need a way to ask the database questions **about itself** — what tables exist, what columns they have, what indexes are defined.

**What It Solves**
- Every major database ships built-in, read-only views that expose its own metadata — tables, columns, indexes, permissions — queryable with normal `SELECT` statements.

**How It Works**
```sql
-- Standard SQL / most engines
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_name = 'orders';

-- PostgreSQL-specific catalog
SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'orders';

-- MySQL-specific
SHOW INDEX FROM orders;
```

---

### Use Cases (Views, all types)
- **Simple view:** restrict a client to certain columns (hide `password_hash`) or rows (`WHERE tenant_id = ?`) without duplicating the table.
- **Complex view:** hide a multi-join reporting query behind a single `SELECT * FROM view` for a BI tool or reporting team.
- **Updatable view + `WITH CHECK OPTION`:** give a support team `UPDATE` access to `active_users` without letting them accidentally push rows outside that view's own scope.
- **Materialized view:** dashboard/analytics queries that are expensive to compute and don't need to-the-second freshness.
- **Indexed view:** SQL Server systems needing an always-fresh aggregate with no refresh job, at the cost of extra write overhead.
- **Inline view:** a one-off intermediate aggregation inside a larger query, not worth naming as a permanent object.
- **System view:** tooling — migration frameworks, schema-diffing tools, and "why is this query slow" investigations all read `information_schema`/`pg_catalog` under the hood.

### Java / PHP
Regardless of view type, querying looks identical from the application side — that's the entire point of a view:
```java
ResultSet rs = st.executeQuery("SELECT * FROM active_customer_summary WHERE lifetime_value > 1000");
```
```php
$stmt = $pdo->query("SELECT * FROM active_customer_summary WHERE lifetime_value > 1000");
```

The only place application code differs is around **materialized/indexed view refresh**, since that's a write-side operation, not a read:
```java
// Run from a scheduled job/worker, not per-request
st.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY daily_revenue");
```
```php
$pdo->exec("REFRESH MATERIALIZED VIEW CONCURRENTLY daily_revenue");
```

---

## 5. Triggers

### The Problem
- Some actions must **always** happen alongside a data change — logging every balance change for audit purposes, for example — no matter which application, script, or person made the change.
- If that logging logic lives only in your application code, anyone who writes to the database a different way (a script, another service, a rogue query) can bypass it entirely.

### What It Solves
- A trigger is code that **automatically runs on the database** in response to an `INSERT`, `UPDATE`, or `DELETE` — before or after the event — so the behavior can't be bypassed by skipping the application layer.
- Common uses: audit logging, enforcing invariants that a simple `CHECK` constraint can't express, and keeping denormalized columns in sync.

### How It Works
```sql
CREATE TABLE account_audit (
    id         INT PRIMARY KEY AUTO_INCREMENT,
    account_id INT,
    old_balance DECIMAL(10,2),
    new_balance DECIMAL(10,2),
    changed_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

DELIMITER $$
CREATE TRIGGER trg_balance_audit
AFTER UPDATE ON accounts
FOR EACH ROW
BEGIN
    IF OLD.balance <> NEW.balance THEN
        INSERT INTO account_audit (account_id, old_balance, new_balance)
        VALUES (OLD.id, OLD.balance, NEW.balance);
    END IF;
END$$
DELIMITER ;
```

- The application does **nothing special** — the trigger fires transparently the moment the `UPDATE` runs. That's exactly what makes triggers dangerous: the business logic is invisible to anyone reading the application codebase.
- **Watch out for:**
  - Triggers make behavior implicit and hard to test/version alongside application code.
  - Hard to debug — stack traces don't show trigger execution.
  - Can cause surprising performance cliffs — one row `UPDATE` cascading into N trigger-driven writes.
  - Most modern shops prefer **application-level events** (e.g. an outbox pattern publishing to a queue) over DB triggers, reserving triggers for narrow cases like audit trails or invariants that absolutely cannot be bypassed even by a rogue script with direct DB access.

### Time & Space Complexity
- **Time:** a trigger adds its own logic's cost on top of the original statement — the audit trigger above does one extra `INSERT` per row changed, so a single-row `UPDATE` becomes **O(1) extra work**. But triggers fire **once per affected row**, so a bulk `UPDATE` touching `n` rows means **O(n) extra writes** — one per row — which can quietly turn a fast bulk update into something much slower. Triggers that cascade into other triggers compound this further.
- **Space:** audit-style triggers usually insert into a separate table, which grows **O(number of changes over time)** — unbounded unless you archive or prune it.
- **Why this matters:** triggers don't change the algorithmic complexity of the write itself, but they add a hidden multiplier that's easy to forget — a "cheap" bulk update of 100,000 rows with a per-row trigger means 100,000 additional hidden writes, often the real reason a bulk operation is slow.

### Java / PHP
```java
// This single UPDATE silently also inserts an audit_log row via the trigger above
ps = conn.prepareStatement("UPDATE accounts SET balance = ? WHERE id = ?");
ps.setBigDecimal(1, newBalance);
ps.setInt(2, accountId);
ps.executeUpdate();
```

---

## 6. Stored Procedures

### The Problem
- Some operations need several statements to happen **atomically** — like transferring money between two accounts, where both the debit and the credit must succeed or fail together.
- Doing this from the application means multiple network round-trips to the database, which is slower and adds more chances for a partial failure to leave things inconsistent.

### What It Solves
- A stored procedure is a named, precompiled block of SQL/procedural logic stored **in the database**, invoked with `CALL`.
- It supports `IN`, `OUT`, and `INOUT` parameters, control flow, and multiple statements — and unlike a function, it can perform multi-step data changes (DML) and control transactions directly, close to the data, without extra round-trips.

### How It Works
```sql
DELIMITER $$
CREATE PROCEDURE transfer_funds(
    IN  from_id INT,
    IN  to_id   INT,
    IN  amount  DECIMAL(10,2),
    OUT success BOOLEAN
)
BEGIN
    DECLARE current_balance DECIMAL(10,2);

    START TRANSACTION;

    SELECT balance INTO current_balance FROM accounts WHERE id = from_id FOR UPDATE;

    IF current_balance >= amount THEN
        UPDATE accounts SET balance = balance - amount WHERE id = from_id;
        UPDATE accounts SET balance = balance + amount WHERE id = to_id;
        SET success = TRUE;
        COMMIT;
    ELSE
        SET success = FALSE;
        ROLLBACK;
    END IF;
END$$
DELIMITER ;

CALL transfer_funds(1, 2, 100.00, @ok);
SELECT @ok;
```

- **Procedures vs. app logic (classic SSE interview question):**
  - Procedures run close to the data — fast, atomic, no network round-trips for multi-step logic.
  - But they're hard to unit test, hard to code-review as a meaningful diff, not portable across DB vendors, and invisible to application-level observability (tracing, feature flags).
  - Most large-scale backend teams keep business logic in the application layer and reserve procedures for tight, performance-critical, rarely-changing operations.

### Time & Space Complexity
- Stored procedures don't change the Big-O complexity of the SQL statements inside them — a table scan is still **O(n)**, an indexed lookup is still **O(log n)**, whether it runs inside a procedure or not.
- What they actually save is **constant-factor network overhead**: each statement inside a procedure runs directly on the database server instead of requiring a full network round-trip (app → DB → app) per statement. For `transfer_funds` (a `SELECT ... FOR UPDATE` + 2 `UPDATE`s), that's **1 round-trip** (call the procedure) instead of **3+ round-trips** sending each statement separately.
- **Why this matters:** the benefit is reducing constant per-round-trip latency (often 1-5ms on a fast network, much more across regions) — not improving the algorithmic complexity of the underlying queries. If a query inside a procedure is slow, profile it with `EXPLAIN` (§9); wrapping a bad query plan in a procedure doesn't fix it.

### Java (JDBC `CallableStatement`)
```java
try (CallableStatement cs = conn.prepareCall("{call transfer_funds(?, ?, ?, ?)}")) {
    cs.setInt(1, 1);
    cs.setInt(2, 2);
    cs.setBigDecimal(3, new BigDecimal("100.00"));
    cs.registerOutParameter(4, Types.BOOLEAN);
    cs.execute();
    boolean success = cs.getBoolean(4);
}
```

### PHP (PDO)
```php
$stmt = $pdo->prepare("CALL transfer_funds(:from, :to, :amount, @ok)");
$stmt->execute(['from' => 1, 'to' => 2, 'amount' => 100.00]);
$ok = $pdo->query("SELECT @ok AS ok")->fetch(PDO::FETCH_ASSOC)['ok'];
```

---

## 7. Functions

### The Problem
- Some calculations (like applying a loyalty discount) need to be reused **inside** a `SELECT` statement itself — as part of an expression, not as a standalone multi-statement operation.
- A stored procedure can't be used inline in a `SELECT` — it has to be `CALL`ed separately.

### What It Solves
- A function (UDF — user-defined function) returns a **single value** (scalar) or a table, and unlike a procedure, can be used **directly inside a `SELECT`**.
- Functions are meant to be side-effect-free — they generally can't freely perform DML the way a procedure can (this varies by database).

### How It Works
```sql
DELIMITER $$
CREATE FUNCTION calculate_discount(price DECIMAL(10,2), loyalty_years INT)
RETURNS DECIMAL(10,2)
DETERMINISTIC
BEGIN
    DECLARE discount_rate DECIMAL(4,2);
    SET discount_rate = CASE
        WHEN loyalty_years >= 5 THEN 0.20
        WHEN loyalty_years >= 2 THEN 0.10
        ELSE 0.00
    END;
    RETURN price * (1 - discount_rate);
END$$
DELIMITER ;

SELECT name, price, calculate_discount(price, loyalty_years) AS final_price
FROM products p
JOIN customer_loyalty cl ON cl.customer_id = 42;
```

- **Function vs. Procedure, quick answer:** function → returns a value, usable in `SELECT`/`WHERE`, no transaction control. Procedure → `CALL`ed standalone, can do multi-statement DML, transaction control (`COMMIT`/`ROLLBACK`), multiple `OUT` params.

### Time & Space Complexity
- **The hidden trap:** a scalar function called in a `SELECT`'s column list or `WHERE` clause runs **once per row**. If the function itself costs `O(f)` and it's applied to `n` rows, the total becomes **O(n × f)**, not just `O(n)` — easy to miss because the SQL looks like one simple query, but it's hiding `n` extra function calls under the hood.
- **Functions in a `WHERE` clause can break indexing:** `WHERE calculate_discount(price, 5) > 100` can't use a plain index on `price`, because the database must compute the function for every row before it knows whether that row matches — silently turning an `O(log n)` indexed lookup back into an **O(n) full scan**. A functional index (indexing the function's *output* directly) can restore `O(log n)`, where supported.
- **Space:** functions themselves use negligible space; local variables inside them are `O(1)` per call.

### Java / PHP
Called exactly like any other SQL expression inside a query — the driver doesn't know or care it's a UDF:
```java
ResultSet rs = st.executeQuery(
    "SELECT name, calculate_discount(price, 5) AS final_price FROM products");
```
```php
$stmt = $pdo->query("SELECT name, calculate_discount(price, 5) AS final_price FROM products");
```

---

## 8. Variables

### The Problem
- Some computations (like a running total) are awkward to express in pure `SELECT` logic without a place to store an intermediate value as you go row by row.
- Stored routines (procedures/functions) also need their own local, throwaway values that shouldn't leak outside the routine.

### What It Solves
- SQL gives you two flavors of variable: **session/user-defined variables** (`@var`) that live for the current connection until it closes, and **local variables** inside a stored routine (`DECLARE`) scoped only to that routine's `BEGIN...END` block.

### How It Works
```sql
-- Session variable
SET @min_price = 100;
SELECT * FROM products WHERE price > @min_price;

-- Handy trick: compute a running total without a window function
SET @running_total = 0;
SELECT id, amount, (@running_total := @running_total + amount) AS running_total
FROM transactions ORDER BY id;

-- Local variable inside a procedure
DELIMITER $$
CREATE PROCEDURE count_high_value_orders(IN threshold DECIMAL(10,2))
BEGIN
    DECLARE order_count INT DEFAULT 0;
    SELECT COUNT(*) INTO order_count FROM orders WHERE total > threshold;
    SELECT order_count AS result;
END$$
DELIMITER ;
```

- **Connection-pooling trap (important at large scale):** session variables live on the physical connection, not on the logical request. In a pooled environment (HikariCP in Java, persistent PDO connections in PHP), a connection is reused across unrelated requests — a leftover `@var` from a previous request can silently leak into the next one. Either avoid session variables in pooled code, or explicitly reset them (`SET @var = NULL`) before returning the connection to the pool. This is a real production bug pattern, not a theoretical one.

### Time & Space Complexity
- Reading or setting a session/local variable is **O(1) time and O(1) space** — it's a single stored value on the connection or routine, not a data structure that grows with table size.
- **The running-total trick** (`@running_total := @running_total + amount`) computes a running sum in a single pass over the rows — **O(n) time, O(1) extra space** — because it only ever needs to remember one number, not the whole result set so far.
- **Compare to a window function** doing the same running total (`SUM(amount) OVER (ORDER BY id)`): typically **O(n log n)**, because the database usually has to sort the rows by the window's `ORDER BY` first (`O(n log n)`) before computing the running values (`O(n)`). The variable trick can be faster in practice by skipping that sort — but it only works if rows already arrive in the order you want, and it leans on MySQL-specific evaluation-order behavior that isn't guaranteed by the SQL standard, so it's a portability trade-off as much as a performance one.

### Java / PHP
```java
st.execute("SET @min_price = 100");
ResultSet rs = st.executeQuery("SELECT * FROM products WHERE price > @min_price");
```
```php
$pdo->exec("SET @min_price = 100");
$stmt = $pdo->query("SELECT * FROM products WHERE price > @min_price");
```

### Real-World Example: Audit Trail via Session Variable + Trigger (Java/Spring)
A common use of session variables — a trigger auto-stamps "who updated this row" without passing `updated_by` through every query.

```sql
CREATE TABLE bookings (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    status VARCHAR(20) NOT NULL,
    updated_by BIGINT NULL,
    updated_at TIMESTAMP NULL
);

DELIMITER $$
CREATE TRIGGER trg_bookings_updated_by
BEFORE UPDATE ON bookings
FOR EACH ROW
BEGIN
    SET NEW.updated_by = @current_user_id;
    SET NEW.updated_at = NOW();
END$$
DELIMITER ;
```

```java
@Entity
@Table(name = "bookings")
public class Booking {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    private String status;

    @Column(name = "updated_by", insertable = false, updatable = false)
    private Long updatedBy;   // populated by the trigger, not Hibernate

    @Column(name = "updated_at", insertable = false, updatable = false)
    private LocalDateTime updatedAt;
}

@Service
public class BookingService {
    @PersistenceContext private EntityManager entityManager;
    @Autowired private BookingRepository bookingRepository;

    @Transactional
    public void confirmBooking(Long bookingId, Long currentUserId) {
        entityManager.createNativeQuery("SET @current_user_id = :userId")
                .setParameter("userId", currentUserId)
                .executeUpdate();

        Booking booking = bookingRepository.findById(bookingId).orElseThrow();
        booking.setStatus("CONFIRMED");
        bookingRepository.save(booking);   // fires the UPDATE, trigger stamps updated_by
    }
}
```

- **Why it works:** `@Transactional` pins one physical connection to the whole method, so the `SET @current_user_id = ...` and the later `UPDATE` both run on the *same* connection — required, since the variable lives on the connection, not globally. Flow: request arrives → transaction opens on connection C → `SET` runs on C → `save()` issues `UPDATE` on C → trigger fires and reads `@current_user_id` off C → commit → connection C returns to the pool.
- **Gotcha:** if the `SET` and the `UPDATE` ever land on different connections (e.g. a `REQUIRES_NEW` transaction, an async call, or the pool handing out a different connection), the trigger silently sees `@current_user_id = NULL` — no error, just a wrong/missing audit value. `@Transactional` is exactly what prevents that here.

---

## 9. Query Performance — Profiling & Optimization

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

## 10. Subqueries

### The Problem
- Some questions can't be answered by a single flat query — e.g. "which products cost more than the average price?" needs the average computed first, then compared against every row.

### What It Solves
- A subquery is a query nested inside another query, letting you use the result of one query as an input to another.
- **Non-correlated** subqueries run once, independent of the outer query. **Correlated** subqueries re-run once per outer row — useful, but can be a performance trap if it can't be rewritten as a join.

### How It Works
```sql
-- Non-correlated: runs once
SELECT name FROM products
WHERE price > (SELECT AVG(price) FROM products);

-- Correlated: runs once per outer row — often better as a JOIN
SELECT u.name FROM users u
WHERE EXISTS (
    SELECT 1 FROM orders o WHERE o.user_id = u.id AND o.total > 1000
);

-- EXISTS vs IN: EXISTS short-circuits on first match, generally preferred for large subquery results
-- IN materializes the full subquery result set first, and mishandles NULLs (WHERE x NOT IN (NULL) matches nothing)
```

### Time & Space Complexity
- **Non-correlated subquery:** runs once, independent of the outer query — if the subquery costs `O(m)` and the outer query costs `O(n)`, the total is **O(n + m)**, not multiplied together.
- **Correlated subquery:** re-runs once **per outer row** — if the subquery costs `O(m)` each time across `n` outer rows, that's **O(n × m)** total, unless the optimizer is smart enough to rewrite it into a join/semi-join (good planners often do this automatically — check with `EXPLAIN`).
- **`EXISTS`:** stops on the first match — close to **O(1) average case** per outer row when a match is found early, instead of scanning the whole matching set.
- **`IN`:** fully computes and materializes the subquery's result first — **O(m) space** to hold that result set before checking membership.
- **Why this matters:** a correlated subquery that "looks fine" against a 1,000-row test table can become an `O(n × m)` disaster at 10 million rows — this is exactly why "can this be rewritten as a JOIN" is one of the first questions to ask when a query with a subquery is slow.

### Java / PHP
Executed exactly like any other query — the driver has no concept of "subquery" vs "plain query":
```java
ResultSet rs = st.executeQuery(
    "SELECT name FROM products WHERE price > (SELECT AVG(price) FROM products)");
```
```php
$stmt = $pdo->query(
    "SELECT name FROM products WHERE price > (SELECT AVG(price) FROM products)");
```

---

## 11. CTEs (Common Table Expressions)

### The Problem
- Long queries with repeated subqueries, or subqueries nested three levels deep, become hard to read — you lose track of what each nested block is even doing.
- If the same subquery result is needed in two places in one query (say, in both the `SELECT` list and the `WHERE` clause), you either repeat the whole subquery twice, or write it as a separate step and lose readability.
- Hierarchies — an org chart (employee → manager → manager's manager...), a category tree, a comment thread — need a query that can walk an **unknown number of levels**. A plain `SELECT`/`JOIN` only knows how to join a fixed number of times, so it can't express "keep going up until there's no more manager."

### What It Solves
- A `WITH` clause lets you **name a query's result** and reuse that name later in the same statement, like a temporary, throwaway view that only exists for one query.
- **Recursive CTEs** extend this so the named query can refer to **itself**, which is the standard SQL way to walk a tree/hierarchy without knowing its depth ahead of time.

---

### What Exactly Is a CTE? (Plain Explanation)
- "CTE" = **Common Table Expression**. Common just means shared/reusable, Table Expression just means "a thing that produces rows, like a table."
- You write it with the keyword `WITH`, give it a name, and put a `SELECT` inside parentheses:
  ```sql
  WITH name_you_choose AS (
      SELECT ...   -- this can be any normal query
  )
  SELECT * FROM name_you_choose;   -- now you query it just like a table
  ```
- Think of it as: "First, run this inner query and call the result `name_you_choose`. Then, run this outer query, which is allowed to use `name_you_choose` as if it were a real table."
- It only exists for the **duration of that one query** — nothing is saved to the database, unlike a view (§4).

---

### 11.1 Non-Recursive CTEs (the simple, everyday kind)

**How it works, step by step:**
1. The database runs the query inside the `WITH ... AS (...)` block first, and gives the result a temporary name.
2. The main query below it can then use that name in `FROM`, `JOIN`, `WHERE` — anywhere you'd normally put a table name.
3. Once the whole statement finishes, the temporary result is thrown away.

```sql
WITH high_value_orders AS (
    SELECT user_id, total FROM orders WHERE total > 1000
)
SELECT u.name, COUNT(*) AS big_order_count
FROM users u
JOIN high_value_orders h ON h.user_id = u.id
GROUP BY u.id;
```

- Read it top to bottom like a short story: "Step 1 — find all orders over 1000, call that list `high_value_orders`. Step 2 — join `users` against that list and count how many big orders each user has."
- **You can chain multiple CTEs**, each one allowed to use the ones defined before it — this is what makes long queries readable, since each step gets its own name instead of one giant nested subquery:
  ```sql
  WITH high_value_orders AS (
      SELECT user_id, total FROM orders WHERE total > 1000
  ),
  frequent_buyers AS (
      SELECT user_id, COUNT(*) AS order_count
      FROM high_value_orders
      GROUP BY user_id
      HAVING COUNT(*) > 3
  )
  SELECT u.name FROM users u
  JOIN frequent_buyers f ON f.user_id = u.id;
  ```

---

### 11.2 Recursive CTEs (walking a hierarchy)

**The core idea, in plain words:**
- A recursive CTE is built from **two halves glued together with `UNION ALL`**:
  - The **anchor member** — the starting point. Runs once.
  - The **recursive member** — a query that refers back to the CTE's own name, and keeps running again and again, each time using the *previous* round's results, until it produces zero new rows.
- The database automatically stops once the recursive member produces no more rows — you don't have to tell it "stop after N rounds" (though you can add a safety limit, covered below).

**Example: employee → manager chain, walk to the top**
```sql
WITH RECURSIVE org_chain AS (
    -- ANCHOR MEMBER: runs once, this is the starting row
    SELECT id, name, manager_id, 1 AS depth
    FROM employees WHERE id = 42

    UNION ALL

    -- RECURSIVE MEMBER: joins back to org_chain itself (the CTE's own name)
    SELECT e.id, e.name, e.manager_id, oc.depth + 1
    FROM employees e
    JOIN org_chain oc ON e.id = oc.manager_id
)
SELECT * FROM org_chain ORDER BY depth;
```

**Walking through it round by round, so you can see exactly what the database does:**
- **Round 0 (anchor):** find the employee with `id = 42`. Say their `manager_id` is `7`. This one row goes into the result, with `depth = 1`.
- **Round 1 (recursive member runs using round 0's row):** look for an employee whose `id` matches the `manager_id` from round 0 (`id = 7`). Found — that's employee 42's manager. Add them with `depth = 2`.
- **Round 2 (recursive member runs again, using round 1's new row):** look for the manager of employee `7`. Found — add them with `depth = 3`.
- **This keeps going** — each round only looks at the rows added in the *previous* round, not all rows ever — until a round finds **no matching manager** (e.g. the CEO, whose `manager_id` is `NULL`). At that point, the recursive member returns zero rows, and the whole thing stops.
- The final result is every row collected across all rounds, in the order you `SELECT ... ORDER BY depth`.

**Watch out for:**
- **Infinite recursion:** if your data has a cycle (e.g. a data-entry mistake where A reports to B and B reports to A), the recursion never naturally runs out of new rows and will run forever or hit the database's built-in safety limit and error out.
  - MySQL/Postgres protect you with a recursion depth cap you can tune, but the safest fix is to guard it yourself:
  ```sql
  WITH RECURSIVE org_chain AS (
      SELECT id, name, manager_id, 1 AS depth FROM employees WHERE id = 42
      UNION ALL
      SELECT e.id, e.name, e.manager_id, oc.depth + 1
      FROM employees e
      JOIN org_chain oc ON e.id = oc.manager_id
      WHERE oc.depth < 50   -- safety limit: never recurse past 50 levels
  )
  SELECT * FROM org_chain ORDER BY depth;
  ```
- **`UNION ALL` vs `UNION` inside a recursive CTE:** almost always use `UNION ALL` (keeps duplicates, doesn't try to dedupe). `UNION` would force the database to compare every new row against every row seen so far to remove duplicates, which is slow and can hide legitimate repeated values.
- **MySQL version support:** `WITH RECURSIVE` needs **MySQL 8.0+** — older MySQL (5.x) doesn't support CTEs at all, recursive or not.

---

### CTE vs. Subquery vs. View — When to Use Which
- **Inline subquery (§10):** best for a short, one-off, single-use piece of logic nested directly in a query. Gets hard to read once nested more than 1-2 levels.
- **CTE (`WITH`):** best when you want to name a step for readability, reuse that name more than once in the same query, or need recursion. Exists only for that one statement.
- **View (§4):** best when the same query needs to be reused across **many different queries/statements**, not just once — a CTE can't be shared outside the single `SELECT` it's attached to.

### Time & Space Complexity
- **Non-recursive CTE:** costs exactly what the query inside it costs — naming it with `WITH` doesn't add a new complexity class on its own. But how the database *executes* it varies:
  - **PostgreSQL 11 and earlier** treated every CTE as an **"optimization fence"** — it was always fully computed and **materialized (O(m) space)** before the outer query ran, even if the outer query only needed a handful of rows from it. This could make a CTE slower than the equivalent inline subquery.
  - **PostgreSQL 12+** inlines non-recursive CTEs by default (like a subquery) unless you force materialization with the `MATERIALIZED` keyword — so complexity now matches whatever the planner would pick for an equivalent subquery.
  - **MySQL 8+** similarly may inline or materialize a CTE depending on whether it's referenced once or multiple times.
- **Recursive CTE:** total cost is roughly **O(depth × rows-per-level)** — the anchor runs once, and the recursive member re-runs once per round, each round only processing the *previous* round's new rows. For a tree with depth `d` and branching factor `b` (children per node), that's on the order of **O(b^d)** rows in the worst case (a wide, deep tree) — the same shape as a graph/tree traversal in application code.
  - **Space:** the database keeps the full accumulated result (every row found across all rounds so far) available to feed the next round — **O(total rows returned)** space, which can be substantial for a very deep or wide hierarchy.
- **Why this matters:** a recursive CTE is convenient, but it's still doing real traversal work. For a genuinely huge or deep hierarchy (e.g. a social graph with millions of edges), the `O(b^d)`-shaped cost can exceed what a purpose-built graph database or an application-level, pruned traversal would cost — which is why §11.2's own guidance says to reconsider recursive CTEs at extreme scale.

### Java / PHP
```java
ResultSet rs = st.executeQuery("""
    WITH RECURSIVE org_chain AS (
        SELECT id, name, manager_id, 1 AS depth FROM employees WHERE id = 42
        UNION ALL
        SELECT e.id, e.name, e.manager_id, oc.depth + 1
        FROM employees e JOIN org_chain oc ON e.id = oc.manager_id
    )
    SELECT * FROM org_chain ORDER BY depth
    """);
```
```php
$stmt = $pdo->query("
    WITH RECURSIVE org_chain AS (
        SELECT id, name, manager_id, 1 AS depth FROM employees WHERE id = 42
        UNION ALL
        SELECT e.id, e.name, e.manager_id, oc.depth + 1
        FROM employees e JOIN org_chain oc ON e.id = oc.manager_id
    )
    SELECT * FROM org_chain ORDER BY depth
");
```

---

## 12. Set Operations

### The Problem
- Very often, you already have **two separate queries** that each produce the data you want. The question isn't "how do I match rows between two tables" — it's "how do I combine or compare the *results* of these two queries?"
- The important part: you're not trying to join tables together. You're trying to work with the result sets those queries already return.
- Example — "give me all users who are either premium OR placed a big order": you're not matching a `premium_users` row to an `orders` row on some shared key. You just have two lists of `user_id`s and want one final list.
- Example — "which users logged in during both January and February": you have two lists (January logins, February logins) and want only the values that appear in both.
- Example — "which users logged in in January but not February": you have two lists and want what's in the first but missing from the second.
- In every case, you already have two result sets sitting in front of you — the task is to stack them, intersect them, or subtract one from the other.

### What It Solves
- Set operators combine the results of two queries (same number/type of columns) in different ways: union them, keep only common rows, or keep only rows unique to one side.
- They give you simple, readable SQL for tasks like: merging customers from two different tables, finding users who satisfy either of two conditions, comparing reports from different months, finding missing/common records, or combining archived and current data.

### What Exactly Is a "Set"? (Plain Explanation)
- The word "Set" comes from **mathematics** — a set is just a collection of items. `{Apple, Banana, Orange}` is a set; `{Orange, Grape, Apple}` is another set.
- In SQL, **every `SELECT` query returns a collection of rows** — that collection *is* a set. `SELECT user_id FROM premium_users` returns one set of values; `SELECT user_id FROM orders WHERE total > 1000` returns another.
- A "Set Operation" is simply an operation performed on two of these collections: combine them, keep only what's common, or keep only what's unique to one side. These are exactly the operations from set theory in math, which SQL borrows directly.

### JOIN vs. Set Operations — The Core Difference
This is the single biggest source of confusion for beginners: "can't `JOIN` do this?" Sometimes yes — but `JOIN` and Set Operations solve genuinely different problems.

- **`JOIN` combines columns. It works horizontally — the result gets *wider*.**
  ```sql
  -- employees(id, name), departments(id, department)
  SELECT e.name, d.department
  FROM employees e
  JOIN departments d ON e.id = d.id;
  -- Result: name | department  →  one row per match, but MORE columns
  ```
  Think of it as `Employees + Departments → name | department` — it glues two tables side by side into wider rows.

- **Set Operations combine rows. They work vertically — the result gets *longer*.**
  ```sql
  -- Query A returns user_id 1, 2 — Query B returns user_id 3, 4
  SELECT user_id FROM query_a
  UNION ALL
  SELECT user_id FROM query_b;
  -- Result: 1, 2, 3, 4  →  same number of columns, but MORE rows
  ```
  Think of it like **stacking papers**: Query A's rows go on top, Query B's rows go underneath — same column shape, just more rows piled up.

| | `JOIN` | Set Operation |
|---|---|---|
| Combines | Tables (side by side) | Query results / sets (stacked) |
| Direction | Horizontal — adds columns | Vertical — adds or filters rows |
| Matching | Rows matched via a condition (`ON`) | Whole result sets compared as-is |
| Used when | You need data from multiple tables in the same row | You need to merge or compare multiple query results |

**Mental model:** `JOIN` = make the result **wider**. Set Operation = make the result **longer**, or compare two lists.

### How It Works

| Operator | Behavior |
|---|---|
| `UNION` | Combines and removes duplicates |
| `UNION ALL` | Combines, keeps duplicates — faster, prefer when you know there's no overlap |
| `INTERSECT` | Only rows present in both result sets |
| `EXCEPT` (Postgres) / `MINUS` (Oracle) | Rows in the first result set but not the second |

```sql
-- Users who are either premium OR have placed a big order (dedup'd)
SELECT user_id FROM premium_users
UNION
SELECT user_id FROM orders WHERE total > 1000;

-- Users active in BOTH January and February
SELECT user_id FROM logins WHERE month = 'jan'
INTERSECT
SELECT user_id FROM logins WHERE month = 'feb';

-- Users who logged in in January but churned by February
SELECT user_id FROM logins WHERE month = 'jan'
EXCEPT
SELECT user_id FROM logins WHERE month = 'feb';
```

- **`UNION` vs `UNION ALL` performance:** `UNION` deduplicates the combined result set, which requires an extra sort/hash pass over all rows; `UNION ALL` just concatenates. If you already know the two result sets are disjoint, `UNION ALL` gives the same correct result without paying for deduplication.

### Rules Every Set Operation Must Follow
These rules apply to `UNION`, `UNION ALL`, `INTERSECT`, and `EXCEPT` alike:

- **Both queries must return the same number of columns — no exceptions, no auto-fill.** If one query returns 2 columns and the other returns 5, SQL doesn't try to pad the missing 3 with `NULL`. It simply **throws an error and produces no result at all**.
  ```sql
  -- users(id, name) — 2 columns          products(id, product_name, price, stock, category) — 5 columns
  SELECT id, name FROM users
  UNION
  SELECT id, product_name, price, stock, category FROM products;
  -- ERROR: each UNION query must have the same number of columns
  ```
  SQL doesn't guess what you meant — maybe `name` should've matched `product_name`, maybe you forgot a column, maybe it's a typo. Rather than guess, it refuses to run.
- **Columns are matched by position, not by name.** The 1st column of the first query pairs with the 1st column of the second query, the 2nd with the 2nd, and so on — SQL never looks at the column names to decide the pairing.
  ```sql
  SELECT id, name FROM users
  UNION
  SELECT product_id, product_name FROM products;
  -- Works fine: id <-> product_id (position 1), name <-> product_id (position 2) — names are irrelevant
  ```
  If the columns are in the wrong order in one query (e.g. `product_name, product_id` instead of `product_id, product_name`), you'll silently get **mismatched or wrong-typed data**, not an error — this is a real footgun, so always double-check column order on both sides.
- **The final output's column names come from the first `SELECT` only.** Even if the second query's columns are named differently, those names are discarded in the result.
  ```sql
  SELECT id, name FROM users
  UNION
  SELECT product_id, product_name FROM products;
  -- Final result columns are named "id" and "name" — "product_id"/"product_name" never appear in the output
  ```
  Think of it like stacking two papers with different headers — SQL keeps the *first* paper's headings and just slides the second paper's rows underneath, ignoring its headings entirely.
- **Corresponding columns should have compatible data types.** SQL compares column 1 vs. column 1, column 2 vs. column 2, etc. — if the types don't match (e.g. `INT` vs. `VARCHAR`), the database will either implicitly convert them if a safe conversion exists, or throw a type error if it can't reconcile them. This varies by database engine, so don't rely on automatic conversion — matching types on purpose is safer.

### Can You Use Set Operations on Unrelated Tables?
- **Yes — SQL allows it, as long as both queries return the same number of columns with compatible types.** Set Operations don't check for foreign keys, relationships, or shared columns between the tables at all — unlike `JOIN`, they only look at the *shape* of the two `SELECT` results, never at how (or whether) the underlying tables relate to each other.
  ```sql
  -- users(id, name), products(id, product) — completely unrelated tables
  SELECT name FROM users
  UNION
  SELECT product FROM products;
  -- SQL is happy: both sides return one VARCHAR column
  -- Result: Alice, Bob, Laptop, Phone
  ```
- **But "allowed" isn't the same as "meaningful."** The result above mixes people's names with product names into one column — there's no business meaning to a list like `Alice, Bob, Laptop, Phone`. SQL only ever checks "do both queries return the same column shape?" — it has no idea what your data actually represents.
- **The rule to remember:** ask whether every row in the final result represents *the same kind of thing*. `every row is a user` ✅, `every row is a product` ✅, `every row is a city` ✅ — all fine. But `user names mixed with product names` ❌, or `product prices mixed with employee names` ❌ — technically valid SQL, but a meaningless result.
- **If you genuinely need to combine rows from different kinds of tables, label the origin of each row** so the result stays meaningful:
  ```sql
  SELECT id, 'User' AS type FROM users
  UNION ALL
  SELECT id, 'Product' AS type FROM products;
  -- id | type
  -- 1  | User
  -- 101| Product
  ```
- **Real-world cases where combining different tables genuinely makes sense** (because every resulting row is still "the same kind of thing"):
  - `current_employees` + `former_employees` → one full employee history.
  - `customers` + `suppliers` → one master contact list.
  - `warehouse_a` products + `warehouse_b` products → one combined inventory list.
  - `active_users` + `banned_users` → one full user-status list.

### When to Prefer a Set Operation vs. an Alternative
Set Operations aren't the only way to solve these problems — they're often just the simplest, most expressive one. A few common alternatives:

- **`UNION` vs. `OR`/`DISTINCT`:**
  ```sql
  SELECT user_id FROM premium_users
  UNION
  SELECT user_id FROM orders WHERE total > 1000;
  ```
  can sometimes be rewritten as `SELECT DISTINCT user_id FROM users WHERE is_premium = TRUE OR total > 1000;` — but only if all the needed data already lives in one queryable place. If the data naturally comes from separate queries or tables, `UNION` is cleaner and doesn't require joining first.
- **`INTERSECT` vs. `INNER JOIN`:**
  ```sql
  SELECT user_id FROM january
  INTERSECT
  SELECT user_id FROM february;
  ```
  vs. `SELECT DISTINCT j.user_id FROM january j JOIN february f ON j.user_id = f.user_id;` — both return the same users. `INTERSECT` more directly expresses the intent: "rows common to both result sets," rather than relying on a join + manual `DISTINCT`.
- **`EXCEPT` vs. `NOT EXISTS`:**
  ```sql
  SELECT user_id FROM january
  EXCEPT
  SELECT user_id FROM february;
  ```
  vs. `SELECT j.user_id FROM january j WHERE NOT EXISTS (SELECT 1 FROM february f WHERE f.user_id = j.user_id);` — both produce the same result, but `EXCEPT` is shorter and immediately communicates "subtract the second set from the first."
- **Prefer a Set Operation when:** you already have two or more `SELECT` queries, each returning the same kind of data (matching column count and compatible types), and you want to combine or compare their results — and the operator (`UNION`/`INTERSECT`/`EXCEPT`) directly matches what you're asking for in plain English.

### Time & Space Complexity
- **`UNION`:** must remove duplicates from the combined result — either by sorting (**O(n log n)**) or hashing rows into a set (**O(n) time average, O(n) space** for the hash set) to detect repeats.
- **`UNION ALL`:** just streams both result sets through as they arrive — **O(n) time, O(1) extra space**, no dedup structure needed.
- **`INTERSECT` / `EXCEPT`:** need to compare both sides against each other, typically via sort or hash — **O(n log n)**, or **O(n) average with hashing, O(n) space** for the smaller side's hash set.
- **Why this matters:** if you already know the two queries can't produce overlapping rows (e.g. filtered by mutually exclusive conditions), reaching for `UNION ALL` instead of `UNION` skips an entire `O(n log n)`/`O(n)`-space deduplication pass for free — a common performance win with zero cost to correctness.

### Java / PHP
```java
ResultSet rs = st.executeQuery("""
    SELECT user_id FROM logins WHERE month = 'jan'
    EXCEPT
    SELECT user_id FROM logins WHERE month = 'feb'
    """);
```
```php
$stmt = $pdo->query("
    SELECT user_id FROM logins WHERE month = 'jan'
    EXCEPT
    SELECT user_id FROM logins WHERE month = 'feb'
");
```

---

## 13. Handling JSON

### The Problem
- **Different rows of the same "thing" naturally have different attributes.** A `products` table needs to hold laptops (RAM, CPU, GPU), t-shirts (size, fabric), books (author, ISBN, pages), and refrigerators (capacity, energy rating) — all in one table, but each product type needs completely different fields.
- **Adding a column per attribute creates a wide, sparse table.** Once you add `shirt_size`, `ram`, `isbn`, `cpu`, `capacity`... every row only fills in a handful of them and leaves the rest `NULL`:

  | Product | shirt_size | RAM | Author |
  |---|---|---|---|
  | Laptop | NULL | 16GB | NULL |
  | Book | NULL | NULL | John |
  | Shirt | XL | NULL | NULL |

  This wastes storage, is confusing to read, and every new product type means more columns added forever.
- **Constant schema migrations.** Every new business requirement ("add battery life," "add waterproof rating," "add bluetooth version") means another `ALTER TABLE ... ADD COLUMN`. At scale, schema migrations are risky — they can lock tables, require coordinated app deploys, and slow down replication.
- **Some attributes are genuinely unknown ahead of time.** User preferences are a classic example: User A has `theme` + `language`; User B has those plus `font`; User C has `notifications` and `timezone` instead. There's no fixed, sensible set of columns that covers everyone.
- **Third-party API responses change shape without warning.** If Stripe's webhook payload gains a new field like `fraud_score` next month, your database shouldn't need a migration just to keep storing what Stripe sends.
- **Different event types need different metadata.** A login event needs `IP`/`browser`; a purchase event needs `order_id`/`amount`/`coupon`; a search event needs `keyword`/`language`. Creating columns for the union of all event types makes no sense — most columns would be `NULL` for most rows.

### What It Solves
- Instead of creating dozens of sparse columns, you store the flexible, variable part of a row as **one JSON column** — `attributes`, `preferences`, `payload`, `metadata` — while everything structured and predictable stays as normal typed columns.
- Modern relational databases let you store and query semi-structured JSON **alongside** strict relational columns — you get flexibility exactly where you need it, without giving up joins, constraints, and transactions everywhere else in the schema.
- Advantages: different rows can have completely different fields, no schema migration needed when a new attribute shows up, cleaner/narrower tables, easier integration with APIs whose response shape may change, and a natural place for genuinely optional data.

### The Old Alternatives (Before JSON Columns Existed)
It's worth knowing what people did before native JSON support, because you'll still see these patterns in older codebases:

- **Many nullable columns** (shown above): simple to query, but wastes storage on `NULL`s, is hard to maintain, and needs an endless stream of schema changes as new attributes appear.
- **EAV (Entity-Attribute-Value) model:** instead of columns, store each attribute as its own row —
  ```sql
  -- product_attributes(product_id, attribute_name, value)
  -- product_id | attribute_name | value
  -- 1          | RAM            | 16GB
  -- 1          | CPU            | i7
  -- 2          | Author         | John
  ```
  Flexible, and needs no schema changes — but querying it requires pivoting many rows back into columns, joins become complex, performance suffers, and there's no easy way to validate a value's type per attribute.
- **Separate per-type tables** (`laptop_details`, `book_details`, `shirt_details`, each with its own real columns): keeps each table clean and strongly typed, but the number of tables grows with every new product type, and querying "all products" means unioning or joining across all of them.
- **XML columns:** the pre-JSON standard for semi-structured data (`<Product><RAM>16GB</RAM></Product>`) — functionally similar to a JSON column, but more verbose to write and parse. JSON has now replaced XML as the default choice for this use case in most new systems.

### How It Works

**Basic storage and lookup:**
```sql
-- MySQL
CREATE TABLE events (id INT PRIMARY KEY AUTO_INCREMENT, payload JSON);
INSERT INTO events (payload) VALUES ('{"type": "click", "meta": {"page": "/home"}}');
SELECT JSON_EXTRACT(payload, '$.type') AS type FROM events;
SELECT * FROM events WHERE payload->>'$.meta.page' = '/home';
CREATE INDEX idx_events_type ON events((CAST(payload->>'$.type' AS CHAR(50))));  -- functional index

-- PostgreSQL (JSONB is binary, indexable, generally preferred over JSON)
CREATE TABLE events (id SERIAL PRIMARY KEY, payload JSONB);
SELECT payload->>'type' AS type FROM events;
SELECT * FROM events WHERE payload @> '{"type": "click"}';   -- containment operator
CREATE INDEX idx_events_payload ON events USING GIN(payload); -- GIN index for fast JSONB lookups
```

- **Updating only one field, without replacing the whole document:**
  ```sql
  -- MySQL: change just the "theme" key, leave everything else in the JSON untouched
  UPDATE users
  SET preferences = JSON_SET(preferences, '$.theme', 'light')
  WHERE id = 1;

  -- PostgreSQL: same idea with jsonb_set
  UPDATE users
  SET preferences = jsonb_set(preferences, '{theme}', '"light"')
  WHERE id = 1;
  ```
- **Nested objects and arrays both work naturally inside a JSON column:**
  ```json
  {
    "user": { "name": "Alice", "age": 25 },
    "settings": { "theme": "dark" },
    "skills": ["Java", "Spring", "SQL"]
  }
  ```
- **Each row can have entirely different keys** — row 1 might be `{"ram": "16GB"}`, row 2 might be `{"shirt_size": "XL"}` — both are valid in the same JSON column, which is what makes it "schema-less" within an otherwise strict, schema-ful table.
- **Why not just store it as plain `TEXT`?** A `TEXT`/`VARCHAR` column has no idea it's supposed to hold JSON — the database will happily store `"{ram:16GB"` (invalid JSON, missing quotes) without complaint. A native `JSON`/`JSONB` type validates the structure on write, rejects malformed input, and unlocks JSON-specific functions and indexing that plain text can't offer.

### MySQL `JSON` vs. PostgreSQL `JSON` vs. PostgreSQL `JSONB`

| Type | Storage | Pros | Cons |
|---|---|---|---|
| MySQL `JSON` | Internal binary format | Supports JSON functions; can build functional indexes on extracted values | Still one blob per row — no native full-document index like GIN |
| PostgreSQL `JSON` | Original JSON text, as-is | Faster inserts; preserves whitespace and key order | Slower to query — must re-parse text on every read; can't efficiently index the whole document |
| PostgreSQL `JSONB` (preferred) | Parsed binary format | Faster querying; supports GIN indexes; better for searching/filtering | Slightly slower inserts (must parse and convert on write); drops duplicate keys and original key order |

Most PostgreSQL applications default to `JSONB` unless there's a specific reason to preserve the exact original JSON text byte-for-byte.

### JSON Column ≠ NoSQL Database
This is a common point of confusion — a JSON column is not "a bit of MongoDB inside SQL," it's a narrow escape hatch inside an otherwise fully relational design:

- **JSON column = relational database + one flexible column.** Your `users`, `orders`, `payments`, and `invoices` tables keep their joins, foreign keys, and constraints exactly as before — only one specific column on one table is flexible.
- **NoSQL (e.g. MongoDB) = everything is document-based.** There may not be separate tables at all — a single document might embed the customer, their orders, and those orders' line items all in one nested structure.
- **Why not just switch everything to MongoDB?** If you already have `customers`, `orders`, `payments`, `invoices`, `employees` — tables with real joins, foreign keys, and transactions — and only *one* field genuinely needs to be flexible (e.g. medical notes on a `patients` table, which vary wildly between a blood-pressure reading, an allergy list, or imaging results), migrating the entire system to a document database just for that one field is a large, unnecessary cost. A JSON column solves exactly that narrow problem without disrupting everything else.

| Feature | JSON Column in SQL | NoSQL Document Database |
|---|---|---|
| Main data model | Relational | Document |
| Joins | Excellent | Limited or none |
| Foreign keys | Yes | Usually no |
| ACID transactions | Excellent | Varies by database |
| Flexible fields | Yes (on the JSON column only) | Yes (across the whole document) |
| Best for | Mostly relational data with a few flexible attributes | Applications where most data is naturally document-shaped |
| Typical example | An `orders` table with a `metadata` JSON column | Entire user profiles, orders, and nested objects stored as one document |

### When To Use JSON — And When Not To

**Good fits:**
- User preferences (`{"theme": "dark"}`) — different users, different optional settings.
- Product attributes (`{"color": "red", "size": "XL"}`) — different product types, different fields.
- Event metadata (`{"browser": "Chrome", "ip": "1.2.3.4"}`) — shape varies by event type.
- Third-party API responses — store what the provider sends without redesigning your schema every time their payload shape changes.
- Optional settings that differ per record, with no natural fixed column list.

**Poor fits — keep these as real columns instead:**
- **Core business data** — `name`, `email`, `salary` should never live inside JSON. You'll frequently filter, join, validate, and constrain these fields, and JSON makes all of that harder and slower.
- **Data used in joins** — a `customer_id` buried inside a JSON blob can't have a real foreign key, can't be indexed the same way, and can't be joined efficiently. Use a real `customer_id` column with a `FOREIGN KEY` instead.
- **Frequently filtered data** — if nearly every query filters by `department`, `salary`, or `country`, make them real typed columns, not JSON paths. A JSON path filter without an index costs a full scan (see complexity below); a real column can just use a normal B-Tree index.

**When to actually reach for NoSQL instead of a JSON column:**
- Most of your data is naturally document-shaped rather than relational.
- You rarely need joins across entities.
- Nearly every query reads or filters deep into nested document fields, not just a couple of optional ones.
- Your schema changes frequently across the *entire* application, not just one or two fields.
- You need the horizontal-scaling patterns a document database or key-value store is specifically built for.

### Best Practices
- Keep important, frequently queried fields as normal typed columns — reserve JSON for what's genuinely optional or variable.
- Add a functional index (MySQL) or GIN index (PostgreSQL) for any JSON path you query often — an unindexed JSON path always costs a full scan, no matter the table size.
- Don't store your entire relational model inside one JSON document — that's re-inventing a document database badly, without any of its query/indexing strengths for that shape of data.
- If you find yourself constantly querying, aggregating, or joining on JSON fields, that's the signal to either promote those fields into real columns, or reconsider whether a document database is actually the better fit.
- **Rule of thumb:** think of a JSON column as an escape hatch inside a relational database — there to handle the small amount of flexible data that doesn't fit your schema, not to replace the schema itself.

### Time & Space Complexity
- **Querying JSON without an index:** the database must parse and inspect the JSON blob of **every row** to check if a path matches — **O(n) time**, same as a full table scan, no matter how deep the JSON path is.
- **With a functional index (MySQL) or GIN index (PostgreSQL JSONB):** the indexed path can be looked up in **O(log n)** time, the same improvement a normal B-Tree index gives (§2) — but only for the path(s) you actually indexed; a different, unindexed path still falls back to `O(n)`.
- **Space:** `JSONB` in PostgreSQL stores a parsed binary representation, typically **larger on disk** than raw JSON text (the plain `JSON` type), but **faster to query** since it never re-parses text on access — a classic time-vs-space trade-off.
- **Why this matters:** a JSON column with no index on the fields you filter by always costs `O(n)` per query, no matter how small the table starts out — this is exactly the point where adding a functional/GIN index (or moving the field to a real typed column) becomes necessary as the table grows.

### Java — serialize with Jackson, store as JSON column
```java
ObjectMapper mapper = new ObjectMapper();
Map<String, Object> payload = Map.of("type", "click", "meta", Map.of("page", "/home"));
String json = mapper.writeValueAsString(payload);

try (PreparedStatement ps = conn.prepareStatement("INSERT INTO events (payload) VALUES (?)")) {
    ps.setString(1, json);
    ps.executeUpdate();
}

// Reading it back
ResultSet rs = st.executeQuery("SELECT payload FROM events WHERE id = 1");
if (rs.next()) {
    Map<String, Object> parsed = mapper.readValue(rs.getString("payload"), Map.class);
}
```

### PHP
```php
$payload = json_encode(['type' => 'click', 'meta' => ['page' => '/home']]);
$stmt = $pdo->prepare("INSERT INTO events (payload) VALUES (?)");
$stmt->execute([$payload]);

$stmt = $pdo->query("SELECT payload FROM events WHERE id = 1");
$parsed = json_decode($stmt->fetchColumn(), true);
```

---

## 14. Transactions & Rollback

### The Problem
- Some operations involve multiple statements that must all succeed together, or not at all — e.g. debiting one account and crediting another. If the debit succeeds but the credit fails halfway through, money disappears.

### What It Solves
- A transaction groups multiple statements into a single all-or-nothing unit (**ACID**). `COMMIT` makes changes permanent; `ROLLBACK` undoes everything since the transaction began; `SAVEPOINT` allows partial rollback within a larger transaction.
- **Isolation levels** control how much one transaction can see of another transaction's in-progress changes, trading off consistency against concurrency.

### How It Works
```sql
START TRANSACTION;

UPDATE accounts SET balance = balance - 100 WHERE id = 1;
SAVEPOINT after_debit;

UPDATE accounts SET balance = balance + 100 WHERE id = 2;

-- Something went wrong with the credit — roll back just that part
ROLLBACK TO SAVEPOINT after_debit;

-- Retry the credit differently, then finish
UPDATE accounts SET balance = balance + 100 WHERE id = 3;
COMMIT;
```

- **Isolation levels** (weakest → strongest): `READ UNCOMMITTED` → `READ COMMITTED` → `REPEATABLE READ` → `SERIALIZABLE`. Higher isolation = fewer anomalies (dirty reads, non-repeatable reads, phantom reads) but more locking/contention. MySQL InnoDB defaults to `REPEATABLE READ`; PostgreSQL defaults to `READ COMMITTED`.

### Time & Space Complexity
- Transactions don't change the time complexity of the statements inside them — a `SELECT`/`UPDATE` inside a transaction costs exactly what it costs outside one.
- **What transactions add is locking/contention overhead**, which scales with concurrency, not row count: higher isolation (`SERIALIZABLE`) means more locks held for longer, so as the number of *concurrent* transactions touching overlapping rows grows, throughput can degrade from waiting/blocking. This isn't a classic row-count Big-O cost, but it's a very real scaling concern under load.
- **Space:** the database needs extra space to support rollback and isolation — undo logs / MVCC row versions (Postgres keeps old row versions until `VACUUM` cleans them up) cost roughly **O(number of uncommitted changes)** extra space, held until commit or rollback. Long-running transactions touching many rows can bloat this significantly.
- **Why this matters:** a "slow transaction" is rarely slow because of the transaction wrapper itself — it's almost always lock contention (other transactions waiting) or simply wrapping slow, unindexed queries. Keep transactions short and touch as few rows as possible to minimize both.

### Java (JDBC)
```java
conn.setAutoCommit(false);
try {
    PreparedStatement debit = conn.prepareStatement(
        "UPDATE accounts SET balance = balance - ? WHERE id = ?");
    debit.setBigDecimal(1, amount);
    debit.setInt(2, fromId);
    debit.executeUpdate();

    PreparedStatement credit = conn.prepareStatement(
        "UPDATE accounts SET balance = balance + ? WHERE id = ?");
    credit.setBigDecimal(1, amount);
    credit.setInt(2, toId);
    credit.executeUpdate();

    conn.commit();
} catch (SQLException e) {
    conn.rollback();
    throw e;
} finally {
    conn.setAutoCommit(true);
}
```

### PHP (PDO)
```php
try {
    $pdo->beginTransaction();

    $pdo->prepare("UPDATE accounts SET balance = balance - ? WHERE id = ?")
        ->execute([$amount, $fromId]);
    $pdo->prepare("UPDATE accounts SET balance = balance + ? WHERE id = ?")
        ->execute([$amount, $toId]);

    $pdo->commit();
} catch (PDOException $e) {
    $pdo->rollBack();
    throw $e;
}
```

---

## 15. Partitioning & Sharding

### The Problem
- A single table can grow so large that even indexed queries slow down, and a single database server can run out of capacity (CPU, memory, disk, or throughput) no matter how well the queries are tuned.

### What It Solves
- **Partitioning** splits one table's data into physical segments **within the same database server**, so the query planner can skip segments that can't possibly match (**partition pruning**) — this mainly helps I/O and query planning on one machine.
- **Sharding** takes this further by splitting data across **multiple separate database servers**, scaling throughput and total storage past what one machine can hold — at the cost of losing easy cross-shard joins and transactions.

### How It Works

**Partitioning — one logical table, split into pieces on one server:**
```sql
-- Range partitioning by date — common for time-series/log tables
CREATE TABLE orders (
    id INT NOT NULL,
    created_at DATE NOT NULL,
    total DECIMAL(10,2)
)
PARTITION BY RANGE (YEAR(created_at)) (
    PARTITION p2024 VALUES LESS THAN (2025),
    PARTITION p2025 VALUES LESS THAN (2026),
    PARTITION p2026 VALUES LESS THAN (2027)
);

-- A query filtered on created_at only scans the relevant partition
SELECT * FROM orders WHERE created_at >= '2026-01-01';
```
Other strategies: `LIST` (explicit value groups, e.g. by region code), `HASH` (evenly distribute by a hash of the key, no natural range).

**Sharding — data spread across separate servers:**
- Each shard is a **separate database server**, and the application (or a routing layer) decides which shard owns a given row, typically via a hash or range of a shard key (e.g. `user_id`).
```
shard = hash(user_id) % num_shards
```
- **Shard key selection matters enormously:** pick a key with high cardinality and even access distribution (`user_id` is usually good; `country` is often bad — creates hot shards for large countries).
- Cross-shard joins and transactions become hard or impossible — most sharded systems denormalize, use an application-level join, and treat cross-shard writes as eventually consistent or use a saga/2PC pattern.

### Java — application-level shard routing
```java
int shardCount = 4;
int shardId = Math.floorMod(userId.hashCode(), shardCount);
DataSource shardDataSource = shardRouter.get(shardId); // pool per shard

try (Connection conn = shardDataSource.getConnection();
     PreparedStatement ps = conn.prepareStatement("SELECT * FROM orders WHERE user_id = ?")) {
    ps.setLong(1, userId);
    ResultSet rs = ps.executeQuery();
}
```

### PHP — application-level shard routing
```php
$shardCount = 4;
$shardId = crc32((string) $userId) % $shardCount;
$pdo = $shardConnections[$shardId]; // pre-established PDO connection per shard

$stmt = $pdo->prepare("SELECT * FROM orders WHERE user_id = ?");
$stmt->execute([$userId]);
```

- **Partitioning vs. sharding, in one line:** partitioning scales a table on one machine (helps I/O and query planning); sharding scales the whole database horizontally across machines (helps throughput and storage past what one machine can hold), at the cost of losing easy cross-shard joins/transactions.

### Time & Space Complexity
- **Partitioning:** if a query's filter matches the partitioning key (e.g. `WHERE created_at >= ...` on a table partitioned by date), the planner only scans the matching partition(s) — turning a scan of **O(n)** rows (the whole table) into roughly **O(n / p)** rows, where `p` is the number of partitions. If the filter doesn't match the partition key, every partition must be scanned — effectively `O(n)` again, so pruning only helps when queries actually filter on the partition key.
- **Sharding:** spreads storage across `s` shards, so each shard holds roughly **O(n / s)** rows — this is what lets total storage and write throughput scale past what one machine could hold, since each shard is a fully independent server with its own disk/CPU/memory budget.
- **Cross-shard operations:** a query needing data from multiple shards (e.g. "top 10 users across the whole system") must query every shard and merge results in the application/routing layer — cost becomes **O(s) round-trips** plus **O((n/s) log(n/s))** work per shard for any sorting/merging, which is why cross-shard joins and global aggregates are the expensive case sharded systems try to avoid via denormalization.
- **Why this matters:** partitioning and sharding both work by shrinking the "n" any single operation deals with — but only for access patterns aligned with how the data was split (by partition key, or shard key). An access pattern that cuts across shards throws away that benefit and pays a multi-machine coordination cost instead.

---

## Interview Q&A (SSE Backend style)

**Q: Walk me through how you'd diagnose a slow endpoint that's backed by a single SQL query.**
A: Start with `EXPLAIN` (or `EXPLAIN ANALYZE` on Postgres) to see the actual execution plan — look for full table scans, missing index usage, or bad join order. Check row estimates vs. actual rows (a huge mismatch means stale statistics). Confirm the right index exists and matches the left-prefix rule for composite indexes. Then check outside the query itself: N+1 patterns in the calling code, missing connection pooling, or `OFFSET`-based pagination scanning millions of skipped rows. Fix the highest-leverage issue first, then re-measure — don't guess and change five things at once.

**Q: When would you choose a stored procedure over application-level logic, and what are the risks?**
A: Procedures make sense for tight, atomic, performance-critical operations where round-trips to the app tier would dominate cost (e.g. a multi-step balance transfer that must be atomic and fast). The risk is that business logic becomes invisible to the application codebase — hard to unit test, hard to code review as a diff, not portable across DB vendors, and invisible to APM/tracing tools. Most teams at scale keep logic in the application layer and reserve DB-side logic for narrow, rarely-changing invariants.

**Q: What's the difference between a trigger and an application-level event (e.g. outbox pattern)?**
A: A trigger runs synchronously and invisibly inside the database transaction the moment a row changes — great for guarantees that must hold even against direct DB writes, but hidden from anyone reading application code and hard to test/observe. An outbox pattern writes an event row in the same transaction as the business write, then a separate worker publishes it to a queue — visible in application code, testable, and decoupled, at the cost of needing that extra worker/infrastructure. Prefer the outbox pattern for anything downstream systems care about; reserve triggers for pure data-integrity concerns.

**Q: How do you decide between a composite index `(a, b)` and two separate single-column indexes on `a` and `b`?**
A: It depends on the query patterns. A composite index `(a, b)` speeds up queries filtering on `a` alone or on `a AND b` (left-prefix rule), and can serve as a covering index if `b` is also selected. Two separate indexes let the optimizer use index merge for `OR` conditions or when `b` is queried alone, but each index has its own write overhead. If your queries always filter on `a` first (or together with `b`), one composite index is usually better — fewer indexes to maintain and it can cover more query shapes.

**Q: What's the N+1 query problem and how do you fix it in an ORM-heavy codebase?**
A: Fetching a list of N parent rows, then issuing one additional query per parent to fetch related child rows — 1 + N total queries instead of 2. Fix with eager loading (`JOIN FETCH` in JPA, `with()` in Laravel Eloquent), or by batching the child fetch into a single `WHERE parent_id IN (...)` query. Detect it in code review or with query-count assertions in tests, and in production via APM tools that flag suspiciously high per-request query counts.

**Q: How would you shard a users table that's outgrown a single database instance?**
A: Pick a shard key with high cardinality and even access distribution — `user_id` is usually the right choice, hashed (`hash(user_id) % num_shards`) rather than ranged, to avoid hot shards. Route reads/writes at the application or a proxy layer based on that hash. Accept that cross-shard joins and multi-row transactions become hard: denormalize frequently-joined data into each shard, or move cross-shard consistency needs to an async/eventually-consistent model (outbox + queue) rather than trying to do distributed 2PC. Also plan the resharding story up front — consistent hashing minimizes data movement when you add shards later.

**Q: What's the difference between partitioning and sharding?**
A: Partitioning splits one table's data into physical segments within a single database instance — the query planner prunes partitions it doesn't need to scan, mainly helping I/O and query planning. Sharding splits data across multiple separate database instances/machines — it scales throughput and total storage beyond one machine's limits, but you lose easy cross-shard joins and transactions, and the application (or a routing layer) must know which shard owns which row.

**Q: `EXISTS` vs `IN` for a subquery — which do you reach for and why?**
A: `EXISTS` short-circuits on the first match and generally performs better for large or correlated subqueries; it also handles `NULL`s correctly. `IN` materializes the full subquery result set first and has a well-known footgun: `WHERE x NOT IN (subquery containing a NULL)` matches zero rows because SQL's three-valued logic makes every comparison against `NULL` unknown. For `NOT IN`/`NOT EXISTS` specifically, I default to `NOT EXISTS` unless I'm certain the subquery column can never be `NULL`.

**Q: How do database transaction isolation levels trade off against each other?**
A: Higher isolation levels prevent more anomalies (dirty reads → non-repeatable reads → phantom reads as you go up from `READ UNCOMMITTED` to `SERIALIZABLE`) but increase locking and reduce concurrency/throughput. Most OLTP systems default to `READ COMMITTED` or `REPEATABLE READ` as the practical middle ground — MySQL InnoDB defaults to `REPEATABLE READ`, PostgreSQL to `READ COMMITTED`. I'd only reach for `SERIALIZABLE` for logic that truly can't tolerate any anomaly (e.g. certain financial reconciliation), because it costs the most in contention and retry overhead.

**Q: Why might you introduce a materialized view instead of just caching the query result in Redis?**
A: A materialized view lives in the database, is queryable with full SQL (joins, filters, further aggregation) unlike an opaque cache blob, and can be refreshed on a schedule or trigger without any application code changes. Redis is faster and better for simple key-based lookups, but you lose the ability to query into the cached data further. I'd use a materialized view for expensive analytical/dashboard queries that still need SQL flexibility, and Redis for hot, simple, high-QPS lookups.

**Q: A `LEFT JOIN` with a `WHERE` filter on the right table is silently returning fewer rows than expected. Why, and how do you fix it?**
A: Because a `WHERE` clause is evaluated after the join — filtering on a right-side column (e.g. `WHERE o.status = 'paid'`) discards the NULL-filled rows for unmatched left rows, which functionally turns the `LEFT JOIN` back into an `INNER JOIN`. The fix is to move that condition into the `ON` clause (`LEFT JOIN orders o ON o.user_id = u.id AND o.status = 'paid'`) so unmatched left rows are preserved with NULLs instead of being filtered out.

**Q: When would you use a recursive CTE instead of handling hierarchy traversal in application code?**
A: When the hierarchy depth is unknown or unbounded and the data already lives in one relational table (e.g. an org chart, a category tree, a comment thread) — a recursive CTE walks it in a single round-trip instead of N application-level queries walking one level at a time. I'd move it to application code (or a graph database) if the traversal needs complex business logic per hop, needs to join across services, or if the hierarchy is deep/wide enough that recursive CTE performance becomes a concern — recursive CTEs can be slower than a purpose-built graph traversal at real scale.

**Q: How do you keep a JSON column from turning into an unmaintainable schema-less mess?**
A: Treat it as an escape hatch for a small number of sparse/optional attributes, not as the primary data model — the core, frequently-queried fields should stay as real typed columns with constraints. Add a functional/GIN index on the JSON paths you actually query. If I find myself writing complex filters or aggregations against nested JSON regularly, that's the signal the data belongs in its own normalized table or a proper document store, not a JSON blob column.

**Q: What's a real production bug you'd worry about with session variables (`SET @var`) in a connection-pooled service?**
A: Session variables are bound to the physical connection, not the logical request. In a pooled environment, a connection returned to the pool after request A can be handed to unrelated request B with request A's leftover `@var` still set — leaking state across requests. I'd avoid session variables in pooled code paths entirely, or explicitly reset them before the connection returns to the pool; this is a subtle bug because it only reproduces under real concurrent pooled load, not in a simple local test.

**Q: `UNION` vs `UNION ALL` — when does the difference actually matter for performance?**
A: `UNION` deduplicates the combined result set, which requires an extra sort/hash pass over all rows; `UNION ALL` just concatenates. If you already know the two result sets are disjoint (e.g. partitioned by a mutually exclusive condition), `UNION ALL` gives the same correct result without paying for deduplication — a meaningful difference at scale on large result sets.

**Q: How would you safely roll out a schema change (e.g. adding a `NOT NULL` column) to a large, high-traffic table without downtime?**
A: Add the column as nullable first (fast metadata-only change on most modern engines), backfill it in batches to avoid long locks or replication lag, then add the `NOT NULL`/default constraint once backfill is complete and verified. Avoid a single blocking `ALTER TABLE ... ADD COLUMN NOT NULL DEFAULT x` on a huge table — depending on the engine/version it can lock the table or rewrite it entirely. Coordinate with read replicas and any DDL replication lag, and always have a rollback plan for the migration itself, not just the application code.

---

## See Also
- [SQL Hands-on Practice](Data-and-Persistence/sql-practice) — JOINs, subqueries, CTEs, window functions from first principles
- [Data & Persistence Concepts](Data-and-Persistence/data-persistence-concepts) — ACID, isolation levels, N+1, pagination, CAP theorem
- [Database Types — SQL, NoSQL, Graph & Beyond](Data-and-Persistence/database-types) — choosing the right database for the job
