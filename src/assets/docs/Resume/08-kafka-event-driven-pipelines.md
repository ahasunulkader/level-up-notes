# Event-Driven Pipelines with Apache Kafka

## Resume Line
> "Designed event-driven pipelines using Apache Kafka to decouple service communication; improved system resilience and enabled asynchronous processing of high-throughput business events."

## TL;DR
This bullet tests distributed systems fundamentals — partitioning, consumer groups, delivery semantics, ordering guarantees — and whether you understand *why* event-driven decoupling actually improves resilience rather than just repeating the buzzword. The interviewer will push on concrete failure scenarios: a slow consumer, a broker outage, a duplicate message, an out-of-order event, and whether your design still behaves correctly (or degrades gracefully) in each case.

## The Story (STAR-style anchor)
**Situation:** Our order-management system had a synchronous call chain — order service called inventory service called notification service called an audit-logging service, all over blocking REST — so a slowdown or outage in the notification service (a common occurrence, since it depended on a flaky third-party SMS gateway) caused order creation itself to time out or fail, even though notification delivery had nothing to do with whether the order was valid.

**Task:** I was asked to redesign the order-creation flow so that downstream, non-critical steps (notification, audit logging, analytics event capture) couldn't take down or slow the core order-creation path, while still processing high volumes of order events reliably (peak traffic during promotional events was roughly 5-10x normal order volume).

**Action:** I introduced Kafka as the backbone: the order service published an `OrderCreated` event to a Kafka topic immediately after committing the order transactionally (using a transactional outbox table plus a Debezium-style change-data-capture publisher to avoid the dual-write problem between the DB commit and the Kafka publish), and inventory, notification, and audit-logging became independent consumer groups reading from that same topic, each processing at its own pace. I partitioned the topic by `orderId`'s hash to preserve per-order ordering while allowing horizontal scale-out of each consumer group, set consumers to commit offsets only after successful processing (at-least-once delivery), and made each consumer's business logic idempotent (upsert semantics keyed by event ID) so replays or duplicate deliveries didn't cause double-processing. For the notification consumer specifically — the least reliable downstream — I added a dead-letter topic for events that failed processing after a bounded number of retries, with a small reconciliation job that alerted on DLQ growth.

**Result:** Order creation latency dropped from being coupled to the slowest downstream step (previously as high as several seconds when the SMS gateway was degraded) to just the DB commit plus a Kafka publish (sub-100ms), the notification service's third-party outages stopped affecting order creation at all, and the pipeline sustained the 5-10x promotional traffic spikes by scaling consumer instances horizontally within each consumer group rather than requiring the order service itself to scale.

## Q&A — Foundational

**Q: What is a Kafka partition and why does it matter for ordering?**
A: A partition is an ordered, append-only log within a topic; Kafka only guarantees ordering *within* a single partition, not across partitions of the same topic. Since all messages with the same key hash to the same partition, keying by `orderId` guarantees all events for a given order are processed in the order they were produced, while different orders can be processed in parallel across partitions.

**Q: What's a consumer group, and what happens when two different services read the same topic?**
A: A consumer group is a set of consumers that split a topic's partitions among themselves, so each partition is read by exactly one consumer within that group. Different services use different consumer group IDs, so each service gets its own full, independent view of every message on the topic — that's what let inventory, notification, and audit-logging all consume the same `OrderCreated` events independently without stepping on each other.
```java
@KafkaListener(topics = "order-created", groupId = "notification-service")
public void onOrderCreated(OrderCreatedEvent event) {
    notificationClient.send(event.getCustomerId(), event.getOrderId());
}
```

**Q: What does "at-least-once" delivery mean and how did you achieve idempotent processing on top of it?**
A: At-least-once means a message may be delivered and processed more than once (e.g., if a consumer crashes after processing but before committing its offset), but never silently dropped. I made consumers idempotent by keying persisted side effects on the event's unique ID — e.g., the audit-log consumer does an upsert (`INSERT ... ON CONFLICT (event_id) DO NOTHING`) rather than a blind insert, so a redelivered event is a safe no-op.

**Q: What's the transactional outbox pattern and why did you need it?**
A: It solves the dual-write problem — you can't atomically commit a DB transaction and publish to Kafka as two separate operations without risking one succeeding and the other failing. Instead, you write the event into an `outbox` table in the *same* DB transaction as the business change, and a separate CDC process (I used a Debezium-style connector reading the DB's transaction log) publishes those outbox rows to Kafka asynchronously, guaranteeing the event is published if and only if the transaction committed.

**Q: What's the difference between `acks=0`, `acks=1`, and `acks=all` on the producer?**
A: `acks=0` doesn't wait for any broker acknowledgment (fastest, can silently lose messages), `acks=1` waits for the partition leader to acknowledge (safe against most failures but can lose data if the leader crashes before replicating), and `acks=all` waits for all in-sync replicas to acknowledge (strongest durability guarantee, at the cost of latency). For `OrderCreated` events I used `acks=all` with `min.insync.replicas=2`, since losing an order event was unacceptable.

**Q: How do consumers track their position in a partition?**
A: Via committed offsets, stored in Kafka's internal `__consumer_offsets` topic, keyed by consumer group and partition. On restart, a consumer resumes from its last committed offset for its group, which is what makes "replay from a point in time" and "at-least-once via reprocessing after a crash" both possible.

**Q: What's a dead-letter topic and when did you use one?**
A: A separate topic where messages that fail processing after a bounded number of retries get routed instead of blocking the partition or being silently dropped. I used one for the notification consumer specifically, since third-party SMS gateway failures were common enough that without a DLQ, a bad message could either be retried forever (blocking that partition's other messages behind it) or dropped silently — the DLQ let us isolate and later reprocess or manually inspect failures without affecting the rest of the pipeline.

## Q&A — Why This, Not That (Decision Tree)

**Q: Why Kafka instead of RabbitMQ or SQS for this?**
A: The deciding factors were throughput and replayability. Kafka's log-based model retains messages for a configurable retention period regardless of consumption, so multiple independent consumer groups (inventory, notification, audit) can each read the full stream at their own pace, and a new consumer added later (e.g., analytics, added six months in) could replay historical events without the producer needing to know or care. RabbitMQ's queue model is more of a one-recipient-per-message default (fan-out needs exchange configuration and doesn't retain after ack), and SQS standard queues don't guarantee ordering and have weaker replay semantics — good fits for simpler task-queue workloads, less natural for "many independent consumers of the same event stream."

| | Kafka | RabbitMQ | SQS |
|---|---|---|---|
| Model | Distributed log, pull-based | Broker queue, push-based | Managed queue |
| Ordering | Per-partition | Per-queue (single consumer) | Best-effort (FIFO queues: per-group) |
| Replay | Yes, via offset reset within retention | No (consumed messages gone after ack) | No |
| Fan-out to many independent consumers | Native (consumer groups) | Needs fanout exchange + per-consumer queue | Needs SNS fan-out to multiple queues |
| Throughput ceiling | Very high | Moderate-high | High, but per-queue quotas |

**Q: But doesn't Kafka's operational complexity (ZooKeeper/KRaft, partition rebalancing, broker management) outweigh that benefit for a team that isn't already running Kafka?**
A: Fair pushback — if we'd had no existing Kafka footprint and only needed simple task offloading (e.g., "send this email asynchronously"), I'd have reached for something lighter like SQS or RabbitMQ instead. The decision was justified here specifically because we already anticipated *multiple* independent consumers needing the *same* event stream at high volume, which is Kafka's sweet spot, not a one-off async task.

**Q: Why event-driven (publish `OrderCreated`, let consumers react) instead of the order service just calling each downstream service asynchronously itself (e.g., via `@Async` REST calls or a thread pool)?**
A: Async REST calls still couple the order service to knowing about and calling every downstream service directly — adding a fourth consumer means changing the order service's code. With events, the order service doesn't know or care who's listening; consumers are added or removed independently. It also means a downstream outage doesn't lose events — they sit safely in the topic — whereas a fire-and-forget async REST call to a downstream service that's down just loses that call unless you build your own retry/queue on top, which is reinventing Kafka badly.

**Q: OK, but what if a consumer needs the *result* of downstream processing synchronously — e.g., the checkout flow needs to know immediately if inventory reservation failed? Doesn't event-driven async break that?**
A: Correct, and that's a case where I did *not* go fully async — inventory reservation for checkout stayed a synchronous call (with its own timeout and circuit breaker) because the user-facing flow genuinely needs an immediate answer. The events I moved to Kafka were specifically ones where the caller doesn't need to wait for the result: notification, audit logging, analytics. Recognizing which steps are genuinely synchronous-dependent versus which are "fire and let it happen eventually" was the actual design decision, not "make everything async."

**Q: Why partition by `orderId` rather than round-robin or by, say, customer ID?**
A: Ordering guarantees only apply within a partition, and the property I needed preserved was "events for the same order arrive in the order they happened" (e.g., `OrderCreated` before `OrderCancelled` for the same order must never be processed out of order downstream). Partitioning by `orderId` guarantees that. Round-robin would break ordering entirely. Partitioning by customer ID would preserve ordering across a customer's orders but wasn't necessary for our correctness requirement and would create hotter partitions for high-volume customers.

**Q: But what if a single order's events need to be correlated with other orders from the same customer in a specific sequence — wouldn't customer-ID partitioning matter then?**
A: If that requirement existed, yes, I'd reconsider — but it didn't for this pipeline; each event's processing was scoped to its own order. If a future use case needed cross-order-per-customer ordering, I'd introduce a separate topic partitioned by customer ID for that specific consumer's needs rather than repartitioning the whole `order-created` topic and affecting every existing consumer.

**Q: Why at-least-once with idempotent consumers instead of configuring Kafka's exactly-once semantics (transactional producer/consumer)?**
A: Kafka's EOS (`enable.idempotence=true` plus transactional producer, and consumers reading with `isolation.level=read_committed`) is real and I considered it, but it only guarantees exactly-once *within Kafka* (producer-to-topic, or topic-to-topic via Kafka Streams) — the moment a consumer's side effect touches something outside Kafka (an SMS API call, a non-transactional DB write), you're back to needing idempotency at that boundary regardless. Since our consumers' side effects (send SMS, write audit log) are external to Kafka anyway, building idempotent consumers gave the same practical guarantee with less operational complexity than wiring up full transactional semantics.

**Q: What happens when a consumer is slow — does it block the other consumers or the producer?**
A: No — consumer groups are independent, so a slow notification consumer doesn't affect the inventory or audit consumer groups reading the same topic, and it doesn't affect the producer at all since Kafka decouples produce and consume rates via the log. Within the *same* consumer group, though, a slow partition assignment can cause that consumer instance to fall behind on its assigned partitions, which is visible as growing consumer lag — I monitored this via `kafka-consumer-groups.sh` lag metrics exported to Grafana, and scaled that consumer group's instance count (up to the partition count ceiling) when lag trended upward.

## Q&A — Trade-offs & Failure Modes

**Q: What happens if the Kafka broker cluster itself goes down?**
A: With `acks=all`, producers block (or fail, depending on `max.block.ms` configuration) rather than silently losing events, so the order service would need its own fallback — in our case, the transactional outbox pattern meant the order transaction still committed successfully even if Kafka was briefly unreachable, and the CDC publisher just caught up once Kafka recovered, since it reads from the outbox table, not a live in-memory queue. That's precisely why the outbox pattern mattered beyond just solving dual-write — it also decouples order-creation availability from Kafka's availability.

**Q: What's the cost of introducing Kafka that a team should go in eyes-open about?**
A: Operational overhead (broker/cluster management, monitoring consumer lag, capacity planning for retention/storage), increased debugging complexity (a bug now might be "which of five consumers processed this weirdly," not a single call stack), and eventual consistency — the order and its notification are no longer guaranteed to happen in the same instant, which is a real behavior change that product/support teams need to understand (e.g., "why didn't the customer get an SMS immediately" is now a legitimate, non-bug question).

**Q: When would event-driven decoupling via Kafka be the wrong call?**
A: For low-volume, simple systems with few downstream consumers and no real replay/fan-out need, synchronous calls (with proper timeouts and circuit breakers) are simpler to reason about, debug, and operate. I wouldn't introduce Kafka just because "event-driven" sounds more scalable — it's justified here because we had genuine high-throughput, multi-consumer fan-out needs.

**Q: What's the failure mode of a poison-pill message — one that always fails processing no matter how many times it's retried?**
A: Without a DLQ, it would block that partition indefinitely for at-least-once consumers that don't commit offsets past a failed message, since committing past it would mean silently skipping it. The DLQ pattern I used caps retries at a bounded count, then routes to the DLQ and commits the offset forward, so the partition keeps flowing — the poison-pill message is preserved in the DLQ for manual investigation rather than blocking the pipeline or being lost.

**Q: How do you handle schema evolution — what happens when the `OrderCreated` event's shape needs to change and there are multiple independent consumers?**
A: I used a schema registry (Avro/Confluent Schema Registry) with backward-compatible evolution rules enforced at publish time (new fields optional or with defaults, no removing required fields) so consumers built against an older schema version keep working unmodified, and consumers that want new fields can upgrade independently on their own schedule rather than requiring a coordinated simultaneous deploy across every consuming service.

## Q&A — Scaling & Extending

**Q: How would this scale to 10x the event throughput?**
A: Increase partition count (planned ahead of time, since increasing partitions later changes key-to-partition mapping and can disrupt ordering for existing keys), scale consumer instances up to the partition count per group, and revisit retention/storage sizing and broker capacity; I'd also reassess whether any single "God topic" was becoming a bottleneck and consider splitting by event type/domain if so.

**Q: What would you add next to make this pipeline more resilient?**
A: Consumer-side circuit breakers/backoff for the external calls consumers themselves make (e.g., the notification consumer's SMS gateway call should have its own retry/circuit-breaker, independent of Kafka's own retry semantics), and better observability — distributed tracing (correlation IDs propagated through event headers) so a single order's journey across producer and all consumers is traceable end-to-end, not just visible as isolated logs per service.

**Q: How would you extend this if a new team wanted to add a completely new consumer six months later?**
A: That's the core value of the event-driven model — they'd just subscribe a new consumer group to the existing `order-created` topic, optionally replaying historical events within the retention window if they need backfill, without touching the order service or any existing consumer at all.

**Q: If business events needed guaranteed ordering across the entire topic, not just per-partition, how would you handle that?**
A: Global ordering across a topic effectively requires a single partition, which caps throughput to what one partition/consumer can handle — I'd challenge whether that requirement is real business necessity or an assumption, and if it's real, isolate just that specific event type onto its own single-partition topic rather than sacrificing the whole pipeline's parallelism.

## Rapid-Fire Follow-ups

**Q: What guarantees Kafka ordering, and at what scope?**
A: Ordering is guaranteed only within a single partition, not across a topic.

**Q: What key did you partition `OrderCreated` events on?**
A: `orderId`, to preserve per-order event ordering.

**Q: What pattern solved the dual-write problem between DB commit and Kafka publish?**
A: The transactional outbox pattern with a CDC publisher (Debezium-style).

**Q: What delivery semantics did you use, and how did you handle duplicates?**
A: At-least-once delivery with idempotent consumers (upsert keyed by event ID).

**Q: What producer setting did you use for durability and why?**
A: `acks=all` with `min.insync.replicas=2`, since losing order events was unacceptable.

**Q: What happens to a message that keeps failing processing?**
A: Bounded retries, then routed to a dead-letter topic instead of blocking the partition.

**Q: Why Kafka over RabbitMQ here?**
A: Need for replayable, multi-consumer-group fan-out at high throughput, which Kafka's log model natively supports.

**Q: Which step stayed synchronous instead of going event-driven?**
A: Inventory reservation during checkout, since the user-facing flow needed an immediate answer.

**Q: How did you manage schema changes across independent consumers?**
A: A schema registry with backward-compatible evolution rules (new fields optional/defaulted).

**Q: What latency improvement resulted from decoupling order creation?**
A: From several seconds (coupled to the slowest downstream call) down to sub-100ms (DB commit plus Kafka publish).
