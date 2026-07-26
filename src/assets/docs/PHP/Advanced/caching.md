# Caching in PHP — Opcode Cache & Object Caching

## TL;DR
**Caching** stores the result of expensive operations so you don't repeat them. PHP has two main cache layers: **Opcode Cache (OPcache)** caches compiled PHP bytecode in memory — your PHP files run faster without re-parsing. **Object/Data Cache** (Redis, Memcached) stores application-level data — query results, API responses, computed values. Together they reduce server load dramatically and make applications feel instant.

---

## Why Caching?

Without caching, every request repeats expensive work:

```
Every page request (NO cache):
User → PHP → Parse PHP file → Compile to opcodes → Execute
           → DB query (50ms) → Render → Response

With OPcache:
User → PHP → [Opcodes from memory] → Execute
           → DB query (50ms) → Render → Response

With OPcache + Data Cache:
User → PHP → [Opcodes from memory] → Execute
           → [Data from Redis < 1ms] → Render → Response
```

---

## Part 1: Opcode Cache (OPcache)

### What is OPcache?

PHP is an interpreted language. Normally, every request:
1. Reads the PHP file from disk
2. Lexes and parses it into an AST
3. Compiles the AST to opcodes (internal bytecode)
4. Executes the opcodes

Steps 1–3 are identical on every request — pure waste. **OPcache** stores compiled opcodes in shared memory. On subsequent requests, PHP skips to step 4 directly.

```
Without OPcache:
Request 1: Read file → Parse → Compile → Execute → Response
Request 2: Read file → Parse → Compile → Execute → Response
Request 3: Read file → Parse → Compile → Execute → Response

With OPcache:
Request 1: Read file → Parse → Compile → Cache opcodes → Execute → Response
Request 2:                                [From memory] → Execute → Response
Request 3:                                [From memory] → Execute → Response
```

**Speed improvement:** 2x–10x faster PHP execution, less CPU usage.

### Installing OPcache

OPcache ships with PHP 5.5+ — usually just needs enabling:

```bash
# Check if enabled
php -v
# PHP 8.3.0 (cli) with Zend OPcache v8.3.0

# Check from PHP
php -r "var_dump(function_exists('opcache_get_status'));"

# Ubuntu/Debian
sudo apt-get install php8.3-opcache

# Enable in php.ini
zend_extension=opcache
```

### OPcache Configuration (php.ini)

```ini
[opcache]
; Enable OPcache
opcache.enable=1
opcache.enable_cli=0    ; disable for CLI (usually not needed)

; Memory — how much shared memory to allocate (MB)
; For most apps: 128MB. Large apps: 256MB+
opcache.memory_consumption=128

; How many files to cache (default 10000 — increase for large apps)
opcache.max_accelerated_files=20000

; Interned strings buffer (MB) — caches PHP string literals
opcache.interned_strings_buffer=16

; Check file timestamp for changes (seconds)
; Development: 1 (check every second)
; Production: 0 (never check — maximum performance)
opcache.revalidate_freq=0
opcache.validate_timestamps=0   ; PRODUCTION: disable file change checks

; Save compiled scripts for faster restart
opcache.file_cache=/tmp/opcache

; JIT (PHP 8.0+ Just-In-Time compiler)
opcache.jit=tracing             ; best JIT mode for most apps
opcache.jit_buffer_size=128M
```

### Monitoring OPcache

```php
// Get OPcache status
$status = opcache_get_status();

echo "Hit rate: "      . round($status['opcache_statistics']['opcache_hit_rate'], 2) . "%\n";
echo "Cached files: "  . $status['opcache_statistics']['num_cached_scripts'] . "\n";
echo "Memory used: "   . round($status['memory_usage']['used_memory'] / 1024 / 1024, 2) . " MB\n";
echo "Memory free: "   . round($status['memory_usage']['free_memory'] / 1024 / 1024, 2) . " MB\n";

// List all cached files
foreach ($status['scripts'] as $file => $info) {
    echo $file . " — hits: " . $info['opcache_hits'] . "\n";
}

// Reset OPcache (after deployment)
opcache_reset(); // invalidates entire cache
opcache_invalidate('/var/www/app/config.php', true); // invalidate single file
```

### OPcache Best Practices

```
Development:
  opcache.validate_timestamps=1   ← detects file changes
  opcache.revalidate_freq=1

Production (after deployment):
  opcache.validate_timestamps=0   ← never re-reads files → maximum speed
  opcache.revalidate_freq=0
  → After deploying, run: opcache_reset() or restart PHP-FPM
```

---

## Part 2: Object / Data Caching

Object caching stores application data — query results, API responses, computed values — so you don't recompute or re-fetch them.

### Caching Strategies

| Strategy | How | Use Case |
|---|---|---|
| **Cache-Aside (Lazy Loading)** | Check cache → miss → fetch → store | Most common — cache only what's requested |
| **Write-Through** | Write to cache AND DB simultaneously | Read-heavy, strong consistency needed |
| **Write-Behind** | Write to cache → async write to DB | Write-heavy, tolerate eventual consistency |
| **Read-Through** | Cache fetches from DB automatically | Transparent to application code |
| **Cache Bust** | Invalidate on write | When stale data is unacceptable |

---

## Redis as Object Cache

Redis is the most popular object cache — fast (sub-ms), rich data structures, TTL support.

```bash
composer require predis/predis
# OR use the phpredis C extension (faster)
pecl install redis
```

### Setup and Basic Usage

```php
// Using predis (pure PHP)
$redis = new Predis\Client([
    'scheme' => 'tcp',
    'host'   => getenv('REDIS_HOST') ?: '127.0.0.1',
    'port'   => 6379,
    'password' => getenv('REDIS_PASSWORD'),
]);

// Using phpredis (C extension — faster)
$redis = new Redis();
$redis->connect('127.0.0.1', 6379);
$redis->auth(getenv('REDIS_PASSWORD'));
$redis->select(0); // database 0
```

### Cache-Aside Pattern

```php
class UserService {
    private const TTL = 3600; // 1 hour in seconds

    public function __construct(
        private Redis $redis,
        private UserRepository $repo,
    ) {}

    public function findById(int $id): ?array {
        $key    = "user:$id";
        $cached = $this->redis->get($key);

        if ($cached !== false) {
            return json_decode($cached, true); // cache hit
        }

        // Cache miss — fetch from database
        $user = $this->repo->findById($id);

        if ($user !== null) {
            $this->redis->setex($key, self::TTL, json_encode($user));
        }

        return $user;
    }

    public function update(int $id, array $data): void {
        $this->repo->update($id, $data);
        $this->redis->del("user:$id"); // invalidate cache after write
    }
}
```

### Common Redis Caching Patterns

```php
// String: simple key-value cache
$redis->setex('config:maintenance', 3600, json_encode(['enabled' => false]));
$config = json_decode($redis->get('config:maintenance'), true);

// Hash: cache an object's fields
$redis->hMSet("user:123", [
    'name'  => 'Alice',
    'email' => 'alice@example.com',
    'role'  => 'admin',
]);
$redis->expire("user:123", 3600);
$name = $redis->hGet("user:123", 'name'); // get single field
$user = $redis->hGetAll("user:123");      // get all fields

// List: recent items (e.g., last 10 viewed products)
$redis->lPush("recent:user:123", $productId); // add to front
$redis->lTrim("recent:user:123", 0, 9);       // keep only 10
$recent = $redis->lRange("recent:user:123", 0, -1); // get all

// Set: unique items (e.g., "which users liked this post")
$redis->sAdd("post:likes:456", $userId);
$redis->sCard("post:likes:456");            // count
$redis->sIsMember("post:likes:456", $uid); // check membership

// Sorted Set: leaderboard (score → member)
$redis->zAdd("leaderboard", 5000, "player1");
$redis->zAdd("leaderboard", 7500, "player2");
$redis->zRevRange("leaderboard", 0, 9, ['withscores' => true]); // top 10

// Atomic counter (rate limiting)
$key = "rate:ip:{$ip}:" . floor(time() / 60);
$count = $redis->incr($key);
$redis->expire($key, 60);
if ($count > 100) throw new RateLimitException();
```

### Cache Invalidation Strategies

```php
// 1. Delete on write (simplest — may cause cache miss spike)
public function updateUser(int $id, array $data): void {
    $this->db->update('users', $data, ['id' => $id]);
    $this->redis->del("user:$id");
}

// 2. Update cache on write (write-through — no miss spike)
public function updateUser(int $id, array $data): void {
    $this->db->update('users', $data, ['id' => $id]);
    $user = $this->db->find('users', $id); // refetch
    $this->redis->setex("user:$id", 3600, json_encode($user));
}

// 3. Tag-based invalidation (invalidate groups of related keys)
public function cacheWithTag(string $key, mixed $value, string $tag, int $ttl = 3600): void {
    $this->redis->setex($key, $ttl, serialize($value));
    $this->redis->sAdd("tag:$tag", $key); // track key under this tag
    $this->redis->expire("tag:$tag", $ttl);
}

public function invalidateTag(string $tag): void {
    $keys = $this->redis->sMembers("tag:$tag");
    if ($keys) {
        $this->redis->del(...$keys);
        $this->redis->del("tag:$tag");
    }
}

// Usage: all user data under tag "users"
$this->cacheWithTag("user:1", $user1, "users");
$this->cacheWithTag("user:2", $user2, "users");
$this->invalidateTag("users"); // clears all user caches at once
```

---

## PSR-6 and PSR-16 (Cache Interfaces)

PHP-FIG defines standard cache interfaces — code that works with any cache backend:

```bash
composer require symfony/cache  # PSR-6 + PSR-16 implementation
```

```php
use Symfony\Component\Cache\Adapter\RedisAdapter;
use Symfony\Component\Cache\Simple\RedisCache; // PSR-16

// PSR-6 (complex, ItemInterface-based)
$cache = new RedisAdapter($redis, 'myapp', 3600);

$item = $cache->getItem('user.1');
if (!$item->isHit()) {
    $item->set($this->repo->find(1));
    $item->expiresAfter(3600);
    $cache->save($item);
}
$user = $item->get();

// PSR-16 (simpler)
$cache = new \Symfony\Component\Cache\Psr16Cache(
    new RedisAdapter($redis)
);

$user = $cache->get('user.1', function () {
    return $this->repo->find(1); // computed on cache miss
});
$cache->set('user.1', $user, 3600);
$cache->delete('user.1');
```

---

## Memcached

Memcached is simpler than Redis — pure key-value, no persistence, no pub/sub. Better for pure caching use cases with many write workers.

```bash
pecl install memcached
```

```php
$memcached = new Memcached();
$memcached->addServer('127.0.0.1', 11211);

// Get
$value = $memcached->get('my-key');
if ($memcached->getResultCode() === Memcached::RES_NOTFOUND) {
    // cache miss
}

// Set (key, value, TTL in seconds)
$memcached->set('my-key', $data, 3600);

// Delete
$memcached->delete('my-key');

// Multi-get (efficient batch fetching)
$values = $memcached->getMulti(['key1', 'key2', 'key3']);
```

### Redis vs Memcached

| | Redis | Memcached |
|---|---|---|
| Data structures | Rich (strings, lists, sets, hashes, sorted sets) | Strings only |
| Persistence | Optional (RDB/AOF) | No persistence |
| Pub/Sub | Yes | No |
| Cluster | Yes (Redis Cluster) | Yes |
| Transactions | Yes (MULTI/EXEC) | No |
| Lua scripting | Yes | No |
| Memory efficiency | Good | Slightly better for pure cache |
| Use case | Cache + sessions + queues + pub/sub | Pure cache only |
| **Recommended** | **Yes — more versatile** | Only for pure cache |

---

## Cache Warming

Preload the cache before users hit the cold start:

```php
// cache-warm.php (run as part of deployment)
class CacheWarmer {
    public function __construct(
        private UserService    $users,
        private ProductService $products,
        private CacheInterface $cache,
    ) {}

    public function warm(): void {
        echo "Warming product catalog...\n";
        $products = $this->products->findFeatured(); // fetches + caches
        echo "Cached " . count($products) . " products\n";

        echo "Warming popular users...\n";
        $userIds = [1, 2, 3, 4, 5]; // top users
        foreach ($userIds as $id) {
            $this->users->findById($id); // populates cache
        }

        echo "Cache warm complete!\n";
    }
}

// Run during deployment: php cache-warm.php
```

---

## Caching Pitfalls

### Thundering Herd Problem

When cache expires, thousands of requests hit the DB simultaneously:

```php
// ❌ Thundering herd — all miss at once
$data = $redis->get('popular-products');
if (!$data) {
    $data = $db->fetchPopularProducts(); // 1000 simultaneous requests hit DB
    $redis->setex('popular-products', 3600, serialize($data));
}

// ✅ Probabilistic early expiration (jitter) — prevents synchronized expiry
function getCached(string $key, callable $compute, int $ttl): mixed {
    $data = $redis->get($key);
    if ($data !== false) {
        $item = unserialize($data);
        // Probabilistically refresh before expiry
        $remaining = $redis->ttl($key);
        if ($remaining < $ttl * 0.1 && rand(1, 100) === 1) {
            // Only 1% of requests refresh early — no herd
            $item = $compute();
            $redis->setex($key, $ttl, serialize($item));
        }
        return $item;
    }

    // Full miss — use a lock to prevent stampede
    $lock = $redis->set("lock:$key", 1, ['NX' => true, 'EX' => 5]);
    if ($lock) {
        $item = $compute();
        $redis->setex($key, $ttl, serialize($item));
        $redis->del("lock:$key");
        return $item;
    }

    usleep(100000); // 100ms — wait for lock holder to populate
    return getCached($key, $compute, $ttl); // retry
}
```

---

## Full Caching Stack Summary

```
Request → PHP (OPcache: bytecode cache) → Application
               ↓
         Check Redis/Memcached (object cache)
               ↓ hit                    ↓ miss
         Return cached value      Query Database
                                        ↓
                                  Store in Redis
                                        ↓
                                  Return value

Layers of caching in production:
1. CDN / HTTP cache    — static assets, full pages (Cloudflare, Nginx)
2. OPcache             — PHP bytecode (automatic, in-process)
3. Application cache   — Redis/Memcached (query results, sessions, computed data)
4. Database cache      — MySQL query cache, PostgreSQL shared buffers
5. OS page cache       — kernel caches hot files in RAM automatically
```

---

## Interview Q&A

**Q: What is OPcache and why is it important?**
A: OPcache stores compiled PHP bytecode in shared memory. Normally, every PHP request reads, parses, and compiles PHP files from scratch — OPcache skips those steps. It typically gives a 2x–10x performance improvement with zero code changes. In production, disable timestamp validation (`validate_timestamps=0`) for maximum speed.

**Q: What is the difference between OPcache and Redis cache?**
A: OPcache caches compiled PHP bytecode — it speeds up PHP execution itself. Redis caches application data — query results, API responses, sessions. OPcache is automatic and transparent; Redis requires code to check, fetch, and store. Both are needed in production.

**Q: What is the cache-aside pattern?**
A: Check the cache first. On a hit, return the cached value. On a miss, fetch from the source (DB/API), store in cache with a TTL, then return. It's the most common caching pattern — it only caches data that's actually requested, keeping the cache lean.

**Q: What is the thundering herd problem?**
A: When a popular cached item expires, many simultaneous requests all find a cache miss and all hit the database at once — creating a stampede. Solutions include: mutex/lock (only first requester fetches, others wait), probabilistic early expiration (randomly refresh before TTL expires), or staggered TTLs (add jitter to expiry times).

**Q: When would you use Memcached instead of Redis?**
A: Memcached is slightly more memory-efficient for pure caching with many write workers. But Redis supports richer data structures (sorted sets, pub/sub, streams), optional persistence, and Lua scripting. For most PHP applications, Redis is the better choice — it handles caching plus sessions, queues, and real-time features in one tool.
