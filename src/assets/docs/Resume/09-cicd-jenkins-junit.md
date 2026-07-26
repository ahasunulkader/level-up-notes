# CI/CD with Jenkins and JUnit: Pipeline Reliability and Regression Control

## Resume Line
> "Maintained CI/CD pipelines using Jenkins and enforced automated testing practices with JUnit; improved deployment reliability and reduced regression issues across release cycles."

## TL;DR
This bullet is testing whether you actually *own* a pipeline end-to-end — can you write a Jenkinsfile from scratch, explain what happens on every commit and every release, and connect test discipline to a measurable drop in production incidents? It's also testing whether "enforced automated testing" means you had real teeth (build-breaking coverage gates, quality gates, branch protection) or just wrote a few tests that ran optionally. The core story: you moved a team from ad-hoc/manual deploys and flaky-or-absent tests to a declarative, gated pipeline where a red JUnit suite or a coverage drop physically blocks a merge, and you can point to a before/after in defect escape rate.

## The Story (STAR-style anchor)
**Situation:** At Enosis Solutions, our team maintained a Spring Boot + Angular claims-processing platform for a US healthcare client. Releases were biweekly, deployed by a senior dev manually running Maven builds and copying WAR files to a Tomcat box. Two releases in a row had regressions that only surfaced in UAT — one was a null-pointer in a claims-adjudication service that broke a code path nobody had re-tested because "it hadn't changed."

**Task:** I was asked to make releases boring — reduce the number of production hotfixes per release and cut the manual deploy time.

**Action:** I set up a Jenkins multibranch pipeline driven by a `Jenkinsfile` in the repo: on every PR, it ran `mvn verify` (compile, unit tests, JaCoCo coverage check), published JUnit XML results via the `junit` step, and used the JaCoCo Jenkins plugin to fail the build if line coverage on changed files dropped below 80%. I split tests into fast unit tests (run on every push) and a slower integration suite tagged with JUnit 5's `@Tag("integration")` that ran on merge to `develop` against a Testcontainers Postgres instance. I added a `Jenkinsfile` stage for static analysis (SonarQube quality gate) and wired Slack notifications on pipeline failure. For deploys, I replaced manual WAR copying with a parameterized Jenkins job that built a Docker image, pushed it to our internal registry, and ran an Ansible playbook to roll it out, with an automatic rollback step if the post-deploy smoke-test stage (a small suite of `@SpringBootTest` health-check tests) failed.

**Result:** Over the next two quarters, production hotfixes per release dropped from an average of ~3 to under 1, and the manual deploy window (previously ~45 minutes of a person babysitting the process) dropped to under 10 minutes of pipeline time with zero human touch. We also caught two real regressions in PR review specifically because the coverage gate forced a test to be written for previously-untested branches.

## Q&A — Foundational

**Q: What's the difference between a Jenkins Freestyle job and a Jenkins Pipeline (Jenkinsfile)?**
A: A Freestyle job is configured through the Jenkins UI — build steps, triggers, and post-build actions are stored in Jenkins' internal XML config, not in source control. A Pipeline job is defined as code (Groovy DSL) in a `Jenkinsfile` checked into the repo, so the build process is versioned, reviewable, and reproducible across branches. I used declarative pipelines almost exclusively because the build logic needs to evolve with the code it builds.

```groovy
pipeline {
    agent { label 'linux-docker' }
    tools { maven 'Maven-3.9' ; jdk 'JDK-21' }
    stages {
        stage('Build') {
            steps { sh 'mvn -B -DskipTests clean compile' }
        }
        stage('Unit Test') {
            steps { sh 'mvn -B test' }
            post {
                always { junit 'target/surefire-reports/*.xml' }
            }
        }
        stage('Integration Test') {
            when { branch 'develop' }
            steps { sh 'mvn -B verify -Pintegration' }
            post {
                always { junit 'target/failsafe-reports/*.xml' }
            }
        }
        stage('Package & Push Image') {
            steps {
                sh 'docker build -t registry.internal/claims-service:${GIT_COMMIT} .'
                sh 'docker push registry.internal/claims-service:${GIT_COMMIT}'
            }
        }
    }
    post {
        failure {
            slackSend channel: '#ci-alerts', message: "Build ${env.BUILD_URL} failed"
        }
    }
}
```

**Q: How does Jenkins know a build "passed" versus "failed" with respect to JUnit results?**
A: The `junit` post-build step parses the JUnit XML report files (Surefire/Failsafe output) and marks the build `UNSTABLE` if any test failed, even if the shell step's exit code was 0 (Maven's Surefire plugin can be configured to not fail the shell command on test failure so the reports still get archived). I always configured `mvn test` to fail the build (`testFailureIgnore=false`) *and* published the junit report, so we got both a hard stop and a readable trend graph of pass/fail counts per build in the Jenkins UI.

**Q: What's the difference between JUnit's `@Test`, `@ParameterizedTest`, and `@RepeatedTest`?**
A: `@Test` runs a method once. `@ParameterizedTest` runs the same test body multiple times with different inputs, supplied via `@ValueSource`, `@CsvSource`, or a `MethodSource`. `@RepeatedTest` runs the same test N times with no varying input, useful for surfacing flakiness or testing non-deterministic code (e.g., retry logic, concurrency).

```java
@ParameterizedTest
@CsvSource({
    "1000, 0.10, 100.0",
    "500, 0.05, 25.0",
    "0, 0.20, 0.0"
})
void calculatesDiscountCorrectly(double amount, double rate, double expected) {
    assertEquals(expected, discountService.calculate(amount, rate), 0.001);
}
```

**Q: What is a JUnit 5 extension and when have you written a custom one?**
A: An extension (`@ExtendWith`) hooks into the test lifecycle — before/after each test, parameter resolution, exception handling. I used `SpringExtension` for Spring context tests and wrote a custom `MockedClockExtension` that injected a fixed `Clock` bean so time-dependent logic (SLA-expiry checks) was deterministic in tests instead of depending on `Instant.now()`.

**Q: What's the difference between a unit test, an integration test, and an end-to-end test in your pipeline, and how did you keep them from being conflated?**
A: Unit tests mock all collaborators and test one class in isolation — fast, run on every commit. Integration tests bring up real infrastructure (via Testcontainers: a real Postgres, a real Kafka broker) and test that a Spring context wires correctly and that repository queries actually work against the real dialect. End-to-end tests hit a fully deployed environment through its HTTP API. I kept them separated with Maven profiles and JUnit tags (`@Tag("unit")`, `@Tag("integration")`) so Jenkins could run the fast suite on every push and reserve the slow suite for merges to `develop`/nightly builds — otherwise every PR would take 20 minutes and people start skipping CI.

**Q: What does "Jenkins agent" mean, and why did you use labeled agents instead of running everything on the controller?**
A: An agent (formerly "slave") is a separate machine/container that executes the actual pipeline steps; the controller just orchestrates. Running builds on the controller doesn't scale and is a security risk (build scripts get controller-level access). I used a pool of Docker-based ephemeral agents (via the Jenkins Docker plugin) labeled by capability (`linux-docker`, `maven-jdk21`) so pipelines requested exactly the toolchain they needed and each build got a clean, disposable environment — no "works on this one agent because of leftover state" bugs.

**Q: What's a Jenkins shared library and why would you build one?**
A: A shared library is a separate Git repo of reusable Groovy pipeline code (`vars/*.groovy`, `src/*.groovy`) that any `Jenkinsfile` can import with `@Library('my-shared-lib') _`. I built one to centralize our standard "build → test → sonar → docker → deploy" stage sequence so 12+ microservice repos didn't each hand-roll slightly different pipelines; a fix to the deploy logic (e.g., adding a smoke-test rollback) applied everywhere after one library version bump instead of 12 PRs.

## Q&A — Why This, Not That (Decision Tree)

**Q: Why Jenkins instead of GitHub Actions or GitLab CI, which need way less maintenance?**
A: Jenkins was already the org's standard when I joined, integrated with our on-prem GitLab instance, internal artifact registry, and existing Ansible deployment scripts — those integrations aren't free to rebuild. Jenkins also gave us self-hosted agents behind the corporate firewall, which mattered because our build needed to reach internal Oracle/SQL Server test instances that weren't exposed to the public internet. GitHub Actions would have needed self-hosted runners anyway to reach that internal network, at which point you've just replaced Jenkins agents with GitHub runners and kept the maintenance burden.

*But what if the org were greenfield today?* — Honestly, for a brand-new project with no legacy infra constraints, I'd lean GitHub Actions or GitLab CI for a small team: less to patch, less plugin-version-hell, YAML config is simpler to reason about than Groovy DSL, and hosted runners remove the "who patches the Jenkins box" problem entirely.

*OK, but doesn't Jenkins plugin sprawl become a maintenance nightmare?* — Yes, and it did — we had version-compatibility breakage between the Blue Ocean, Pipeline, and Credentials plugins after an unplanned Jenkins core upgrade once. I mitigated this by pinning plugin versions in our Jenkins-as-code config (`jenkins.yaml` via the Configuration-as-Code plugin) and testing upgrades on a staging Jenkins instance before touching the production controller.

**Q: Why JUnit instead of TestNG?**
A: JUnit 5 is the de facto standard in the Spring ecosystem — `spring-boot-starter-test` wires it in by default, and virtually every library (Mockito, AssertJ, Testcontainers) documents JUnit 5 integration first. TestNG has some genuinely nice features (built-in test grouping without tags, native parallel execution config, dependency-ordered tests), but adopting it would mean fighting the framework's defaults rather than working with them.

*But what if you needed test-execution-order dependencies, which TestNG handles more natively?* — I'd treat that as a smell first — tests that depend on execution order are usually testing shared mutable state, which causes flakiness under parallel execution anyway. Where I genuinely needed ordering (a multi-step workflow test), I used JUnit 5's `@TestMethodOrder(OrderAnnotation.class)` rather than switching frameworks for one use case.

*OK, but doesn't `@TestMethodOrder` just paper over the same coupling problem?* — Somewhat, yes — I used it sparingly, and only for tests that were explicitly *documenting* a sequential business workflow (submit claim → adjudicate → pay), not as a crutch for state leakage between unrelated tests. Each `@Order`ed test still asserted its own outcome; they weren't silently relying on mutated instance fields.

**Q: Why pipeline-as-code (Jenkinsfile) instead of UI-configured Freestyle jobs?**
A: Because the alternative is undocumented, unreviewable build logic living only in Jenkins' database. If the Jenkins box died, or someone changed a build step through the UI at 5pm, you'd have no diff, no rollback, and no idea what changed. A Jenkinsfile goes through the same PR review as application code, gets versioned per branch (so a feature branch can experiment with a new build stage without breaking `main`), and is disaster-recoverable — reprovision Jenkins, point it at the repo, and every job definition comes back.

*But what if a stage needs to change independent of the app code — e.g., a security patch to the build agent config?* — That's exactly what the shared library is for: infra-level pipeline logic lives in the shared library repo, versioned and released independently of any single service's `Jenkinsfile`, which just calls `standardPipeline()`.

**Q: How did you actually measure "reduced regression issues" — that's a strong, specific claim?**
A: I tracked two numbers from our issue tracker (Jira) over rolling release windows: (1) hotfix tickets filed within 72 hours of a release being tagged with the release version, and (2) the ratio of bugs caught in QA/staging vs. caught in production for the same release. Before the pipeline changes, hotfixes averaged ~3 per release across the prior two quarters; after introducing the coverage gate and integration-test stage, it dropped to under 1 per release over the following two quarters, and the QA-to-production catch ratio improved because the coverage gate forced new tests onto previously-untested code paths that had been the source of two prior regressions. I'd be upfront in an interview that this is a correlational number from a small sample of releases, not a controlled experiment — but it's a real, checkable metric, not a vibe.

*But couldn't the drop just be from having fewer/smaller releases in that window, not the pipeline?* — Fair challenge — I controlled for that loosely by checking that release size (story points shipped, LOC diff) was comparable across the two windows; it wasn't a case of shipping less. I'd also point to the two specific regressions the coverage gate caught in PR review before merge — concrete, attributable catches — as corroborating evidence beyond the aggregate trend.

**Q: What does a bad flaky-test culture look like, and how would you fix one you inherited?**
A: It looks like: a red build is treated as "probably just flaky, rerun it"; people add `@Disabled` to failing tests instead of fixing them; CI takes 40 minutes so people batch commits and stop trusting the pipeline; eventually the test suite is mostly ignored and regressions ship anyway. To fix it I'd first quantify it — Jenkins Test Result Trend / a flaky-test tracking plugin to identify the worst offenders by rerun-to-pass ratio — then triage: genuinely flaky tests (timing/order-dependent, shared test DB state, unmocked system clock) get fixed or quarantined into a separate "known-flaky, non-blocking" stage with a ticket and a deadline, not silently disabled forever. I'd also add a policy: no new `@Disabled` without a linked ticket and an owner, enforced in PR review.

## Q&A — Trade-offs & Failure Modes

**Q: What actually breaks in production with a pipeline like this?**
A: A few real failure modes I've hit: (1) the coverage gate becomes a game — people write assertion-free tests just to touch lines and satisfy JaCoCo, which is worse than no gate because it creates false confidence; I addressed this partly through PR review norms and partly by also tracking mutation-testing spot checks periodically. (2) Integration tests using Testcontainers are slow and occasionally flaky under agent resource contention (Docker-in-Docker on a busy agent), which trained people to distrust "integration test failed" messages — I mitigated with retry-once-then-fail logic and dedicated resource-labeled agents for that stage. (3) A silent Jenkins agent disk-fill (leftover Docker images/layers) caused builds to fail with cryptic "no space left on device" errors — fixed with a scheduled `docker system prune` job and disk-usage alerting.

**Q: What's the cost/complexity trade-off of self-hosted Jenkins vs a managed CI service?**
A: Self-hosted Jenkins means you own patching, plugin compatibility, agent capacity planning, and controller high-availability — real ongoing engineering time that isn't visible in a demo. In exchange you get network-level access to internal resources, full control over agent hardware/GPU/DB versions, and no per-minute billing surprises at scale. A managed service trades that operational burden for a recurring cost and (usually) a requirement to expose your build environment to the internet or set up a VPN/self-hosted-runner bridge anyway once you need internal DB access — which, in our case, made the "no maintenance" pitch less true than it looks on paper.

**Q: When would you NOT build out this level of CI/CD rigor?**
A: For a short-lived prototype, an internal tool with one user, or a proof-of-concept spike where the code has a good chance of being thrown away, I wouldn't invest in coverage gates, integration test infra, or a shared pipeline library — the setup cost isn't recouped. I'd still want *some* CI (build + a smoke test) so the repo doesn't rot, but the enforcement layer (blocking merges on coverage) is a cost that only pays off once multiple people are shipping to the same codebase over a sustained period.

**Q: What's a case where enforcing JUnit coverage gates actively hurt velocity, and how did you handle it?**
A: Early on, the 80% coverage-on-changed-files gate blocked a hotfix PR because the fix touched a huge legacy God-class with near-zero existing coverage, and writing meaningful tests for the whole class wasn't feasible under incident time pressure. I added a documented emergency-bypass process — a tech lead could apply a `ci-override` label that skipped the gate, but it auto-filed a follow-up ticket to backfill tests, and we tracked how often the override was used (it should trend toward zero, not become the norm).

**Q: What breaks when your test suite gets slow, and what's your response?**
A: Once the full suite crept past ~20 minutes, PR throughput dropped because people started stacking multiple commits before pushing, which made root-causing failures harder (more changes per red build). My response was splitting the suite (unit vs. integration, as above), enabling JUnit 5 parallel execution (`junit-platform.properties` with `junit.jupiter.execution.parallel.enabled=true`) for the unit tier, and caching Maven's local repo (`.m2`) between agent runs so dependency resolution wasn't repeated every build.

## Q&A — Scaling & Extending

**Q: How would this evolve if the org went from 1 team/12 services to 20 teams/150 services?**
A: The shared Jenkins library becomes non-optional infrastructure, versioned and owned by a platform team, not something individual service teams patch ad hoc. I'd push toward Jenkins Configuration-as-Code for the controller itself (so onboarding a new team's job is a PR, not a UI click-through), move to Kubernetes-based dynamic agents (Jenkins Kubernetes plugin) so agent capacity scales with load instead of a fixed pool, and introduce per-team quality gates that can be tuned (a legacy service might start at 40% coverage with a ratchet-up policy, not a flat 80% for everyone).

**Q: What would you add next if you kept working on this pipeline?**
A: Contract testing (Pact) between services to catch integration regressions without needing a full end-to-end environment for every PR; canary or blue-green deploys driven from the same Jenkins pipeline instead of a single-shot rollout, so a bad deploy auto-rolls-back based on live error-rate metrics rather than just a pre-deploy smoke test; and a flaky-test dashboard (e.g., via the Jenkins `Flaky Test Handler` plugin or exporting JUnit results to a time-series store) to proactively quarantine flaky tests before they erode trust.

**Q: How would you extend the JUnit strategy for contract or consumer-driven testing between microservices?**
A: I'd introduce Pact (or Spring Cloud Contract) so the consumer service defines its expected request/response contract as a JUnit test, publishes it to a Pact broker, and the provider service's Jenkins pipeline verifies against that contract on every build — catching breaking API changes before they reach a shared staging environment, which is much cheaper than debugging a failed end-to-end test across five services.

**Q: At 10x the deployment frequency (multiple deploys per day instead of biweekly), what has to change?**
A: Manual approval gates in the pipeline become the bottleneck, so I'd move toward automated progressive delivery — deploy to a canary slice, watch error rate/latency SLOs via Prometheus for a fixed bake time, auto-promote or auto-rollback — rather than a human clicking "deploy to prod" in Jenkins. Test suite speed also becomes existential at that cadence, so investment shifts toward test parallelization, selective test execution (only run tests affected by the changed module graph), and stronger reliance on fast unit/contract tests over slow end-to-end suites.

## Rapid-Fire Follow-ups
- Q: Declarative vs Scripted Jenkins pipeline — which did you use? A: Declarative, for readability and built-in validation; scripted only inside shared-library steps needing complex logic.
- Q: What plugin publishes JUnit XML in Jenkins? A: The `junit` step (JUnit plugin), pointed at Surefire/Failsafe report XML.
- Q: Surefire vs Failsafe? A: Surefire runs unit tests during `test` phase; Failsafe runs integration tests during `verify`/`integration-test` phase and doesn't fail the build until `verify`.
- Q: What annotation excludes a test temporarily? A: `@Disabled("JIRA-1234")` with a reason/ticket.
- Q: How do you mock a dependency in JUnit 5? A: Mockito with `@ExtendWith(MockitoExtension.class)` and `@Mock`/`@InjectMocks`.
- Q: What's a Jenkins webhook trigger? A: A push/PR event from GitLab/GitHub hits Jenkins' endpoint to start a build immediately instead of polling SCM.
- Q: AssertJ vs plain JUnit asserts? A: AssertJ gives fluent, more readable assertions and better failure messages, e.g. `assertThat(list).hasSize(3)`.
- Q: What's a JaCoCo quality gate? A: A build-breaking threshold on code coverage, often scoped to changed files/diff coverage rather than whole-repo.
- Q: Blue-green vs canary deploy? A: Blue-green switches all traffic at once between two full environments; canary shifts a small traffic percentage first and expands gradually.
- Q: What's `Testcontainers` for? A: Spinning up real, disposable Docker instances (Postgres, Kafka) for integration tests instead of mocking the database.
