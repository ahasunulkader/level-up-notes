# Design a Ticket Booking System (Quantity-Based)

> Technique: [HelloInterview — System Design Framework](https://www.hellointerview.com/learn/system-design/in-a-hurry/introduction)

---

## What It Does

Users can browse events (concerts, sports, theatre) and book tickets by specifying **how many tickets they want** — the system automatically assigns the best available seats. Unlike traditional Ticketmaster where you pick a specific seat from a map, this system handles seat selection for you. The system must guarantee no two users are ever assigned the same seat, handle flash-sale levels of traffic (Taylor Swift drops tickets — 100K concurrent users), and release unconfirmed reservations back to the pool after a timeout.

---

## Requirements

### Functional

**Above the line (must have):**
- Users can **search for events** by name, date, city
- Users can **view event details** — venue, sections, price tiers, total availability count
- Users can **request N tickets** for an event — system auto-assigns the best available seats
- The system **holds seats for 10 minutes** while user completes checkout (reservation window)
- Users can **confirm the booking** by completing payment
- Users can **cancel a reservation** before payment (seats released immediately)
- Users can **view their bookings**

**Below the line (out of scope):**
- Users manually selecting specific seats from a seat map
- Resale / ticket transfer between users
- Dynamic pricing (surge pricing per demand)
- Refund processing after confirmed booking
- Mobile push notifications

### Non-Functional

- **Consistency** — a seat must never be assigned to two users simultaneously (no double booking)
- **Availability** — the system must remain available during high-demand events (99.99% uptime)
- **Low latency** — seat assignment response must return in < 500ms
- **Scalability** — handle 100K concurrent users during flash sales without degradation
- **Durability** — confirmed bookings must never be lost, even under server crash

---

## Scale Estimation

```
Registered users:             50M
Active events at any time:    10,000
Average venue capacity:       20,000 seats
Sections per venue:           5–10
Seats per row:                20–40

Normal traffic:
  Booking requests:           5,000 / sec
  Read (event/search):        50,000 / sec

Flash sale peak (large event):
  Burst requests:             100,000 / sec (10–30 second window)
  Target event sells out:     20,000 seats in < 2 minutes

Reservation hold:             10 minutes
Expiry jobs:                  ~50,000 active reservations at any time

Storage:
  Seats per year:             10,000 events × 20,000 seats = 200M seat rows
  Bookings per year:          ~100M
  Seat status updates:        heavy write during events going on sale
```

---

## Core Entities

```
Event
- id
- name
- venueId
- startTime
- status (ON_SALE / SOLD_OUT / CANCELLED)
- availableCount    ← cached counter (denormalized for fast reads)

Venue
- id
- name
- address
- totalCapacity

Section
- id
- venueId
- name              (e.g. "Floor A", "Level 2 East")
- tier              (FLOOR / LOWER / UPPER)
- pricePerSeat
- rowCount
- seatsPerRow

Seat
- id
- sectionId
- row               (e.g. "A", "B", "C")
- number            (1, 2, 3… per row)
- status            (AVAILABLE / RESERVED / BOOKED)
- eventId

Reservation
- id
- userId
- eventId
- seatIds[]         (the N seats held)
- quantity
- status            (ACTIVE / EXPIRED / COMPLETED)
- expiresAt         (createdAt + 10 minutes)
- idempotencyKey

Booking
- id
- userId
- eventId
- reservationId
- seatIds[]
- totalPrice
- status            (CONFIRMED / CANCELLED)
- confirmedAt
```

---

## API Design

```
# Search / Browse
GET  /events?query=taylor&date=2025-06-01&city=NYC
     → { events: [{ id, name, venue, startTime, priceFrom, availableCount }] }

GET  /events/{eventId}
     → { event, venue, sections: [{ id, name, tier, price, availableCount }] }

# Core booking flow
POST /reservations
     Body: { eventId, quantity, sectionPreference?: "FLOOR" }
     → 200: { reservationId, seats: [{ row, number, section }], expiresAt, totalPrice }
     → 409: { error: "not_enough_seats", available: 3 }
     → 429: { error: "queue_full", position: 4521, estimatedWait: "8 min" }

DELETE /reservations/{reservationId}
     → 200: { message: "reservation cancelled, seats released" }

POST /bookings
     Body: { reservationId, paymentMethod: { type, token } }
     → 200: { bookingId, confirmationCode, seats[], totalPrice }
     → 410: { error: "reservation_expired" }

GET  /bookings/{bookingId}
     → { booking, event, seats[], qrCode }

GET  /users/{userId}/bookings
     → { bookings: [...] }
```

---

## High-Level Design

We start with the simplest design that works, then evolve it per requirement.

---

### Initial Design — Search, View, Book N Tickets

```
                                                   Seats
                                              ┌──────────────────┐
                                              │ id               │
                                              │ event_id         │
┌──────────┐  GET /events         ┌────────┐  │ section_id       │
│  Client  │─────────────────────►│        │  │ row              │
│          │◄─────────────────────│  API   │  │ number           │
│          │  POST /reservations  │ Server │◄─►│ status           │
│          │─────────────────────►│        │  └──────────────────┘
│          │◄─────────────────────│        │
└──────────┘  { seats[], expiry } └────────┘  Reservations
                                         │  ┌──────────────────┐
                                         │  │ id               │
                                         └─►│ user_id          │
                                            │ event_id         │
                                            │ seat_ids[]       │
                                            │ status           │
                                            │ expires_at       │
                                            └──────────────────┘

Write (POST /reservations):
  1) Run Best Available Algorithm → find N adjacent AVAILABLE seats
  2) Lock seats atomically (SELECT FOR UPDATE)
  3) UPDATE seats SET status = RESERVED
  4) INSERT reservation (status=ACTIVE, expiresAt = now + 10min)
  5) Return seat details + expiry time

Read (GET /events):
  1) SELECT events with availableCount > 0
  2) Return list

Problem: At 100K concurrent users, the DB cannot handle locking 100K rows simultaneously.
         Two instances can find the same N seats before either locks them.
         We need Redis for atomic seat locking.
```

---

### Evolved Design — Redis for Atomic Seat Locking

The core consistency problem: two users both request 4 seats, both run the best-available algorithm at the same time, both find seats A1–A4 before either locks them. We need an atomic "find and lock" operation.

```
┌──────────┐  POST /reservations  ┌──────────────────────┐
│  Client  │─────────────────────►│   Booking Service    │
│          │◄─────────────────────│                      │
└──────────┘  { seats[], expiry } │  1) Find best N      │──────────────► DB (find candidates)
                                  │     seats            │
                                  │  2) Lua script lock  │
                                  │     ─────────────────┼──────────────► Redis
                                  │     SETNX all N      │  lock:seat:{id} = reservationId
                                  │     seats atomically │  TTL = 10 min
                                  │  3) If lock fails    │◄──────────────
                                  │     → retry next     │
                                  │     best candidates  │
                                  │  4) UPDATE DB seats  │──────────────► DB
                                  │     status=RESERVED  │  UPDATE + INSERT reservation
                                  └──────────────────────┘

Redis Lua (atomic — runs as single command, no interleaving):
  1) Check all N seat keys do NOT exist
  2) If any exist → return 0 (conflict, someone else locked them)
  3) SET all N seat keys with NX + TTL in one atomic script
  4) Return 1 (success)

Result: Only ONE user's Lua script wins for any given group of seats.
        The loser gets 0 back → re-runs best-available → finds next candidates.
```

---

### Adding Flash Sale Handling — Virtual Waiting Room

When a popular event goes on sale, 100K users hit POST /reservations simultaneously. Without throttling, all 100K hit the Booking Service and Redis at once — overwhelming both.

```
┌──────────┐                ┌──────────────┐      ┌─────────────┐
│  Client  │──POST /join ──►│              │      │   Redis     │
│          │◄── { pos: 4521}│   Queue      │──────►   Sorted    │
│          │                │   Service    │      │   Set       │
│          │                │              │      │ queue:{eid} │
└──────────┘                └──────┬───────┘      └─────────────┘
                                   │ dequeue N/sec
                                   ▼
                            ┌──────────────┐
                            │  Admit Token │   JWT token, 5-min TTL
                            │  Issuer      │──────────────────► User's client
                            └──────────────┘

┌──────────┐ POST /reservations   ┌──────────────────────┐
│  Client  │ (with admit token)──►│   Booking Service    │
│          │◄─────────────────────│   validates token    │──► Redis lock → DB
└──────────┘  { seats[], expiry } └──────────────────────┘

Without admit token → 429 Too Many Requests

How it works:
  1) User joins queue → gets position token (not a seat reservation)
  2) Queue Service processes ~1,000 users/sec (rate-controlled)
  3) When it's your turn → receive a 5-minute admit token
  4) Use admit token to call POST /reservations
  5) Rate is set such that booking requests ≤ system capacity
```

---

### Adding Event Availability Cache — Redis Counter

For GET /events, we don't want to COUNT(*) available seats from the DB on every request (slow at scale, 50K reads/sec). We maintain a counter in Redis.

```
┌──────────┐  GET /events/{id}    ┌──────────────────┐
│  Client  │─────────────────────►│   Event Service  │
│          │◄─────────────────────│                  │──► Redis GET event:avail:{id}
└──────────┘  { availableCount }  └──────────────────┘  (fast, in-memory)

Write path (seat reserved):
  Booking Service → DECRBY Redis event:avail:{id} by N

Write path (reservation expired / cancelled):
  Expiry Worker → INCRBY Redis event:avail:{id} by N

DB is source of truth. Redis counter is eventually consistent (re-synced on mismatch).
```

---

### Adding Reservation Expiry Worker

Seats reserved but never paid for must be released after 10 minutes. We need a reliable expiry mechanism.

```
At reservation creation:
  INSERT reservation (expires_at = now + 10min)
  Redis: SET reservation:{id} TTL=600s  ← also set in Redis for fast lookup


Expiry Worker (runs every 30 seconds):
  SELECT id, seat_ids FROM reservations
    WHERE status = 'ACTIVE' AND expires_at < NOW()
  LIMIT 1000;

  For each expired reservation:
    BEGIN TRANSACTION
      UPDATE reservations SET status = 'EXPIRED'
      UPDATE seats SET status = 'AVAILABLE' WHERE id IN (seat_ids)
    COMMIT

    DEL lock:seat:{id} for each seat in Redis
    INCRBY event:avail:{eventId} by N in Redis
```

---

### Final Architecture (All Requirements Combined)

```
                              ┌──────────────────────────────────────────────────────┐
                              │                      Redis                           │
                              │  lock:seat:{id}     → NX TTL=10min (seat lock)       │
                              │  event:avail:{id}   → integer (availability count)   │
                              │  queue:{eventId}    → sorted set (waiting room)      │
                              │  reservation:{id}   → TTL marker                     │
                              └──────────────────────────────────────────────────────┘
                                          ▲               ▲
                         ┌────────────────┘               └────────────────┐
                         │                                                 │
┌──────────┐  ┌──────────────────┐    ┌────────────────────┐    ┌──────────────────┐
│  Client  │─►│  API Gateway     │    │  Booking Service   │    │  Queue Service   │
│(Web/App) │  │  (Auth + Rate    │─┬─►│  - best available  │    │  - waiting room  │
└──────────┘  │   Limit)         │ │  │  - Lua seat lock   │    │  - admit tokens  │
              └──────────────────┘ │  │  - DB write        │    └──────────────────┘
                                   │  └────────────────────┘
                                   │             │
                                   │             ▼
                                   │    ┌─────────────────┐
                                   │    │   Primary DB    │
                                   │    │  (PostgreSQL)   │
                                   │    │  events         │
                                   │    │  venues         │
                                   │    │  sections       │
                                   │    │  seats          │
                                   │    │  reservations   │
                                   │    │  bookings       │
                                   │    └────────┬────────┘
                                   │             │ replication
                                   │             ▼
                                   │    ┌─────────────────┐
                                   ├───►│   Read Replica  │  ← search / browse queries
                                   │    └─────────────────┘
                                   │
                                   │    ┌─────────────────┐
                                   └───►│  Expiry Worker  │  ← polls every 30s
                                        │  (background)   │  ← releases expired seats
                                        └─────────────────┘
```

---

## Deep Dives

### 1. How Do We Find the Best N Available Seats?

This is the core algorithm that differentiates this system from traditional Ticketmaster.

**What does "best" mean?**
Users requesting 4 tickets want to sit together (adjacent seats, same row). Within that constraint they prefer better sections (floor > lower level > upper level) and closer to the stage (row A > row Z).

**Option A — Simple Row Scan (Greedy, First Fit)**

```
For each section ordered by tier (FLOOR first):
  For each row in section (front rows first):
    Scan seats left-to-right
    Find first window of N consecutive AVAILABLE seats
    → return immediately

Example: User wants 4 tickets.
  Row A: [BOOKED][BOOKED][AVAIL][AVAIL][AVAIL][AVAIL][BOOKED]
                          ↑ found 4 consecutive → return A3,A4,A5,A6
```

- Pro: O(seats_per_row) per row, very fast, simple
- Con: Returns the first fit, not necessarily the "best" (e.g., center row seats score higher)
- Works well for most events with moderate demand

**Option B — Scored Ranking**

```
Collect all valid groups of N consecutive seats across all rows
Score each group:
  adjacency bonus:  +100  (all in same row — guaranteed by design)
  row quality:      +50 × (1 / rowIndex)   (row A = 50pts, row B = 25pts...)
  center bonus:     +25 × (1 - |center_col - group_col| / max_col)

Sort by score DESC → return top group
```

- Pro: Always returns objectively best seats
- Con: O(total_seats) — for a 20,000 seat venue this is still only 20K iterations, which is fast enough

**Option C — Pre-Indexed Available Groups in Redis (Recommended at Scale)**

Pre-compute all groups of N seats per row and index them in a Redis Sorted Set, scored by quality. On request, atomically pop the top-scoring group.

```
Pre-compute (run when seats are loaded or when status changes):
  For each section, for each row:
    For each window of N consecutive seats (if all AVAILABLE):
      ZADD available_groups:{eventId}:{N} score "sectionId:row:startSeat"

On POST /reservations:
  ZPOPMAX available_groups:{eventId}:{N}
  → atomically returns best group AND removes it from the set
  → no two users get the same group
  → if group is somehow no longer available (DB mismatch): retry next
  → O(log N) per request

On cancellation / expiry:
  Re-add groups back to the sorted set
  ZADD available_groups:{eventId}:{N} score "sectionId:row:startSeat"
```

- Pro: Atomic, O(log N), no race conditions at group selection level
- Con: Pre-computation needed; sorted set grows large for popular events with many group sizes

**Recommended approach for interview:** Option B for simplicity + Option C for scale. Start with B, mention C as the optimization.

---

### 2. How Do We Prevent Double-Booking When Locking a Group of Seats?

**The problem:** Two users both request 4 seats. Both run Best Available and both find A3–A6 before either locks them.

**Option A — SELECT FOR UPDATE (Pessimistic DB Locking)**

```sql
BEGIN;

SELECT id FROM seats
  WHERE id IN (:seat1, :seat2, :seat3, :seat4)
    AND status = 'AVAILABLE'
  FOR UPDATE;  -- acquires row-level lock

-- Check: did we get all 4 rows back?
-- Yes → proceed
UPDATE seats SET status = 'RESERVED' WHERE id IN (:seat1,:seat2,:seat3,:seat4);
INSERT INTO reservations ...;

COMMIT;
```

- Pro: Simple, uses DB guarantees
- Con: Holds DB connection + row lock for entire transaction duration. Under 100K concurrent users, lock contention on the seats table becomes a bottleneck. Second instance trying to lock same row blocks until first commits/rolls back.

**Option B — Redis Lua Script (Recommended)**

Run a Lua script in Redis. Lua scripts execute atomically — no other command can run between lines.

```lua
-- Keys: lock:seat:1, lock:seat:2, lock:seat:3, lock:seat:4
-- Args: reservationId, ttlMs (e.g. 600000)

local seats = KEYS
local reservationId = ARGV[1]
local ttl = tonumber(ARGV[2])

-- Step 1: Check all seats are free
for _, key in ipairs(seats) do
  if redis.call('EXISTS', key) == 1 then
    return 0  -- conflict: at least one seat already locked
  end
end

-- Step 2: Lock all seats atomically
for _, key in ipairs(seats) do
  redis.call('SET', key, reservationId, 'PX', ttl)
end

return 1  -- all seats locked successfully
```

Flow:
```
User A: EVAL script [seat:A3, seat:A4, seat:A5, seat:A6] reservationId=R1 → 1 (wins)
User B: EVAL script [seat:A3, seat:A4, seat:A5, seat:A6] reservationId=R2 → 0 (loses)
User B: re-runs best-available → finds A7–A10 → tries again → wins
```

After Redis lock succeeds:
```sql
UPDATE seats SET status='RESERVED' WHERE id IN (:ids);
INSERT INTO reservations (id, seat_ids, expires_at) VALUES (...);
```

- Pro: Redis handles concurrency at microsecond speed; no DB lock contention
- Con: Two-phase write (Redis then DB) — if server crashes between them, Redis is locked but DB is not updated. Mitigated by the TTL (lock expires in 10 min, seats auto-release).

---

### 3. How Do We Handle 100K Concurrent Users During a Flash Sale?

**The problem:** Popular event goes on sale at noon. 100K users hammer POST /reservations simultaneously. Only 20K seats exist.

Without protection: 80K requests do work, burn CPU/DB connections, and fail anyway. Resources wasted. System may crash under load.

**Option A — Rate Limiter (Reject Overflow)**

```
Redis counter:  INCR requests:{eventId}
If counter > threshold (e.g. 2× capacity) → return 429 immediately

Pros: Simple, fast rejection
Cons: Unfair — users who got lucky with timing get through,
      others get hard 429 with no retry opportunity
```

**Option B — Virtual Waiting Room (Recommended)**

```
Phase 1: Join the queue (instant, never fails)
  POST /queue/join  { eventId }
  → Redis: ZADD queue:{eventId} {timestamp} {userId}
  → Returns: { position: 4521, estimatedWait: "8 min" }

Phase 2: Queue Processor drains queue at controlled rate
  Every second: ZPOPMIN queue:{eventId} COUNT 1000
  → Issue each dequeued user an "admit token" (signed JWT, 5-min TTL)
  → Push token to user via WebSocket or polling

Phase 3: User with admit token makes real booking request
  POST /reservations  (Authorization: Bearer <admitToken>)
  → Booking Service validates token signature + expiry
  → Proceeds with seat assignment

Rate: 1000 tokens/sec × 20 seats avg = 20,000 seats in 20 seconds
```

Queue state visualization (what user sees while waiting):
```
"You are #4,521 in line. Estimated wait: ~8 minutes."
Progress bar updates via WebSocket every 10 seconds.
```

- Pro: Fair (FIFO), smooth load, no crashes, users stay engaged
- Con: Extra infrastructure (queue service, WebSocket connections), complexity

**Option C — Hybrid (Simple + Effective)**

Issue a time-based raffle: users who load the event page within a 30-minute window before on-sale time are entered into a randomized order. At on-sale: each is assigned a random queue position, preventing the pure FIFO advantage of network proximity.

---

### 4. How Do We Reliably Expire Reservations After 10 Minutes?

If a user gets seats but never pays, those seats must be released exactly after 10 minutes.

**Option A — Polling the DB (Simple)**

```
Expiry Worker (single background job):
  Every 30 seconds:
    SELECT id, seat_ids, event_id FROM reservations
    WHERE status = 'ACTIVE' AND expires_at < NOW()
    LIMIT 500;

    For each:
      BEGIN TRANSACTION;
        UPDATE reservations SET status = 'EXPIRED' WHERE id = :id AND status = 'ACTIVE';
        UPDATE seats SET status = 'AVAILABLE' WHERE id IN (:seat_ids);
      COMMIT;
      DEL lock:seat:{id} in Redis for each seat;
      INCRBY event:avail:{eventId} by N in Redis;
```

- Index needed: `CREATE INDEX ON reservations(status, expires_at)` — makes the poll fast
- Pro: Simple, reliable, survives worker restarts
- Con: Max 30-second delay before seats are released; polling overhead

**Option B — Redis Keyspace Notifications**

Set `reservation:{id}` key in Redis with TTL = 600s. Enable keyspace notifications. When key expires, Redis publishes `__keyevent@0__:expired`. A subscriber catches this and triggers DB cleanup.

- Pro: Near-exact expiry timing
- Con: Redis keyspace notification delivery is best-effort (fire-and-forget), not guaranteed. If subscriber is down during expiry, the event is missed. Need fallback polling anyway.

**Recommended: Option A (polling)** with a 30-second interval. Simple, reliable, survives any crash. The 30-second delay is acceptable — seats aren't released instantly but that's fine for user experience. Mention Option B as an enhancement for tighter expiry timing.

---

## Summary of Key Design Decisions

| Problem | Decision | Why |
|---|---|---|
| Seat assignment | Best Available algorithm (scored row scan) | Adjacent seats, quality ordering |
| Atomic locking | Redis Lua script (SETNX all N seats) | Atomic, no DB lock contention |
| Flash sale | Virtual waiting room (Redis sorted set) | Fair, prevents thundering herd |
| Reservation expiry | Polling worker (30s interval) | Simple, reliable, survives crashes |
| Availability count | Redis counter (INCR/DECR) | Fast reads, avoids COUNT(*) on seats |
| DB | PostgreSQL | ACID transactions, relational data |
