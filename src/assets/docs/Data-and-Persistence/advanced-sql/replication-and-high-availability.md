# Replication, High Availability & Backup

### The Problem
- A single database server is a **single point of failure**. If its disk dies, the machine reboots, or a bad deploy wipes a table, your app is down and data may be gone.
- One server also has a **limit**: if thousands of users only *read* data (product pages, feeds), one machine's CPU becomes the bottleneck.
- Humans make mistakes: `DELETE FROM orders;` without a `WHERE` happens in real companies.

```
        App ───────►  [ ONE database ]
                           │
          disk fails / crash / overload / bad query
                           ▼
                  Everything stops. Data may be lost.
```

### What It Solves
| Tool | Question it answers |
|---|---|
| **Replication** | "How do I keep a live copy of my data on other servers?" |
| **Read replicas** | "How do I spread read traffic over many servers?" |
| **High availability (HA) + failover** | "How do I keep running automatically when a server dies?" |
| **Backups + point-in-time recovery (PITR)** | "How do I get my data back after a mistake or disaster?" |

> **Important:** replication is **not** a backup. If you run `DELETE` on the primary, the delete is copied to the replicas within milliseconds. Backups protect you from human error; replicas protect you from hardware failure.

### How It Works

#### 1. The core idea — the change log
Databases write every change into an ordered **log** first (PostgreSQL: **WAL** = Write-Ahead Log; MySQL: **binlog**). Replication simply **ships that log** to other servers, which replay it.

```
 Client: INSERT / UPDATE / DELETE
              │
              ▼
     ┌─────────────────┐   1. write change to log     ┌───────────────────┐
     │     PRIMARY     │ ───────────────────────────► │  log: change #1   │
     │ (accepts writes)│                              │       change #2   │
     └─────────────────┘                              │       change #3   │
              │                                       └─────────┬─────────┘
              │ 2. send log entries over the network            │
              ▼                                                 ▼
     ┌─────────────────┐                              ┌───────────────────┐
     │   REPLICA 1     │ ◄─── 3. replay in same order │   REPLICA 2       │
     │ (read only)     │                              │ (read only)       │
     └─────────────────┘                              └───────────────────┘
```
Same order of changes → same final data on every server.

**Terms:**
| Old name | Modern name | Meaning |
|---|---|---|
| Master | **Primary / Source** | The server that accepts writes |
| Slave | **Replica / Standby** | A copy that follows the primary |

---

#### 2. Synchronous vs asynchronous replication
**The question:** when does the primary tell the client "COMMIT OK"?

```
ASYNCHRONOUS                                  SYNCHRONOUS
Client      Primary        Replica            Client      Primary        Replica
  │ COMMIT────►│                                │ COMMIT────►│
  │◄── OK ─────│  (immediately)                 │            ├── send log ──►│
  │            ├── send log ───►│ (later)        │            │◄── "got it" ──┤
  │            │                                │◄── OK ─────│  (after replica confirms)
```

| | Asynchronous (default) | Synchronous |
|---|---|---|
| Commit speed | **Fast** (does not wait) | **Slower** (waits for network + replica) |
| If primary dies suddenly | Last few commits **may be lost** (replica was behind) | **No committed data lost** (replica already has it) |
| If replica dies | Primary keeps working | Primary may **block** writes (unless set to fall back) |
| Typical use | Read scaling, most web apps | Banking, "zero data loss" rules |

- **RPO** (Recovery Point Objective) = how much data you can afford to lose. Async: seconds. Sync: zero.
- **RTO** (Recovery Time Objective) = how long you can afford to be down.
- **Semi-synchronous** (MySQL): wait for *at least one* replica to confirm receipt, not all of them. A middle path.

---

#### 3. Replication lag (the biggest gotcha)
With async replication the replica is **always slightly behind** the primary. The delay is called **replication lag**.

**Story: the "I just posted but it's gone" bug (read-your-writes problem)**
```
t0   User posts a comment ───────────────► PRIMARY  (saved ✔)
t1   Page reloads, app reads from ───────► REPLICA  (log hasn't arrived yet!)
t2   Comment is NOT shown. User thinks it failed and posts again.
t3   ... replica catches up. Now there are 2 comments.
```

**Ways to handle lag:**

| Fix | How | Cost |
|---|---|---|
| **Read-your-writes** | After a user writes, send *their* next reads to the primary for a few seconds | Slightly more load on primary |
| **Sticky by session** | Remember the log position (LSN/GTID) of the user's write; only read from a replica that has reached it | More code |
| **Read critical data from primary** | Balance, payment status always go to primary | Less read scaling |
| **Monitor lag** | Alert if lag > N seconds, remove laggy replicas from rotation | Needs monitoring |

```sql
-- Check lag
-- PostgreSQL (run on the replica): how old is the last replayed transaction?
SELECT now() - pg_last_xact_replay_timestamp() AS replication_lag;

-- MySQL (run on the replica)
SHOW REPLICA STATUS\G         -- look at Seconds_Behind_Source
```

---

#### 4. Replication topologies
```
(a) Primary → Replicas        (b) Cascading                (c) Multi-primary
        P                           P                       P1 ◄──────► P2
      / | \                         │                       writes on both
    R1  R2  R3                      R1                      (needs conflict
                                    │                        resolution!)
                                    R2
```
| Topology | Good for | Watch out |
|---|---|---|
| **Single primary + replicas** | 95% of apps; simple and safe | Only one place to write |
| **Cascading** | Reduce load on the primary when many replicas | Longer chain = more lag |
| **Multi-primary** (active-active) | Writes in several regions | **Conflicts**: two people edit the same row on different primaries. Needs last-write-wins, CRDTs, or app rules. Hard! |

**Physical vs logical replication:**
| | Physical (streaming) | Logical |
|---|---|---|
| Copies | Raw disk-level changes (the whole server) | Row-level changes (INSERT/UPDATE/DELETE) per table |
| Replica | Identical copy, read-only | Can have extra tables, indexes, even a different version |
| Use | HA, read replicas | Upgrades with no downtime, copying only some tables, feeding other systems |
| Example | PG streaming replication, MySQL binary-log (row format also logical-like) | PG `CREATE PUBLICATION / SUBSCRIPTION` |

---

#### 5. Read/write splitting (using replicas to scale reads)
```
               ┌────────── writes ──────────► PRIMARY
   App ──►  Router
               └────────── reads  ──────────► REPLICA 1 / 2 / 3 (round-robin)
```

**Java (simple router idea):**
```java
// Two pools: one for the primary (writes), one load-balanced across replicas (reads)
DataSource writeDs = primaryPool;
DataSource readDs  = replicaPool;

public void saveOrder(Order o) throws SQLException {
    try (Connection c = writeDs.getConnection()) {   // writes ALWAYS go to the primary
        // INSERT INTO orders ...
    }
}

public Order findOrder(long id, boolean needFreshData) throws SQLException {
    // If the caller just wrote this data, read from the primary to avoid replication lag
    DataSource ds = needFreshData ? writeDs : readDs;
    try (Connection c = ds.getConnection()) {
        // SELECT * FROM orders WHERE id = ?
    }
    return null;
}
```

**PHP:**
```php
$write = new PDO($primaryDsn, $user, $pass);   // primary: all writes
$read  = new PDO($replicaDsn, $user, $pass);   // replica: normal reads

function findOrder(PDO $write, PDO $read, int $id, bool $needFresh = false) {
    $pdo = $needFresh ? $write : $read;        // fresh data after a write -> primary
    $stmt = $pdo->prepare('SELECT * FROM orders WHERE id = ?');
    $stmt->execute([$id]);
    return $stmt->fetch();
}
```

**Set up a PostgreSQL streaming replica (high-level steps):**
```bash
# On the primary (postgresql.conf): enable the log shipping
#   wal_level = replica
#   max_wal_senders = 10
# Create a replication user, allow it in pg_hba.conf, then on the replica machine:

pg_basebackup -h primary-host -U replicator -D /var/lib/postgresql/data -R
# -D : copy the primary's data directory here (initial full copy)
# -R : write the settings so this server starts as a standby that follows the primary
```
**MySQL replica (high-level):**
```sql
-- On the replica: tell it where the primary is and start following
CHANGE REPLICATION SOURCE TO
    SOURCE_HOST = 'primary-host',
    SOURCE_USER = 'replicator',
    SOURCE_PASSWORD = '***',
    SOURCE_AUTO_POSITION = 1;     -- use GTIDs so positions are tracked automatically
START REPLICA;
```

---

#### 6. High availability (HA) and failover
**Goal:** if the primary dies, **promote a replica** to be the new primary automatically, with little downtime.

```
BEFORE                           PRIMARY DIES                     AFTER FAILOVER
  App ─► P  ─► R1, R2             App ─► ✖ P                       App ─► R1 (now PRIMARY)
                                  (health check fails)                    │
                                  Manager picks R1 (most up-to-date)      └─► R2 follows R1
```

**Failover steps (what the automatic tool does):**
1. **Detect** the primary is down (several failed health checks, not just one).
2. **Choose** the replica that has the most data (smallest lag).
3. **Promote** it to primary (stop following, accept writes).
4. **Redirect** the app: update DNS, a virtual IP, or the proxy.
5. **Re-point** other replicas to follow the new primary.
6. Later, **repair** the old primary and re-add it as a replica.

**Split-brain (the dangerous failure):** the network breaks, so the manager *thinks* the primary is dead and promotes a replica, but the old primary is still alive and still accepting writes. Now **two primaries** have different data.
```
        network cut
   P (alive, thinks it is boss) ─ ╳ ─ R1 (promoted, also thinks it is boss)
   App group A writes to P                    App group B writes to R1
   => data diverges, very painful to merge
```
**Prevention:**
- **Quorum / majority voting:** need more than half of the nodes to agree (use an odd number: 3 or 5).
- **Fencing (STONITH — "Shoot The Other Node In The Head"):** forcibly shut down or isolate the old primary before promoting.
- Use a proven tool instead of writing your own.

**Common tools:**
| Tool | For |
|---|---|
| **Patroni** (+ etcd/Consul) | PostgreSQL automatic failover |
| **repmgr** | PostgreSQL |
| **MySQL InnoDB Cluster / Group Replication** | MySQL HA |
| **Orchestrator** | MySQL topology management |
| **ProxySQL / HAProxy / PgBouncer** | Route traffic to the right server |
| **Managed services** (AWS RDS Multi-AZ, Aurora, Cloud SQL) | Failover handled for you |

**Availability numbers ("nines"):**
| Uptime | Downtime per year |
|---|---|
| 99% | ~3.65 days |
| 99.9% | ~8.8 hours |
| 99.99% | ~52 minutes |
| 99.999% | ~5 minutes |

---

#### 7. Backups
**Rule: "3-2-1"** → keep **3** copies, on **2** different kinds of storage, **1** off-site.

| Type | What it is | Pros | Cons |
|---|---|---|---|
| **Logical backup** | SQL text / rows exported (`pg_dump`, `mysqldump`) | Portable across versions, restore single tables | Slow on big databases, slow restore |
| **Physical backup** | Copy of the data files (`pg_basebackup`, Percona XtraBackup) | Very fast for big DBs | Same major version/OS needed |
| **Snapshot** | Disk/volume snapshot (cloud, LVM) | Almost instant | Must be consistent (flush/quiesce) |
| **Full** | Everything | Simple restore | Big and slow |
| **Incremental / differential** | Only changes since last backup | Small and quick | Restore needs the chain of backups |

```
Full backup (Sunday)   Incremental Mon   Incremental Tue   Incremental Wed
     [██████████]          [██]               [█]               [███]
Restore Wed = Full + Mon + Tue + Wed (all in order)
```

```bash
# PostgreSQL logical backup and restore
pg_dump -Fc -h localhost -U app mydb > mydb.dump       # -Fc = compressed custom format
pg_restore -h localhost -U app -d mydb_restored mydb.dump

# MySQL logical backup and restore
mysqldump --single-transaction --routines --triggers mydb > mydb.sql
# --single-transaction : consistent snapshot WITHOUT locking tables (InnoDB)
mysql mydb_restored < mydb.sql
```

> **A backup you have never restored is not a backup.** Test restores regularly, and time them (this is your real RTO).

---

#### 8. Point-in-Time Recovery (PITR)
**Problem:** it is 14:07. Someone ran `DROP TABLE orders` at 14:03. Last night's backup is 14 hours old. Restoring it loses a whole day.

**Solution:** restore the last full backup, then **replay the change log (WAL/binlog) up to 14:02:59**, just before the mistake.

```
 Midnight             14:02:59            14:03             Now
    │                     │                  │                │
 [Full backup]──replay WAL/binlog──► STOP    ✖ DROP TABLE
                                      ▲
                                recover to here
```
```bash
# PostgreSQL PITR (idea): restore the base backup, then in postgresql.conf set:
#   restore_command = 'cp /archive/%f %p'          # where archived WAL files live
#   recovery_target_time = '2026-11-01 14:02:59'   # stop just before the mistake
# create an empty file recovery.signal in the data dir, then start the server.

# MySQL PITR (idea): restore the full dump, then replay binary logs up to a time
mysqlbinlog --stop-datetime="2026-11-01 14:02:59" binlog.000042 | mysql -u root -p
```
Requires **continuous log archiving** to be turned on *before* the disaster.

---

#### 9. Putting it together (typical production setup)
```
                          ┌─────────────┐
 App ─► Proxy/Router ───► │  PRIMARY    │──── WAL archive ───► Object storage (off-site)
          │               └──────┬──────┘                       + nightly full backups
          │                 sync │ async
          │              ┌───────▼──────┐   ┌─────────────┐
          └─ reads ────► │ STANDBY (HA) │   │ READ REPLICA│ ──► reports / analytics
                         └──────────────┘   └─────────────┘
          Health checker (Patroni/etcd) promotes STANDBY if PRIMARY dies
```

### Time & Space Complexity
- **Write cost:** asynchronous replication adds almost no latency to a commit. Synchronous adds **one network round-trip** to the nearest replica to every commit.
- **Replica apply:** a replica replays the same `n` changes, so work is **O(n)**, and a single-threaded replay can fall behind a busy primary (lag). Modern engines replay in parallel.
- **Read scaling:** with `r` replicas, read capacity grows roughly **×r** (writes do not scale: every replica still applies every write).
- **Space:** each replica stores a **full copy**, so storage = **(1 + r) × data size**. Backups add more (full + increments + archived logs).
- **Backup/restore time** is roughly **O(data size)**; PITR also adds time proportional to the **amount of log to replay**.

### Alternatives
| Need | Option | Note |
|---|---|---|
| Scale **writes** too | Sharding (see [Partitioning & Sharding](Data-and-Persistence/advanced-sql/partitioning-and-sharding)) | Replicas don't help writes |
| Multi-region writes | Distributed SQL (CockroachDB, Spanner, YugabyteDB) | Built-in consensus (Raft/Paxos), higher write latency |
| Don't want to operate it | Managed cloud DB (RDS, Aurora, Cloud SQL) | Costs more, less control |
| Faster reads | Cache (Redis) in front of the DB | Cache invalidation is hard |
| Cheap safety net | Delayed replica (replicates with 1 hour delay) | Lets you recover from `DROP TABLE` before the delay passes |

### Common Mistakes
- Treating replicas as backups.
- Never testing a restore.
- Reading just-written data from an async replica (the "my comment disappeared" bug).
- Only 2 nodes in an HA cluster (can't form a majority, so split-brain risk). Use 3.
- Not turning on WAL/binlog archiving, so PITR is impossible when needed.
- Keeping backups on the same disk or server as the database.
- Letting a long-running transaction on a replica block replay (query conflicts) without monitoring.

### Quick Interview Answers
- **Sync vs async replication?** Sync waits for a replica before confirming commit (no data loss, slower); async confirms immediately (fast, may lose the last commits on failover).
- **What is replication lag and its effect?** The replica is behind the primary; reads from it may be stale. Use read-your-writes routing.
- **What is split-brain and how do you prevent it?** Two nodes both act as primary. Prevent with quorum voting and fencing.
- **Replication vs backup?** Replication protects from hardware failure; backups protect from logical errors and let you restore past states (PITR).
- **RPO vs RTO?** RPO = acceptable data loss; RTO = acceptable downtime.
