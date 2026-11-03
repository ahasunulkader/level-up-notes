# Triggers

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

*Part of [Advanced SQL & Database Programmability](Data-and-Persistence/advanced-sql-programmability).*
