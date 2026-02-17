# System Design Basics

System Design interviews test how you think about building **large-scale, reliable applications**. Even for mid-level roles, you're expected to know the fundamentals.

> **Interview Tip:** System design is about **tradeoffs**. There's no single right answer. Show your thinking process.

---

## Core Concepts

### 1. Stateless vs Stateful Systems

#### Stateful System

The server **remembers** information about the client between requests.

```php
// Stateful — server stores session data
session_start();
$_SESSION['user_id'] = 42;
$_SESSION['cart'] = ['item1', 'item2'];

// Problem: If this server goes down, the session is LOST
// Problem: User must always hit the SAME server
```

#### Stateless System

The server **does NOT** remember anything. Every request contains all necessary information.

```php
// Stateless — token contains all info
// Client sends JWT token with every request

$token = "eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyX2lkIjo0Mn0.xxx";

// Server decodes token — no session storage needed
$payload = json_decode(base64_decode(explode('.', $token)[1]));
$userId = $payload->user_id; // 42

// Benefits:
// - Any server can handle ANY request
// - Easy to scale horizontally
// - No session storage needed
```

#### Comparison

| Aspect | Stateful | Stateless |
|---|---|---|
| **Server Memory** | Stores client state | No client state |
| **Scaling** | Hard (sticky sessions) | Easy (any server works) |
| **Reliability** | Server crash = lost state | Server crash = no data loss |
| **Example** | PHP Sessions, WebSockets | REST APIs, JWT Auth |
| **Use When** | Real-time apps, gaming | Web APIs, microservices |

#### Making PHP Stateless

```php
// Instead of PHP sessions, use external session store
// Laravel example — store sessions in Redis/Database

// config/session.php
'driver' => env('SESSION_DRIVER', 'redis'), // Not 'file'!

// Now sessions are in Redis — any server can read them
// This makes the APPLICATION server stateless
// (state is in Redis, not on the app server)
```

---

### 2. Scalability vs Performance

These are **NOT the same thing!**

- **Performance** = How fast ONE request is handled
- **Scalability** = How well the system handles GROWING load

```
Performance: "This API responds in 50ms"
Scalability: "This API handles 10,000 requests/second across 5 servers"
```

#### Performance Optimization (PHP Examples)

```php
// 1. Optimize database queries
// Bad — N+1 problem
$users = User::all();
foreach ($users as $user) {
    echo $user->department->name; // Queries department EACH loop!
}
// Total: 1 query + N queries = 101 queries for 100 users!

// Good — Eager loading
$users = User::with('department')->get();
foreach ($users as $user) {
    echo $user->department->name; // Already loaded!
}
// Total: 2 queries (1 for users, 1 for departments)

// 2. Use indexing
// Add index on frequently queried columns
Schema::table('users', function (Blueprint $table) {
    $table->index('email');        // Single column index
    $table->index(['status', 'created_at']); // Composite index
});

// 3. Cache expensive operations
$topProducts = Cache::remember('top_products', 3600, function () {
    return Product::withCount('orders')
        ->orderByDesc('orders_count')
        ->limit(10)
        ->get();
});
```

#### Scalability Solutions

```
Low Traffic (1 server):
  [Client] → [App Server + Database]

Medium Traffic (Vertical Scaling):
  [Client] → [Bigger Server + Bigger Database]

High Traffic (Horizontal Scaling):
  [Client] → [Load Balancer] → [Server 1]
                              → [Server 2]  → [Database Cluster]
                              → [Server 3]
```

---

### 3. Vertical vs Horizontal Scaling

#### Vertical Scaling (Scale UP)

> Add more power to **ONE** machine — more CPU, RAM, faster SSD.

```
Before: 2 CPU, 4GB RAM
After:  16 CPU, 64GB RAM

Like upgrading from a bicycle to a motorcycle.
```

- **Pros:** Simple, no code changes needed
- **Cons:** Hardware limits, single point of failure, expensive
- **When:** Small-to-medium apps, databases (initially)

#### Horizontal Scaling (Scale OUT)

> Add **MORE** machines and distribute the load.

```
Before: 1 server handling everything
After:  5 servers sharing the load

Like having 5 bicycles instead of 1 motorcycle.
```

- **Pros:** No hardware limit, fault tolerant, cost effective
- **Cons:** Complexity (state management, data consistency)
- **When:** Large-scale apps, APIs, microservices

#### PHP Horizontal Scaling Checklist

```php
// To scale PHP horizontally, ensure:

// 1. Stateless application (use external session store)
'session.driver' => 'redis',

// 2. Shared file storage (not local disk)
'filesystems.default' => 's3',

// 3. Centralized cache
'cache.default' => 'redis',

// 4. Database connection pooling
// Use tools like PgBouncer or ProxySQL

// 5. Queue workers on separate servers
// Laravel: php artisan queue:work --queue=high,default
```

---

### 4. Load Balancing Basics

> Distributes incoming traffic across multiple servers so no single server gets overwhelmed.

```
Without Load Balancer:
  [All Traffic] → [Server 1] 😰 (overloaded!)

With Load Balancer:
  [All Traffic] → [Load Balancer] → [Server 1] 😊
                                  → [Server 2] 😊
                                  → [Server 3] 😊
```

#### Load Balancing Algorithms

| Algorithm | How It Works | Best For |
|---|---|---|
| **Round Robin** | Sends requests in order: 1, 2, 3, 1, 2, 3... | Equal-capacity servers |
| **Least Connections** | Sends to server with fewest active connections | Varying request times |
| **IP Hash** | Same client IP always goes to same server | Session affinity |
| **Weighted Round Robin** | Stronger servers get more traffic | Mixed-capacity servers |

#### Example: Nginx Load Balancer Config

```nginx
# nginx.conf
upstream php_servers {
    # Round Robin (default)
    server 192.168.1.10:9000;
    server 192.168.1.11:9000;
    server 192.168.1.12:9000;

    # Or Weighted
    # server 192.168.1.10:9000 weight=3;  # Gets 3x traffic
    # server 192.168.1.11:9000 weight=1;

    # Or Least Connections
    # least_conn;
}

server {
    listen 80;

    location / {
        proxy_pass http://php_servers;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

#### Health Checks

```nginx
upstream php_servers {
    server 192.168.1.10:9000 max_fails=3 fail_timeout=30s;
    server 192.168.1.11:9000 max_fails=3 fail_timeout=30s;
    server 192.168.1.12:9000 backup; # Only used when others are down
}
```

---

### 5. Caching Strategies

> Store frequently accessed data in a **fast storage layer** to avoid hitting the slow database repeatedly.

```
Without Cache:
  [Client] → [App] → [Database] (100ms) ❌ Slow!

With Cache:
  [Client] → [App] → [Cache] (1ms) ✅ Fast!
                   ↘ [Database] (only on cache miss)
```

#### Cache Strategies

##### A. Cache-Aside (Lazy Loading)

Application manages the cache manually. Most common strategy.

```php
class ProductService
{
    public function __construct(
        private CacheInterface $cache,
        private ProductRepository $repo
    ) {}

    public function getProduct(int $id): ?array
    {
        $key = "product:$id";

        // 1. Check cache first
        $product = $this->cache->get($key);

        if ($product === null) {
            // 2. Cache miss — query database
            $product = $this->repo->findById($id);

            if ($product) {
                // 3. Store in cache for next time
                $this->cache->set($key, $product, ttl: 3600);
            }
        }

        return $product;
    }

    public function updateProduct(int $id, array $data): void
    {
        $this->repo->update($id, $data);

        // Invalidate cache — next read will refresh
        $this->cache->delete("product:$id");
    }
}
```

##### B. Write-Through

Data is written to cache AND database at the same time.

```php
class WriteThoughProductService
{
    public function updateProduct(int $id, array $data): void
    {
        // Write to database
        $this->repo->update($id, $data);

        // Immediately update cache too
        $product = $this->repo->findById($id);
        $this->cache->set("product:$id", $product, ttl: 3600);
    }
}
// Pro: Cache is always up-to-date
// Con: Slower writes (two operations)
```

##### C. Write-Behind (Write-Back)

Write to cache first, then asynchronously write to database later.

```php
class WriteBehindProductService
{
    public function updateProduct(int $id, array $data): void
    {
        // Write to cache immediately (fast!)
        $this->cache->set("product:$id", $data, ttl: 3600);

        // Queue database write for later
        dispatch(new SyncProductToDatabase($id, $data));
    }
}
// Pro: Very fast writes
// Con: Risk of data loss if cache crashes before DB sync
```

#### Laravel Caching

```php
// Cache-Aside with Laravel
$product = Cache::remember("product:$id", 3600, function () use ($id) {
    return Product::find($id);
});

// Cache tags (Redis only)
Cache::tags(['products'])->put("product:$id", $product, 3600);
Cache::tags(['products'])->flush(); // Clear all product cache

// Cache invalidation on model update
class Product extends Model
{
    protected static function booted(): void
    {
        static::updated(function (Product $product) {
            Cache::forget("product:{$product->id}");
        });
    }
}
```

#### Cache Strategy Comparison

| Strategy | Read Speed | Write Speed | Consistency | Use Case |
|---|---|---|---|---|
| **Cache-Aside** | Fast (after first read) | Normal | Eventually consistent | Most applications |
| **Write-Through** | Always fast | Slower | Strong | Financial data |
| **Write-Behind** | Always fast | Very fast | Weak | High-write analytics |

---

### 6. Pagination

> Loading ALL records at once is **slow and memory-intensive**. Pagination loads data in small chunks.

#### Types of Pagination

##### A. Offset-Based Pagination (Simple)

```php
// Page 1: OFFSET 0, LIMIT 20
// Page 2: OFFSET 20, LIMIT 20
// Page 3: OFFSET 40, LIMIT 20

class ProductController
{
    public function index(Request $request): JsonResponse
    {
        $page = $request->get('page', 1);
        $perPage = $request->get('per_page', 20);

        $products = Product::query()
            ->orderBy('created_at', 'desc')
            ->paginate($perPage);

        return response()->json([
            'data' => $products->items(),
            'meta' => [
                'current_page' => $products->currentPage(),
                'per_page' => $products->perPage(),
                'total' => $products->total(),
                'last_page' => $products->lastPage(),
            ],
        ]);
    }
}

// Problem with offset:
// Page 10000: OFFSET 200000, LIMIT 20
// Database must scan 200,000 rows to skip them! Very slow!
```

##### B. Cursor-Based Pagination (Scalable)

```php
// Instead of page numbers, use a cursor (last seen ID)
// "Give me 20 items AFTER this ID"

class ProductController
{
    public function index(Request $request): JsonResponse
    {
        $products = Product::query()
            ->orderBy('id', 'desc')
            ->cursorPaginate(20);

        return response()->json([
            'data' => $products->items(),
            'next_cursor' => $products->nextCursor()?->encode(),
            'prev_cursor' => $products->previousCursor()?->encode(),
            'has_more' => $products->hasMorePages(),
        ]);
    }
}

// SQL: SELECT * FROM products WHERE id < :cursor ORDER BY id DESC LIMIT 20
// Uses index! Fast even for millions of records!
```

#### When to Use What

| Offset Pagination | Cursor Pagination |
|---|---|
| Need to jump to specific page | Sequential browsing only |
| Small datasets (< 100k rows) | Large datasets (millions) |
| Need total count | No total count needed |
| Admin dashboards | Social feeds, infinite scroll |
| `?page=5&per_page=20` | `?cursor=eyJpZCI6MTAwfQ` |

---

### 7. Rate Limiting

> Controls how many requests a user can make in a given time period. Prevents abuse and protects server resources.

#### Why Rate Limit?

- **Prevent abuse** — stop brute force attacks
- **Fair usage** — one user can't hog all resources
- **Protect infrastructure** — prevent server overload
- **API billing** — limit free tier users

#### PHP/Laravel Implementation

```php
// Laravel Rate Limiting in RouteServiceProvider
RateLimiter::for('api', function (Request $request) {
    return Limit::perMinute(60)->by($request->user()?->id ?: $request->ip());
});

// Different limits for different endpoints
RateLimiter::for('login', function (Request $request) {
    return Limit::perMinute(5)->by($request->ip()); // 5 login attempts/min
});

RateLimiter::for('uploads', function (Request $request) {
    return [
        Limit::perMinute(10)->by($request->user()->id),  // 10 uploads/min
        Limit::perDay(100)->by($request->user()->id),     // 100 uploads/day
    ];
});

// Apply to routes
Route::middleware('throttle:api')->group(function () {
    Route::get('/products', [ProductController::class, 'index']);
});

Route::middleware('throttle:login')->post('/login', [AuthController::class, 'login']);
```

#### Rate Limit Response Headers

```
HTTP/1.1 200 OK
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1708300800

HTTP/1.1 429 Too Many Requests
Retry-After: 30
{
    "message": "Too many requests. Please try again in 30 seconds."
}
```

#### Rate Limiting Algorithms

| Algorithm | How It Works | Use Case |
|---|---|---|
| **Fixed Window** | Count requests per time window (e.g., 100/min) | Simple API limits |
| **Sliding Window** | Rolling window for smoother limits | More accurate limiting |
| **Token Bucket** | Tokens refill over time; each request uses a token | Bursty traffic allowed |
| **Leaky Bucket** | Requests processed at fixed rate; overflow rejected | Smooth output rate |

---

## Design Discussion Skills

These are the soft skills that matter in system design interviews.

### 1. Clarifying Requirements

> **Never jump into designing.** Always ask questions first.

```
Interviewer: "Design a URL shortener."

GOOD response:
"Before I start, let me clarify some requirements:"
- What's the expected traffic? (100 URLs/day vs 1M URLs/day)
- How long should shortened URLs be valid?
- Do we need analytics (click tracking)?
- Should users be authenticated or anonymous?
- What's the acceptable latency for redirection?
- Do we need custom aliases (e.g., short.ly/my-brand)?

BAD response:
"OK, so we'll use a MySQL database with a table..."
```

### 2. Stating Assumptions

> When you can't get a clear answer, **state your assumptions** explicitly.

```
"I'm going to assume:
- 10M URLs created per month
- 100:1 read-to-write ratio (1B redirects/month)
- URLs expire after 5 years
- We need 99.9% uptime
- Latency for redirection should be < 100ms

Let me know if any of these assumptions are off."
```

### 3. Iterating Design

> Start simple, then **add complexity** based on requirements.

```
Version 1 (MVP):
  [Client] → [PHP App] → [MySQL]
  - Single server
  - Simple table: id, original_url, short_code
  - Works for 1K requests/day

Version 2 (Growing):
  [Client] → [Load Balancer] → [PHP App x3] → [MySQL + Read Replicas]
  - Add Redis cache for hot URLs
  - Separate read/write databases
  - Works for 100K requests/day

Version 3 (Scale):
  [Client] → [CDN] → [Load Balancer] → [PHP App x10]
  - Redis cluster for caching
  - Database sharding by hash
  - Message queue for analytics
  - Works for 10M+ requests/day
```

### 4. Discussing Tradeoffs

> Every decision has tradeoffs. Show that you understand them.

```
"For the URL storage, we have two options:

Option A: Auto-increment ID → Base62 encode
  ✅ Simple, guaranteed unique
  ❌ Predictable (users can guess URLs)
  ❌ Single point of failure (one DB generates IDs)

Option B: Random hash (first 7 chars of MD5)
  ✅ Not predictable
  ✅ Can generate on any server
  ❌ Collision possible (need collision handling)
  ❌ Slightly longer generation time

I'd go with Option B because we need horizontal scaling,
and the collision rate with 7 characters is < 0.001% for 1B URLs."
```

---

## System Design Cheat Sheet for PHP Developers

| Concept | What to Know | PHP/Laravel Tool |
|---|---|---|
| **Stateless** | Store session externally | Redis/Database sessions |
| **Caching** | Cache expensive queries | `Cache::remember()`, Redis |
| **Queues** | Offload slow tasks | Laravel Queue, RabbitMQ |
| **Load Balancing** | Distribute traffic | Nginx, AWS ALB |
| **Pagination** | Don't load all records | `->paginate()`, `->cursorPaginate()` |
| **Rate Limiting** | Prevent abuse | `RateLimiter::for()`, Throttle middleware |
| **Database** | Optimize queries | Indexing, Eager Loading, Read Replicas |

---

## Common Interview Questions

1. **Stateless vs Stateful — which should APIs be?**
   → **Stateless.** Every request should contain all info needed (via JWT or API keys). This enables horizontal scaling.

2. **When to use caching?**
   → Frequently read data that doesn't change often. Product listings, user profiles, configuration. NOT for frequently changing data or critical financial calculations.

3. **Vertical vs Horizontal scaling — when to use each?**
   → Start vertical (cheaper, simpler). Switch to horizontal when you hit hardware limits or need fault tolerance. Most PHP apps start vertical and move horizontal at scale.

4. **How would you handle 1M requests/second?**
   → CDN for static content, Load balancer, Multiple app servers (stateless), Redis cache, Database read replicas, Queue for non-critical work, Rate limiting.

5. **What are the tradeoffs of caching?**
   → **Pros:** Faster reads, reduced DB load. **Cons:** Stale data risk, cache invalidation complexity, memory cost. "There are only two hard things in CS: cache invalidation and naming things."
