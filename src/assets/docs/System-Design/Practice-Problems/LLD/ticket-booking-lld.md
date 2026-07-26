# Ticket Booking System — Low-Level Design (Quantity-Based)

> Companion to: [HLD — Ticket Booking System](../HLD/ticket-booking-hld)

---

## Overview

This LLD covers the internal mechanics of the ticket booking system where users specify **quantity** rather than specific seats. The system auto-assigns the best available adjacent seats. The three hardest problems here are:

1. **Best Available Algorithm** — finding the optimal N seats efficiently
2. **Atomic Group Locking** — ensuring no two users get the same seat
3. **Reservation Expiry** — reliably releasing unclaimed seats

---

## Database Schema

### `events`
```sql
CREATE TABLE events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(255)    NOT NULL,
  venue_id      UUID            NOT NULL REFERENCES venues(id),
  start_time    TIMESTAMPTZ     NOT NULL,
  status        VARCHAR(20)     NOT NULL DEFAULT 'ON_SALE',
                                -- ON_SALE | SOLD_OUT | CANCELLED
  available_count INT           NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- status CHECK
ALTER TABLE events ADD CONSTRAINT chk_event_status
  CHECK (status IN ('ON_SALE', 'SOLD_OUT', 'CANCELLED'));
```

### `venues`
```sql
CREATE TABLE venues (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(255)    NOT NULL,
  address       TEXT            NOT NULL,
  total_capacity INT            NOT NULL
);
```

### `sections`
```sql
CREATE TABLE sections (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id      UUID            NOT NULL REFERENCES venues(id),
  name          VARCHAR(100)    NOT NULL,  -- "Floor A", "Level 2 East"
  tier          VARCHAR(20)     NOT NULL,  -- FLOOR | LOWER | UPPER
  price_cents   INT             NOT NULL,  -- store as cents (avoid float)
  row_count     INT             NOT NULL,
  seats_per_row INT             NOT NULL,
  quality_score INT             NOT NULL   -- pre-computed rank (higher = better)
);
```

### `seats`
```sql
CREATE TABLE seats (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      UUID            NOT NULL REFERENCES events(id),
  section_id    UUID            NOT NULL REFERENCES sections(id),
  row_label     CHAR(3)         NOT NULL,  -- "A", "B", "AA"
  seat_number   SMALLINT        NOT NULL,  -- 1, 2, 3...
  status        VARCHAR(20)     NOT NULL DEFAULT 'AVAILABLE',
                                -- AVAILABLE | RESERVED | BOOKED
  version       INT             NOT NULL DEFAULT 0  -- optimistic lock version
);

-- Critical indexes
CREATE INDEX idx_seats_event_status   ON seats(event_id, status);
CREATE INDEX idx_seats_event_section  ON seats(event_id, section_id, row_label, seat_number);
CREATE UNIQUE INDEX ux_seat_position  ON seats(event_id, section_id, row_label, seat_number);
```

**Why `version`?** Used for optimistic locking as a fallback when the Redis lock path fails. `UPDATE seats SET status='RESERVED', version=version+1 WHERE id=:id AND version=:expected`.

### `reservations`
```sql
CREATE TABLE reservations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID            NOT NULL,
  event_id         UUID            NOT NULL REFERENCES events(id),
  seat_ids         UUID[]          NOT NULL,  -- array of locked seat ids
  quantity         SMALLINT        NOT NULL,
  status           VARCHAR(20)     NOT NULL DEFAULT 'ACTIVE',
                                   -- ACTIVE | EXPIRED | COMPLETED | CANCELLED
  total_price_cents INT            NOT NULL,
  expires_at       TIMESTAMPTZ     NOT NULL,
  idempotency_key  VARCHAR(100)    UNIQUE,     -- client-supplied, prevents duplicate reservations
  created_at       TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- Expiry worker uses this index
CREATE INDEX idx_reservations_expiry
  ON reservations(status, expires_at)
  WHERE status = 'ACTIVE';
```

### `bookings`
```sql
CREATE TABLE bookings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID            NOT NULL,
  event_id          UUID            NOT NULL REFERENCES events(id),
  reservation_id    UUID            NOT NULL REFERENCES reservations(id),
  seat_ids          UUID[]          NOT NULL,
  total_price_cents INT             NOT NULL,
  status            VARCHAR(20)     NOT NULL DEFAULT 'CONFIRMED',
                                    -- CONFIRMED | CANCELLED
  confirmation_code VARCHAR(20)     NOT NULL UNIQUE,
  confirmed_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bookings_user ON bookings(user_id, confirmed_at DESC);
```

---

## Service Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         API Gateway                             │
│  - JWT auth validation                                          │
│  - Rate limiting (token bucket per user)                        │
│  - Admit token validation (for flash sales)                     │
└───────────────────────────────┬─────────────────────────────────┘
                                │
        ┌───────────────────────┼────────────────────┐
        ▼                       ▼                    ▼
┌───────────────┐     ┌──────────────────┐   ┌──────────────┐
│ Event Service │     │ Booking Service  │   │ Queue Service│
│               │     │                 │   │              │
│ - list events │     │ - find seats    │   │ - join queue │
│ - event detail│     │ - lock seats    │   │ - issue token│
│ - avail count │     │ - create resv   │   │ - drain queue│
└───────────────┘     │ - confirm/pay   │   └──────────────┘
                      │ - cancel resv   │
                      └────────┬────────┘
                               │
              ┌────────────────┼───────────────┐
              ▼                ▼               ▼
        ┌──────────┐    ┌────────────┐   ┌───────────┐
        │ Postgres │    │   Redis    │   │  Payment  │
        │  (write) │    │            │   │  Service  │
        └──────────┘    └────────────┘   └───────────┘
              │
              ▼
        ┌──────────┐
        │  Read    │   ← event search, booking history
        │ Replica  │
        └──────────┘
```

---

## Best Available Seat Algorithm

### Pseudocode

```
function findBestAvailableSeats(eventId, quantity, sectionPreference):

  // Step 1: Get sections ordered by quality (best first)
  sections = SELECT * FROM sections
             WHERE venue_id = (SELECT venue_id FROM events WHERE id = eventId)
             ORDER BY quality_score DESC

  // Optional: filter by user's section preference
  if sectionPreference:
    sections = sections.filter(s => s.tier == sectionPreference) + remaining

  bestGroup = null
  bestScore = -1

  // Step 2: For each section, scan rows
  for section in sections:

    // Step 3: Load available seats for this section, ordered by row + seat number
    seats = SELECT id, row_label, seat_number, status
            FROM seats
            WHERE event_id = eventId
              AND section_id = section.id
              AND status = 'AVAILABLE'
            ORDER BY row_label ASC, seat_number ASC

    // Step 4: Group by row
    byRow = groupBy(seats, s => s.row_label)

    for (rowLabel, rowSeats) in byRow:

      // Step 5: Find consecutive windows of `quantity` in this row
      for i in range(0, len(rowSeats) - quantity + 1):
        window = rowSeats[i : i + quantity]

        // Check consecutive: seat numbers must be i+1, i+2... (no gaps)
        if not isConsecutive(window):
          continue

        // Step 6: Score this group
        score = scoreGroup(window, section, rowLabel, i, section.seats_per_row)

        if score > bestScore:
          bestScore = score
          bestGroup = window

  if bestGroup == null:
    // No group of `quantity` consecutive seats found
    // Try splitting: find groups of (quantity-1) + 1 in adjacent rows?
    // For MVP: return error "not enough adjacent seats"
    return Error(NOT_ENOUGH_ADJACENT_SEATS, available: countAvailable(eventId))

  return bestGroup


function scoreGroup(seats, section, rowLabel, startIndex, totalSeatsInRow):
  score = 0

  // Tier bonus: FLOOR=300, LOWER=200, UPPER=100
  score += TIER_SCORES[section.tier]

  // Row quality: earlier rows (A=26, B=25...) get higher score
  rowRank = 26 - (rowLabel.charCodeAt(0) - 'A'.charCodeAt(0))
  score += rowRank * 5

  // Center bonus: seats closer to middle of row score higher
  groupCenter = startIndex + (seats.length / 2)
  rowCenter = totalSeatsInRow / 2
  centerDist = abs(groupCenter - rowCenter)
  score += max(0, 20 - centerDist)  // max 20 bonus, drops off with distance

  return score
```

### Example Walkthrough

```
Event: Concert X | User requests: 4 tickets | Venue: 3 sections

Section FLOOR (quality_score=300):
  Row A: [BOOKED][BOOKED][BOOKED][AVAIL][AVAIL][AVAIL][BOOKED][BOOKED]
    → window at index 3: seats A4,A5,A6 → only 3 consecutive, skip
  Row B: [AVAIL][AVAIL][AVAIL][AVAIL][AVAIL][BOOKED][AVAIL][AVAIL]
    → window at index 0: B1,B2,B3,B4 → 4 consecutive ✓
       score = 300 (floor) + 25*5 (row B) + 16 (center bonus) = 441
    → window at index 1: B2,B3,B4,B5 → 4 consecutive ✓
       score = 300 + 125 + 18 = 443 (slightly more centered)
    → bestGroup so far = [B2,B3,B4,B5] score=443

Section LOWER (quality_score=200):
  Row A: [AVAIL][AVAIL][AVAIL][AVAIL][AVAIL]...
    → window at index 0: A1,A2,A3,A4
       score = 200 + 130 + 16 = 346 → less than 443

→ Final result: [B2, B3, B4, B5] in Floor section
```

---

## Seat Locking — Full Flow

### Redis Key Design

```
lock:seat:{seatId}           → value: reservationId  | TTL: 600s (10 min)
event:avail:{eventId}        → integer counter         | no TTL (permanent)
admit:{token}                → userId                  | TTL: 300s (5 min)
queue:{eventId}              → sorted set (score=timestamp, member=userId)
```

### Lua Script (Atomic Multi-Seat Lock)

```lua
-- KEYS: lock:seat:uuid1, lock:seat:uuid2, lock:seat:uuid3, lock:seat:uuid4
-- ARGV[1]: reservationId (string)
-- ARGV[2]: ttl in milliseconds (e.g. "600000")

local reservationId = ARGV[1]
local ttl = ARGV[2]

-- Phase 1: Verify all seats are free (no key exists)
for i = 1, #KEYS do
  if redis.call('EXISTS', KEYS[i]) == 1 then
    -- Return which seat caused conflict (for debugging)
    return {0, KEYS[i]}
  end
end

-- Phase 2: Lock all seats (only reached if ALL are free)
for i = 1, #KEYS do
  redis.call('SET', KEYS[i], reservationId, 'PX', ttl)
end

return {1, ""}
```

### Full Booking Service Flow

```
POST /reservations
  Body: { eventId, quantity, sectionPreference, idempotencyKey }

1. IDEMPOTENCY CHECK
   SELECT id FROM reservations WHERE idempotency_key = :key AND status = 'ACTIVE'
   → If found: return existing reservation (do not double-reserve)

2. FIND BEST SEATS
   seats = findBestAvailableSeats(eventId, quantity, sectionPreference)
   → If error: return 409 { error: "not_enough_seats", available: N }

3. LOCK IN REDIS (Lua script)
   result = EVAL luaScript KEYS=[lock:seat:id1...idN] ARGV=[reservationId, 600000]
   → result[0] == 0: conflict → go back to step 2, retry up to 3 times
   → result[0] == 1: all seats locked, proceed

4. WRITE TO DB (transaction)
   BEGIN;
     INSERT INTO reservations (id, user_id, event_id, seat_ids, quantity,
                               status, expires_at, idempotency_key, total_price_cents)
     VALUES (..., NOW() + INTERVAL '10 minutes', ...);

     UPDATE seats SET status = 'RESERVED', version = version + 1
     WHERE id = ANY(:seatIds) AND status = 'AVAILABLE';
     -- Rows updated must equal quantity — if not, another writer snuck through
     -- (DB-level safety net in case Redis lock was somehow bypassed)
     GET DIAGNOSTICS updated_count = ROW_COUNT;
     IF updated_count != quantity THEN
       ROLLBACK;
       RAISE EXCEPTION 'concurrent_modification';
     END IF;
   COMMIT;

5. UPDATE AVAILABILITY COUNTER
   DECRBY event:avail:{eventId} {quantity}

6. RETURN RESPONSE
   {
     reservationId: "uuid",
     seats: [{ row, number, section, price }],
     expiresAt: "2025-06-01T10:10:00Z",
     totalPrice: { amount: 480.00, currency: "USD" }
   }
```

### What Happens on Conflict (Retry Logic)

```
Attempt 1: findBestSeats → [B2,B3,B4,B5] → Lua lock → conflict (B3 taken)
Attempt 2: findBestSeats → re-query DB (B3 now RESERVED) → [B6,B7,B8,B9] → lock → success
Attempt 3 (if needed): same pattern

Max retries: 3
If 3 all fail: return 409 { error: "high_demand", message: "Please try again" }
```

---

## Reservation Expiry — Full Flow

### Expiry Worker

```python
# Runs as a background process (single instance, or with distributed lock)

def run_expiry_worker():
  while True:
    sleep(30)  # poll every 30 seconds

    expired = db.query("""
      SELECT id, seat_ids, event_id, quantity
      FROM reservations
      WHERE status = 'ACTIVE'
        AND expires_at < NOW()
      LIMIT 500
      FOR UPDATE SKIP LOCKED   -- prevents multiple workers processing same row
    """)

    for reservation in expired:
      try:
        with db.transaction():
          db.execute("""
            UPDATE reservations
            SET status = 'EXPIRED'
            WHERE id = %s AND status = 'ACTIVE'
          """, reservation.id)

          db.execute("""
            UPDATE seats
            SET status = 'AVAILABLE', version = version + 1
            WHERE id = ANY(%s)
          """, reservation.seat_ids)

        # Release Redis locks
        for seat_id in reservation.seat_ids:
          redis.delete(f"lock:seat:{seat_id}")

        # Restore availability counter
        redis.incrby(f"event:avail:{reservation.event_id}", reservation.quantity)

        # Re-index seats into available_groups sorted set (for pre-computed approach)
        reindex_seat_groups(reservation.event_id, reservation.seat_ids)

      except Exception as e:
        log_error(e)
        continue  # move to next reservation
```

**`FOR UPDATE SKIP LOCKED`** — if running multiple worker instances, this prevents two workers from processing the same expired reservation simultaneously.

### Edge Case: Server Crash During Reservation

```
Scenario: Redis lock set, server crashes before DB write

Result:
  - Redis has lock:seat:{id} with TTL=10min
  - DB has no reservation row
  - Seat status is still AVAILABLE in DB

After 10 minutes:
  - Redis TTL expires → lock:seat:{id} deleted
  - Expiry worker finds nothing to expire (no DB row)
  - Seat naturally becomes available again

User impact: They see a brief failure, must re-request → system self-heals
```

---

## API Contracts (Full Detail)

### POST /reservations

**Request:**
```json
{
  "eventId": "550e8400-e29b-41d4-a716-446655440000",
  "quantity": 4,
  "sectionPreference": "FLOOR",
  "idempotencyKey": "user-123-event-456-req-001"
}
```

**Response 200 — Success:**
```json
{
  "reservationId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "seats": [
    { "id": "uuid1", "section": "Floor A", "row": "B", "number": 2 },
    { "id": "uuid2", "section": "Floor A", "row": "B", "number": 3 },
    { "id": "uuid3", "section": "Floor A", "row": "B", "number": 4 },
    { "id": "uuid4", "section": "Floor A", "row": "B", "number": 5 }
  ],
  "expiresAt": "2025-06-01T10:10:00Z",
  "totalPrice": {
    "amountCents": 48000,
    "currency": "USD",
    "display": "$480.00"
  }
}
```

**Response 409 — Not Enough Adjacent Seats:**
```json
{
  "error": "not_enough_adjacent_seats",
  "message": "Could not find 4 adjacent available seats. Try a lower quantity or different section.",
  "available": 7
}
```

**Response 429 — Flash Sale Queue:**
```json
{
  "error": "queue_required",
  "message": "High demand event. Please join the waiting room.",
  "queuePosition": 4521,
  "estimatedWaitSeconds": 480
}
```

---

### POST /bookings

**Request:**
```json
{
  "reservationId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "paymentMethod": {
    "type": "CARD",
    "token": "tok_visa_4242"
  }
}
```

**Response 200 — Confirmed:**
```json
{
  "bookingId": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
  "confirmationCode": "TKT-X7K9-2025",
  "seats": [
    { "section": "Floor A", "row": "B", "number": 2 },
    { "section": "Floor A", "row": "B", "number": 3 },
    { "section": "Floor A", "row": "B", "number": 4 },
    { "section": "Floor A", "row": "B", "number": 5 }
  ],
  "event": {
    "name": "Taylor Swift — Eras Tour",
    "startTime": "2025-06-01T19:00:00Z",
    "venue": "Madison Square Garden, New York"
  },
  "totalPrice": { "amountCents": 48000, "currency": "USD" },
  "qrCode": "data:image/png;base64,..."
}
```

**Response 410 — Reservation Expired:**
```json
{
  "error": "reservation_expired",
  "message": "Your reservation expired at 10:10 AM. Please search for available seats again."
}
```

---

## Booking Service — Full Confirm Flow

```
POST /bookings
  Body: { reservationId, paymentMethod }

1. LOAD RESERVATION
   SELECT * FROM reservations WHERE id = :reservationId AND user_id = :authUserId
   → Not found or wrong user: 404
   → status = EXPIRED: 410
   → status = COMPLETED: 409 (already booked)
   → status = ACTIVE and expires_at < NOW(): mark EXPIRED + return 410

2. CHARGE PAYMENT
   result = paymentService.charge(paymentMethod.token, reservation.total_price_cents)
   → failure: return 402 { error: "payment_failed", reason: result.declineCode }
   → success: paymentIntentId = result.id

3. CONFIRM IN DB (atomic)
   BEGIN;
     UPDATE reservations SET status = 'COMPLETED' WHERE id = :reservationId;
     UPDATE seats SET status = 'BOOKED' WHERE id = ANY(:seatIds);
     INSERT INTO bookings (user_id, event_id, reservation_id, seat_ids,
                           total_price_cents, confirmation_code)
     VALUES (..., generate_confirmation_code());
   COMMIT;

4. RELEASE REDIS LOCKS
   DEL lock:seat:{id} for each seat
   (TTL would expire anyway but clean up immediately)

5. RETURN BOOKING CONFIRMATION
```

**What if server crashes after payment but before DB write?**

This is the "dual write" problem. Handled with an idempotency log:
- Before charging, write a `payment_attempts` row with `status=PENDING`
- After charge, update to `COMPLETED`
- On retry: check `payment_attempts` first — if COMPLETED, skip charge, proceed to DB write

---

## Edge Cases

### User requests more tickets than seats available
```
Request: quantity=10, event has 7 available

→ findBestAvailableSeats returns Error(NOT_ENOUGH_SEATS, available=7)
→ API returns 409 { error: "not_enough_seats", available: 7 }
→ Client shows: "Only 7 seats available. Would you like 7 instead?"
```

### User requests 4 but only 3 are adjacent (fragmented availability)
```
Row B: [BOOKED][AVAIL][AVAIL][AVAIL][BOOKED][AVAIL][AVAIL][AVAIL][AVAIL]
        groups: max 3 adjacent       groups: max 4 adjacent

→ Algorithm skips max-3 group, finds 4 adjacent in second window
→ Returns seats B6, B7, B8, B9

If no row has 4 consecutive anywhere:
→ Return 409 with message suggesting smaller quantity or different section
```

### Concurrent users, one wins the seat lock, other retries
```
User A and User B both find [B2,B3,B4,B5]
User A: Lua lock → success → books [B2,B3,B4,B5]
User B: Lua lock → conflict on B2 → retry
User B: re-query DB → B2,B3,B4,B5 now RESERVED → finds [B6,B7,B8,B9] → success

No double booking. User B got slightly worse seats but still got 4 adjacent.
```

### Reservation expires mid-checkout (user on payment page)
```
User got reservation at 10:00 AM, expires 10:10 AM
User is on payment page at 10:09 AM, submits at 10:11 AM

Expiry worker runs at 10:10:30 → marks reservation EXPIRED, releases seats
User's POST /bookings at 10:11 → step 1 checks status = EXPIRED → return 410

User sees: "Your reservation expired. Please search for seats again."
Client shows 5-minute countdown timer during checkout to prevent this.
```

### Double-submission (user clicks "Pay" twice)
```
Both requests carry same reservationId.
First request: acquires DB row lock via SELECT FOR UPDATE → proceeds
Second request: SELECT FOR UPDATE → blocks → first commits →
               second reads status = COMPLETED → return 409 "already booked"

Or: use reservation idempotency_key — same key → same response returned
```
