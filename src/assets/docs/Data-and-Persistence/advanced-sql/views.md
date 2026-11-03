# Views

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
| Recursive View | No | No | Rare — most DBs use a recursive CTE instead ([CTEs](Data-and-Persistence/advanced-sql/ctes)) |
| Inline View / Derived Table | No | No | Subquery in `FROM`, scoped to one query, never persisted |
| System / Catalog View | N/A (metadata) | No | `information_schema`, `pg_catalog` — introspect the DB itself |

### Time & Space Complexity (Views, in general)
- **Simple/complex views (non-materialized):** a view has **zero storage cost** of its own, but that also means **zero speed benefit** by itself — querying it costs exactly the same as running its underlying query fresh every time (same complexity as whatever that query would be: `O(n)` for a scan, `O(log n)` for an indexed lookup). A view improves *readability and access control*, not performance.
- **Materialized/Indexed views:** trade **O(n) space** (the stored snapshot) for turning an expensive query into a cheap read (`O(log n)` with an index, close to `O(1)` for a direct lookup) — you pay the computation cost once, at refresh/write time, instead of on every read. See the **Materialized Views** and **Indexed Views** sections below for exactly where that cost lands.

---

### Simple Views

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

### Complex Views

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

### Updatable Views & `WITH CHECK OPTION`

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

### Materialized Views

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

### Indexed Views (SQL Server)

**The Problem**
- Materialized views (previous section) are fast to read, but they go stale until someone runs `REFRESH`. Some systems need an aggregate that's **always** up to date, without a separate refresh job to manage.

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

**Time & Space Complexity:** same **O(result size)** storage as a plain materialized view, but the refresh cost is no longer a scheduled batch — it shifts to every write: each `INSERT`/`UPDATE`/`DELETE` on the base table also pays `O(log n)`-ish work to keep the indexed view in sync, similar to maintaining an extra index ([Indexes](Data-and-Persistence/advanced-sql/indexes)) or a trigger ([Triggers](Data-and-Persistence/advanced-sql/triggers)). You get always-fresh `O(log n)` reads in exchange for a little extra cost on every write.

---

### Recursive Views

**The Problem**
- Hierarchies (an org chart, a category tree, a comment thread) need a query that can walk "up" or "down" an unknown number of levels. A normal view can't express that kind of self-referencing logic.

**What It Solves**
- Standard SQL (and Oracle) technically allows `CREATE RECURSIVE VIEW`, but almost nobody uses it in practice — MySQL and PostgreSQL don't support it directly.
- The practical answer is a **recursive CTE** ([CTEs](Data-and-Persistence/advanced-sql/ctes)) — optionally wrapped in a plain view so it's reusable under a simple name.

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

### Inline Views / Derived Tables

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

- **Inline view vs. CTE:** functionally similar, but a `WITH` CTE ([CTEs](Data-and-Persistence/advanced-sql/ctes)) can be referenced multiple times in the same query and reads top-to-bottom, while a derived table is nested inline and gets hard to read past 1-2 levels of nesting.

---

### System / Catalog Views

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

*Part of [Advanced SQL & Database Programmability](Data-and-Persistence/advanced-sql-programmability).*
