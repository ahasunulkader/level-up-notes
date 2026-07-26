# BDTicker – Real-Time Bangladesh Stock Market Dashboard

## Resume Line
> "Built a full-stack platform scraping live DSE data every 15s for 300+ stocks; volatile in-memory cache with upsert-by-label deduplication to AWS S3, keeping daily memory under 5 MB."
> "Implemented a stock screener combining Graham IV, Peter Lynch PEG, ROE, and sector-relative P/E with guard logic to suppress misleading valuations on structurally declining stocks."

## TL;DR
This is a side project bullet, and a sharp interviewer will treat it as two separate interrogations: (1) can you defend a scrappy, resource-constrained data-engineering design (scraping, a hand-rolled cache, S3-as-database) with real trade-off awareness rather than "it's just a hobby project so it doesn't matter," and (2) do you actually understand the finance math you're quoting (Graham IV, PEG, ROE, sector P/E), or did you paste formulas into a screener without knowing when they lie to you. The strongest story ties both together: DSE (Dhaka Stock Exchange) has no public API, so I built a respectful scraper and a cost-zero pipeline to a single small VM, and I discovered while building the screener that naive valuation formulas actively mislead you on structurally declining stocks — which is why the guard logic exists at all, not as a checkbox but as a bug fix for a real false-positive I saw in my own data.

## The Story (STAR-style anchor)
**Situation:** DSE (Dhaka Stock Exchange) does not publish a public REST API for live price data the way NYSE/NASDAQ-adjacent vendors do — the only "live" source is their own website (dsebd.org) rendering server-side HTML that refreshes on a timer. Retail investors in Bangladesh had no free, ticker-level historical/live dashboard with real valuation screening; existing tools were either paid terminal-style products or static end-of-day PDF reports.

**Task:** Build a live dashboard for 300+ DSE-listed stocks — price, volume, and a computed valuation screener — hosted on a free-tier/low-cost VM, without a paid data vendor or a managed database, and without getting my scraper IP-banned.

**Action:** I wrote a Spring Boot scheduled job that polls the DSE market-summary page every 15 seconds during trading hours, parses the HTML table (Jsoup), and writes the parsed snapshot into a `volatile` in-memory `Map<String, StockSnapshot>` keyed by ticker label — a lock-free single-writer/multi-reader structure so the scraper thread and the Angular-facing REST/WebSocket layer never block each other. Instead of writing every 15-second tick to a database, I buffered ticks in memory and periodically flushed an **upsert-by-label** merge to S3: each stock gets one growing JSON object per trading day (`s3://bdticker/2026-07-03/ACI.json`), and each flush reads-merges-writes that object by ticker label rather than creating a new object per tick, which is what kept both S3 request volume and cost near zero. On top of the live snapshot I built a screener combining four valuation signals — Graham Intrinsic Value, Peter Lynch PEG, ROE, and sector-relative P/E — and added guard logic after I noticed the screener was flagging some obviously troubled companies (declining, sometimes negative, earnings) as "deeply undervalued" because a collapsing EPS mechanically produces a tiny or negative P/E and an inflated-looking Graham IV.

**Result:** A working dashboard tracking 300+ tickers with sub-20-second staleness, running comfortably on a single small VM (JVM heap under 256 MB, hot dataset under 5 MB/day), at effectively zero hosting cost beyond the VM itself (S3 storage for daily JSON snapshots is pennies). The guard logic eliminated the specific false-positive I'd seen (a textile stock with two years of declining revenue showing up as "cheap" by raw Graham IV) and materially changed which stocks the screener surfaced as genuinely undervalued vs. structurally impaired.

## Q&A — Foundational

**Q: Why scrape DSE instead of using an official API?**
A: Because there isn't one for free, real-time, ticker-level data. DSE's own site (dsebd.org) is the closest thing to a canonical live source, and third-party paid terminals exist but are priced for institutional use, not a side project. Scraping was the only path to "live" data without a vendor contract.

**Q: Isn't scraping a ToS/legal risk? How did you think about that?**
A: Yes, and I treated it as a real constraint, not something to ignore because it's a personal project. I checked `robots.txt` and DSE's terms before building this, kept the scrape interval conservative (15s, not sub-second), set a descriptive `User-Agent` rather than spoofing a browser, only fetched the public market-summary page (no login-gated or paid data), and never redistributed raw scraped data — the S3 snapshots are for my own dashboard's use, not resale. If I were taking this to production or monetizing it, the correct move is a licensing conversation with DSE or a paid vendor (e.g., a Bloomberg/Refinitiv-style feed, or a local vendor), not scaling up scraping.

**Q: Why 15 seconds specifically, not 1 second or 1 minute?**
A: It's a deliberate trade-off between staleness and being a good citizen against someone else's infrastructure. DSE's own UI doesn't refresh sub-second either — intraday price discovery on DSE isn't HFT-speed, so 1-second polling would buy negligible freshness while multiplying request volume 15x and meaningfully raising ban risk. A full minute felt stale for a "live" dashboard's core value proposition. 15 seconds matched the platform's own effective refresh cadence while keeping request volume low enough to never trigger rate limiting in practice.

**Q: What does "volatile in-memory cache" mean here, concretely?**
A: The live snapshot is a `Map<String, StockSnapshot>` referenced through a `volatile` field. The scraper thread builds a brand-new immutable map from the latest parse, then does a single reference assignment to the volatile field. Readers (REST controllers, WebSocket broadcaster) just read the volatile reference — `volatile` guarantees the JMM (Java Memory Model) visibility: once the writer thread publishes the new reference, any reader thread is guaranteed to see it, not a stale cached copy from a CPU cache line. Because I swap the whole map atomically instead of mutating entries in place, there's no need for a lock at all — no reader ever sees a half-updated map.
```java
public class LiveMarketCache {
    private volatile Map<String, StockSnapshot> snapshot = Map.of();

    // called by the single scraper thread every 15s
    public void publish(Map<String, StockSnapshot> latest) {
        this.snapshot = Map.copyOf(latest); // atomic reference swap
    }

    // called by many reader threads concurrently
    public StockSnapshot get(String ticker) {
        return snapshot.get(ticker);
    }
}
```

**Q: Why not just use Redis for this instead of a hand-rolled volatile map?**
A: For a single-instance side project, Redis is infrastructure I don't need. The dataset is ~300 entries, updated by exactly one writer thread, read by the same JVM's web layer — there's no cross-process or cross-instance sharing problem to solve, which is the actual reason to reach for Redis. Running Redis would mean an extra process to provision, monitor, and pay for, for a problem (in-process cache coherence) that the JVM's own memory model already solves for free. If BDTicker ever became multi-instance (e.g., horizontally scaled behind a load balancer), Redis would become the right call immediately, because then you *do* have a shared-state problem across processes that a local volatile field can't solve.

**Q: What's your eviction/TTL strategy for the cache?**
A: There isn't a classic eviction policy, because the map is bounded by design — one entry per tracked ticker (~300), always overwritten (upserted) on the next successful scrape, never grown unbounded. What I do track is staleness: each `StockSnapshot` carries its own scrape timestamp, and the frontend shows a "stale" indicator if a given ticker's snapshot is older than ~2x the poll interval (e.g., the scrape failed, or that stock didn't trade that tick). So it's less "TTL eviction" and more "TTL-based staleness labeling" — I never want to just drop a ticker from the UI because DSE's page didn't include it for one cycle (thin trading is normal for smaller counters).

**Q: What does "upsert-by-label deduplication to S3" mean, concretely?**
A: "Label" is the stock ticker (e.g., `ACI`, `GP`, `SQURPHARMA`). Instead of writing one S3 object per tick (which at 300 stocks × ~15s intervals × a 6.5-hour session would be hundreds of thousands of tiny objects per day), I keep one S3 object per ticker per day and merge into it: read the existing day's JSON array for `ACI`, append/replace the latest price point keyed by timestamp, dedupe consecutive identical prices (no point storing five ticks in a row that show the same last-traded price with no volume change), and write the object back. "Upsert" because if the day's object doesn't exist yet (first tick of the morning) it's created; otherwise it's updated in place.
```json
// s3://bdticker/2026-07-03/ACI.json (after several upserts through the day)
{
  "ticker": "ACI",
  "date": "2026-07-03",
  "ticks": [
    { "t": "10:00:15", "ltp": 312.50, "volume": 18400 },
    { "t": "10:05:30", "ltp": 313.00, "volume": 19100 }
  ]
}
```

**Q: Why S3 instead of a real database, or a timeseries database like TimescaleDB/InfluxDB, for tick data?**
A: Cost and operational surface. A managed Postgres/TimescaleDB instance is a running service I'd have to size, patch, and pay for continuously, even at 2am when nobody's looking at the dashboard. S3 has effectively no idle cost — I pay for the bytes stored and the (very few, because of the upsert-by-label batching) PUT/GET requests, and there's no server to manage, back up, or lose sleep over. For a side project whose whole point was "run this for free," S3-as-append-log was the pragmatic choice. A proper timeseries DB is absolutely the *better* engineering answer for querying and analytics — I just didn't have a workload that justified its always-on cost yet.

**Q: What do you lose by using S3 as your datastore instead of a real DB?**
A: Everything a query engine gives you for free: no indexing, so "give me every stock whose PEG dropped below 1 in the last 30 days" means downloading and parsing a lot of JSON client-side or in a batch job, not a `WHERE` clause. No transactions or atomic multi-object writes — my upsert is read-modify-write against one object, so a rare overlapping write (two flush cycles racing) could lose an update; I mitigate this by having a single scheduled writer thread, never concurrent writers to the same key. No native time-range aggregation — S3 has no equivalent of TimescaleDB's continuous aggregates or downsampling, so anything like "5-minute OHLC candles" is computed application-side from the raw ticks, not by the storage layer. And listing/scanning many small objects (e.g., "read all 300 tickers for today") is N GET requests, not one indexed query — at my scale that's fine (300 requests, sub-second), but it would not scale to years of history without a lifecycle/rollup strategy.

**Q: How did you actually keep daily memory under 5 MB, and why does that number matter?**
A: The naive approach — storing every 15-second tick for 300 stocks in memory for the whole session — is roughly 300 stocks × (6.5 trading hours × 3600s / 15s) ≈ 300 × 1,560 ≈ 468,000 tick records a day. Even at ~50 bytes/record that's over 20 MB just for one day's raw ticks, growing daily if not flushed. Because the live cache does upsert-by-label (only the *latest* snapshot per ticker is held in memory, not the full day's tick history — the historical array only exists in the S3 object, assembled incrementally on flush) the in-memory working set stays at ~300 small `StockSnapshot` records — well under 100 KB — plus a small rolling buffer of recent ticks awaiting the next flush. That constraint mattered because the whole app runs on a small VM (comparable to an AWS free-tier `t3.micro`, 1 GB RAM) shared with the JVM itself, Spring Boot, and the OS — keeping the hot dataset tiny meant I could run with a small heap (`-Xmx256m`), low GC pressure, and zero risk of OOM-killing the process on a box with no headroom to spare.

**Q: Explain Graham's Intrinsic Value formula in plain terms.**
A: Benjamin Graham's revised formula estimates a "fair" per-share value from earnings and expected growth:
`IV = [EPS × (8.5 + 2g) × 4.4] / Y`
- `EPS` is trailing twelve-month earnings per share.
- `8.5` is Graham's assumed fair P/E for a company with zero growth.
- `g` is the expected annual earnings growth rate (as a whole number, e.g., 8 for 8%), so `2g` scales the base multiple up for growth.
- `4.4` was the average yield on AAA corporate bonds when Graham published the formula, used as a normalization constant.
- `Y` is the current AAA corporate bond yield, so `4.4 / Y` adjusts the whole valuation for today's interest-rate environment (higher rates today than in Graham's era shrink `4.4/Y` below 1, pulling intrinsic value down — which matches the intuition that stocks are worth less when safe bonds pay more).
In plain terms: take a base "fair" earnings multiple, boost it for growth, then rescale for the current rate environment. If the current market price is well below that number, the stock screens as undervalued by this model.

**Q: Explain Peter Lynch's PEG ratio.**
A: `PEG = (P/E) / annual EPS growth rate (%)`. It's Lynch's fix for the fact that P/E alone can't tell a fast grower from a value trap — a P/E of 20 is expensive for a company growing 5%/year but cheap for one growing 30%/year. Dividing P/E by the growth rate normalizes for that: Lynch's rule of thumb is PEG around 1 is "fairly priced," below 1 suggests undervalued relative to growth, above 1 suggests you're overpaying for that growth.

**Q: Explain ROE and why it's in the mix.**
A: Return on Equity = Net Income / Shareholders' Equity — how efficiently a company turns shareholders' capital into profit. It's not a valuation metric on its own (it says nothing about price), but it's a quality filter: a company can look "cheap" on P/E or Graham IV while being a genuinely mediocre business with low or eroding ROE. I use it as a sanity check alongside the valuation numbers, not a valuation number itself.

**Q: What's sector-relative P/E and why not just an absolute P/E cutoff?**
A: A single P/E threshold (say, "flag anything under 10") doesn't work across a market like DSE where banks, textiles, pharmaceuticals, and telecoms trade at structurally different multiples for structural reasons (growth profile, capital intensity, regulatory risk). Sector-relative P/E compares a stock's P/E against the median/average P/E of its own sector peers instead of an absolute number, so a bank at P/E 8 (normal for the banking sector) isn't lumped in with a textile company at P/E 8 that's actually cheap relative to its typically-higher-multiple sector.

**Q: Why combine all four instead of picking the "best" one?**
A: Because each one is blind to a different failure mode on its own. Graham IV and P/E-based signals can be fooled by a temporary earnings spike or slump. PEG can be gamed by a company with a single unsustainable high-growth quarter. Raw P/E ignores sector context. ROE says nothing about price at all. Combining them means a stock only screens as a strong candidate if it clears several independent lenses at once — cheap on an absolute earnings-multiple basis (Graham), cheap relative to its own growth (PEG), a genuinely efficient business (ROE), and cheap relative to sector peers, not just the market as a whole (sector P/E). Any one signal alone throws a lot of false positives; requiring agreement across signals cuts that down.

## Q&A — Why This, Not That (Decision Tree)

**Q: Why build this yourself instead of using an existing tool or paying for a data vendor?**
A: Two reasons, one practical and one deliberate. Practically, free/cheap ticker-level live tools for DSE specifically didn't exist for retail use at the depth I wanted (a real valuation screener, not just a price ticker). Deliberately, this was a learning project — I wanted hands-on practice with concurrent data pipelines, cache design, and treating S3 as a constrained datastore, which are skills that don't show up in day-to-day CRUD ticket work at Enosis. The portfolio value was real too — it's a concrete, demoable full-stack system I built and own end-to-end, not a shared team codebase.

**Q: Why Spring Boot + Angular for a side project instead of something lighter, like a Python script and a static site?**
A: Because I wanted the project to double as deliberate practice on the exact stack I use professionally (Java 21/Spring Boot backend, Angular frontend), so lessons learned here — scheduling, thread-safety, REST design — transfer directly to my day job. A Python script would've been faster to prototype the scraper alone, but I wanted the whole pipeline: scheduled job, cache, API layer, and a real frontend consuming it live.

**Q: Why a scheduled poll instead of a proper streaming pipeline (Kafka, etc.) from day one?**
A: Because the source itself isn't a stream — it's a page I have to poll. Introducing Kafka in front of a polling scraper for 300 stocks at a 15-second cadence would be infrastructure for infrastructure's sake; the actual throughput (a few hundred small records every 15 seconds) doesn't need a distributed log. Kafka would earn its keep if I had multiple independent consumers of the tick stream (e.g., a separate alerting service, a separate analytics pipeline) that needed decoupled, replayable delivery — for a single dashboard reading from a single in-process cache, it's unjustified complexity.

## Q&A — Trade-offs & Failure Modes

**Q: What's the real risk in the S3-as-datastore design, beyond "no queries"?**
A: The upsert-by-label read-modify-write against a single JSON object per ticker per day is not atomic across the read and the write — if two flush cycles ever overlapped (they shouldn't, since it's a single scheduled writer, but a slow S3 write or a scheduler hiccup could theoretically overlap two runs), the second write could clobber the first's changes since S3 doesn't offer optimistic concurrency control (conditional PUTs) the way I originally wired it. The mitigation is architectural, not clever code: guarantee single-writer semantics at the scheduler level (no overlapping executions) rather than trying to solve concurrent writes to S3 objects.

**Q: Concretely, describe the false positive that motivated the guard logic.**
A: A textile-sector stock had two consecutive years of declining revenue and shrinking EPS. Because current-year EPS was small (though still positive), the raw P/E computed as (price / EPS) came out unusually low — mechanically "cheap" — and the Graham IV formula, being a function of that same depressed-but-positive EPS times a growth assumption, also produced a deceptively high intrinsic value relative to price. The screener flagged it as one of the most undervalued stocks on the exchange. In reality the market had priced it correctly — the business was structurally declining, and a low P/E on shrinking earnings is a value trap, not a bargain.

**Q: How does the guard logic actually work?**
A: It checks earnings *trend*, not just the latest earnings point, before trusting any valuation signal derived from EPS. Concretely: I look at EPS and revenue over the trailing 3 years; if EPS has declined in at least 2 of the last 3 years and current EPS is below its 3-year average by more than a threshold (e.g., 20%), the stock is flagged "earnings quality: weak" and the screener either suppresses the "undervalued" verdict entirely or down-weights it rather than surfacing a raw Graham IV/P/E number that's mathematically correct but practically misleading.
```java
public ScreenerVerdict evaluate(StockFundamentals f) {
    boolean decliningTrend = countDecliningYears(f.epsHistory(), 3) >= 2;
    boolean belowAverage = f.currentEps() < 0.8 * average(f.epsHistory());

    if (decliningTrend && belowAverage) {
        return ScreenerVerdict.weakEarningsQuality(f.ticker());
        // suppressed rather than surfaced as "undervalued"
    }
    return computeCombinedScore(f); // Graham IV + PEG + ROE + sector P/E
}
```

**Q: Isn't a rule like "2 of 3 declining years" arbitrary — how would you defend the threshold?**
A: It is a heuristic, and I'd say that plainly rather than oversell it as rigorous. It's a guard, not a model — its job is to catch the obvious value-trap pattern (sustained decline), not to perfectly classify every company. I picked thresholds by backtesting against a handful of known DSE value-trap and known-recovery cases I could reason about manually, then treated it as tunable rather than fixed. A more rigorous version would regress against actual forward returns to calibrate the threshold, which I didn't have enough clean historical data to do confidently yet.

**Q: What breaks this scraper in production if DSE changes their page markup?**
A: The Jsoup selectors break silently or start returning nulls/zeros, which is the classic fragile-scraper failure mode. I mitigated it partially with sanity checks (reject a scrape cycle if the parsed record count is far below the expected ~300, rather than publishing a mostly-empty cache), but a markup change would still require a code fix — this is the single biggest argument for a real API/vendor feed at any serious scale, since a contract-backed API doesn't silently change its shape underneath you.

## Q&A — Scaling & Extending

**Q: What would you change if this had to support real trading decisions instead of being a personal dashboard?**
A: I would replace scraping with a licensed real-time data feed (even a modest paid vendor feed) so I'm not dependent on someone else's HTML structure or ToS goodwill, and so latency/accuracy come with an SLA. I'd move tick storage to a proper timeseries store (TimescaleDB, given the rest of my stack is already Postgres-friendly) for real range queries and downsampling instead of S3-as-append-log. I'd push live updates to the frontend over WebSocket instead of polling REST, so the UI reflects new ticks within the cache's own 15-second cadence instead of adding client-poll latency on top. And I'd move the valuation guard logic from a heuristic threshold to a backtested, statistically validated model.

**Q: How would you scale this to thousands of tickers across multiple exchanges?**
A: The single-writer volatile-map pattern stops being sufficient once you need horizontal scaling or multiple scraper workers per exchange — at that point the cache needs to live outside any single JVM (Redis, or a proper message bus feeding a shared store), and the S3 upsert-by-label pattern would need sharding by exchange/date prefix to avoid hot-partition-style throttling on frequently-written keys. I'd also introduce backpressure/rate-limit-aware scraping per source so one exchange's slow response doesn't stall others.

**Q: What's the most valuable thing you'd add next?**
A: A backtest harness for the screener itself — replay historical daily snapshots and check whether stocks the guard-adjusted screener flagged as "undervalued" actually outperformed over the following 6-12 months. Right now the guard logic is motivated by one manually-observed false positive; a backtest would tell me whether the combined-signal approach and the guard threshold are actually adding predictive value or just producing a plausible-looking dashboard.

## Rapid-Fire Follow-ups
- Q: Why 15s polling? A: Matches DSE's own effective refresh cadence without hammering their servers or adding meaningful staleness.
- Q: Why `volatile` instead of a lock? A: Single writer publishes an immutable map via one atomic reference swap; readers never see a half-updated map, no lock needed.
- Q: Why not Redis? A: Single JVM instance, no cross-process state-sharing problem to justify the extra infrastructure.
- Q: Why S3 instead of a database? A: Zero idle cost, no server to manage — the right trade for a free-hosted side project, at the cost of no indexing/queries.
- Q: What does "upsert-by-label" mean? A: One growing S3 object per ticker per day, merged on each flush, instead of one object per tick.
- Q: How was daily memory kept under 5 MB? A: Only the latest snapshot per ticker is held in memory (upsert, not append); full tick history lives only in the S3 object.
- Q: What's Graham IV in one line? A: EPS-and-growth-based fair value estimate, rescaled by current bond yields.
- Q: What's PEG in one line? A: P/E divided by earnings growth rate — cheap growth vs. expensive growth.
- Q: What did the guard logic fix? A: A structurally declining stock showing a deceptively low P/E / high Graham IV due to depressed current earnings.
- Q: What would change at production scale? A: Licensed data feed, real timeseries DB, WebSocket push instead of scraping and S3-as-datastore.
