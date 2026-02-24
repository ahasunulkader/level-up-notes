# Java Concurrency

Java is a **fully multithreaded language**. All threads in a JVM process share the same heap memory. This enables fast inter-thread communication but introduces synchronization challenges that don't exist in single-threaded models.

---

## Java's Execution Model

```
JVM Process (one process for your application)
│
├── Main Thread
├── Thread-1  ─┐
├── Thread-2   ├── All share the SAME heap (objects, static fields, arrays)
├── Thread-3   │   Each thread has its OWN stack (local variables, method calls)
└── Thread-4  ─┘

Thread Stack (per thread)           Heap (shared by all threads)
┌──────────────────┐               ┌────────────────────────────┐
│ Local variable x │               │  Object: User{id=1}        │
│ Local variable y │               │  Object: Product{stock=50} │
│ Method frames    │               │  Static fields             │
└──────────────────┘               └────────────────────────────┘
```

**Key insight:** Local variables on the stack are thread-safe (each thread has its own). Objects on the heap are shared — concurrent access to the same object requires synchronization.

---

## Creating Threads

### Method 1: Extend `Thread`

```java
class MyTask extends Thread {
    @Override
    public void run() {
        System.out.println("Running in: " + Thread.currentThread().getName());
    }
}

MyTask task = new MyTask();
task.start(); // creates a new OS thread, calls run() in it
// task.run() — WRONG: runs on current thread, no new thread created
```

### Method 2: Implement `Runnable` (Preferred)

Separates the task from the thread mechanism — better design.

```java
Runnable task = () -> System.out.println("Task executing");
Thread thread = new Thread(task, "worker-thread-1");
thread.start();

// With lambda
new Thread(() -> processOrder(orderId)).start();
```

### Thread Lifecycle

```
NEW ──(start())──► RUNNABLE ──(scheduler picks it)──► RUNNING
                                                           │
                                                (I/O wait / sleep / lock)
                                                           │
                                                      BLOCKED/WAITING
                                                           │
                                                (condition met / timeout)
                                                           │
                                                       RUNNABLE
                                                           │
                                               (run() returns / exception)
                                                           │
                                                       TERMINATED
```

---

## Thread Pools — `ExecutorService`

**Never create unbounded raw threads.** Thread creation is expensive (~1MB stack per OS thread). Thread pools reuse threads and provide back-pressure.

```java
// Fixed pool — exactly N OS threads
ExecutorService fixedPool = Executors.newFixedThreadPool(4);

// Cached pool — creates threads on demand, reuses idle ones, shrinks when idle
ExecutorService cachedPool = Executors.newCachedThreadPool();

// Single thread — tasks run sequentially in one dedicated thread
ExecutorService singleThread = Executors.newSingleThreadExecutor();

// Scheduled — for delayed or periodic tasks
ScheduledExecutorService scheduled = Executors.newScheduledThreadPool(2);

// Java 21 — virtual thread per task (see Virtual Threads section)
ExecutorService vtPool = Executors.newVirtualThreadPerTaskExecutor();

// Submitting work
fixedPool.execute(() -> doWork());           // fire and forget
Future<String> future = fixedPool.submit(() -> computeResult()); // get result later

// Always shut down — otherwise the JVM won't exit
fixedPool.shutdown();           // wait for in-flight tasks to finish
fixedPool.shutdownNow();        // interrupt running tasks immediately
fixedPool.awaitTermination(30, TimeUnit.SECONDS);
```

**Why thread pools exist:** Without a pool, creating 10,000 threads crashes the JVM. A pool of 20 threads can process 10,000 tasks by queuing them — providing back-pressure.

---

## Thread Safety

Code is thread-safe when it behaves correctly under concurrent access. Code is thread-UNSAFE when shared mutable state can be corrupted.

### The Problem

```java
class Counter {
    private int count = 0; // shared mutable state

    public void increment() {
        count++; // LOOKS atomic but compiles to 3 steps:
                 // 1. READ count from memory
                 // 2. ADD 1
                 // 3. WRITE result to memory
                 // Another thread can interrupt between any step!
    }
}

// Two threads call increment() simultaneously:
// Thread 1: reads count = 100
// Thread 2: reads count = 100   ← before Thread 1 writes!
// Thread 1: writes count = 101
// Thread 2: writes count = 101  ← overwrites Thread 1's write
// Result: 101 instead of 102 — one increment is LOST
```

---

## Fix 1: `synchronized` — Intrinsic Locks

Every Java object has a built-in lock (monitor). `synchronized` acquires it — only one thread can be inside a synchronized block on the same object at a time.

```java
class SafeCounter {
    private int count = 0;

    // synchronized method — acquires lock on `this`
    public synchronized void increment() {
        count++; // now safe — other threads block here until this returns
    }

    public synchronized int getCount() {
        return count;
    }
}

// synchronized block — finer-grained (better performance: lock only the critical part)
class BetterCounter {
    private int count = 0;
    private final Object lock = new Object(); // dedicated lock object

    public void process(String input) {
        String processed = heavyParsing(input); // NOT locked — runs in parallel

        synchronized (lock) {
            count++;  // only this tiny part is locked
        }

        saveResult(processed); // NOT locked — runs in parallel
    }
}
```

**Rule:** Always hold a lock for the minimum necessary time.

**Reentrant:** A thread holding a lock CAN enter another `synchronized` block on the same object without deadlocking.

```java
synchronized void outer() {
    inner(); // safe — same thread can re-enter
}

synchronized void inner() {
    // this thread already owns the lock — no deadlock
}
```

---

## Fix 2: `volatile` — Visibility Guarantee

`volatile` forces reads/writes to go to main memory — not a CPU register or cache. It does NOT make compound operations atomic.

```java
class ServiceRunner {
    private volatile boolean running = true; // visible across threads

    public void stop() {
        running = false; // written immediately to main memory
    }

    public void run() {
        while (running) { // always reads from main memory — sees stop()'s write
            processNextItem();
        }
    }
}
```

**`volatile` vs `synchronized`:**

| | `volatile` | `synchronized` |
|---|---|---|
| Guarantees | Visibility only | Visibility + atomicity |
| Use for | Simple flags, single-variable state | Multi-step operations, compound checks |
| Performance | Faster (no lock) | Slower (lock acquisition) |
| Example | `volatile boolean running` | `synchronized void increment()` |

**`volatile` is NOT enough for `count++`** (read-modify-write) — use `AtomicInteger` for that.

---

## Fix 3: `AtomicInteger` and Atomic Classes

`java.util.concurrent.atomic` provides lock-free atomic operations using **Compare-And-Swap (CAS)** — a single CPU instruction.

```java
import java.util.concurrent.atomic.*;

class AtomicCounter {
    private final AtomicInteger count = new AtomicInteger(0);

    public void increment() {
        count.incrementAndGet(); // atomic, lock-free
    }

    public void add(int value) {
        count.addAndGet(value);
    }

    public int getAndReset() {
        return count.getAndSet(0); // atomically get current value and set to 0
    }
}

// Other atomic types
AtomicLong    visits   = new AtomicLong(0L);
AtomicBoolean flag     = new AtomicBoolean(false);
AtomicReference<User> currentUser = new AtomicReference<>(null);

// CAS — "only update if current value matches expected"
AtomicInteger stock = new AtomicInteger(10);
boolean success = stock.compareAndSet(10, 7); // set to 7 ONLY if current value is 10
// Returns true if successful, false if another thread changed it first
```

**How CAS works:**
```
compareAndSet(expected, newValue):
  If memory[address] == expected:
    memory[address] = newValue
    return true  ← atomic CPU instruction (no lock needed)
  Else:
    return false ← another thread changed it — caller can retry
```

**Available atomic classes:**

| Class | Use for |
|---|---|
| `AtomicInteger` | Thread-safe int |
| `AtomicLong` | Thread-safe long |
| `AtomicBoolean` | Thread-safe boolean |
| `AtomicReference<T>` | Thread-safe object reference |
| `LongAdder` | High-contention counters (faster than AtomicLong under heavy use) |

---

## Fix 4: `ReentrantLock` — Explicit Lock

More flexible than `synchronized`. Supports try-lock, timed lock, and interruptible waiting.

```java
import java.util.concurrent.locks.*;

class BankAccount {
    private double balance;
    private final ReentrantLock lock = new ReentrantLock();

    // Basic lock — blocks until acquired
    public void deposit(double amount) {
        lock.lock();
        try {
            balance += amount;
        } finally {
            lock.unlock(); // ALWAYS in finally — never forget to unlock!
        }
    }

    // tryLock — non-blocking, returns false immediately if locked
    public boolean tryDeposit(double amount) {
        if (lock.tryLock()) {
            try {
                balance += amount;
                return true;
            } finally {
                lock.unlock();
            }
        }
        return false; // couldn't acquire lock
    }

    // Timed lock — wait at most N seconds
    public boolean timedDeposit(double amount) throws InterruptedException {
        if (lock.tryLock(2, TimeUnit.SECONDS)) {
            try {
                balance += amount;
                return true;
            } finally {
                lock.unlock();
            }
        }
        return false; // timed out waiting
    }
}
```

**`synchronized` vs `ReentrantLock`:**

| | `synchronized` | `ReentrantLock` |
|---|---|---|
| Syntax | Language keyword | Class (`java.util.concurrent.locks`) |
| Try-lock | No | Yes (`tryLock()`) |
| Timed lock | No | Yes (`tryLock(timeout)`) |
| Interruptible | No | Yes (`lockInterruptibly()`) |
| Fairness policy | No | Yes (fair = FIFO order) |
| Condition variables | `wait()/notify()` | `Condition` (multiple per lock) |
| Ease of use | Simpler | More verbose but more powerful |

**Recommendation:** Use `synchronized` by default. Switch to `ReentrantLock` only when you need try-lock, timed lock, or multiple conditions.

---

## Fix 5: `ReadWriteLock` — Concurrent Reads, Exclusive Writes

When reads far outnumber writes, `ReadWriteLock` allows multiple concurrent readers but only one writer.

```java
class CachedProductService {
    private final ReadWriteLock rwLock = new ReentrantReadWriteLock();
    private final Lock readLock  = rwLock.readLock();
    private final Lock writeLock = rwLock.writeLock();
    private final Map<Long, Product> cache = new HashMap<>();

    public Product getProduct(Long id) {
        readLock.lock(); // multiple threads can hold readLock simultaneously
        try {
            return cache.get(id);
        } finally {
            readLock.unlock();
        }
    }

    public void updateProduct(Long id, Product product) {
        writeLock.lock(); // exclusive — blocks ALL readers and other writers
        try {
            cache.put(id, product);
        } finally {
            writeLock.unlock();
        }
    }
}
```

**When to use:** In-memory caches, config maps — read 100x more than written.

---

## Java Memory Model (JMM)

The JVM can reorder instructions and cache variables in CPU registers for performance. The JMM defines when one thread's writes become **visible** to another thread.

### Happens-Before Relationship

"A **happens-before** B" means everything A did is guaranteed visible to B.

Key rules:
- **Monitor release → next acquire:** Releasing `synchronized` happens-before the next lock on the same object
- **`volatile` write → read:** A `volatile` write happens-before any subsequent read of that variable
- **`Thread.start()` → thread body:** Everything before `start()` is visible to the started thread
- **Thread completion → `join()`:** Everything the thread did is visible after `join()` returns

```java
int x = 0;
boolean ready = false; // NOT volatile

// Thread 1
x = 42;
ready = true; // write to non-volatile

// Thread 2
while (!ready) {}  // might NEVER see true — ready is cached in CPU register
System.out.println(x); // might print 0 — x=42 might not be visible!

// FIX: make ready volatile
volatile boolean ready = false;
// volatile write happens-before volatile read → x=42 is also visible
```

---

## Concurrent Collections

Standard Java collections (`HashMap`, `ArrayList`) are NOT thread-safe.

| Collection | Thread-Safe? | Notes |
|---|---|---|
| `ArrayList` | No | Wrap with `Collections.synchronizedList()` or use `CopyOnWriteArrayList` |
| `HashMap` | No | Use `ConcurrentHashMap` |
| `HashSet` | No | Use `ConcurrentSkipListSet` or wrap |
| `LinkedList` | No | Use `ConcurrentLinkedQueue` |
| `ConcurrentHashMap` | Yes | Fine-grained locking — much faster than `Hashtable` |
| `CopyOnWriteArrayList` | Yes | Creates a new array on every write — ideal for read-heavy, rare writes |
| `BlockingQueue` | Yes | Producer-consumer — blocks on `take()`/`put()` when empty/full |
| `ConcurrentLinkedQueue` | Yes | Lock-free non-blocking queue |

```java
// ConcurrentHashMap — the go-to thread-safe map
ConcurrentHashMap<String, Integer> counts = new ConcurrentHashMap<>();

counts.put("visits", 1);
counts.merge("visits", 1, Integer::sum);  // atomic increment — thread-safe
counts.computeIfAbsent("key", k -> expensiveInit(k)); // atomic init-if-absent
counts.compute("key", (k, v) -> v == null ? 1 : v + 1); // atomic compute

// BlockingQueue — producer-consumer pattern
BlockingQueue<Order> queue = new LinkedBlockingQueue<>(100); // bounded (back-pressure!)

// Producer thread
queue.put(order);         // blocks if queue is full — natural back-pressure
queue.offer(order);       // returns false if full — non-blocking

// Consumer thread
Order order = queue.take();   // blocks until item available
Order order = queue.poll();   // returns null if empty — non-blocking
Order order = queue.poll(5, TimeUnit.SECONDS); // wait up to 5s
```

**Real-life use:** `BlockingQueue` is used internally in thread pool implementations — worker threads call `take()` and block, waiting for work. The pool submitter calls `put()` to feed them.

---

## `Future<T>` — Basic Async Result

```java
ExecutorService pool = Executors.newFixedThreadPool(4);

// Submit a callable — returns a Future (handle to the async result)
Future<String> future = pool.submit(() -> {
    Thread.sleep(2000);
    return "result";
});

// Do other work here while the task runs in another thread
doOtherWork();

// Get result — BLOCKS the current thread until done
String result = future.get();                          // blocks indefinitely
String result = future.get(5, TimeUnit.SECONDS);      // blocks up to 5s, throws TimeoutException

boolean done = future.isDone();     // check without blocking
future.cancel(true);                // attempt to cancel (interrupts if running)
```

---

## `CompletableFuture<T>` — Async Pipeline (Java 8+)

`CompletableFuture` lets you chain async operations without blocking, similar to JavaScript Promises.

```java
// Non-blocking async chain
CompletableFuture<UserProfile> result = CompletableFuture
    .supplyAsync(() -> userRepo.findById(userId))          // step 1: async fetch
    .thenApply(user -> profileService.enrich(user))        // step 2: transform (same thread)
    .thenApplyAsync(user -> formatForApi(user), pool)      // step 3: async on pool
    .exceptionally(ex -> {                                  // error handler
        logger.error("Failed", ex);
        return UserProfile.empty();
    });

// Block only at the end when you truly need the result
UserProfile profile = result.get(5, TimeUnit.SECONDS);
```

**Run multiple tasks in parallel and wait for all:**
```java
CompletableFuture<User>   userF   = CompletableFuture.supplyAsync(() -> getUser(id));
CompletableFuture<Orders> ordersF = CompletableFuture.supplyAsync(() -> getOrders(id));
CompletableFuture<Prefs>  prefsF  = CompletableFuture.supplyAsync(() -> getPrefs(id));

// Wait for ALL three — they run in parallel
CompletableFuture.allOf(userF, ordersF, prefsF).thenRun(() -> {
    User   user   = userF.join();   // join() = get() without checked exception
    Orders orders = ordersF.join();
    Prefs  prefs  = prefsF.join();
    buildAndSaveProfile(user, orders, prefs);
}).get();
```

**Wait for the FIRST to complete:**
```java
CompletableFuture<String> fastest = CompletableFuture
    .anyOf(primaryServer.fetch(), backupServer.fetch())
    .thenApply(result -> (String) result);
```

**Combine two results:**
```java
CompletableFuture<Report> report = userF.thenCombine(ordersF,
    (user, orders) -> reportGenerator.build(user, orders)
);
```

**`thenApply` vs `thenCompose`:**

| Method | Use when |
|---|---|
| `thenApply(fn)` | Transform result synchronously (like `map`) |
| `thenApplyAsync(fn)` | Transform on a different thread |
| `thenCompose(fn)` | Chain another `CompletableFuture` (like `flatMap`) |
| `thenCombine(other, fn)` | Merge results of two futures |
| `exceptionally(fn)` | Handle errors, return fallback |
| `handle(fn)` | Handle both success and failure |

---

## Thread Coordination

### `wait()` / `notify()` — Low-Level Signaling

```java
class SharedBuffer {
    private final Queue<String> buffer = new LinkedList<>();
    private final int maxSize = 10;

    public synchronized void produce(String item) throws InterruptedException {
        while (buffer.size() == maxSize) {
            wait(); // release lock and sleep until notified
        }
        buffer.add(item);
        notifyAll(); // wake up waiting consumers
    }

    public synchronized String consume() throws InterruptedException {
        while (buffer.isEmpty()) {
            wait(); // release lock and sleep until notified
        }
        String item = buffer.poll();
        notifyAll(); // wake up waiting producers
        return item;
    }
}
```

> Always use `while` not `if` with `wait()` — **spurious wakeups** can occur (thread wakes without being notified). Re-check the condition.

### `CountDownLatch` — Wait for N Events

```java
// Wait for 3 services to initialize before accepting traffic
CountDownLatch latch = new CountDownLatch(3);

new Thread(() -> { initDatabase(); latch.countDown(); }).start();
new Thread(() -> { initCache();    latch.countDown(); }).start();
new Thread(() -> { initBroker();   latch.countDown(); }).start();

latch.await(); // main thread blocks until count reaches 0
startServer(); // now safe to start
```

### `CyclicBarrier` — All Threads Rendezvous at a Point

```java
// 4 worker threads each process their chunk, then all merge together
CyclicBarrier barrier = new CyclicBarrier(4, () -> {
    mergeResults(); // runs when ALL 4 reach the barrier (runs once)
});

for (int i = 0; i < 4; i++) {
    final int chunk = i;
    pool.submit(() -> {
        processChunk(data[chunk]);
        barrier.await(); // wait here until all 4 threads arrive
    });
}
```

### `Semaphore` — Limit Concurrent Access

```java
// Allow at most 5 threads to access a resource simultaneously
Semaphore semaphore = new Semaphore(5);

public void accessResource() throws InterruptedException {
    semaphore.acquire(); // blocks if 5 permits already taken
    try {
        useResource();
    } finally {
        semaphore.release(); // return the permit
    }
}
```

**Real-life use:** Database connection pool — limit 20 concurrent DB connections. Semaphore starts at 20; each thread acquires a permit to use a connection and releases it when done.

---

## Deadlocks in Java

A deadlock occurs when two threads each hold a lock the other needs.

```java
Object lock1 = new Object();
Object lock2 = new Object();

// Thread A
synchronized (lock1) {
    Thread.sleep(50);
    synchronized (lock2) { // waits for Thread B to release lock2 — DEADLOCK
        doWork();
    }
}

// Thread B (running concurrently)
synchronized (lock2) {
    Thread.sleep(50);
    synchronized (lock1) { // waits for Thread A to release lock1 — DEADLOCK
        doWork();
    }
}
```

**Prevention — consistent lock ordering:**
```java
void transfer(Account from, Account to, double amount) {
    // Always lock lower ID first — regardless of transfer direction
    Account first  = from.id < to.id ? from : to;
    Account second = from.id < to.id ? to   : from;

    synchronized (first) {
        synchronized (second) {
            from.balance -= amount;
            to.balance   += amount;
        }
    }
    // Thread A and Thread B now always lock the same account first
    // → no circular wait → no deadlock
}
```

**Detection with `jstack`:**
```bash
jstack <pid>
# Output:
# Found 1 deadlock.
# Thread "Thread-1": waiting for monitor 0x00007f... (held by Thread-2)
# Thread "Thread-2": waiting for monitor 0x00007f... (held by Thread-1)
```

**Prevention rules:**
1. Always acquire locks in a consistent order
2. Use `tryLock(timeout)` instead of blocking forever
3. Keep synchronized blocks short
4. Prefer `AtomicInteger` / `ConcurrentHashMap` over manual locking
5. Use higher-level abstractions (`BlockingQueue`, `CompletableFuture`) where possible

---

## Virtual Threads (Java 21)

Virtual threads are **lightweight threads managed by the JVM**, not the OS. You can create millions without the resource overhead of OS threads.

```java
// Traditional OS thread (~1MB stack, OS-managed scheduling)
Thread osThread = new Thread(() -> handleRequest(req));
osThread.start();

// Virtual thread (~few KB, JVM-managed scheduling)
Thread vThread = Thread.ofVirtual().start(() -> handleRequest(req));

// With executor — one virtual thread per task
try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (Request req : requests) {
        executor.submit(() -> handleRequest(req)); // each gets its own virtual thread
    }
}
```

**How virtual threads work:**
```
Virtual Thread 1 ─┐
Virtual Thread 2  ├── multiplexed onto ──► OS Thread (carrier thread)
Virtual Thread 3  │                            │
Virtual Thread 4 ─┘                     JVM scheduler
                                               │
                              When a VT blocks on I/O, the carrier thread
                              is freed to run another virtual thread
```

**Why virtual threads are significant:**

| | OS Threads | Virtual Threads |
|---|---|---|
| Creation cost | ~1MB stack, slow | ~few KB, very fast |
| Max practical count | ~thousands | ~millions |
| I/O blocking | Blocks OS thread (wastes it) | Parks VT, carrier thread freed |
| Context switch | OS kernel switch (slow) | JVM switch (fast) |
| Code style | Callback hell or reactive | Plain blocking code |

```java
// Before Java 21 — reactive style to avoid blocking OS threads
Mono<User> user = userRepo.findById(id)    // reactive
    .flatMap(u -> orderRepo.findByUser(u)) // reactive chain
    .map(orders -> buildProfile(u, orders));

// Java 21 — simple blocking code works fine with virtual threads!
User user = userRepo.findById(id);         // "blocks" — but only parks virtual thread
Orders orders = orderRepo.findByUser(user);
Profile profile = buildProfile(user, orders);
```

**When to use virtual threads:** I/O-bound workloads (HTTP servers, database calls, file operations). NOT CPU-bound work (still use fixed thread pools for that).

---

## Interview Q&A — Java Concurrency

**Q: What is the difference between `synchronized` and `ReentrantLock`?**
A: `synchronized` is a Java keyword — simpler but limited: can't try-lock without blocking, no timeout, no interruptible waits. `ReentrantLock` is a class offering `tryLock()`, timed locks, and interruptible waits. Use `synchronized` by default; switch to `ReentrantLock` when you need its advanced features. Both are reentrant — the same thread can acquire the same lock multiple times.

**Q: What is `volatile` and when is it NOT enough?**
A: `volatile` ensures a variable is read from/written to main memory, not a CPU cache — guaranteeing visibility. It's sufficient for simple flags (`volatile boolean running`). It's NOT enough for compound operations like `count++` (read-modify-write) — for that, use `AtomicInteger` or `synchronized`.

**Q: What is Compare-And-Swap (CAS) and how does `AtomicInteger` use it?**
A: CAS is a single atomic CPU instruction: "set this memory location to new_value only if it currently equals expected_value." `AtomicInteger.compareAndSet(expected, newValue)` uses this — if the value changed (another thread modified it), it returns false and you retry. This achieves thread safety without locks — hence "lock-free."

**Q: What is the Java Memory Model and why does it matter?**
A: The JMM defines when a thread's writes to shared variables become visible to other threads. Without synchronization, the JVM can reorder instructions and cache values in CPU registers — so Thread 2 may never see Thread 1's write. Use `synchronized`, `volatile`, or `Atomic*` classes to establish happens-before guarantees that ensure visibility.

**Q: When would you use `CompletableFuture` over a raw `Future`?**
A: `Future.get()` blocks the calling thread — you can't chain operations without blocking. `CompletableFuture` lets you compose async pipelines (`thenApply`, `thenCompose`), run tasks in parallel (`allOf`), handle errors (`exceptionally`), and combine results (`thenCombine`) — all without blocking until you truly need the final result.

**Q: What are virtual threads (Java 21) and when should you use them?**
A: Virtual threads are lightweight JVM-managed threads — millions can coexist vs. thousands of OS threads. When a virtual thread blocks on I/O, the JVM parks it and frees the underlying OS thread to run another virtual thread. Use them for I/O-bound workloads (HTTP, DB calls) to handle massive concurrency with simple blocking code. For CPU-bound work, still use fixed-size OS thread pools.

**Q: What is a `BlockingQueue` and what problem does it solve?**
A: `BlockingQueue` is a thread-safe queue where producers wait (`put()`) when full and consumers wait (`take()`) when empty — providing natural back-pressure. It decouples producers from consumers and prevents producers from overwhelming consumers. `LinkedBlockingQueue` with a bounded capacity is the standard choice for producer-consumer patterns and thread pool work queues.

**Q: How do you detect and prevent deadlocks in Java?**
A: Detection: use `jstack <pid>` to dump thread states — it explicitly reports deadlocks. Prevention: (1) always acquire multiple locks in the same consistent order, (2) use `tryLock(timeout)` to avoid infinite waits, (3) keep synchronized blocks short, (4) prefer higher-level concurrent utilities (`ConcurrentHashMap`, `BlockingQueue`) over manual synchronized blocks.
