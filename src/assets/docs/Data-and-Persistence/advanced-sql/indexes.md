# Indexes

## TL;DR
- An index is a **sorted shortcut** the database keeps on the side. It helps the database find rows **without reading the whole table**.
- Think of the **index at the back of a book**. You do not read every page to find "ACID". You look it up and jump to the page.
- **Reads get much faster.** **Writes get a little slower**, and every index uses **extra disk space**.
- Your job: add indexes for the queries you really run, pick the **right type**, and put columns in the **right order**.
- **When in doubt, use a B-Tree.** It is the default and covers about 95% of cases.

---

## Why we need indexes

Imagine a `users` table with 10 million rows. You run:

```sql
SELECT * FROM users WHERE email = 'ali@example.com';
```

**Without an index**, the database checks **every row** one by one until it finds a match. This is called a **full table scan**. It is like checking every book in a library to find one novel.

**With an index on `email`**, the database jumps straight to the right row in a few steps.

| | No index | With index |
|---|---|---|
| How it works | Read every row | Walk a small sorted tree |
| Rows checked (10M table) | ~10,000,000 | ~4 steps |
| Gets slower as table grows? | Yes, a lot | Barely |

### Why is a scan so slow? (simple version)

- Data lives on **disk**. The database can only work on data in **memory (RAM)**. So each query must **load data from disk into RAM** first.
- Disk is slow. RAM is much faster. So the main cost of a query is **how many times we touch the disk**.

#### What is a page?

The database does **not** read one row at a time. It reads a **page**: a fixed-size block of the file (about **8 KB in PostgreSQL**, **16 KB in MySQL**).

- A page holds **many rows**, not one.
- To read even one row, the database loads **the whole page** that contains it.
- Then it **checks every row inside that page** to see if it matches.

Example: a row is about 100 bytes, and a page is 8 KB.

```
8 KB page ÷ 100 bytes per row  ≈  80 rows per page
```

```
users table on disk (each page holds a few rows; real pages hold ~80)

 Page 1                       Page 2                       Page 3
 ┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────┐
 │ row: 1  sara@x.com      │  │ row: 4  mia@x.com       │  │ row: 7  zed@x.com       │
 │ row: 2  ali@x.com       │  │ row: 5  raj@x.com       │  │ row: 8  ann@x.com       │
 │ row: 3  omar@x.com      │  │ row: 6  lina@x.com      │  │ row: 9  joe@x.com       │
 └─────────────────────────┘  └─────────────────────────┘  └─────────────────────────┘
```

#### Full scan, step by step

Query: `WHERE email = 'joe@x.com'`

```
Read page 1 → check row 1, row 2, row 3 → no match
Read page 2 → check row 4, row 5, row 6 → no match
Read page 3 → check row 7, row 8, row 9 → row 9 matches ✔
```

For a small table that is 3 page reads. Now scale it up:

```
10,000,000 rows × 100 bytes = about 1 GB
1 GB ÷ 8 KB                 = about 125,000 pages

No index → read up to 125,000 pages and check 10,000,000 rows
Index    → read about 3 or 4 pages
```

So the goal of an index is simple: **read fewer pages**.

Even on SSDs, jumping around the disk (random reads) is slower than reading in a straight line (sequential reads). HDDs make the gap bigger.

#### Caching and prefetching (they help, but not enough)

Databases already try to reduce disk work:

- **Caching:** the database keeps recently used pages in RAM (the *buffer pool*).
  ```
  Query 1: WHERE email = 'joe@x.com'  → page 3 is read from DISK (slow), then kept in RAM
  Query 2: WHERE email = 'ann@x.com'  → page 3 is already in RAM (fast, no disk read)
  ```
- **Prefetching:** when the database sees you are reading pages in order, it loads the next pages **before you ask**.
  ```
  You are checking page 4...  the database is already loading pages 5, 6, 7, 8 in the background
  ```

These are real and useful. But they do **not** fix the core problem. A 1 GB table still has to be pulled through RAM page by page, and it pushes other useful pages out of the cache. **Scanning everything is still too slow on big tables.** An index avoids the work.

---

## The cost of indexes (nothing is free)

| Cost | What it means |
|---|---|
| **Disk space** | Every index is an extra copy of some data. It can be nearly as big as the table. |
| **Slower writes** | Every `INSERT`, `UPDATE`, `DELETE` must also update **every index** on that table. |
| **More to manage** | Unused indexes are pure waste. You should check them from time to time. |

**When indexes hurt more than they help:**
- A table with **lots of writes and few reads**. Example: a log table where you insert all day and almost never search.
- A **very small table** (a few hundred rows). A simple scan is already fast.

> In real life the memory cost is often smaller than people fear (databases manage memory well). But still: **do not add indexes you do not need.**

---

## Types of indexes at a glance

| Type | Best for | Example |
|---|---|---|
| **B-Tree** | Almost everything: `=`, `>`, `<`, `BETWEEN`, `ORDER BY` | Find user by email, orders in a date range |
| **LSM Tree** | Huge number of writes | Metrics, logs, IoT data |
| **Hash** | Only exact match `=`, in memory | Redis key lookup |
| **Geospatial** (Geohash, Quadtree, R-Tree) | "Find things near me" | Restaurants within 5 miles |
| **Inverted** | Searching words inside text | Search blog posts for "database" |

Quick way to choose:

```
Need fast lookups?
  ├─ Table very small (< ~10k rows)?  → No index, a scan is fine
  └─ Table is big. What are you searching?
        ├─ Words inside text   → Inverted index (full-text search)
        ├─ Locations (lat/lng) → Geospatial index
        ├─ Exact match, in RAM → Hash index
        └─ Everything else     → B-Tree
              ├─ Filter on several columns together? → Composite index
              └─ Read a few columns very often?      → Covering index
```

---

## 1. B-Tree index (the default)

A B-Tree keeps values **sorted** in a **short, wide tree**. This is the most common index in every database.

### First, the words (plain meaning)

| Word | Plain meaning |
|---|---|
| **Key** | The **value of the column you indexed**. If you index `email`, the keys are the emails: `ali@x.com`, `mia@x.com`... |
| **Pointer** | An address that says where something is. It is like "go to page 2, row 1". |
| **Node** | One box in the tree. Each node is stored in **one disk page** (one 8 KB block of the *index file*). |
| **Root** | The top node. Every search starts here. |
| **Internal node** | A middle node. It holds **keys as signposts** and pointers to child nodes. It holds **no rows**. |
| **Leaf** | A bottom node. It holds **every key in sorted order**, and each key has a **pointer to the real row** in the table. |
| **Balanced** | All leaves are at the **same depth**. So every search takes about the same number of steps. |

> The **table** and the **index** are two separate things. The table has the full rows. The index is a small sorted list of *key → where the row is*.

### How keys, pages, nodes, leaves and rows connect

We will use the same `users` table from before. We create an index on `email`:

```sql
CREATE INDEX idx_users_email ON users (email);
```

**The table (the real rows, in the order they were inserted):**

```
 TABLE PAGE 1                 TABLE PAGE 2                 TABLE PAGE 3
 ┌──────────────────────┐     ┌──────────────────────┐     ┌──────────────────────┐
 │ slot 1: sara  (id 1) │     │ slot 1: mia   (id 4) │     │ slot 1: zed   (id 7) │
 │ slot 2: ali   (id 2) │     │ slot 2: raj   (id 5) │     │ slot 2: ann   (id 8) │
 │ slot 3: omar  (id 3) │     │ slot 3: lina  (id 6) │     │ slot 3: joe   (id 9) │
 └──────────────────────┘     └──────────────────────┘     └──────────────────────┘
```
The rows are in **no useful order** (sara, ali, omar, mia...). That is why scanning is slow.

**The index (a B-Tree on `email`, sorted A → Z):**

```
                          INDEX PAGE (root node)
                       ┌──────────────────────────┐
                       │   keys:   lina  |  raj   │
                       └──────┬─────────┬───────┬─┘
             email < lina     │         │       │    email ≥ raj
                              │  lina ≤ email < raj
              ┌───────────────┘         │       └────────────────┐
              ▼                         ▼                        ▼
   INDEX PAGE (leaf)         INDEX PAGE (leaf)         INDEX PAGE (leaf)
  ┌───────────────────┐     ┌───────────────────┐     ┌───────────────────┐
  │ ali  → (P1, slot2)│ ──► │ lina → (P2, slot3)│ ──► │ raj  → (P2, slot2)│
  │ ann  → (P3, slot2)│     │ mia  → (P2, slot1)│     │ sara → (P1, slot1)│
  │ joe  → (P3, slot3)│     │ omar → (P1, slot3)│     │ zed  → (P3, slot1)│
  └───────────────────┘     └───────────────────┘     └───────────────────┘
        sorted A → Z              sorted A → Z              sorted A → Z
              (the leaves are linked left → right with ──►)
```

How to read it:

- **Keys** here are emails (`ali`, `lina`, `raj`...). They are **sorted** inside every node.
- The **root** keys `lina | raj` are signposts. They say: "smaller than `lina` go left, between `lina` and `raj` go middle, `raj` or bigger go right."
- Each **leaf entry** is `key → (table page, slot)`. For example `mia → (P2, slot1)` means "the row for mia is on table page 2, slot 1".
- Notice the leaf is **sorted by email**, but the table is **not**. The pointer connects the two.
- Each box above is **one page**. Real nodes hold **hundreds** of keys, not three. (A key plus a pointer is about 20 bytes, so 8 KB ÷ 20 ≈ **400 keys per node**.)

### Why it is fast: find `mia`

```sql
SELECT * FROM users WHERE email = 'mia@x.com';
```

```
Step 1  Read the ROOT page        "mia" is ≥ lina and < raj  → go to the middle leaf
Step 2  Read the middle LEAF page "mia → (P2, slot1)" found
Step 3  Read TABLE PAGE 2, slot 1 → the full row for mia   ✔
```

**3 page reads.** Without the index we would read pages 1, 2 (and maybe 3), checking every row.

Now think big. Each node holds about 400 keys, so each step throws away about 399 of every 400 candidates:

| Level | Rows you can reach |
|---|---|
| Root only | ~400 |
| Root + 1 level | ~160,000 |
| Root + 2 levels | ~64,000,000 |
| Root + 3 levels | ~25,600,000,000 |

So even a table with **64 million rows** needs only about **3 to 4 index pages** + **1 table page** to find one row. The top levels are used all the time, so they stay in RAM (cache). In practice, often only 1 disk read is needed.

### Range queries and ORDER BY

Because leaves are **sorted** and **linked**, ranges are easy:

```sql
SELECT * FROM users WHERE email BETWEEN 'joe@x.com' AND 'omar@x.com';
```

```
Go down the tree to "joe" (leaf 1) → then just walk right along the leaves:
joe → lina → mia → omar → stop (next key is bigger)
```

No need to go back to the root. And `ORDER BY email` is free: the leaves are already in order.

### Why B-Tree is the default

1. Values stay **sorted**, so range queries and `ORDER BY` are fast.
2. It **balances itself**, so speed stays steady as data grows.
3. Its shape **matches how disks work** (one node = one page).
4. It handles **equality** (`email = 'x'`) and **ranges** (`age > 25`) equally well.
5. It stays healthy even with random inserts and deletes.

### Where you already use it

```sql
CREATE TABLE users (
    id    SERIAL PRIMARY KEY,      -- PostgreSQL makes a B-Tree for this
    email VARCHAR(255) UNIQUE      -- ...and another B-Tree for this
);
```

```js
// MongoDB also uses a B-Tree (B+ Tree) here
db.users.createIndex({ "email": 1 });
```

> **B+ Tree** is a small variation where all the real data sits in the leaves. Most databases actually use this. For interviews, "B-Tree" is fine.

### Handy facts

- **Leaves are linked** like a chain. For `BETWEEN 42 AND 90`, the database finds `42`, then just walks sideways. No need to go back to the top.
- **`ORDER BY`** is free if an index already has the data in that order.
- **Page split:** if a leaf is full and a new key must go in the middle, the page splits in two. Random keys (like `UUIDv4`) cause many splits. A steady increasing key (`BIGINT` auto-increment, `UUIDv7`) is much gentler.

---

## 2. LSM Tree (for heavy writes)

### The problem with B-Trees

Each write in a B-Tree means: find the right leaf page → load it → change it → write it back. That is a **random disk write**.

At a few thousand writes per second this is fine. At **100,000 writes per second** (think Datadog collecting metrics from thousands of servers), it becomes the bottleneck.

### The LSM idea

**Do not update in place. Collect writes in memory, then save them to disk in big sequential chunks.**

How a write works:

```
 Incoming write
      │
      ├──► WAL (log on disk)      ← safe copy, just append (fast)
      │
      └──► Memtable (in RAM)      ← sorted, very fast
               │  when full
               ▼
          Flush to disk as an SSTable   ← one big sequential write
               │
               ▼
        Compaction (background)         ← merges SSTables, removes old/deleted data
```

| Part | Plain meaning |
|---|---|
| **Memtable** | Sorted in-memory buffer for new writes |
| **WAL** (write-ahead log) | A log file on disk so we do not lose data if the server crashes |
| **SSTable** | An immutable (never changed) sorted file on disk |
| **Compaction** | A background job that merges many SSTables into fewer ones |

### The catch: reads are harder

To read a key, the database may need to check the memtable, then **many SSTables**, newest first. To avoid this, LSM trees use:

- **Bloom filters:** a quick check that says "this key is **definitely not** in this file", so we skip it.
- **Sparse indexes:** know the key range of each file, so we skip files that cannot have the key.
- **Compaction strategies:** *size-tiered* (fewer rewrites, more files to check) or *leveled* (fewer files, more rewrites).

### Also remember

- With an LSM tree, the **table itself** is the tree, sorted by **primary key**. You do not create LSM indexes on any column like a B-Tree.
- Secondary indexes need extra structures (Cassandra and DynamoDB support them through different mechanisms, with different speed).

### B-Tree vs LSM

| | B-Tree | LSM Tree |
|---|---|---|
| Writes | Slower (random) | **Very fast** (sequential) |
| Reads | **Fast and predictable** | Slower (checks many files) |
| Best for | User-facing apps, many reads | Logs, metrics, IoT, audit data |
| Used by | PostgreSQL, MySQL, MongoDB | Cassandra, RocksDB, DynamoDB (widely believed) |

> **Rule:** much more writing than reading → LSM. App where every page load runs queries → B-Tree.

---

## 3. Hash index

A hash index is a **hash map saved on disk**. The database runs a hash function on your value and goes straight to the bucket that holds the row pointer.

```
hash("alice@example.com") → bucket 7  → pointer to row on page 1
hash("bob@example.com")   → bucket 2  → pointer to row on page 2
```

- **Great at:** exact match (`email = '...'`), about `O(1)` speed.
- **Useless for:** ranges (`>`, `<`, `BETWEEN`), `ORDER BY`, `LIKE 'abc%'`. Similar values are scattered on purpose.
- **Collisions:** two values in the same bucket are handled by chaining (overflow pages).

### Where it is used

- **Redis** uses hash tables for everything (all data is in memory).
- MySQL's `MEMORY` engine uses hash indexes by default.
- PostgreSQL supports `USING HASH`, but **rarely uses it** because a B-Tree is nearly as fast for `=` and does much more.

> As Bruce Momjian says: *"Hash indexes solve a problem we rarely have."*

**Interview tip:** know that hash indexes exist, but **do not push them**. Say "B-Tree is nearly as fast for equality and also supports ranges". That sounds practical.

---

## 4. Geospatial indexes (find things near me)

### The problem

Yelp has millions of restaurants, each with `latitude` and `longitude`. User asks: **"restaurants within 5 miles of me"**.

The naive way is two normal indexes:

```sql
CREATE INDEX idx_lat ON restaurants(latitude);
CREATE INDEX idx_lng ON restaurants(longitude);
```

This fails. We need a **2D** answer (a circle), but we have two **1D** indexes.
- Using the latitude index gives a long strip around the whole world.
- Combining both indexes gives a big rectangle, much larger than our circle. We still have to filter by distance.

We need indexes that understand **2D closeness**. Three main options:

### 4.1 Geohash (easiest, learn this first)

**Idea:** turn a 2D location into a **1D string** where nearby places share the **same beginning (prefix)**.

The world is split into 4 squares, each split again into 4, and so on. Each split adds more detail. Real geohash uses base32 letters:

```
"9q8y"   → all of San Francisco
"9q8yy"  → the Mission District
"9q8yyk" → one city block
```

Two restaurants on the same block both start with `9q8yyk`. A restaurant in the next area might start with `9q8yym`.

Because it is just a string, you can use a **normal B-Tree**:

```sql
CREATE INDEX idx_geohash ON restaurants(geohash);

-- Find places in this cell (a prefix range scan)
SELECT * FROM restaurants WHERE geohash LIKE '9q8yyk%';
```

For a radius search, also check the **neighbouring cells** (a few prefix scans).

Redis does exactly this under the hood:

```
GEOADD restaurants -122.4194 37.7749 "Restaurant A"
GEOSEARCH restaurants FROMLONLAT -122.4194 37.7749 BYRADIUS 5 mi
```
(`GEORADIUS` is old. Use `GEOSEARCH`.)

**Limitation:** two places very close in real life can be on **different sides of a cell border**, so their prefixes differ. That is why we also search neighbour cells.

### 4.2 Quadtree

Start with one big square. If a square holds too many points (say more than 4 to 8), **split it into 4 smaller squares**. Repeat.

```
Dense city area  → split many times (small squares)
Empty countryside → stays one big square
```

- **Plus:** adapts to data. Dense areas get more detail.
- **Minus:** needs its own special tree. Not built into most databases, so it is rare in production.
- Still important: the idea of "split space again and again" is the base for R-Trees. Map tiles in Google Maps work in a similar way.

### 4.3 R-Tree (the production standard)

Instead of fixed quarters, an R-Tree uses **flexible rectangles that can overlap**. They fit the real data.

```
Big rectangle: "San Francisco"
   ├─ smaller rectangle: "Mission area"  → restaurants
   └─ smaller rectangle: "Downtown"      → restaurants
```

- Used by **PostGIS** (through GiST in PostgreSQL) and **MySQL spatial indexes**.
- Handles **points and shapes** (delivery zones, roads) in the same index.
- **Trade-off:** overlapping rectangles mean sometimes you search more than one branch.

### Quick compare

| | Geohash | Quadtree | R-Tree |
|---|---|---|---|
| Idea | 2D → string | Split into 4 squares | Overlapping rectangles |
| Needs special structure? | **No** (uses B-Tree) | Yes | Yes |
| Handles shapes? | Mostly points | Struggles | **Yes** |
| Common use | Redis, simple apps | Teaching, map tiles | PostGIS, MySQL |

**Interview answer you can say:**
> "Normal B-Trees treat latitude and longitude as separate. For proximity we need an index that understands 2D. Geohash turns coordinates into a string that keeps closeness, so a normal B-Tree can serve it. Tree-based indexes like R-Trees group nearby objects in overlapping boxes and are more flexible for shapes."

You do not need all three in depth. **Know the problem and explain at least one solution (geohash).**

---

## 5. Inverted index (search inside text)

### The problem

```sql
SELECT * FROM posts WHERE content LIKE '%database%';
```

A B-Tree **cannot help** here. It only helps with prefix matches (`'database%'`). With the word in the middle, the database must read **every character of every post**.

### The idea

An inverted index flips the relationship. Instead of "document → words", it stores **"word → documents"**. Just like the index at the back of a textbook.

```
doc1: "B-trees are fast and reliable"
doc2: "Hash tables are fast but limited"
doc3: "B-trees handle range queries well"
```

becomes:

```
b-trees  → [doc1, doc3]
fast     → [doc1, doc2]
reliable → [doc1]
hash     → [doc2]
tables   → [doc2]
limited  → [doc2]
handle   → [doc3]
range    → [doc3]
queries  → [doc3]
```

Search for `fast` → instantly get `doc1` and `doc2`.

### What real systems add (Elasticsearch, Lucene)

Before storing, text goes through an **analysis pipeline**:
1. **Tokenize:** split into words.
2. **Lowercase:** `Database` → `database`.
3. **Remove stop words:** drop `the`, `and`.
4. **Stemming:** reduce to the root (`databases` → `database`).

So searching "Databases" can match "database", "DATABASE", or "database's".

They also give you: **relevance scoring**, **fuzzy match** (typos), **phrase search**, **term frequency**.

### Trade-offs

- Takes **a lot of storage**.
- When a document changes, you must update **every word entry** it contains.

### In SQL databases

| Database | How |
|---|---|
| PostgreSQL | `GIN` index on `to_tsvector(...)`, or `pg_trgm` for `LIKE '%x%'` |
| MySQL | `FULLTEXT` index |
| At large scale | Elasticsearch / OpenSearch |

```sql
-- PostgreSQL full-text search
CREATE INDEX idx_posts_fts ON posts USING GIN (to_tsvector('english', content));

SELECT * FROM posts
WHERE to_tsvector('english', content) @@ to_tsquery('database');
```

---

## 6. Other index types you may meet

| Type | Short meaning | Use it when |
|---|---|---|
| **GIN** (PostgreSQL) | Inverted index for columns with many values per row (`jsonb`, arrays, text) | `WHERE data @> '{"plan":"pro"}'` |
| **GiST** (PostgreSQL) | For overlap / nearby / shapes | PostGIS, time ranges |
| **BRIN** (PostgreSQL) | Tiny index storing min/max per block | Huge append-only tables ordered by time |
| **Bitmap** (Oracle) | One bitmap per value | Data warehouse, few distinct values |
| **Vector / HNSW** | Nearest neighbour for embeddings | Semantic search, RAG |

```sql
CREATE INDEX idx_events_ts_brin ON events USING BRIN (created_at);
CREATE INDEX idx_customers_gin  ON customers USING GIN (data);
```

> Only pick these when you can **name the reason**. Otherwise use a B-Tree.

---

## Index shapes (options you add to any index)

"Type" (B-Tree, Hash...) is *how it is built*. "Shape" is *what you index*. They mix freely.

| Shape | What it does | Example |
|---|---|---|
| **Primary key** | Unique row id | `PRIMARY KEY (id)` |
| **Unique** | No duplicates, plus fast lookup | `CREATE UNIQUE INDEX ... ON users(email)` |
| **Single column** | Normal index | `CREATE INDEX ... ON orders(user_id)` |
| **Composite** | Several columns together | `... ON posts(user_id, created_at)` |
| **Covering** | Answers the query from the index alone | `... INCLUDE (likes)` |
| **Partial** | Index only some rows | `... WHERE status = 'pending'` |
| **Expression** | Index a function result | `... ON users(lower(email))` |
| **Descending** | Match `ORDER BY ... DESC` | `... (created_at DESC)` |

---

## 7. Composite index (most common optimization)

Use **one index on several columns** when you often filter on them together.

### Example: a social media feed

```sql
SELECT * FROM posts
WHERE user_id = 123
  AND created_at > '2024-01-01'
ORDER BY created_at DESC;
```

**Not great — two separate indexes:**

```sql
CREATE INDEX idx_user ON posts(user_id);
CREATE INDEX idx_time ON posts(created_at);
```
The database must: find posts of user 123 → find posts after Jan 1 → **intersect** both lists → **sort**. Lots of work.

**Better — one composite index:**

```sql
CREATE INDEX idx_user_time ON posts(user_id, created_at);
```

The B-Tree key is now a **pair**, sorted by `user_id` first, then `created_at`:

```
(101, 2024-01-01)
(101, 2024-01-02)
(119, 2024-01-01)
(123, 2024-01-02)   ← jump here, then read downwards
(123, 2024-01-03)
(125, 2024-01-01)
```

The database jumps to `user_id = 123` and reads in order. **Filtering and sorting happen in one scan.**

### Column order matters (the left-prefix rule)

An index on `(a, b, c)` is like a **phone book** sorted by *(last name, first name)*. You can look up "Smith" or "Smith, John". You **cannot** look up "everyone named John".

| Query | Uses index `(a, b, c)`? |
|---|---|
| `WHERE a = 1` | Yes |
| `WHERE a = 1 AND b = 2` | Yes |
| `WHERE a = 1 AND b = 2 AND c = 3` | Yes |
| `WHERE a = 1 ORDER BY b` | Yes (sort is free) |
| `WHERE b = 2` | **No** (skips `a`) |
| `WHERE c = 3` | **No** |
| `WHERE b = 2 AND c = 3` | **No** |

### How to choose the order: Equality → Sort → Range

1. Columns used with **`=`** go **first**.
2. Then the column you **`ORDER BY`**.
3. Then the column with a **range** (`>`, `<`, `BETWEEN`).

After a range column, the database cannot seek on later columns.

```sql
-- Query
SELECT * FROM orders
WHERE user_id = 42 AND status = 'pending' AND created_at >= '2026-01-01'
ORDER BY created_at DESC LIMIT 20;

-- GOOD: equality, equality, then range/sort
CREATE INDEX ix ON orders (user_id, status, created_at DESC);

-- BAD: range column in the middle
CREATE INDEX ix_bad ON orders (user_id, created_at, status);
```

Among the equality columns: put the column that is **always** in the query first. Then prefer the one with **more distinct values** (higher selectivity).

### Common examples

- Order history: `(customer_id, order_date)`
- Event processing: `(status, priority, created_at)`
- Activity feed: `(user_id, type, timestamp)`

### Remember

- `(a, b, c)` makes a separate `(a)` index **useless**. You can drop it.
- Two single indexes `(a)` and `(b)` are **not the same** as `(a, b)`. The database can combine them, but it is slower.

---

## 8. Covering index

A **covering index** holds **every column your query needs**. The database never visits the table.

### Example

```sql
CREATE TABLE posts (
    id         SERIAL PRIMARY KEY,
    user_id    INT,
    title      TEXT,
    content    TEXT,
    likes      INT,
    created_at TIMESTAMP
);

-- Normal index
CREATE INDEX idx_user_time ON posts(user_id, created_at);
```

Query: show a feed with time and like count.

```sql
SELECT created_at, likes FROM posts WHERE user_id = 123;
```

With the normal index, the database finds matching rows in the index, then **goes to the table for every row** just to read `likes`. That is many extra disk reads.

**Fix — add `likes` into the index:**

```sql
-- PostgreSQL / SQL Server
CREATE INDEX idx_user_time_likes
ON posts(user_id, created_at) INCLUDE (likes);

-- MySQL (no INCLUDE): put the column in the key
CREATE INDEX idx_user_time_likes ON posts(user_id, created_at, likes);
```

Now the answer comes **straight from the index** (an *index-only scan*).

### Trade-offs

- The index is **bigger** (more disk, more RAM).
- **More work on writes.**
- PostgreSQL index-only scans need the table to be recently `VACUUM`ed. On heavily updated tables it may still visit the table.

> **Honest advice:** covering indexes are a **niche** tool. Modern optimizers are smart with normal indexes. Use one only for a **hot, read-heavy query** where you can explain why. When unsure, keep it simple.

---

## 9. Partial and expression indexes

### Partial index: index only the rows you care about

If only 2% of orders are `pending` and you query those a lot:

```sql
CREATE INDEX idx_orders_pending ON orders (created_at) WHERE status = 'pending';
```

The index is **tiny**, always in memory, and writes to other rows do not touch it.

### Expression index: index a function result

If your query uses `lower(email)`, a normal index on `email` will not help. Index the **same expression**:

```sql
CREATE INDEX idx_users_email_lower ON users (lower(email));

SELECT * FROM users WHERE lower(email) = 'ali@example.com';  -- uses the index
```

---

## When an index exists but is NOT used

| Cause | Bad example | Fix |
|---|---|---|
| Function on the column | `WHERE YEAR(created_at) = 2026` | `WHERE created_at >= '2026-01-01' AND created_at < '2027-01-01'` or an expression index |
| Wildcard at the start | `WHERE name LIKE '%son'` | Trigram or full-text index |
| Type mismatch | `phone` is `VARCHAR`, you search `WHERE phone = 123` | Use the same type (`'123'`) |
| Negation | `!=`, `NOT IN` | Often unavoidable. Maybe a partial index |
| `OR` on different columns | `WHERE a = 1 OR b = 2` | `UNION` two queries, or a composite index |
| Low selectivity | `WHERE is_active = true` (95% are true) | Partial index on the rare value |
| Small table | A few hundred rows | Leave it. A scan is cheaper |
| Old statistics | Planner guesses wrong | Run `ANALYZE` |
| Returns most of the table | Wide date range, no `LIMIT` | A full scan is the **right** choice |

**The tipping point:** if a query returns roughly **5–20% or more** of the table, a full scan is often faster. An index does one random read per row, and too many random reads cost more than reading everything in order.

---

## Check your work with EXPLAIN

Never guess. Look at the plan.

```sql
EXPLAIN SELECT * FROM orders WHERE user_id = 42;
EXPLAIN ANALYZE SELECT * FROM orders WHERE user_id = 42;       -- PostgreSQL: really runs it
EXPLAIN (ANALYZE, BUFFERS) SELECT ...;                         -- PostgreSQL: cache vs disk reads
EXPLAIN ANALYZE FORMAT=TREE SELECT ...;                        -- MySQL 8.0.18+
```

| Good signs | Bad signs |
|---|---|
| `Index Seek`, `Index Scan`, `Index Only Scan`, `ref`, `range` | `Seq Scan` / `ALL` on a big table |
| Estimated rows ≈ actual rows | Estimated rows far from actual rows |
| | `using filesort`, `using temporary` |
| | `Rows Removed by Filter` is huge |

More: [Query Performance — Profiling & Optimization](Data-and-Persistence/advanced-sql/query-performance)

---

## Find and remove bad indexes

```sql
-- PostgreSQL: indexes that are never used (pure write cost)
SELECT schemaname, relname AS table, indexrelname AS index,
       idx_scan, pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_stat_user_indexes
WHERE idx_scan = 0
ORDER BY pg_relation_size(indexrelid) DESC;
```

```sql
-- MySQL 8
SELECT * FROM sys.schema_unused_indexes;
SELECT * FROM sys.schema_redundant_indexes;
```

Also look for:
- **Duplicate** indexes (same columns, same order).
- **Redundant** indexes (`(a)` when `(a, b)` exists).
- Indexes on columns no query filters on.

---

## Practical checklist

1. **Index every foreign key (JOIN column).** MySQL InnoDB does it automatically. **PostgreSQL does not.**
2. **Index high-selectivity columns** used in `WHERE` (`email`, `order_number`, `slug`).
3. **One composite index** that matches the query beats many single indexes. Order: **Equality → Sort → Range**.
4. Use a **covering** index only for your hottest read queries.
5. Use a **partial** index when you query only a small slice of rows.
6. Make `ORDER BY ... LIMIT` match an index (same columns, same direction) to skip sorting.
7. Keep the **primary key small and increasing** (`BIGINT`, `UUIDv7`). Avoid random `UUIDv4`.
8. **Prove it** with `EXPLAIN ANALYZE` before and after.
9. **Do not index:** tiny tables, boolean/low-variety columns (use partial), or columns you only `SELECT` and never filter on.
10. After a month, **drop indexes that are never used**.

---

## Where the row pointer points (MySQL vs PostgreSQL)

| Database | How the table is stored | What a secondary index points to |
|---|---|---|
| **PostgreSQL** | **Heap** (unordered pile of rows) | `ctid` (physical location) |
| **MySQL InnoDB** | **Clustered** (table = primary key B-Tree) | the row's **primary key** |
| **SQL Server** | Heap, or clustered if you add a clustered index | physical address or clustering key |

**InnoDB double lookup:** searching by `email` first finds the primary key in the `email` index, then looks up that primary key in the main tree. Every secondary index **stores a copy of the primary key**, so a big primary key (like a 16-byte `UUIDv4`) makes **every index bigger**. Prefer a small `BIGINT`.

---

## Big tables (millions to billions of rows)

- **Keep hot indexes in RAM.** Smaller indexes (fewer columns, partial indexes) fit better in the cache.
- **Partition** big tables (for example by month). Each partition gets its own smaller index. Queries skip partitions they do not need. See [Partitioning & Sharding](Data-and-Persistence/advanced-sql/partitioning-and-sharding).
- **Add indexes without downtime:**
  - PostgreSQL: `CREATE INDEX CONCURRENTLY` (if it fails, drop the `INVALID` index and retry).
  - MySQL: `ALTER TABLE ... ADD INDEX ..., ALGORITHM=INPLACE, LOCK=NONE`, or tools like `gh-ost` / `pt-online-schema-change`.
- **Bulk load:** drop non-essential indexes → load data → recreate indexes once → `ANALYZE`.
- **Use keyset pagination, not `OFFSET`.** `OFFSET 1000000` reads and throws away a million rows.

```sql
-- Page 1
SELECT id, created_at FROM orders WHERE user_id = 42
ORDER BY created_at DESC, id DESC LIMIT 20;

-- Next page: pass the last row you saw
SELECT id, created_at FROM orders
WHERE user_id = 42 AND (created_at, id) < ('2026-02-01 09:00:00', 998877)
ORDER BY created_at DESC, id DESC LIMIT 20;
-- Index: (user_id, created_at DESC, id DESC)
```

- **Write-heavy tables:** use fewer indexes, batch inserts, or move to an LSM store (Cassandra, RocksDB, MyRocks).
- **Append-only time data:** use a **BRIN** index (tiny).

---

## Common mistakes

- Indexing every column "just in case".
- Many single-column indexes when the query always uses two columns together.
- Wrong column order (range column first).
- Duplicate or redundant indexes left behind.
- `SELECT *` (breaks covering indexes).
- Functions in `WHERE` with no matching expression index.
- Random `UUIDv4` primary key in InnoDB.
- Deep `OFFSET` pagination.
- Plain `CREATE INDEX` on a busy production table (locks writes).

---

## Complexity (simple)

| | Cost |
|---|---|
| No index | `O(n)` — scan every row |
| B-Tree lookup | `O(log n)` — a few page reads |
| B-Tree range of `k` rows | `O(log n + k)` |
| Extra space | About `O(n)` per index |
| Each write | About `O(log n)` extra work **per index** |

Net: you trade slow reads for fast reads, and pay a little on every write.

---

## Java and PHP: small tips

**Java (JDBC)** — use `PreparedStatement` and match types. A `String` bound to an `INT` column can skip the index.

```java
String sql = "SELECT id, total FROM orders WHERE user_id = ? AND status = ? "
           + "ORDER BY created_at DESC LIMIT 20";
try (PreparedStatement ps = conn.prepareStatement(sql)) {
    ps.setLong(1, 42);
    ps.setString(2, "pending");
    try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) { /* ... */ }
    }
}
```

**PHP (PDO)** — bind numbers as integers.

```php
$stmt = $pdo->prepare(
  "SELECT id, total FROM orders
   WHERE user_id = :uid AND status = :st
   ORDER BY created_at DESC LIMIT 20");
$stmt->bindValue(':uid', 42, PDO::PARAM_INT);   // not the default string
$stmt->bindValue(':st', 'pending', PDO::PARAM_STR);
$stmt->execute();
```

ORMs: watch for generated `LOWER(col) = ?` and `SELECT *`. Add matching DB indexes.

---

## Interview Q&A

**Q: When do you add an index, and on which columns?**
On columns used in `WHERE`, `JOIN`, and `ORDER BY` for queries you really run. Think about your read and write patterns first. Skip tiny tables and write-heavy, rarely-read tables.

**Q: What is the main trade-off of an index?**
Faster reads, but slower writes and more storage. Every write must update every index.

**Q: Why B-Tree and not a hash or a binary tree?**
Hash gives fast `=` but no order, so no ranges or sorting. A binary tree is too deep (many disk reads). A B-Tree is wide and shallow (3–4 levels), sorted, and linked at the leaves. So it does equality, ranges, and sorting well.

**Q: B-Tree or LSM Tree?**
B-Tree for balanced, read-heavy apps. LSM for very heavy writes (metrics, logs) where slower reads are fine.

**Q: How do you search for nearby locations?**
B-Trees on lat/lng do not work well because the problem is 2D. Use a geospatial index: geohash (string prefix + B-Tree), or an R-Tree (overlapping bounding boxes) for shapes.

**Q: How do you search text efficiently?**
An inverted index maps each word to the documents that contain it. Use full-text search (GIN in PostgreSQL, `FULLTEXT` in MySQL, or Elasticsearch).

**Q: I have `INDEX(a, b, c)`. Which queries use it?**
- `WHERE b = 1` → no (skips `a`).
- `WHERE a = 1 AND c = 1` → seeks on `a`, only filters `c`.
- `WHERE a = 1 AND b > 1 AND c = 1` → seeks `a`, range on `b`, `c` is only a filter.
- `ORDER BY a, b` → yes, no sort needed.

**Q: Why does `WHERE YEAR(created_at) = 2026` not use the index?**
The index stores `created_at`, not `YEAR(created_at)`. Rewrite it as a range, or create an expression index.

**Q: The index exists but `EXPLAIN` shows a full scan. Is it a bug?**
Usually no. The query may return a large part of the table, so scanning is cheaper. Also check old statistics, type mismatch, or a function on the column.

**Q: What is a covering index and what does it cost?**
An index with all columns a query needs, so the table is never read. It costs more disk, more RAM, and more write work. Use it for hot queries only.

**Q: Does a foreign key need an index?**
Yes. MySQL InnoDB creates it automatically. PostgreSQL does not. Without it, parent `DELETE`/`UPDATE` scans the whole child table.

**Q: How do you add an index to a huge table in production?**
PostgreSQL: `CREATE INDEX CONCURRENTLY`. MySQL: online DDL or `gh-ost`. Try it on a replica first and watch replication lag.

**Q: Low-variety column like `status` with 5 values?**
A plain index helps little. Use a **partial index** on the rare value, or a **composite** index that starts with a selective column.

---

## Cheat sheet

```
Not sure which index? ........................ B-Tree
Filter/join on a column ...................... single-column B-Tree
Filter on several columns together ........... composite (Equality → Sort → Range)
Hot read path, few columns ................... covering (INCLUDE)
Only a small slice of rows matter ............ partial index
Function in WHERE ............................ expression index (or rewrite as a range)
Words inside text ............................ inverted / full-text (GIN, FULLTEXT)
Nearby locations ............................. geohash or R-Tree
JSON / arrays ................................ GIN
Huge append-only time data ................... BRIN
Heavy writes, few reads ...................... LSM engine (Cassandra, RocksDB)
Exact match only, in memory .................. Hash (Redis)
Deep pages ................................... keyset pagination
New index on prod ............................ CONCURRENTLY / online DDL / gh-ost
After a month ................................ drop indexes with idx_scan = 0
```

---

## See Also
- [Query Performance — Profiling & Optimization](Data-and-Persistence/advanced-sql/query-performance) — `EXPLAIN`, statistics, finding the slow query
- [Joins](Data-and-Persistence/advanced-sql/joins) — join methods and why to index foreign keys
- [Partitioning & Sharding](Data-and-Persistence/advanced-sql/partitioning-and-sharding) — local vs global indexes, partition pruning
- [Constraints](Data-and-Persistence/advanced-sql/constraints) — unique and primary keys are indexes underneath
- [Data & Persistence Concepts](Data-and-Persistence/data-persistence-concepts) — MVCC, isolation, N+1, pagination

---

*Part of [Advanced SQL & Database Programmability](Data-and-Persistence/advanced-sql-programmability).*
