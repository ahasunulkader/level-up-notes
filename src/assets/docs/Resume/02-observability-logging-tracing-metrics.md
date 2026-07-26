# Observability: Structured Logging, Distributed Tracing & Metrics

## Resume Line
> "Established application observability by integrating structured logging, distributed tracing, and metrics dashboards; reduced mean time to resolution (MTTR) for production incidents and improved system visibility."

## TL;DR
This bullet tests whether you understand the three observability pillars as complementary, not redundant — and whether you can back "reduced MTTR" with an actual before/after number instead of a vibe. The interviewer wants to see that you know *why* unstructured `System.out.println`-style logs don't scale across microservices, how trace context propagates across service boundaries, and how you'd actually instrument and query this stuff during a live incident, not just that you added a dependency once.

## The Story (STAR-style anchor)
**Situation:** Our Spring Boot microservices (order-service, payment-service, inventory-service) logged plain-text lines to stdout with no correlation ID. When `payment-service` timed out, on-call had no fast way to trace a single failed checkout across three services' logs — engineers were grepping timestamps by hand across Kibana tabs, and a typical incident took 40+ minutes just to localize the failing component.

**Task:** I was asked to make production issues diagnosable in minutes, not tens of minutes, ahead of a Black-Friday-scale traffic event.

**Action:** I standardized structured JSON logging (Logback + `logstash-logback-encoder`) with a mandatory `traceId`/`spanId`/`correlationId` in every log line, shipped via Filebeat into an ELK stack (later evaluated Loki as a lighter-weight alternative). I integrated distributed tracing using Micrometer Tracing (Spring Boot 3's replacement for Sleuth) with an OTLP exporter into Tempo/Jaeger, so a single `traceId` generated at the API gateway propagated through Kafka headers and HTTP headers across every downstream service call. For metrics, I exposed Micrometer/Prometheus metrics from Actuator (`/actuator/prometheus`) — request latency histograms, JVM heap, thread pool saturation, custom business counters like `payment.declined.count` — and built Grafana dashboards with SLO-based alerting (p99 latency, error rate) via Alertmanager to PagerDuty.

**Result:** MTTR for production incidents dropped from an average of ~40 minutes to under 10 minutes, measured by comparing PagerDuty incident timestamps (alert fired → resolved) for the 3 months before vs. 3 months after rollout. On-call engineers could jump from a single Grafana alert straight to the exact failing trace and the exact log lines for that request via the shared `traceId`, instead of manually correlating logs.

## Q&A — Foundational

**Q: What are the three pillars of observability and how do they differ?**
A: Logs are discrete, timestamped events with rich context — good for "what exactly happened." Metrics are aggregated numeric time series — good for "how much/how often, and is it trending badly," cheap to store and query even at high cardinality of *time* but expensive at high cardinality of *labels*. Traces show the causal chain of a single request across service boundaries — good for "where in the call chain did the time/error happen." They're complementary: a metric alert tells you *something* is wrong, a trace tells you *where*, and logs tell you *why*, at the specific span.

**Q: What does "structured logging" mean concretely, and why does it matter?**
A: Instead of free-text lines, you log JSON (or another machine-parseable format) with consistent field names, so a log aggregator can index and query by field instead of regex-parsing text.
```json
{"timestamp":"2026-03-16T10:22:31.442Z","level":"ERROR","service":"payment-service","traceId":"4bf92f3577b34da6a3ce929d0e0e4736","spanId":"00f067aa0ba902b7","message":"Payment gateway timeout","orderId":"ORD-88213","gatewayLatencyMs":5002}
```
With this, "show me every ERROR log for orderId ORD-88213 across all services" is a single Kibana/Loki query instead of grepping multiple log files by eye.

**Q: How do you get a `traceId` to actually correlate logs and traces?**
A: Micrometer Tracing (or Sleuth pre-Boot-3) instruments the `Slf4jMDC` (Mapped Diagnostic Context) with the current trace/span ID on every incoming request, and the Logback encoder pattern includes `%X{traceId}` so every log line emitted during that request automatically carries it:
```xml
<encoder class="net.logstash.logback.encoder.LogstashEncoder">
  <includeMdcKeyName>traceId</includeMdcKeyName>
  <includeMdcKeyName>spanId</includeMdcKeyName>
</encoder>
```
That same `traceId` is what your tracing backend (Tempo/Jaeger) indexes the trace under, so a Grafana dashboard panel can deep-link "view logs for this trace" and "view trace for this log line" bidirectionally.

**Q: How does trace context actually propagate across an HTTP call to another microservice?**
A: Via the W3C Trace Context standard (`traceparent` header), which Micrometer Tracing / OpenTelemetry auto-inject into outgoing `RestTemplate`/`WebClient` calls and auto-extract on incoming requests:
```
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
```
Format is `version-traceId-parentSpanId-flags`. The receiving service creates a new child span with the same `traceId` and a new `spanId`, with `parentSpanId` pointing back to the caller — that parent-child chain is what lets Jaeger/Tempo reconstruct the full waterfall diagram.

**Q: For async/Kafka-based flows, how do you propagate trace context since there's no HTTP header?**
A: You manually inject the trace context into Kafka message headers on produce and extract/restore it on consume — Micrometer Tracing's Kafka instrumentation (or a `ProducerInterceptor`/`ConsumerInterceptor`) does this automatically if you use the auto-configured `KafkaTemplate`, adding `traceparent` as a header byte array so the consumer's processing span links back to the producer's span even though it's a completely separate process picking up the message later.

**Q: What's the difference between a counter, a gauge, and a histogram in Micrometer/Prometheus?**
A: Counter only increases (e.g., `http.server.requests` total count, `payment.declined.count`) — useful for rate() queries. Gauge is a point-in-time value that can go up or down (e.g., `jvm.threads.live`, queue depth). Histogram buckets observations (e.g., request latency) into configurable buckets so you can compute percentiles server-side in Prometheus via `histogram_quantile()`.
```java
@Timed(value = "payment.process.time", percentiles = {0.5, 0.95, 0.99})
public PaymentResult process(PaymentRequest req) { ... }
```

**Q: How did you decide what to alert on vs. what to just leave as a dashboard?**
A: I used symptom-based alerting tied to user-facing SLOs — p99 latency, 5xx error rate, and saturation (thread pool/connection pool utilization) — rather than alerting on every internal metric. Cause-level metrics (JVM GC pause time, specific downstream call latency) stayed as dashboard panels for *diagnosis after* an alert fires, not as separate pages, to avoid alert fatigue. Rule of thumb I followed: if a human can't take a meaningful action on it right now, it shouldn't page.

## Q&A — Why This, Not That (Decision Tree)

**Q: Why ELK for logs instead of just grepping journald/docker logs on each host?**
A: With more than a couple of services and any horizontal scaling, logs are scattered across ephemeral containers/Pods that disappear on restart — there's no "the log file" to grep anymore. Centralizing shipped logs (Filebeat/Fluent Bit → Elasticsearch or Loki) gives you a single searchable index that survives container restarts and lets you correlate across services by `traceId` in one query instead of SSHing into N hosts.

**Q: OK, but ELK is heavyweight and expensive to run at scale. Why not Loki?**
A: That's a legitimate trade-off I actually revisited. Elasticsearch indexes full log content (inverted index on every field), which is powerful for arbitrary text search but expensive in storage and CPU. Loki only indexes labels (service, env, level) and stores log content compressed, unindexed — cheaper to run, and since Grafana already unified our dashboards/traces, Loki gave us a single-pane-of-glass in Grafana Explore alongside Tempo traces and Prometheus metrics. For a smaller team without a dedicated ELK ops function, I'd default to Grafana's LGTM stack (Loki/Grafana/Tempo/Mimir) today; we specifically used ELK first because it was already the org standard when I joined, and migrating an active team off a working stack has real switching costs, not just theoretical benefits.

**Q: If Loki doesn't index content, doesn't that hurt exactly the ad hoc "search all logs for this weird string" debugging you need during an incident?**
A: Yes, that's the real cost — Loki queries (LogQL) filter by label first, then grep-scan the resulting log stream, so an unindexed full-text search across *all* services with no label narrowing is slower than Elasticsearch's inverted index. In practice this mattered less than expected because the `traceId`/`service` label narrowing (from the trace-log correlation) got us to the right stream before we needed free-text search — but for genuinely unstructured forensic search across everything, Elasticsearch is still better, and that's a real reason some orgs run both or stay on ELK.

**Q: Why Micrometer Tracing/OpenTelemetry instead of writing custom correlation-ID propagation by hand?**
A: Hand-rolled correlation IDs solve log correlation but don't give you span timing, parent-child call graphs, or a waterfall view of where time was actually spent across services — you'd be reinventing distributed tracing badly. OpenTelemetry is also a vendor-neutral standard (CNCF), so switching the backend (Jaeger → Tempo → a SaaS APM) later doesn't require re-instrumenting application code, only changing the exporter configuration.

**Q: Why Jaeger/Tempo over a SaaS APM like Datadog or New Relic?**
A: SaaS APM gets you tracing, logs, metrics, and often auto-instrumentation with far less setup effort, at a real dollar cost that scales with hosts/data volume, plus a vendor dependency. We chose self-hosted OSS (Tempo + Grafana + Prometheus + Loki) partly for cost control at our data volume and partly because the org already had Kubernetes/Prometheus expertise in-house. If I were a 5-person startup without platform engineering capacity, I'd lean toward paying for a SaaS APM — the engineering time saved on running/upgrading the stack usually beats the license cost early on.

**Q: What if trace sampling drops the exact request that failed — how do you debug that?**
A: Head-based sampling at a fixed rate (e.g., 10%) risks missing rare, low-frequency failures entirely; that was a real gap. I moved us toward tail-based sampling logic at the collector layer (OpenTelemetry Collector's tail-sampling processor) — decide whether to keep a trace *after* seeing the full trace, biased toward always keeping traces with errors or latency above a threshold, and sampling normal fast/successful traces at a low rate. That way error traces are essentially always retained even though total trace volume is sampled down for cost.

**Q: Doesn't tail-based sampling need to buffer the whole trace before deciding, which is memory/latency-costly?**
A: Yes — it requires the collector to hold spans for a trace until all its constituent spans arrive (usually spans-per-second dependent, with a time-window flush, e.g., 10s) before making the sample/drop decision, and it needs consistent routing so all spans of one trace land on the same collector instance (via a load balancer that hashes on `traceId`). That's genuinely more operational complexity than head-based sampling, which is why I only proposed it once error-trace-loss became a demonstrated problem during postmortems, not as a day-one default.

## Q&A — Trade-offs & Failure Modes

**Q: What actually breaks with this observability setup in production?**
A: Cardinality explosions — someone adds a Micrometer tag with an unbounded value (e.g., `orderId` as a metric label instead of a log field) and Prometheus's memory usage blows up because it creates a new time series per unique label combination. I hit exactly this once: a well-meaning teammate tagged a Micrometer timer with `userId`, and our Prometheus instance's memory ballooned until it OOM'd, which itself became an incident. The fix was a Prometheus relabeling rule to drop the offending label and a team rule: only bounded, low-cardinality values go in metric labels; high-cardinality identifiers go in logs/traces only.

**Q: What's the cost of running this stack, concretely?**
A: Non-trivial storage for logs (Elasticsearch/Loki retention) and traces (Tempo can get large fast at high sampling rates), plus compute for Elasticsearch's indexing and Prometheus's scrape/query load, plus the ongoing engineering time to maintain dashboards, alert rules, and upgrade the stack itself (Elasticsearch major-version upgrades are notoriously painful). None of this is free, and it needs a budget/retention policy (e.g., 14 days hot logs, 90 days metrics, 7 days traces) tuned to actual debugging needs vs. cost.

**Q: When would you NOT invest in this level of observability?**
A: A single monolith with low request volume and a small on-call rotation — structured logs plus basic Actuator health/metrics might be entirely sufficient; full distributed tracing infrastructure is solving a multi-service correlation problem that doesn't exist yet for a monolith. Standing up Tempo/Jaeger/Loki for one service is pure overhead.

**Q: A dashboard shows p99 latency spiking, but the trace for a sampled slow request looks completely normal end-to-end. What's going on?**
A: Classic sampling/observation gap: either the sampled trace you're looking at isn't actually one of the slow ones (random head-based sampling doesn't guarantee you catch the outlier), or the latency is happening *outside* instrumented spans — e.g., time spent queued in a thread pool or connection pool before your code's span even starts, or network/DNS/TLS handshake time not wrapped in a span. This is exactly the argument for tail-based sampling that keeps slow traces, and for adding explicit spans around queueing/connection-acquisition, not just business logic.

**Q: How do you actually prove the "reduced MTTR" number rather than asserting it?**
A: Pull it from the incident management system, not memory — PagerDuty/Opsgenie timestamps for "alert triggered" to "incident resolved," aggregated over a fixed window before and after the observability rollout, holding severity mix roughly constant (comparing a quarter with mostly Sev-3s to one with a Sev-1 skews the average). I'd present it as "median MTTR for Sev-2 incidents was 42 minutes in Q3, 9 minutes in Q1 after rollout, based on N=14 vs N=11 incidents," and be upfront about the sample size caveat rather than presenting a single global percentage as if it were statistically bulletproof.

## Q&A — Scaling & Extending

**Q: At 10x traffic/service count, what changes?**
A: Metrics cardinality and storage both become real cost/performance concerns — you'd move from a single Prometheus instance to remote-write into a horizontally scalable long-term store (Thanos or Mimir/Cortex) for global querying and downsampling. Tracing needs sampling strategy discipline (tail-based, as discussed) or costs run away. Logging needs tiered retention (hot/warm/cold) and stricter index/label discipline enforced by CI lint rules rather than convention.

**Q: At 10x team size, what governance do you add?**
A: A shared, versioned dashboard/alert template (via Grafana provisioning as code, or Jsonnet/Grafonnet) so every team's dashboards look and behave consistently instead of each team reinventing panel layouts. I'd also introduce an SLO framework (error budgets per service) so alerting priority and paging policy is standardized rather than ad hoc per-team thresholds, plus a platform team owning the shared observability stack itself as a service to product teams.

**Q: What would you add next?**
A: Continuous profiling (Pyroscope/Parca) to close the gap between "this trace span was slow" and "here's the exact stack that was hot," synthetic monitoring/black-box probes for proactive detection before real users are affected, and automated anomaly detection on key metrics rather than purely static alert thresholds.

**Q: How does this integrate with the Kubernetes/rollout work?**
A: Deploy-marker annotations on Grafana dashboards (a vertical line at each rollout event, sourced from CI/CD webhook) so a latency/error spike can be visually correlated to "did we just deploy," turning "is this a bad deploy or a real incident" from a Slack guessing game into a 5-second dashboard glance — and feeding directly into canary-rollout gating decisions.

## Rapid-Fire Follow-ups
- Q: What replaced Spring Cloud Sleuth in Spring Boot 3? A: Micrometer Tracing.
- Q: What header propagates trace context per W3C standard? A: `traceparent`.
- Q: What's MDC used for in logging? A: Thread-local context (like traceId) automatically included in every log line.
- Q: Counter vs Gauge — which can decrease? A: Gauge.
- Q: What Actuator endpoint exposes Prometheus-format metrics? A: `/actuator/prometheus`.
- Q: What's a cardinality explosion? A: Too many unique label combinations creating too many time series, blowing up memory/storage.
- Q: Head-based vs tail-based sampling — which decides after seeing the whole trace? A: Tail-based.
- Q: What's an SLO vs an SLI? A: SLI is the measured indicator (e.g., latency); SLO is the target threshold for it (e.g., p99 < 300ms).
- Q: Why alert on symptoms, not causes? A: Reduces alert fatigue; only page on things a human can act on right now.
- Q: What's the risk of over-instrumenting metric labels? A: High cardinality driving up storage/memory cost.
