# SQL Hands-on Practice

SQL is essential for any backend role. Interviewers test whether you can write clean, efficient queries from scratch. This guide covers easy to mid-level SQL with real scenarios and the PHP/Laravel equivalents.

All examples use these common tables:

```sql
CREATE TABLE users (
    id         INT PRIMARY KEY AUTO_INCREMENT,
    name       VARCHAR(100),
    email      VARCHAR(255) UNIQUE,
    role       VARCHAR(50) DEFAULT 'user',
    active     TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE orders (
    id         INT PRIMARY KEY AUTO_INCREMENT,
    user_id    INT,
    status     VARCHAR(50),  -- 'pending', 'paid', 'shipped', 'cancelled'
    total      DECIMAL(10,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE products (
    id         INT PRIMARY KEY AUTO_INCREMENT,
    name       VARCHAR(200),
    category   VARCHAR(100),
    price      DECIMAL(10,2),
    stock      INT DEFAULT 0
);

CREATE TABLE order_items (
    id         INT PRIMARY KEY AUTO_INCREMENT,
    order_id   INT,
    product_id INT,
    quantity   INT,
    unit_price DECIMAL(10,2),
    FOREIGN KEY (order_id)   REFERENCES orders(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
);
```

---

## 1. Basic SELECT

```sql
-- All columns
SELECT * FROM users;

-- Specific columns
SELECT id, name, email FROM users;

-- With alias
SELECT id, name AS full_name, email AS contact FROM users;

-- Distinct values
SELECT DISTINCT role FROM users;
SELECT DISTINCT category FROM products;
```

**PHP/Laravel:**
```php
<?php
// All
User::all();
DB::table('users')->get();

// Specific columns
User::select('id', 'name', 'email')->get();
DB::table('users')->select('id', 'name as full_name')->get();

// Distinct
DB::table('users')->distinct()->pluck('role');
```

---

## 2. WHERE — Filtering

```sql
-- Basic comparison
SELECT * FROM users WHERE role = 'admin';
SELECT * FROM orders WHERE total > 100;
SELECT * FROM orders WHERE status != 'cancelled';

-- Multiple conditions
SELECT * FROM orders WHERE status = 'paid' AND total > 200;
SELECT * FROM orders WHERE status = 'pending' OR status = 'paid';

-- IN — match any of a list
SELECT * FROM orders WHERE status IN ('paid', 'shipped');
SELECT * FROM users WHERE id IN (1, 2, 3, 5, 8);

-- NOT IN
SELECT * FROM products WHERE category NOT IN ('Electronics', 'Clothing');

-- BETWEEN — inclusive
SELECT * FROM orders WHERE total BETWEEN 50 AND 200;
SELECT * FROM orders WHERE created_at BETWEEN '2026-01-01' AND '2026-12-31';

-- LIKE — pattern matching
SELECT * FROM users WHERE name LIKE 'Ali%';          -- starts with Ali
SELECT * FROM users WHERE email LIKE '%@gmail.com';  -- ends with @gmail.com
SELECT * FROM products WHERE name LIKE '%wireless%'; -- contains wireless

-- IS NULL / IS NOT NULL
SELECT * FROM users WHERE deleted_at IS NULL;    -- not deleted
SELECT * FROM users WHERE deleted_at IS NOT NULL; -- soft-deleted

-- NULL comparison — never use = NULL!
-- WHERE age = NULL  -- WRONG: always returns 0 rows
-- WHERE age IS NULL -- CORRECT
```

**PHP/Laravel:**
```php
<?php
User::where('role', 'admin')->get();
Order::whereIn('status', ['paid', 'shipped'])->get();
Order::whereBetween('total', [50, 200])->get();
User::where('name', 'like', 'Ali%')->get();
User::whereNull('deleted_at')->get();
User::whereNotNull('deleted_at')->get();

// Complex conditions
Order::where('status', 'paid')
    ->where('total', '>', 200)
    ->orWhere('status', 'shipped')
    ->get();

// Grouped conditions
Order::where(function ($q) {
    $q->where('status', 'paid')->orWhere('status', 'shipped');
})->where('total', '>', 100)->get();
```

---

## 3. ORDER BY and LIMIT

```sql
-- Sort ascending (default)
SELECT * FROM products ORDER BY price ASC;
SELECT * FROM products ORDER BY price;        -- same as ASC

-- Sort descending
SELECT * FROM orders ORDER BY created_at DESC; -- newest first

-- Multiple sort columns
SELECT * FROM users ORDER BY role ASC, name ASC; -- by role, then name alphabetically

-- LIMIT — restrict result count
SELECT * FROM products ORDER BY price DESC LIMIT 5; -- top 5 most expensive

-- LIMIT with OFFSET (pagination)
SELECT * FROM orders ORDER BY created_at DESC LIMIT 10 OFFSET 20; -- page 3
```

**PHP/Laravel:**
```php
<?php
Product::orderBy('price', 'desc')->take(5)->get();
Order::orderBy('created_at', 'desc')->skip(20)->take(10)->get();
Order::orderByDesc('created_at')->paginate(10); // built-in pagination
```

---

## 4. JOINs

JOINs combine rows from two or more tables based on a related column.

### INNER JOIN

Returns only rows where there is a match in **both** tables.

```sql
-- Orders with their user names (only shows orders that have a matching user)
SELECT
    o.id         AS order_id,
    u.name       AS customer,
    o.total,
    o.status
FROM orders o
INNER JOIN users u ON o.user_id = u.id
WHERE o.status = 'paid'
ORDER BY o.created_at DESC;
```

### LEFT JOIN

Returns **all rows from the left table**, plus matching rows from the right. If no match, right side columns are NULL.

```sql
-- All users, with their total orders (users with no orders show 0)
SELECT
    u.id,
    u.name,
    COUNT(o.id) AS order_count,
    COALESCE(SUM(o.total), 0) AS lifetime_value
FROM users u
LEFT JOIN orders o ON u.id = o.user_id
GROUP BY u.id, u.name
ORDER BY lifetime_value DESC;
```

### RIGHT JOIN

Returns **all rows from the right table**, plus matching rows from the left. (Rarely used — usually rewritten as LEFT JOIN with tables swapped.)

### FULL OUTER JOIN (MySQL doesn't support this natively — use UNION)

```sql
-- Simulate FULL OUTER JOIN in MySQL
SELECT u.name, o.id AS order_id
FROM users u LEFT JOIN orders o ON u.id = o.user_id
UNION
SELECT u.name, o.id AS order_id
FROM users u RIGHT JOIN orders o ON u.id = o.user_id;
```

### Multi-Table JOIN

```sql
-- Order items with product names and order info
SELECT
    o.id           AS order_id,
    u.name         AS customer,
    p.name         AS product,
    oi.quantity,
    oi.unit_price,
    (oi.quantity * oi.unit_price) AS line_total
FROM order_items oi
INNER JOIN orders   o ON oi.order_id   = o.id
INNER JOIN users    u ON o.user_id     = u.id
INNER JOIN products p ON oi.product_id = p.id
WHERE o.status = 'paid'
ORDER BY o.id, p.name;
```

### JOIN vs Subquery

```sql
-- Find users who have placed at least one order (JOIN approach)
SELECT DISTINCT u.id, u.name
FROM users u
INNER JOIN orders o ON u.id = o.user_id;

-- Same result with subquery (often less efficient)
SELECT id, name FROM users
WHERE id IN (SELECT DISTINCT user_id FROM orders);

-- EXISTS is often faster than IN for subqueries
SELECT id, name FROM users u
WHERE EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id);
```

**PHP/Laravel:**
```php
<?php
// JOIN
DB::table('orders')
    ->join('users', 'orders.user_id', '=', 'users.id')
    ->select('orders.id', 'users.name', 'orders.total')
    ->where('orders.status', 'paid')
    ->get();

// Eloquent with relationships
Order::with('user', 'items.product')->where('status', 'paid')->get();

// Left join
User::leftJoin('orders', 'users.id', '=', 'orders.user_id')
    ->select('users.*', DB::raw('COUNT(orders.id) as order_count'))
    ->groupBy('users.id')
    ->get();
```

---

## 5. Aggregate Functions

```sql
-- COUNT
SELECT COUNT(*) AS total_users FROM users;
SELECT COUNT(*) AS total FROM orders WHERE status = 'paid';
SELECT COUNT(DISTINCT user_id) AS unique_buyers FROM orders;

-- SUM
SELECT SUM(total) AS revenue FROM orders WHERE status = 'paid';
SELECT SUM(quantity * unit_price) AS total_value FROM order_items;

-- AVG
SELECT AVG(total) AS avg_order_value FROM orders WHERE status = 'paid';

-- MAX / MIN
SELECT MAX(total) AS biggest_order FROM orders;
SELECT MIN(price) AS cheapest FROM products WHERE category = 'Electronics';

-- Combined
SELECT
    COUNT(*)        AS order_count,
    SUM(total)      AS total_revenue,
    AVG(total)      AS avg_order,
    MAX(total)      AS largest_order,
    MIN(total)      AS smallest_order
FROM orders
WHERE status = 'paid'
  AND created_at >= '2026-01-01';
```

---

## 6. GROUP BY and HAVING

**GROUP BY** groups rows by one or more columns so you can aggregate each group.
**HAVING** filters on the aggregated result (WHERE filters before grouping, HAVING filters after).

```sql
-- Orders per user
SELECT user_id, COUNT(*) AS order_count
FROM orders
GROUP BY user_id
ORDER BY order_count DESC;

-- Revenue by status
SELECT status, COUNT(*) AS count, SUM(total) AS revenue
FROM orders
GROUP BY status;

-- Revenue by month
SELECT
    DATE_FORMAT(created_at, '%Y-%m') AS month,
    COUNT(*)                         AS orders,
    SUM(total)                       AS revenue
FROM orders
WHERE status = 'paid'
GROUP BY DATE_FORMAT(created_at, '%Y-%m')
ORDER BY month;

-- HAVING — find users with more than 5 orders
SELECT user_id, COUNT(*) AS order_count
FROM orders
GROUP BY user_id
HAVING order_count > 5
ORDER BY order_count DESC;

-- WHERE + HAVING together
-- WHERE filters individual rows BEFORE grouping
-- HAVING filters the aggregated result AFTER grouping
SELECT
    user_id,
    COUNT(*) AS paid_order_count,
    SUM(total) AS total_spent
FROM orders
WHERE status = 'paid'        -- filter rows first
GROUP BY user_id
HAVING total_spent > 1000    -- then filter groups
ORDER BY total_spent DESC;
```

> **Interview trap:** You cannot use WHERE to filter on aggregated values like COUNT or SUM — you must use HAVING.

**PHP/Laravel:**
```php
<?php
DB::table('orders')
    ->select('user_id', DB::raw('COUNT(*) as order_count'), DB::raw('SUM(total) as total_spent'))
    ->where('status', 'paid')
    ->groupBy('user_id')
    ->having('total_spent', '>', 1000)
    ->orderByDesc('total_spent')
    ->get();
```

---

## 7. Subqueries

A subquery is a query nested inside another query.

```sql
-- Scalar subquery: returns a single value
SELECT name, total,
    (SELECT AVG(total) FROM orders WHERE status = 'paid') AS avg_order
FROM orders
WHERE status = 'paid';

-- Subquery in WHERE — find users who ordered more than the average
SELECT user_id, COUNT(*) AS order_count
FROM orders
GROUP BY user_id
HAVING order_count > (SELECT AVG(cnt) FROM (
    SELECT COUNT(*) AS cnt FROM orders GROUP BY user_id
) AS sub);

-- Correlated subquery — references outer query (runs once per outer row)
-- Find the most recent order for each user
SELECT * FROM orders o
WHERE created_at = (
    SELECT MAX(created_at)
    FROM orders
    WHERE user_id = o.user_id  -- references outer query
);

-- IN with subquery
SELECT * FROM users
WHERE id IN (
    SELECT DISTINCT user_id FROM orders WHERE total > 500
);

-- NOT EXISTS — find users with NO orders
SELECT * FROM users u
WHERE NOT EXISTS (
    SELECT 1 FROM orders o WHERE o.user_id = u.id
);
```

---

## 8. CTEs (Common Table Expressions)

CTEs (WITH clause) make complex queries readable by breaking them into named steps.

```sql
-- Simple CTE
WITH paid_orders AS (
    SELECT user_id, SUM(total) AS lifetime_value
    FROM orders
    WHERE status = 'paid'
    GROUP BY user_id
)
SELECT u.name, po.lifetime_value
FROM users u
INNER JOIN paid_orders po ON u.id = po.user_id
WHERE po.lifetime_value > 1000
ORDER BY po.lifetime_value DESC;

-- Multiple CTEs
WITH
    monthly_revenue AS (
        SELECT
            DATE_FORMAT(created_at, '%Y-%m') AS month,
            SUM(total) AS revenue
        FROM orders
        WHERE status = 'paid'
        GROUP BY DATE_FORMAT(created_at, '%Y-%m')
    ),
    avg_monthly AS (
        SELECT AVG(revenue) AS avg_revenue FROM monthly_revenue
    )
SELECT
    mr.month,
    mr.revenue,
    am.avg_revenue,
    mr.revenue - am.avg_revenue AS diff_from_avg
FROM monthly_revenue mr, avg_monthly am
ORDER BY mr.month;
```

---

## 9. INSERT, UPDATE, DELETE

```sql
-- INSERT
INSERT INTO users (name, email, role) VALUES ('Alice', 'alice@example.com', 'admin');

-- Insert multiple rows
INSERT INTO products (name, category, price, stock) VALUES
    ('Wireless Mouse',    'Electronics', 29.99, 100),
    ('Mechanical Keyboard','Electronics',79.99, 50),
    ('Monitor Stand',     'Accessories', 39.99, 75);

-- INSERT ... ON DUPLICATE KEY UPDATE (upsert)
INSERT INTO users (email, name, active)
VALUES ('alice@example.com', 'Alice Updated', 1)
ON DUPLICATE KEY UPDATE name = VALUES(name), active = VALUES(active);

-- UPDATE
UPDATE users SET active = 0 WHERE last_login < DATE_SUB(NOW(), INTERVAL 1 YEAR);
UPDATE orders SET status = 'shipped' WHERE status = 'paid' AND created_at < '2026-01-01';

-- UPDATE with JOIN
UPDATE orders o
INNER JOIN users u ON o.user_id = u.id
SET o.status = 'cancelled'
WHERE u.active = 0 AND o.status = 'pending';

-- DELETE
DELETE FROM users WHERE active = 0 AND created_at < '2024-01-01';

-- Safe DELETE — preview with SELECT first
SELECT COUNT(*) FROM users WHERE active = 0 AND created_at < '2024-01-01';
-- Then delete:
DELETE FROM users WHERE active = 0 AND created_at < '2024-01-01';

-- TRUNCATE — delete all rows (faster than DELETE, cannot be rolled back in MySQL)
TRUNCATE TABLE sessions;
```

---

## 10. Useful Functions

```sql
-- String functions
SELECT UPPER(name), LOWER(email), LENGTH(name) FROM users;
SELECT CONCAT(first_name, ' ', last_name) AS full_name FROM users;
SELECT TRIM('  hello  ');        -- 'hello'
SELECT SUBSTRING(email, 1, 5);  -- first 5 chars
SELECT REPLACE(phone, '-', ''); -- remove dashes

-- Date functions
SELECT NOW(), CURDATE(), CURTIME();
SELECT DATE_FORMAT(created_at, '%d %M %Y') AS formatted FROM orders;
SELECT DATEDIFF(NOW(), created_at) AS days_old FROM orders;
SELECT DATE_ADD(created_at, INTERVAL 30 DAY) AS expiry FROM orders;
SELECT YEAR(created_at), MONTH(created_at), DAY(created_at) FROM orders;

-- NULL handling
SELECT COALESCE(phone, 'N/A') AS phone FROM users;         -- first non-null
SELECT IFNULL(total, 0) AS total FROM orders;              -- replace null with 0
SELECT NULLIF(status, 'cancelled') AS status FROM orders;  -- null if equal

-- Conditional
SELECT
    name,
    CASE
        WHEN total > 500 THEN 'High Value'
        WHEN total > 100 THEN 'Medium Value'
        ELSE 'Low Value'
    END AS order_tier
FROM orders;

-- IF shorthand
SELECT name, IF(active = 1, 'Active', 'Inactive') AS status FROM users;
```

---

## 11. Window Functions (Intermediate)

Window functions perform calculations across a set of rows **without collapsing them** like GROUP BY does.

```sql
-- ROW_NUMBER — sequential number within a partition
SELECT
    user_id,
    id AS order_id,
    total,
    ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) AS order_rank
FROM orders;

-- Use case: get each user's most recent order
SELECT * FROM (
    SELECT *,
        ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) AS rn
    FROM orders
) AS ranked
WHERE rn = 1;

-- RANK — same rank for ties, gaps after ties
-- DENSE_RANK — same rank for ties, no gaps

-- Running total (cumulative sum)
SELECT
    created_at,
    total,
    SUM(total) OVER (ORDER BY created_at) AS running_total
FROM orders
WHERE status = 'paid';

-- LAG / LEAD — previous/next row value
SELECT
    DATE_FORMAT(created_at, '%Y-%m') AS month,
    SUM(total) AS revenue,
    LAG(SUM(total)) OVER (ORDER BY DATE_FORMAT(created_at, '%Y-%m')) AS prev_month,
    SUM(total) - LAG(SUM(total)) OVER (ORDER BY DATE_FORMAT(created_at, '%Y-%m')) AS growth
FROM orders
WHERE status = 'paid'
GROUP BY DATE_FORMAT(created_at, '%Y-%m');
```

---

## 12. Practice Problems

### Easy

```sql
-- 1. List all active users sorted by name
SELECT * FROM users WHERE active = 1 ORDER BY name ASC;

-- 2. Count orders by status
SELECT status, COUNT(*) AS count FROM orders GROUP BY status;

-- 3. Find the 5 most expensive products
SELECT * FROM products ORDER BY price DESC LIMIT 5;

-- 4. Total revenue from paid orders
SELECT SUM(total) AS total_revenue FROM orders WHERE status = 'paid';

-- 5. Find all users who registered in 2026
SELECT * FROM users WHERE YEAR(created_at) = 2026;
```

### Medium

```sql
-- 6. For each user, show their name and total amount spent on paid orders
SELECT u.name, COALESCE(SUM(o.total), 0) AS total_spent
FROM users u
LEFT JOIN orders o ON u.id = o.user_id AND o.status = 'paid'
GROUP BY u.id, u.name
ORDER BY total_spent DESC;

-- 7. Find users who have never placed an order
SELECT u.id, u.name, u.email
FROM users u
LEFT JOIN orders o ON u.id = o.user_id
WHERE o.id IS NULL;

-- 8. Top 3 products by units sold
SELECT p.name, SUM(oi.quantity) AS total_sold
FROM order_items oi
INNER JOIN products p ON oi.product_id = p.id
INNER JOIN orders o ON oi.order_id = o.id
WHERE o.status IN ('paid', 'shipped')
GROUP BY p.id, p.name
ORDER BY total_sold DESC
LIMIT 3;

-- 9. Month-over-month revenue
SELECT
    DATE_FORMAT(created_at, '%Y-%m') AS month,
    SUM(total)                       AS revenue,
    COUNT(*)                         AS orders
FROM orders
WHERE status = 'paid'
GROUP BY DATE_FORMAT(created_at, '%Y-%m')
ORDER BY month;

-- 10. Find duplicate emails
SELECT email, COUNT(*) AS count
FROM users
GROUP BY email
HAVING count > 1;

-- 11. Products with low stock (less than 10 units) that have been ordered
SELECT p.id, p.name, p.stock, COUNT(DISTINCT oi.order_id) AS times_ordered
FROM products p
INNER JOIN order_items oi ON p.id = oi.product_id
WHERE p.stock < 10
GROUP BY p.id, p.name, p.stock
ORDER BY p.stock ASC;

-- 12. Average order value by user role
SELECT u.role, AVG(o.total) AS avg_order_value, COUNT(o.id) AS total_orders
FROM orders o
INNER JOIN users u ON o.user_id = u.id
WHERE o.status = 'paid'
GROUP BY u.role;
```

---

## Interview Q&A

**Q: What is the difference between WHERE and HAVING?**
A: `WHERE` filters **individual rows before** grouping — it cannot reference aggregate functions like `COUNT()` or `SUM()`. `HAVING` filters **groups after** `GROUP BY` — it can reference aggregate functions. Example: `WHERE status = 'paid'` filters rows; `HAVING COUNT(*) > 5` filters the grouped results.

**Q: What is the difference between INNER JOIN and LEFT JOIN?**
A: INNER JOIN returns only rows where a match exists in both tables — non-matching rows are excluded from both sides. LEFT JOIN returns all rows from the left table regardless of a match, with NULL for right-side columns when no match exists. Use LEFT JOIN when you want all records from one side even if they have no related records.

**Q: What does GROUP BY do and what rule must you follow?**
A: GROUP BY collapses rows with the same value(s) into a single group, allowing aggregate functions to compute per-group results. The rule: every column in SELECT must be either in the GROUP BY clause or wrapped in an aggregate function (COUNT, SUM, MAX, etc.) — otherwise the result is ambiguous.

**Q: When would you use a CTE vs a subquery?**
A: CTEs (WITH clause) are preferred when the same subquery is referenced multiple times, or when breaking a complex query into readable steps. Subqueries are fine for simple one-time use. CTEs improve readability significantly and some databases optimize them differently. Recursive CTEs (not shown here) are the only way to do tree traversal in SQL.

**Q: What is the difference between DELETE and TRUNCATE?**
A: DELETE removes rows one by one, fires triggers, writes to the undo log, and can be rolled back in a transaction. TRUNCATE removes all rows at once by deallocating data pages — it's much faster for clearing a table but cannot be rolled back in MySQL, doesn't fire row-level triggers, and resets AUTO_INCREMENT. Use DELETE for conditional removal; TRUNCATE to wipe an entire table.
