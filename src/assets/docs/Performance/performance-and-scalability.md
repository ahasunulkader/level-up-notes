# Performance & Scalability Thinking

Performance is about making things faster. Scalability is about maintaining performance as load grows. Understanding where bottlenecks form and how to address them is essential for senior PHP interviews.

---

## 1. Identifying Bottlenecks

Before optimizing anything, **measure first**. Guessing where the bottleneck is leads to wasted effort optimizing the wrong thing.

### The 80/20 Rule

Typically 80% of performance issues come from 20% of the code. Focus on the critical path.

### Profiling Tools

```php
<?php
// Laravel Telescope — built-in profiling
// Shows: query count, query time, job time, request time
// Install: composer require laravel/telescope

// Laravel Debugbar — development overlay
// Shows: queries, cache hits/misses, memory, timeline
// composer require barryvdh/laravel-debugbar

// Xdebug profiler — generates cachegrind files for KCacheGrind/PHPStorm

// Simple manual timing
$start = microtime(true);
// ... operation to measure
$elapsed = (microtime(true) - $start) * 1000;
logger()->info("Operation took {$elapsed}ms");

// Database query log
DB::enableQueryLog();
// ... do stuff
$queries = DB::getQueryLog();
// Each entry: ['query' => ..., 'bindings' => ..., 'time' => 4.23 (ms)]
foreach ($queries as $q) {
    logger()->info("SQL [{$q['time']}ms] {$q['query']}");
}
```

### Common Bottleneck Sources

| Layer | Common Bottleneck | Symptom |
|-------|------------------|---------|
| Database | N+1 queries, missing indexes, slow JOINs | High DB query time, many queries |
| Cache | Cache misses, no caching | Repeated expensive DB calls |
| Application | Inefficient loops, memory leaks, blocking I/O | High CPU, slow response |
| Network | Slow external APIs, no timeout | Long request times on API calls |
| File system | Reading/writing large files synchronously | High I/O wait |

```php
<?php
// IDENTIFY: Check query count on a page
// If a page runs 200 queries — that's a red flag, check for N+1

// IDENTIFY: Check response time distribution
// P50 = 200ms (median), P95 = 800ms, P99 = 3s
// High P99 means occasional slow requests — look for lock contention

// IDENTIFY: Memory usage
memory_get_peak_usage(true); // peak memory in bytes
// If a request uses 256MB — likely loading too much data
```

---

## 2. Caching

Caching stores the result of expensive operations so they can be returned instantly on subsequent requests without re-computing.

### Types of Caching

#### Application-Level Cache (Redis / Memcached)

```php
<?php
// Laravel Cache — works with Redis, Memcached, or file driver

// Cache::remember — get from cache or compute and store
$users = Cache::remember('active_users', 300, function () {
    // This runs only if cache is empty — then stores result for 300 seconds
    return User::where('active', true)->with('roles')->get();
});

// Cache::rememberForever — no expiry
$config = Cache::rememberForever('app_config', fn() => AppConfig::all()->keyBy('key'));

// Manual get/set/forget
Cache::put('user:42:profile', $userArray, 600); // 10 min
$profile = Cache::get('user:42:profile');        // null if expired
Cache::forget('user:42:profile');                // invalidate

// Tags — invalidate related cache keys as a group
Cache::tags(['users', 'user:42'])->put('profile', $data, 600);
Cache::tags(['users'])->flush(); // invalidate everything tagged 'users'

// Atomic: only store if key doesn't exist (prevents stampede)
Cache::add('lock:order:123', true, 30);
```

**Cache Key Design:**
```php
<?php
// Include enough context to be unique
"user:{$userId}:profile"
"product:{$productId}:reviews:page:{$page}"
"category:{$slug}:products:sort:{$sortBy}"
```

#### Query Result Caching

```php
<?php
// Cache expensive aggregation queries
function getDashboardStats(): array
{
    return Cache::remember('dashboard:stats', 300, function () {
        return [
            'total_users'   => User::count(),
            'total_revenue' => Order::where('status', 'paid')->sum('total'),
            'orders_today'  => Order::whereDate('created_at', today())->count(),
        ];
    });
}
```

#### HTTP Response Caching

```php
<?php
// Cache-Control headers — tell browsers/CDNs to cache
return response($content)
    ->header('Cache-Control', 'public, max-age=3600')
    ->header('ETag', md5($content));

// Laravel's built-in response caching
// spatie/laravel-responsecache — caches entire response
```

### Cache Invalidation Strategies

```php
<?php
// Strategy 1: TTL (Time To Live) — simplest
Cache::put('product:42', $product, 600); // auto-expires after 10 min

// Strategy 2: Event-based invalidation — precise but more complex
class ProductObserver
{
    public function updated(Product $product): void
    {
        Cache::forget("product:{$product->id}");
        Cache::forget("category:{$product->category_id}:products");
    }
}

// Strategy 3: Cache versioning (for when you can't enumerate keys)
$version = Cache::increment('product:42:version'); // bump version
Cache::put("product:42:v{$version}", $product, 3600);
```

### Cache-Aside Pattern (Most Common)

```php
<?php
// Application manages the cache explicitly
function getProduct(int $id): Product
{
    $cacheKey = "product:{$id}";

    if ($cached = Cache::get($cacheKey)) {
        return $cached; // cache hit — fast path
    }

    // Cache miss — load from DB
    $product = Product::with('images', 'category')->findOrFail($id);
    Cache::put($cacheKey, $product, 600);

    return $product;
}
```

### Redis Data Structures for Performance

```php
<?php
// Sorted set — leaderboard (O(log n) inserts, O(log n) range queries)
$redis->zAdd('leaderboard', $score, "user:{$userId}");
$topTen = $redis->zRevRange('leaderboard', 0, 9, ['withScores' => true]);

// Set — unique visitors (O(1) add and check)
$redis->sAdd("visitors:{$date}", $userId);
$count = $redis->sCard("visitors:{$date}");

// HyperLogLog — approximate unique count with tiny memory
$redis->pfAdd("unique_visitors:{$date}", $userId);
$approxCount = $redis->pfCount("unique_visitors:{$date}");
```

---

## 3. Lazy Loading

Lazy loading defers an operation (loading data, creating an object, rendering content) until it's actually needed. It avoids paying the cost of things that may never be used.

### Lazy Loading vs Eager Loading

```php
<?php
// EAGER — load everything upfront
$users = User::with('orders', 'addresses', 'permissions')->get();
// Fetches ALL related data immediately — even for users you may not display

// LAZY — load on demand (ORM default)
$users = User::all();
foreach ($users as $user) {
    if ($user->isPremium()) {
        echo $user->orders->count(); // query fires only for premium users
    }
}
// If 80% of users are not premium, you saved 80% of order queries
```

### PHP Lazy Initialization Pattern

```php
<?php
class ReportGenerator
{
    private ?array $heavyData = null;

    // Don't load in constructor — only when needed
    private function getHeavyData(): array
    {
        if ($this->heavyData === null) {
            $this->heavyData = $this->loadFromDatabase(); // 500ms query
        }
        return $this->heavyData;
    }

    public function generateSummary(): string
    {
        return "Summary"; // doesn't need heavy data — no DB query
    }

    public function generateFullReport(): string
    {
        $data = $this->getHeavyData(); // loaded only when this method is called
        return $this->format($data);
    }
}
```

### PHP 8.4 Lazy Objects (Built-in)

```php
<?php
// PHP 8.4 added native lazy object initialization
use ReflectionClass;

$reflector = new ReflectionClass(MyHeavyService::class);
$proxy = $reflector->newLazyProxy(function () {
    return new MyHeavyService(/* expensive constructor */);
});

// The object is not actually created until a property is accessed or method is called
```

### Database Lazy Loading (Eloquent)

```php
<?php
// Lazy eager loading — eager load AFTER the fact
$users = User::all(); // no relations loaded

// Later, if you decide you need orders for all of them:
$users->load('orders'); // one query for all users' orders

// Lazy loading single model
$user = User::find(1);
$orders = $user->orders; // triggers query on first access, cached after
$orders = $user->orders; // returns cached — no second query
```

---

## 4. Asynchronous Processing

Move time-consuming work out of the HTTP request/response cycle so users get fast responses.

### What to Make Async

| Keep Synchronous | Make Async |
|-----------------|-----------|
| Payment result (user needs to know NOW) | Sending email receipts |
| Form validation | PDF/report generation |
| Loading the page | Analytics tracking |
| Authentication | Thumbnail resizing |
| Inventory check | Slack/webhook notifications |
| | Syncing with external services |

### Laravel Queues

```php
<?php
// Dispatch to queue — returns immediately
GenerateInvoicePdf::dispatch($order);  // runs in background
SendOrderEmail::dispatch($order)->delay(now()->addSeconds(5));
ResizeProductImage::dispatch($product)->onQueue('media');

// Process via artisan worker
// php artisan queue:work --queue=media,default

// Chained jobs — run sequentially
Bus::chain([
    new ProcessPayment($order),
    new UpdateInventory($order),
    new SendConfirmation($order),
])->dispatch();

// Job batching — parallel, then callback on completion
$batch = Bus::batch([
    new ProcessRow($chunk1),
    new ProcessRow($chunk2),
    new ProcessRow($chunk3),
])->then(fn(Batch $b) => markImportComplete($b->id))
  ->catch(fn(Batch $b, \Throwable $e) => logger()->error('Batch failed'))
  ->dispatch();
```

### PHP Async HTTP (Without Queues)

```php
<?php
// Guzzle concurrent requests — don't wait for each one
use GuzzleHttp\Client;
use GuzzleHttp\Pool;

$client  = new Client();
$requests = [
    $client->getAsync('https://api1.example.com/data'),
    $client->getAsync('https://api2.example.com/data'),
    $client->getAsync('https://api3.example.com/data'),
];

// All 3 requests run concurrently — total time = slowest one, not sum of all
$responses = \GuzzleHttp\Promise\Utils::unwrap($requests);
```

---

## 5. Batch Processing

Instead of processing records one at a time, process them in groups to reduce overhead.

```php
<?php
// BAD: One query per record — 10,000 records = 10,000 queries
foreach (User::all() as $user) {
    DB::table('emails')->insert(['user_id' => $user->id, 'sent_at' => now()]);
}

// GOOD: Chunked processing — load 100 at a time (memory efficient)
User::chunk(100, function ($users) {
    $records = $users->map(fn($u) => ['user_id' => $u->id, 'sent_at' => now()])->toArray();
    DB::table('emails')->insert($records); // one INSERT per chunk of 100
});

// Laravel: chunkById — safer for large tables (uses cursor pagination)
User::chunkById(500, function ($users) {
    foreach ($users as $user) {
        processUser($user);
    }
});

// Mass insert instead of loop inserts
$records = [];
foreach ($data as $item) {
    $records[] = [
        'user_id'    => $item['user_id'],
        'points'     => $item['points'],
        'created_at' => now(),
    ];
}
DB::table('user_points')->insert($records); // single query for all records

// Bulk update with CASE
DB::statement('
    UPDATE products SET stock = CASE id
        WHEN 1 THEN 50
        WHEN 2 THEN 30
        WHEN 3 THEN 75
    END
    WHERE id IN (1, 2, 3)
');

// Or use upsert
Product::upsert(
    [
        ['id' => 1, 'stock' => 50],
        ['id' => 2, 'stock' => 30],
    ],
    uniqueBy: ['id'],
    update: ['stock']
);
```

### Processing Large Datasets with Generators

```php
<?php
// Without generator — loads ALL records into memory
function getAllOrders(): array
{
    return Order::all()->toArray(); // 1M records = potential OOM
}

// With generator — one record at a time
function streamOrders(): \Generator
{
    $cursor = Order::cursor(); // uses PHP generator internally
    foreach ($cursor as $order) {
        yield $order;
    }
}

// Process 1 million orders with ~constant memory usage
foreach (streamOrders() as $order) {
    processOrder($order);
}

// Or use Eloquent cursor directly
Order::where('status', 'paid')->cursor()->each(function (Order $order) {
    processOrder($order);
});
```

---

## 6. Memory vs CPU Tradeoffs

Every optimization makes a trade-off between using more memory (to avoid re-computation) or more CPU (to avoid storing results).

### Memory-Efficient vs CPU-Efficient

```php
<?php
// Memory-efficient — compute on the fly (uses little memory, more CPU)
function sumLargeFile(string $file): float
{
    $total = 0;
    $handle = fopen($file, 'r');
    while (($line = fgets($handle)) !== false) {
        $total += (float) trim($line);
    }
    fclose($handle);
    return $total;
}

// CPU-efficient — load into memory first (fast processing, high memory)
function sumLargeFileFast(string $file): float
{
    $lines = file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    return array_sum(array_map('floatval', $lines));
}
```

### Memoization (Trade Memory for CPU)

```php
<?php
// Without memoization — same calculation repeated
function fibonacci(int $n): int
{
    if ($n <= 1) return $n;
    return fibonacci($n - 1) + fibonacci($n - 2); // O(2^n) time
}

// With memoization — cache results
function fibonacciMemo(int $n, array &$cache = []): int
{
    if ($n <= 1) return $n;
    if (isset($cache[$n])) return $cache[$n]; // O(1) memory lookup

    $cache[$n] = fibonacciMemo($n - 1, $cache) + fibonacciMemo($n - 2, $cache);
    return $cache[$n]; // O(n) time + O(n) memory
}

// Real-world: cache complex permission checks
class PermissionService
{
    private array $cache = [];

    public function can(User $user, string $permission): bool
    {
        $key = "{$user->id}:{$permission}";

        if (!array_key_exists($key, $this->cache)) {
            $this->cache[$key] = $this->computePermission($user, $permission);
        }

        return $this->cache[$key];
    }
}
```

### PHP Memory Management Tips

```php
<?php
// Unset large variables when no longer needed
$largeArray = loadMillionRecords();
processArray($largeArray);
unset($largeArray); // free memory immediately — don't wait for GC
gc_collect_cycles(); // force garbage collection if needed

// Use generators instead of large arrays
function getRecords(): \Generator
{
    // yields records one at a time — memory stays constant
    foreach (DB::table('orders')->cursor() as $order) {
        yield $order;
    }
}

// Check memory usage in long-running scripts
$threshold = 256 * 1024 * 1024; // 256MB
if (memory_get_usage(true) > $threshold) {
    logger()->warning('High memory usage detected');
}
```

### Database: Selecting Only What You Need

```php
<?php
// BAD — loads all columns including large TEXT/BLOB fields
$users = User::all(); // SELECT *

// GOOD — only what you need
$users = User::select('id', 'name', 'email')->get();
$names = User::pluck('name', 'id'); // ['id' => 'name', ...]

// Avoid loading models when you just need a count
// BAD:
$count = User::where('active', true)->get()->count(); // loads all models!
// GOOD:
$count = User::where('active', true)->count(); // SELECT COUNT(*)

// Avoid loading models for existence checks
// BAD:
$exists = User::where('email', $email)->first() !== null;
// GOOD:
$exists = User::where('email', $email)->exists(); // SELECT EXISTS(SELECT 1...)
```

---

## Interview Q&A

**Q: How do you identify performance bottlenecks in a PHP application?**
A: Start by measuring — use Laravel Telescope or Debugbar to find slow queries, query count, cache hit rates, and request times. Look for N+1 queries (high query count on list pages), missing database indexes (slow queries with full table scans via EXPLAIN), missing caching (repeated expensive queries), and blocking synchronous operations that could be queued.

**Q: What is caching and what are the main strategies?**
A: Caching stores expensive operation results for fast re-use. Main strategies: (1) Cache-aside — application checks cache, misses go to DB and populate cache; (2) TTL expiry — auto-expires after a set time; (3) Event-based invalidation — clear cache when data changes; (4) Cache tags — group related keys for bulk invalidation. Use Redis for high-performance caching.

**Q: What is the difference between lazy loading and eager loading?**
A: Eager loading fetches all related data upfront in one or a few queries — best when you know you'll need the data for all records. Lazy loading fetches relations on demand (when first accessed) — best when you may not need the relation for all records, avoiding unnecessary queries. N+1 is caused by lazy loading in loops without eager loading.

**Q: What is batch processing and when should you use it?**
A: Batch processing groups multiple records for a single operation instead of one-at-a-time. Use it for: bulk INSERT instead of loop inserts (dramatically faster), `chunk()` to process large tables without loading all records into memory, batch job dispatching, or bulk updates. It trades individual transaction granularity for throughput and memory efficiency.

**Q: What is the difference between memory optimization and CPU optimization?**
A: They often trade off against each other. Memoization and caching use more memory to avoid re-computation (less CPU). Streaming/generators use less memory but process data one item at a time (same or more CPU). Choose based on your bottleneck: if CPU is the constraint, use caching; if memory is the constraint, use generators and streaming.

**Q: When should you make an operation asynchronous?**
A: Make it async when: the user doesn't need the result immediately (email receipts, report generation, image resizing), it's slow enough to noticeably degrade response time (>100ms), it can fail and retry independently without affecting the main flow, or it's a side-effect that shouldn't block the primary response. Keep synchronous: payment results, validation, authentication, and anything the user needs to make their next decision.
