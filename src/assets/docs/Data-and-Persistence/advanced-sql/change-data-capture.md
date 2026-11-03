# Change Data Capture (CDC) & Event Sourcing

### The Problem
- Other systems need to know **when data in your database changes**: a search index (Elasticsearch), a cache (Redis), an analytics warehouse, another microservice, an audit log.
- How do you find out "what changed since last time"?

**Naive approaches and why they hurt:**
```
(1) Poll the table: SELECT * FROM orders WHERE updated_at > :last_check
      ✖ Misses DELETEs (the row is gone, nothing to find)
      ✖ Needs an indexed updated_at on every table, and every writer must set it
      ✖ Hammers the database with repeated queries; results are delayed by the poll interval
      ✖ Misses changes if two updates happen between polls (you only see the last state)

(2) Dual write: app writes to DB, then also writes to Elasticsearch/Kafka
      ✖ One can fail while the other succeeds -> systems drift apart
      ✖ Every code path that changes data must remember to do both

(3) Triggers that write to a log table
      ✖ Slows every write; logic spread across the DB; hard to maintain
```

### What It Solves
- **Change Data Capture** reads the database's own **transaction log** (WAL / binlog), the same log used for crash recovery and replication, and turns every committed `INSERT / UPDATE / DELETE` into an **event** (a message). Consumers subscribe to the events.
- Because the log already records *every* change in order, CDC:
  - misses nothing (including deletes),
  - adds almost **no load** on the tables (reads the log, not the tables),
  - keeps **order** and works in near real time,
  - needs **no changes** in your application code.

```
 App ─► DB (tables)
         │ writes to
         ▼
   Transaction log (WAL / binlog)   <- the DB already has this
         │ read by
         ▼
   CDC connector (Debezium)  ─► Kafka topic "shop.public.orders"
                                    │
              ┌─────────────────────┼──────────────────────┐
              ▼                     ▼                      ▼
        Elasticsearch           Redis cache         Data warehouse / other services
```

### How It Works

#### 1. Anatomy of a change event
Each event says **what table, what operation, the row before, and the row after**.

```json
{
  "op": "u",                       // c = create(insert), u = update, d = delete, r = snapshot read
  "source": { "db": "shop", "table": "orders", "lsn": 23456789, "ts_ms": 1793000000000 },
  "before": { "id": 55, "status": "PENDING", "total": 100 },
  "after":  { "id": 55, "status": "PAID",    "total": 100 }
}
```
| Operation | `before` | `after` |
|---|---|---|
| Insert | null | the new row |
| Update | old row | new row |
| Delete | the deleted row | null |

That is why CDC sees deletes: the log records "row X was deleted".

#### 2. Reading the log: what must be enabled
| Database | Log used | Required setting |
|---|---|---|
| **PostgreSQL** | WAL + *logical decoding* (replication slot, plugin like `pgoutput`) | `wal_level = logical` |
| **MySQL** | Binary log | `binlog_format = ROW`, `binlog_row_image = FULL`, GTID recommended |
| SQL Server | CDC tables / transaction log | Enable CDC per table |
| Oracle | Redo log (LogMiner/XStream) | Supplemental logging |

```sql
-- PostgreSQL: enable logical decoding and create a publication for tables to stream
-- (postgresql.conf)  wal_level = logical
CREATE PUBLICATION shop_pub FOR TABLE orders, customers;
-- A replication slot remembers how far the consumer has read, so no change is lost
SELECT * FROM pg_create_logical_replication_slot('shop_slot', 'pgoutput');
```
> **Danger:** a replication slot makes PostgreSQL **keep WAL files until the consumer reads them**. If the consumer is down for days, WAL piles up and **fills the disk**. Monitor slot lag and drop unused slots.
> ```sql
> SELECT slot_name, active, pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS lag
> FROM pg_replication_slots;
> ```

#### 3. The usual CDC pipeline with Debezium + Kafka
**Debezium** is the most popular open-source CDC tool. It runs inside Kafka Connect.
```
MySQL/PG ──log──► Debezium connector ──► Kafka topic per table ──► consumers
```
Connector config (example):
```json
{
  "name": "shop-connector",
  "config": {
    "connector.class": "io.debezium.connector.postgresql.PostgresConnector",
    "database.hostname": "db-host",
    "database.port": "5432",
    "database.user": "cdc_user",
    "database.password": "${secret}",
    "database.dbname": "shop",
    "topic.prefix": "shop",                       // topics become shop.public.orders, ...
    "table.include.list": "public.orders,public.customers",
    "plugin.name": "pgoutput",
    "slot.name": "shop_slot"
  }
}
```
**Initial snapshot:** when it first starts, Debezium reads the **current table contents** (op = `r`) and then switches to streaming new changes from the log, so consumers get a complete picture.

#### 4. Consumer example
**Java (Kafka consumer keeping Elasticsearch in sync):**
```java
consumer.subscribe(List.of("shop.public.orders"));
while (true) {
    for (ConsumerRecord<String, String> rec : consumer.poll(Duration.ofSeconds(1))) {
        JsonNode event = mapper.readTree(rec.value());
        String op = event.get("op").asText();

        if ("d".equals(op)) {
            search.delete("orders", event.get("before").get("id").asText());   // row deleted -> remove from index
        } else {
            // insert, update, or snapshot read -> upsert the new state (idempotent!)
            search.index("orders", event.get("after").get("id").asText(), event.get("after"));
        }
    }
    consumer.commitSync();   // remember our position; after a crash we may re-read some events
}
```
**Why it is written as an upsert/delete by id:** CDC delivers **at-least-once**. The same event may arrive twice, so processing must be **idempotent** (see [Distributed Transactions](Data-and-Persistence/advanced-sql/distributed-transactions)).

**PHP (simple consumer using a Kafka library, idea):**
```php
// Pseudo-code: apply the event to a Redis cache
$event = json_decode($message->payload, true);
$key = 'order:' . ($event['after']['id'] ?? $event['before']['id']);

if ($event['op'] === 'd') {
    $redis->del($key);                                   // deleted row -> drop from cache
} else {
    $redis->set($key, json_encode($event['after']));     // insert/update -> refresh cache
}
```

#### 5. CDC methods compared
| Method | How | Deletes? | DB load | Latency | Code changes |
|---|---|---|---|---|---|
| **Timestamp polling** | `WHERE updated_at > ?` | ✖ no | High | Poll interval | Need `updated_at` |
| **Trigger-based** | Triggers copy changes to a log table | ✔ | Higher (extra writes) | Low | DB objects |
| **Snapshot diff** | Compare full copies | ✔ | Very high | Slow | None |
| **Log-based (Debezium etc.)** | Read WAL/binlog | ✔ | **Very low** | **Low (ms–s)** | **None** |

#### 6. Outbox + CDC (the best-practice combo)
Raw CDC exposes your **table structure** to other teams. If you rename a column, consumers break. Instead:
1. Your service writes business data **and** an event row into an `outbox` table in the same transaction.
2. CDC streams only the `outbox` table.
3. Consumers get clean, versioned business events (`OrderPlaced`), not raw row changes.
```
BEGIN; INSERT orders...; INSERT outbox(event_type, payload)...; COMMIT;
        └──────── CDC reads outbox rows from the WAL ───────► Kafka
```
Details of the table are on the [Distributed Transactions](Data-and-Persistence/advanced-sql/distributed-transactions) page.

#### 7. Event Sourcing (a related idea)
CDC derives events *from* state changes. **Event sourcing** flips it: the **events are the source of truth**, and the current state is calculated by replaying them.

```
Traditional (state):                Event sourcing (events):
accounts: id=1, balance=70          events for account 1:
(history is lost)                     1. AccountOpened(balance=0)
                                      2. Deposited(100)
                                      3. Withdrew(30)
                                    state = replay → 0 + 100 − 30 = 70
```
```sql
CREATE TABLE account_events (
    event_id    BIGINT AUTO_INCREMENT PRIMARY KEY,
    account_id  INT NOT NULL,
    event_type  VARCHAR(30) NOT NULL,   -- Deposited, Withdrew, ...
    amount      DECIMAL(12,2),
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Current balance = fold over events (append-only; never UPDATE or DELETE events)
SELECT SUM(CASE event_type WHEN 'Deposited' THEN amount WHEN 'Withdrew' THEN -amount ELSE 0 END) AS balance
FROM account_events WHERE account_id = 1;
```
| Pros | Cons |
|---|---|
| Full audit history for free; can "time travel" | Complex; replay can be slow (use **snapshots** every N events) |
| Easy to build new read models later | Event schema changes (versioning) are hard |
| Natural fit with messaging | Eventual consistency; learning curve |

**CQRS** (Command Query Responsibility Segregation): separate the **write model** (commands, events) from one or more **read models** (denormalized tables/indexes optimized for queries), kept up to date by consuming events.
```
Commands ──► [Write model / events] ──events──► [Read model A: SQL view table]
                                           └──► [Read model B: search index]
Queries ◄──────────────────────────────────────── read models
```

#### 8. Typical use cases
| Use case | How CDC helps |
|---|---|
| Keep **Elasticsearch/search** updated | Stream row changes into the index |
| **Cache invalidation** | Delete/update cache keys on change |
| **Data warehouse** loading | Near-real-time ETL without heavy batch jobs |
| **Zero-downtime migration** | Copy old DB to new DB, stream live changes, switch over |
| **Microservice data sync** | Publish domain events (via outbox) |
| **Audit trail** | Every change recorded with before/after |

#### 9. Things that go wrong
- **Schema changes:** adding/dropping columns changes event shape. Use a schema registry (Avro/Protobuf) and backward-compatible changes.
- **Large transactions:** one huge transaction becomes a flood of events; consumers see them after commit.
- **Ordering:** order is guaranteed **per key/partition** (use the primary key as the Kafka key), not globally across tables.
- **Lag:** if consumers are slow, lag grows; monitor it.
- **Unbounded WAL (PostgreSQL slots)** as described above.
- **Sensitive data** (passwords, PII) flows into Kafka: filter/mask columns in the connector.

### Time & Space Complexity
- **Capture cost:** O(size of changes). Reading the log is sequential and does not scan tables, so it is independent of table size (unlike polling, which is O(table or index range) per poll).
- **Initial snapshot:** O(table size), once.
- **Latency:** typically milliseconds to a few seconds.
- **Space:** the broker stores events for its retention period; PostgreSQL retains WAL for slow slots; the outbox table grows until old rows are purged. Event sourcing stores **all history forever** (O(number of events)); snapshots bound replay time to O(events since snapshot).

### Alternatives
| Need | Option |
|---|---|
| Simple, low volume | Polling with `updated_at` + soft deletes |
| Domain events instead of row changes | Outbox pattern (with or without CDC) |
| Managed | AWS DMS, Google Datastream, Airbyte, Fivetran |
| Real-time DB notifications (small scale) | PostgreSQL `LISTEN/NOTIFY` (not durable) |
| Database-native | MySQL/PG replication to a reporting replica |

### Common Mistakes
- Using timestamp polling and then wondering why deletes never propagate.
- Forgetting to monitor PostgreSQL replication slot lag (disk fills up).
- Exposing raw tables as a public contract instead of an outbox/event schema.
- Consumers that are not idempotent.
- Assuming global ordering across tables or partitions.
- Not planning for the initial snapshot or for schema evolution.

### Quick Interview Answers
- **What is CDC?** Capturing row-level changes by reading the database transaction log and publishing them as events.
- **Why log-based over polling?** Captures deletes, lower load, lower latency, no app changes, preserves order.
- **How does it relate to the outbox pattern?** Outbox writes the event atomically with the data; CDC reads the outbox table from the log and publishes it reliably.
- **CDC vs event sourcing?** CDC derives events from state changes; event sourcing stores events as the source of truth and derives state.
- **Delivery guarantee?** Usually at-least-once, so consumers must be idempotent.
