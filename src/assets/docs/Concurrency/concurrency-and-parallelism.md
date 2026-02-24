# Concurrency & Parallelism

Concurrency and parallelism are fundamental concepts in software engineering. Every language solves them differently based on its execution model. This section breaks them down by language and then compares approaches.

---

## What Is Concurrency?

**Multiple tasks make progress by interleaving.** The CPU switches between tasks rapidly — they may not literally run at the same instant.

```
Time →
Task A: ██░░██░░██
Task B: ░░██░░██░░
         (interleaved on 1 CPU core)
```

**Think of it as:** One chef juggling multiple dishes — chopping for dish A, then stirring dish B, then back to dish A. Only one action happens at a time, but both dishes progress.

---

## What Is Parallelism?

**Multiple tasks execute at the same time** on multiple CPU cores.

```
Time →
Task A: ████████
Task B: ████████
         (truly simultaneous on 2 CPU cores)
```

**Think of it as:** Two chefs, each cooking their own dish simultaneously.

---

## Key Distinction

| | Concurrency | Parallelism |
|---|---|---|
| Definition | Tasks make progress by interleaving | Tasks run simultaneously |
| CPU cores needed | 1 (or more) | Multiple (required) |
| Goal | Responsiveness, I/O efficiency | Throughput, raw speed |
| Example | Single-core multitasking | Multi-core processing |

> **Interview insight:** Concurrency is about **structure** — designing tasks that can overlap. Parallelism is about **execution** — physically running at the same time. You can have concurrency without parallelism (single CPU, context switching), but parallelism always involves concurrency.

---

## How Each Language Handles It

| | PHP | Java |
|---|---|---|
| Execution unit | OS process per request (FPM) | OS threads sharing JVM heap |
| Shared memory | No — each process is isolated | Yes — all threads share heap |
| Concurrency problems arise in | Shared external resources (DB, Redis, files) | Shared objects within the same process |
| Async model | Queues, events (Laravel), Fibers (8.1) | Threads, CompletableFuture, Virtual Threads (21) |
| Lightweight tasks | Queue workers, Fibers | Virtual Threads (Java 21) |

---

## Pages in This Section

- **[PHP Concurrency](php-concurrency.md)** — FPM model, database locking, Redis locks, queues, Fibers
- **[Java Concurrency](java-concurrency.md)** — Threads, synchronized, AtomicInteger, CompletableFuture, Virtual Threads
- **[PHP vs Java Comparison](concurrency-comparison.md)** — Side-by-side patterns, when to use each, interview Q&A
