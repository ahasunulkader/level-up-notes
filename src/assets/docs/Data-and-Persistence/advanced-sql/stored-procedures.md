# Stored Procedures

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
- **Why this matters:** the benefit is reducing constant per-round-trip latency (often 1-5ms on a fast network, much more across regions) — not improving the algorithmic complexity of the underlying queries. If a query inside a procedure is slow, profile it with `EXPLAIN` ([Query Performance](Data-and-Persistence/advanced-sql/query-performance)); wrapping a bad query plan in a procedure doesn't fix it.

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

*Part of [Advanced SQL & Database Programmability](Data-and-Persistence/advanced-sql-programmability).*
