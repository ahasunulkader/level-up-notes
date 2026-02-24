# PHP vs Java — Concurrency Comparison

This page compares how PHP and Java solve the same concurrency problems side by side. Both languages achieve correct concurrent behavior, but through fundamentally different mechanisms.

---

## Execution Model Comparison

| | PHP | Java |
|---|---|---|
| Unit of concurrency | OS Process (PHP-FPM worker) | OS Thread (within JVM) |
| Memory isolation | Full — each process has its own memory | None — all threads share the same heap |
| Where races happen | Shared external resources (DB, Redis, files) | Shared objects in memory |
| Shared state mechanism | Database, Redis, files | Java heap (objects, static fields) |
| Creating async work | Queue jobs, Events, Fibers | Threads, ExecutorService, CompletableFuture |
| Lightweight concurrency | PHP 8.1 Fibers | Java 21 Virtual Threads |

---

## Side-by-Side: Solving the Same Problems

### 1. Atomic Counter

**Problem:** Increment a shared counter from multiple concurrent workers/threads.

```php
// PHP — use Redis (single-threaded, atomic by design)
$redis->incr('page_views');

// PHP — use DB atomic update (no read-modify-write in PHP)
DB::table('counters')
    ->where('key', 'visits')
    ->increment('value', 1);
// → UPDATE counters SET value = value + 1 WHERE key = 'visits'
```

```java
// Java — AtomicInteger (lock-free CAS)
private final AtomicInteger counter = new AtomicInteger(0);
counter.incrementAndGet();

// Java — synchronized (simple lock)
private int counter = 0;
public synchronized void increment() { counter++; }

// Java — LongAdder (fastest under high contention)
private final LongAdder counter = new LongAdder();
counter.increment();
long total = counter.sum();
```

**Why different?** PHP workers can't share in-process memory — they must coordinate through Redis or the database. Java threads share memory directly so you can use in-process synchronization.

---

### 2. Pessimistic Lock — Exclusive Access to a Resource

**Problem:** Ensure only one worker/thread can modify an order at a time.

```php
// PHP — database row lock
DB::transaction(function () use ($orderId) {
    $order = Order::lockForUpdate()->find($orderId);
    // SELECT * FROM orders WHERE id = ? FOR UPDATE
    // Other transactions trying to lock this row will BLOCK

    if ($order->status !== 'pending') {
        throw new \RuntimeException('Already processed');
    }
    $order->update(['status' => 'processing']);
    // Lock released on commit
});
```

```java
// Java — synchronized method
public synchronized void processOrder(Order order) {
    if (!order.getStatus().equals("pending")) {
        throw new IllegalStateException("Already processed");
    }
    order.setStatus("processing");
    orderRepo.save(order);
}

// Java — ReentrantLock (per-order locks using a map)
private final ConcurrentHashMap<Long, ReentrantLock> orderLocks = new ConcurrentHashMap<>();

public void processOrder(long orderId) {
    ReentrantLock lock = orderLocks.computeIfAbsent(orderId, id -> new ReentrantLock());
    lock.lock();
    try {
        Order order = orderRepo.findById(orderId).orElseThrow();
        order.setStatus("processing");
        orderRepo.save(order);
    } finally {
        lock.unlock();
    }
}
```

---

### 3. Optimistic Lock — Detect Conflict at Write Time

**Problem:** High-read, low-write scenario — don't block readers, detect conflicts on save.

```php
// PHP — version column in database
$product = Product::find($productId);
$newStock = $product->stock - $qty;

$affected = Product::where('id', $productId)
    ->where('version', $product->version)       // must match
    ->update([
        'stock'   => $newStock,
        'version' => DB::raw('version + 1'),
    ]);

if ($affected === 0) {
    throw new \RuntimeException('Conflict — retry');
}
```

```java
// Java — @Version annotation (JPA/Hibernate handles it automatically)
@Entity
class Product {
    @Id Long id;
    int stock;

    @Version  // Hibernate adds WHERE version = ? to every UPDATE automatically
    int version;
}

// Usage — Hibernate throws OptimisticLockException if version mismatches
Product product = em.find(Product.class, productId);
product.setStock(product.getStock() - qty);
em.merge(product); // throws OptimisticLockException if another transaction committed first

// Java — manual CAS with AtomicReference (in-memory)
AtomicReference<ProductState> stateRef = new AtomicReference<>(initialState);
ProductState current = stateRef.get();
ProductState updated = new ProductState(current.stock - qty, current.version + 1);
boolean success = stateRef.compareAndSet(current, updated); // atomic swap
```

---

### 4. Distributed Lock — Coordinate Across Multiple Servers

**Problem:** A scheduled job should run only once even if deployed on 3 servers.

```php
// PHP — Redis SET NX EX (atomic: set only if not exists)
$token = uniqid('lock_', true);
$acquired = $redis->set("lock:daily-report", $token, ['NX', 'EX' => 300]);

if (!$acquired) {
    return; // Another server got the lock
}

try {
    generateDailyReport();
} finally {
    if ($redis->get("lock:daily-report") === $token) {
        $redis->del("lock:daily-report");
    }
}

// Laravel shorthand
Cache::lock('daily-report', 300)->get(function () {
    generateDailyReport();
});
```

```java
// Java — Redisson (Redis client with distributed lock)
RLock lock = redisson.getLock("daily-report");

if (lock.tryLock(0, 300, TimeUnit.SECONDS)) {
    try {
        generateDailyReport();
    } finally {
        lock.unlock();
    }
}

// Java — database-based distributed lock (no Redis needed)
// INSERT INTO locks (name, locked_at) VALUES (?, NOW())
// ON DUPLICATE KEY UPDATE → fails if row exists
// Atomically "claims" the lock
```

**Same pattern, different clients.** Both use Redis `SET NX EX` under the hood.

---

### 5. Async Background Work

**Problem:** After a checkout, send email and update inventory without blocking the response.

```php
// PHP — Laravel Queue (jobs processed by separate worker processes)
public function checkout(Request $request): JsonResponse
{
    $order = Order::create($request->validated());
    $order->charge();

    // Dispatch to queue — worker processes asynchronously
    SendConfirmationEmail::dispatch($order);
    UpdateInventory::dispatch($order);

    return response()->json(['order_id' => $order->id]);
}

class SendConfirmationEmail implements ShouldQueue {
    public function handle(): void {
        Mail::to($this->order->user)->send(new Receipt($this->order));
    }
}
```

```java
// Java — CompletableFuture (async in same process)
public ResponseEntity<Order> checkout(CheckoutRequest req) {
    Order order = orderService.create(req);
    paymentService.charge(order); // sync

    // Fire async tasks — don't block response
    CompletableFuture.runAsync(() -> emailService.sendReceipt(order), emailPool);
    CompletableFuture.runAsync(() -> inventoryService.update(order), inventoryPool);

    return ResponseEntity.ok(order);
}

// Java — with message queue (Kafka/RabbitMQ) for cross-service
@EventListener
public void onOrderPlaced(OrderPlacedEvent event) {
    kafkaTemplate.send("order-events", event);
    // Consumers in other services pick this up
}
```

**Key difference:** PHP queues persist jobs to Redis/DB — they survive server restarts and can be retried. Java `CompletableFuture` is in-memory — if the JVM crashes, the task is lost. For reliability, Java also uses message queues (Kafka, RabbitMQ).

---

### 6. Rate Limiting Concurrent Access — Semaphore

**Problem:** Allow at most N concurrent connections to an external API.

```php
// PHP — Redis semaphore (manual)
$key = 'semaphore:external-api';
$limit = 10;

$current = $redis->incr($key);
$redis->expire($key, 60);

if ($current > $limit) {
    $redis->decr($key);
    throw new \RuntimeException('Too many concurrent API calls');
}

try {
    $result = callExternalApi();
} finally {
    $redis->decr($key);
}

// Laravel — concurrency limiter
RateLimiter::attempt('external-api', 10, function () {
    return callExternalApi();
});
```

```java
// Java — Semaphore (in-process)
private final Semaphore semaphore = new Semaphore(10); // 10 permits

public String callExternalApi() throws InterruptedException {
    semaphore.acquire(); // blocks if 10 calls already in flight
    try {
        return httpClient.get("https://api.example.com/data");
    } finally {
        semaphore.release(); // return the permit
    }
}

// Non-blocking version
if (semaphore.tryAcquire()) {
    try {
        return callExternalApi();
    } finally {
        semaphore.release();
    }
} else {
    throw new RuntimeException("Too many concurrent API calls");
}
```

---

### 7. Parallel Data Processing

**Problem:** Process 1,000 records as fast as possible.

```php
// PHP — chunk + queue (parallel workers)
Order::chunk(100, function ($orders) {
    foreach ($orders as $order) {
        ProcessOrder::dispatch($order); // queue job for each
    }
});
// Multiple queue workers process these in parallel

// PHP — Spatie Async (process-based parallelism)
$pool = Pool::create()->concurrency(4);
foreach ($orders as $order) {
    $pool->add(fn () => processOrder($order));
}
$pool->wait();
```

```java
// Java — parallel stream (fork-join pool)
orders.parallelStream()
      .forEach(order -> processOrder(order));

// Java — ExecutorService with invokeAll
List<Callable<Void>> tasks = orders.stream()
    .map(order -> (Callable<Void>) () -> { processOrder(order); return null; })
    .collect(toList());

pool.invokeAll(tasks); // submits all, waits for completion

// Java — CompletableFuture parallel fan-out
List<CompletableFuture<Void>> futures = orders.stream()
    .map(order -> CompletableFuture.runAsync(() -> processOrder(order), pool))
    .collect(toList());

CompletableFuture.allOf(futures.toArray(new CompletableFuture[0])).join();
```

---

## Key Conceptual Differences

### Memory Sharing

```
PHP
┌──────────────────┐    ┌──────────────────┐
│   Worker 1       │    │   Worker 2       │
│  $stock = 10     │    │  $stock = 10     │  ← different variables!
│  (own memory)    │    │  (own memory)    │
└──────────────────┘    └──────────────────┘
         │                       │
         └──────────┬────────────┘
                    ▼
             MySQL: stock = 10    ← shared state is HERE

Java
┌──────────────────────────────────────────┐
│                 JVM Heap                 │
│   Product{ id=1, stock=10, version=3 }  │  ← ONE object
└──────────────────────────────────────────┘
         ▲                  ▲
    Thread 1           Thread 2   ← both access THE SAME object
```

### Failure Scope

| Scenario | PHP | Java |
|---|---|---|
| Worker/thread crashes | Only that request fails | Can corrupt shared state if unhandled |
| Unhandled exception | Process dies, FPM restarts it | Kills only the thread (others continue) unless uncaught in main |
| Memory leak | Dies with the request | Persists, grows over time — can OOM the JVM |
| Infinite loop | Request times out, worker killed | Thread runs forever, starves other threads |

### Lock Scope

| Lock type | PHP scope | Java scope |
|---|---|---|
| Database lock (`FOR UPDATE`) | Cross-process, cross-server | Cross-thread, cross-server |
| Redis lock | Cross-process, cross-server | Cross-thread, cross-server |
| `synchronized` / `ReentrantLock` | N/A (not applicable) | Same JVM process only |
| `AtomicInteger` / `volatile` | N/A | Same JVM process only |
| File lock (`flock`) | Cross-process, same machine | Cross-thread, same machine |

---

## When Each Approach is Better

### Use PHP's approach (process isolation) when:

- **Simplicity matters** — no shared memory means no data races within a process
- **Fault isolation** — a crashing worker doesn't corrupt shared state
- **Horizontal scaling** — add more FPM workers or more servers easily
- **Stateless requests** — typical web app CRUD operations

### Use Java's approach (shared memory threads) when:

- **High throughput in a single process** — thread context switches are cheaper than process switches
- **Low-latency communication** — threads can share objects directly without serialization
- **Stateful processing** — long-running jobs that maintain in-memory state (caches, aggregations)
- **CPU-bound parallelism** — parallel streams, Fork/Join for computation-heavy work

---

## Common Interview Questions

**Q: How does PHP handle concurrency differently from Java?**
A: PHP uses process-based concurrency — each request runs in its own isolated OS process with no shared memory. Java uses thread-based concurrency — multiple threads share the same heap. This means PHP's concurrency problems appear at external shared resources (DB, Redis), while Java's appear within the process itself (shared objects). PHP is simpler to reason about; Java enables higher-throughput within a single process.

**Q: Why does PHP use Redis for distributed locks but Java uses `synchronized`?**
A: `synchronized` only works within a single JVM process — it's in-memory. PHP workers are separate OS processes and can run on different servers, so they need an external coordination mechanism (Redis). Java can use `synchronized` for single-JVM coordination, but also needs Redis/Redisson when coordinating across multiple JVM instances (e.g., microservices, clustered deployments).

**Q: Can Java use the same database-level locking that PHP uses?**
A: Yes — Java can use `SELECT FOR UPDATE` and transaction isolation levels through JDBC, JPA, or Hibernate just like PHP does. The difference is that Java also has in-process options (`synchronized`, `AtomicInteger`) that are faster than database locks for in-process coordination. PHP lacks in-process options because processes don't share memory.

**Q: Is PHP's model safer than Java's?**
A: In some ways yes — process isolation means a bug in one request can't corrupt another request's memory. Java's shared heap means a poorly synchronized class can corrupt state seen by all threads. However, PHP still has race conditions at the database/Redis level, which require the same care as Java's in-process races. PHP is "safer by default"; Java requires more discipline but offers more performance.

**Q: PHP has queues, Java has threads — are they solving the same problem?**
A: Partially. Both enable async/background work. Laravel queues are designed for **cross-process, cross-server work** with persistence (jobs survive restarts) and retry logic. Java threads are **in-process** — faster but not persistent. Java also uses message queues (Kafka, RabbitMQ) for cross-process/cross-service async work, which is equivalent to Laravel queues.

**Q: What does Java 21 Virtual Threads change?**
A: Before Java 21, handling 10,000 concurrent I/O-bound requests required either a thread pool (limited to ~hundreds of OS threads, blocking), or reactive programming (complex code). Virtual threads allow one virtual thread per task — they park cheaply when blocking on I/O and resume when data is ready, making millions of concurrent requests feasible with simple blocking code. This makes Java's model more similar to PHP's "one-request-one-unit" model but within a single JVM process.
