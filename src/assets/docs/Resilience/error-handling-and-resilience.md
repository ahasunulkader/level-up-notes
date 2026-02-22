# Error Handling & Resilience

Resilience is the ability of a system to **handle failure gracefully** — to detect problems, recover automatically, and continue serving users even when parts of the system fail. Without resilience, a single failing database or third-party API can cascade into a full system outage.

This doc covers the key patterns: fail fast, graceful degradation, retries, idempotency, circuit breakers, timeouts, and partial failure handling.

---

## Why Resilience Matters

In a simple application, errors crash the page and the user refreshes. In a distributed system (microservices, queues, external APIs), failures are **inevitable** — networks drop, services overload, databases lock up.

The question is not *will* something fail, but *how gracefully* can your system respond?

---

## Fail Fast vs. Graceful Degradation

These are two opposite but complementary strategies. Knowing when to apply each is key.

### Fail Fast

**Stop immediately when something is wrong.** Don't continue processing with invalid state.

**Why it exists:** Failing early makes bugs easier to find. The sooner you detect an error, the less cascading damage occurs.

```php
// BAD — fail late: proceeds with invalid data
function processOrder(array $data): void {
    $order = createOrder($data); // might be null
    $order->save();              // crashes here with "Call to member on null"
    chargePayment($order);       // never reached — but payment logic is tangled
}

// GOOD — fail fast: validate at the boundary
function processOrder(array $data): void {
    if (empty($data['user_id']) || empty($data['items'])) {
        throw new \InvalidArgumentException('Missing required order fields');
    }

    $order = createOrder($data);

    if ($order === null) {
        throw new \RuntimeException('Order creation failed unexpectedly');
    }

    $order->save();
    chargePayment($order);
}
```

**Real-life use case:** A payment processor that validates card number format, expiry, and CVV before even calling the bank API — it fails fast rather than sending incomplete data.

**Benefits:**
- Bugs surface immediately at their source
- Stack traces point to the actual problem
- No corrupted partial state
- Forces explicit contracts (what is valid input?)

**Disadvantages:**
- Too aggressive fail-fast can make a system brittle
- Users see errors for edge cases that could be handled softly

---

### Graceful Degradation

**When something fails, degrade functionality instead of crashing everything.**

**Why it exists:** Not all parts of a system are equally critical. If a recommendation engine fails, the core product should still work.

```php
class ProductController extends Controller {
    public function show(Product $product): View {
        // Core functionality — must work
        $details = $product->load(['images', 'category']);

        // Non-critical — degrade gracefully if it fails
        $recommendations = [];
        try {
            $recommendations = $this->recommendationService->getSimilar($product->id);
        } catch (\Exception $e) {
            // Log it, but don't crash the page
            Log::warning('Recommendation service failed', [
                'product_id' => $product->id,
                'error' => $e->getMessage()
            ]);
        }

        return view('products.show', compact('details', 'recommendations'));
    }
}
```

**Real-life use case:** Netflix still shows movies even if the personalized recommendation engine is down — it just shows generic popular titles instead.

**Benefits:**
- Core functionality survives partial failures
- Better user experience than a blank error page
- Allows non-critical services to fail independently

**Disadvantages:**
- Partial data can be confusing to users
- Silent failures may go unnoticed without proper logging
- More complex code paths to test

---

### When to Use Which

| Scenario | Strategy |
|---|---|
| Invalid user input | Fail fast (return validation error) |
| Critical dependency (database write) | Fail fast (rollback, surface error) |
| Non-critical dependency (recommendation, analytics) | Graceful degradation |
| Third-party API for core flow | Fail fast (can't proceed without it) |
| Third-party API for enrichment | Degrade gracefully (show without enrichment) |

---

## Retry Strategies

When a transient failure occurs (network blip, brief service overload), **retrying the operation** often resolves it. But naive retries can make things worse.

### Why Retries Exist

Transient errors are common in distributed systems. A 503 from an external API might resolve in 200ms. Giving up immediately loses a request that would have succeeded.

### Simple Retry

```php
function callExternalApi(string $url): array {
    $maxAttempts = 3;
    $attempt = 0;

    while ($attempt < $maxAttempts) {
        try {
            $response = Http::get($url);

            if ($response->successful()) {
                return $response->json();
            }

            // Don't retry client errors (4xx) — they won't fix themselves
            if ($response->clientError()) {
                throw new \RuntimeException('Client error: ' . $response->status());
            }

        } catch (\Exception $e) {
            $attempt++;
            if ($attempt >= $maxAttempts) {
                throw $e; // Give up after max attempts
            }
            sleep(1); // Wait before retrying
        }

        $attempt++;
    }

    throw new \RuntimeException('API call failed after ' . $maxAttempts . ' attempts');
}
```

### Exponential Backoff

Spacing out retries exponentially **reduces pressure on an already struggling service**.

**Why it exists:** If 1,000 clients all retry at the same time (thundering herd), they can overwhelm a recovering service. Backoff spreads the load.

```php
function retryWithBackoff(callable $operation, int $maxAttempts = 4): mixed {
    $attempt = 0;

    while (true) {
        try {
            return $operation();
        } catch (\Exception $e) {
            $attempt++;

            if ($attempt >= $maxAttempts) {
                throw $e;
            }

            // Exponential: 1s, 2s, 4s, 8s...
            $delay = (2 ** $attempt) * 1000; // milliseconds

            // Add jitter to avoid thundering herd
            // Multiple clients won't all retry at exactly the same moment
            $jitter = random_int(0, 500);
            $totalDelay = $delay + $jitter;

            Log::info("Retry attempt {$attempt}, waiting {$totalDelay}ms");
            usleep($totalDelay * 1000); // usleep takes microseconds
        }
    }
}

// Usage
$result = retryWithBackoff(fn() => Http::get('https://api.example.com/data')->json());
```

### What to Retry vs. What Not to Retry

| Operation | Retry? | Why |
|---|---|---|
| Network timeout | Yes | Transient |
| 503 Service Unavailable | Yes | Transient overload |
| 429 Too Many Requests | Yes, with delay | Rate limit — wait |
| 500 Server Error | Carefully | Might be idempotent |
| 400 Bad Request | No | Your data is wrong |
| 401 Unauthorized | No | Auth error won't fix itself |
| Database connection timeout | Yes | Transient |
| Constraint violation | No | Data issue |

### Laravel Built-in Retry

```php
// HTTP client with retries
$response = Http::retry(3, 100)->get('https://api.example.com/data');
//                    ^   ^
//                    |   delay in ms
//                    max attempts

// Queue job retries
class ProcessPayment implements ShouldQueue {
    public $tries = 5;
    public $backoff = [1, 5, 10, 30, 60]; // seconds between retries
}
```

**Benefits of retries:**
- Handles transient failures automatically
- Improves reliability without manual intervention

**Disadvantages:**
- Increases latency for failing requests
- Can amplify load on struggling services (without backoff + jitter)
- Non-idempotent operations can cause duplicate side effects

---

## Idempotent Operations

An operation is **idempotent** if running it multiple times produces the same result as running it once.

**Why it exists:** Retries are only safe if the underlying operation is idempotent. If charging a user is not idempotent, retrying on failure could charge them twice.

```php
// NOT idempotent — calling twice creates two charges
function chargeUser(int $userId, float $amount): void {
    DB::table('charges')->insert([
        'user_id' => $userId,
        'amount' => $amount,
        'created_at' => now(),
    ]);
    $this->paymentGateway->charge($userId, $amount);
}

// IDEMPOTENT — uses an idempotency key
function chargeUser(int $userId, float $amount, string $idempotencyKey): void {
    // Check if this exact operation already ran
    $existing = DB::table('charges')
        ->where('idempotency_key', $idempotencyKey)
        ->first();

    if ($existing) {
        Log::info("Duplicate charge attempt blocked", ['key' => $idempotencyKey]);
        return; // Already processed — do nothing
    }

    DB::transaction(function () use ($userId, $amount, $idempotencyKey) {
        DB::table('charges')->insert([
            'user_id' => $userId,
            'amount' => $amount,
            'idempotency_key' => $idempotencyKey,
            'created_at' => now(),
        ]);
        $this->paymentGateway->charge($userId, $amount);
    });
}

// Usage: key is tied to THIS specific payment intent
$key = 'order_' . $orderId . '_payment';
chargeUser($userId, 99.99, $key);
```

### Idempotency in HTTP APIs

```
POST /orders                     → NOT idempotent (creates new order each time)
PUT /orders/123                  → Idempotent (sets order 123 to this state)
DELETE /orders/123               → Idempotent (deleting already-deleted = 404 or 200)
GET /orders/123                  → Idempotent (read-only, always safe)

POST /orders + Idempotency-Key header → Made idempotent with a key
```

```php
// Stripe's idempotency key approach
$charge = \Stripe\Charge::create([
    'amount' => 2000,
    'currency' => 'usd',
    'source' => $token,
], [
    'idempotency_key' => 'order_456_charge', // Unique per operation
]);
// If this request is retried, Stripe returns the SAME charge object — no duplicate
```

**Benefits:**
- Makes retries safe
- Prevents duplicate operations (double charges, duplicate emails)
- Enables safe at-least-once delivery

**Disadvantages:**
- Requires generating and tracking unique keys
- Storage overhead for tracking processed keys
- Keys need TTL/cleanup strategy

---

## Circuit Breakers

A circuit breaker **stops calling a failing service** after repeated failures, allowing it to recover — then tests it periodically to see if it has recovered.

**Why it exists:** Without a circuit breaker, a slow or failed dependency causes every request to wait for a timeout, exhausting connection pools and slowing the entire application.

### The Three States

```
CLOSED ──(too many failures)──► OPEN ──(timeout elapsed)──► HALF-OPEN
  ▲                                                               │
  └───────────────(probe succeeds)──────────────────────────────┘
                                         │
                              (probe fails) ──► OPEN again
```

- **Closed (normal):** Requests pass through. Failures are counted.
- **Open (failing):** Requests are rejected immediately without calling the service. Fast fail.
- **Half-Open (testing):** After a timeout, a few probe requests are allowed. If they succeed, circuit closes. If they fail, it reopens.

### Conceptual PHP Implementation

```php
class CircuitBreaker {
    private int $failureCount = 0;
    private int $failureThreshold = 5;
    private string $state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    private ?int $openedAt = null;
    private int $recoveryTimeout = 30; // seconds

    public function call(callable $operation): mixed {
        if ($this->state === 'OPEN') {
            // Check if recovery timeout has passed
            if (time() - $this->openedAt >= $this->recoveryTimeout) {
                $this->state = 'HALF_OPEN';
                Log::info('Circuit breaker entering HALF_OPEN state');
            } else {
                throw new \RuntimeException('Circuit is OPEN — service unavailable');
            }
        }

        try {
            $result = $operation();
            $this->onSuccess();
            return $result;
        } catch (\Exception $e) {
            $this->onFailure();
            throw $e;
        }
    }

    private function onSuccess(): void {
        $this->failureCount = 0;
        $this->state = 'CLOSED';
    }

    private function onFailure(): void {
        $this->failureCount++;

        if ($this->failureCount >= $this->failureThreshold || $this->state === 'HALF_OPEN') {
            $this->state = 'OPEN';
            $this->openedAt = time();
            Log::warning('Circuit breaker OPENED after ' . $this->failureCount . ' failures');
        }
    }
}

// Usage
$breaker = new CircuitBreaker();

try {
    $result = $breaker->call(fn() => Http::get('https://flaky-api.com/data')->json());
} catch (\RuntimeException $e) {
    // Circuit is open — return cached/default data
    $result = Cache::get('last_known_data', []);
}
```

### In Practice (Laravel + Guzzle + Third-Party Libraries)

In production, use battle-tested libraries rather than rolling your own:

```php
// Using league/circuit-breaker or similar package
// Or Laravel's built-in Retry + catch

$result = rescue(
    fn() => Http::timeout(5)->get('https://api.example.com/data')->json(),
    fn(\Exception $e) => Cache::get('fallback_data', [])
);
```

**Benefits:**
- Prevents cascading failures
- Reduces load on recovering services
- Fast failure (no waiting for timeouts)
- Self-healing (automatically tests recovery)

**Disadvantages:**
- Adds complexity
- Needs shared state across processes (use Redis/cache, not in-memory)
- Threshold tuning required (too sensitive = too many opens)

---

## Timeouts

A timeout is a hard limit on how long an operation can take. Without timeouts, a single slow dependency can hold a worker indefinitely.

**Why it exists:** Web server worker pools are finite. If 50 workers are each waiting 30 seconds for a slow database, the entire application is blocked for new requests.

### Types of Timeouts

| Timeout Type | What It Limits |
|---|---|
| Connection timeout | Time to establish a connection |
| Read timeout | Time to receive response data after connecting |
| Total/request timeout | End-to-end time for the entire request |
| Job/queue timeout | How long a background job can run |

```php
// HTTP timeouts
$response = Http::connectTimeout(3)  // 3 seconds to connect
               ->timeout(10)          // 10 seconds total
               ->get('https://api.example.com/slow-endpoint');

// Database query timeout
DB::statement('SET SESSION wait_timeout = 30');

// Queue job timeout
class ProcessReport implements ShouldQueue {
    public $timeout = 120; // 2 minutes max

    public function handle(): void {
        // If this runs longer than 120s, the job is killed and retried
        $this->generateHeavyReport();
    }
}

// PDO query timeout (MySQL)
$pdo->setAttribute(PDO::ATTR_TIMEOUT, 5);

// Guzzle client-level defaults
$client = new \GuzzleHttp\Client([
    'connect_timeout' => 2.0,
    'timeout' => 10.0,
]);
```

### Timeout + Fallback Pattern

```php
function getProductData(int $productId): array {
    $cacheKey = "product_{$productId}";

    try {
        $data = Http::timeout(3)->get("/api/products/{$productId}")->json();
        Cache::put($cacheKey, $data, now()->addMinutes(5));
        return $data;
    } catch (\Illuminate\Http\Client\ConnectionException $e) {
        Log::warning('Product API timeout, using cached data', ['id' => $productId]);

        // Serve stale cache rather than error
        return Cache::get($cacheKey, ['error' => 'Service temporarily unavailable']);
    }
}
```

**Benefits:**
- Prevents worker starvation
- Limits blast radius of slow dependencies
- Forces you to define SLA expectations

**Disadvantages:**
- Choosing the right timeout value is hard
- Too short: legitimate slow operations fail
- Too long: doesn't protect against slow dependencies fast enough

---

## Partial Failure Handling

In systems that process many items or call multiple services, **some operations may succeed while others fail**. Handling this gracefully is essential.

### Bulk Operations with Partial Success

```php
class OrderBatchProcessor {
    public function processOrders(array $orderIds): array {
        $results = [
            'succeeded' => [],
            'failed' => [],
        ];

        foreach ($orderIds as $orderId) {
            try {
                $this->processOrder($orderId);
                $results['succeeded'][] = $orderId;
            } catch (\Exception $e) {
                Log::error('Order processing failed', [
                    'order_id' => $orderId,
                    'error' => $e->getMessage(),
                ]);
                $results['failed'][] = [
                    'order_id' => $orderId,
                    'error' => $e->getMessage(),
                ];
                // Continue to next order — don't abort the whole batch
            }
        }

        return $results;
    }
}

// Usage
$result = $processor->processOrders([101, 102, 103, 104]);
// Returns: ['succeeded' => [101, 103, 104], 'failed' => [['order_id' => 102, 'error' => '...']]]
```

### Queue-Based Partial Failure (Laravel)

```php
// Job chaining — subsequent jobs only run if the first succeeded
Bus::chain([
    new ValidateOrder($orderId),
    new ChargePayment($orderId),    // Only runs if ValidateOrder succeeded
    new SendConfirmationEmail($orderId),
])->dispatch();

// Job batching — track partial failures across many parallel jobs
$batch = Bus::batch([
    new ProcessOrder(101),
    new ProcessOrder(102),
    new ProcessOrder(103),
])->then(function (Batch $batch) {
    Log::info('All orders processed');
})->catch(function (Batch $batch, \Throwable $e) {
    Log::error('Batch had failures', ['failed_jobs' => $batch->failedJobs]);
})->finally(function (Batch $batch) {
    Log::info("Processed: {$batch->processedJobs()}, Failed: {$batch->failedJobs}");
})->dispatch();
```

### Fan-Out with Partial Failure

When calling multiple services in parallel:

```php
function enrichUserProfile(int $userId): array {
    $user = User::findOrFail($userId);

    // Run enrichments in parallel using promises
    $responses = Http::pool(fn ($pool) => [
        'orders'       => $pool->get("/api/orders?user={$userId}"),
        'preferences'  => $pool->get("/api/preferences/{$userId}"),
        'loyalty'      => $pool->get("/api/loyalty/{$userId}"),
    ]);

    return [
        'user'        => $user,
        // Safely handle each — degrade if one fails
        'orders'      => $responses['orders']->successful()
                            ? $responses['orders']->json()
                            : [],
        'preferences' => $responses['preferences']->successful()
                            ? $responses['preferences']->json()
                            : ['theme' => 'default'],
        'loyalty'     => $responses['loyalty']->successful()
                            ? $responses['loyalty']->json()
                            : null,
    ];
}
```

**Benefits:**
- Maximizes the work that succeeds
- Provides detailed failure reports (which items failed, why)
- Avoids "all-or-nothing" failure for independent items

**Disadvantages:**
- Partial success can leave data in inconsistent state if operations are related
- Clients must handle multi-status responses (207 Multi-Status)
- More complex logic than a simple try/catch

---

## Combining Patterns: A Resilient Service Call

Here's how multiple patterns work together in a real scenario — calling a payment API:

```php
class PaymentService {
    private CircuitBreaker $breaker;

    public function charge(int $userId, float $amount, string $idempotencyKey): PaymentResult {
        // 1. Fail fast — validate inputs before any I/O
        if ($amount <= 0) {
            throw new \InvalidArgumentException("Amount must be positive");
        }

        // 2. Idempotency check — safe to retry
        if ($existing = $this->findExistingCharge($idempotencyKey)) {
            return $existing;
        }

        // 3. Circuit breaker — don't call if service is known-broken
        try {
            return $this->breaker->call(function () use ($userId, $amount, $idempotencyKey) {

                // 4. Timeout — don't wait forever
                $response = Http::timeout(5)->post('/charge', [
                    'user_id' => $userId,
                    'amount' => $amount,
                    'idempotency_key' => $idempotencyKey,
                ]);

                if (!$response->successful()) {
                    throw new PaymentException($response->body(), $response->status());
                }

                return new PaymentResult($response->json());
            });

        } catch (CircuitOpenException $e) {
            // 5. Graceful degradation — queue for later processing
            Log::warning('Payment circuit open, queuing charge');
            DeferredCharge::dispatch($userId, $amount, $idempotencyKey);
            return PaymentResult::pending();
        }
    }
}
```

---

## Interview Quick Reference

**Q: What is the difference between fail fast and graceful degradation?**
A: Fail fast means stopping immediately when invalid state is detected — best for critical errors or bad inputs. Graceful degradation means continuing with reduced functionality when a non-critical component fails — e.g., showing a page without personalization if the recommendation engine is down.

**Q: Why is idempotency important for retries?**
A: If an operation is retried after a timeout, you can't know whether the first attempt succeeded. Idempotent operations (using an idempotency key) ensure that retrying produces the same result without side effects like double charges or duplicate records.

**Q: What is a circuit breaker and when would you use one?**
A: A circuit breaker detects repeated failures calling a service and "opens" — immediately returning an error or fallback instead of waiting for timeouts. After a recovery period, it "half-opens" to test if the service is back. Use it when calling external APIs, microservices, or any dependency that could become slow or unavailable.

**Q: What is exponential backoff with jitter?**
A: Exponential backoff spaces retries increasingly further apart (1s, 2s, 4s, 8s) to reduce pressure on a struggling service. Jitter adds randomness to avoid the "thundering herd" problem where many clients all retry at exactly the same moment.

**Q: How do you handle partial failures in a bulk operation?**
A: Continue processing remaining items after an individual item fails, collect successes and failures separately, and return both. This avoids losing successful work because of a few bad items. Log all failures with enough context to reprocess or alert.

**Q: What is the difference between a connection timeout and a read timeout?**
A: A connection timeout limits how long to wait when establishing a connection. A read timeout limits how long to wait for data after the connection is open. Both are needed — a service might accept the connection quickly but then hang on the response.
