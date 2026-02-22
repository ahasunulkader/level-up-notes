# Concurrency & Parallelism

Concurrency and parallelism are fundamental concepts in software engineering. PHP's execution model is mostly single-threaded per request, but modern PHP applications deal with concurrency constantly — multiple requests hitting the same database row, queue workers processing simultaneously, or file writes from concurrent processes.

---

## 1. Concurrency vs Parallelism

### Concurrency

**Multiple tasks make progress by interleaving.** They may not run simultaneously — the CPU switches between tasks, giving the illusion of simultaneity.

```
Time →
Task A: ██░░██░░██
Task B: ░░██░░██░░
         (interleaved on 1 CPU)
```

**Think of it as:** One chef juggling multiple dishes — working on dish A, pausing to stir dish B, back to dish A. Only one action at any moment, but both dishes progress.

### Parallelism

**Multiple tasks execute simultaneously** on multiple CPU cores or machines.

```
Time →
Task A: ████████
Task B: ████████
         (truly simultaneous on 2 CPUs)
```

**Think of it as:** Two chefs, each cooking their own dish at the same time.

### Key Distinction

| | Concurrency | Parallelism |
|---|------------|------------|
| Definition | Multiple tasks make progress | Multiple tasks run simultaneously |
| CPU cores needed | 1 (or more) | Multiple |
| Example | Single-threaded event loop (Node.js) | Multi-core processing |
| PHP example | Multiple HTTP requests handled via FastCGI | PHP parallel extension, multiple CLI workers |
| Goal | Responsiveness, I/O efficiency | Throughput, raw speed |

> **Interview insight:** Concurrency is about **structure** (how you design tasks that can overlap). Parallelism is about **execution** (physically running at the same time). You can have concurrency without parallelism (single CPU) and parallelism without well-designed concurrency.

### PHP's Execution Model

PHP is traditionally **synchronous and single-threaded** per request. Each web request runs in its own PHP process/thread managed by FastCGI (PHP-FPM). Multiple concurrent requests are handled by running multiple PHP workers — but each worker itself is single-threaded.

```
User 1's request → PHP Worker 1 (single-threaded)
User 2's request → PHP Worker 2 (single-threaded)
User 3's request → PHP Worker 3 (single-threaded)
```

This is why concurrency problems in PHP arise at the **database, cache, and file system level** rather than inside a single process.

---

## 2. Thread Safety

**Thread safety** means a piece of code works correctly when accessed by multiple threads simultaneously. Code is NOT thread-safe when shared mutable state can be corrupted by concurrent access.

Since PHP web requests are isolated processes (not threads sharing memory), true thread-safety issues are rare within PHP itself. However, shared resources — databases, files, cache — introduce the same class of problems.

```php
<?php
// NOT SAFE — race condition on a counter file
// Worker 1 and Worker 2 run simultaneously:

// Worker 1: reads counter = 100
// Worker 2: reads counter = 100
// Worker 1: writes counter = 101
// Worker 2: writes counter = 101  ← overwrites Worker 1! Both incremented, result = 101 (should be 102)

$counter = (int) file_get_contents('counter.txt');
$counter++;
file_put_contents('counter.txt', $counter);  // RACE CONDITION

// SAFE — atomic increment in Redis
$redis->incr('counter');  // atomic — Redis is single-threaded, no race condition

// SAFE — database atomic update
DB::table('counters')
    ->where('key', 'visits')
    ->increment('value', 1); // UPDATE counters SET value = value + 1 WHERE key = 'visits'
    // The increment happens atomically in the DB
```

### Thread Safety Best Practices in PHP

```php
<?php
// 1. Use atomic database operations instead of read-modify-write
// BAD:
$product = Product::find($id);
$product->update(['stock' => $product->stock - $qty]); // race condition!

// GOOD:
Product::where('id', $id)
    ->where('stock', '>=', $qty) // guard against negative stock
    ->decrement('stock', $qty);

// 2. Use Redis atomic operations
$redis->incr('page_views');
$redis->lpush('recent_orders', $orderId);

// 3. Use database transactions with locking
DB::transaction(function () use ($productId, $qty) {
    $product = Product::lockForUpdate()->find($productId); // SELECT ... FOR UPDATE
    if ($product->stock < $qty) {
        throw new \RuntimeException('Insufficient stock');
    }
    $product->decrement('stock', $qty);
});
```

---

## 3. Shared State Problems

Shared state is data accessible by multiple concurrent processes/workers. Without protection, concurrent access causes **race conditions** — bugs that depend on the exact timing of operations.

### Race Condition

```php
<?php
// PROBLEM: Two users booking the last seat on a flight

// Time 0: seat_count = 1 (one seat left)
// Worker A: SELECT seat_count FROM flights WHERE id = 1  → 1
// Worker B: SELECT seat_count FROM flights WHERE id = 1  → 1
// Worker A: sees 1 ≥ 1, proceeds to book
// Worker B: sees 1 ≥ 1, proceeds to book
// Worker A: UPDATE flights SET seat_count = 0 ...
// Worker B: UPDATE flights SET seat_count = 0 ...
// RESULT: TWO bookings created, seat_count = 0, flight is double-booked!

// SOLUTION: Optimistic locking
// Add a 'version' column — increment on every update
$flight = Flight::find($flightId);

$updated = Flight::where('id', $flightId)
    ->where('version', $flight->version) // only update if version hasn't changed
    ->where('seat_count', '>', 0)
    ->update([
        'seat_count' => DB::raw('seat_count - 1'),
        'version'    => DB::raw('version + 1'),
    ]);

if ($updated === 0) {
    throw new \RuntimeException('Booking failed — seat was just taken');
}
// If another worker modified it first, version won't match and update returns 0 rows
```

### Check-Then-Act (TOCTOU)

```php
<?php
// Time-of-Check vs Time-of-Use bug
// Check and act must happen atomically

// BAD: check then act (gap between check and act)
if (!file_exists('lockfile')) {
    file_put_contents('lockfile', getmypid()); // another process can slip in here!
    // do work
    unlink('lockfile');
}

// GOOD: atomic file creation
$handle = fopen('lockfile', 'x'); // 'x' fails if file exists — atomic!
if ($handle === false) {
    // Another process already has the lock
    return;
}
// do work
fclose($handle);
unlink('lockfile');
```

---

## 4. Locks vs Lock-Free Approaches

### Pessimistic Locking (Database Row Locks)

Assumes conflicts are likely. **Locks the row before reading** so no other transaction can modify it until you commit.

```php
<?php
// SELECT ... FOR UPDATE — exclusive lock
DB::transaction(function () use ($orderId) {
    $order = Order::lockForUpdate()->find($orderId); // blocks other transactions

    if ($order->status !== 'pending') {
        throw new \RuntimeException('Order already processed');
    }

    $order->update(['status' => 'processing']);
    // Lock released on commit
});

// SELECT ... LOCK IN SHARE MODE — shared lock (others can read but not write)
$balance = DB::table('accounts')
    ->where('id', $accountId)
    ->sharedLock()  // LOCK IN SHARE MODE
    ->value('balance');
```

**Benefits:** No data corruption, simple logic.
**Disadvantages:** Reduced throughput (contention), risk of deadlocks.

### Optimistic Locking (Version/Timestamp)

Assumes conflicts are rare. **No lock is held** — but before committing, verify nothing changed.

```php
<?php
// Optimistic locking with version number
// Table has 'version' INT column

$product = Product::find($productId);

// Do business logic
$newStock = $product->stock - $qty;

// Attempt to update — only succeeds if version matches
$affected = Product::where('id', $productId)
    ->where('version', $product->version)
    ->update([
        'stock'   => $newStock,
        'version' => $product->version + 1,
    ]);

if ($affected === 0) {
    throw new \RuntimeException('Product was modified by another process — retry');
}
```

**Benefits:** High throughput when conflicts are rare, no blocking.
**Disadvantages:** Must handle retry logic when conflict is detected.

### Redis-Based Distributed Locking

When multiple PHP workers (or servers) need a lock across machines:

```php
<?php
// Using Redis as a distributed lock (Redlock algorithm principle)
$redis  = new \Redis();
$lockKey = "lock:order:{$orderId}";
$lockTTL = 5; // seconds — auto-expires if process crashes
$uniqueToken = uniqid('', true);

// SET key value NX PX milliseconds — atomic: set only if Not eXists
$acquired = $redis->set($lockKey, $uniqueToken, ['NX', 'EX' => $lockTTL]);

if (!$acquired) {
    throw new \RuntimeException('Could not acquire lock — another process is working on this order');
}

try {
    // Critical section — only one process can be here at a time
    processOrder($orderId);
} finally {
    // Release only if WE still own the lock (don't release someone else's lock)
    if ($redis->get($lockKey) === $uniqueToken) {
        $redis->del($lockKey);
    }
}

// Laravel: using Cache lock (backed by Redis or database)
$lock = Cache::lock("order:{$orderId}", 10); // 10-second TTL

if ($lock->get()) {
    try {
        processOrder($orderId);
    } finally {
        $lock->release();
    }
} else {
    // Lock not available — queue for retry
}

// Block until lock is available (up to 5 seconds)
$lock->block(5, function () use ($orderId) {
    processOrder($orderId);
});
```

### File Locking

```php
<?php
function safeAppendToLog(string $message, string $logFile): void
{
    $handle = fopen($logFile, 'a');

    if (flock($handle, LOCK_EX)) {          // block until exclusive lock acquired
        fwrite($handle, $message . PHP_EOL);
        fflush($handle);
        flock($handle, LOCK_UN);            // release lock
    }

    fclose($handle);
}
```

### Lock-Free Approaches

Avoid locks entirely by using atomic operations:

```php
<?php
// Redis atomic increment — no lock needed
$redis->incr('page_views');
$redis->incrBy('user:42:points', 10);

// Database atomic update — let the DB handle concurrency
Product::where('id', $id)->decrement('stock', $qty); // UPDATE stock = stock - qty
User::where('id', $id)->increment('login_count');

// Append-only log — no contention because we never modify existing records
DB::table('events')->insert([
    'user_id' => $userId,
    'type'    => 'page_view',
    'payload' => json_encode($data),
    'at'      => now(),
]);
// Aggregate later with GROUP BY — no concurrent modification

// PHP Swoole / ReactPHP — single event loop, no shared state between coroutines
```

---

## 5. Deadlocks

A **deadlock** occurs when two or more transactions are each waiting for the other to release a lock — creating a circular wait that never resolves.

```
Transaction A holds lock on Row 1, wants lock on Row 2
Transaction B holds lock on Row 2, wants lock on Row 1
→ Both wait forever — DEADLOCK
```

### MySQL Auto-Detection

MySQL detects deadlocks automatically and kills one transaction (the "victim"), rolling it back and throwing an error.

```php
<?php
// Deadlock scenario
// Transaction A:                    Transaction B:
// UPDATE accounts SET bal=bal-100   UPDATE accounts SET bal=bal+50
//   WHERE id=1;                       WHERE id=2;
// UPDATE accounts SET bal=bal+100   UPDATE accounts SET bal=bal-50
//   WHERE id=2; ← WAITS for B          WHERE id=1; ← WAITS for A → DEADLOCK

// Prevention: ALWAYS lock in the same consistent order
function transfer(\PDO $pdo, int $fromId, int $toId, float $amount): void
{
    // Sort IDs to ensure consistent lock order
    [$firstId, $secondId] = $fromId < $toId
        ? [$fromId, $toId]
        : [$toId, $fromId];

    $pdo->beginTransaction();
    $stmt = $pdo->prepare('SELECT id FROM accounts WHERE id = ? FOR UPDATE');
    $stmt->execute([$firstId]);   // always lock lower ID first
    $stmt->execute([$secondId]);  // then higher ID

    $pdo->prepare('UPDATE accounts SET balance = balance - ? WHERE id = ?')
        ->execute([$amount, $fromId]);
    $pdo->prepare('UPDATE accounts SET balance = balance + ? WHERE id = ?')
        ->execute([$amount, $toId]);

    $pdo->commit();
}
```

### Handling Deadlocks with Retry

```php
<?php
function withDeadlockRetry(callable $operation, int $maxRetries = 3): mixed
{
    $attempt = 0;

    while ($attempt < $maxRetries) {
        try {
            return DB::transaction($operation);
        } catch (\Illuminate\Database\QueryException $e) {
            // MySQL deadlock error code: 1213
            if ($e->getCode() !== '40001') {
                throw $e; // not a deadlock — rethrow
            }
            $attempt++;
            if ($attempt >= $maxRetries) {
                throw $e;
            }
            usleep(random_int(10000, 100000)); // backoff 10–100ms
        }
    }
}

// Usage
withDeadlockRetry(function () use ($fromId, $toId, $amount) {
    // transfer logic
});
```

### Deadlock Prevention Rules

1. **Lock in consistent order** — always lock resources in the same order across all transactions
2. **Keep transactions short** — hold locks for as little time as possible
3. **Use optimistic locking** when conflicts are rare
4. **Avoid user interaction inside transactions** — never wait for user input while holding locks
5. **Reduce lock scope** — lock only the specific rows needed, not the whole table

---

## 6. Event-Driven Systems

Event-driven architecture processes tasks **asynchronously** — operations happen in response to events rather than blocking inline.

### Why Event-Driven?

```php
<?php
// SYNCHRONOUS — user waits for everything
public function checkout(Request $request): JsonResponse
{
    $order = Order::create($request->validated());
    $order->charge();                          // 500ms — stripe API
    Mail::to($order->user)->send(new Receipt); // 300ms — SMTP
    Slack::notify('#orders', $order);          // 200ms — Slack API
    $this->updateInventory($order);            // 100ms
    // User waits 1100ms total!
    return response()->json(['success' => true]);
}

// ASYNC/EVENT-DRIVEN — user gets instant response
public function checkout(Request $request): JsonResponse
{
    $order = Order::create($request->validated());
    $order->charge(); // still sync — user needs to know payment result

    // Everything else is queued — happens in background
    event(new OrderPlaced($order));  // fires events

    return response()->json(['success' => true]); // instant response
}
```

### Laravel Events and Listeners

```php
<?php
// Define the event
class OrderPlaced
{
    public function __construct(public readonly Order $order) {}
}

// Register listeners in EventServiceProvider
protected $listen = [
    OrderPlaced::class => [
        SendOrderConfirmationEmail::class,  // queued listener
        UpdateInventory::class,             // queued listener
        NotifySlack::class,                 // queued listener
    ],
];

// Each listener handles one responsibility
class SendOrderConfirmationEmail implements ShouldQueue
{
    public function handle(OrderPlaced $event): void
    {
        Mail::to($event->order->user)->send(new OrderReceipt($event->order));
    }
}

// Firing the event
event(new OrderPlaced($order));
// All listeners are dispatched to the queue — run by workers in background
```

### Laravel Queues — The PHP Way of Async

```php
<?php
// Dispatch a job to the queue (async)
ProcessPayment::dispatch($order)->onQueue('payments');
SendWelcomeEmail::dispatch($user)->delay(now()->addMinutes(5));

// Define a queued job
class ProcessPayment implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;         // retry up to 3 times
    public int $timeout = 60;      // fail after 60 seconds

    public function __construct(private Order $order) {}

    public function handle(PaymentGateway $gateway): void
    {
        $gateway->charge($this->order);
        $this->order->update(['status' => 'paid']);
    }

    public function failed(\Throwable $exception): void
    {
        // Called if all retries exhausted
        $this->order->update(['status' => 'payment_failed']);
        logger()->error('Payment failed', ['order' => $this->order->id]);
    }
}
```

### Message Queues (Redis/RabbitMQ/SQS)

```
Producer → Queue → Worker 1
                → Worker 2
                → Worker 3
```

**Benefits:**
- **Decoupling** — sender and receiver don't need to know about each other
- **Scalability** — add more workers to process faster
- **Resilience** — jobs persist in queue even if workers crash
- **Rate limiting** — control processing speed to protect downstream services

**Disadvantages:**
- **Eventual processing** — not instant, introduces latency
- **Complexity** — need to run queue workers, handle job failures
- **Ordering** — parallel workers don't guarantee order by default
- **Debugging** — harder to trace than synchronous code

### Pub/Sub Pattern

```php
<?php
// Publisher — doesn't know who's listening
class UserRegistered
{
    public function __construct(public readonly User $user) {}
}

// Subscribers react independently
class WelcomeEmailSubscriber { /* send email */ }
class SetupDefaultSettingsSubscriber { /* create defaults */ }
class NotifySalesTeamSubscriber { /* Slack message */ }
class LogAnalyticsSubscriber { /* tracking */ }

// Fire and forget
event(new UserRegistered($user));
// All subscribers handle it — publisher has no coupling to any of them
```

---

## Interview Q&A

**Q: What is the difference between concurrency and parallelism?**
A: Concurrency means multiple tasks make progress by interleaving — they may not run literally at the same time. Parallelism means tasks execute simultaneously on multiple CPU cores. You can have concurrency on a single CPU (via context switching) and parallelism requires multiple CPUs. PHP is mostly concurrent (multiple requests via multiple workers) rather than parallel within a single process.

**Q: What is a race condition? How do you prevent it?**
A: A race condition occurs when the outcome depends on the timing of concurrent operations — typically when multiple processes read-modify-write shared state without synchronization. Prevention strategies: use atomic database operations (`UPDATE stock = stock - 1`), use `SELECT ... FOR UPDATE` for pessimistic locking, use optimistic locking with a version column, or use Redis atomic operations like `INCR`.

**Q: What is the difference between pessimistic and optimistic locking?**
A: Pessimistic locking acquires an exclusive lock before reading, blocking other transactions — assumes conflicts are likely. Optimistic locking makes no lock, but before committing, verifies the data hasn't changed (via a version number) — assumes conflicts are rare. Pessimistic locking is safer in high-contention scenarios; optimistic locking gives better throughput when conflicts are infrequent.

**Q: What is a deadlock and how do you prevent it?**
A: A deadlock occurs when two transactions each hold a lock the other needs, creating a circular wait. Prevent it by: (1) always locking resources in the same consistent order, (2) keeping transactions short, (3) using optimistic locking when appropriate. MySQL auto-detects deadlocks and kills one transaction — always handle the deadlock exception with retry logic.

**Q: What is an event-driven system and why use it?**
A: An event-driven system decouples operations by having producers emit events that one or more consumers react to asynchronously. Use it to avoid blocking the user on non-critical tasks (sending emails, Slack notifications, updating analytics), to decouple components, and to enable independent scaling. In Laravel, this is implemented with events/listeners, jobs, and queues.

**Q: How does PHP handle concurrency without threads?**
A: PHP-FPM runs multiple worker processes — each is single-threaded but handles one request. Concurrency at the application level is handled by: (1) database-level locking (FOR UPDATE, transactions), (2) Redis atomic operations and distributed locks, (3) file locking with `flock()`, and (4) queue workers for async processing. PHP 8.1 Fibers add cooperative multitasking within a single process, and Swoole provides true async coroutines.
