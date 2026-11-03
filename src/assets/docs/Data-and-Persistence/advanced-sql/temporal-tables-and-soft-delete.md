# Temporal Tables, Audit History & Soft Delete

### The Problem
- A normal table only knows **the present**. When you `UPDATE` or `DELETE`, the old value is gone forever.
- Real questions need the past:
  - "What was this customer's address **when we shipped the order** last March?"
  - "Who changed this price, and what was it before?"
  - "A user deleted a record by mistake. Can we bring it back?"
  - "Show the report **as it looked** on 31 December" (for an audit).

```
Today:    customers: id=1, city='Sylhet'
Last year it was 'Dhaka'. After the UPDATE that fact no longer exists anywhere.
```

### What It Solves
Three related techniques, from simplest to most powerful:

| Technique | Keeps | Answers |
|---|---|---|
| **Soft delete** | Deleted rows (flagged, not removed) | "Restore this", "who deleted it?" |
| **Audit / history table** | A log of every change (who, when, old, new) | "What changed and who did it?" |
| **Temporal table** (system-versioned or bitemporal) | Full row history with time ranges | "What was true **at time T**?" (time travel queries) |

### How It Works

## Part 1 — Soft Delete

#### 1. The idea
Instead of `DELETE FROM users WHERE id = 5`, mark the row as deleted.
```
BEFORE (hard delete)            AFTER (soft delete)
users                           users
+----+------+                   +----+------+---------------------+
| id | name |                   | id | name | deleted_at          |
+----+------+                   +----+------+---------------------+
| 5  | Asha |  DELETE ──►       | 5  | Asha | 2026-11-01 10:00:00 |   <- still there, just flagged
+----+------+  (row gone)       +----+------+---------------------+
```
```sql
ALTER TABLE users ADD COLUMN deleted_at DATETIME NULL;          -- NULL means "alive"
-- (optional) also store who: ADD COLUMN deleted_by INT NULL

-- "Delete"
UPDATE users SET deleted_at = NOW() WHERE id = 5;

-- Restore
UPDATE users SET deleted_at = NULL WHERE id = 5;

-- Normal queries must ignore deleted rows
SELECT * FROM users WHERE deleted_at IS NULL;
```
Use a timestamp (`deleted_at`) instead of a boolean (`is_deleted`): it tells you **when** too.

#### 2. Making soft delete safe
**a) Hide deleted rows automatically** so nobody forgets the filter — use a view:
```sql
CREATE VIEW active_users AS
SELECT * FROM users WHERE deleted_at IS NULL;      -- the app queries active_users
```
ORMs help too: Hibernate `@SQLRestriction("deleted_at IS NULL")`, Laravel `SoftDeletes`, Doctrine filters.

**b) Unique constraints break!** If Asha (`a@x.com`) is soft-deleted and signs up again with the same email, `UNIQUE(email)` rejects it.
```sql
-- PostgreSQL: unique only among alive rows (partial unique index)
CREATE UNIQUE INDEX uq_users_email_alive ON users (email) WHERE deleted_at IS NULL;

-- MySQL (no partial indexes): use a generated column trick
ALTER TABLE users
  ADD COLUMN alive_email VARCHAR(255)
      GENERATED ALWAYS AS (IF(deleted_at IS NULL, email, NULL)) VIRTUAL,   -- NULL when deleted
  ADD UNIQUE KEY uq_alive_email (alive_email);       -- UNIQUE allows many NULLs
```
**c) Index the flag** — most queries add `WHERE deleted_at IS NULL`. Put it in composite/partial indexes (see [Indexes](Data-and-Persistence/advanced-sql/indexes)).

**d) Foreign keys / cascades:** the database won't cascade a soft delete. Decide what happens to children (soft-delete them too in the same transaction).

**e) Privacy law (GDPR "right to be forgotten"):** soft delete keeps personal data. You may need a **real purge** (hard delete or anonymize) after a retention period.
```sql
-- Scheduled cleanup: permanently remove rows soft-deleted > 90 days ago
DELETE FROM users WHERE deleted_at < NOW() - INTERVAL 90 DAY;
```

| Pros | Cons |
|---|---|
| Easy undo/restore | Every query must filter (bugs leak deleted data) |
| Keeps references valid (old orders still point to the user) | Tables grow; indexes get bigger |
| Simple to implement | Unique constraints and cascades need extra care |
| | May violate privacy rules if never purged |

---

## Part 2 — Audit / History Table

#### 3. The idea
Keep the main table small and current. Write every change to a separate **history table**.
```
users (current state)                 users_history (append-only log)
+----+------+--------+                +----+---------+--------+--------+-------------+----------+
| id | name | city   |                | id | user_id | op     | city   | changed_at  | changed_by|
+----+------+--------+                +----+---------+--------+--------+-------------+----------+
| 1  | Asha | Sylhet |                | 1  | 1       | INSERT | Dhaka  | 2025-03-01  | admin     |
+----+------+--------+                | 2  | 1       | UPDATE | Sylhet | 2026-06-10  | asha      |
                                       +----+---------+--------+--------+-------------+----------+
```
**Trigger-based (works in any database, see [Triggers](Data-and-Persistence/advanced-sql/triggers)):**
```sql
CREATE TABLE users_history (
    history_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id    INT NOT NULL,
    op         VARCHAR(10) NOT NULL,         -- INSERT / UPDATE / DELETE
    name       VARCHAR(100),
    city       VARCHAR(100),
    changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    changed_by VARCHAR(100)                  -- DB user; for the real app user, set a session variable
);

DELIMITER //
CREATE TRIGGER trg_users_after_update
AFTER UPDATE ON users FOR EACH ROW
BEGIN
    -- Save the OLD values (what the row looked like before this change)
    INSERT INTO users_history (user_id, op, name, city, changed_by)
    VALUES (OLD.id, 'UPDATE', OLD.name, OLD.city, CURRENT_USER());
END //

CREATE TRIGGER trg_users_after_delete
AFTER DELETE ON users FOR EACH ROW
BEGIN
    INSERT INTO users_history (user_id, op, name, city, changed_by)
    VALUES (OLD.id, 'DELETE', OLD.name, OLD.city, CURRENT_USER());
END //
DELIMITER ;
```
Query "what did user 1 look like over time?":
```sql
SELECT * FROM users_history WHERE user_id = 1 ORDER BY changed_at;
```
**Alternatives to triggers:** application-level audit (ORM listeners: Hibernate Envers, Laravel Auditing), or [CDC](Data-and-Persistence/advanced-sql/change-data-capture) from the log.

> Tip: for "who" at app level (not the shared DB account), pass the user id via a session variable (`SET @app_user = 42;`) — but beware of pooled connections leaking state (see [Connection Pooling](Data-and-Persistence/advanced-sql/connection-pooling)).

---

## Part 3 — Temporal Tables (time travel)

#### 4. System-versioned (transaction-time) tables
The database automatically stores **each version of a row with a validity period**: `valid_from` and `valid_to`. You never write the history yourself.

```
products (current)                       products_history (maintained by DB)
+----+------+-------+                    +----+------+-------+------------+------------+
| id | name | price |                    | id | name | price | valid_from | valid_to   |
+----+------+-------+                    +----+------+-------+------------+------------+
| 1  | Pen  | 15    |                    | 1  | Pen  | 10    | 2025-01-01 | 2025-09-01 |
+----+------+-------+                    | 1  | Pen  | 12    | 2025-09-01 | 2026-04-01 |
 (valid_from = 2026-04-01, valid_to = ∞)  +----+------+-------+------------+------------+
```
Timeline of one row:
```
2025-01-01          2025-09-01          2026-04-01              ∞
    │── price 10 ───────│─── price 12 ───────│──── price 15 ────────►
```
**Query "as of" a point in time:**
```sql
-- SQL Server / MariaDB 10.3+ / SQL:2011 syntax
SELECT * FROM products FOR SYSTEM_TIME AS OF '2025-10-15' WHERE id = 1;   -- price = 12
```
**Create one:**
```sql
-- MariaDB
CREATE TABLE products (
    id    INT PRIMARY KEY,
    name  VARCHAR(50),
    price DECIMAL(10,2)
) WITH SYSTEM VERSIONING;           -- DB keeps all old versions automatically

-- SQL Server
CREATE TABLE products (
    id INT PRIMARY KEY, name VARCHAR(50), price DECIMAL(10,2),
    valid_from DATETIME2 GENERATED ALWAYS AS ROW START,
    valid_to   DATETIME2 GENERATED ALWAYS AS ROW END,
    PERIOD FOR SYSTEM_TIME (valid_from, valid_to)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = dbo.products_history));
```
**Support summary:**
| Database | Built-in system versioning? |
|---|---|
| SQL Server (2016+), MariaDB (10.3+), Oracle (Flashback), DB2 | Yes |
| **PostgreSQL** | No built-in (use the `temporal_tables` extension, triggers, or range types) |
| **MySQL** | No (use triggers / history tables) |

#### 5. Do it yourself with valid-time columns (works everywhere)
The "slowly changing dimension type 2" pattern: **close the old row, insert a new row**.
```sql
CREATE TABLE price_history (
    product_id INT NOT NULL,
    price      DECIMAL(10,2) NOT NULL,
    valid_from DATE NOT NULL,
    valid_to   DATE NOT NULL DEFAULT '9999-12-31',     -- 9999-12-31 means "still current"
    PRIMARY KEY (product_id, valid_from)
);

-- Price change on 2026-04-01 (do both in ONE transaction)
START TRANSACTION;
UPDATE price_history SET valid_to = '2026-04-01'
 WHERE product_id = 1 AND valid_to = '9999-12-31';                   -- close the current row
INSERT INTO price_history (product_id, price, valid_from) VALUES (1, 15, '2026-04-01');   -- open a new one
COMMIT;

-- What was the price on a given day?  (valid_from inclusive, valid_to exclusive)
SELECT price FROM price_history
WHERE product_id = 1 AND '2025-10-15' >= valid_from AND '2025-10-15' < valid_to;
```
Use **half-open ranges** `[from, to)` so periods touch without overlapping (no day belongs to two rows).

**PostgreSQL range types + exclusion constraint** prevent overlapping periods automatically:
```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TABLE price_history (
    product_id INT,
    price      NUMERIC(10,2),
    period     DATERANGE NOT NULL,
    EXCLUDE USING gist (product_id WITH =, period WITH &&)      -- same product cannot have overlapping periods
);
SELECT price FROM price_history WHERE product_id = 1 AND period @> DATE '2025-10-15';   -- "contains"
```

#### 6. Bitemporal: two kinds of time
| Time | Question | Example |
|---|---|---|
| **Valid time** | When was it true **in the real world**? | Salary 5000 effective 1 Jan |
| **Transaction time** | When did the **database learn** it? | We entered that on 10 Jan (late) |

Needed for corrections: *"On 20 Jan we discovered the 1 Jan raise was wrong. What did we think on 15 Jan vs now?"* Four timestamp columns (`valid_from/to`, `recorded_from/to`). Common in finance, insurance, legal systems. It is complex: use it only when you really need it.

#### 7. Choosing
```
Need "undo delete" only?                         ─► Soft delete
Need to know who changed what?                   ─► Audit table / trigger / CDC
Need exact past state for any date (queries)?    ─► Temporal table (or valid_from/valid_to)
Need corrections of the past AND what-we-knew?   ─► Bitemporal
Business rule: "invoice keeps price at that time"─► Just copy unit_price into order_items (snapshot)
```

### Java — soft delete with an "alive" filter
```java
public void softDeleteUser(Connection c, long id, long actorId) throws SQLException {
    // Mark instead of removing; keep who did it
    String sql = "UPDATE users SET deleted_at = NOW(), deleted_by = ? WHERE id = ? AND deleted_at IS NULL";
    try (PreparedStatement ps = c.prepareStatement(sql)) {
        ps.setLong(1, actorId);
        ps.setLong(2, id);
        int changed = ps.executeUpdate();                 // 0 means: not found or already deleted
        if (changed == 0) throw new IllegalStateException("User not found or already deleted");
    }
}
```

### PHP — "as of" price lookup
```php
// Price of product 1 on a given date, from valid_from/valid_to history
$stmt = $pdo->prepare(
    'SELECT price FROM price_history
      WHERE product_id = ? AND ? >= valid_from AND ? < valid_to'
);
$stmt->execute([1, $date, $date]);          // same date used for both comparisons
$price = $stmt->fetchColumn();              // false if there was no price at that date
```

### Time & Space Complexity
- **Soft delete:** same cost as an update (O(log n) with index). Reads add a filter; **space** grows because rows are never removed (purge old ones). Indexes include dead rows unless partial.
- **History/temporal:** every change writes one extra row, so write cost roughly doubles for that table, and space grows by **O(number of changes)** forever (partition by time and archive old history).
- **"As of" queries:** O(log n) with an index on `(key, valid_from, valid_to)`; scanning all history for a key is O(versions of that key).
- **Time-range reports across all rows:** can be large; index and partition by `valid_from`.

### Alternatives
| Need | Option |
|---|---|
| Full audit with almost no code | CDC / log-based audit (see [Change Data Capture](Data-and-Persistence/advanced-sql/change-data-capture)) |
| History as the source of truth | Event sourcing |
| Archive instead of flag | Move deleted rows to an `archive_users` table (keeps the main table small) |
| Just recent undo | Database backups / PITR (see [Replication, HA & Backup](Data-and-Persistence/advanced-sql/replication-and-high-availability)) |

### Common Mistakes
- Forgetting `WHERE deleted_at IS NULL` in one query and leaking deleted data.
- Unique constraints that block re-creating a soft-deleted value.
- Never purging soft-deleted personal data.
- Closing the old history row and inserting the new one in **separate** transactions (a gap or overlap appears on failure).
- Using inclusive ranges on both ends (a boundary instant belongs to two versions).
- Storing history in the same table with no partitioning, so it grows without bound.

### Quick Interview Answers
- **Soft delete vs hard delete?** Soft delete flags a row as deleted (restorable, keeps references) but needs filters, unique-index care, and eventual purging.
- **How do you audit changes?** Triggers or CDC writing old/new values, user and time to a history table.
- **What is a temporal table?** A table that keeps every row version with validity timestamps, allowing "as of" queries.
- **Valid time vs transaction time?** When it was true in reality vs when the database recorded it.
- **Why store the price in order_items?** Orders must keep the price at purchase time even if the product price changes later.
