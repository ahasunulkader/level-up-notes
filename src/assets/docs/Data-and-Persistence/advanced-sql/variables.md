# Variables

### The Problem
- Some computations (like a running total) are awkward to express in pure `SELECT` logic without a place to store an intermediate value as you go row by row.
- Stored routines (procedures/functions) also need their own local, throwaway values that shouldn't leak outside the routine.

### What It Solves
- SQL gives you two flavors of variable: **session/user-defined variables** (`@var`) that live for the current connection until it closes, and **local variables** inside a stored routine (`DECLARE`) scoped only to that routine's `BEGIN...END` block.

### How It Works
```sql
-- Session variable
SET @min_price = 100;
SELECT * FROM products WHERE price > @min_price;

-- Handy trick: compute a running total without a window function
SET @running_total = 0;
SELECT id, amount, (@running_total := @running_total + amount) AS running_total
FROM transactions ORDER BY id;

-- Local variable inside a procedure
DELIMITER $$
CREATE PROCEDURE count_high_value_orders(IN threshold DECIMAL(10,2))
BEGIN
    DECLARE order_count INT DEFAULT 0;
    SELECT COUNT(*) INTO order_count FROM orders WHERE total > threshold;
    SELECT order_count AS result;
END$$
DELIMITER ;
```

- **Connection-pooling trap (important at large scale):** session variables live on the physical connection, not on the logical request. In a pooled environment (HikariCP in Java, persistent PDO connections in PHP), a connection is reused across unrelated requests — a leftover `@var` from a previous request can silently leak into the next one. Either avoid session variables in pooled code, or explicitly reset them (`SET @var = NULL`) before returning the connection to the pool. This is a real production bug pattern, not a theoretical one.

### Time & Space Complexity
- Reading or setting a session/local variable is **O(1) time and O(1) space** — it's a single stored value on the connection or routine, not a data structure that grows with table size.
- **The running-total trick** (`@running_total := @running_total + amount`) computes a running sum in a single pass over the rows — **O(n) time, O(1) extra space** — because it only ever needs to remember one number, not the whole result set so far.
- **Compare to a window function** doing the same running total (`SUM(amount) OVER (ORDER BY id)`): typically **O(n log n)**, because the database usually has to sort the rows by the window's `ORDER BY` first (`O(n log n)`) before computing the running values (`O(n)`). The variable trick can be faster in practice by skipping that sort — but it only works if rows already arrive in the order you want, and it leans on MySQL-specific evaluation-order behavior that isn't guaranteed by the SQL standard, so it's a portability trade-off as much as a performance one.

### Java / PHP
```java
st.execute("SET @min_price = 100");
ResultSet rs = st.executeQuery("SELECT * FROM products WHERE price > @min_price");
```
```php
$pdo->exec("SET @min_price = 100");
$stmt = $pdo->query("SELECT * FROM products WHERE price > @min_price");
```

### Real-World Example: Audit Trail via Session Variable + Trigger (Java/Spring)
A common use of session variables — a trigger auto-stamps "who updated this row" without passing `updated_by` through every query.

```sql
CREATE TABLE bookings (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    status VARCHAR(20) NOT NULL,
    updated_by BIGINT NULL,
    updated_at TIMESTAMP NULL
);

DELIMITER $$
CREATE TRIGGER trg_bookings_updated_by
BEFORE UPDATE ON bookings
FOR EACH ROW
BEGIN
    SET NEW.updated_by = @current_user_id;
    SET NEW.updated_at = NOW();
END$$
DELIMITER ;
```

```java
@Entity
@Table(name = "bookings")
public class Booking {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    private String status;

    @Column(name = "updated_by", insertable = false, updatable = false)
    private Long updatedBy;   // populated by the trigger, not Hibernate

    @Column(name = "updated_at", insertable = false, updatable = false)
    private LocalDateTime updatedAt;
}

@Service
public class BookingService {
    @PersistenceContext private EntityManager entityManager;
    @Autowired private BookingRepository bookingRepository;

    @Transactional
    public void confirmBooking(Long bookingId, Long currentUserId) {
        entityManager.createNativeQuery("SET @current_user_id = :userId")
                .setParameter("userId", currentUserId)
                .executeUpdate();

        Booking booking = bookingRepository.findById(bookingId).orElseThrow();
        booking.setStatus("CONFIRMED");
        bookingRepository.save(booking);   // fires the UPDATE, trigger stamps updated_by
    }
}
```

- **Why it works:** `@Transactional` pins one physical connection to the whole method, so the `SET @current_user_id = ...` and the later `UPDATE` both run on the *same* connection — required, since the variable lives on the connection, not globally. Flow: request arrives → transaction opens on connection C → `SET` runs on C → `save()` issues `UPDATE` on C → trigger fires and reads `@current_user_id` off C → commit → connection C returns to the pool.
- **Gotcha:** if the `SET` and the `UPDATE` ever land on different connections (e.g. a `REQUIRES_NEW` transaction, an async call, or the pool handing out a different connection), the trigger silently sees `@current_user_id = NULL` — no error, just a wrong/missing audit value. `@Transactional` is exactly what prevents that here.

---

*Part of [Advanced SQL & Database Programmability](Data-and-Persistence/advanced-sql-programmability).*
