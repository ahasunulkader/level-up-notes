# Functions

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

*Part of [Advanced SQL & Database Programmability](Data-and-Persistence/advanced-sql-programmability).*
