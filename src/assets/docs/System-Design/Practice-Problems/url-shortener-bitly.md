# Design a URL Shortener (like Bit.ly)

> Source: [hellointerview.com — Design a URL Shortener Like Bit.ly](https://www.hellointerview.com/learn/system-design/problem-breakdowns/bitly)

---

## What It Does

Takes a long URL → returns a short URL (e.g. `bit.ly/aX9kP2`).
When someone visits the short URL → they get redirected to the original long URL.

---

## Requirements

### Functional
- User can **submit a long URL** and get a **short URL** back
- Visiting the short URL **redirects** to the original long URL
- Optional: **custom aliases** (`bit.ly/my-link`)
- Optional: **URL expiration** (TTL)
- Optional: **analytics** (click count, geo, device)

### Non-Functional
- **High availability** — redirect must always work (more critical than write)
- **Low latency reads** — redirect should feel instant (< 100ms)
- **Scale** — billions of URLs stored, 100:1 read/write ratio

---

## Scale Estimation

```
Writes:  ~100M URLs created/day  → ~1,200 writes/sec
Reads:   100:1 ratio             → ~120,000 reads/sec
Storage: 500 bytes × 100M/day × 365 × 5 years ≈ ~90 TB
```

**Key insight:** This is a **read-heavy** system. Optimize for reads first.

---

## Core Entities

| Field       | Type     | Notes                        |
|-------------|----------|------------------------------|
| shortCode   | string   | 7-char unique key (PK)       |
| longUrl     | string   | original URL                 |
| userId      | string   | who created it               |
| createdAt   | datetime |                              |
| expiresAt   | datetime | nullable                     |

---

## API Design

```
POST /urls
Body: { longUrl, customAlias?, expiresAt? }
Response: { shortUrl: "https://bit.ly/aX9kP2" }

GET /{shortCode}
Response: 301/302 redirect → longUrl
```

---

## High-Level Design

We start with the simplest design that works, then evolve it.

### Initial Design — Write and Read

```
                                                        URLs
                                                   ┌──────────────────┐
┌──────────┐  POST /urls         ┌─────────────┐  │ shortCode  (PK)  │
│  Client  │────────────────────►│             │  │ longUrl          │
│          │◄────────────────────│  API Server │◄─►│ userId           │
└──────────┘  { shortUrl }       │             │  │ createdAt        │
                                 └─────────────┘  │ expiresAt        │
              GET /{shortCode}         │          └──────────────────┘
              ──────────────────────►  │
              ◄── 302 redirect to      │  (single DB, no cache yet)
                  longUrl              │

Write: 1) Generate shortCode (Base62 encode auto-increment ID)
       2) INSERT into DB (shortCode → longUrl)
       3) Return shortUrl

Read:  1) SELECT longUrl FROM urls WHERE shortCode = :code
       2) Return 302 redirect to longUrl
```

This works but at 120,000 reads/sec the DB becomes a bottleneck. We add a cache.

### Evolved Design — Adding Redis Cache for Reads

```
                              ┌─────────────────┐
                              │      Redis      │
                              │  shortCode      │  ← LRU eviction
                              │  → longUrl      │  ← TTL = URL expiry
                              └────────┬────────┘
                                       │ cache hit  → return instantly (<1ms)
                                       │ cache miss → read DB → populate
┌──────────┐  GET /{shortCode} ┌───────▼─────────┐
│  Client  │─────────────────►│                 │──────────────────► DB
│          │◄─────────────────│   API Server    │  (only on miss)
└──────────┘  302 → longUrl   │                 │
                              └─────────────────┘

80/20 rule: 20% of URLs get 80% of traffic → hot URLs stay warm in cache.
Cache hit ratio ~95%+ in practice → DB load drops dramatically.
```

---

## Deep Dives

### 1. URL Shortening Algorithm — How to Generate the Short Code?

**Option A — MD5/SHA Hashing**
Hash the long URL → take first 7 characters.
- Problem: **collision risk** (different URLs → same hash prefix)
- Problem: same URL always gets same code (may or may not be desirable)

**Option B — Base62 Encoding** ✅ (Recommended)
Use an **auto-increment ID** from DB → convert to Base62.
- Characters: `a-z A-Z 0-9` = 62 characters
- 7 characters = 62⁷ ≈ **3.5 trillion** unique URLs
- No collisions — ID is always unique
- Short, URL-safe characters

```
ID: 12345  →  base62 encode  →  "dnh"
bit.ly/dnh
```

**Option C — Random String**
Generate random 7-char alphanumeric string → check DB if it exists → retry if collision.
- Simple but collision probability grows as DB fills up

---

### 2. 301 vs 302 Redirect — Which to Use?

| | 301 Permanent | 302 Temporary |
|---|---|---|
| Browser caches redirect? | Yes | No |
| Every visit hits server? | No (cached) | Yes |
| Good for analytics? | No (browser skips server) | Yes |
| Good for server load? | Yes | No |

**Rule of thumb:**
- Use **302** if you need click analytics (every visit goes through your server)
- Use **301** if you want to minimize server load and don't need analytics

---

### 3. Caching Strategy (Redis)

**What to cache:** `shortCode → longUrl` mapping

**Why it works:** 80/20 rule — 20% of URLs get 80% of traffic. Hot URLs stay in cache.

```
Cache hit  → return longUrl in <1ms
Cache miss → query DB → populate cache → return longUrl
```

**Eviction policy:** LRU (Least Recently Used) — drop cold URLs first

**TTL on cache entries:** match URL expiration if set, otherwise long TTL (hours/days)

---

### 4. Database Choice

**SQL (PostgreSQL/MySQL)**
- Simple, strong consistency
- Works well up to ~billions of rows with proper indexing on `shortCode`

**NoSQL (Cassandra/DynamoDB)**
- Better horizontal scalability
- shortCode as partition key → O(1) lookup
- Good choice at very high scale

**Key index:** Always index on `shortCode` — that's the only read pattern.

---

### 5. Custom Aliases

User wants `bit.ly/my-brand` instead of a random code.
- Check DB if alias already taken → return error if so
- Store exactly as-is, skip the encoding step
- Slightly longer codes are fine

---

### 6. URL Expiration

- Store `expiresAt` in DB
- On redirect: check if expired → return 410 Gone
- Background job (cron) deletes expired rows periodically
- Redis TTL auto-expires cache entries

---

### 7. Analytics (Optional Deep Dive)

For each redirect, emit an event to a **message queue** (Kafka):
```
{ shortCode, timestamp, ip, userAgent, referer }
```
Async consumers process and store in a **time-series DB** or data warehouse.
This way analytics never slows down the redirect path.

---

## Complete Architecture

```
         ┌──────────────┐
         │   Client     │
         └──────┬───────┘
                │
         ┌──────▼───────┐
         │  Load        │
         │  Balancer    │
         └──────┬───────┘
                │
      ┌─────────▼──────────┐
      │    API Servers     │  (stateless, horizontally scalable)
      └──┬──────────────┬──┘
         │              │
  ┌──────▼──────┐  ┌────▼──────┐
  │  Redis      │  │ Database  │
  │  Cache      │  │ (SQL or   │
  │  (reads)    │  │  NoSQL)   │
  └─────────────┘  └─────┬─────┘
                         │
                  ┌──────▼──────┐
                  │  Kafka      │  ← async analytics events
                  └──────┬──────┘
                         │
                  ┌──────▼──────┐
                  │  Analytics  │
                  │  Consumer   │
                  └─────────────┘
```

---

## Variant Questions & Short Answers

**Q: What if two users submit the same long URL — same or different short code?**
> With hashing: same code. With Base62 (auto-increment ID): different codes. Hashing can dedup, but makes custom aliases harder. Trade-off: dedup saves storage, but adds complexity.

**Q: How do you prevent abuse / spam URLs?**
> Rate limiting per user/IP on the write endpoint. Blocklist for known malicious domains. Can integrate with Google Safe Browsing API to validate URLs before shortening.

**Q: How would you scale to 1 million writes/sec?**
> Distributed ID generation (Twitter Snowflake or a dedicated ID service) instead of a single DB auto-increment. This avoids DB becoming a write bottleneck.

**Q: What if you need the short URL to work globally with low latency?**
> Serve redirects via CDN edge nodes. Cache shortCode → longUrl at the CDN level. A 301 redirect means the browser caches it — never hits CDN again after first visit.

**Q: How do you handle URL expiration at scale?**
> Lazy deletion: check `expiresAt` on read, return 410 if expired. Background TTL cleanup job runs nightly. Redis TTL handles cache auto-expiry. Avoids expensive real-time scans.

**Q: Design just the analytics part — how many clicks per URL per day?**
> Client → API Server emits event to Kafka on each redirect. Consumer aggregates counts in Redis (INCR shortCode:date). Persist to DB (TimescaleDB or Cassandra) in batches. Read from Redis for real-time count, DB for historical.

---

## Technologies & Techniques — What You Learned & Where Else to Use Them

| Technology / Technique | What It Does Here | Use It Elsewhere For |
|---|---|---|
| **Base62 Encoding** | Convert numeric ID → short alphanumeric string | Any system needing compact unique IDs (invoice numbers, order codes, tokens) |
| **Redis (Cache)** | Cache shortCode → longUrl for fast redirects | Session storage, rate limiting counters, leaderboards, pub/sub |
| **Redis (TTL)** | Auto-expire cached URLs | Any time-bounded data: OTP codes, temp auth tokens, flash sale prices |
| **LRU Eviction** | Keep hot URLs in memory, drop cold ones | Any cache with limited memory (CDN, browser cache, CPU cache conceptually) |
| **301 vs 302 Redirect** | Control whether browser caches redirect | SEO (301 for permanent moves), A/B testing (302), feature flags |
| **Kafka (Message Queue)** | Decouple analytics from redirect path | Any async processing: email notifications, audit logs, event streaming |
| **Snowflake ID / Distributed ID** | Generate unique IDs without single DB bottleneck | Distributed systems needing globally unique IDs (Twitter posts, order IDs) |
| **Consistent Hashing** | Distribute cache across Redis nodes evenly | Distributed caches, load balancers, sharding any key-value store |
| **Read/Write Ratio Analysis** | Recognize read-heavy system → optimize reads | Any design — always identify the dominant operation early |
| **Lazy Deletion** | Don't scan for expired records, just check on access | Soft deletes, session expiry, cache invalidation patterns |
| **Rate Limiting** | Prevent abuse on write endpoint | Any public API, login endpoints, payment endpoints |
| **CDN for Redirects** | Serve 301 redirects from edge, near user | Static assets, API responses that rarely change, geo-distributed content |
| **NoSQL (Cassandra/DynamoDB)** | Horizontal scale with shortCode as partition key | Any high-volume key-value access pattern (user profiles, product catalog) |
