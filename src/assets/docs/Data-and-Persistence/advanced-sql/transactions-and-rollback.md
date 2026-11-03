# Transactions & Rollback

### The Problem
- Some operations involve multiple statements that must all succeed together, or not at all — e.g. debiting one account and crediting another. If the debit succeeds but the credit fails halfway through, money disappears.

### What It Solves
- A transaction groups multiple statements into a single all-or-nothing unit (**ACID**). `COMMIT` makes changes permanent; `ROLLBACK` undoes everything since the transaction began; `SAVEPOINT` allows partial rollback within a larger transaction.
- **Isolation levels** control how much one transaction can see of another transaction's in-progress changes, trading off consistency against concurrency.

### How It Works
**Money transfer: check the balance first, then debit and credit**

```sql
START TRANSACTION;

-- 1. Lock the sender's row and read the balance (blocks concurrent transfers from this account)
SELECT balance FROM accounts WHERE id = 1 FOR UPDATE;

-- 2. Application checks: balance >= 100 ?
--    NO  -> ROLLBACK; (stop here, nothing changed)
--    YES -> continue

UPDATE accounts SET balance = balance - 100 WHERE id = 1;
UPDATE accounts SET balance = balance + 100 WHERE id = 2;

COMMIT;
```

- `FOR UPDATE` is the key part. Without it, two transfers could both read a balance of 100, both pass the check, and both debit, leaving the account at -100 (a race condition).
- If either `UPDATE` fails, or the check fails, `ROLLBACK` leaves both accounts untouched.

**Same thing in pure SQL: the credit only runs if the debit worked**

Plain SQL has no `if`, so a guarded debit followed by a separate credit is a bug: if the debit affects 0 rows (insufficient funds), the credit would still run and money is created from nothing. Two ways to make the credit depend on the debit:

*PostgreSQL: a CTE makes it one atomic statement*

```sql
WITH debit AS (
    UPDATE accounts SET balance = balance - 100
    WHERE id = 1 AND balance >= 100
    RETURNING id
)
UPDATE accounts SET balance = balance + 100
WHERE id = 2 AND EXISTS (SELECT 1 FROM debit);
```

- `debit` returns a row only if the debit happened. If funds were insufficient it returns nothing, so the credit matches 0 rows and neither account changes.
- This is a single statement, so it is atomic by itself. Wrap it in `START TRANSACTION` only if you add more statements.
- Data-modifying CTEs are a PostgreSQL feature; MySQL doesn't support them.

*MySQL: stored procedure with `IF`*

```sql
DELIMITER //
CREATE PROCEDURE transfer(IN from_id INT, IN to_id INT, IN amt DECIMAL(10,2))
BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    UPDATE accounts SET balance = balance - amt
    WHERE id = from_id AND balance >= amt;

    IF ROW_COUNT() = 0 THEN
        ROLLBACK;
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Insufficient funds';
    END IF;

    UPDATE accounts SET balance = balance + amt WHERE id = to_id;
    COMMIT;
END //
DELIMITER ;
```

- `ROW_COUNT()` is checked right after the debit, so the credit never runs on failure.
- Also add `CHECK (balance >= 0)` on the column (see [Constraints](Data-and-Persistence/advanced-sql/constraints)) as a last line of defence.

**Savepoints: partial rollback inside a larger transaction**

```sql
START TRANSACTION;

INSERT INTO orders (id, customer_id) VALUES (500, 7);   -- must succeed

SAVEPOINT before_bonus;
INSERT INTO loyalty_points (customer_id, points) VALUES (7, 50);  -- optional extra

-- The optional step failed or isn't needed: undo only that part
ROLLBACK TO SAVEPOINT before_bonus;

COMMIT;   -- the order is still saved
```

- `ROLLBACK TO SAVEPOINT` undoes only the work after the savepoint; the transaction stays open and earlier work is kept until `COMMIT`.

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
    // Guarded debit: only succeeds if there is enough balance
    PreparedStatement debit = conn.prepareStatement(
        "UPDATE accounts SET balance = balance - ? WHERE id = ? AND balance >= ?");
    debit.setBigDecimal(1, amount);
    debit.setInt(2, fromId);
    debit.setBigDecimal(3, amount);
    if (debit.executeUpdate() == 0) {
        throw new SQLException("Insufficient funds");
    }

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

    // Guarded debit: only succeeds if there is enough balance
    $debit = $pdo->prepare(
        "UPDATE accounts SET balance = balance - ? WHERE id = ? AND balance >= ?");
    $debit->execute([$amount, $fromId, $amount]);
    if ($debit->rowCount() === 0) {
        throw new PDOException("Insufficient funds");
    }

    $pdo->prepare("UPDATE accounts SET balance = balance + ? WHERE id = ?")
        ->execute([$amount, $toId]);

    $pdo->commit();
} catch (PDOException $e) {
    $pdo->rollBack();
    throw $e;
}
```

---

*Part of [Advanced SQL & Database Programmability](Data-and-Persistence/advanced-sql-programmability).*
