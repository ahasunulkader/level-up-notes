# Connection Pooling

### The Problem
- Before your app can run any SQL, it needs a **connection** to the database. Opening one is **expensive**: it is not just "pick up the phone", it is a whole ceremony.

**What happens every time you open a new connection:**
```
App                                         Database
 │ 1. TCP handshake (SYN, SYN-ACK, ACK) ───►│   ~1 network round trip
 │ 2. TLS handshake (certificates, keys) ──►│   ~2 round trips (if encrypted)
 │ 3. Login (username + password check) ───►│   ~1-2 round trips
 │ 4. DB creates a session / process/thread │   PostgreSQL: a whole new OS process (~5-10 MB RAM)
 │ 5. Set charset, timezone, schema ───────►│
 │ ... NOW you can run your query ...       │
 │ 6. Close: tear everything down           │
```
Typical cost: **20–100 ms and several MB of memory on the server** — often more than the query itself (which may take 1 ms).

**Second problem: the database can only hold so many connections.**
```
max_connections = 100  (PostgreSQL default)  /  151 (MySQL default)

1,000 web requests arrive at once, each opens its own connection:
   [req1][req2]...[req100]  ✔ accepted
   [req101] ... [req1000]   ✖ "FATAL: too many connections"  -> your site is DOWN
```
More connections is not a fix: each one uses memory, and too many active connections make the database **slower** (CPU thrashing, lock contention).

### What It Solves
- A **connection pool** opens a small set of connections **once**, keeps them alive, and **lends** them to requests. When a request is done it **returns** the connection instead of closing it.
- Think of a **taxi stand**: instead of building a new car for every passenger, a few cars wait and are reused.

```
WITHOUT a pool                         WITH a pool
req ─► open ─► query ─► close          req ─► borrow ─► query ─► return ─┐
req ─► open ─► query ─► close                      ▲                      │
req ─► open ─► query ─► close                      └──────────────────────┘
(3 expensive handshakes)               (handshakes paid once at startup)

            ┌────────── POOL (size 3) ──────────┐
 requests ─►│ [conn1 idle] [conn2 busy] [conn3 idle] │──► DATABASE
            └───────────────────────────────────┘
```
Benefits: **speed** (no handshake per request), **protection** (hard cap on connections), **stability** (waiting requests queue up instead of crashing the DB).

### How It Works

#### 1. The life of a pooled connection
```
                 ┌────────────── pool ──────────────┐
  1. borrow()    │   IDLE connections               │
 App ───────────►│   (ready, already logged in)     │
                 └───────────┬──────────────────────┘
                             │ hand one out
                             ▼
                      IN USE (busy) ── 2. run SQL ──►  DB
                             │
                  3. close() / return  (does NOT really close the TCP socket)
                             ▼
                 back to IDLE ── validated, rolled back, reset ──► waits for next borrower
```
When you call `connection.close()` on a pooled connection, the pool intercepts it: it just **returns** the connection to the pool.

**What if all connections are busy?**
```
Pool size = 3, all busy. A 4th request arrives:
   - waits in a queue up to `connectionTimeout` (e.g. 30 s)
   - a connection is returned -> the waiter gets it
   - timeout reached -> error "Connection is not available" (request fails fast, DB stays healthy)
```

#### 2. Important settings (and what they mean)
| Setting | Meaning | Typical value |
|---|---|---|
| **maximum pool size** | Max connections the pool will open | 10–20 per app instance |
| **minimum idle** | Connections kept ready even when quiet | = max (fixed size) or lower |
| **connection timeout** | How long a request waits to borrow before failing | 2–30 s |
| **idle timeout** | Close connections unused for this long (down to min idle) | 10 min |
| **max lifetime** | Replace connections older than this (before DB/firewall kills them) | 30 min (shorter than DB `wait_timeout`) |
| **validation / keepalive** | Test a connection before handing it out | `SELECT 1` or driver ping |
| **leak detection** | Warn if a connection is held too long | 30–60 s |

#### 3. How big should the pool be? (surprising answer: small!)
**Wrong idea:** "more connections = more speed".
**Truth:** a database has a limited number of CPU cores and disks. Beyond what they can do in parallel, extra connections just **wait in line inside the database** and add overhead.

A good starting formula (from the PostgreSQL wiki / HikariCP docs):
```
pool_size ≈ (number_of_CPU_cores × 2) + number_of_disks
Example: DB with 8 cores, 1 SSD -> (8 × 2) + 1 = 17 connections total
```
**Remember the TOTAL across all app servers:**
```
10 app instances × pool of 20 = 200 connections hitting a DB with max_connections = 100  ✖ PROBLEM

Fix: smaller pool per instance (10 × 8 = 80)   or   an external pooler (PgBouncer / ProxySQL)
```

```
Throughput
   ▲
   │          ___------____        <- peak, then it GETS WORSE
   │      _--'               '--__
   │    ,'                        ''--.__
   │  ,'
   └────────────────────────────────────────► number of connections
         sweet spot            too many (contention)
```

#### 4. Application-side pool vs external pooler
```
(A) In-app pool                         (B) External pooler (PgBouncer, ProxySQL, RDS Proxy)
App1 [pool 10] ─┐                        App1 ─┐
App2 [pool 10] ─┼──► DB  (30 conns)      App2 ─┼─► [ PgBouncer ] ──► DB (20 conns)
App3 [pool 10] ─┘                        App3 ─┘     (hundreds of client conns in,
                                                      few real DB conns out)
```
| | In-app pool (HikariCP, PDO persistent...) | External pooler |
|---|---|---|
| Setup | Library config | Extra service to run |
| Scales to many app instances | Poorly (sum of pools) | **Well** (multiplexes thousands of clients) |
| Needed for PHP-FPM / serverless | Hard (each process is isolated) | **Yes, strongly recommended** |

**PgBouncer pooling modes (PostgreSQL):**
| Mode | A server connection is held for... | Caveat |
|---|---|---|
| **session** | the whole client session | Least sharing |
| **transaction** (most used) | one transaction only | Session features break: `SET`, advisory locks, `LISTEN`, prepared statements (older versions) |
| **statement** | one statement | No multi-statement transactions |

#### 5. Java — HikariCP (the standard)
```java
HikariConfig cfg = new HikariConfig();
cfg.setJdbcUrl("jdbc:postgresql://db-host:5432/shop");
cfg.setUsername("shop_app");
cfg.setPassword(System.getenv("DB_PASSWORD"));   // never hard-code secrets

cfg.setMaximumPoolSize(10);          // hard cap of connections for THIS app instance
cfg.setMinimumIdle(10);              // keep all of them warm (fixed-size pool is recommended)
cfg.setConnectionTimeout(5_000);     // wait max 5 s for a free connection, then fail
cfg.setMaxLifetime(1_800_000);       // retire a connection after 30 min
cfg.setLeakDetectionThreshold(30_000); // log a warning if a connection is held > 30 s

HikariDataSource ds = new HikariDataSource(cfg);   // create ONCE at startup, share everywhere

// Usage: try-with-resources guarantees the connection is RETURNED to the pool
try (Connection c = ds.getConnection();
     PreparedStatement ps = c.prepareStatement("SELECT name FROM users WHERE id = ?")) {
    ps.setLong(1, 42);
    try (ResultSet rs = ps.executeQuery()) { /* read rows */ }
}   // <- close() here means "give back to pool", not "disconnect"
```

#### 6. PHP — a different world
Classic PHP (PHP-FPM) runs each request in a short-lived worker with no shared memory, so a normal in-process pool is not possible.

| Option | How | Note |
|---|---|---|
| **Persistent connections** | `new PDO($dsn, $u, $p, [PDO::ATTR_PERSISTENT => true])` | Each FPM worker keeps its own connection alive between requests. Total = number of workers |
| **External pooler** | PgBouncer / ProxySQL | Best for large PHP fleets |
| **Long-running runtimes** | Swoole, RoadRunner, FrankenPHP workers | Support real in-process pools |

```php
// Persistent connection: reused by the same FPM worker across requests
$pdo = new PDO(
    'mysql:host=db-host;dbname=shop;charset=utf8mb4',
    'shop_app',
    getenv('DB_PASSWORD'),
    [
        PDO::ATTR_PERSISTENT => true,                       // keep the connection open after the script ends
        PDO::ATTR_ERRMODE    => PDO::ERRMODE_EXCEPTION,     // throw exceptions instead of silent failures
    ]
);
// Danger: if a script dies mid-transaction, the next request on this worker may inherit
// an open transaction. Always commit/rollback, and consider an external pooler for safety.
```

#### 7. Classic bugs
**a) Connection leak** — borrowed but never returned. The pool slowly empties until everything hangs.
```java
// BAD: if executeQuery() throws, close() never runs -> connection is lost forever
Connection c = ds.getConnection();
c.createStatement().executeQuery("...");
c.close();

// GOOD: try-with-resources always returns it
try (Connection c = ds.getConnection()) { /* ... */ }
```
```
Symptoms: pool shows active = max, idle = 0, threads waiting; DB itself looks idle.
```
**b) Holding a connection while doing slow non-DB work**
```java
try (Connection c = ds.getConnection()) {
    var row = load(c);
    callSlowExternalApi(row);   // <- connection is blocked for seconds for nothing!
    save(c, row);
}
// Better: borrow, read, return -> call API -> borrow again, write, return.
```
**c) Dirty state leaking between borrowers** (session variables, open transactions, changed `autocommit`, changed schema). Pools reset most of this on return; avoid session-level `SET` in pooled code (see [Variables](Data-and-Persistence/advanced-sql/variables)).
**d) Stale connections** — firewall or DB silently kills idle connections. Fix with `maxLifetime` shorter than the server timeout and keepalive checks.
**e) Pool exhaustion cascade** — one slow query makes connections stay busy, requests queue, timeouts pile up, retries make it worse. Use timeouts, circuit breakers and limit concurrency.

#### 8. Monitoring checklist
| Metric | Healthy | Problem sign |
|---|---|---|
| Active connections | Below max | Constantly = max |
| Threads waiting for connection | ~0 | Growing |
| Connection acquire time | < few ms | Seconds |
| Connection usage time | Short | Long (slow queries or leaks) |
```sql
-- PostgreSQL: how many connections and what are they doing?
SELECT state, count(*) FROM pg_stat_activity GROUP BY state;
-- MySQL
SHOW STATUS LIKE 'Threads_connected';
SHOW PROCESSLIST;
```

### Time & Space Complexity
- **Borrow/return:** about **O(1)** (take from a queue/list).
- **Saved time per request:** the handshake cost (tens of ms) is paid **once per connection** instead of once per request. With `N` requests and pool size `P`: opening cost drops from `N × setup` to `P × setup`.
- **Space:** the pool holds `P` connections on the app side and `P` sessions on the DB side (PostgreSQL ≈ several MB each). Memory ≈ `P × per-connection memory`.
- **Waiting:** if demand `D` exceeds `P`, extra requests queue. Average wait grows as load approaches pool capacity (queueing theory: wait rises sharply near 100% utilisation).
- **Little's Law helps sizing:** `connections needed ≈ requests per second × average seconds each request holds a connection`. Example: 200 req/s × 0.02 s = **4 connections** is enough!

### Alternatives
| Need | Option |
|---|---|
| Very many app instances / serverless | PgBouncer, ProxySQL, RDS Proxy, Supavisor |
| Avoid per-request DB work | Cache (Redis), batching |
| Lightweight DB access in functions | HTTP-based data APIs, connection-less proxies |
| No pool, tiny scripts | A single connection opened once (CLI jobs) |

### Common Mistakes
- Creating a new pool (or `DataSource`) **per request**.
- Setting pool size to hundreds "to be safe".
- Forgetting the total = instances × pool size.
- Not returning connections (leaks) or holding them during slow external calls.
- Using session state (`SET`, temp tables, advisory locks) with transaction-mode poolers.
- No connection timeout, so requests hang forever when the pool is exhausted.

### Quick Interview Answers
- **Why a connection pool?** Opening a connection is slow and uses server memory; a pool reuses a small fixed set and caps load.
- **How do you size it?** Start small (≈ cores × 2 + disks), measure, and remember the total across instances against the DB's `max_connections`.
- **What is a connection leak?** A borrowed connection that is never returned, so the pool drains and the app hangs.
- **Why is PHP different?** Each request runs in an isolated worker, so use persistent connections or an external pooler.
- **What breaks in PgBouncer transaction mode?** Session-level features: `SET`, advisory locks, `LISTEN/NOTIFY`, session-held prepared statements.
