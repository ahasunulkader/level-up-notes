# Database Types — SQL, NoSQL, Graph & Beyond

## TL;DR
Every database makes trade-offs. **SQL** databases give you structure, consistency, and powerful queries — use them when your data has clear relationships and you need ACID guarantees. **NoSQL** databases trade some consistency for scale, flexibility, and speed — choose the subtype that matches your data shape (documents, key-value, wide-column, time-series). **Graph** databases are purpose-built for highly connected data where relationships are first-class. There is no universally "best" database — the right choice depends on your data model, access patterns, and scale requirements.

---

## The Big Picture

```
                        DATABASES
                            │
         ┌──────────────────┼──────────────────┐
         │                  │                  │
      Relational          NoSQL              Specialized
      (SQL)                 │                  │
         │          ┌───────┼───────┐     ┌────┴────┐
    MySQL            Document  Key-Value  Graph  Time-Series
    PostgreSQL        MongoDB   Redis     Neo4j  InfluxDB
    SQLite            DynamoDB  DynamoDB  AWS    TimescaleDB
    SQL Server        Firestore Memcached Neptune
    Oracle            CouchDB
                      Wide-Column
                      Cassandra
                      HBase
                      BigTable
```

---

## 1. Relational Databases (SQL)

### What They Are
Data is stored in **tables** (rows and columns) with a fixed schema. Tables relate to each other through **foreign keys**. You query data using **SQL** (Structured Query Language). All operations follow **ACID** guarantees.

**ACID:**
| Property | Meaning |
|---|---|
| **Atomicity** | A transaction either fully succeeds or fully fails — no partial writes |
| **Consistency** | Data always moves from one valid state to another |
| **Isolation** | Concurrent transactions don't interfere with each other |
| **Durability** | Committed data survives crashes |

```sql
-- Classic relational structure
CREATE TABLE users (
    id         INT PRIMARY KEY AUTO_INCREMENT,
    name       VARCHAR(100) NOT NULL,
    email      VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE orders (
    id         INT PRIMARY KEY AUTO_INCREMENT,
    user_id    INT NOT NULL,
    total      DECIMAL(10,2),
    status     ENUM('pending','paid','shipped'),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Join across tables
SELECT u.name, COUNT(o.id) AS order_count, SUM(o.total) AS total_spent
FROM users u
LEFT JOIN orders o ON u.id = o.user_id
GROUP BY u.id
HAVING total_spent > 500;
```

---

### MySQL

**Type:** Open-source relational DB
**Owned by:** Oracle (originally Sun)

**Strengths:**
- Extremely battle-tested — powers most of the web (WordPress, Wikipedia, Twitter historically)
- Fast read performance, especially with read replicas
- Massive ecosystem, tooling, and community
- Simple to set up and operate

**Weaknesses:**
- Less feature-rich than PostgreSQL (limited JSON support, no native arrays, fewer index types)
- Full-text search is basic compared to dedicated solutions
- MyISAM engine (legacy) doesn't support transactions — always use InnoDB

**Best for:**
- Web applications (LAMP/LEMP stack)
- Read-heavy workloads
- Simple data models where you don't need advanced SQL features

**Example use case:** An e-commerce site stores products, users, orders, and payments. Joins are simple, data is structured, and you need ACID for payment processing.

```sql
-- MySQL-specific: full-text search
ALTER TABLE products ADD FULLTEXT(name, description);
SELECT * FROM products
WHERE MATCH(name, description) AGAINST('wireless headphones' IN BOOLEAN MODE);
```

---

### PostgreSQL

**Type:** Open-source relational DB
**Known as:** "The world's most advanced open source database"

**Strengths:**
- Rich feature set: native JSON/JSONB, arrays, custom types, full-text search, window functions
- Excellent standards compliance (most SQL-standard compliant open-source DB)
- Advanced indexing: B-tree, Hash, GIN, GiST, BRIN, partial indexes
- Extensible: PostGIS for geospatial, TimescaleDB extension for time-series
- Strong MVCC (Multi-Version Concurrency Control) — readers never block writers

**Weaknesses:**
- Slightly more complex to tune and operate than MySQL
- Write performance under extreme load requires careful configuration
- Replication is simpler in MySQL for some setups

**Best for:**
- Complex queries and analytics
- Applications that need both relational and semi-structured (JSON) data
- Geospatial applications (PostGIS)
- Financial systems requiring full ACID with complex constraints

**Example use case:** A ride-hailing app stores driver locations (PostGIS), trip data (relational), and flexible metadata (JSONB) — all in one database.

```sql
-- PostgreSQL-specific features
-- JSONB column with index
CREATE TABLE events (
    id      SERIAL PRIMARY KEY,
    payload JSONB,
    created TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_events_payload ON events USING GIN(payload);

-- Query inside JSONB
SELECT * FROM events WHERE payload->>'type' = 'ride_completed';

-- Window function
SELECT driver_id,
       trip_count,
       RANK() OVER (ORDER BY trip_count DESC) AS rank
FROM driver_stats;

-- Array type
SELECT * FROM users WHERE 'admin' = ANY(roles);
```

---

### SQLite

**Type:** Embedded relational DB (serverless)

**Strengths:**
- Zero configuration — the entire DB is a single file
- No separate server process
- ACID compliant
- Excellent for development, testing, mobile apps

**Weaknesses:**
- Not designed for concurrent writes (file-level locking)
- No network access — must be on the same machine
- Limited to a few writers at a time

**Best for:** Mobile apps (iOS/Android), embedded systems, desktop apps, test environments, small single-user tools.

**Example use case:** A mobile app stores user preferences and offline cache in a local SQLite file. No server needed.

---

### SQL Server (Microsoft)

**Type:** Commercial relational DB

**Strengths:**
- Deep integration with .NET and Azure ecosystem
- Excellent tooling (SSMS, Azure Data Studio)
- T-SQL has rich procedural features
- Strong enterprise support and BI tools (SSRS, SSIS)

**Weaknesses:**
- Licensing costs are significant
- Primarily Windows-focused (Linux support is newer)
- Vendor lock-in

**Best for:** Enterprise .NET applications, Microsoft stack shops, BI/reporting pipelines.

---

### When to Use SQL (Summary)

| Signal | Use SQL |
|---|---|
| Data has clear relationships | ✓ |
| You need ACID transactions | ✓ |
| Complex queries with joins | ✓ |
| Schema is stable and well-defined | ✓ |
| You need strong consistency | ✓ |
| Financial, medical, legal data | ✓ |

---

## 2. Document Databases

### What They Are
Data is stored as **documents** (JSON, BSON, XML). Each document is self-contained and can have a **flexible schema** — different documents in the same collection can have different fields. No joins — related data is typically embedded.

```json
// A single document — no joins needed to read a full order
{
  "_id": "order_abc123",
  "userId": "user_456",
  "status": "paid",
  "items": [
    { "productId": "prod_1", "name": "Laptop", "qty": 1, "price": 999.00 },
    { "productId": "prod_2", "name": "Mouse",  "qty": 2, "price":  29.99 }
  ],
  "shippingAddress": {
    "street": "123 Main St",
    "city": "Singapore",
    "zip": "123456"
  },
  "total": 1058.98,
  "createdAt": "2026-03-06T10:00:00Z"
}
```

---

### MongoDB

**Type:** Open-source document database

**Strengths:**
- Flexible schema — add fields without migrations
- Rich query language (filters, projections, aggregation pipeline)
- Horizontal scaling via sharding built-in
- Good for hierarchical/nested data
- Atlas (managed cloud) is excellent

**Weaknesses:**
- No multi-document ACID transactions until v4.0 (now supported but slower)
- No joins — you have to denormalize or do multiple queries
- Can lead to inconsistent data if you're not careful (flexible schema = no enforcement)
- Memory hungry

**Trade-offs:**
| | MongoDB | PostgreSQL |
|---|---|---|
| Schema flexibility | High (schemaless) | Lower (strict schema) |
| Joins | Not supported natively | Full SQL joins |
| Transactions | Supported (slower) | Fully ACID |
| Horizontal scale | Built-in sharding | Harder |
| Query power | Good (aggregation) | Excellent (SQL) |

**Best for:** Content management systems, product catalogs, user profiles, event logs, mobile app backends.

**Example use case:** An e-commerce product catalog where each product has different attributes — a shirt has size/color, a laptop has RAM/storage. A flexible document model avoids 50 nullable columns.

```javascript
// MongoDB query
db.products.aggregate([
  { $match: { category: 'electronics', price: { $lt: 1000 } } },
  { $group: { _id: '$brand', avgPrice: { $avg: '$price' }, count: { $sum: 1 } } },
  { $sort: { avgPrice: -1 } }
]);
```

---

### DynamoDB (Document + Key-Value)

**Type:** AWS managed NoSQL (document and key-value)
**Managed by:** Amazon Web Services

**Strengths:**
- Truly serverless — scales to any size automatically
- Single-digit millisecond latency at any scale
- No operational overhead (fully managed)
- Pay-per-request pricing model
- Built-in TTL, streams, global tables (multi-region)

**Weaknesses:**
- Very limited query patterns — you MUST design around access patterns upfront
- No ad-hoc queries — expensive scans on large tables
- Learning curve: partition key, sort key, GSIs, LSIs
- Vendor lock-in (AWS only)
- Limited transaction support (up to 25 items)

**Best for:** Serverless applications, session stores, gaming leaderboards, IoT data, high-scale applications with predictable access patterns.

**Example use case:** A gaming app stores player sessions and scores. Access pattern is always "get player by ID" — DynamoDB's single-digit ms latency at scale is perfect.

```python
# DynamoDB access — always by key
table.get_item(Key={'userId': 'user_123', 'gameId': 'game_456'})

# GSI (Global Secondary Index) for alternate access pattern
table.query(
    IndexName='email-index',
    KeyConditionExpression=Key('email').eq('user@example.com')
)
```

---

### Firebase Firestore

**Type:** Google managed document database

**Strengths:**
- Real-time listeners (data pushes to clients on change)
- Offline support built-in (mobile/web SDKs)
- Tight integration with Google ecosystem
- Simple security rules

**Weaknesses:**
- Limited query capabilities (no OR queries, no full-text search)
- Pricing can get expensive at scale
- Vendor lock-in (Google)

**Best for:** Mobile apps, real-time collaborative apps, prototypes, chat applications.

---

## 3. Key-Value Stores

### What They Are
The simplest database model: a **dictionary** (hashmap) at massive scale. Every value is stored and retrieved by a unique key. No schema, no relationships, no complex queries — just `set(key, value)` and `get(key)`.

```
"session:user_123"  →  { "userId": 123, "role": "admin", "expires": 1234567890 }
"cache:product:456" →  { "name": "Laptop", "price": 999 }
"rate:ip:1.2.3.4"   →  42
```

---

### Redis

**Type:** In-memory key-value store (also supports persistence)

**Strengths:**
- Blazing fast — data lives in RAM, sub-millisecond operations
- Rich data structures: strings, hashes, lists, sets, sorted sets, streams, bitmaps
- Pub/Sub messaging built-in
- Atomic operations (INCR, GETSET)
- TTL on keys (perfect for caching and sessions)
- Lua scripting for complex atomic operations
- Redis Cluster for horizontal scaling

**Weaknesses:**
- Data must fit in RAM (expensive at scale)
- Not a primary database — used alongside SQL/NoSQL
- Persistence (AOF/RDB) adds complexity if you need durability

**Best for:** Caching, session storage, rate limiting, leaderboards (sorted sets), pub/sub messaging, distributed locks, queues.

```python
# Session storage
redis.setex(f"session:{token}", 3600, json.dumps(user_data))

# Rate limiting (atomic)
count = redis.incr(f"rate:{ip}:{minute}")
redis.expire(f"rate:{ip}:{minute}", 60)
if count > 100:
    raise RateLimitExceeded()

# Leaderboard (sorted set)
redis.zadd("leaderboard", {"player1": 5000, "player2": 7500})
redis.zrevrange("leaderboard", 0, 9, withscores=True)  # top 10

# Pub/Sub
redis.publish("order-events", json.dumps({"type": "order_placed", "id": 123}))
```

---

### Memcached

**Type:** Distributed in-memory cache (simpler than Redis)

**Strengths:**
- Extremely simple — pure string key-value
- Multi-threaded (better CPU utilization than Redis for pure cache workloads)
- Easy to scale horizontally

**Weaknesses:**
- No persistence — data lost on restart
- No complex data structures (only strings)
- No pub/sub, no sorted sets, no atomic operations beyond basic get/set

**Best for:** Simple, pure caching use case where you don't need Redis's richer feature set.

---

## 4. Wide-Column Databases

### What They Are
Data is stored in **rows with dynamic columns**. Think of it as a 2D key-value store: `(row key, column key) → value`. Unlike SQL, different rows can have completely different columns. Optimized for **write-heavy** workloads at massive scale.

```
Row Key: "user_123"
  ┌──────────────┬──────────────┬──────────────┐
  │ name         │ email        │ phone        │
  │ "Alice"      │ "a@ex.com"  │ "+65..."     │
  └──────────────┴──────────────┴──────────────┘

Row Key: "user_456"
  ┌──────────────┬──────────────┬─────────────────────────┐
  │ name         │ address      │ premium_since           │
  │ "Bob"        │ "Singapore"  │ "2024-01-01"            │
  └──────────────┴──────────────┴─────────────────────────┘
```

---

### Apache Cassandra

**Type:** Open-source wide-column store (originally from Facebook)

**Strengths:**
- Linear horizontal scalability — add nodes, capacity scales linearly
- No single point of failure — masterless architecture (every node is equal)
- Extremely high write throughput
- Tunable consistency (choose between AP or CP per query)
- Multi-datacenter replication built-in

**Weaknesses:**
- Query design is rigid — must design tables around specific access patterns
- No joins, no ad-hoc queries, limited aggregations
- Eventual consistency by default — not suitable for financial data
- Operational complexity (tuning compaction, consistency levels)

**Best for:** Time-series data, IoT sensor data, activity feeds, messaging systems, anything needing high write throughput at global scale.

**Example use case:** Netflix uses Cassandra to store viewing history for 200M+ users — billions of writes per day, needs to be always available.

```sql
-- Cassandra CQL (looks like SQL but isn't)
-- Table design driven by query pattern, not normalization
CREATE TABLE user_activity (
    user_id   UUID,
    timestamp TIMESTAMP,
    action    TEXT,
    metadata  MAP<TEXT, TEXT>,
    PRIMARY KEY (user_id, timestamp)
) WITH CLUSTERING ORDER BY (timestamp DESC);

-- Query MUST use partition key
SELECT * FROM user_activity
WHERE user_id = ? AND timestamp > '2026-01-01'
LIMIT 100;
```

---

### Google Bigtable / HBase

**Type:** Wide-column stores (Bigtable is Google's managed, HBase is open-source Hadoop)

**Strengths:**
- Petabyte-scale storage
- Consistent low latency at huge scale
- Bigtable powers Google Search, Maps, and Gmail

**Weaknesses:**
- Complex to operate (especially HBase)
- Limited query capabilities
- Overkill for most applications

**Best for:** Petabyte-scale analytics, search indexing, financial time-series at Google/enterprise scale.

---

## 5. Graph Databases

### What They Are
Data is modeled as **nodes** (entities) and **edges** (relationships). Relationships are **first-class citizens** stored explicitly — not computed via joins. Traversing deep relationships is fast and natural.

```
(Alice)-[:FRIENDS_WITH]->(Bob)
(Alice)-[:WORKS_AT]->(Grab)
(Bob)-[:LIVES_IN]->(Singapore)
(Grab)-[:LOCATED_IN]->(Singapore)

-- "Find all friends of Alice who live in the same city as her employer"
-- This is a 4-hop traversal — trivial in graph, painful in SQL
```

---

### Neo4j

**Type:** Open-source graph database
**Query Language:** Cypher

**Strengths:**
- Incredibly fast for relationship traversal (O(1) per hop regardless of data size)
- Cypher query language is intuitive and readable
- ACID compliant
- Excellent visualization tools
- Native graph storage (not SQL emulating a graph)

**Weaknesses:**
- Not designed for simple tabular data
- Doesn't scale horizontally as well as NoSQL options
- Community edition has limitations; Enterprise is expensive
- Writes are slower than key-value or column stores

**Best for:** Social networks, recommendation engines, fraud detection, knowledge graphs, network/IT topology, identity and access management.

**Example use case:** Fraud detection — detect rings of fraudulent accounts by finding circular payment patterns: `(A)-[:PAID]->(B)-[:PAID]->(C)-[:PAID]->(A)`.

```cypher
-- Create nodes and relationships
CREATE (alice:Person {name: 'Alice', city: 'Singapore'})
CREATE (bob:Person   {name: 'Bob',   city: 'Singapore'})
CREATE (alice)-[:FRIENDS_WITH {since: '2024-01-01'}]->(bob)

-- Find friends of friends (2 hops)
MATCH (me:Person {name: 'Alice'})-[:FRIENDS_WITH*2]-(fof)
WHERE NOT (me)-[:FRIENDS_WITH]-(fof)
RETURN fof.name

-- Fraud detection: circular payment pattern
MATCH path = (a:Account)-[:PAID*3..5]->(a)
WHERE ALL(r IN relationships(path) WHERE r.amount > 1000)
RETURN path

-- Recommendation: "People you may know" (common friends)
MATCH (me:Person {name: 'Alice'})-[:FRIENDS_WITH]->(friend)-[:FRIENDS_WITH]->(suggested)
WHERE NOT (me)-[:FRIENDS_WITH]->(suggested) AND suggested <> me
RETURN suggested.name, COUNT(friend) AS mutual_friends
ORDER BY mutual_friends DESC
```

---

### Amazon Neptune

**Type:** AWS managed graph database
**Supports:** Property Graph (Gremlin) + RDF (SPARQL)

**Strengths:**
- Fully managed (no operational overhead)
- Supports both graph query languages
- Integrates with AWS ecosystem

**Weaknesses:**
- Vendor lock-in
- Less feature-rich than Neo4j for pure graph use cases

**Best for:** AWS-native applications needing graph capabilities without operational overhead.

---

## 6. Time-Series Databases

### What They Are
Optimized for data that is **indexed by time** — sequences of measurements or events. They have specialized compression and query functions for time-based patterns.

```
timestamp           | metric          | value | tags
2026-03-06 10:00:00 | cpu_usage       | 72.3  | host=web-01
2026-03-06 10:00:01 | cpu_usage       | 74.1  | host=web-01
2026-03-06 10:00:00 | requests_per_sec| 1240  | region=sg
```

---

### InfluxDB

**Type:** Open-source time-series database

**Strengths:**
- Purpose-built for time-series: automatic data downsampling, retention policies
- InfluxQL / Flux query languages optimized for time ranges
- High write throughput
- Built-in dashboarding (Chronograf)

**Weaknesses:**
- Not a general-purpose database
- Complex for non-time-series data
- Clustering requires commercial license

**Best for:** Infrastructure monitoring, IoT sensor data, application performance metrics, financial tick data.

```sql
-- InfluxDB query
SELECT mean("cpu") FROM "metrics"
WHERE time > now() - 1h
GROUP BY time(5m), "host"
```

---

### TimescaleDB

**Type:** PostgreSQL extension for time-series

**Strengths:**
- Built on PostgreSQL — full SQL support
- Automatic partitioning by time (hypertables)
- Great if you already use PostgreSQL
- Compression for old data

**Best for:** Teams already on PostgreSQL who need time-series capabilities without a new database.

---

## 7. Search Engines

### Elasticsearch

**Type:** Distributed search and analytics engine (built on Apache Lucene)

**Strengths:**
- Full-text search with relevance scoring
- Complex query DSL (bool, fuzzy, range, geo)
- Aggregations for analytics
- Near real-time indexing
- Horizontally scalable

**Weaknesses:**
- Not a primary database — doesn't have strong ACID guarantees
- Operationally complex
- Data duplication (usually used alongside a primary DB)
- Expensive at scale

**Best for:** Full-text search, log aggregation (ELK stack), e-commerce product search, autocomplete.

**Example use case:** An e-commerce site stores product data in PostgreSQL (source of truth) and syncs to Elasticsearch for full-text search, faceted filtering, and relevance ranking.

---

## 8. The CAP Theorem

Every distributed database must choose 2 of 3:

```
           Consistency
               /\
              /  \
             /    \
            /      \
           / CA     \
          /  (RDBMS) \
         /────────────\
        /  CP  |  AP   \
       /       |        \
Partition ─────────────── Availability
Tolerance   (choose 2)
```

| Type | Guarantee | Examples |
|---|---|---|
| **CA** (Consistency + Availability) | Strong consistency, fails if network partitions | Traditional RDBMS (single node) |
| **CP** (Consistency + Partition Tolerance) | Consistent but may be unavailable during partition | MongoDB, HBase, Redis (with persistence) |
| **AP** (Availability + Partition Tolerance) | Always available but may return stale data | Cassandra, DynamoDB, CouchDB |

---

## 9. Choosing the Right Database

### Decision Framework

```
Is your data relational with clear schema?
├── YES → SQL (PostgreSQL or MySQL)
└── NO → What's your data shape?
    ├── Documents/JSON → MongoDB or DynamoDB
    ├── Simple key lookups → Redis or DynamoDB
    ├── Time-series → InfluxDB or TimescaleDB
    ├── Highly connected → Neo4j
    ├── Massive write throughput → Cassandra
    └── Full-text search → Elasticsearch
```

### Quick Reference

| Database | Type | Best For | Not Good For |
|---|---|---|---|
| PostgreSQL | Relational | Complex queries, ACID, JSON | Horizontal write scale |
| MySQL | Relational | Web apps, read-heavy | Complex SQL features |
| MongoDB | Document | Flexible schema, nested data | Multi-document transactions |
| DynamoDB | Key-Value/Doc | Serverless, predictable patterns | Ad-hoc queries |
| Redis | Key-Value | Cache, sessions, pub/sub | Durable primary storage |
| Cassandra | Wide-Column | High write throughput, IoT | Complex queries, ACID |
| Neo4j | Graph | Relationships, fraud detection | Simple tabular data |
| InfluxDB | Time-Series | Metrics, monitoring, IoT | General-purpose storage |
| Elasticsearch | Search | Full-text search, log analytics | Primary data store |

### Real-World Polyglot Architecture (e.g., Grab-like app)

```
User Service       → PostgreSQL (ACID, user data, payments)
Session Store      → Redis      (fast auth token lookup)
Product Catalog    → MongoDB    (flexible nested attributes)
Location Updates   → Cassandra  (high write throughput, IoT-like)
Driver Leaderboard → Redis      (sorted sets, real-time ranking)
App Metrics        → InfluxDB   (time-series monitoring)
Full-text Search   → Elasticsearch (restaurant/product search)
Fraud Detection    → Neo4j      (relationship traversal)
```

Most large-scale applications use **multiple databases** — each chosen for its strengths.

---

## Interview Q&A

**Q: When would you choose NoSQL over SQL?**
A: When your data model is flexible or evolving (document DB), when you need extreme horizontal write scale (Cassandra), when you need sub-millisecond key-value lookups (Redis/DynamoDB), or when your data is inherently a graph (Neo4j). SQL wins when you need complex queries, strong consistency, and relationships between entities.

**Q: What is the CAP theorem?**
A: In a distributed system, you can only guarantee two of three: Consistency (every read returns the latest write), Availability (every request gets a response), and Partition Tolerance (system continues despite network splits). Since partitions happen in real networks, you really choose between CP (consistent but may be unavailable) and AP (always available but may return stale data).

**Q: How does DynamoDB differ from MongoDB?**
A: DynamoDB is a fully managed AWS service with automatic scaling and single-digit ms latency — but you must define your access patterns upfront; ad-hoc queries are expensive. MongoDB is more flexible with a richer query language and aggregation pipeline, but you manage scaling yourself (unless using Atlas). DynamoDB is better for serverless/AWS-native apps; MongoDB is better when query flexibility matters.

**Q: Why would you use Redis alongside a SQL database?**
A: Redis sits in front of your SQL database as a cache. Reads hit Redis first (sub-ms); only cache misses hit PostgreSQL (ms to tens of ms). Redis also handles sessions, rate limiting, and pub/sub — things SQL databases aren't designed for. They complement each other: SQL is the source of truth, Redis is the speed layer.

**Q: When would you use a graph database?**
A: When relationships between entities are as important as the entities themselves, and when you need to traverse multiple hops of relationships efficiently. Fraud detection (circular payment rings), social networks (friends of friends), recommendation engines, and knowledge graphs are classic use cases. SQL can model graphs but JOIN performance degrades badly at 3+ hops.
