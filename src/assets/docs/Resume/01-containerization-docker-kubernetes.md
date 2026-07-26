# Containerization with Docker & Kubernetes

## Resume Line
> "Containerized Spring Boot services using Docker and managed deployments with Kubernetes; standardized environments across dev / staging / production and enabled zero-downtime rolling updates."

## TL;DR
This bullet is testing whether you actually understand *why* containerization solves the "works on my machine" problem, and whether you've operated Kubernetes in anger — not just written a YAML file once. The interviewer wants to see you reason about image layering, resource limits, health probes, rolling update mechanics, and what breaks when a pod dies mid-request. The core story: you moved a fleet of Spring Boot microservices from inconsistent host-based deployments to reproducible, versioned container images, then used Kubernetes Deployments with readiness/liveness probes and a `RollingUpdate` strategy to ship changes without customer-visible downtime.

## The Story (STAR-style anchor)
**Situation:** At Enosis Solutions, our team owned a set of ~6 Spring Boot microservices (order-service, inventory-service, notification-service, etc.) that were deployed manually via shell scripts onto shared VMs. Dev, staging, and prod had drifted — different JDK patch versions, different `application.yml` overrides copied by hand, and at least one incident caused by a staging server running a stale native library that prod didn't have.

**Task:** I was asked to containerize the core services and move deployment onto Kubernetes so environments would be identical bit-for-bit, and so we could deploy during business hours without a maintenance window.

**Action:** I wrote multi-stage Dockerfiles (Maven build stage + a slim `eclipse-temurin` JRE runtime stage) to keep images small and reproducible, pinned base image digests, and added `.dockerignore` to keep build context lean. I containerized configuration using Spring profiles (`application-{env}.yml`) injected via ConfigMaps and Secrets rather than baked into the image, so the same image ran unmodified in all three environments. On the Kubernetes side, I wrote Deployments with resource requests/limits sized from actual JVM heap + thread pool usage, liveness/readiness probes hitting Spring Boot Actuator's `/actuator/health/liveness` and `/readiness` endpoints, and a `RollingUpdate` strategy with `maxUnavailable: 0` and `maxSurge: 1` fronted by a Kubernetes Service and Ingress.

**Result:** Deployments went from a 45-minute manual, error-prone process with a required off-hours window to a `kubectl apply` / CI-triggered rollout that took under 5 minutes with zero dropped requests (validated with a continuous synthetic health check during rollout). Environment-drift incidents dropped to zero because dev/staging/prod ran the exact same image tag, just with different injected config.

## Q&A — Foundational

**Q: What's the actual difference between a Docker image and a container?**
A: An image is an immutable, layered filesystem snapshot plus metadata (entrypoint, env, exposed ports) — it's a build artifact. A container is a running instance of that image: image layers mounted read-only via a union filesystem (overlay2), plus a thin writable layer on top, plus an isolated process tree using Linux namespaces (PID, net, mount, UTS, IPC) and cgroups for resource limits. You can run many containers from one image; they don't affect each other's writable layer.

**Q: Walk me through your Dockerfile for a Spring Boot service.**
A: Multi-stage build to avoid shipping the JDK and Maven cache in the final image:
```dockerfile
# --- build stage ---
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /app
COPY pom.xml .
RUN mvn dependency:go-offline -B
COPY src ./src
RUN mvn package -DskipTests -B

# --- runtime stage ---
FROM eclipse-temurin:21-jre-alpine
RUN addgroup -S spring && adduser -S spring -G spring
USER spring:spring
WORKDIR /app
COPY --from=build /app/target/*.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-XX:+UseContainerSupport", "-XX:MaxRAMPercentage=75.0", "-jar", "app.jar"]
```
Key details worth calling out unprompted: copying `pom.xml` before `src` to cache the dependency layer, running as a non-root user, and `-XX:+UseContainerSupport` so the JVM respects the container's cgroup memory limit instead of reading host memory.

**Q: What's the difference between a Kubernetes Pod, Deployment, and Service?**
A: A Pod is the smallest deployable unit — one or more containers sharing network namespace and storage. A Deployment is a controller that manages a ReplicaSet of Pods, handling rollouts, rollbacks, and self-healing (recreating Pods that die). A Service is a stable network identity (ClusterIP/virtual IP) that load-balances traffic across the Pods matching a label selector, so callers don't need to track individual Pod IPs that change on every restart.

**Q: How does Kubernetes know a Pod is ready to receive traffic?**
A: Via a **readiness probe**. Kubernetes only adds a Pod's IP to the Service's Endpoints list once the readiness probe succeeds. For Spring Boot I wire this to Actuator:
```yaml
readinessProbe:
  httpGet:
    path: /actuator/health/readiness
    port: 8080
  initialDelaySeconds: 15
  periodSeconds: 5
  failureThreshold: 3
livenessProbe:
  httpGet:
    path: /actuator/health/liveness
    port: 8080
  initialDelaySeconds: 30
  periodSeconds: 10
```
Readiness governs traffic routing; liveness governs whether kubelet restarts the container. Conflating the two is a classic mistake — a slow downstream dependency should fail readiness, not liveness (otherwise you get a restart-crash-loop instead of just being temporarily drained from the Service).

**Q: What are resource requests and limits, and why do both matter?**
A: `requests` is what the scheduler guarantees is reserved on a node for that Pod (used for bin-packing decisions). `limits` is the hard ceiling — exceeding the CPU limit gets throttled, exceeding the memory limit gets the container OOM-killed.
```yaml
resources:
  requests:
    cpu: "250m"
    memory: "512Mi"
  limits:
    cpu: "1"
    memory: "768Mi"
```
For a JVM app, memory limit has to leave headroom above `-Xmx`/`MaxRAMPercentage` for thread stacks, metaspace, and off-heap buffers, or you get OOMKilled events that look like "random" crashes with no heap dump.

**Q: What's a ConfigMap vs a Secret, and how did you use them for environment parity?**
A: Both inject configuration into Pods (as env vars or mounted files) without baking it into the image. ConfigMaps are for non-sensitive config (feature flags, URLs, log levels); Secrets are for credentials — base64-encoded at rest by default (not encrypted unless you enable encryption-at-rest/etcd encryption or use an external secret store). I used a ConfigMap per environment holding the `SPRING_PROFILES_ACTIVE` value and non-secret overrides, and Kubernetes Secrets (backed by our vault via an external-secrets operator in prod) for DB credentials — same image, three different ConfigMap/Secret sets, one per namespace.

**Q: What does `docker build` layer caching actually rely on, and how did you exploit it?**
A: Each Dockerfile instruction produces a layer keyed by a hash of the instruction plus its inputs. Docker reuses a cached layer if nothing above it changed. By copying `pom.xml` and running `mvn dependency:go-offline` *before* copying `src/`, changing application code doesn't invalidate the dependency-download layer — only `COPY src` and the build step re-run, cutting CI build time significantly since Maven dependency resolution was the slow part.

## Q&A — Why This, Not That (Decision Tree)

**Q: Why containerize at all instead of just deploying the JAR directly onto a VM with a systemd unit?**
A: Because "works on my machine" is really "works with this exact JDK build, these exact native libs, this exact OS package set" — and VMs drift over time as packages get patched independently. A container image is a content-addressable, versioned artifact: the same SHA that passed CI is the exact SHA that runs in prod. It also decouples the app's runtime environment from the host OS, so you can run multiple services with conflicting dependency versions on the same host without a compatibility matrix.

**Q: But a systemd unit plus a well-maintained Ansible playbook could give you similar reproducibility. Why is that not enough?**
A: In principle it can get you configuration reproducibility, but it doesn't give you the isolation (cgroups/namespaces) or the fast, deterministic rollback (redeploy previous image tag vs. re-run a playbook against config drift that may already exist). It also doesn't give you density — Kubernetes bin-packs many Pods per node based on requests, whereas one-VM-per-service (or careful multi-service VMs) wastes capacity. And the ecosystem tooling — service discovery, rolling updates, autoscaling, secrets injection — is either absent or hand-rolled with Ansible.

**Q: OK, so why Kubernetes specifically and not Docker Swarm, which is simpler to operate?**
A: Swarm is genuinely simpler for small setups — fewer moving parts, no separate etcd, gentler learning curve. I'd pick it for a small team running a handful of services with modest scaling needs. We didn't, for three reasons: (1) the ecosystem — Helm charts, operators (we used an external-secrets operator and later considered a Kafka operator), and broad tooling support (Prometheus Operator, cert-manager, ingress-nginx) are far richer for K8s; (2) hiring/on-call — most engineers we hired already knew K8s, not Swarm; (3) Swarm's development has effectively stalled compared to K8s' active release cadence, which matters for long-term security patching.

**Q: What about ECS or Nomad — less operational overhead than self-managing Kubernetes?**
A: Fair point, and if we were greenfield on AWS with no multi-cloud requirement, EKS or even plain ECS with Fargate would reduce control-plane operational burden considerably. We were on infra that already had K8s clusters for other teams, so the marginal cost of onboarding was low and we got shared platform investment (existing Prometheus/Grafana stack, existing ingress setup, existing CI templates) for free. If I were starting a brand-new small team today with no existing K8s investment, I'd seriously consider ECS/Fargate or Nomad to avoid control-plane and node-lifecycle overhead — the "why Kubernetes" answer is context-dependent, not dogma.

**Q: Within Kubernetes, why a Deployment and not a StatefulSet for your Spring Boot services?**
A: Our services were stateless — no service held authoritative local state that needed a stable identity or stable storage across restarts (state lived in PostgreSQL/Redis, external to the Pod). Deployments give you fungible, identically-named-at-random Pods that can be freely killed and rescheduled anywhere, which is exactly what you want for stateless HTTP services and is what enables trivial horizontal scaling. StatefulSets exist for things like Kafka brokers or databases where each replica needs a stable network identity (`pod-0`, `pod-1`, ...) and its own persistent volume that follows it across rescheduling.

**Q: If one of your services had, say, a local Caffeine cache warmed from a slow query, would that change your answer?**
A: Not to StatefulSet — a warm cache is a performance optimization, not identity-bearing state; losing it on Pod restart costs you some latency on the next few requests but doesn't corrupt anything. I'd handle that with readiness-probe gating (don't mark ready until warm-up completes) rather than reaching for StatefulSet, which solves a different problem (stable identity/storage), not "slow cold start."

**Q: Why rolling updates instead of blue-green or canary deployments?**
A: Rolling update was the right first step because it's built into the Deployment controller with zero extra infrastructure — just `maxSurge`/`maxUnavailable` tuning — and combined with readiness probes it already gives zero-downtime. Blue-green needs double the resource footprint at cutover and a mechanism to flip traffic (two full environments); canary needs traffic-splitting infra (Istio/Linkerd, or Argo Rollouts/Flagger) and automated metric-based promotion. For our traffic and team size, that additional complexity wasn't justified yet — a bad rollout was caught by readiness probes failing and the rollout auto-halting, with `kubectl rollout undo` as the manual fallback.

**Q: But rolling update still exposes some fraction of users to the new version immediately, with no automated rollback based on error rate. Isn't that risky for a real regression?**
A: Yes — that's the real trade-off. Rolling update protects you from *crash-on-startup* or *fails-readiness* bugs (bad Pods never get traffic), but it does not protect you from a *logically* broken version that starts fine and passes health checks but returns wrong data or elevated error rates. That gap is exactly why the natural next step — which I'd propose if incident data justified it — is canary analysis with Argo Rollouts/Flagger, gating promotion on Prometheus error-rate/latency SLOs rather than just probe success, or at minimum a fast manual rollback SLA backed by good dashboards (tying into the observability bullet) so MTTR for a bad rollout stays under a couple of minutes.

**Q: How exactly does `maxUnavailable: 0, maxSurge: 1` achieve zero downtime, mechanically?**
A: With 3 desired replicas, `maxSurge: 1` lets the controller create 1 extra Pod (4 total) running the new version; `maxUnavailable: 0` forbids taking any old Pod out of service until a replacement is ready. So the sequence is: spin up 1 new Pod → wait for it to pass readiness → Service now routes to 4 Pods → terminate 1 old Pod (graceful shutdown honoring `terminationGracePeriodSeconds` and a `preStop` hook to drain in-flight requests) → repeat until all 3 are new. At no point does the count of *ready* Pods drop below the original 3, so capacity and availability are preserved throughout.

## Q&A — Trade-offs & Failure Modes

**Q: What actually goes wrong with rolling updates in practice?**
A: Two recurring failure modes: (1) In-flight request drops during Pod termination if SIGTERM isn't handled gracefully — Kubernetes sends SIGTERM, waits `terminationGracePeriodSeconds` (default 30s), then SIGKILLs. Spring Boot's default shutdown can cut off active requests unless you enable `server.shutdown=graceful` and set `spring.lifecycle.timeout-per-shutdown-phase`, and add a `preStop` hook (`sleep 5`) to let the Service's endpoint removal propagate before the container actually stops receiving new connections. (2) A new version that passes readiness but has a slow memory leak or connection pool exhaustion under real traffic — readiness checks are usually too shallow (just "can I respond to /health") to catch this, so it surfaces 10-20 minutes into the rollout as cascading pod restarts.

**Q: What's the cost/complexity overhead of Kubernetes that a team should go in eyes-open about?**
A: You now own (or share ownership of) a distributed system: etcd availability, control-plane upgrades, node OS patching, CNI networking, and a much larger YAML surface area (Deployments, Services, Ingress, ConfigMaps, RBAC, NetworkPolicies) that itself needs code review and testing. Debugging shifts from "SSH into the box" to correlating container logs, kubelet events, and scheduler decisions across nodes — the learning curve for the team is real and ongoing (upgrades bring API deprecations you have to track, e.g., `policy/v1beta1` PodDisruptionBudget being removed).

**Q: When would you NOT recommend Kubernetes?**
A: A single service (or a handful) with low/flat traffic, a small team without existing K8s expertise, and no multi-cloud requirement — a managed PaaS (Elastic Beanstalk, Cloud Run, App Runner, Heroku-style) or plain ECS/Fargate gets you containerization's reproducibility benefits without owning cluster operations. I'd also avoid it for a team that can't staff on-call for cluster-level issues, since a control-plane or CNI problem can take down everything, not just one app.

**Q: What's a concrete production incident this setup could still cause?**
A: A misconfigured resource limit — say a Java service with `-Xmx` implicitly higher than the container memory limit due to a JDK version change in ergonomics — gets OOMKilled repeatedly under load, and because the Deployment keeps rescheduling it, you get a crash-loop that looks like "the service is down" rather than "the config is wrong," and a naive on-call engineer scales replicas up instead of fixing the memory ratio, making it worse (more OOM kills, more churn, potential node memory pressure evicting *other* pods).

**Q: How do you decide sizing for requests/limits rather than guessing?**
A: Load test staging under production-like traffic while watching Actuator/Micrometer JVM metrics (`jvm.memory.used`, `process.cpu.usage`) and container cgroup stats, set requests near p50 steady-state usage (so the scheduler doesn't over-reserve and waste node capacity) and limits above p99 plus headroom (so transient spikes don't trigger throttling/OOM), then use the Vertical Pod Autoscaler in recommendation-only mode to validate over a few weeks before hand-tuning further.

## Q&A — Scaling & Extending

**Q: At 10x traffic, what changes?**
A: Horizontal Pod Autoscaler driven by CPU and, more usefully, custom Micrometer-exported metrics (e.g., request queue depth or p99 latency) via the Prometheus Adapter, so scaling reacts to actual load characteristics, not just CPU. You'd also revisit node-level autoscaling (Cluster Autoscaler / Karpenter) so the node pool grows with Pod demand instead of Pods going Pending. At that scale I'd also introduce PodDisruptionBudgets so voluntary disruptions (node drains, cluster upgrades) never take out more than N Pods of a service at once.

**Q: At 10x team size, what organizational changes follow?**
A: Move from one shared cluster/namespace-per-env to per-team namespaces with ResourceQuotas and NetworkPolicies for blast-radius isolation, adopt GitOps (Argo CD/Flux) so cluster state is declarative and auditable instead of ad hoc `kubectl apply`, and introduce a platform/SRE team owning cluster upgrades and shared Helm chart templates so app teams don't each reinvent Deployment/Service boilerplate.

**Q: What would you add next if you were continuing this project?**
A: Canary rollouts via Argo Rollouts gated on Prometheus SLOs (ties directly into the observability work), a service mesh (Istio/Linkerd) if service-to-service mTLS and fine-grained traffic shaping become necessary, and GitOps so every environment change is a reviewed pull request rather than a manual `kubectl` command — closing the last environment-drift gap (cluster *config* drift, as opposed to the image drift we'd already solved).

**Q: How would multi-region or multi-cluster change this design?**
A: You'd need cluster-federation-style patterns or independent clusters per region with a global load balancer (e.g., GCLB / Route 53 latency routing) in front, plus a strategy for cross-region data consistency (the hard part is almost never the containers — it's the stateful backing stores). I'd keep the Deployment/probe/rolling-update mechanics identical per cluster and centralize only the observability and CI/CD pipelines.

## Rapid-Fire Follow-ups
- Q: What's the default rolling update strategy value if unspecified? A: `maxUnavailable: 25%`, `maxSurge: 25%`.
- Q: What Linux primitives does a container actually use? A: Namespaces (isolation) and cgroups (resource limits).
- Q: What happens if a liveness probe fails? A: Kubelet restarts the container.
- Q: What happens if a readiness probe fails? A: Pod is removed from Service endpoints, not restarted.
- Q: Command to see rollout status live? A: `kubectl rollout status deployment/order-service`.
- Q: Command to rollback a bad deploy? A: `kubectl rollout undo deployment/order-service`.
- Q: Why run containers as non-root? A: Limits blast radius if the app process is compromised.
- Q: What's a PodDisruptionBudget for? A: Guarantees a minimum number of available Pods during voluntary disruptions like node drains.
- Q: ClusterIP vs NodePort vs LoadBalancer? A: Internal-only, static port on every node, cloud-provisioned external LB.
- Q: Why multi-stage Docker builds? A: Keep the final runtime image free of build tools and smaller in size.
