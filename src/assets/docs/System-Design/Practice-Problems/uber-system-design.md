# Design Uber (Ride-Sharing Service)

> Source: [hellointerview.com — Design a Ride-Sharing Service Like Uber](https://www.hellointerview.com/learn/system-design/problem-breakdowns/uber)

---

## What It Does

Riders request a ride from A to B → system finds and matches a nearby available driver → driver navigates to pickup → both track each other in real-time → trip completes → payment charged.

---

## Requirements

### Functional

**Above the line (must have):**
- Riders can input a start location and destination and **get a fare estimate**
- Riders can **request a ride** based on the estimated fare
- Riders are **matched with a nearby driver** who accepts the trip
- Riders and drivers can **see each other's real-time location** during a trip

**Below the line (out of scope):**
- Ratings and reviews
- Scheduled rides
- Multiple vehicle types / ride tiers
- Referral and promotions

### Non-Functional

- **Low latency matching** — rider should be matched to a driver in under 1 minute
- **Consistent matching** — a driver can only be matched to one rider at a time (no double-booking)
- **High availability** — the system should be available everywhere outside of matching
- **High throughput** — handle millions of concurrent driver location updates (peak: large events)

---

## Scale Estimation

```
Drivers online globally:   ~10M
Location update frequency: every 5 seconds per driver
Location writes/sec:       10,000,000 / 5 = 2,000,000 writes/sec

Ride requests/day:         ~10M  → ~115 requests/sec (bursts much higher)
Active trips at once:      ~500K
```

**Key insight:** This is an **extremely write-heavy** system. The dominant load is 2M location updates/sec. A naive SQL table scan to find nearby drivers won't work — geospatial indexing is critical.

---

## Core Entities

- **Rider** — personal info, payment methods
- **Driver** — personal info, vehicle info, availability status, current location
- **Trip** — links rider + driver, tracks state from request → completion

---

## API Design

```
# Rider gets a fare estimate
GET /trips/estimate?start={lat,lng}&end={lat,lng}
Response: { fareEstimate, etaMinutes }

# Rider requests a ride
POST /trips
Body: { startLocation, endLocation }
Response: { tripId, fareEstimate, etaMinutes }

# Driver updates location (called every ~5s)
PUT /drivers/{driverId}/location
Body: { lat, lng }
Response: 200 OK

# Driver goes online/offline
PUT /drivers/{driverId}/status
Body: { status: "AVAILABLE" | "OFFLINE" }
Response: 200 OK

# Accept a ride (driver)
POST /trips/{tripId}/accept
Response: { riderInfo, pickupLocation }

# Get live trip updates (WebSocket or polling)
GET /trips/{tripId}
Response: { status, driverLocation, etaMinutes }
```

---

## High-Level Design

We start with a simple design then evolve it per requirement.

### Initial Design — Fare Estimate + Requesting a Ride

```
                                                     Drivers
                                                 ┌──────────────────┐
                                                 │ id               │
┌────────────┐  GET /trips/estimate  ┌─────────┐ │ status           │
│  Rider App │──────────────────────►│         │ │ lat, lng         │
│            │◄──────────────────────│   API   │ │ vehicle_info     │
│            │  { fare, eta }        │ Server  │ └──────────────────┘
│            │                       │         │      Trips
│            │  POST /trips          │         │ ┌──────────────────┐
│            │──────────────────────►│         │ │ id               │
│            │◄──────────────────────│         │◄►│ rider_id         │
└────────────┘  { tripId }           └─────────┘ │ driver_id        │
                                                 │ status           │
                                                 │ start_location   │
                                                 │ end_location     │
                                                 └──────────────────┘

Fare estimate: routing engine (Google Maps / in-house) computes distance + ETA → apply rate card
Request ride:  INSERT trip (status=REQUESTED) → trigger Matching Service
```

### Adding Matching — Redis Geo Index

A SQL `SELECT WHERE distance < X` on 10M drivers is too slow. We need Redis geospatial.

```
┌────────────┐                        ┌──────────────────┐
│  Driver    │  PUT /location (every  │                  │  GEOADD drivers:available
│  App       │──5s)──────────────────►│ Location Service │──────────────────────────► Redis
└────────────┘                        └──────────────────┘

┌──────────────────┐  find nearby drivers   ┌─────────────────────┐
│ Matching Service │───────────────────────►│  Redis Geo Index    │
│                  │◄───────────────────────│  GEORADIUS 5km      │
│                  │  [driver_1, driver_2…] └─────────────────────┘
│                  │
│                  │  SET lock:driver:{id} NX PX 10000  ← claim driver atomically
│                  │──────────────────────────────────────────────► Redis
│                  │
│                  │  send offer to driver via push notification
└──────────────────┘
```

### Adding Real-Time Location Tracking — WebSocket + Pub/Sub

```
┌────────────┐  location update    ┌──────────────────┐
│  Driver    │────────────────────►│                  │  GEOADD (update position)
│  App       │  (WebSocket, 5s)    │ Location Service │──────────────────────────► Redis
└────────────┘                     │                  │  PUBLISH channel:trip:{id}
                                   └──────────────────┘       │
                                                              │ pub/sub fan-out
                                   ┌──────────────────┐       │
                                   │   Rider App      │◄──────┘
                                   │  (WebSocket)     │  receives driver's new lat/lng
                                   └──────────────────┘  → updates map in real time
```

---

## Deep Dives

### 1. How Do We Efficiently Find Nearby Drivers?

**The problem:** With 10M drivers updating location every 5 seconds = **2M writes/sec**. On each ride request we need to instantly find drivers within a few km. A simple `SELECT * WHERE distance < X` on a SQL table is too slow — calculating distance for every row doesn't scale.

**Option A — PostgreSQL with PostGIS**
Add a geospatial index to driver locations.
- `SELECT * FROM drivers WHERE ST_DWithin(location, :point, :radius) AND status = 'AVAILABLE'`
- Works well up to moderate scale
- At 2M writes/sec, even with indexing, a single Postgres instance becomes a bottleneck

**Option B — Elasticsearch with geo queries**
- Supports fast geo_distance queries
- Better write throughput than Postgres for this pattern
- Adds operational complexity

**Option C — Redis Geospatial** ✅ (Recommended)
Redis has a native sorted set backed by geohash that supports:
- `GEOADD` — add/update a driver's location in O(log N)
- `GEORADIUS` — find all drivers within X km in O(N+log M)

```
# Driver updates location
GEOADD drivers:available -73.9857 40.7484 "driver_123"

# Find nearest 10 drivers within 5km of rider
GEORADIUS drivers:available -73.9800 40.7500 5 km ASC COUNT 10
```

Why Redis wins here:
- Sub-millisecond reads and writes
- Easily handles 2M writes/sec with Redis Cluster
- In-memory — data loss is acceptable (drivers re-send location every 5s)
- Separate keys per city or region for horizontal partitioning

**How geohashing works:**
A geohash encodes a lat/lng pair into a short alphanumeric string. Nearby locations share the same prefix. Redis uses a 52-bit integer geohash internally as the sorted set score — this is what makes GEORADIUS efficient without needing to scan every record.

---

### 2. How Do We Solve the Ride Request Locking Problem?

**The problem:** Multiple riders could be requesting rides simultaneously. The Matching Service queries Redis and finds the same "best driver" for two different riders. Without locking, the same driver gets double-booked.

**Why this is hard:** The gap between "find driver" and "confirm driver" is a classic TOCTOU (time-of-check to time-of-use) race condition.

**Option A — Database-level locking (pessimistic)**
Lock the driver row in Postgres using `SELECT FOR UPDATE` during the match transaction.
- Prevents double booking
- Locks a DB row for the entire driver offer window (up to 10s) — blocks other operations

**Option B — Optimistic Locking**
Add a `version` field to the driver record. Match transaction reads version, writes back only if version hasn't changed.
- If two requests read the same driver simultaneously, only one CAS (compare-and-swap) wins
- Loser retries with the next available driver
- No blocking, better throughput

**Option C — Redis Atomic Operations** ✅ (Recommended)
Use Redis `SET NX` (set if not exists) as a distributed lock on the driver:

```
# Atomically claim driver — only succeeds for ONE requester
SET lock:driver:{driverId} {tripId} NX PX 10000
# NX = only set if key doesn't exist
# PX 10000 = auto-expire after 10 seconds (offer window)
```

- First rider to run this command acquires the lock
- All others get a null response → move to next driver
- Lock auto-expires if driver doesn't respond → no deadlock
- O(1) operation, works at scale, no DB round trip

**Flow:**
```
Matching Service finds top 5 drivers
→ Try SET NX on driver_1 → success → send offer to driver_1
  → driver accepts → update DB + remove Redis lock → done
  → driver rejects / timeout → release lock → try driver_2
```

---

### 3. How Do We Solve the Ride Request Queueing Problem?

**The problem:** When a rider requests a ride, the system finds a driver and sends an offer — but what if the driver rejects? Or if there are 5 riders all requesting at once and only 3 available drivers? We need an orderly queue, not a thundering herd.

**The naive approach:** Matching Service loops through drivers one at a time, waits for accept/reject, then tries the next. This is sequential and slow — if 5 drivers all reject, the rider waits 50 seconds.

**Better approach — Parallel offers with a queue:**

When a rider requests a ride:
1. Matching Service finds top N drivers (e.g. 5 nearest)
2. Sends offers to all N simultaneously via push notification / WebSocket
3. First driver to accept "wins" — the Redis lock (`SET NX`) ensures only one can claim the trip
4. The others receive a "ride no longer available" notification

**But what if all N reject?**
- Re-query Redis for the next batch of N drivers
- Extend the search radius if local drivers are exhausted
- After max retries → return "no drivers available" to rider

**What about fairness / preventing the same driver getting all offers?**
- Rotate through drivers by time-since-last-offer
- Don't re-offer to a driver who recently rejected

**Trip Request State Machine:**
```
REQUESTED
    ↓ matching succeeds
MATCHED (driver accepted)
    ↓ driver arrives at pickup
EN_ROUTE
    ↓ rider in car
IN_PROGRESS
    ↓ destination reached
COMPLETED

REQUESTED → CANCELLED (no drivers found, or rider cancels)
MATCHED   → CANCELLED (driver or rider cancels before pickup)
```

State transitions are written to the Trip table in Postgres (ACID guarantees — we need consistency here). Each transition emits an event to notify the other party.

---

## Complete Architecture

```
      ┌─────────────┐          ┌──────────────┐
      │  Rider App  │          │  Driver App  │
      └──────┬──────┘          └──────┬───────┘
             │                        │ (location every 5s)
      ┌──────▼────────────────────────▼───────┐
      │            API Gateway                │
      │       (Auth, Rate Limiting)           │
      └──────┬──────────────┬────────┬────────┘
             │              │        │
     ┌───────▼──┐   ┌───────▼──┐  ┌─▼──────────┐
     │  Trip    │   │ Location │  │Notification│
     │ Service  │   │ Service  │  │  Service   │
     └───────┬──┘   └───────┬──┘  └─────┬──────┘
             │              │            │
     ┌───────▼──┐   ┌───────▼──────┐  APNs/FCM
     │Matching  │   │  Redis       │  WebSocket
     │ Service  │──▶│  Geo Index   │  channels
     └───────┬──┘   │  + Locks     │
             │      └──────────────┘
     ┌───────▼──────────┐
     │   PostgreSQL     │
     │ (trips, drivers, │
     │   riders, state) │
     └──────────────────┘
```

---

## Variant Questions & Short Answers

**Q: How do you handle a driver going offline mid-trip?**
> Trip state stays IN_PROGRESS in Postgres. Location updates stop — rider sees last known position. WebSocket reconnects automatically. If driver truly disappears, support flow triggers and trip is force-completed. Redis lock on driver auto-expires.

**Q: How would you scale to handle a major event (Super Bowl, New Year's)?**
> Location Service and Matching Service are stateless — horizontally auto-scale ahead of the event. Redis Cluster handles the write volume. Pre-warm the geospatial index for the event area. Surge pricing kicks in to balance supply/demand.

**Q: How do you handle surge pricing?**
> Background job monitors demand/supply ratio per geohash region every minute. `surgeMultiplier = activeRequests / availableDrivers`. If ratio exceeds threshold, apply multiplier to fare. Store multipliers in Redis by geohash with a 60s TTL. Rider must explicitly confirm surge before trip starts.

**Q: What if Redis goes down and we lose all driver locations?**
> Redis holds ephemeral state. Recovery is automatic — drivers re-publish location every 5s, so the geo index rebuilds within seconds of Redis recovering. For HA, use Redis Cluster with replicas and persistence enabled (AOF) to minimize data loss window.

**Q: How would you design the ETA calculation?**
> At request time: use routing engine (Google Maps API or in-house road graph with A*) given start → pickup → destination. During trip: recalculate ETA every 30s using driver's current position. Cache common city routes in Redis with short TTL. For scale, pre-compute popular route ETAs during off-peak hours.

**Q: How do you prevent a bad actor from spamming ride requests?**
> Rate limiting at the API Gateway per userId and IP. Require valid payment method before allowing request. Charge cancellation fees after N cancellations to deter abuse.

---

## Technologies & Techniques — What You Learned & Where Else to Use Them

| Technology / Technique | What It Does Here | Use It Elsewhere For |
|---|---|---|
| **Redis Geospatial (GEOADD / GEORADIUS)** | Store and query driver locations by proximity in O(log N) | Restaurant search, store locator, asset tracking, proximity alerts |
| **Geohashing** | Encode lat/lng into a score for sorted set — nearby locations share prefixes | Spatial sharding, surge pricing by region, map tile caching |
| **Redis SET NX (Distributed Lock)** | Atomically claim a driver for a trip — only one rider wins | Any exclusive resource allocation: seat booking, coupon redemption, inventory hold |
| **TOCTOU Race Condition** | The window between finding a driver and locking them | Any read-then-write operation on shared mutable state |
| **WebSockets** | Persistent bidirectional channel for real-time location streaming | Chat, live dashboards, multiplayer games, collaborative editing |
| **Redis Pub/Sub** | Fan out driver location to rider's WebSocket connection | Notification broadcast, real-time feeds, live auction updates |
| **Trip State Machine** | Model valid lifecycle transitions for a ride | Order management, ticket/approval workflows, subscription billing |
| **Parallel Offer Fan-out** | Send ride offers to N drivers simultaneously, first to accept wins | Job dispatch systems, auction bidding, notification with fallback |
| **Stateless Services + Auto-scaling** | Location and Matching Services scale horizontally under event load | Any microservice that handles spiky traffic |
| **Surge Pricing (demand/supply ratio)** | Dynamic pricing to balance supply and demand in real time | Hotel/airline pricing, electricity markets, concert tickets |
| **PostGIS / Spatial Indexing** | SQL-native geo queries with R-tree index | Any relational system with location data at moderate scale |
| **Redis Cluster** | Horizontal partitioning of geo index across nodes | Any in-memory store needing scale beyond single node |
| **Ephemeral State Design** | Accept data loss for frequently re-written real-time data | Session presence, rate limit counters, real-time leaderboards |
