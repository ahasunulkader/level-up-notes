# Data & Persistence Concepts

Understanding data persistence is critical for building reliable applications. These concepts are language-agnostic but tested heavily in backend interviews — especially the N+1 problem, ACID properties, and isolation levels.

---

## 1. Relational vs NoSQL — When and Why

### Relational Databases (MySQL, PostgreSQL)

Data is stored in **tables with rows and columns**. Tables relate to each other through foreign keys. The schema is defined upfront and enforced strictly.

```sql
-- Users table
CREATE TABLE users (
    id    INT PRIMARY KEY AUTO_INCREMENT,
    name  VARCHAR(100),
    email VARCHAR(255) UNIQUE
);

-- Orders table — related to users
CREATE TABLE orders (
    id         INT PRIMARY KEY AUTO_INCREMENT,
    user_id    INT,
    total      DECIMAL(10,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);
```

**Benefits:**
- **ACID guarantees** — data is always consistent
- **Powerful querying** — JOINs, aggregations, complex filters
- **Relationships** — enforced referential integrity
- **Mature tooling** — decades of optimization, monitoring

**Disadvantages:**
- **Schema rigidity** — adding/changing columns requires migrations
- **Horizontal scaling is hard** — sharding relational data is complex
- **Performance at extreme scale** — JOINs on billions of rows get slow

### NoSQL Databases

**Document (MongoDB):** stores JSON-like documents. No fixed schema.

```json
{
  "_id": "abc123",
  "name": "Alice",
  "email": "alice@example.com",
  "orders": [
    { "id": 1, "total": 99.99, "items": ["Laptop"] }
  ]
}
```

**Key-Value (Redis):** extremely fast, simple key → value store.
**Column-family (Cassandra):** optimized for write-heavy workloads.
**Graph (Neo4j):** optimized for relationship traversal.

**Benefits:**
- **Flexible schema** — add new fields without migrations
- **Horizontal scaling** — easy to shard by partition key
- **High write throughput** — Cassandra handles millions of writes/sec
- **Natural data shapes** — nested documents vs normalizing into 5 tables

**Disadvantages:**
- **Weaker consistency** — many NoSQL are eventually consistent
- **No standard query language** — each system has its own API
- **No JOINs** — denormalization required (data duplication)
- **Less mature tooling** for complex business queries

### When to Use Which

| Use Relational (MySQL/PostgreSQL) When | Use NoSQL When |
|----------------------------------------|----------------|
| Data has clear relationships | Data has variable/unknown structure |
| You need transactions across tables | You need massive horizontal scale |
| Complex reporting and analytics | Key-value lookups dominate |
| Financial data (ACID critical) | Log/event/time-series data |
| Team knows SQL well | You need sub-millisecond response |

> **Interview tip:** "It depends" is the right start. Discuss the specific trade-offs for the scenario at hand. A banking system needs ACID. A social media feed cache needs speed. A product catalog could use either.

### MySQL vs PostgreSQL — Which One and Why

"Relational" isn't a single decision — in practice the real question is almost always MySQL vs PostgreSQL, since both are free, open-source, and battle-tested at scale.

| Factor | MySQL | PostgreSQL |
|---|---|---|
| Query features | Solid, but fewer advanced features | Window functions, CTEs (incl. recursive), full JSON/JSONB, arrays, custom types |
| Indexing | B-Tree, Hash, full-text | B-Tree, Hash, **GIN, GiST, BRIN** — better for JSON, full-text, geospatial |
| Standards compliance | Looser interpretation of SQL standard | Closest to full SQL-standard compliance of any open-source DB |
| Concurrency model | Row-level locking (InnoDB) | MVCC — readers never block writers, generally better under mixed read/write load |
| Write throughput (simple writes) | Slightly faster for simple, high-volume inserts | Slightly more overhead per write due to MVCC bookkeeping |
| Replication / ops simplicity | Simpler to set up, huge ecosystem (WordPress, Laravel default) | Slightly more to learn, but very stable (streaming replication, logical replication) |
| Extensibility | Limited | Extensions: PostGIS (geo), TimescaleDB (time-series), pg_trgm (fuzzy search) |

**Choose MySQL when:**
- The workload is read-heavy, the schema is simple, and you want the path of least resistance (LAMP/LEMP stacks, most PHP frameworks default to it)
- Your team already knows it well and the app doesn't need advanced SQL features
- You want the largest hosting/tooling ecosystem for a "boring, proven" choice

**Choose PostgreSQL when:**
- You need complex queries, analytics, window functions, or recursive CTEs
- You want structured *and* semi-structured data in one place (JSONB alongside real columns)
- You need advanced indexing (partial indexes, GIN for JSON/array/full-text, geospatial via PostGIS)
- Mixed read/write concurrency matters — MVCC means long-running reports don't block writers

**Other SQL options, briefly:**
- **SQLite** — not a client/server DB at all; the whole database is one file with no server process. Right call for mobile apps, embedded systems, and local dev/test — wrong call for anything with concurrent writers.
- **SQL Server** — the right choice when you're already deep in the .NET/Azure ecosystem and want first-class tooling (SSMS) and BI integration; licensing cost and Windows-centric history are the trade-off.
- **MariaDB** — a MySQL fork with a nearly identical decision calculus to MySQL, plus a few extra storage engines; mostly relevant if you specifically need a fully community-governed (non-Oracle-owned) alternative.

> **Best 3 SQL databases to know cold** (each solves a genuinely different problem, not just "better/worse" than each other):
> 1. **PostgreSQL** — the strongest general-purpose default for new projects: most features, best standards compliance, handles both relational and JSON workloads well.
> 2. **MySQL** — the safe, proven choice for simple, read-heavy, high-traffic web apps; unmatched ecosystem and hosting support.
> 3. **SQLite** — the correct choice whenever there's no server to run at all: mobile apps, embedded devices, CLI tools, and test suites.

### Choosing Among NoSQL Types

"NoSQL" is not one technology — it's four different data models that happen to share the "not strictly relational" label. The real decision is two steps: **first pick the category that matches your access pattern, then pick a product within it.**

| Your access pattern | Category | Pick |
|---|---|---|
| Nested/variable JSON documents, queried many ways | Document | MongoDB (self-managed/flexible) or DynamoDB (AWS-native, serverless) |
| Simple key → value, need sub-millisecond reads | Key-Value | Redis (rich data structures) or Memcached (pure cache, simpler) |
| Massive write throughput, must never go down | Wide-Column | Cassandra (self-managed/multi-cloud) or Bigtable (GCP-native) |
| Deep relationship traversal (friends-of-friends, fraud rings) | Graph | Neo4j |
| Time-stamped metrics/events at high ingest rate | Time-Series | TimescaleDB (already on Postgres) or InfluxDB (dedicated) |

**MongoDB vs DynamoDB** (the most common document-store fork in the road):
- MongoDB when you want a rich query language (aggregation pipeline, ad-hoc filters) and you're not locked into AWS
- DynamoDB when you're AWS-native, want zero operational overhead, and can design your access patterns up front — ad-hoc queries are expensive/awkward

**Redis vs Memcached** (the key-value fork in the road):
- Redis when you need more than a cache: pub/sub, sorted sets (leaderboards), atomic counters, TTL-based sessions, persistence
- Memcached when you need *only* a pure, simple, multi-threaded cache and nothing else

**Cassandra vs DynamoDB vs Bigtable** (the "must scale writes globally" fork in the road):
- Cassandra when you're self-managed or multi-cloud and need masterless, always-available writes
- DynamoDB when you're AWS-native and want the operational burden gone entirely
- Bigtable when you're GCP-native (this is literally what powers Google Search/Maps under the hood)

**Choose Neo4j specifically when:**
- The query itself is a traversal ("friends of friends", "shortest path", "circular payment ring") — this is painful in SQL past 2-3 joins and natural in a graph model

> **Best 3 NoSQL databases to know cold** (chosen to cover the three access patterns you'll actually hit in real systems, not a ranking of "better"):
> 1. **Redis** — the universal companion database; almost every backend stack ends up using it for caching, sessions, rate limiting, or pub/sub regardless of what the primary DB is.
> 2. **MongoDB** — the most common general-purpose document store outside of AWS; the default answer when "the schema is too variable for SQL."
> 3. **Cassandra** (or **DynamoDB** if the stack is AWS-native) — the answer when write throughput or global availability is the bottleneck a single relational primary can't solve.

---

## 2. ACID Properties

ACID is a set of properties that guarantee database transactions are processed reliably, even in the presence of errors, crashes, or concurrent access.

### A — Atomicity

**"All or nothing."** A transaction either completes fully or rolls back completely. There is no partial success.

```php
<?php
// Real-life: transfer money between accounts
// Both the deduction AND the credit must happen — or neither should
$pdo->beginTransaction();

try {
    $pdo->prepare('UPDATE accounts SET balance = balance - ? WHERE id = ?')
        ->execute([100.00, $fromAccountId]);

    // If this fails, the deduction above MUST be reversed
    $pdo->prepare('UPDATE accounts SET balance = balance + ? WHERE id = ?')
        ->execute([100.00, $toAccountId]);

    $pdo->commit(); // success — both changes persisted

} catch (\Exception $e) {
    $pdo->rollBack(); // failure — deduction is reversed, as if nothing happened
    throw $e;
}
```

**Problem it solves:** Without atomicity, a system crash between the deduction and credit would result in money disappearing — the sender loses it but the receiver never gets it.

### C — Consistency

**"The database goes from one valid state to another valid state."** Every transaction must leave the database in a state that satisfies all defined rules (constraints, foreign keys, triggers, business rules).

```sql
-- Consistency rule: balance cannot go negative
ALTER TABLE accounts
    ADD CONSTRAINT chk_balance CHECK (balance >= 0);

-- Now this transaction will fail (not leave DB in invalid state)
UPDATE accounts SET balance = balance - 99999 WHERE id = 1;
-- ERROR: Check constraint violation
```

**Problem it solves:** Prevents logically impossible states — an order referencing a user that doesn't exist, a product with negative stock.

### I — Isolation

**"Concurrent transactions don't interfere with each other."** Each transaction executes as if it's the only one running. The degree of isolation is configurable (see Isolation Levels below).

```php
<?php
// Without isolation: two users book the last seat simultaneously
// Both read: seats_available = 1
// Both update: seats_available = seats_available - 1 = 0
// Result: seats_available = 0, but TWO bookings were created — oversold!

// With proper isolation (SERIALIZABLE):
$pdo->beginTransaction();
$pdo->prepare('SELECT seats_available FROM flights WHERE id = ? FOR UPDATE') // row lock
    ->execute([$flightId]);
// Now no other transaction can read this row until we commit
// Only one booking succeeds — the other sees 0 available and fails
```

### D — Durability

**"Once committed, data survives crashes."** After a successful `COMMIT`, the data is permanently saved — even if the server crashes a millisecond later. Databases achieve this through write-ahead logs (WAL).

```php
<?php
$pdo->commit(); // After this line:
// - Data is written to disk
// - Write-ahead log records the change
// - Even if server crashes NOW, data will survive and be recoverable
```

**Problem it solves:** Prevents committed transactions from being silently lost due to power failures, OS crashes, or hardware failures.

### ACID Summary

| Property | Guarantees | Problem Solved |
|----------|-----------|----------------|
| Atomicity | All or nothing | No partial updates |
| Consistency | Valid state to valid state | No rule violations |
| Isolation | Concurrent transactions don't interfere | No dirty reads, race conditions |
| Durability | Committed data survives crashes | No silent data loss |

---

## 3. Transactions

A **transaction** is a sequence of operations treated as a single unit of work. Transactions implement ACID guarantees.

```php
<?php
// Laravel (Eloquent)
use Illuminate\Support\Facades\DB;

// Method 1: Closure (auto-commits or rolls back)
DB::transaction(function () use ($order) {
    $order->update(['status' => 'paid']);
    $order->payment()->create(['amount' => $order->total]);
    $order->user->notify(new PaymentConfirmed($order));
    // If any line throws, DB rolls back automatically
});

// Method 2: Manual control
DB::beginTransaction();
try {
    $order->update(['status' => 'paid']);
    $payment = Payment::create(['order_id' => $order->id, 'amount' => $order->total]);
    DB::commit();
} catch (\Exception $e) {
    DB::rollBack();
    throw $e;
}

// Nested transactions (savepoints in MySQL/PostgreSQL)
DB::transaction(function () {
    // Outer transaction
    User::create(['name' => 'Alice']);

    DB::transaction(function () {
        // Inner "transaction" — creates a savepoint
        // If this throws, only inner work rolls back; outer continues
        Order::create(['user_id' => 1]);
    });
});
```

**When to use transactions:**
- Financial operations (transfers, payments)
- Multi-table inserts that must stay in sync
- Inventory updates (check availability + decrement atomically)
- Any operation where partial failure is unacceptable

**When NOT to use:**
- Read-only queries (unnecessary overhead)
- Operations that span HTTP requests (too long — hold locks)
- Sending emails/notifications inside a transaction (emails can't be rolled back!)

```php
<?php
// ANTI-PATTERN: Sending email inside transaction
DB::transaction(function () use ($order) {
    $order->update(['status' => 'paid']);
    Mail::to($order->user)->send(new OrderConfirmed($order)); // BAD!
    // If the transaction rolls back, the email is already sent!
});

// CORRECT: Send email after transaction commits
DB::transaction(function () use ($order) {
    $order->update(['status' => 'paid']);
});
// Safe to send now — DB commit succeeded
Mail::to($order->user)->send(new OrderConfirmed($order));
```

---

## 4. Isolation Levels

Isolation levels define **how much one transaction can "see" of other in-progress transactions**. Higher isolation = fewer anomalies but more locking/contention.

### The Four Anomalies

| Anomaly | Description |
|---------|-------------|
| **Dirty Read** | Read uncommitted data from another transaction that later rolls back |
| **Non-Repeatable Read** | Same query in one transaction returns different rows because another transaction committed an UPDATE between reads |
| **Phantom Read** | Same query returns different rows because another transaction committed an INSERT/DELETE |
| **Lost Update** | Two transactions read the same value, both modify it, one overwrites the other's change |

### The Four Isolation Levels

| Level | Dirty Read | Non-Repeatable Read | Phantom Read |
|-------|-----------|---------------------|-------------|
| READ UNCOMMITTED | Possible | Possible | Possible |
| READ COMMITTED | Prevented | Possible | Possible |
| REPEATABLE READ | Prevented | Prevented | Possible (InnoDB prevents with gap locks) |
| SERIALIZABLE | Prevented | Prevented | Prevented |

```php
<?php
// Set isolation level in PDO
$pdo->exec('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
$pdo->beginTransaction();
// ...

// In MySQL/Laravel, the default is REPEATABLE READ
// For most web apps READ COMMITTED is sufficient and faster
```

### Real-life Examples

```php
<?php
// DIRTY READ scenario (READ UNCOMMITTED)
// Transaction A starts, increments stock from 10 to 9 (not committed yet)
// Transaction B reads stock = 9
// Transaction A rolls back — stock is back to 10
// Transaction B is now working with wrong data (9)

// NON-REPEATABLE READ (READ COMMITTED)
// Transaction A: SELECT balance → 1000
// Transaction B: UPDATE balance = 800; COMMIT
// Transaction A: SELECT balance → 800 (different result — same query, same tx!)

// PHANTOM READ (REPEATABLE READ)
// Transaction A: SELECT COUNT(*) FROM orders WHERE user_id = 1 → 5
// Transaction B: INSERT INTO orders (user_id=1) VALUES...; COMMIT
// Transaction A: SELECT COUNT(*) FROM orders WHERE user_id = 1 → 6 (phantom!)

// SERIALIZABLE — safest, most expensive
// Transactions run as if sequential — no anomalies possible
// Use for financial audits, inventory snapshots
```

> **Interview tip:** Most applications use the database default (REPEATABLE READ in MySQL). For most CRUD apps, READ COMMITTED is sufficient. Only go to SERIALIZABLE for financial-critical sections where absolute accuracy is required.

---

## 5. Indexing Basics

An **index** is a separate data structure that the database maintains to speed up lookups. Without an index, the DB does a **full table scan** — reading every row. With an index, it can jump directly to matching rows.

### How B-Tree Indexes Work

The most common index type is a **B-Tree** (balanced tree). It keeps keys sorted, allowing:
- **Point lookup:** O(log n) — find a specific value
- **Range scan:** O(log n + k) — find values between X and Y
- **Sort:** free if the index column matches ORDER BY

```sql
-- Without index: full scan of 1 million rows
SELECT * FROM orders WHERE user_id = 42;  -- SLOW (table scan)

-- Create an index
CREATE INDEX idx_orders_user_id ON orders(user_id);

-- Now the same query uses the index — jumps to matching rows directly
SELECT * FROM orders WHERE user_id = 42;  -- FAST

-- Composite index — useful for multi-column WHERE or sorts
CREATE INDEX idx_orders_user_status ON orders(user_id, status);
-- This index is efficient for:
SELECT * FROM orders WHERE user_id = 42 AND status = 'paid';
-- And for:
SELECT * FROM orders WHERE user_id = 42 ORDER BY status;
```

### Types of Indexes

```sql
-- PRIMARY KEY — automatically indexed, unique, not null
ALTER TABLE users ADD PRIMARY KEY (id);

-- UNIQUE — like primary key but allows one null
CREATE UNIQUE INDEX idx_users_email ON users(email);

-- COMPOSITE — multiple columns
CREATE INDEX idx_user_created ON orders(user_id, created_at);

-- FULLTEXT — for searching text content
CREATE FULLTEXT INDEX idx_products_search ON products(name, description);
SELECT * FROM products WHERE MATCH(name, description) AGAINST('wireless headphones');

-- COVERING INDEX — index contains all columns needed by the query
-- No need to look up the actual row
CREATE INDEX idx_covering ON orders(user_id, status, total);
SELECT status, total FROM orders WHERE user_id = 42; -- uses index only (no row lookup)
```

### When Indexes Hurt

```sql
-- Indexes slow down writes (INSERT/UPDATE/DELETE must update all relevant indexes)
-- Bad: indexing every column on a write-heavy table
-- Good: index only the columns used in WHERE, JOIN, ORDER BY

-- Function in WHERE prevents index use
SELECT * FROM users WHERE YEAR(created_at) = 2026; -- BAD: function wraps indexed col
SELECT * FROM users WHERE created_at >= '2026-01-01' AND created_at < '2027-01-01'; -- GOOD

-- Leading wildcard prevents index use
SELECT * FROM users WHERE email LIKE '%@gmail.com'; -- BAD: leading %
SELECT * FROM users WHERE email LIKE 'alice%'; -- GOOD: trailing % only
```

### EXPLAIN — Diagnose Query Performance

```sql
EXPLAIN SELECT * FROM orders WHERE user_id = 42 AND status = 'paid';
-- Look for:
-- type: ALL (bad, full scan) vs ref/range/index (good)
-- rows: how many rows MySQL estimates it will scan
-- Extra: "Using index" is good, "Using filesort" may be a problem
```

---

## 6. N+1 Problem

The N+1 problem is one of the most common performance bugs in ORM-based applications. It occurs when fetching a collection of records and then issuing a **separate query for each record** to load a related resource.

### The Problem

```php
<?php
// PROBLEM: Loading 100 users + their orders
$users = User::all(); // 1 query: SELECT * FROM users — returns 100 users

foreach ($users as $user) {
    echo $user->orders->count(); // 1 query per user: SELECT * FROM orders WHERE user_id = ?
    // 100 users = 100 extra queries
}
// Total: 1 + 100 = 101 queries — the "N+1 problem"
```

### The Fix: Eager Loading

```php
<?php
// SOLUTION: Load all orders in a single additional query
$users = User::with('orders')->get(); // 2 queries total:
// Query 1: SELECT * FROM users
// Query 2: SELECT * FROM orders WHERE user_id IN (1, 2, 3, ..., 100)

foreach ($users as $user) {
    echo $user->orders->count(); // no query — already loaded in memory
}
// Total: 2 queries — regardless of how many users
```

### Nested Eager Loading

```php
<?php
// Load users → orders → products
$users = User::with('orders.products')->get();
// 3 queries: users, orders (IN), products (IN)

// Conditional eager loading
$orders = Order::with(['products' => function ($query) {
    $query->where('active', true)->orderBy('name');
}])->get();

// Lazy eager loading — load after initial query
$users = User::all();
$users->load('orders'); // issues the IN query now
```

### Detecting N+1 in Laravel

```php
<?php
// Using Laravel Debugbar or Telescope to see query counts
// Or use: DB::listen + query count

// In tests: assertQueryCount
use Illuminate\Testing\Assert;

public function test_index_does_not_n_plus_1(): void
{
    User::factory(20)->hasOrders(5)->create();

    $queryCount = 0;
    DB::listen(fn() => $queryCount++);

    $this->get('/users');

    $this->assertLessThanOrEqual(3, $queryCount);
}
```

### Real-life Rule

```php
<?php
// RULE: If you're in a loop and accessing a relationship — check for N+1
// BAD
foreach ($posts as $post) {
    echo $post->author->name;     // N+1
    echo $post->comments->count(); // N+1
    echo $post->tags->pluck('name'); // N+1
}

// GOOD
$posts = Post::with('author', 'comments', 'tags')->get();
foreach ($posts as $post) {
    echo $post->author->name;      // in-memory
    echo $post->comments->count(); // in-memory
    echo $post->tags->pluck('name'); // in-memory
}
```

---

## 7. Pagination Strategies

### Offset Pagination (Traditional)

```php
<?php
// SQL: LIMIT 10 OFFSET 20 (page 3, 10 per page)
$page    = 3;
$perPage = 10;
$offset  = ($page - 1) * $perPage;

$orders = DB::table('orders')
    ->orderBy('created_at', 'desc')
    ->skip($offset)
    ->take($perPage)
    ->get();

// Laravel built-in
$orders = Order::orderBy('created_at', 'desc')->paginate(10);
// Automatically reads ?page= from request
// Returns: total, per_page, current_page, last_page, data[]
```

**Problem with offset pagination at scale:**
```sql
-- On a table with 10 million rows:
SELECT * FROM orders ORDER BY created_at DESC LIMIT 10 OFFSET 9999990;
-- MySQL must scan and discard the first 9,999,990 rows before returning 10
-- This gets EXPONENTIALLY slower as page number increases
```

### Cursor Pagination (Keyset Pagination)

Instead of "skip N rows," remember **where you left off** using the last seen value.

```php
<?php
// First page
$orders = Order::orderBy('id', 'desc')
    ->take(10)
    ->get();

$cursor = $orders->last()->id; // remember the last ID: e.g., 9991

// Next page — WHERE id < cursor (no offset scan!)
$orders = Order::where('id', '<', $cursor)
    ->orderBy('id', 'desc')
    ->take(10)
    ->get();

// Laravel cursor pagination
$orders = Order::orderBy('created_at')->cursorPaginate(10);
// Returns: next_cursor, prev_cursor, data[]
// The cursor encodes the position as a base64 string
```

### Comparison

| | Offset Pagination | Cursor Pagination |
|---|------------------|-----------------|
| Performance at page 1 | Fast | Fast |
| Performance at page 10,000 | Very slow (scans all previous) | Same as page 1 |
| Jump to arbitrary page | Yes (`?page=50`) | No — sequential only |
| Stable during inserts/deletes | No — new inserts shift pages | Yes — cursor is stable |
| Total count / last page | Easy | Expensive or not provided |
| Use for | Admin dashboards, small data | Infinite scroll, feeds, APIs |

---

## 8. Data Consistency Tradeoffs

### Strong Consistency

Every read reflects the most recent write. All nodes see the same data at the same time.

```php
<?php
// In a relational DB with synchronous replication:
// User writes balance = 1000
// Any subsequent read on ANY node returns 1000 immediately

// In MySQL with read-after-write guarantee:
$user->update(['balance' => 1000]);
// Immediately reading from replica returns 1000 (if using synchronous replication)
```

**Cost:** Higher latency, lower availability during network partitions.

### Eventual Consistency

After a write, replicas will **eventually** sync — but there may be a window where different nodes return different values.

```php
<?php
// In Redis with async replication or DynamoDB default mode:
// User writes: cache key 'user:42:balance' = 1000
// Replica A still shows 999 (hasn't caught up yet)
// 50ms later... Replica A shows 1000 (eventually consistent)

// Real-world consequence:
// A user updates their profile photo
// They refresh the page and still see the old photo for a few seconds
// Then it updates — this is acceptable for profile photos, NOT for bank balances
```

### CAP Theorem (Conceptual)

In distributed systems, you can only guarantee **two of three**:
- **Consistency** — all nodes see the same data
- **Availability** — every request gets a response
- **Partition Tolerance** — system works despite network splits

> Since network partitions are unavoidable in distributed systems, the real choice is **CP** (consistent + partition-tolerant, e.g., HBase) vs **AP** (available + partition-tolerant, e.g., Cassandra, DynamoDB).

### Choosing Consistency Level

| Data Type | Required Consistency |
|-----------|---------------------|
| Bank balance, inventory count | Strong |
| User session | Strong |
| Product description, blog post | Eventual (stale by seconds is fine) |
| Social media likes count | Eventual (approximate is acceptable) |
| Shopping cart | Strong (don't lose items) |
| Analytics counters | Eventual (approximate is fine) |

---

## Interview Q&A

**Q: What is the N+1 problem and how do you fix it?**
A: N+1 occurs when fetching N records and then issuing 1 extra query per record to load a relationship — resulting in 1+N total queries. Fix with eager loading: `User::with('orders')->get()` loads all orders in a single IN query, regardless of how many users. Always check for N+1 when accessing relationships inside loops.

**Q: What does ACID stand for and why does it matter?**
A: Atomicity (all-or-nothing), Consistency (valid state transitions), Isolation (concurrent transactions don't interfere), Durability (committed data survives crashes). It matters because without ACID, financial operations could partially complete, data could be left in invalid states, and concurrent users could corrupt each other's data.

**Q: What is the difference between READ COMMITTED and REPEATABLE READ?**
A: With READ COMMITTED, a transaction can see other transactions' committed changes mid-flight — reading the same row twice may return different values (non-repeatable read). With REPEATABLE READ, all reads within a transaction see a consistent snapshot taken at the start — the same row always returns the same value within one transaction. MySQL InnoDB's default is REPEATABLE READ.

**Q: When would you use cursor pagination over offset pagination?**
A: Cursor pagination for APIs, infinite scroll, or large datasets where users navigate sequentially — it's O(1) regardless of which "page" you're on. Offset pagination for admin dashboards or small datasets where users jump to arbitrary pages and you need a total count. Offset becomes very slow at high page numbers because the DB must skip all previous rows.

**Q: What is eventual consistency?**
A: A consistency model where replicas will sync "eventually" but may temporarily return stale data. Acceptable for non-critical data (social media counts, cached content) but dangerous for financial or inventory data. The trade-off is higher availability and performance at the cost of brief data staleness.

**Q: When should you NOT use a database index?**
A: On columns that are rarely queried, on tables that are write-heavy (indexes slow down INSERT/UPDATE/DELETE), when the index would have very low cardinality (e.g., a boolean column — barely reduces the scanned rows), or when wrapping the column in a function in WHERE (which bypasses the index anyway).
