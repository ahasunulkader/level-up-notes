# Subqueries

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

*Part of [Advanced SQL & Database Programmability](Data-and-Persistence/advanced-sql-programmability).*
