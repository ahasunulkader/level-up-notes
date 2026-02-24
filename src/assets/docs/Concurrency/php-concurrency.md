# PHP Concurrency

PHP is **single-threaded per request**. Each HTTP request runs in its own isolated OS process (PHP-FPM worker) with its own memory. No shared memory between requests.

This makes PHP simpler than Java, but concurrency problems still exist — they happen at the **shared resource level**: databases, Redis, and files.

---

## PHP's Execution Model

```
Incoming Requests
       │
       ▼
   PHP-FPM Pool
┌─────────────────────────────────┐
│  Worker 1 (Process) — Request A │  ← own memory, single-threaded
│  Worker 2 (Process) — Request B │  ← own memory, single-threaded
│  Worker 3 (Process) — Request C │  ← own memory, single-threaded
│  Worker 4 (Process) — idle      │
└─────────────────────────────────┘
       │
       ▼
   Shared Resources (where races happen)
┌──────────┐  ┌───────┐  ┌───────────┐
│ Database │  │ Redis │  │   Files   │
└──────────┘  └───────┘  └───────────┘
```

**Key insight:** Two PHP workers can read the same database row at the same millisecond. The race happens in the database, not inside PHP.

---

## Race Conditions in PHP

### Example — Overselling Inventory

```php
// UNSAFE — classic race condition across two FPM workers
// Worker A and Worker B both process a purchase at the same time

// Worker A: SELECT stock FROM products WHERE id = 1  → 5
// Worker B: SELECT stock FROM products WHERE id = 1  → 5
// Worker A: stock(5) >= qty(3) → UPDATE stock = 2
// Worker B: stock(5) >= qty(4) → UPDATE stock = 1
// RESULT: stock went 5 → 1, but 3 + 4 = 7 units were sold — OVERSOLD

function unsafePurchase(int $productId, int $qty): void {
    $product = Product::find($productId);

    if ($product->stock >= $qty) {           // check
        $product->update(['stock' => $product->stock - $qty]); // act (gap between these two!)
    }
}
```

---

## Pessimistic Locking — `SELECT FOR UPDATE`

Lock the row **before reading** so no other transaction can touch it until you commit.

```php
// SAFE — lock the row at read time
DB::transaction(function () use ($productId, $qty) {
    // SELECT * FROM products WHERE id = ? FOR UPDATE
    // Other transactions that try to lock this row will BLOCK until we commit
    $product = Product::lockForUpdate()->find($productId);

    if ($product->stock < $qty) {
        throw new \RuntimeException('Insufficient stock');
    }

    $product->decrement('stock', $qty);
    // Lock is released when the transaction commits
});
```

**Shared lock — allow reads, block writes:**
```php
// LOCK IN SHARE MODE — others can read but not write
$balance = DB::table('accounts')
    ->where('id', $accountId)
    ->sharedLock()
    ->value('balance');
```

**Benefits:**
- Guarantees data integrity under high contention
- Simple logic — no retry needed

**Disadvantages:**
- Reduces throughput — other transactions queue up
- Risk of deadlocks if not careful about lock order
- Long-held locks hurt performance

**When to use:** High-contention scenarios where conflicts are likely — booking systems, payment processing, stock deduction.

---

## Optimistic Locking — Version Column

No lock is held. Before committing, check if anyone else changed the data since you read it.

```php
// Add 'version' INT column to the table

$product = Product::find($productId);

// Do business logic (no lock held during this time)
$newStock = $product->stock - $qty;

// Only update if version still matches — if someone else changed it, this returns 0 rows
$affected = Product::where('id', $productId)
    ->where('version', $product->version)       // version must match
    ->update([
        'stock'   => $newStock,
        'version' => DB::raw('version + 1'),    // bump version
    ]);

if ($affected === 0) {
    // Another worker modified this product — decide: retry or throw
    throw new \RuntimeException('Product was modified concurrently — please retry');
}
```

**With retry:**
```php
function purchaseWithRetry(int $productId, int $qty, int $maxRetries = 3): void
{
    for ($attempt = 0; $attempt < $maxRetries; $attempt++) {
        $product = Product::find($productId);

        if ($product->stock < $qty) {
            throw new \RuntimeException('Out of stock');
        }

        $affected = Product::where('id', $productId)
            ->where('version', $product->version)
            ->update([
                'stock'   => $product->stock - $qty,
                'version' => DB::raw('version + 1'),
            ]);

        if ($affected > 0) {
            return; // success
        }

        usleep(random_int(10000, 50000)); // backoff before retry
    }

    throw new \RuntimeException('Could not complete purchase after retries');
}
```

**Benefits:**
- High throughput when conflicts are rare
- No blocking — all workers proceed in parallel
- Great for read-heavy, low-contention data

**Disadvantages:**
- Must implement retry logic
- Under high contention, many retries degrade performance
- Not suitable when conflicts are frequent

**When to use:** Low-contention updates like user profile edits, settings changes, non-critical counters.

---

## Redis Distributed Lock

When multiple servers (not just workers on one machine) need mutual exclusion — for example, ensuring a scheduled job runs only once across a cluster.

```php
// Redis SET key value NX EX seconds
// NX = only set if key does Not eXist (atomic!)
// EX = expire after N seconds (auto-release if process crashes)

$redis = new \Redis();
$lockKey   = "lock:order:{$orderId}";
$lockTTL   = 10; // seconds
$uniqueToken = uniqid('lock_', true); // unique so we don't release someone else's lock

$acquired = $redis->set($lockKey, $uniqueToken, ['NX', 'EX' => $lockTTL]);

if (!$acquired) {
    throw new \RuntimeException('Another process is handling this order');
}

try {
    processOrder($orderId); // critical section
} finally {
    // Only release if WE still own it
    if ($redis->get($lockKey) === $uniqueToken) {
        $redis->del($lockKey);
    }
}
```

**Laravel Cache Lock (cleaner API):**
```php
// Backed by Redis (or database)
$lock = Cache::lock("order:{$orderId}", 10); // 10-second TTL

if ($lock->get()) {
    try {
        processOrder($orderId);
    } finally {
        $lock->release();
    }
} else {
    // Could not acquire — return, queue for retry, etc.
}

// Block up to 5 seconds waiting for the lock
$lock->block(5, function () use ($orderId) {
    processOrder($orderId);
});
```

**Benefits:**
- Works across multiple servers
- TTL prevents deadlocks if process crashes (lock auto-expires)
- Redis is single-threaded — SET NX is truly atomic

**Disadvantages:**
- Requires Redis
- Redis single-node is a single point of failure (use Redlock for HA)
- TTL must be long enough for the operation, short enough to recover fast

---

## Atomic Database Operations (Lock-Free)

Often, you don't need a lock at all — let the database do atomic work.

```php
// Atomic increment — no race condition possible
Product::where('id', $id)->increment('views');
// → UPDATE products SET views = views + 1 WHERE id = ?

// Atomic decrement with guard
Product::where('id', $id)
    ->where('stock', '>=', $qty)    // guard against going negative
    ->decrement('stock', $qty);
// → UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?
// Returns affected rows — 0 means guard condition failed

// Check result
$affected = Product::where('id', $id)
    ->where('stock', '>=', $qty)
    ->decrement('stock', $qty);

if ($affected === 0) {
    throw new \RuntimeException('Out of stock');
}
```

**Redis atomic operations:**
```php
$redis->incr('page_views');              // atomic counter
$redis->incrBy('user:42:points', 10);   // atomic add
$redis->decrBy('rate_limit:ip', 1);     // atomic subtract
$redis->setnx('lock_key', 1);           // set if not exists
```

**Benefits:** Fastest approach — no lock overhead, no retry logic needed.
**Disadvantages:** Limited to simple increment/decrement. Complex multi-step logic still needs locking.

---

## File Locking with `flock()`

For files accessed by multiple PHP workers simultaneously:

```php
function safeAppendToLog(string $message, string $logFile): void
{
    $handle = fopen($logFile, 'a');

    // LOCK_EX = exclusive lock, blocks until acquired
    // LOCK_NB = non-blocking (returns false immediately if locked)
    if (flock($handle, LOCK_EX)) {
        fwrite($handle, $message . PHP_EOL);
        fflush($handle);
        flock($handle, LOCK_UN); // release lock
    }

    fclose($handle);
}

// Non-blocking try
if (flock($handle, LOCK_EX | LOCK_NB)) {
    // got the lock
    flock($handle, LOCK_UN);
} else {
    // could not get lock immediately — another process has it
}
```

**Limitation:** `flock()` is advisory — it only works if ALL code uses `flock()`. A process that ignores it can still write.

---

## Deadlocks in MySQL

A deadlock occurs when two transactions each hold a lock the other needs.

```
Transaction A holds lock on Row 1, wants Row 2
Transaction B holds lock on Row 2, wants Row 1
→ MySQL detects this and kills one transaction (the "victim")
```

**Prevention — always lock rows in consistent order:**
```php
function transfer(\PDO $pdo, int $fromId, int $toId, float $amount): void
{
    // Sort IDs — always lock lower ID first, regardless of transfer direction
    [$firstId, $secondId] = $fromId < $toId
        ? [$fromId, $toId]
        : [$toId, $fromId];

    $pdo->beginTransaction();

    $stmt = $pdo->prepare('SELECT id FROM accounts WHERE id = ? FOR UPDATE');
    $stmt->execute([$firstId]);  // always lock lower ID first
    $stmt->execute([$secondId]); // then higher ID — no circular wait possible

    $pdo->prepare('UPDATE accounts SET balance = balance - ? WHERE id = ?')
        ->execute([$amount, $fromId]);
    $pdo->prepare('UPDATE accounts SET balance = balance + ? WHERE id = ?')
        ->execute([$amount, $toId]);

    $pdo->commit();
}
```

**Handling MySQL deadlock error (1213) with retry:**
```php
function withDeadlockRetry(callable $operation, int $maxRetries = 3): mixed
{
    $attempt = 0;

    while ($attempt < $maxRetries) {
        try {
            return DB::transaction($operation);
        } catch (\Illuminate\Database\QueryException $e) {
            if ($e->getCode() !== '40001') {
                throw $e; // not a deadlock — re-throw
            }
            $attempt++;
            if ($attempt >= $maxRetries) throw $e;
            usleep(random_int(10000, 100000)); // backoff 10–100ms
        }
    }
}
```

**Deadlock prevention rules:**
1. Always acquire locks in the same consistent order
2. Keep transactions as short as possible
3. Avoid user interaction inside transactions
4. Use optimistic locking when conflicts are rare

---

## Event-Driven Async — Laravel Queues

PHP processes are blocking by default — a slow email or API call blocks the worker. Queues move work out of the request cycle.

```php
// SYNCHRONOUS — user waits for all of this
public function checkout(Request $request): JsonResponse
{
    $order = Order::create($request->validated());
    $order->charge();                          // 500ms — Stripe API
    Mail::to($order->user)->send(new Receipt); // 300ms — SMTP
    Slack::notify('#orders', $order);          // 200ms — Slack API
    $this->updateInventory($order);            // 100ms — DB
    // User waits 1100ms total!
    return response()->json(['success' => true]);
}

// ASYNC — user gets response after charge only (~500ms)
public function checkout(Request $request): JsonResponse
{
    $order = Order::create($request->validated());
    $order->charge(); // sync — must know if payment succeeded

    event(new OrderPlaced($order)); // dispatches async listeners to queue
    return response()->json(['success' => true]);
}
```

**Defining events and queued listeners:**
```php
class OrderPlaced
{
    public function __construct(public readonly Order $order) {}
}

// EventServiceProvider
protected $listen = [
    OrderPlaced::class => [
        SendOrderConfirmationEmail::class,
        UpdateInventory::class,
        NotifySlackChannel::class,
    ],
];

// Queued listener — runs in a background worker
class SendOrderConfirmationEmail implements ShouldQueue
{
    public int $tries   = 3;
    public int $timeout = 60;

    public function handle(OrderPlaced $event): void
    {
        Mail::to($event->order->user)->send(new Receipt($event->order));
    }

    public function failed(\Throwable $e): void
    {
        Log::error('Email failed', ['order' => $this->event->order->id]);
    }
}
```

**Queue architecture:**
```
Request → Controller → event() → Queue (Redis/SQS/DB)
                                          │
                                   ┌──────▼──────┐
                                   │ Queue Worker│ ← php artisan queue:work
                                   │ Queue Worker│
                                   │ Queue Worker│
                                   └─────────────┘
```

**Benefits of queues:**
- Decoupling — producer doesn't know who's listening
- Scalability — add more workers to process faster
- Resilience — jobs persist even if workers restart
- Rate control — throttle processing to protect downstream services

**Disadvantages:**
- Eventual processing — not instant
- Requires running queue workers
- Debugging is harder (asynchronous stack traces)

---

## PHP Fibers (PHP 8.1) — Cooperative Multitasking

Fibers allow **cooperative multitasking within a single PHP thread** — a Fiber can pause itself and yield control back.

```php
$fiber = new Fiber(function (): void {
    $value = Fiber::suspend('first suspend');  // pause, return 'first suspend'
    echo "Resumed with: {$value}\n";          // continues when resumed
});

$result = $fiber->start();   // returns 'first suspend', fiber is paused
echo "Fiber yielded: {$result}\n";

$fiber->resume('hello');     // passes 'hello' back to fiber, fiber resumes
```

**Real use:** Fibers power async HTTP clients like `revolt/event-loop` — send multiple HTTP requests concurrently within a single PHP worker, without actual threads.

**Key point:** Fibers are **cooperative** (must explicitly yield) not preemptive (OS doesn't interrupt them). One Fiber hogging the CPU blocks all others.

---

## Parallel HTTP Calls (Laravel HTTP Pool)

```php
// Sequential — waits for each one
$user    = Http::get("/api/user/{$id}")->json();     // 200ms
$orders  = Http::get("/api/orders?user={$id}")->json(); // 300ms
$prefs   = Http::get("/api/prefs/{$id}")->json();    // 150ms
// Total: ~650ms

// Parallel — all fire at once
$responses = Http::pool(fn ($pool) => [
    'user'   => $pool->get("/api/user/{$id}"),
    'orders' => $pool->get("/api/orders?user={$id}"),
    'prefs'  => $pool->get("/api/prefs/{$id}"),
]);
// Total: ~300ms (slowest one)

$user   = $responses['user']->json();
$orders = $responses['orders']->json();
$prefs  = $responses['prefs']->json();
```

---

## Interview Q&A — PHP Concurrency

**Q: How does PHP handle concurrency without threads?**
A: PHP-FPM runs multiple isolated processes — each handles one request with its own memory. Concurrency is managed via: (1) database-level locking (`FOR UPDATE`, transactions), (2) Redis atomic operations and distributed locks (`SET NX`), (3) file locking with `flock()`, and (4) queue workers for async processing. PHP 8.1 Fibers add cooperative multitasking within a single process.

**Q: What is a race condition in PHP and how do you prevent it?**
A: When two FPM workers read-then-modify shared data (like stock), they can overwrite each other. Prevention: use atomic DB operations (`UPDATE stock = stock - 1`), pessimistic locking (`SELECT FOR UPDATE`), optimistic locking (version column), or Redis atomic commands (`INCR`).

**Q: What is the difference between pessimistic and optimistic locking?**
A: Pessimistic locking (`SELECT FOR UPDATE`) blocks other transactions before reading — assumes conflicts are likely. Optimistic locking checks a version column at write time — assumes conflicts are rare. Pessimistic is safer under high contention; optimistic gives better throughput when conflicts are infrequent.

**Q: When would you use a Redis lock vs a database lock?**
A: Use a database lock (`FOR UPDATE`) when the data you're protecting IS in the database and you need transactional guarantees. Use a Redis lock for: coordinating across multiple servers, non-database resources (files, external APIs), or scenarios where you don't want a DB transaction open for the entire duration.

**Q: What is the danger of using `flock()` for concurrency control?**
A: `flock()` is advisory — it only works if all processes cooperating on the same file also use `flock()`. A process that ignores file locks can still write to the file. It also has no timeout built-in (`LOCK_EX` blocks indefinitely unless combined with `LOCK_NB`). For critical resources, prefer database or Redis locking.

**Q: What is a deadlock in MySQL and how do you prevent it?**
A: A deadlock occurs when Transaction A holds a lock on Row 1 and wants Row 2, while Transaction B holds Row 2 and wants Row 1 — circular wait. MySQL auto-detects and kills one transaction (error 1213). Prevention: always lock rows in the same consistent order (sort by ID), keep transactions short, use optimistic locking when appropriate, and add retry logic for the 1213 error.
