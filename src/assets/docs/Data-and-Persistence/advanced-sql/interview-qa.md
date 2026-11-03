# Interview Q&A (SSE Backend style)

**Q: Walk me through how you'd diagnose a slow endpoint that's backed by a single SQL query.**
A: Start with `EXPLAIN` (or `EXPLAIN ANALYZE` on Postgres) to see the actual execution plan — look for full table scans, missing index usage, or bad join order. Check row estimates vs. actual rows (a huge mismatch means stale statistics). Confirm the right index exists and matches the left-prefix rule for composite indexes. Then check outside the query itself: N+1 patterns in the calling code, missing connection pooling, or `OFFSET`-based pagination scanning millions of skipped rows. Fix the highest-leverage issue first, then re-measure — don't guess and change five things at once.

**Q: When would you choose a stored procedure over application-level logic, and what are the risks?**
A: Procedures make sense for tight, atomic, performance-critical operations where round-trips to the app tier would dominate cost (e.g. a multi-step balance transfer that must be atomic and fast). The risk is that business logic becomes invisible to the application codebase — hard to unit test, hard to code review as a diff, not portable across DB vendors, and invisible to APM/tracing tools. Most teams at scale keep logic in the application layer and reserve DB-side logic for narrow, rarely-changing invariants.

**Q: What's the difference between a trigger and an application-level event (e.g. outbox pattern)?**
A: A trigger runs synchronously and invisibly inside the database transaction the moment a row changes — great for guarantees that must hold even against direct DB writes, but hidden from anyone reading application code and hard to test/observe. An outbox pattern writes an event row in the same transaction as the business write, then a separate worker publishes it to a queue — visible in application code, testable, and decoupled, at the cost of needing that extra worker/infrastructure. Prefer the outbox pattern for anything downstream systems care about; reserve triggers for pure data-integrity concerns.

**Q: How do you decide between a composite index `(a, b)` and two separate single-column indexes on `a` and `b`?**
A: It depends on the query patterns. A composite index `(a, b)` speeds up queries filtering on `a` alone or on `a AND b` (left-prefix rule), and can serve as a covering index if `b` is also selected. Two separate indexes let the optimizer use index merge for `OR` conditions or when `b` is queried alone, but each index has its own write overhead. If your queries always filter on `a` first (or together with `b`), one composite index is usually better — fewer indexes to maintain and it can cover more query shapes.

**Q: What's the N+1 query problem and how do you fix it in an ORM-heavy codebase?**
A: Fetching a list of N parent rows, then issuing one additional query per parent to fetch related child rows — 1 + N total queries instead of 2. Fix with eager loading (`JOIN FETCH` in JPA, `with()` in Laravel Eloquent), or by batching the child fetch into a single `WHERE parent_id IN (...)` query. Detect it in code review or with query-count assertions in tests, and in production via APM tools that flag suspiciously high per-request query counts.

**Q: How would you shard a users table that's outgrown a single database instance?**
A: Pick a shard key with high cardinality and even access distribution — `user_id` is usually the right choice, hashed (`hash(user_id) % num_shards`) rather than ranged, to avoid hot shards. Route reads/writes at the application or a proxy layer based on that hash. Accept that cross-shard joins and multi-row transactions become hard: denormalize frequently-joined data into each shard, or move cross-shard consistency needs to an async/eventually-consistent model (outbox + queue) rather than trying to do distributed 2PC. Also plan the resharding story up front — consistent hashing minimizes data movement when you add shards later.

**Q: What's the difference between partitioning and sharding?**
A: Partitioning splits one table's data into physical segments within a single database instance — the query planner prunes partitions it doesn't need to scan, mainly helping I/O and query planning. Sharding splits data across multiple separate database instances/machines — it scales throughput and total storage beyond one machine's limits, but you lose easy cross-shard joins and transactions, and the application (or a routing layer) must know which shard owns which row.

**Q: `EXISTS` vs `IN` for a subquery — which do you reach for and why?**
A: `EXISTS` short-circuits on the first match and generally performs better for large or correlated subqueries; it also handles `NULL`s correctly. `IN` materializes the full subquery result set first and has a well-known footgun: `WHERE x NOT IN (subquery containing a NULL)` matches zero rows because SQL's three-valued logic makes every comparison against `NULL` unknown. For `NOT IN`/`NOT EXISTS` specifically, I default to `NOT EXISTS` unless I'm certain the subquery column can never be `NULL`.

**Q: How do database transaction isolation levels trade off against each other?**
A: Higher isolation levels prevent more anomalies (dirty reads → non-repeatable reads → phantom reads as you go up from `READ UNCOMMITTED` to `SERIALIZABLE`) but increase locking and reduce concurrency/throughput. Most OLTP systems default to `READ COMMITTED` or `REPEATABLE READ` as the practical middle ground — MySQL InnoDB defaults to `REPEATABLE READ`, PostgreSQL to `READ COMMITTED`. I'd only reach for `SERIALIZABLE` for logic that truly can't tolerate any anomaly (e.g. certain financial reconciliation), because it costs the most in contention and retry overhead.

**Q: Why might you introduce a materialized view instead of just caching the query result in Redis?**
A: A materialized view lives in the database, is queryable with full SQL (joins, filters, further aggregation) unlike an opaque cache blob, and can be refreshed on a schedule or trigger without any application code changes. Redis is faster and better for simple key-based lookups, but you lose the ability to query into the cached data further. I'd use a materialized view for expensive analytical/dashboard queries that still need SQL flexibility, and Redis for hot, simple, high-QPS lookups.

**Q: A `LEFT JOIN` with a `WHERE` filter on the right table is silently returning fewer rows than expected. Why, and how do you fix it?**
A: Because a `WHERE` clause is evaluated after the join — filtering on a right-side column (e.g. `WHERE o.status = 'paid'`) discards the NULL-filled rows for unmatched left rows, which functionally turns the `LEFT JOIN` back into an `INNER JOIN`. The fix is to move that condition into the `ON` clause (`LEFT JOIN orders o ON o.user_id = u.id AND o.status = 'paid'`) so unmatched left rows are preserved with NULLs instead of being filtered out.

**Q: When would you use a recursive CTE instead of handling hierarchy traversal in application code?**
A: When the hierarchy depth is unknown or unbounded and the data already lives in one relational table (e.g. an org chart, a category tree, a comment thread) — a recursive CTE walks it in a single round-trip instead of N application-level queries walking one level at a time. I'd move it to application code (or a graph database) if the traversal needs complex business logic per hop, needs to join across services, or if the hierarchy is deep/wide enough that recursive CTE performance becomes a concern — recursive CTEs can be slower than a purpose-built graph traversal at real scale.

**Q: How do you keep a JSON column from turning into an unmaintainable schema-less mess?**
A: Treat it as an escape hatch for a small number of sparse/optional attributes, not as the primary data model — the core, frequently-queried fields should stay as real typed columns with constraints. Add a functional/GIN index on the JSON paths you actually query. If I find myself writing complex filters or aggregations against nested JSON regularly, that's the signal the data belongs in its own normalized table or a proper document store, not a JSON blob column.

**Q: What's a real production bug you'd worry about with session variables (`SET @var`) in a connection-pooled service?**
A: Session variables are bound to the physical connection, not the logical request. In a pooled environment, a connection returned to the pool after request A can be handed to unrelated request B with request A's leftover `@var` still set — leaking state across requests. I'd avoid session variables in pooled code paths entirely, or explicitly reset them before the connection returns to the pool; this is a subtle bug because it only reproduces under real concurrent pooled load, not in a simple local test.

**Q: `UNION` vs `UNION ALL` — when does the difference actually matter for performance?**
A: `UNION` deduplicates the combined result set, which requires an extra sort/hash pass over all rows; `UNION ALL` just concatenates. If you already know the two result sets are disjoint (e.g. partitioned by a mutually exclusive condition), `UNION ALL` gives the same correct result without paying for deduplication — a meaningful difference at scale on large result sets.

**Q: How would you safely roll out a schema change (e.g. adding a `NOT NULL` column) to a large, high-traffic table without downtime?**
A: Add the column as nullable first (fast metadata-only change on most modern engines), backfill it in batches to avoid long locks or replication lag, then add the `NOT NULL`/default constraint once backfill is complete and verified. Avoid a single blocking `ALTER TABLE ... ADD COLUMN NOT NULL DEFAULT x` on a huge table — depending on the engine/version it can lock the table or rewrite it entirely. Coordinate with read replicas and any DDL replication lag, and always have a rollback plan for the migration itself, not just the application code.

---

*Part of [Advanced SQL & Database Programmability](Data-and-Persistence/advanced-sql-programmability).*
