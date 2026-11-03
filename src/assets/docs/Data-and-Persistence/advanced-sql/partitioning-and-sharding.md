# Partitioning & Sharding

### The Problem
- A single table can grow so large that even indexed queries slow down, and a single database server can run out of capacity (CPU, memory, disk, or throughput) no matter how well the queries are tuned.

### What It Solves
- **Partitioning** splits one table's data into physical segments **within the same database server**, so the query planner can skip segments that can't possibly match (**partition pruning**) — this mainly helps I/O and query planning on one machine.
- **Sharding** takes this further by splitting data across **multiple separate database servers**, scaling throughput and total storage past what one machine can hold — at the cost of losing easy cross-shard joins and transactions.

### How It Works

**Partitioning — one logical table, split into pieces on one server:**
```sql
-- Range partitioning by date — common for time-series/log tables
CREATE TABLE orders (
    id INT NOT NULL,
    created_at DATE NOT NULL,
    total DECIMAL(10,2)
)
PARTITION BY RANGE (YEAR(created_at)) (
    PARTITION p2024 VALUES LESS THAN (2025),
    PARTITION p2025 VALUES LESS THAN (2026),
    PARTITION p2026 VALUES LESS THAN (2027)
);

-- A query filtered on created_at only scans the relevant partition
SELECT * FROM orders WHERE created_at >= '2026-01-01';
```
Other strategies: `LIST` (explicit value groups, e.g. by region code), `HASH` (evenly distribute by a hash of the key, no natural range).

**Sharding — data spread across separate servers:**
- Each shard is a **separate database server**, and the application (or a routing layer) decides which shard owns a given row, typically via a hash or range of a shard key (e.g. `user_id`).
```
shard = hash(user_id) % num_shards
```
- **Shard key selection matters enormously:** pick a key with high cardinality and even access distribution (`user_id` is usually good; `country` is often bad — creates hot shards for large countries).
- Cross-shard joins and transactions become hard or impossible — most sharded systems denormalize, use an application-level join, and treat cross-shard writes as eventually consistent or use a saga/2PC pattern.

### Java — application-level shard routing
```java
int shardCount = 4;
int shardId = Math.floorMod(userId.hashCode(), shardCount);
DataSource shardDataSource = shardRouter.get(shardId); // pool per shard

try (Connection conn = shardDataSource.getConnection();
     PreparedStatement ps = conn.prepareStatement("SELECT * FROM orders WHERE user_id = ?")) {
    ps.setLong(1, userId);
    ResultSet rs = ps.executeQuery();
}
```

### PHP — application-level shard routing
```php
$shardCount = 4;
$shardId = crc32((string) $userId) % $shardCount;
$pdo = $shardConnections[$shardId]; // pre-established PDO connection per shard

$stmt = $pdo->prepare("SELECT * FROM orders WHERE user_id = ?");
$stmt->execute([$userId]);
```

- **Partitioning vs. sharding, in one line:** partitioning scales a table on one machine (helps I/O and query planning); sharding scales the whole database horizontally across machines (helps throughput and storage past what one machine can hold), at the cost of losing easy cross-shard joins/transactions.

### Time & Space Complexity
- **Partitioning:** if a query's filter matches the partitioning key (e.g. `WHERE created_at >= ...` on a table partitioned by date), the planner only scans the matching partition(s) — turning a scan of **O(n)** rows (the whole table) into roughly **O(n / p)** rows, where `p` is the number of partitions. If the filter doesn't match the partition key, every partition must be scanned — effectively `O(n)` again, so pruning only helps when queries actually filter on the partition key.
- **Sharding:** spreads storage across `s` shards, so each shard holds roughly **O(n / s)** rows — this is what lets total storage and write throughput scale past what one machine could hold, since each shard is a fully independent server with its own disk/CPU/memory budget.
- **Cross-shard operations:** a query needing data from multiple shards (e.g. "top 10 users across the whole system") must query every shard and merge results in the application/routing layer — cost becomes **O(s) round-trips** plus **O((n/s) log(n/s))** work per shard for any sorting/merging, which is why cross-shard joins and global aggregates are the expensive case sharded systems try to avoid via denormalization.
- **Why this matters:** partitioning and sharding both work by shrinking the "n" any single operation deals with — but only for access patterns aligned with how the data was split (by partition key, or shard key). An access pattern that cuts across shards throws away that benefit and pays a multi-machine coordination cost instead.

---

*Part of [Advanced SQL & Database Programmability](Data-and-Persistence/advanced-sql-programmability).*
