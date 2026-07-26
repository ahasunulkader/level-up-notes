# Concurrent Java Scheduler for Multi-API Data Fetch & Caching

## Resume Line
> "Developed a concurrent Java scheduler to fetch and cache data from three external APIs at a user-defined interval; maintained 99.9% task execution reliability."

## TL;DR
This bullet tests core Java concurrency fundamentals (thread pools, scheduling primitives, thread safety of shared cache state) plus production-reliability engineering (retries, timeouts, failure isolation, and how you actually measured "99.9%" instead of making the number up). The interviewer wants to see you reason about what happens when one of three APIs is slow or down while the other two are fine, and how a naive scheduler design turns one flaky dependency into a full outage.

## The Story (STAR-style anchor)
**Situation:** A dashboard feature needed near-real-time data aggregated from three external partner APIs (pricing, inventory, and shipping-ETA providers), each with different rate limits and latency characteristics, refreshed on a per-tenant, user-configurable interval (some tenants wanted 30-second refresh, others 15 minutes).

**Task:** I was asked to build the scheduling and caching layer that would keep this data fresh without hammering the partner APIs or letting one slow provider block the other two, and to make it reliable enough that dashboard staleness wasn't a recurring support ticket.

**Action:** I built a scheduler on top of a `ScheduledThreadPoolExecutor` with a dedicated task per tenant-interval combination, so each tenant's refresh cadence ran independently. Each scheduled task fanned out to the three APIs concurrently using `CompletableFuture.supplyAsync` on a separate bounded executor (isolated from the scheduling pool so a stuck HTTP call couldn't starve the scheduler's own threads), each wrapped with a per-call timeout, a bounded retry with exponential backoff for transient failures (503s, timeouts), and a simple circuit breaker per external API so a provider having an outage didn't get hammered with retries from every tenant simultaneously. Results were written into a Caffeine in-memory cache (with a Redis-backed second layer for cross-instance consistency since the app ran on multiple pods) keyed by tenant+API, with the previous good value retained and served (with a staleness flag) if a given refresh cycle failed, rather than the dashboard going blank. I instrumented every task execution (success/failure/timeout/circuit-open) into Micrometer counters so reliability was measurable, not assumed.

**Result:** The scheduler ran reliably across the tenant base with a measured task-success rate of 99.9% over rolling 30-day windows (tracked via the Micrometer counters feeding a Grafana dashboard), and the stale-but-available cache fallback meant that even during a ~40-minute outage of one partner API, the dashboard degraded gracefully (showing slightly stale data with a visible "last updated" timestamp) instead of erroring out for affected tenants.

## Q&A — Foundational

**Q: What's the difference between `Executors.newScheduledThreadPool()` and `ScheduledThreadPoolExecutor` directly?**
A: `Executors.newScheduledThreadPool(n)` is a factory method that returns a `ScheduledThreadPoolExecutor` with default settings; I used the class directly so I could tune `setRemoveOnCancelPolicy(true)` (so cancelled per-tenant tasks don't linger in the internal delay queue) and set a custom `ThreadFactory` for named, daemon threads that are easier to spot in thread dumps.
```java
ScheduledThreadPoolExecutor scheduler = new ScheduledThreadPoolExecutor(
    poolSize,
    new ThreadFactoryBuilder().setNameFormat("api-scheduler-%d").setDaemon(true).build());
scheduler.setRemoveOnCancelPolicy(true);
```

**Q: How did you fetch three APIs concurrently instead of sequentially?**
A: `CompletableFuture.supplyAsync` for each call on a shared bounded executor, then combined with `CompletableFuture.allOf` (or `anyOf` variants where partial results were acceptable) so the total task latency was bounded by the slowest of the three calls, not the sum of all three.
```java
CompletableFuture<PricingData> pricing = CompletableFuture.supplyAsync(() -> pricingClient.fetch(tenantId), apiExecutor)
        .orTimeout(3, TimeUnit.SECONDS);
CompletableFuture<InventoryData> inventory = CompletableFuture.supplyAsync(() -> inventoryClient.fetch(tenantId), apiExecutor)
        .orTimeout(3, TimeUnit.SECONDS);
CompletableFuture<ShippingEta> shipping = CompletableFuture.supplyAsync(() -> shippingClient.fetch(tenantId), apiExecutor)
        .orTimeout(3, TimeUnit.SECONDS);

CompletableFuture.allOf(pricing, inventory, shipping)
        .handle((v, ex) -> mergeAndCache(tenantId, pricing, inventory, shipping));
```

**Q: How did you support a user-defined refresh interval per tenant?**
A: Each tenant's task was scheduled with `scheduleAtFixedRate` (or `scheduleWithFixedDelay` — see next question for why I picked one over the other) using that tenant's configured interval read from a settings table; when a tenant changed their interval, I cancelled the existing `ScheduledFuture` for that tenant and rescheduled with the new period rather than trying to mutate a running scheduled task.

**Q: `scheduleAtFixedRate` vs `scheduleWithFixedDelay` — which did you use and why?**
A: I used `scheduleWithFixedDelay` for this use case, because `scheduleAtFixedRate` can back up and fire tasks in rapid succession if a run takes longer than the interval (e.g., a slow API call), which for a fetch-and-cache job risks overlapping refreshes hammering the same APIs. `scheduleWithFixedDelay` guarantees a gap after each run finishes, which better matched "don't call the partner APIs more often than the configured interval."

**Q: How did you make the cache safe for concurrent reads and writes across multiple scheduled tasks?**
A: I used Caffeine's `AsyncLoadingCache`, which handles the read/write concurrency internally with proper memory visibility guarantees, instead of hand-rolling a `ConcurrentHashMap` with manual staleness logic — Caffeine also gave me built-in TTL and size-based eviction, which I'd have had to reimplement otherwise.

**Q: Why Caffeine plus Redis rather than just Redis alone?**
A: Caffeine as an in-process L1 cache avoids a network round-trip for the extremely hot read path (dashboard polling), while Redis as L2 gives cross-instance consistency since the app ran on multiple pods behind a load balancer — without it, each pod would refetch from partner APIs independently, multiplying our call volume by pod count.

**Q: How did you handle a task throwing an unchecked exception mid-execution — does that kill the scheduler?**
A: `ScheduledThreadPoolExecutor` silently swallows and stops rescheduling a periodic task if it throws — the future is asked for a `.get()` normally, but since periodic tasks are re-submitted internally, an uncaught exception effectively kills that specific tenant's future runs without you noticing unless you check. I wrapped every task body in a try/catch that logs and increments a failure metric, so an exception never escapes the scheduled `Runnable`, and I additionally checked `Future.isDone()`/exception state on a periodic health-check pass in case one still slipped through.

## Q&A — Why This, Not That (Decision Tree)

**Q: Why a custom `ScheduledThreadPoolExecutor`-based scheduler instead of Quartz?**
A: Quartz's persistence, clustering, and misfire-handling machinery is valuable when you need durable, crash-recoverable schedules (e.g., "this job must run even if the app restarted right at the trigger time") or complex cron-like scheduling across a cluster with job-store coordination. Our use case was per-tenant, in-memory, best-effort periodic refresh of a cache — losing one refresh cycle on a restart is a non-issue since the next cycle just runs a few seconds/minutes later, so Quartz's persistence overhead (a `JobStore` DB, more moving parts to operate) bought us nothing but added an operational dependency.

**Q: But what if you did need it to survive restarts without losing schedule state, e.g., tenant-specific intervals need to persist?**
A: The interval configuration itself was already persisted in our settings table (that's a config value, not scheduler state), so on app startup I just re-read tenant configs and re-scheduled fresh `ScheduledFuture`s for each — I didn't need to persist "when the next fire time is" because losing a few seconds/minutes of precision on restart was acceptable for a cache-refresh job, unlike, say, a billing job where exact fire time matters.

**Q: Why not Spring's `@Scheduled` annotation instead of manually managing `ScheduledThreadPoolExecutor`?**
A: `@Scheduled` is great for a small, fixed number of static schedules known at compile time (e.g., "run this cleanup job every night at 2am"), but our intervals were dynamic and per-tenant — potentially hundreds of different cadences configured at runtime — which `@Scheduled`'s static annotation-based model doesn't support without building the same dynamic-scheduling machinery on top of it anyway. I did use Spring for dependency injection of the clients/executors, just not `@Scheduled` for the actual scheduling.

**Q: What about a distributed job runner like a Kubernetes CronJob per tenant?**
A: That would mean spinning up a pod per tenant per interval — fine at low cadence (nightly jobs) but completely impractical at 30-second refresh intervals for potentially hundreds of tenants; pod startup latency alone would blow past a 30-second interval. In-process scheduling with a shared thread pool amortizes overhead across all tenants instead of paying container startup cost per cycle.

**Q: OK, but doesn't an in-process scheduler mean if the app instance crashes, every tenant's refresh on that instance just stops silently?**
A: Yes, which is why the cache-with-stale-fallback design mattered as much as the scheduler itself — a crashed instance means that instance's tenants serve slightly staler data (bounded by however long the deployment's health checks take to reroute/restart), not an error, and Kubernetes restarting the pod triggers the startup re-scheduling logic automatically. It's a graceful-degradation story, not a zero-downtime guarantee, which was an acceptable trade-off for a dashboard-freshness feature, not a critical transactional path.

**Q: Why fetch the three APIs concurrently per task instead of one big sequential loop across tenants and APIs?**
A: Sequential fetch means total latency per tenant is the sum of three API calls (worst case 9+ seconds if each is slow), and worse, a hung call to one API blocks the other two from even starting. Concurrent fetch bounds per-tenant latency to the slowest single call, and with per-call timeouts, one dead API can't drag the other two down with it.

**Q: But doesn't concurrent fan-out to three APIs from potentially hundreds of tenants risk overwhelming a shared executor or hitting per-API rate limits?**
A: That's exactly why I used a bounded executor sized against measured API rate limits, not `Executors.newCachedThreadPool()`'s unbounded growth — a bounded pool naturally back-pressures by queueing excess work, and I paired that with a per-API `Semaphore` (or a rate limiter like Resilience4j's `RateLimiter`) sized to each partner's documented rate limit, since the three APIs had different limits and a single shared bound wasn't fine-grained enough.

**Q: How exactly did you get to 99.9% — walk through the actual mechanisms, not just "we added retries."**
A: Three layers. First, transient-failure retry with exponential backoff and jitter (Resilience4j `Retry`) for timeouts/5xxs — this alone recovered the majority of failures, since most were momentary blips. Second, a circuit breaker (Resilience4j `CircuitBreaker`) per external API that opened after a failure-rate threshold, so during a real partner outage we failed fast instead of piling up retries and timeouts across every tenant. Third, the stale-cache fallback meant that even a task that fully failed after retries and circuit-open didn't count as a *user-facing* failure — the dashboard still served the last good value. The "99.9% task execution reliability" metric was specifically the scheduler-task-success rate (task completed and wrote a fresh value OR explicitly served fallback without throwing), tracked via Micrometer counters (`scheduler.task.success`, `scheduler.task.failure`, `scheduler.task.fallback`) over a rolling 30-day window in Grafana — not a number I estimated after the fact.

**Q: What counts as the 0.1% that failed, and what happened to the user in that case?**
A: The 0.1% was mostly cases where all retries were exhausted, the circuit was open, and there was no prior cached value at all yet (e.g., a brand-new tenant's very first refresh cycle hitting a partner outage) — in that specific case the dashboard showed an explicit "data temporarily unavailable" state rather than stale data, since there was nothing to fall back to. That's a materially different (and more honest) failure mode than silently serving wrong data.

## Q&A — Trade-offs & Failure Modes

**Q: What's the actual failure mode of a bounded executor under sustained overload?**
A: Once the queue backs up past its bound, new task submissions either block the scheduler thread (if using a `RejectedExecutionHandler` like `CallerRunsPolicy`) or get rejected outright (`AbortPolicy`). I used `CallerRunsPolicy` deliberately — it applies natural backpressure by slowing down the scheduler thread itself rather than silently dropping a tenant's refresh, at the cost of that scheduler thread being temporarily unavailable to dispatch other tenants' tasks.

**Q: What's the cost/complexity trade-off of the retry + circuit breaker + stale-cache-fallback stack versus just letting failures surface?**
A: It's meaningfully more code and more failure paths to test and reason about (what does "circuit half-open plus stale cache plus retry exhausted" actually do?), and it can mask a genuinely broken partner integration behind "well, it's just serving stale data" for longer than ideal. I mitigated the masking risk by alerting on sustained fallback usage (e.g., >5 minutes of a tenant serving stale data), not just on hard failures.

**Q: When would this whole design be overkill?**
A: If the data source were internal and highly reliable (e.g., our own database), or if staleness tolerance were effectively zero (the dashboard must show live-or-nothing), most of this — retries, circuit breakers, stale fallback — wouldn't be worth the complexity. This design earns its keep specifically because we depend on three *external*, less-reliable, rate-limited partners where transient failure is the normal case, not the exception.

**Q: What happens if two of the three APIs are healthy but one is persistently slow (not failing, just slow) — does that starve the others?**
A: No, because each `CompletableFuture` had its own `orTimeout`, and they ran on the shared bounded executor concurrently rather than one blocking the next — a persistently slow API would just time out repeatedly for its own future and eventually trip its own circuit breaker, without affecting the other two futures' completion.

**Q: How did you avoid duplicate/overlapping refresh cycles for the same tenant if a run overran its interval?**
A: `scheduleWithFixedDelay` guarantees the next run only starts after the previous one completes, which structurally prevents that overlap — the trade-off is that if one run takes much longer than the configured interval, that tenant's effective refresh cadence silently degrades rather than catching up, which I surfaced via a metric comparing configured interval vs. actual observed interval.

## Q&A — Scaling & Extending

**Q: How would this design change at 10x the tenants (say, thousands instead of hundreds)?**
A: A single JVM's thread pool and in-process scheduler stop being enough — I'd move toward a distributed task queue (e.g., tasks published to Kafka partitioned by tenant, consumed by a pool of worker instances) so scheduling and execution scale horizontally across machines instead of vertically on one instance's thread pool, and I'd shard the Redis cache layer accordingly.

**Q: What would you add if a fourth or fifth external API got added?**
A: I'd generalize the per-API client/retry/circuit-breaker wiring into a config-driven registry (a list of `ApiSource` definitions with their own rate limit, timeout, and retry policy) rather than hardcoding three named clients, so adding a new source is a config entry plus a client implementation, not new scheduler logic.

**Q: How would you extend this for exactly-once semantics if downstream consumers couldn't tolerate ever seeing a duplicate fetch/write?**
A: I'd add an idempotency key per (tenant, API, scheduled-fire-time) and make the cache write conditional on that key not having already succeeded for that fire time, since the current design assumes "refresh the cache" is naturally idempotent (last-write-wins on a cache is safe) — that assumption breaks if a refresh instead triggered a side-effecting downstream action.

**Q: What monitoring would you add next?**
A: Per-tenant SLA dashboards (not just aggregate 99.9%) since an aggregate number can hide one tenant experiencing chronic failures while everyone else is fine, plus alerting on circuit-breaker state transitions specifically, since "circuit just opened for partner API #2" is a much more actionable signal than waiting for the aggregate success rate to dip.

## Rapid-Fire Follow-ups

**Q: Which scheduling method avoids overlapping runs when a task overruns its interval?**
A: `scheduleWithFixedDelay`, not `scheduleAtFixedRate`.

**Q: What did you use to fetch the three APIs concurrently?**
A: `CompletableFuture.supplyAsync` on a bounded executor, combined with `allOf`.

**Q: What caching layers did you use and why two?**
A: Caffeine (in-process L1, fast) plus Redis (L2, cross-instance consistency).

**Q: Why not Quartz?**
A: No need for persistence/clustering; in-memory best-effort refresh didn't justify the operational overhead.

**Q: How did you protect against a failing partner API being hammered by retries?**
A: A per-API circuit breaker (Resilience4j) that opens past a failure-rate threshold.

**Q: What happened when a refresh failed after retries and circuit-open?**
A: Served the last good cached value with a staleness flag instead of erroring.

**Q: What's the rejection policy on the bounded executor and why?**
A: `CallerRunsPolicy`, to apply backpressure instead of silently dropping tasks.

**Q: How was 99.9% measured, concretely?**
A: Micrometer counters for task success/failure/fallback, aggregated in Grafana over a rolling 30-day window.

**Q: What happened in the true 0.1% failure case?**
A: Explicit "data unavailable" state shown only when there was no prior cached value to fall back to.

**Q: How would you scale this to thousands of tenants?**
A: Move from in-process scheduling to a distributed task queue (e.g., Kafka-partitioned by tenant) with horizontally scaled workers.
