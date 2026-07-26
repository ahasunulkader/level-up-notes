# Redis Caching for Reduced Latency

## Resume Line
> "Implemented Redis caching to reduce redundant data fetching; improved response times by 60%+ across high-frequency access workflows."

## TL;DR
This bullet gets probed hard on two fronts: can you actually justify and measure the "60%+" number instead of it being a made-up headline, and do you understand cache correctness — invalidation, staleness windows, stampede protection, eviction policy — well enough to explain what happens when the cache is wrong, not just when it's fast. The core story: you identified a genuinely hot, read-heavy, expensive-to-compute data path, cached it in Redis with a deliberate invalidation and TTL strategy, protected against the failure modes (stampede, staleness, cache-DB inconsistency), and measured the improvement with real latency percentiles, not an anecdote.

## The Story (STAR-style anchor)
**Situation:** In our order-management platform, the product catalog/pricing lookup (`GET /products/{id}/pricing`) was called on nearly every checkout and product-page render, backed by a PostgreSQL query joining product, pricing-tier, and promotion tables. Under peak load this endpoint's p95 latency was ~180ms and it was one of the top 3 DB load contributors, with the same product's pricing being recomputed thousands of times per minute even though prices only changed a handful of times per day.

**Task:** Reduce latency and database load for this read-heavy, low-write-frequency workflow without introducing stale-pricing bugs (which, for a commerce platform, is a real financial-correctness risk, not just a UX nuisance).

**Action:** I introduced Redis as a read-through cache in front of the pricing query, keyed by `pricing:{productId}:{tierId}`, using Spring's `@Cacheable`/`@CacheEvict` abstraction backed by `spring-boot-starter-data-redis` (Lettuce client) for the simple cases, and manual `RedisTemplate` calls where I needed finer control (e.g., conditional TTL, cache stampede protection). I set a TTL of 10 minutes as a safety net plus explicit cache invalidation (`@CacheEvict`) fired from the pricing-update service on write, so changes propagated immediately rather than waiting for TTL expiry — a cache-aside pattern with active invalidation, not TTL-only. I added a short-lived per-key mutex (`SETNX` with expiry) around the cache-miss recompute path to prevent thundering-herd recomputation when a hot key expired under high concurrency, and used `EXPIRE` with slight jitter to avoid synchronized mass expiry of related keys cached at the same time.

**Result:** p95 latency on the pricing endpoint dropped from ~180ms to ~65ms (about 64% reduction), measured via Micrometer-recorded histograms before/after rollout on identical traffic patterns (compared week-over-week at matching peak-hour windows), and DB query volume for that table dropped by roughly 70% as measured by pg_stat_statements call counts, which also gave the database headroom that helped a separate, unrelated report-generation workload that shared the same DB instance.

## Q&A — Foundational

**Q: What's the difference between cache-aside, read-through, and write-through caching, and which did you use?**
A: Cache-aside (a.k.a. lazy loading): application code checks the cache, on miss reads from DB and populates the cache itself — most control, most common pattern, and what I used. Read-through: the cache/library sits between the app and DB and handles the miss-fetch transparently (Spring's `@Cacheable` behaves this way from the caller's perspective). Write-through: writes go to the cache first, which synchronously writes to the DB, keeping cache and DB always consistent but adding write latency. I used cache-aside for reads plus explicit invalidation on write (sometimes called "cache-aside with write invalidation") rather than write-through, because our writes were infrequent and I didn't want write-path latency coupled to cache availability.

**Q: Show me the actual Spring/Redis code for this.**
A: Declarative for the simple case:
```java
@Cacheable(value = "pricing", key = "#productId + ':' + #tierId", unless = "#result == null")
public PricingDto getPricing(Long productId, Long tierId) {
    return pricingRepository.computePricing(productId, tierId); // hits DB
}

@CacheEvict(value = "pricing", key = "#productId + ':' + #tierId")
public void updatePricing(Long productId, Long tierId, PricingUpdate update) {
    pricingRepository.update(productId, tierId, update);
}
```
```yaml
spring:
  cache:
    type: redis
  data:
    redis:
      host: redis-primary
      port: 6379
  cache.redis.time-to-live: 600000 # 10 min TTL as a safety net
```
For the stampede-protected manual path I used `RedisTemplate` directly with a distributed lock around the recompute-on-miss logic (shown later).

**Q: What's a TTL and why did you set it even though you also had explicit invalidation?**
A: TTL (time-to-live) is an expiry after which Redis automatically evicts the key. Explicit invalidation (`@CacheEvict` on write) handles the *known* write paths, but TTL is a safety net for cases invalidation might miss — a direct DB update bypassing the service layer (a manual SQL fix, a batch job), a bug in the eviction logic, or a multi-instance deployment race. TTL bounds the maximum staleness window to something acceptable (10 minutes was fine for pricing that changes a handful of times a day) even if invalidation silently fails.

**Q: What Redis data structure did you use for this and why not something fancier?**
A: Plain string keys holding a JSON-serialized `PricingDto` (via Spring's `GenericJackson2JsonRedisSerializer`) — simplest thing that works for a single-object cache entry accessed by a single composite key. I'd reach for a Hash if I needed to cache multiple related fields I sometimes update independently, or a Sorted Set for something like a leaderboard/ranked feed, but pricing-by-ID lookup is a pure key-value access pattern with no need for that complexity.

**Q: What's cache stampede (thundering herd) and how did you prevent it?**
A: When a hot key expires, many concurrent requests all miss simultaneously and all hammer the DB to recompute the same value at once — briefly worse than not caching at all, since it's a correlated spike instead of steady load. I protected against it with a short-lived distributed lock on cache-miss:
```java
String cacheKey = "pricing:" + productId + ":" + tierId;
PricingDto cached = redisTemplate.opsForValue().get(cacheKey);
if (cached == null) {
    String lockKey = "lock:" + cacheKey;
    Boolean acquired = redisTemplate.opsForValue()
        .setIfAbsent(lockKey, "1", Duration.ofSeconds(5));
    if (Boolean.TRUE.equals(acquired)) {
        try {
            PricingDto fresh = pricingRepository.computePricing(productId, tierId);
            redisTemplate.opsForValue().set(cacheKey, fresh, Duration.ofMinutes(10));
            return fresh;
        } finally {
            redisTemplate.delete(lockKey);
        }
    } else {
        Thread.sleep(50); // brief backoff, then retry cache read
        return getPricing(productId, tierId);
    }
}
```
Only one request per key recomputes; the rest either get the freshly-populated cache or briefly wait and retry.

**Q: What's the difference between Redis eviction policies, and which did you configure?**
A: `noeviction` (reject writes when memory full — bad for a cache used in the hot path, since it can start throwing errors instead of just evicting), `allkeys-lru`/`allkeys-lfu` (evict least-recently/frequently-used across all keys), `volatile-lru`/`volatile-lfu`/`volatile-ttl` (only evict among keys that have a TTL set). We used `allkeys-lru` since this Redis instance was purely a cache (no keys meant to be permanent), so it was safe to let Redis evict anything under memory pressure based on recency of access.

**Q: How does Redis achieve such low latency compared to a relational DB for this kind of lookup?**
A: It's single-threaded per core for command execution (no lock contention on the hot path), fully in-memory (no disk I/O on the read path), and uses simple O(1)/O(log n) data structure operations for basic key lookups — versus Postgres needing to plan a query, potentially execute a multi-table join, and read from disk/buffer cache. For a point lookup by a well-defined key, Redis's GET is essentially as fast as network round-trip time allows, whereas our pricing query involved joins across 3 tables plus promotion-rule evaluation logic.

## Q&A — Why This, Not That (Decision Tree)

**Q: Why Redis instead of an in-process cache like Caffeine or Guava Cache?**
A: The service ran as multiple replicas behind a load balancer (tying into the Kubernetes rolling-update setup) — an in-process cache is per-instance, so each Pod would have its own cold cache after a rollout, and worse, a price update would only invalidate the cache on whichever instance handled the write, leaving other instances serving stale data indefinitely with no cross-instance invalidation signal. Redis gives a single shared cache all instances read/write consistently, and invalidation on any instance is immediately visible to all.

**Q: But doesn't that add a network hop that Caffeine wouldn't have, and a new failure mode — what if Redis is down?**
A: Yes to both, and that's the real trade-off. The network hop (sub-millisecond on the same VPC/cluster, but non-zero) is why for anything accessed *extremely* hot within a single request's lifecycle I'd still layer a very-short-TTL local cache (Caffeine, TTL of a few seconds) in front of Redis — a two-level cache — for the small subset of keys where even that hop matters. For Redis availability, I made the caching layer fail open: cache-read failures (timeout, connection error) fall back to hitting the DB directly rather than propagating the error, so a Redis outage degrades latency back to pre-caching levels instead of taking the whole feature down. I also ran Redis with a primary-replica setup (and Sentinel for automatic failover) rather than a single instance, specifically because a cache that's a single point of failure defeats the purpose of adding reliability-neutral performance.

**Q: If Redis is your single shared cache, doesn't a bad invalidation bug now cause every instance to serve the same wrong data, versus per-instance caches limiting blast radius?**
A: That's a fair concern and it's exactly why the TTL safety net matters even with active invalidation — a broken `@CacheEvict` call means all instances serve stale data, but bounded to at most 10 minutes, not indefinitely. I also treated cache-invalidation code paths as requiring the same test coverage as the write path itself (a unit test asserting that updating pricing evicts the correct key), because "forgot to invalidate" is the single most common category of cache bug and it's cheap to catch with a test versus expensive to debug in production.

**Q: Why cache-aside with explicit invalidation instead of just a short TTL and no invalidation at all — simpler to implement?**
A: TTL-only was actually my first instinct for simplicity, but for pricing specifically, a customer seeing a stale price during checkout is a real financial/trust problem, not a cosmetic one — a TTL window of even a minute could show a customer an old price that then changes at payment time, causing a confusing failed transaction or a support ticket. Explicit invalidation on write gives near-immediate consistency for the common case, with TTL only as a backstop for the invalidation-miss edge cases discussed above. For a lower-stakes read (e.g., a "trending products" widget), TTL-only would be perfectly fine and simpler — I wouldn't add invalidation complexity where staleness genuinely doesn't matter.

**Q: Why not just add a read replica to Postgres to absorb the read load instead of introducing a whole new caching layer?**
A: A read replica helps with read *scaling* (spreading query load across more DB capacity) but doesn't reduce the actual query cost or latency — you'd still pay the join/computation cost per request, just on more hardware, and you still have replication lag to reason about. Caching addresses both dimensions: it removes the recomputation entirely for repeated reads of the same key (not just spreading it out) and gets you memory-speed latency instead of disk/query-plan latency. In practice I'd consider both complementary, not either/or — a read replica for genuinely unique, uncacheable queries, caching for the small set of hot, repeated, expensive lookups like pricing.

**Q: What if the pricing computation itself depended on a promotion that changes based on real-time inventory — doesn't caching risk showing an unavailable promo?**
A: That's a real edge case we hit — a promotion tied to limited inventory needed a much shorter effective TTL (or no caching at all for the promo-eligibility check specifically, decoupled from the base price which *was* safely cacheable). I split the cached value into "base price" (cacheable, changes rarely) computed from cache, and "promotion eligibility" (checked live against current inventory, not cached) composed together in the response — rather than either caching everything (risking wrong promo state) or caching nothing (losing the latency win on the expensive part that's actually safe to cache).

## Q&A — Trade-offs & Failure Modes

**Q: What actually goes wrong with this caching setup in production?**
A: Three real ones I've seen: (1) Cache-DB inconsistency from a missed invalidation path (a bulk price update job that bypassed the service-layer `@CacheEvict` and wrote directly via SQL, leaving stale cached prices for up to the full TTL). (2) Serialization version mismatches — deploying a new service version with a changed `PricingDto` field while old cached JSON entries from the previous version are still in Redis, causing deserialization errors or silently null fields on read; fixed by versioning the cache key (`pricing:v2:{id}`) on any DTO shape change so old entries are simply ignored, not deserialized incorrectly. (3) Memory pressure causing unexpected evictions of genuinely hot keys under `allkeys-lru` when an unrelated feature started caching large objects in the same Redis instance, degrading hit rate for pricing without an obvious cause until we checked `INFO memory` and eviction counters.

**Q: What's the operational cost/complexity this adds?**
A: A new stateful dependency to run, monitor, and capacity-plan (memory sizing, persistence config if used for anything beyond pure cache, replica/Sentinel topology for HA), new failure modes to handle in application code (timeouts, connection pool exhaustion under Lettuce), and new categories of bugs (staleness, serialization mismatches) that don't exist without a cache. It's absolutely worth it for a genuinely hot, expensive, read-heavy path — it's not worth it reflexively added to every endpoint.

**Q: When would you NOT cache something, even if it's read frequently?**
A: If the data changes on nearly every read anyway (low cache hit rate makes the added complexity pure cost with no benefit), if staleness is unacceptable at any window (e.g., a real-time account balance used to authorize a transaction — caching that risks double-spend-class bugs), or if the underlying query is already cheap (sub-millisecond indexed lookup) — caching an already-fast query just adds a new failure mode for negligible latency gain.

**Q: How do you actually prove "60%+ improvement" instead of just asserting it?**
A: Same latency metric, same percentile, same traffic conditions, before and after — I pulled p95 latency from Micrometer/Prometheus histograms (`http.server.requests` for that endpoint) for a matched time window (e.g., Tuesday 2-4pm before rollout vs. the following Tuesday 2-4pm after, to control for traffic pattern), not a single lucky sample. I'd also report cache hit rate (`redis-cli info stats` → `keyspace_hits`/`keyspace_misses`) alongside the latency number, because "60% faster" is only meaningful together with "and here's the hit rate that explains why," and I'd be honest that the improvement is workload-dependent — a cold cache after a deploy temporarily has worse latency than steady-state, so the number describes steady-state behavior, not every single request.

**Q: What would make this number look better than it really is, and how do you avoid that trap?**
A: Comparing against an artificially slow baseline (e.g., a DB query that was slow because of a missing index, which should've just been fixed directly rather than papered over with a cache), or reporting mean latency instead of p95/p99 where a cache dramatically helps the mean by making 90% of requests near-instant while doing nothing for the tail (cache misses can be *slower* than the uncached baseline due to the added Redis round-trip on a miss). I made sure to check that we weren't hiding a fixable DB performance issue behind a cache, and reported percentiles, not just an average.

## Q&A — Scaling & Extending

**Q: At 10x traffic, what changes about this Redis setup?**
A: Move from a single Redis primary-replica pair to Redis Cluster (sharded across multiple nodes) if data volume or single-node throughput becomes the bottleneck, revisit connection pool sizing (Lettuce's shared connection with multiplexing scales differently than Jedis's per-thread pool — worth explicitly knowing which client and why), and add per-key hot-spotting awareness — if one product is dramatically hotter than others (a flash sale item), even Redis can show contention on that single key/node, which might need client-side request coalescing on top of the cache.

**Q: At 10x data volume (many more products/tiers), what changes?**
A: Revisit TTL and eviction policy with actual memory budget math (average entry size × expected working set vs. allocated Redis memory), consider `allkeys-lfu` over `allkeys-lru` if access patterns are more "consistently popular items" than "recency-biased," and potentially move colder, rarely-accessed pricing tiers out of the always-cached set entirely (cache only demonstrably hot keys, not everything indiscriminately) to keep the working set memory-efficient.

**Q: What would you add next to mature this caching layer?**
A: Cache warming on deploy/rollout (pre-populate the top-N hot keys before a new Pod starts receiving traffic, so the first requests after a rolling update aren't all cache misses — ties directly into the Kubernetes rollout work), a circuit breaker around Redis calls (Resilience4j) so a degraded Redis doesn't cause cascading timeouts throughout the request path, and better observability specifically on cache health (hit rate, eviction rate, memory usage as first-class Grafana panels, not just "Redis is up/down").

**Q: How would you extend this pattern to other workflows beyond pricing?**
A: Apply the same cache-aside-with-invalidation template to other read-heavy/low-write paths (product catalog metadata, user session/profile lookups), but each candidate gets evaluated individually for its actual staleness tolerance and write frequency rather than blanket-applying "just cache it" — the pricing case specifically justified active invalidation because of correctness stakes; a less sensitive workflow might justify simple TTL-only caching with much less implementation complexity.

## Rapid-Fire Follow-ups
- Q: Cache-aside vs write-through? A: Cache-aside populates cache on read-miss; write-through writes to cache and DB synchronously on every write.
- Q: What Redis command implements a simple distributed lock? A: `SET key value NX EX seconds` (SETNX with expiry).
- Q: What's cache stampede? A: Many concurrent requests recomputing the same expired key simultaneously.
- Q: allkeys-lru vs volatile-lru? A: Evicts among all keys vs only keys that have a TTL set.
- Q: Why version cache keys on DTO shape changes? A: Avoid deserialization errors from stale-format cached entries after a deploy.
- Q: What's "fail open" for a cache dependency? A: On cache error, fall back to the source of truth instead of failing the request.
- Q: Mean latency vs p95/p99 — which better reflects tail experience? A: p95/p99.
- Q: What Redis client does Spring Boot default to? A: Lettuce.
- Q: Why is Redis fast for point lookups? A: In-memory, single-threaded execution per core, O(1) key access, no query planning.
- Q: What metric proves cache effectiveness alongside latency? A: Cache hit rate (keyspace_hits / total lookups).
