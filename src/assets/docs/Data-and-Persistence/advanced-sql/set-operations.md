# Set Operations

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

*Part of [Advanced SQL & Database Programmability](Data-and-Persistence/advanced-sql-programmability).*
