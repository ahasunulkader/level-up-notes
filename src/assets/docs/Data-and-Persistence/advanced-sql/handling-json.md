# Handling JSON

### The Problem
- **Different rows of the same "thing" naturally have different attributes.** A `products` table needs to hold laptops (RAM, CPU, GPU), t-shirts (size, fabric), books (author, ISBN, pages), and refrigerators (capacity, energy rating) — all in one table, but each product type needs completely different fields.
- **Adding a column per attribute creates a wide, sparse table.** Once you add `shirt_size`, `ram`, `isbn`, `cpu`, `capacity`... every row only fills in a handful of them and leaves the rest `NULL`:

  | Product | shirt_size | RAM | Author |
  |---|---|---|---|
  | Laptop | NULL | 16GB | NULL |
  | Book | NULL | NULL | John |
  | Shirt | XL | NULL | NULL |

  This wastes storage, is confusing to read, and every new product type means more columns added forever.
- **Constant schema migrations.** Every new business requirement ("add battery life," "add waterproof rating," "add bluetooth version") means another `ALTER TABLE ... ADD COLUMN`. At scale, schema migrations are risky — they can lock tables, require coordinated app deploys, and slow down replication.
- **Some attributes are genuinely unknown ahead of time.** User preferences are a classic example: User A has `theme` + `language`; User B has those plus `font`; User C has `notifications` and `timezone` instead. There's no fixed, sensible set of columns that covers everyone.
- **Third-party API responses change shape without warning.** If Stripe's webhook payload gains a new field like `fraud_score` next month, your database shouldn't need a migration just to keep storing what Stripe sends.
- **Different event types need different metadata.** A login event needs `IP`/`browser`; a purchase event needs `order_id`/`amount`/`coupon`; a search event needs `keyword`/`language`. Creating columns for the union of all event types makes no sense — most columns would be `NULL` for most rows.

### What It Solves
- Instead of creating dozens of sparse columns, you store the flexible, variable part of a row as **one JSON column** — `attributes`, `preferences`, `payload`, `metadata` — while everything structured and predictable stays as normal typed columns.
- Modern relational databases let you store and query semi-structured JSON **alongside** strict relational columns — you get flexibility exactly where you need it, without giving up joins, constraints, and transactions everywhere else in the schema.
- Advantages: different rows can have completely different fields, no schema migration needed when a new attribute shows up, cleaner/narrower tables, easier integration with APIs whose response shape may change, and a natural place for genuinely optional data.

### The Old Alternatives (Before JSON Columns Existed)
It's worth knowing what people did before native JSON support, because you'll still see these patterns in older codebases:

- **Many nullable columns** (shown above): simple to query, but wastes storage on `NULL`s, is hard to maintain, and needs an endless stream of schema changes as new attributes appear.
- **EAV (Entity-Attribute-Value) model:** instead of columns, store each attribute as its own row —
  ```sql
  -- product_attributes(product_id, attribute_name, value)
  -- product_id | attribute_name | value
  -- 1          | RAM            | 16GB
  -- 1          | CPU            | i7
  -- 2          | Author         | John
  ```
  Flexible, and needs no schema changes — but querying it requires pivoting many rows back into columns, joins become complex, performance suffers, and there's no easy way to validate a value's type per attribute.
- **Separate per-type tables** (`laptop_details`, `book_details`, `shirt_details`, each with its own real columns): keeps each table clean and strongly typed, but the number of tables grows with every new product type, and querying "all products" means unioning or joining across all of them.
- **XML columns:** the pre-JSON standard for semi-structured data (`<Product><RAM>16GB</RAM></Product>`) — functionally similar to a JSON column, but more verbose to write and parse. JSON has now replaced XML as the default choice for this use case in most new systems.

### How It Works

**Basic storage and lookup:**
```sql
-- MySQL
CREATE TABLE events (id INT PRIMARY KEY AUTO_INCREMENT, payload JSON);
INSERT INTO events (payload) VALUES ('{"type": "click", "meta": {"page": "/home"}}');
SELECT JSON_EXTRACT(payload, '$.type') AS type FROM events;
SELECT * FROM events WHERE payload->>'$.meta.page' = '/home';
CREATE INDEX idx_events_type ON events((CAST(payload->>'$.type' AS CHAR(50))));  -- functional index

-- PostgreSQL (JSONB is binary, indexable, generally preferred over JSON)
CREATE TABLE events (id SERIAL PRIMARY KEY, payload JSONB);
SELECT payload->>'type' AS type FROM events;
SELECT * FROM events WHERE payload @> '{"type": "click"}';   -- containment operator
CREATE INDEX idx_events_payload ON events USING GIN(payload); -- GIN index for fast JSONB lookups
```

- **Updating only one field, without replacing the whole document:**
  ```sql
  -- MySQL: change just the "theme" key, leave everything else in the JSON untouched
  UPDATE users
  SET preferences = JSON_SET(preferences, '$.theme', 'light')
  WHERE id = 1;

  -- PostgreSQL: same idea with jsonb_set
  UPDATE users
  SET preferences = jsonb_set(preferences, '{theme}', '"light"')
  WHERE id = 1;
  ```
- **Nested objects and arrays both work naturally inside a JSON column:**
  ```json
  {
    "user": { "name": "Alice", "age": 25 },
    "settings": { "theme": "dark" },
    "skills": ["Java", "Spring", "SQL"]
  }
  ```
- **Each row can have entirely different keys** — row 1 might be `{"ram": "16GB"}`, row 2 might be `{"shirt_size": "XL"}` — both are valid in the same JSON column, which is what makes it "schema-less" within an otherwise strict, schema-ful table.
- **Why not just store it as plain `TEXT`?** A `TEXT`/`VARCHAR` column has no idea it's supposed to hold JSON — the database will happily store `"{ram:16GB"` (invalid JSON, missing quotes) without complaint. A native `JSON`/`JSONB` type validates the structure on write, rejects malformed input, and unlocks JSON-specific functions and indexing that plain text can't offer.

### MySQL `JSON` vs. PostgreSQL `JSON` vs. PostgreSQL `JSONB`

| Type | Storage | Pros | Cons |
|---|---|---|---|
| MySQL `JSON` | Internal binary format | Supports JSON functions; can build functional indexes on extracted values | Still one blob per row — no native full-document index like GIN |
| PostgreSQL `JSON` | Original JSON text, as-is | Faster inserts; preserves whitespace and key order | Slower to query — must re-parse text on every read; can't efficiently index the whole document |
| PostgreSQL `JSONB` (preferred) | Parsed binary format | Faster querying; supports GIN indexes; better for searching/filtering | Slightly slower inserts (must parse and convert on write); drops duplicate keys and original key order |

Most PostgreSQL applications default to `JSONB` unless there's a specific reason to preserve the exact original JSON text byte-for-byte.

### JSON Column ≠ NoSQL Database
This is a common point of confusion — a JSON column is not "a bit of MongoDB inside SQL," it's a narrow escape hatch inside an otherwise fully relational design:

- **JSON column = relational database + one flexible column.** Your `users`, `orders`, `payments`, and `invoices` tables keep their joins, foreign keys, and constraints exactly as before — only one specific column on one table is flexible.
- **NoSQL (e.g. MongoDB) = everything is document-based.** There may not be separate tables at all — a single document might embed the customer, their orders, and those orders' line items all in one nested structure.
- **Why not just switch everything to MongoDB?** If you already have `customers`, `orders`, `payments`, `invoices`, `employees` — tables with real joins, foreign keys, and transactions — and only *one* field genuinely needs to be flexible (e.g. medical notes on a `patients` table, which vary wildly between a blood-pressure reading, an allergy list, or imaging results), migrating the entire system to a document database just for that one field is a large, unnecessary cost. A JSON column solves exactly that narrow problem without disrupting everything else.

| Feature | JSON Column in SQL | NoSQL Document Database |
|---|---|---|
| Main data model | Relational | Document |
| Joins | Excellent | Limited or none |
| Foreign keys | Yes | Usually no |
| ACID transactions | Excellent | Varies by database |
| Flexible fields | Yes (on the JSON column only) | Yes (across the whole document) |
| Best for | Mostly relational data with a few flexible attributes | Applications where most data is naturally document-shaped |
| Typical example | An `orders` table with a `metadata` JSON column | Entire user profiles, orders, and nested objects stored as one document |

### When To Use JSON — And When Not To

**Good fits:**
- User preferences (`{"theme": "dark"}`) — different users, different optional settings.
- Product attributes (`{"color": "red", "size": "XL"}`) — different product types, different fields.
- Event metadata (`{"browser": "Chrome", "ip": "1.2.3.4"}`) — shape varies by event type.
- Third-party API responses — store what the provider sends without redesigning your schema every time their payload shape changes.
- Optional settings that differ per record, with no natural fixed column list.

**Poor fits — keep these as real columns instead:**
- **Core business data** — `name`, `email`, `salary` should never live inside JSON. You'll frequently filter, join, validate, and constrain these fields, and JSON makes all of that harder and slower.
- **Data used in joins** — a `customer_id` buried inside a JSON blob can't have a real foreign key, can't be indexed the same way, and can't be joined efficiently. Use a real `customer_id` column with a `FOREIGN KEY` instead.
- **Frequently filtered data** — if nearly every query filters by `department`, `salary`, or `country`, make them real typed columns, not JSON paths. A JSON path filter without an index costs a full scan (see complexity below); a real column can just use a normal B-Tree index.

**When to actually reach for NoSQL instead of a JSON column:**
- Most of your data is naturally document-shaped rather than relational.
- You rarely need joins across entities.
- Nearly every query reads or filters deep into nested document fields, not just a couple of optional ones.
- Your schema changes frequently across the *entire* application, not just one or two fields.
- You need the horizontal-scaling patterns a document database or key-value store is specifically built for.

### Best Practices
- Keep important, frequently queried fields as normal typed columns — reserve JSON for what's genuinely optional or variable.
- Add a functional index (MySQL) or GIN index (PostgreSQL) for any JSON path you query often — an unindexed JSON path always costs a full scan, no matter the table size.
- Don't store your entire relational model inside one JSON document — that's re-inventing a document database badly, without any of its query/indexing strengths for that shape of data.
- If you find yourself constantly querying, aggregating, or joining on JSON fields, that's the signal to either promote those fields into real columns, or reconsider whether a document database is actually the better fit.
- **Rule of thumb:** think of a JSON column as an escape hatch inside a relational database — there to handle the small amount of flexible data that doesn't fit your schema, not to replace the schema itself.

### Time & Space Complexity
- **Querying JSON without an index:** the database must parse and inspect the JSON blob of **every row** to check if a path matches — **O(n) time**, same as a full table scan, no matter how deep the JSON path is.
- **With a functional index (MySQL) or GIN index (PostgreSQL JSONB):** the indexed path can be looked up in **O(log n)** time, the same improvement a normal B-Tree index gives ([Indexes](Data-and-Persistence/advanced-sql/indexes)) — but only for the path(s) you actually indexed; a different, unindexed path still falls back to `O(n)`.
- **Space:** `JSONB` in PostgreSQL stores a parsed binary representation, typically **larger on disk** than raw JSON text (the plain `JSON` type), but **faster to query** since it never re-parses text on access — a classic time-vs-space trade-off.
- **Why this matters:** a JSON column with no index on the fields you filter by always costs `O(n)` per query, no matter how small the table starts out — this is exactly the point where adding a functional/GIN index (or moving the field to a real typed column) becomes necessary as the table grows.

### Java — serialize with Jackson, store as JSON column
```java
ObjectMapper mapper = new ObjectMapper();
Map<String, Object> payload = Map.of("type", "click", "meta", Map.of("page", "/home"));
String json = mapper.writeValueAsString(payload);

try (PreparedStatement ps = conn.prepareStatement("INSERT INTO events (payload) VALUES (?)")) {
    ps.setString(1, json);
    ps.executeUpdate();
}

// Reading it back
ResultSet rs = st.executeQuery("SELECT payload FROM events WHERE id = 1");
if (rs.next()) {
    Map<String, Object> parsed = mapper.readValue(rs.getString("payload"), Map.class);
}
```

### PHP
```php
$payload = json_encode(['type' => 'click', 'meta' => ['page' => '/home']]);
$stmt = $pdo->prepare("INSERT INTO events (payload) VALUES (?)");
$stmt->execute([$payload]);

$stmt = $pdo->query("SELECT payload FROM events WHERE id = 1");
$parsed = json_decode($stmt->fetchColumn(), true);
```

---

*Part of [Advanced SQL & Database Programmability](Data-and-Persistence/advanced-sql-programmability).*
