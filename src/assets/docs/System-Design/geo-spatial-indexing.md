# Geospatial Indexing — Quadtrees & Geohashing

> **Interactive Demo:** Open [`/assets/geo-spatial-interactive.html`](/assets/geo-spatial-interactive.html) in your browser for a clickable visual of both approaches.

---

## The Problem

You need to answer: **"Give me all restaurants / drivers / users within 5 km of this point."**

**Naive approach (wrong):**
```sql
SELECT * FROM locations;
-- then calculate distance for every row in code
```
With 100 million rows this is O(n) — completely unusable.

**The fix:** Spatial indexing — shrink the search space before you calculate any distances.

---

## Solution 1 — Geohashing

### What It Is

Divide the entire world into a **fixed rectangular grid**. Each cell gets a short string (the hash). The longer the string, the smaller (more precise) the area.

```
World (1 char)  →  Continent (2 chars)  →  City (5 chars)  →  Street (6 chars)
     "d"                "dp"                  "dp3wj"             "dp3wjh"
```

**Key rule:** Nearby places share a **common prefix**.
- `dp3wjh` and `dp3wjk` → same block
- `dp3` and `dp4` → same city but different neighborhoods

### How the Encoding Works

1. Split longitude [−180, +180] → left half = `0`, right half = `1`
2. Split latitude [−90, +90] → bottom half = `0`, top half = `1`
3. **Alternate bits:** lon, lat, lon, lat, lon...
4. Every **5 bits** → 1 Base-32 character (chars: `0-9 b-z`, no `a i l o`)

```
Point: lat=40.7, lon=-74.0 (New York City)
Lon bit 1: -74 is in right half of [-180,0] → 1
Lat bit 1:  40 is in top half of [0, 90]    → 1
Lon bit 2: -74 is in left half of [-90,0]   → 0
...continuing → 5 bits = 1 char → result: "dr5r"
```

### Precision Levels

| Level | Cell Size    | Good For               |
|-------|--------------|------------------------|
| 1     | ~5,000 km    | Continent              |
| 2     | ~1,250 km    | Country                |
| 3     | ~156 km      | State / Region         |
| 4     | ~39 km       | City                   |
| **5** | **~4.9 km**  | **Neighborhood ★**     |
| **6** | **~1.2 km**  | **Street ★**           |
| 7     | ~152 m       | Building               |
| 8     | ~38 m        | Room                   |
| 9     | ~4.8 m       | Person                 |

> **Interview rule:** Use **level 5 or 6** for most "find nearby" problems (Yelp, Tinder, Uber).

### The Edge Problem

Two points can be centimeters apart but have completely different hash prefixes if they sit on opposite sides of a cell boundary.

```
Cell "dp3wj"  |  Cell "dp3wk"
              |
   Point A ●  |  ● Point B   ← 10 meters apart but DIFFERENT prefixes!
```

**Fix:** Always query the target cell + its **8 neighbors** (3×3 grid).

### Nearby Search Algorithm (Geohash)

```
1. Geohash the user's location at precision 6 → "dp3wjh"
2. Get 8 neighbor cells → ["dp3wjk", "dp3wjm", "dp3wje", ...] (9 total)
3. Query DB:
      SELECT * FROM places
      WHERE geohash IN ('dp3wjh','dp3wjk','dp3wjm',...)

4. For each result, calculate actual distance (Haversine)
5. Filter: keep only results within 5 km
6. Sort by distance, return top N
```

### DB Schema

```sql
CREATE TABLE places (
  id         BIGINT PRIMARY KEY,
  name       VARCHAR(255),
  lat        DECIMAL(9,6),
  lon        DECIMAL(9,6),
  geohash    VARCHAR(12),   -- stored at full precision (e.g. 9 chars)
  INDEX idx_geohash (geohash)  -- prefix scan is fast with this index
);
```

---

## Solution 2 — Quadtree

### What It Is

A tree data structure where each node has **exactly 4 children** (NW, NE, SW, SE). Space is divided **only when a cell gets crowded** — it adapts to data density.

### How It Works

```
Start: one cell covering the whole area

          ┌─────────────────────────────────┐
          │           (3 points)             │
          └─────────────────────────────────┘
                    Add a 4th point →
          ┌──────────┬──────────────────────┐
          │ NW  ●●   │  NE  ●               │   ← cell split into 4
          ├──────────┼──────────────────────┤
          │ SW       │  SE  ●               │
          └──────────┴──────────────────────┘
                Keep adding to NE →
          ┌──────────┬─────────┬────────────┐
          │  NW      │ NE/NW ● │ NE/NE ●●   │   ← NE split again
          │          │         │             │
          └──────────┴─────────┴────────────┘
```

**Key insight — Adaptive:**
- Dense city → many small, deep cells
- Empty ocean → one huge, shallow cell

### Tree Node Structure

```
QNode {
  x, y, width, height   // bounding box
  depth                 // how deep in the tree
  points[]              // only populated in leaf nodes
  children[4]           // NW, NE, SW, SE (null if leaf)
}
```

### Nearby Search Algorithm (Quadtree)

```
1. Traverse tree from root → find the leaf cell containing the user's location
2. Collect all points in that leaf
3. Not enough results? → go up to parent, check all sibling cells
4. Keep expanding until you have enough candidates
5. Filter by actual distance, sort, return top N
```

---

## Distance Calculation

### Haversine Formula (correct for Earth)

```
a = sin²(Δlat/2) + cos(lat1) · cos(lat2) · sin²(Δlon/2)
c = 2 · atan2(√a, √(1−a))
d = R · c          // R = 6,371 km
```

Use this when accuracy matters or distances exceed ~100 km.

### Simplified Euclidean (good enough for nearby, <100 km)

```
Δlat_km = (lat2 − lat1) × 111
Δlon_km = (lon2 − lon1) × 111 × cos(lat_avg)
d = √(Δlat_km² + Δlon_km²)
```

> **Interview tip:** Mention Haversine by name, then say "for the implementation I'd use the simplified Euclidean since our search radius is small." This shows you know both.

---

## When to Use Which

| Scenario | Choose | Reason |
|---|---|---|
| Yelp / Google Maps (restaurants) | **Geohash** | Static data, DB prefix query, highly cacheable |
| Tinder (nearby users) | **Geohash** | Store geohash in user table, simple prefix query |
| Uber / Lyft (moving drivers) | **Quadtree** | Real-time updates, adapts to city vs. suburb density |
| Game collision detection | **Quadtree** | In-memory, blazing fast, adapts to object clustering |
| Distributed / multi-shard system | **Geohash** | Prefix → shard key, no cross-server coordination |
| Very uneven data distribution | **Quadtree** | No wasted cells in sparse regions |

---

## Geohash Pros & Cons

| ✅ Pros | ❌ Cons |
|---|---|
| Works in any SQL/NoSQL DB (`LIKE 'abc%'`) | Fixed grid — wastes space in sparse areas |
| Stateless — just a string in a DB column | Edge problem — close points may have different prefixes |
| Easy to shard via prefix → shard key | Cell shapes distort near the poles |
| Highly cacheable (same prefix = same result) | Must always check 8 neighbors |

## Quadtree Pros & Cons

| ✅ Pros | ❌ Cons |
|---|---|
| Adaptive to data density | Needs in-memory tree or special DB (PostGIS, R-tree) |
| No edge problem — tree naturally handles boundaries | Hard to shard across multiple servers |
| Cells are always rectangular (no pole distortion) | Must re-balance when data changes |
| Great for real-time moving objects | More complex to implement |

---

## Interview Cheat Sheet

```
Q: How do you find restaurants near a user?
A: Geohash the user's location at precision 6 (~1.2 km cells).
   Query DB for center cell + 8 neighbors.
   Filter results by Haversine distance. Sort and return.

Q: How do you handle the edge case where the user is near a cell boundary?
A: Always query all 8 neighbor cells, not just the center. This ensures
   points just across a boundary are always included.

Q: Why not just use a 2D bounding box SQL query?
A: SELECT * WHERE lat BETWEEN x1 AND x2 AND lon BETWEEN y1 AND y2
   works but: (1) needs 2D index, (2) doesn't shard cleanly,
   (3) harder to cache. Geohash gives us a single indexed string.

Q: Uber has drivers moving constantly. How do you update their location?
A: Each driver sends location every ~5 seconds.
   Use a quadtree in memory (per city), update driver's position.
   For Geohash: delete old geohash row, insert new one. Both work,
   but quadtree is faster for high-frequency in-memory updates.

Q: How do you scale geohash to multiple servers?
A: Use geohash prefix as shard key.
   All level-1 cells starting with 'u' go to shard 1,
   starting with '9' go to shard 2, etc.
   Consistent and predictable — no coordination needed.

Q: What's the difference between Quadtree and R-tree?
A: Quadtree: each split divides at the midpoint (fixed splits).
   R-tree: splits at the best boundary for current data (more optimal,
   used inside PostGIS). In interviews, Quadtree is the expected answer.
```

---

## Other Places These Concepts Are Used

| Technology / Concept | Where Else It's Used |
|---|---|
| **Geohash** | Tinder (user matching), Twitter (geotagging), Redis GEO commands use geohash internally |
| **Quadtree** | Game engines (Unity, Unreal — collision/culling), Google Maps rendering, image compression (quadtree image encoding) |
| **Spatial indexing** | PostGIS R-tree, MongoDB 2dsphere index, Elasticsearch geo_point |
| **Prefix-based partitioning** | DNS (subdomain hierarchy), consistent hashing, Cassandra partition keys |
| **Adaptive subdivision** | Mipmaps in 3D rendering, LOD (level of detail) in games |
| **Haversine / distance** | Delivery ETAs, geofencing alerts, logistics routing |
