# AI-Assisted Development & OWASP Secure Coding

## Resume Line
> "Leveraged AI-assisted tools (GitHub Copilot, Claude Code) to accelerate delivery; enforced OWASP secure coding standards in API design and participated in pre-release security audits."

## TL;DR
This bullet is really two skills glued together, and interviewers probe both independently. First: do you use AI coding tools *critically* — as an accelerant with a verification discipline — or do you blindly ship whatever the model suggests (a huge red flag for a senior engineer)? Second: do you actually know OWASP Top 10 well enough to apply it during design, not just recite the list — can you point to a real vulnerability class you caught and explain *why* it was exploitable? The core story: you used Copilot/Claude Code to speed up boilerplate and exploratory work while treating AI output as a first draft requiring the same review rigor as a junior engineer's PR, and you brought that same rigor to API security reviews, catching concrete OWASP-class issues (e.g., broken object-level authorization, injection, sensitive data exposure) before release.

## The Story (STAR-style anchor)
**Situation:** Our team was building a new set of REST APIs for an internal order-management platform under a tight deadline, and separately, our security audit cadence (quarterly, informal) hadn't caught up with the increased API surface area from several new Spring Boot microservices.

**Task:** I needed to both accelerate delivery of the new APIs and make sure they didn't ship with common OWASP-class vulnerabilities, given increased scrutiny from a compliance push.

**Action:** I used GitHub Copilot for boilerplate — DTOs, mapper classes, repetitive test fixtures, validation annotations — and Claude Code for more involved tasks like refactoring a legacy authorization filter and drafting OpenAPI specs, always treating suggestions as a starting draft: I ran static analysis (SpotBugs + a security-focused ruleset, plus `dependency-check`/Snyk for CVEs in dependencies) and manually reviewed every AI-suggested change touching auth, input validation, or SQL before merging — I specifically caught an AI-suggested repository query that concatenated a filter parameter into JPQL instead of using a bind parameter, which I rewrote to use `@Param`. On the security side, I ran our API endpoints against the OWASP API Security Top 10 checklist during design review: added object-level authorization checks (a customer could otherwise fetch another customer's order by guessing an ID — BOLA/IDOR), moved secrets out of `application.yml` into Vault-backed secrets, added rate limiting on auth endpoints, and enforced consistent input validation via Bean Validation (`@Valid`, custom validators) instead of ad hoc null checks scattered through controllers. I also led/participated in a pre-release security audit combining our own checklist review with a Burp Suite / OWASP ZAP scan against a staging deployment.

**Result:** We shipped the new API surface roughly 30% faster than the team's historical estimate for similar scope (measured against comparable past sprints), while the pre-release audit found and fixed 4 issues before release — including one IDOR that would have let an authenticated user view another tenant's order history — versus historically finding such issues in production via bug bounty or customer report.

## Q&A — Foundational

**Q: How do you actually use Copilot/Claude Code day to day — what's it good and bad at?**
A: Good at: boilerplate (getters/setters — though Lombok mostly obviates that — DTOs, mappers, repetitive test cases, converting a JSON payload into a Java record, writing an OpenAPI YAML block from an existing controller), and as a "rubber duck" for exploring an unfamiliar API or library quickly. Bad at: anything requiring real understanding of your system's specific invariants — business rules, existing authorization model, subtle concurrency assumptions — where it will confidently produce plausible-looking but wrong code. I treat every suggestion as an untrusted first draft: I still read every line, run it through the same static analysis and code review process as human-written code, and I never accept a suggestion touching auth, cryptography, or SQL without understanding exactly why it's correct.

**Q: Give a concrete example of Copilot/Claude Code getting something wrong that you caught.**
A: Asked Claude Code to add a filter-by-status method to a Spring Data repository; it generated:
```java
@Query("SELECT o FROM Order o WHERE o.status = '" + status + "'")
List<Order> findByStatus(String status);
```
That's a textbook injection vector if it ever got refactored to use `@Query(value = ..., nativeQuery = true)` or someone copy-pasted the pattern into raw JDBC — and even in JPQL form it's bad practice. I rewrote it as:
```java
@Query("SELECT o FROM Order o WHERE o.status = :status")
List<Order> findByStatus(@Param("status") String status);
```
The lesson I take from it: AI models are trained on a huge corpus that includes plenty of insecure code, so they'll reproduce insecure patterns unless you're actively reviewing for them.

**Q: What's OWASP and what's the difference between the OWASP Top 10 and OWASP API Security Top 10?**
A: OWASP (Open Worldwide Application Security Project) publishes community-driven security guidance. The general Top 10 (web apps broadly) covers things like Broken Access Control, Cryptographic Failures, Injection, Insecure Design. The API Security Top 10 is more specific to REST/GraphQL API risks — e.g., BOLA (Broken Object Level Authorization), Broken Authentication, Excessive Data Exposure, Lack of Resources & Rate Limiting, Mass Assignment. For API design work I use the API-specific list because it maps much more directly to "does this endpoint leak another user's data" than the general list does.

**Q: What's BOLA/IDOR and how do you defend against it concretely?**
A: Broken Object Level Authorization (a.k.a. Insecure Direct Object Reference) — an endpoint like `GET /api/orders/{id}` checks that the caller is *authenticated* but not that the caller is *authorized to access that specific order*. Any logged-in user can enumerate IDs and read other users' data. Defense: every data-access method that takes an ID must also check ownership/tenant against the authenticated principal, ideally centralized rather than repeated per-controller:
```java
@GetMapping("/orders/{id}")
public OrderDto getOrder(@PathVariable Long id, Authentication auth) {
    Order order = orderRepository.findById(id)
        .orElseThrow(() -> new NotFoundException());
    if (!order.getCustomerId().equals(currentUserId(auth))) {
        throw new AccessDeniedException("Not your order");
    }
    return mapper.toDto(order);
}
```
Better yet, push the tenant filter into the query itself (`findByIdAndCustomerId`) so unauthorized rows are never even loaded.

**Q: What's mass assignment and how does Spring Boot make it easy to accidentally introduce?**
A: If you bind a request body directly onto your JPA entity (`@RequestBody Order order` where `Order` is the entity itself), an attacker can set fields they shouldn't control — e.g., `{"id": 5, "status": "PAID", "customerId": 999, "isAdmin": true}` — if those fields exist on the entity and there's no explicit allow-list. Fix: bind to a dedicated request DTO containing only the fields a client should be allowed to set, and map explicitly onto the entity server-side, never trusting client-supplied IDs or privileged fields.

**Q: How do you handle secrets in a Spring Boot app to avoid OWASP's "Cryptographic Failures"/sensitive data exposure category?**
A: Never in `application.yml` committed to git, never in environment variables logged at startup, never hardcoded. We used HashiCorp Vault (via Spring Cloud Vault) or Kubernetes Secrets backed by an external-secrets operator, with app code referencing a placeholder resolved at runtime, plus `.gitignore`'d local override files for dev and secret-scanning (gitleaks/truffleHog) as a pre-commit/CI hook to catch accidental commits.

**Q: What input validation did you standardize, and why does ad hoc null-checking fail?**
A: Ad hoc `if (request.getEmail() == null) throw ...` scattered through controllers is inconsistent, easy to forget on a new field, and doesn't compose. I standardized on Bean Validation annotations on request DTOs plus a global `@ControllerAdvice` exception handler:
```java
public record CreateOrderRequest(
    @NotNull @Positive Long customerId,
    @NotEmpty @Size(max = 50) List<@Valid OrderLineDto> lines,
    @Pattern(regexp = "^[A-Z]{3}$") String currencyCode
) {}

@PostMapping("/orders")
public OrderDto create(@Valid @RequestBody CreateOrderRequest req) { ... }
```
This gets validation applied consistently at the boundary, generates uniform 400 responses via `MethodArgumentNotValidException` handling, and — critically for security — rejects malformed/oversized input before it reaches business logic (defense against both bugs and denial-of-service via oversized payloads).

## Q&A — Why This, Not That (Decision Tree)

**Q: Why let engineers use AI coding assistants at all instead of banning them over IP/security concerns, which some orgs do?**
A: Because used with discipline, the productivity gain on boilerplate and exploratory work is real and measurable, and banning them just pushes usage underground (engineers use consumer ChatGPT in a browser tab with zero governance, which is worse for IP leakage than a sanctioned, enterprise-licensed tool with a data-retention agreement). The right control isn't prohibition, it's governance: use enterprise/business-tier tools with contractual guarantees your code isn't used for training, restrict what can be pasted into non-enterprise tools, and keep human review mandatory on every AI-touched line — same as we did.

**Q: But what if a Copilot suggestion happens to reproduce copyrighted/licensed code verbatim — how do you mitigate that?**
A: GitHub Copilot has a duplicate-detection filter that can block suggestions matching public code closely; beyond that, our practice was the same review process we'd apply to any contributor's code — if a chunk looks suspiciously like it was lifted (unusual style inconsistent with the surrounding file, a comment referencing another project), it gets flagged in review regardless of whether a human or an AI wrote it. This is also exactly why unreviewed "vibe coded" AI output should never go straight to main — code review is the actual control, not the tool's built-in filters alone.

**Q: Why manual security review plus a scanner, instead of just running Snyk/SonarQube and calling it done?**
A: Static/dependency scanners are good at known CVE patterns and common code smells (hardcoded secrets, SQL string concatenation, outdated dependency versions) but they're bad at *business-logic* authorization flaws like BOLA — a scanner can't know that `GET /orders/{id}` should check `customerId` ownership because that's a semantic property of your domain, not a syntactic pattern. That's exactly the IDOR bug I mentioned — a SAST tool wouldn't flag it because the code is syntactically fine; only a human reasoning about "who should be allowed to call this with which IDs" catches it. So the two are complementary: scanners for breadth and known patterns, human review for business-logic authorization gaps.

**Q: OK, but manual review doesn't scale — what if you had 200 endpoints, not 20?**
A: At that scale I'd push authorization out of ad hoc per-controller checks into a centralized policy layer — Spring Security method security (`@PreAuthorize("#id == authentication.principal.id")`) or an externalized policy engine (OPA/Rego) evaluated consistently at a gateway or filter layer — so the *pattern* is enforced structurally rather than relying on every engineer remembering to add a check in every new controller. I'd also add contract tests that specifically assert cross-tenant access returns 403/404 for a matrix of endpoints, turning "did we remember to check ownership" into an automated regression test rather than a one-time manual audit finding.

**Q: Why OWASP ZAP/Burp Suite for the pre-release audit instead of relying purely on code review?**
A: Code review catches what you think to look for; a dynamic scanner (DAST) exercises the running application from the outside like an attacker would — fuzzing parameters, trying common injection payloads, checking response headers (missing `Content-Security-Policy`, verbose stack traces leaking framework versions) — catching classes of issues that are easy to miss in review, like an error handler that leaks a full exception stack trace in a 500 response. Running both catches more than either alone: static/manual review for logic flaws, DAST for exposed surface behavior.

**Q: If ZAP found nothing, would you conclude the API is secure?**
A: No — a clean DAST scan means "no *known* automated-detectable issue was found by this tool's ruleset in this configuration," not "no vulnerabilities exist." It won't catch business-logic authorization flaws requiring domain knowledge (like our BOLA case), won't catch a subtle race condition in a payment flow, and its coverage is limited to the flows/parameters it discovered or was configured to hit. I'd always pair it with a manual checklist walk-through of the OWASP API Top 10 against our specific endpoints, and ideally a periodic third-party penetration test for anything handling real money or PII.

## Q&A — Trade-offs & Failure Modes

**Q: What's the actual risk of over-relying on AI-generated code in a security-sensitive codebase?**
A: Silent normalization of insecure patterns — if reviewers get complacent because "the AI usually gets it right," subtle issues like the string-concatenation query example slip through, especially under deadline pressure when review gets rushed. There's also a training-data bias risk: models trained on a mix of good and bad public code will sometimes suggest outdated or insecure idioms (e.g., MD5 for password hashing) that were common in older training data, so a reviewer without security fluency might not catch it.

**Q: What's the cost of enforcing OWASP-level rigor on every API — doesn't it slow delivery, which is the opposite of the "accelerate delivery" half of this bullet?**
A: There's real tension, and the way I resolved it was pushing the checks left and making them mostly automated/structural rather than a manual gate at the end: Bean Validation and centralized authorization patterns cost a small amount of upfront design time but then apply for free on every new endpoint; the parts that stayed manual (pre-release audit) were scoped to new/changed surface area, not a full re-audit every release. Net effect was that upfront discipline made delivery *faster* over multiple sprints, even though the very first sprint had some setup cost.

**Q: What happens when a security finding is discovered post-release despite this process?**
A: We treat it like any production incident — sev-rate it based on exploitability and data sensitivity, patch and deploy following the same rolling-update path, then do a blameless retro asking specifically "why didn't code review / static analysis / the pre-release audit catch this," and turn the answer into either a new automated check (lint rule, contract test) or a checklist addition, so the same class of bug is structurally prevented next time rather than relying on human vigilance alone.

**Q: When would this level of process be overkill?**
A: An internal-only tool with no PII, no financial data, and access restricted to a trusted employee VPN — the OWASP API Top 10 checklist and DAST scan are still cheap enough to run, but a formal pre-release audit gate on every deploy would be disproportionate; I'd reserve the full audit cadence for externally-facing or data-sensitive APIs and use lighter-touch review for low-risk internal tooling.

## Q&A — Scaling & Extending

**Q: At 10x the number of services/endpoints, how does this evolve?**
A: Shift-left further: security requirements as part of API design templates (an OpenAPI spec review checklist before code is written), automated OWASP-pattern checks in CI (e.g., a custom SonarQube rule or Semgrep ruleset codifying our specific "no string-concatenated JPQL," "no entity-as-request-body" findings so they're caught on every PR, not just audit time), and centralized authorization (OPA/gateway-level policy) so per-endpoint correctness doesn't depend on every engineer remembering the rules.

**Q: How would you formalize AI-tool governance at a larger org?**
A: An internal policy: which tools are approved (enterprise-tier only, with data-retention/no-training contractual terms), what categories of code require mandatory human deep-review regardless of AI involvement (auth, crypto, payment, PII handling), and telemetry on AI-assisted PRs so security/quality metrics can be tracked to see if AI-assisted code has a different defect rate than fully human-written code — data I'd want before making broader claims about AI's net impact on quality.

**Q: What's the next security maturity step beyond what you've described?**
A: Threat modeling at design time (STRIDE or similar) for new features before any code — including AI-assisted code — is written, so security requirements are inputs to the design rather than a checklist applied after the fact; and moving from periodic pre-release audits to continuous security posture monitoring (DAST running on every staging deploy automatically, not just before major releases).

## Rapid-Fire Follow-ups
- Q: What does BOLA stand for? A: Broken Object Level Authorization.
- Q: SAST vs DAST? A: Static analysis of source code vs dynamic testing of a running application.
- Q: Why never bind request bodies directly to JPA entities? A: Risk of mass assignment — attacker sets fields they shouldn't control.
- Q: What Spring annotation prevents SQL/JPQL injection in queries? A: `@Param` with named parameters instead of string concatenation.
- Q: Where should secrets never live? A: Committed config files or source code.
- Q: What's the OWASP API Security Top 10 vs general OWASP Top 10? A: API-specific risks (BOLA, excessive data exposure) vs general web app risks.
- Q: What tool category is Burp Suite/OWASP ZAP? A: Dynamic Application Security Testing (DAST).
- Q: Should AI-generated code touching auth get extra scrutiny? A: Yes, same or higher bar than human-written code.
- Q: What's a mandatory control regardless of who/what wrote the code? A: Human code review before merge.
- Q: What's the first fix for an IDOR vulnerability? A: Add ownership/tenant authorization check on the resource, not just authentication.
