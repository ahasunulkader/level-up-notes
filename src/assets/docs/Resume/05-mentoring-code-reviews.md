# Mentoring Junior Engineers & Code Review Leadership

## Resume Line
> "Mentored junior engineers through code reviews and sprint feedback; drove best practices adoption that improved team consistency and reduced bug rates."

## TL;DR
This bullet is testing whether you can operate above your IC ticket queue — whether you can raise the technical floor of a team, not just your own output. Interviewers use it to probe soft-skill maturity: how you give hard feedback without demoralizing people, how you handle pushback from someone who disagrees with your review comment, and whether you can actually substantiate "reduced bug rates" with something more rigorous than a vibe. The core story to tell is concrete: a specific junior engineer, a specific bad pattern you kept seeing, a specific intervention (review checklist, pairing session, or standard you introduced), and a specific measurable outcome.

## The Story (STAR-style anchor)
**Situation:** At Enosis, I was Senior SE I on a 7-person Spring Boot team that had onboarded two junior engineers within the same quarter. PR review turnaround was slow (2-3 days average) and I noticed recurring issues landing in QA — missing `@Transactional` boundaries, N+1 queries from lazy-loaded Hibernate associations, and inconsistent exception handling across controllers.

**Task:** As the most senior backend reviewer on the team, I took ownership of tightening our review process and actively mentoring the two juniors, without a formal "mentor" title or extra time allocated — I still owned my own sprint commitments.

**Action:** I did three things. First, I wrote a lightweight PR checklist (transaction boundaries, N+1 checks via query count assertions, consistent `@ControllerAdvice` exception mapping) and pinned it in our repo's `CONTRIBUTING.md` so feedback wasn't "just my opinion." Second, instead of leaving purely corrective comments, I started leaving "why" comments with a link to the specific Hibernate/Spring doc or a small code example, and for the two juniors I scheduled a recurring 20-minute pairing session every other Friday to walk through a recent PR together instead of just commenting async. Third, I pushed for us to add a couple of static analysis rules (SonarQube custom rule for missing `@Transactional` on multi-step repository calls) so the feedback became automated instead of me repeating myself every sprint.

**Result:** Over the next two quarters, our post-merge defect rate (bugs found in QA/staging attributable to PRs I or the team reviewed) dropped by roughly 35%, review turnaround dropped to under a day because reviewers had a shared checklist instead of re-litigating style opinions, and one of the two juniors was promoted to Software Engineer II largely on the strength of the growth documented in their review history and sprint retros.

## Q&A — Foundational

**Q: What does a good code review actually check for, in priority order?**
A: Correctness first (does it do what it claims, are edge cases handled), then safety (transaction boundaries, null handling, security — e.g., SQL injection via string-concatenated JPQL), then design (is this the right abstraction, does it belong here), then maintainability/readability, and only last, style — and style should mostly be automated away (Checkstyle/Spotless) so humans don't spend review time on brace placement.

**Q: How do you review a PR that touches Hibernate entity relationships?**
A: I check fetch type (`LAZY` vs `EAGER`) against how the entity is actually used downstream, look for N+1 patterns — e.g., iterating a `List<Order>` and calling `order.getCustomer().getName()` inside the loop without a `JOIN FETCH` — and check cascade types on `@OneToMany`/`@ManyToOne` to make sure `CascadeType.REMOVE` isn't accidentally wired somewhere it'll delete more than intended.
```java
// Red flag in review:
List<Order> orders = orderRepository.findAll();
orders.forEach(o -> System.out.println(o.getCustomer().getName())); // N+1

// What I'd ask for:
@Query("SELECT o FROM Order o JOIN FETCH o.customer")
List<Order> findAllWithCustomer();
```

**Q: What's the difference between a blocking comment and a nit, and how do you signal that in a review?**
A: A blocking comment is something that must change before merge — a correctness bug, a security hole, a missing test for a critical path. A nit is a preference that doesn't affect correctness. I prefix nits explicitly (`nit:`) so the author knows they can use judgment, and I never let a PR sit blocked on nits alone.

**Q: How do you give feedback to a junior engineer who wrote genuinely bad code, without discouraging them?**
A: I separate the person from the code in language — "this approach will cause X" rather than "you did X wrong" — and I always pair the criticism with the "why" plus a suggested direction, not just "this is wrong." If it's a recurring pattern, I take it to a 1:1 or pairing session instead of stacking it into PR comments, because a comment thread is a bad medium for "you keep doing this."

**Q: What's your review SLA and why does it matter?**
A: I aim to give first-pass feedback within a business day, sooner for anything blocking someone else's work. Slow reviews are one of the biggest hidden costs on a team — a junior's PR sitting for 3 days doesn't just delay that ticket, it delays their learning loop, because feedback loses value the further it gets from when they wrote the code.

**Q: How do you review sprint feedback vs. code review — are they the same skill?**
A: Related but different. Code review is object-level (this diff, this PR). Sprint feedback is about patterns over time — "you've had three PRs this sprint with missing test coverage on the service layer, let's talk about why" — and it's where I'd raise things I intentionally didn't nitpick line-by-line, because doing so in every PR would feel like piling on.

**Q: Give an example of a "best practice" you introduced and how you rolled it out.**
A: I introduced a standard for exception handling — every REST controller had been doing its own try/catch with inconsistent error response shapes. I proposed a single `@RestControllerAdvice` with a typed exception hierarchy (`ResourceNotFoundException`, `ValidationException`, etc.) mapping to consistent JSON error bodies, wrote the first version myself, demoed it in a team sync, then migrated two example controllers as a template before asking the rest of the team to adopt it incrementally in their own PRs.

## Q&A — Why This, Not That (Decision Tree)

**Q: Why mentor through code review instead of formal training sessions or documentation alone?**
A: Because code review is feedback at the point of maximum relevance — the engineer just made a decision, the context is fresh, and the fix is immediately actionable. Documentation is good for reference but doesn't correct behavior in the moment; training sessions are good for broad concepts but don't catch the specific mistake a specific person is about to make.

**Q: But doesn't review-based mentoring not scale — you're one person reviewing everything?**
A: Right, which is why I didn't try to be the only reviewer. I pushed for the checklist and the SonarQube rule specifically so the *standard* was encoded outside of me. My personal review bandwidth handled the judgment calls; the tooling handled the repeatable checks. That's the scaling lever — codify what's codifiable, reserve human review for what isn't.

**Q: What if a junior pushes back and disagrees with your review comment — what do you actually do?**
A: I ask them to walk me through their reasoning first, because sometimes they're right and I'm missing context — e.g., they intentionally used `EAGER` fetch because that entity's association is used in 95% of call sites and lazy would just cause N+1 anyway. If after that I still think I'm right, I explain the concrete failure mode I'm worried about, not just "convention says so." If it's genuinely a matter of taste and not correctness, I let it go — my name isn't on their code, and forcing style compliance on a non-correctness issue erodes trust.

**Q: But what if they're wrong and just won't budge — do you just approve it?**
A: No — for anything that's a correctness or safety issue, I don't approve until it's resolved, but I try to resolve it via a live conversation (call or in-person) rather than a comment war, because comment threads escalate tone faster than voice does. If we still disagree and it's consequential, I loop in the tech lead as a tiebreaker rather than pulling rank myself — that keeps the relationship collaborative instead of hierarchical.

**Q: OK, but doesn't going to the tech lead undermine the junior in front of leadership?**
A: I frame it as "we have two reasonable positions, let's get a third opinion" rather than "I'm right, escalate," and I do it with the junior present, not behind their back. The goal is resolving the technical question, not winning; if it's done transparently it reads as normal engineering process, not a demotion.

**Q: Why introduce a written checklist instead of just relying on your own review judgment each time?**
A: Two reasons. First, consistency — if I'm reviewing on gut feel, two similar PRs can get different feedback depending on my mood or how carefully I read that day, which is confusing for juniors trying to learn a pattern. Second, bus factor — if I'm on leave, another reviewer can apply the same standard without me.

**Q: What if the checklist becomes stale or overly bureaucratic and slows reviews down?**
A: I treat it as a living doc, not a gate — it's a reference from `CONTRIBUTING.md`, not a form everyone has to fill out. I revisit it roughly quarterly, and if an item hasn't caught a real bug in that window I consider whether it's still earning its keep versus becoming review theater.

**Q: Why pairing sessions specifically, rather than just more detailed PR comments?**
A: Because some things are hard to explain asynchronously — walking through *why* a Hibernate proxy behaves the way it does, or why a particular query plan is bad, is much faster with a shared screen and a live back-and-forth than a comment thread with three rounds of clarifying questions. Pairing also builds relationship trust, which makes the async feedback land better afterward.

## Q&A — Trade-offs & Failure Modes

**Q: What's the real cost of the time you spent mentoring — didn't it hurt your own delivery?**
A: Yes, there's a real trade-off — roughly 2-3 hours a week between reviews, pairing sessions, and checklist maintenance that wasn't going into my own tickets. I made this sustainable by being explicit with my manager that mentoring was part of my workload, not free extra capacity, so it factored into my sprint point allocation instead of being invisible, unpaid overhead.

**Q: What happens when heavy code review turns into a bottleneck — PRs piling up waiting on you specifically?**
A: That's a real failure mode if you become the sole gatekeeper. I mitigated it by making sure at least one other mid-level engineer could review against the same checklist, and by not requiring my personal approval on every PR — only on higher-risk areas (data layer, auth, payment-adjacent code).

**Q: When would heavy, checklist-driven review be the wrong approach?**
A: On a small, highly experienced team where everyone already shares the same instincts, a heavy process adds friction without adding safety — you'd be optimizing for a problem (inconsistency) that doesn't exist yet. It's most valuable when the team is growing fast or skill levels are mixed, which was exactly our situation.

**Q: Can code review actually catch the bugs that matter, or does it just catch style issues?**
A: Honestly, review is weak at catching concurrency bugs, subtle performance regressions, and anything that only manifests under production load — those need tests, profiling, and monitoring, not a human reading a diff. I was upfront about this with the team: review is one layer, not a substitute for test coverage or observability.

**Q: How do you know your feedback actually changed behavior and wasn't just repeated every sprint?**
A: I tracked it informally by category — if I stopped seeing missing-`@Transactional` comments on a given engineer's PRs after a month, that was a signal it landed. If the same category kept recurring from the same person, that told me the async comment wasn't working and it was time for a direct conversation instead.

## Q&A — Scaling & Extending

**Q: How would this look with 30 engineers instead of 7?**
A: One-on-one mentoring doesn't scale linearly, so I'd shift toward multiplying through others: train a couple of senior engineers per sub-team to own the same checklist-and-pairing model, invest more heavily in automated checks (architecture tests with ArchUnit, stricter SonarQube quality gates) so the "floor" is enforced by CI rather than by any individual reviewer, and introduce a rotating "review buddy" pairing so mentoring isn't bottlenecked on a fixed set of seniors.

**Q: What would you add next if you kept doing this role?**
A: A lightweight onboarding rubric for new hires' first 90 days, explicit "review levels" (some PRs need one approval, data-layer/security-sensitive ones need two), and a quarterly retro specifically on defect categories from our bug tracker so the checklist evolves from real incidents instead of my personal pet peeves.

**Q: How do you measure "reduced bug rates" rigorously enough to survive a skeptical interviewer?**
A: I'd tie it to a concrete, pre-existing metric — e.g., defects logged in Jira tagged against modules those engineers owned, or the ratio of QA-found bugs to total PRs merged, compared quarter over quarter. I'm careful to caveat that this is correlational, not a controlled experiment — other things changed too (team got more experienced, feature complexity varied) — but the checklist/pairing rollout coincided with a visible drop, and defect categories tied directly to the checklist items (transaction boundaries, N+1s) dropped the most, which is the strongest evidence it was causal rather than coincidence.

**Q: Would this scale to a fully remote/async team?**
A: The checklist and automated checks translate directly. The pairing sessions need more intentional scheduling since you lose hallway/desk-side moments, and I'd lean more on recorded walkthroughs or async Loom-style video comments for the "why" explanations so they're not lost to timezone gaps.

## Rapid-Fire Follow-ups

**Q: Blocking comment vs. nit — how do you mark the difference?**
A: Prefix nits with `nit:`; anything unmarked is expected to be resolved before merge.

**Q: What tool did you use to automate style so review time wasn't wasted on it?**
A: Checkstyle/Spotless for formatting, SonarQube for deeper static analysis rules.

**Q: Target review turnaround?**
A: Under one business day for first-pass feedback.

**Q: Biggest recurring Hibernate mistake juniors made?**
A: N+1 queries from lazy-loaded associations accessed inside loops.

**Q: How often were pairing sessions?**
A: Every other Friday, 20 minutes, one junior at a time.

**Q: What metric did you use to show impact?**
A: QA-found defect rate on PRs from mentored engineers, tracked quarter over quarter.

**Q: What happens if a junior disagrees and you can't resolve it live?**
A: Escalate to the tech lead as a neutral tiebreaker, with the junior present.

**Q: What's the failure mode of being the sole reviewer?**
A: You become a bottleneck and a single point of failure for the team's quality bar.

**Q: Result of the checklist and pairing program?**
A: ~35% drop in post-merge defect rate over two quarters, one junior promoted to SE II.

**Q: Is code review sufficient to catch concurrency or performance bugs?**
A: No — those need tests, profiling, and monitoring; review mainly catches correctness and design issues.
