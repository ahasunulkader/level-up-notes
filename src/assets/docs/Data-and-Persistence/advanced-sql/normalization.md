# Normalization & Denormalization

### The Problem
- When all data is thrown into one big table, the **same fact gets stored again and again**. This causes bugs that have names: **anomalies**.

**One messy table (everything together):**
```
orders_big
+----------+----------+------------+----------------+---------+--------------+-------+
| order_id | customer | cust_email | cust_city      | product | product_price| qty   |
+----------+----------+------------+----------------+---------+--------------+-------+
| 1        | Asha     | a@x.com    | Dhaka          | Pen     | 10           | 5     |
| 2        | Asha     | a@x.com    | Dhaka          | Book    | 50           | 1     |
| 3        | Asha     | a@x.com    | Dhaka          | Pen     | 10           | 2     |
| 4        | Ben      | b@x.com    | Chattogram     | Pen     | 10           | 1     |
+----------+----------+------------+----------------+---------+--------------+-------+
Asha's email and city are copied 3 times. The price of Pen is copied 3 times.
```

**The three anomalies (what goes wrong):**

| Anomaly | What happens | Example in the table above |
|---|---|---|
| **Update anomaly** | You change one copy and forget the others, so data disagrees | Asha moves to Sylhet. You update row 1 only. Now Asha lives in Dhaka *and* Sylhet |
| **Insert anomaly** | You can't store a fact without storing something unrelated | You can't add a new product "Ruler" until someone orders it (no `order_id`) |
| **Delete anomaly** | Deleting one thing erases another fact | Delete order 4 and you also lose that Ben exists and his email |

Also: **wasted space** and **slow updates** (many rows to change for one fact).

### What It Solves
- **Normalization** = organize tables so that **each fact is stored exactly once**, in the right place. Tables are split and connected using keys.
- Simple rule to remember: **"Every non-key column must depend on the key, the whole key, and nothing but the key — so help me Codd."**
- Result: no duplicates, no anomalies, smaller storage, safer updates.
- **Denormalization** is the opposite on purpose: add controlled duplication to make *reads* faster when the normalized design is too slow.

### How It Works

#### Vocabulary first (easy words)
| Term | Meaning | Example |
|---|---|---|
| **Primary key (PK)** | Column(s) that identify a row uniquely | `order_id` |
| **Candidate key** | Any column set that *could* be the PK | `email` could also identify a customer |
| **Composite key** | A key made of 2+ columns | `(order_id, product_id)` |
| **Functional dependency (FD)** | "If I know A, I can find exactly one B", written `A → B` | `customer_id → email` |
| **Partial dependency** | A column depends on **part** of a composite key only | `product_id → price` in key `(order_id, product_id)` |
| **Transitive dependency** | A → B and B → C, so A → C goes "through" B | `order_id → customer_id → city` |

**Functional dependency picture:**
```
customer_id  ───────►  email          "knowing the customer id tells me exactly one email"
customer_id  ───────►  city
product_id   ───────►  price
(order_id, product_id) ──►  qty       "to know qty I need BOTH parts of the key"
```

---

#### Step 0 — The unnormalized table
Imagine one order can have several products stored in one cell:
```
+----------+----------+-----------------+
| order_id | customer | products        |
+----------+----------+-----------------+
| 1        | Asha     | Pen, Book, Ruler|   <- many values in ONE cell: not allowed in 1NF
+----------+----------+-----------------+
```

---

#### Step 1 — First Normal Form (1NF): one value per cell
**Rules:**
1. Every cell holds **one single (atomic) value** — no lists, no comma-separated text.
2. No repeating column groups (`product1`, `product2`, `product3`).
3. Every row is unique (there is a primary key).

**Before → After**
```
BEFORE (breaks 1NF)                         AFTER (1NF): one row per product in an order
+----------+----------+----------------+    +----------+----------+---------+
| order_id | customer | products       |    | order_id | customer | product |
+----------+----------+----------------+    +----------+----------+---------+
| 1        | Asha     | Pen, Book      | -> | 1        | Asha     | Pen     |
+----------+----------+----------------+    | 1        | Asha     | Book    |
                                             +----------+----------+---------+
                                             PK = (order_id, product)
```
```sql
-- 1NF table. The key has two columns: an order can contain many products.
CREATE TABLE order_items_1nf (
    order_id      INT,
    product       VARCHAR(50),
    customer      VARCHAR(50),
    cust_email    VARCHAR(100),
    cust_city     VARCHAR(50),
    product_price INT,
    qty           INT,
    PRIMARY KEY (order_id, product)
);
```
Still has duplicates (customer info repeats per product). Next step.

---

#### Step 2 — Second Normal Form (2NF): no partial dependency
**Applies when:** the primary key has **more than one column**.
**Rule:** be in 1NF **and** every non-key column depends on the **whole** key, not just a piece.

**Find the problem:** key is `(order_id, product)`.
```
(order_id, product) ──► qty            OK  (needs both)
 order_id           ──► customer, email, city      PARTIAL: depends only on order_id
 product            ──► product_price              PARTIAL: depends only on product
```

**Fix: move each partially-dependent group into its own table.**
```
                 order_items_1nf
        +------------------------------+
        | order_id | product | ... all |
        +------------------------------+
              /            |          \
             v             v           v
   orders                order_items             products
+----------+---------+  +----------+-----------+-----+  +-----------+-------+
| order_id | customer|  | order_id | product   | qty |  | product   | price |
| (PK)     | email   |  | (PK, FK) | (PK, FK)  |     |  | (PK)      |       |
|          | city    |  +----------+-----------+-----+  +-----------+-------+
+----------+---------+
```
```sql
CREATE TABLE products (
    product VARCHAR(50) PRIMARY KEY,
    price   INT                       -- price now stored ONCE per product
);

CREATE TABLE orders (
    order_id   INT PRIMARY KEY,
    customer   VARCHAR(50),
    cust_email VARCHAR(100),
    cust_city  VARCHAR(50)            -- still has a transitive problem; fixed in 3NF
);

CREATE TABLE order_items (
    order_id INT,
    product  VARCHAR(50),
    qty      INT,                     -- depends on the WHOLE key (order_id + product)
    PRIMARY KEY (order_id, product),
    FOREIGN KEY (order_id) REFERENCES orders(order_id),
    FOREIGN KEY (product)  REFERENCES products(product)
);
```
Now changing a product's price means updating **one row**, not many.

---

#### Step 3 — Third Normal Form (3NF): no transitive dependency
**Rule:** be in 2NF **and** non-key columns depend **only on the key**, not on other non-key columns.

**Find the problem in `orders`:**
```
order_id ──► customer ──► cust_email, cust_city
   key         non-key        non-key
   (cust_email depends on customer, NOT directly on order_id = transitive)
```
If Asha makes 10 orders, her email and city are copied 10 times.

**Fix: give customers their own table.**
```
customers                                orders
+-------------+-------+---------+------+  +----------+-------------+
| customer_id | name  | email   | city |  | order_id | customer_id |
| (PK)        |       |         |      |  | (PK)     | (FK)        |
+-------------+-------+---------+------+  +----------+-------------+
       ▲                                         |
       └─────────────────────────────────────────┘
```
```sql
CREATE TABLE customers (
    customer_id INT PRIMARY KEY,
    name        VARCHAR(50),
    email       VARCHAR(100) UNIQUE,
    city        VARCHAR(50)          -- stored once per customer
);

CREATE TABLE orders (
    order_id    INT PRIMARY KEY,
    customer_id INT NOT NULL,
    FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
);
```

**Final 3NF design (the whole picture):**
```
customers 1 ───── * orders 1 ───── * order_items * ───── 1 products
(customer_id)      (order_id)        (order_id+product_id)   (product_id)
```
Each fact lives in one place:
| Fact | Stored in |
|---|---|
| Customer email / city | `customers` |
| Who placed the order | `orders` |
| How many of what was ordered | `order_items` |
| Product price | `products` |

> Most real systems stop at 3NF. It is the practical target.

---

#### Step 4 — Boyce-Codd Normal Form (BCNF): every determinant is a key
**Rule (stricter 3NF):** whenever `A → B` holds, `A` must be a **candidate key** (able to identify the row).

**Example where 3NF is OK but BCNF is not.** A school: each student has one teacher per subject; each teacher teaches **only one subject**.
```
enrollments
+---------+---------+---------+
| student | subject | teacher |
+---------+---------+---------+
| Ria     | Math    | Mr. Lee |
| Sam     | Math    | Mr. Lee |
| Ria     | Art     | Ms. Wu  |
+---------+---------+---------+
Key: (student, subject).
Dependency: teacher ──► subject      (teacher is NOT a key, yet it decides subject)  => breaks BCNF
```
**Fix: split so the determinant becomes a key.**
```
teacher_subject                 student_teacher
+---------+---------+           +---------+---------+
| teacher | subject |           | student | teacher |
| (PK)    |         |           | (PK)    | (PK)    |
+---------+---------+           +---------+---------+
```
(Rare in practice. Know it for interviews.)

---

#### Step 5 — Higher forms (just know what they mean)
| Form | Removes this problem | Plain example |
|---|---|---|
| **4NF** | Multi-valued dependencies: two independent lists stored in one table | An employee has many skills **and** many languages. Storing both in one table creates every combination (3 skills × 3 languages = 9 rows). Keep two tables instead |
| **5NF** | Join dependencies: a table that can only be rebuilt by joining 3+ smaller tables | Very rare |
| **6NF** | Every column in its own table (used for temporal data) | Data warehouses, special cases |

---

#### Summary cheat sheet
```
Raw data
   │  1NF: atomic values, no repeating groups, has a key
   ▼
   │  2NF: remove PARTIAL dependencies  (matters for composite keys)
   ▼
   │  3NF: remove TRANSITIVE dependencies  (non-key → non-key)
   ▼
   │  BCNF: every determinant is a candidate key
   ▼
   │  4NF / 5NF: multi-valued & join dependencies (rare)
```

| Form | One-line test |
|---|---|
| 1NF | "Is every cell a single value?" |
| 2NF | "Does each column need the **whole** key?" |
| 3NF | "Does each column depend on **only** the key?" |
| BCNF | "Is every column that decides another column a key?" |

---

#### Denormalization — breaking the rules on purpose
**Why:** normalized data needs **JOINs**. With millions of rows, many joins can make reads slow. Denormalizing trades **write complexity + extra space** for **faster reads**.

**Example: order list page needs the customer's name.**
```
Normalized (3 joins to show a list):       Denormalized (0 joins):
orders -> customers                         orders(order_id, customer_id, customer_name_copy, total)
       -> order_items -> products
```

| Technique | How | Example |
|---|---|---|
| **Copy a column** | Store `customer_name` in `orders` | List page needs no join |
| **Store a calculated value** | Keep `order_total` in `orders` instead of summing items | Faster dashboards |
| **Counter cache** | `comments_count` in `posts` | No `COUNT(*)` on each page view |
| **Summary table** | Daily sales table updated by a job | Reports run in milliseconds |
| **Materialized view** | Database-stored query result, refreshed on demand | See [Views](Data-and-Persistence/advanced-sql/views) |
| **JSON column** | Store a snapshot of related data | See [Handling JSON](Data-and-Persistence/advanced-sql/handling-json) |

```sql
-- Counter cache example: keep comments_count in sync with a trigger
ALTER TABLE posts ADD COLUMN comments_count INT NOT NULL DEFAULT 0;

CREATE TRIGGER trg_comment_add AFTER INSERT ON comments
FOR EACH ROW
    UPDATE posts SET comments_count = comments_count + 1 WHERE id = NEW.post_id;

CREATE TRIGGER trg_comment_del AFTER DELETE ON comments
FOR EACH ROW
    UPDATE posts SET comments_count = comments_count - 1 WHERE id = OLD.post_id;
```

**Cost of denormalizing:** copies can go out of sync, so *you* now must keep them in sync (triggers, application code, or jobs).

**Another important snapshot case:** an invoice should keep the **price at purchase time**. If the product price changes later, old invoices must not change. Copying `unit_price` into `order_items` is the *correct* design, not a mistake.

---

#### Normalization vs Denormalization at a glance
| | Normalized | Denormalized |
|---|---|---|
| Duplicate data | Little or none | Intentional |
| Writes (INSERT/UPDATE) | Fast, one place | Slower, many places |
| Reads | May need many JOINs | Fast, fewer JOINs |
| Storage | Smaller | Larger |
| Consistency risk | Low | Higher |
| Good for | **OLTP** (apps, banking, orders) | **OLAP** / reports / read-heavy / caches |

**Rule of thumb:** *Design normalized first. Denormalize only when you measured a real slow query.*

### Java — reading normalized data with a JOIN
```java
// Normalized: data is spread over tables, a JOIN puts it back together for display
String sql = """
    SELECT o.order_id, c.name, p.product, oi.qty, p.price
    FROM orders o
    JOIN customers   c  ON c.customer_id = o.customer_id
    JOIN order_items oi ON oi.order_id   = o.order_id
    JOIN products    p  ON p.product     = oi.product
    WHERE o.order_id = ?
    """;
try (PreparedStatement ps = conn.prepareStatement(sql)) {
    ps.setInt(1, 1);   // bind the order id safely
    try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
            System.out.println(rs.getString("name") + " bought " + rs.getInt("qty") + " x " + rs.getString("product"));
        }
    }
}
```

### PHP — same query with PDO
```php
$sql = "SELECT o.order_id, c.name, p.product, oi.qty, p.price
        FROM orders o
        JOIN customers   c  ON c.customer_id = o.customer_id
        JOIN order_items oi ON oi.order_id   = o.order_id
        JOIN products    p  ON p.product     = oi.product
        WHERE o.order_id = ?";
$stmt = $pdo->prepare($sql);
$stmt->execute([1]);                       // bind the order id safely
foreach ($stmt as $row) {
    echo "{$row['name']} bought {$row['qty']} x {$row['product']}\n";
}
```

### Time & Space Complexity
- **Space:** normalization **reduces** storage because each fact is stored once. Denormalization **increases** it (copies).
- **Write time:** normalized: updating a fact touches **1 row**, O(1). Denormalized: updating a fact touches every copy, which is O(number of copies).
- **Read time:** normalized reads need JOINs. With indexes on join keys, each join is roughly O(log n) per lookup, so a query joining `k` tables costs about **O(k · log n)** per row returned. Denormalized reads avoid the joins and cost about O(log n) for a single lookup.
- The trade-off: **normalized = cheap writes, costlier reads; denormalized = costly writes, cheap reads.**

### Alternatives
| Need | Option |
|---|---|
| Fast reads without breaking design | Caching (Redis), materialized views, read replicas |
| Flexible/changing structure | Document database (MongoDB) — natural denormalization |
| Analytics | Star schema in a data warehouse (see below) |
| Reports on huge data | Pre-aggregated summary tables |

**Star schema (analytics-friendly denormalization):**
```
                 dim_date
                    |
 dim_customer ── fact_sales ── dim_product
                    |
                dim_store
fact_sales = numbers (amount, qty)   dim_* = descriptive columns (name, category, city)
```
One big **fact** table in the middle, small **dimension** tables around it. Few joins, easy for BI tools.

### Common Mistakes
- Normalizing too far (10+ joins for a simple page) without measuring.
- Denormalizing before there is a performance problem.
- Storing comma-separated IDs in one column (`tags = '1,5,9'`) instead of a join table.
- Forgetting foreign keys and unique constraints (see [Constraints](Data-and-Persistence/advanced-sql/constraints)).
- Using a mutable value (like email or name) as the primary key.
- Many-to-many relation without a **junction table**:
```sql
-- Students <-> Courses (many-to-many) needs a table in the middle
CREATE TABLE enrollments (
    student_id INT,
    course_id  INT,
    PRIMARY KEY (student_id, course_id),
    FOREIGN KEY (student_id) REFERENCES students(id),
    FOREIGN KEY (course_id)  REFERENCES courses(id)
);
```

### Quick Interview Answers
- **What is normalization?** Organizing tables so each fact is stored once, to avoid update/insert/delete anomalies.
- **1NF / 2NF / 3NF?** Atomic values / no partial dependency on part of a composite key / no transitive dependency between non-key columns.
- **3NF vs BCNF?** BCNF is stricter: every determinant must be a candidate key.
- **When to denormalize?** After measuring slow read-heavy queries, accepting extra storage and the burden of keeping copies in sync.
- **Why keep `unit_price` in `order_items`?** It is a historical snapshot: later price changes must not rewrite old orders.
