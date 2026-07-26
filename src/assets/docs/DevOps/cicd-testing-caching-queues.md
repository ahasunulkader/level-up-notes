# CI/CD, Automated Testing, Caching & Message Queues

## TL;DR
**CI/CD** automates the path from code push to production. **Testing strategies** (unit → integration → e2e) give confidence at each layer. **Caching** reduces latency and DB load by storing computed results. **Message queues** decouple services and absorb traffic spikes. In interviews: understand the *why* behind each tool and the trade-offs involved.

---

## Part 1: CI/CD Pipelines

## What CI/CD Solves

**Without CI/CD:**
```
Developer finishes feature → manually deploys → something breaks →
difficult to trace what changed → slow rollback → users affected
```

**With CI/CD:**
```
git push → automated tests → automated build → automated deploy
         └── failure blocks merge/deploy (fast feedback)
```

---

## CI — Continuous Integration

Every commit triggers an automated pipeline that **validates** the code.

```
git push origin feature/auth
        │
        ▼  (webhook)
  ┌─────────────────────────────────────────────┐
  │  CI Pipeline (GitHub Actions / GitLab CI)   │
  │                                             │
  │  1. Checkout code                           │
  │  2. Install dependencies (composer install) │
  │  3. Run linter (phpcs, ESLint)              │
  │  4. Run unit tests                          │
  │  5. Run integration tests                   │
  │  6. Build Docker image                      │
  │  7. Run security scan                       │
  └─────────────────────────────────────────────┘
        │                   │
        ▼ PASS              ▼ FAIL
  PR can merge          PR blocked, developer notified
```

### GitHub Actions Example
```yaml
# .github/workflows/ci.yml
name: CI Pipeline

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      mysql:
        image: mysql:8.0
        env:
          MYSQL_ROOT_PASSWORD: secret
          MYSQL_DATABASE: testdb
        options: --health-cmd="mysqladmin ping" --health-timeout=5s

    steps:
      - uses: actions/checkout@v4

      - name: Setup PHP
        uses: shivammathur/setup-php@v2
        with:
          php-version: '8.2'

      - name: Cache Composer dependencies
        uses: actions/cache@v3
        with:
          path: vendor
          key: composer-${{ hashFiles('composer.lock') }}

      - name: Install dependencies
        run: composer install --no-progress

      - name: Run linter
        run: ./vendor/bin/phpcs src/

      - name: Run tests
        run: ./vendor/bin/phpunit --coverage-min=80
        env:
          DB_HOST: 127.0.0.1

  build:
    needs: test   # only runs if test job passes
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build Docker image
        run: docker build -t myapp:${{ github.sha }} .
      - name: Push to registry
        run: docker push registry/myapp:${{ github.sha }}
```

---

## CD — Continuous Deployment

After CI passes, code is **automatically deployed** to an environment.

```
CI passes (tests green, image built)
        │
        ▼
  Deploy to Staging
        │
        ▼  (automated smoke tests / manual QA)
  Deploy to Production
        │
   ┌────┴────────────────┐
   │  Deployment Strategy│
   │  • Blue-Green       │
   │  • Rolling Update   │
   │  • Canary Release   │
   └────────────────────-┘
```

### Deployment Strategies

**Blue-Green:**
```
Blue (v1.0 - live):    [Server1] [Server2] [Server3]  ← traffic goes here
Green (v1.1 - ready):  [Server4] [Server5] [Server6]  ← deploy & test here

Switch: load balancer flips traffic to Green
Rollback: flip traffic back to Blue instantly
```

**Rolling Update:**
```
Start:   [v1][v1][v1][v1]
Step 1:  [v2][v1][v1][v1]  ← replace one at a time
Step 2:  [v2][v2][v1][v1]
Step 3:  [v2][v2][v2][v1]
Done:    [v2][v2][v2][v2]
```

**Canary Release:**
```
5% of users  → new version (v1.1)
95% of users → stable version (v1.0)

Monitor metrics → if stable, gradually increase to 100%
```

---

## Part 2: Automated Testing Strategies

## The Testing Pyramid

```
            /\
           /E2E\          ← few, slow, expensive, high confidence
          /──────\
         /Integra-\       ← moderate quantity, test component seams
        /  tion    \
       /────────────\
      /  Unit Tests  \    ← many, fast, cheap, test logic in isolation
     /────────────────\
```

**Rule of thumb:** Lots of unit tests, some integration tests, a handful of E2E tests.

---

## Unit Tests — Testing in Isolation

```php
// Unit test: test ONE method in isolation
// External dependencies (DB, HTTP) are MOCKED

class OrderServiceTest extends TestCase
{
    public function test_calculates_discount_for_vip_customer(): void
    {
        // Arrange
        $mockRepo = $this->createMock(OrderRepository::class);
        $service = new OrderService($mockRepo);
        $order = new Order(total: 1000, customerType: 'VIP');

        // Act
        $discount = $service->calculateDiscount($order);

        // Assert
        $this->assertEquals(150, $discount); // 15% VIP discount
    }
}
```

**Characteristics:**
- No database, no HTTP calls — fully mocked
- Run in milliseconds
- Test business logic, edge cases, error paths

---

## Integration Tests — Testing Component Seams

```php
// Integration test: tests how components work TOGETHER
// Uses a REAL database (test instance)

class UserRepositoryTest extends TestCase
{
    public function test_finds_user_by_email(): void
    {
        // Arrange: insert test data into real DB
        DB::table('users')->insert([
            'email' => 'test@example.com',
            'name' => 'Test User'
        ]);

        // Act
        $repo = new UserRepository();
        $user = $repo->findByEmail('test@example.com');

        // Assert
        $this->assertEquals('Test User', $user->name);
    }

    protected function tearDown(): void
    {
        DB::table('users')->truncate(); // clean up
    }
}
```

**Characteristics:**
- Tests DB queries, external service calls, cache interactions
- Slower than unit tests
- Catches mismatches between components

---

## E2E Tests — Testing the Full Flow

```javascript
// E2E test: simulates real user behavior in a real browser
// Uses Playwright, Cypress, or Selenium

test('user can complete checkout', async ({ page }) => {
    await page.goto('/products');
    await page.click('[data-id="product-123"]');
    await page.click('button.add-to-cart');
    await page.goto('/cart');
    await page.fill('#card-number', '4111111111111111');
    await page.click('button.checkout');

    await expect(page.locator('.order-confirmation')).toBeVisible();
});
```

**Characteristics:**
- Tests the whole system end-to-end including UI
- Slowest, most brittle (UI changes break tests)
- Highest confidence — proves the user journey works

---

## Contract Testing

When services communicate via API, contract tests verify the **interface** between them:

```
Service A (consumer) expects:
  GET /users/1 → { id: 1, name: "Alice", email: "..." }

Service B (provider) must fulfill that contract.

Pact / Spring Cloud Contract enforce this without requiring
both services to run simultaneously.
```

---

## Test Doubles Cheat Sheet

| Type | What It Does | When to Use |
|---|---|---|
| **Mock** | Verifies interactions were made | Confirm a method was called with certain args |
| **Stub** | Returns pre-defined values | Control what a dependency returns |
| **Fake** | Working implementation (e.g., in-memory DB) | Faster alternative to real dependency |
| **Spy** | Wraps real object, records calls | When you need real behavior + call verification |

---

## Test Coverage

```
Coverage = (lines executed during tests / total lines) × 100%

80% coverage = reasonable target for business logic
100% coverage ≠ bug-free (you can cover a line without testing all cases)
```

**Don't chase 100% blindly** — test behavior, not implementation.

---

## Part 3: Caching Strategies

## Why Cache?

```
Without cache:
  User request → App → Database query (50ms) → Response

With cache:
  User request → App → Cache HIT (0.1ms)  → Response
                     → Cache MISS → Database (50ms) → Store in cache → Response

500× speed improvement on cache hit
```

---

## Cache Layers

```
Browser Cache
    ▼ miss
CDN / Edge Cache (CloudFront, Cloudflare)
    ▼ miss
Application Cache (Redis, Memcached)
    ▼ miss
Database Query Cache
    ▼ miss
Database (source of truth)
```

---

## Caching Strategies (The Big 4)

### 1. Cache-Aside (Lazy Loading) — Most Common
```
Read flow:
  1. App checks cache
  2. Cache HIT → return data
  3. Cache MISS → query DB → store in cache → return data

Write flow:
  1. Write to DB
  2. Invalidate (delete) cache entry

Pros: Only caches what's actually used
Cons: First request always slow (cold cache); stale data possible
```

```php
function getUser(int $id): User
{
    $key = "user:{$id}";
    $cached = Redis::get($key);

    if ($cached) {
        return unserialize($cached);
    }

    $user = User::find($id);            // DB hit
    Redis::setex($key, 3600, serialize($user)); // cache 1 hour

    return $user;
}
```

### 2. Write-Through — Cache Always Current
```
Write flow:
  1. Write to cache
  2. Write to DB (synchronously)

Read flow:
  1. Always hits cache (no misses after first write)

Pros: Cache is always fresh
Cons: Write latency doubles; cache fills with data that may never be read
```

### 3. Write-Behind (Write-Back) — Fast Writes
```
Write flow:
  1. Write to cache immediately (return to user)
  2. Asynchronously flush to DB later

Pros: Very fast writes
Cons: Risk of data loss if cache crashes before flush
     Complexity of async sync
```

### 4. Read-Through — Cache as Primary
```
App only talks to cache.
Cache fetches from DB on miss automatically.

Pros: Simpler app code
Cons: Complex cache layer; first access always slow
```

---

## Cache Invalidation Strategies

**The two hardest problems in CS: naming things and cache invalidation.**

| Strategy | How | When |
|---|---|---|
| **TTL (Time-to-Live)** | Cache expires after N seconds | Acceptable staleness (e.g., product listings, 5 min) |
| **Event-based** | Delete cache when data changes | User profile updated → invalidate `user:{id}` |
| **Cache versioning** | Include version in key: `user:v2:{id}` | Schema changes, invalidate all with new deploy |

---

## Redis — The Go-To Cache

```bash
# Key-value
SET user:1 "{name: Alice}"   EX 3600   # set with 1hr TTL
GET user:1
DEL user:1

# Counter (atomic, no race conditions)
INCR page:views:home        # increment atomically

# List (queue / recent items)
LPUSH recent:items item1    # push to head
LRANGE recent:items 0 9     # get 10 most recent

# Set (unique values, no duplicates)
SADD online:users user123
SMEMBERS online:users

# Sorted Set (leaderboards)
ZADD leaderboard 1500 "alice"
ZRANGE leaderboard 0 9 REV WITHSCORES  # top 10

# Hash (object fields)
HSET user:1 name "Alice" age 30
HGET user:1 name
```

**Redis use cases:** Sessions, caching, rate limiting, pub/sub, job queues, leaderboards.

---

## CDN Caching

```
User in Bangkok           CDN Edge (Singapore)       Origin Server (US)
      │                          │                           │
      ├── GET /logo.png ─────────►                           │
      │                   Cache HIT                         │
      │◄── logo.png (5ms) ────────┤                          │
      │                          │                           │
      ├── GET /app.js ────────────►                          │
      │                   Cache MISS                        │
      │                          ├── GET /app.js ────────────►
      │                          │◄── app.js (200ms) ────────┤
      │◄── app.js (205ms) ────────┤   (cached at edge now)   │
```

**Cache-Control headers:**
```
Cache-Control: public, max-age=31536000  # cache 1 year (static assets with hash)
Cache-Control: no-cache                  # always revalidate
Cache-Control: private, max-age=300      # user-specific, 5 min
```

---

## Part 4: Message Queues

## Why Message Queues?

**Problem: Tight coupling and load spikes**
```
Without queue (synchronous):
  User uploads image → App directly calls image processor
  If processor is slow → User waits
  If processor crashes → Upload fails
  Traffic spike → Everything crashes together

With queue (asynchronous):
  User uploads image → App drops job in queue → "Upload successful!"
  Processor picks jobs from queue at its own pace
  If processor is slow → Queue fills, user not affected
  If processor crashes → Jobs stay in queue, retry when it recovers
```

---

## Queue Concepts

```
Producer          Queue              Consumer
   │                │                   │
   ├── publish ─────►                   │
   │     job 1      ├── deliver ────────►
   │     job 2      ├── deliver ────────►
   │     job 3      │   (one at a time)  │
   │                │◄── acknowledge ────┤
   │                │   (remove from Q)  │
```

**Key guarantee:** Message stays in queue until consumer **acknowledges** it. If consumer crashes, message is redelivered.

---

## RabbitMQ — Traditional Message Broker

```
Publisher → Exchange → Queue → Consumer

Exchange types:
  Direct:  route by exact routing key
  Topic:   route by pattern (order.*, *.email)
  Fanout:  broadcast to ALL bound queues
  Headers: route by message headers
```

```php
// Producer (Laravel example using RabbitMQ)
dispatch(new ProcessImageJob($imageId));

// Consumer (queue worker)
class ProcessImageJob implements ShouldQueue
{
    public function handle(): void
    {
        // resize, watermark, store...
    }

    public function failed(Throwable $e): void
    {
        // handle permanent failure (dead letter queue)
    }
}
```

**RabbitMQ use cases:** Task queues, email sending, notifications, order processing.

---

## Kafka — Distributed Event Streaming

```
Producers → Topic (partitioned log) → Consumers (consumer groups)

Topic: "orders"
  Partition 0: [order1, order4, order7...]
  Partition 1: [order2, order5, order8...]
  Partition 2: [order3, order6, order9...]

Consumer Group A (billing service): reads all partitions
Consumer Group B (inventory service): reads all partitions independently
```

**RabbitMQ vs Kafka:**

| Aspect | RabbitMQ | Kafka |
|---|---|---|
| **Model** | Queue (messages deleted after ack) | Log (messages retained, replayable) |
| **Throughput** | Thousands/sec | Millions/sec |
| **Message replay** | No | Yes (replay from any offset) |
| **Use case** | Task queues, RPC | Event streaming, audit logs, analytics |
| **Complexity** | Simpler | More complex |

**When to use Kafka:** High-throughput events, audit trails, multiple consumers need same events, event sourcing.

**When to use RabbitMQ:** Task queues, when you need routing flexibility, simpler setup.

---

## Common Queue Patterns

### Dead Letter Queue (DLQ)
```
Main Queue → Consumer fails (3 retries) → Dead Letter Queue
                                                │
                                         Alert sent to team
                                         Inspect & manually retry
```

### Fan-Out Pattern
```
Order Placed event
       │
   Message Bus
  ┌────┼────┐
  ▼    ▼    ▼
Email Inven- Analy-
      tory   tics
```

### Competing Consumers (Scale Out)
```
Queue ──────────────────────────────►
  │        │         │         │
Worker1  Worker2  Worker3  Worker4
(each worker processes different messages in parallel)
```

---

## Interview Q&A — Ready Answers

**Q: What's the difference between unit and integration tests?**
> "Unit tests test a single class or method in complete isolation — all dependencies are mocked. They're fast, cheap, and test business logic. Integration tests test how components work together — they use a real database or real HTTP calls. They're slower but catch issues that mocking hides, like incorrect SQL queries."

**Q: What is CI/CD and why does it matter?**
> "CI means every push triggers automated tests — the pipeline validates code before it can merge. CD means after CI passes, code is automatically deployed. Together they reduce manual errors in deployment, give fast feedback on broken code, and let teams ship multiple times a day safely."

**Q: When would you use a cache and what strategy?**
> "I'd cache when the same data is read frequently and doesn't change often — like product listings, user profiles, or config. Cache-aside is my default: check cache, if miss hit the DB and populate cache. TTL handles expiry for acceptable staleness. For data that changes and must be fresh, I invalidate the cache on write."

**Q: What is a message queue and when would you use one?**
> "A queue decouples the part of your system that creates work from the part that processes it. I'd use one for anything that doesn't need to block the user: sending emails, processing images, generating reports, calling slow external APIs. The user gets an immediate response and the work happens in the background. It also adds resilience — if the worker crashes, jobs stay in the queue."

**Q: What's the difference between Redis and a message queue like RabbitMQ?**
> "Redis is primarily a cache and data structure store that can be used as a simple queue. RabbitMQ is purpose-built for message brokering — it has routing rules, exchange types, dead letter queues, acknowledgments, and retry logic built in. For serious job processing I'd use a proper queue. Redis queues are fine for simple use cases where you don't need those guarantees."

**Q: How would you implement rate limiting with Redis?**
> "Use Redis's atomic INCR with a TTL. On each request: INCR the key `ratelimit:user:{id}`, if it's 1 (first request) set TTL of 60 seconds. If the count exceeds the limit (e.g., 100), return 429. This works because INCR is atomic — no race conditions."

---

## Key Vocabulary

- **Idempotent** — operation can be repeated without different effect; important for retry logic
- **At-least-once delivery** — message delivered one or more times (duplicates possible)
- **At-most-once delivery** — message delivered zero or one times (may be lost)
- **Exactly-once delivery** — hardest guarantee; usually requires distributed transactions
- **Cache hit ratio** — percentage of requests served from cache; higher = better
- **Cache stampede** — many simultaneous cache misses hitting the DB; prevent with locks or probabilistic early expiry
- **Event sourcing** — store events instead of current state; Kafka excels here
- **CQRS** — Command Query Responsibility Segregation; separate read/write models, often with queues between them
