# Constraints

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
- **Space:** constraints add negligible space themselves — the real cost is the index backing `UNIQUE`/`PRIMARY KEY`/`FOREIGN KEY`, the same **O(n)** as any index ([Indexes](Data-and-Persistence/advanced-sql/indexes)).
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

*Part of [Advanced SQL & Database Programmability](Data-and-Persistence/advanced-sql-programmability).*
