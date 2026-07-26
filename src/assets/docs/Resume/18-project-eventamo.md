# Eventamo

## Resume Line
> "Building a full-stack service marketplace with role-based access control, real-time availability management, and multi-role admin moderation."
> "Implemented pessimistic locking for concurrent booking prevention and optimistic capacity management across service categories."

## TL;DR
This bullet is the one most likely to get a genuine whiteboard follow-up, because "pessimistic locking here, optimistic locking there, in the same app" sounds like a buzzword sandwich unless you can explain *why* the two coexist rather than picking one. The interviewer wants to see that you reason about locking strategy from contention and consistency requirements, not from "pessimistic sounds safer so I used it everywhere." The core story: booking a specific time slot is a narrow, high-contention, must-not-double-book operation — perfect for a short pessimistic lock (`SELECT ... FOR UPDATE`) — while tracking remaining capacity across a whole service category is a lower-contention counter where an occasional retry-on-conflict (optimistic, version column) is cheaper than serializing every read.

## The Story (STAR-style anchor)
**Situation:** Eventamo is a service marketplace (think: bookable services — appointments, event slots, service-provider capacity — across multiple categories) with providers, customers, and several admin tiers. Two correctness problems showed up early in design review: (1) two customers could both see a slot as "available" and both submit a booking for the exact same slot at the same time, and (2) service categories track aggregate remaining capacity (e.g., "40 of 50 spots left this week" across many providers in a category) that many concurrent bookings update simultaneously.

**Task:** Guarantee that a specific slot is never double-booked, while keeping the more diffuse, higher-volume capacity counters responsive under concurrent load, on PostgreSQL, with Spring Boot/Hibernate managing the transactions.

**Action:** For slot booking, I used a pessimistic lock: the booking transaction issues `SELECT ... FOR UPDATE` on the target slot row before checking availability and inserting the booking, so a second concurrent transaction attempting the same slot blocks until the first commits or rolls back, at which point it re-reads and correctly sees the slot as taken. For category-level capacity, I used optimistic locking via a `@Version` column on the capacity row — a booking reads the current remaining count, computes the decrement, and writes it back conditioned on the version matching; if two bookings raced, the loser's `UPDATE` affects zero rows (a `StaleObjectStateException` in Hibernate terms), and the application retries the read-decrement-write with the new count rather than blocking. I paired the pessimistic path with short, focused transactions (lock, check, insert, commit — no external calls inside the transaction) to keep lock hold time minimal, and added a statement-level lock timeout so a stuck transaction fails fast instead of blocking the whole slot indefinitely.

**Result:** Zero double-bookings observed under load testing (k6 hammering the same slot concurrently), with the pessimistic path adding negligible latency because lock hold time is sub-millisecond to a few milliseconds per booking attempt. The optimistic capacity counters handled far higher concurrent volume (many categories, many providers) with only occasional retries, avoiding the throughput cost that fully serializing every capacity update would have imposed.

## Q&A — Foundational

**Q: How is RBAC actually designed and enforced in Eventamo?**
A: Roles (Customer, Provider, Category Admin, Platform Admin, Support) map to permissions, not the other way around — a role is a named bundle of permissions, and code checks permissions/authorities, not role names directly, so adding a new role later doesn't require touching every authorization check. Enforcement is layered: Spring Security handles authentication and coarse URL-level rules in the security filter chain, and method-level `@PreAuthorize` annotations enforce fine-grained, resource-specific checks on service methods.
```java
@PreAuthorize("hasAuthority('MODERATE_LISTINGS') and @categoryGuard.ownsCategory(#categoryId, authentication)")
public void suspendListing(Long categoryId, Long listingId) { ... }
```
The schema is a standard `users` / `roles` / `permissions` / `role_permissions` join model, with a `user_roles` join table supporting multiple roles per user (a Category Admin can also be a Provider on their own account).

**Q: Why method-level `@PreAuthorize` instead of just checking roles inside the service code manually?**
A: Because manual `if (user.getRole() == ADMIN)` checks scattered through service methods are easy to forget on a new endpoint and impossible to audit at a glance. `@PreAuthorize` puts the authorization rule declaratively at the method boundary, so a security review can grep for `@PreAuthorize` across the codebase and see every protected operation and its rule in one place, and Spring enforces it before the method body runs at all — there's no code path that reaches business logic without passing the check.

**Q: How do you implement real-time availability so customers see live slot status?**
A: I used Server-Sent Events (SSE) for the availability stream rather than plain polling or full WebSocket. Polling (e.g., every 3-5s) is the simplest option but adds staleness and needless load for a mostly-quiet resource; full WebSocket is bidirectional and heavier than this needs, since the client never needs to push anything back on this channel — it only needs one-way "slot X is now booked" push notifications. SSE gives me server-to-client push over plain HTTP with automatic reconnection built into the browser's `EventSource`, without the extra protocol upgrade and connection-management complexity of WebSocket for a use case that's purely one-directional.

**Q: What does "multi-role admin moderation" mean concretely?**
A: There isn't one flat "admin" — Category Admins moderate listings and providers within their own category (approve a new provider's service listing, respond to category-specific reports), while Platform Admins have cross-category authority (suspend an account entirely, handle escalations Category Admins can't resolve) and Support has a narrower, read-mostly role (view booking history, issue refunds within a policy limit, can't touch listings). Moderation itself runs as an approval queue: a new/edited listing enters a `PENDING_REVIEW` state, a Category Admin approves or rejects with a reason, and only approved listings become bookable — with an audit log of who approved/rejected what, since disputes ("why was my listing rejected") need a paper trail.

**Q: Walk me through the exact SQL/transaction for booking a slot.**
```sql
BEGIN;
SELECT id, status FROM slots WHERE id = :slotId FOR UPDATE;
-- application checks status == 'AVAILABLE' in Java after this read
UPDATE slots SET status = 'BOOKED' WHERE id = :slotId;
INSERT INTO bookings (slot_id, customer_id, created_at) VALUES (:slotId, :customerId, now());
COMMIT;
```
A: The `FOR UPDATE` row lock is acquired on the `SELECT`, before the availability check, so a second transaction trying to book the same slot blocks at that `SELECT` until the first transaction commits (and then sees `status = 'BOOKED'` and correctly fails the availability check) or rolls back (and then sees `AVAILABLE` again and can proceed). The lock is what closes the race window between "check availability" and "write the booking" — without it, two transactions could both read `AVAILABLE` before either writes.

**Q: What does the optimistic capacity update look like?**
```java
@Version
private Long version;

private Integer remainingCapacity;
```
```sql
UPDATE category_capacity
SET remaining_capacity = remaining_capacity - 1, version = version + 1
WHERE category_id = :id AND version = :readVersion;
```
A: Hibernate generates that version-guarded `UPDATE` automatically from `@Version`. If the row's version changed since it was read (another booking got there first), the `UPDATE` affects zero rows, Hibernate throws `OptimisticLockException`, and the service layer catches it, re-reads the current capacity, and retries the decrement — typically succeeding on the second attempt since the conflict window is tiny.

## Q&A — Why This, Not That (Decision Tree)

**Q: Why pessimistic locking for slot booking specifically, and not optimistic locking there too?**
A: Because the correctness requirement and the contention shape are different from the capacity counter. Booking a specific slot is binary and exclusive — exactly one booking can ever win, and I need to guarantee that with certainty, not "usually, and retry if not." A popular slot can see many customers hit "book" within the same second, so contention on that one row can be real, and optimistic locking under high contention on the *same* row degrades badly: every loser has to retry, and under a thundering-herd scenario (a popular slot going live) you could get repeated retry storms all colliding on the same row again. Pessimistic locking here means the critical section is short (a few statements) and correctness — never double-booking — matters more than raw throughput on that single row, so serializing access via a lock is the right trade.

**Q: Why not pessimistic locking for the capacity counters too, since it's "safer"?**
A: Because "safer" here would actually mean "much slower for no correctness benefit." Category-level capacity updates happen far more frequently in aggregate (many providers, many bookings across an entire category, not one contested row) and the cost of a collision is cheap to resolve — recompute and retry a simple decrement. Locking every capacity row pessimistically would serialize unrelated concurrent bookings across an entire category behind a single row lock, which is a throughput hit for a scenario where a version-check-and-retry resolves the rare actual conflict in microseconds. Optimistic locking assumes conflicts are rare and cheap to retry; that assumption holds for a shared counter with many writers spread over time, it doesn't hold for one hot row being hit by many writers in the exact same instant.

**Q: So the rule of thumb is what — narrow/hot/exclusive resource gets pessimistic, broad/diffuse/cheap-to-retry resource gets optimistic?**
A: Yes, precisely. Pessimistic locking trades some throughput for certainty on a small, high-value critical section. Optimistic locking trades a small retry cost for much higher throughput on a resource where most concurrent operations don't actually conflict with each other. Picking the wrong one in either direction either serializes work that didn't need to be serialized (over-pessimistic) or lets a correctness-critical race condition slip through because you assumed conflicts were rare when they weren't (over-optimistic).

**Q: Why not just use a unique constraint on `(slot_id)` in the bookings table and let the database reject the second insert, instead of `SELECT ... FOR UPDATE`?**
A: That's a legitimate complementary defense, and I do have a unique constraint as a belt-and-braces backstop — but it alone isn't sufficient for good UX, because without the lock, the second transaction would do all its work (read availability as true, build the booking) and only fail at the final `INSERT`, requiring a caught constraint-violation exception and a generic "someone beat you to it" error instead of a clean availability check earlier in the flow. The lock lets me fail fast and correctly at the availability check itself, and the unique constraint is the last line of defense against any code path that might bypass the locking discipline.

**Q: Why PostgreSQL over MySQL or a NoSQL store for this?**
A: Row-level locking with `SELECT ... FOR UPDATE` is well-supported in both Postgres and MySQL/InnoDB, so that alone isn't the differentiator — what pushed me to Postgres was JSONB for flexible, per-category service attributes (different service categories need different structured metadata — a tutoring service has different bookable attributes than an equipment-rental service — without a rigid, ever-growing column schema or a full EAV table), genuinely reliable `SERIALIZABLE` isolation if I ever need it for a more complex multi-row invariant, and better native support for the kind of exclusion constraints (`EXCLUDE USING gist` for overlapping time ranges, relevant for slot scheduling) that MySQL doesn't have an equivalent for. A NoSQL store was never seriously in consideration — booking correctness is inherently relational/transactional (a booking references a slot, a customer, a provider, a category, all of which need consistent, joinable state), which is exactly what a document or key-value store makes harder, not easier.

## Q&A — Trade-offs & Failure Modes

**Q: What's the deadlock risk with the pessimistic locking approach, and how do you avoid it?**
A: Deadlock risk shows up if a single transaction ever needs to lock more than one row and different transactions could lock those rows in different orders — e.g., transaction A locks slot 1 then tries to lock slot 2, while transaction B locks slot 2 then tries to lock slot 1; each waits on the other forever until Postgres's deadlock detector kills one. I avoid this by keeping the booking transaction's lock scope to exactly one row (one slot per booking transaction) and, for the rare case where a single logical operation needs multiple slot locks (e.g., booking a multi-session package), always acquiring locks in a consistent order (ascending slot ID) so no two transactions can form a cycle. I also set a statement timeout so a transaction that somehow does get stuck waiting doesn't block a slot indefinitely — it fails, and the client can retry, rather than the row being effectively frozen.

**Q: What happens under a thundering herd — a popular event's slots going live and thousands of customers hitting "book" in the same second?**
A: The pessimistic lock ensures correctness (no double booking) but by itself doesn't manage the *queueing* problem — if thousands of requests pile up waiting on a handful of hot slot rows, you can exhaust the database connection pool with transactions sitting blocked on a lock, which then starves unrelated requests that don't even touch those slots. The mitigations are outside the lock itself: an application-level rate limiter/queue in front of the booking endpoint (so requests for the same slot are throttled rather than all hitting the DB simultaneously), a short lock/statement timeout so a blocked transaction fails fast and releases its connection back to the pool instead of holding it, and sizing the HikariCP connection pool with headroom informed by load testing rather than defaults. For a genuinely massive single-slot launch, I'd also consider a pre-queue (e.g., a lightweight in-memory or Redis-backed token/waiting-room mechanism) that only lets a bounded number of requests reach the database at once, rather than relying on the database's own lock queue to absorb the full spike.

**Q: What if the pessimistic-lock transaction crashes or the app dies mid-transaction — does the slot stay locked forever?**
A: No — the lock is tied to the database transaction/connection, not the application process. If the app crashes or the connection drops, Postgres releases the lock automatically once it detects the connection is gone (or on the connection's eventual timeout), and the transaction rolls back, so the slot returns to its pre-transaction state. This is one of the real advantages of relying on the database's native locking rather than hand-rolling an application-level lock (e.g., a Redis lock) that requires its own expiry/heartbeat logic to avoid a permanently stuck lock if the holder dies.

**Q: Could optimistic locking on the capacity counter ever silently under- or over-book capacity?**
A: Not silently — the whole point of the version check is that a stale write is rejected, not silently applied, so it can't produce a wrong final count. What it *can* do under pathological load is cause repeated retries if contention is much higher than expected, which is a liveness/latency concern, not a correctness one — a request could in theory retry several times before succeeding. I bound that with a max retry count and a fallback to a clear "try again" response rather than retrying indefinitely, and in practice conflict rates on the capacity counters were low enough (spread across many providers per category) that retries were rare.

## Q&A — Scaling & Extending

**Q: How would you test that the concurrent booking logic is actually correct, not just correct in your head?**
A: Two layers. First, an integration test using Testcontainers spinning up a real PostgreSQL instance (not H2 — locking semantics need the real engine), with N threads (e.g., 50) all attempting to book the same slot concurrently via `ExecutorService` and `CountDownLatch` to start them simultaneously, then asserting exactly one booking row exists for that slot and 49 callers received a clean "unavailable" response rather than an exception or a duplicate. Second, a load test (k6 or JMeter) hammering a single hot slot and a spread of capacity-counter updates from many virtual users, checking both correctness (final counts, no duplicate bookings) and latency/throughput characteristics under realistic concurrency, which is where I'd catch connection-pool exhaustion or lock-wait timeout issues that a small unit test wouldn't surface.
```java
@Testcontainers
class SlotBookingConcurrencyTest {
    @Test
    void onlyOneBookingWinsForSameSlot() throws InterruptedException {
        int threads = 50;
        var latch = new CountDownLatch(1);
        var executor = Executors.newFixedThreadPool(threads);
        var successCount = new AtomicInteger();

        for (int i = 0; i < threads; i++) {
            int customerId = i;
            executor.submit(() -> {
                await(latch);
                try {
                    bookingService.bookSlot(slotId, customerId);
                    successCount.incrementAndGet();
                } catch (SlotUnavailableException ignored) { }
            });
        }
        latch.countDown();
        executor.shutdown();
        executor.awaitTermination(10, TimeUnit.SECONDS);

        assertThat(successCount.get()).isEqualTo(1);
        assertThat(bookingRepository.countBySlotId(slotId)).isEqualTo(1);
    }
}
```

**Q: How would this design change at 100x booking volume across many more categories?**
A: The single-database pessimistic-lock approach still holds correctness fine since locks are per-row, but I'd want to move the pre-database queueing (rate limiting / waiting room for hot slots) from an afterthought to a first-class piece of the architecture, and I'd revisit read traffic — availability *reads* (browsing slots) should be served from a read replica or a cache that's invalidated/updated on booking events, so the primary database's connection pool is reserved for the write-heavy booking path rather than being swamped by browse traffic.

**Q: If you had to eliminate the database lock-wait entirely for the hottest slots, what would you reach for?**
A: A queue-based booking model for known hot-launch events specifically — customers join a FIFO queue (e.g., backed by Redis) for a slot, and bookings are processed serially off that queue by a single worker, converting "many concurrent DB transactions contending for a lock" into "one worker processing a queue," which removes lock contention entirely at the cost of added latency (you wait in a queue instead of getting an instant DB response) and added infrastructure. I'd only reach for this for specific known hot-spot events, not as the default booking path, since it's meaningfully more complex than a row lock for the common case.

## Rapid-Fire Follow-ups
- Q: Pessimistic lock SQL for slot booking? A: `SELECT ... FOR UPDATE` on the slot row before checking availability.
- Q: Why pessimistic for slots but optimistic for capacity? A: Slots are hot/exclusive/must-not-race; capacity is diffuse/cheap-to-retry.
- Q: What Hibernate annotation drives optimistic locking? A: `@Version`.
- Q: What happens on an optimistic lock conflict? A: Zero-row `UPDATE`, `OptimisticLockException`, application retries with fresh data.
- Q: How is deadlock avoided? A: Single-row lock scope per transaction, consistent lock ordering when multiple locks are unavoidable, statement timeouts.
- Q: Why Postgres over MySQL here? A: JSONB for flexible category attributes, exclusion constraints for overlapping ranges, strong SERIALIZABLE support.
- Q: SSE vs WebSocket for availability updates? A: SSE — one-directional server push is all that's needed, simpler than full-duplex WebSocket.
- Q: How is multi-role moderation enforced in code? A: `@PreAuthorize` with permission-based checks plus a resource-ownership guard bean.
- Q: How do you test concurrent booking correctness? A: Testcontainers + real Postgres + N-thread `CountDownLatch` race, asserting exactly one winner.
- Q: What's the backstop if the lock discipline is ever bypassed? A: A unique constraint on the bookings table as a last line of defense.
