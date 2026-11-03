# CTEs (Common Table Expressions)

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
- It only exists for the **duration of that one query** — nothing is saved to the database, unlike a view ([Views](Data-and-Persistence/advanced-sql/views)).

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
- **Inline subquery ([Subqueries](Data-and-Persistence/advanced-sql/subqueries)):** best for a short, one-off, single-use piece of logic nested directly in a query. Gets hard to read once nested more than 1-2 levels.
- **CTE (`WITH`):** best when you want to name a step for readability, reuse that name more than once in the same query, or need recursion. Exists only for that one statement.
- **View ([Views](Data-and-Persistence/advanced-sql/views)):** best when the same query needs to be reused across **many different queries/statements**, not just once — a CTE can't be shared outside the single `SELECT` it's attached to.

### Time & Space Complexity
- **Non-recursive CTE:** costs exactly what the query inside it costs — naming it with `WITH` doesn't add a new complexity class on its own. But how the database *executes* it varies:
  - **PostgreSQL 11 and earlier** treated every CTE as an **"optimization fence"** — it was always fully computed and **materialized (O(m) space)** before the outer query ran, even if the outer query only needed a handful of rows from it. This could make a CTE slower than the equivalent inline subquery.
  - **PostgreSQL 12+** inlines non-recursive CTEs by default (like a subquery) unless you force materialization with the `MATERIALIZED` keyword — so complexity now matches whatever the planner would pick for an equivalent subquery.
  - **MySQL 8+** similarly may inline or materialize a CTE depending on whether it's referenced once or multiple times.
- **Recursive CTE:** total cost is roughly **O(depth × rows-per-level)** — the anchor runs once, and the recursive member re-runs once per round, each round only processing the *previous* round's new rows. For a tree with depth `d` and branching factor `b` (children per node), that's on the order of **O(b^d)** rows in the worst case (a wide, deep tree) — the same shape as a graph/tree traversal in application code.
  - **Space:** the database keeps the full accumulated result (every row found across all rounds so far) available to feed the next round — **O(total rows returned)** space, which can be substantial for a very deep or wide hierarchy.
- **Why this matters:** a recursive CTE is convenient, but it's still doing real traversal work. For a genuinely huge or deep hierarchy (e.g. a social graph with millions of edges), the `O(b^d)`-shaped cost can exceed what a purpose-built graph database or an application-level, pruned traversal would cost — which is why the Recursive CTEs section above says to reconsider recursive CTEs at extreme scale.

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

*Part of [Advanced SQL & Database Programmability](Data-and-Persistence/advanced-sql-programmability).*
