# DevOps and Environment Awareness

## TL;DR
**CI/CD** automates testing and deployment so every code push is validated and can be shipped safely. **Environment separation** (dev/staging/prod) prevents untested code from reaching users. **Configuration management** keeps environment-specific values out of code. **Secrets** must never be in git. **Blue-green/rolling deployments** minimize downtime during releases. **Monitoring and logging** tell you what's happening in production before your users do.

---

## Why DevOps Exists

Before DevOps, developers wrote code and "threw it over the wall" to operations teams who deployed it. This created:
- Long release cycles (weeks/months between deployments)
- Manual, error-prone deployments
- "Works on my machine" problems
- No visibility into production behavior

DevOps bridges development and operations — automating the path from code to production and giving developers visibility into how their code runs.

---

## 1. CI/CD — Continuous Integration & Continuous Deployment

### Continuous Integration (CI)

Every code push is **automatically built, tested, and validated**. Developers integrate code frequently (multiple times a day) rather than in large batches.

```
Developer pushes code
       │
       ▼
  Git (GitHub / GitLab / Bitbucket)
       │
       ▼ Webhook triggers CI pipeline
  CI Server (GitHub Actions / GitLab CI / Jenkins)
       │
       ├── Install dependencies
       ├── Run linter / code style checks
       ├── Run unit tests
       ├── Run integration tests
       └── Build artifact (Docker image / zip)
            │
            ├── PASS ✅ → merge allowed, pipeline green
            └── FAIL ❌ → developer notified, merge blocked
```

### Continuous Deployment (CD)

After CI passes, code is **automatically deployed** to an environment.

```yaml
# .github/workflows/deploy.yml (GitHub Actions example)
name: CI/CD Pipeline

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Install PHP dependencies
        run: composer install --no-dev

      - name: Run tests
        run: ./vendor/bin/phpunit

      - name: Run code style check
        run: ./vendor/bin/php-cs-fixer check src/

  deploy:
    needs: test          # only runs if test job passes
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to production
        run: |
          ssh user@server "cd /var/www/app && git pull && composer install && php artisan migrate --force"
```

### CI vs CD vs Continuous Delivery

| Term | Meaning |
|---|---|
| **Continuous Integration** | Automatically test every commit |
| **Continuous Delivery** | Every commit is ready to deploy (deploy manually when ready) |
| **Continuous Deployment** | Every passing commit is deployed automatically |

**Benefits of CI/CD:**
- Bugs caught within minutes of introduction — not days later
- Small, frequent releases instead of large risky deploys
- Automated = consistent, no human error in deployment steps
- Faster feedback loop for developers

**Challenges:**
- Requires good test coverage — bad CI with no tests gives false confidence
- Initial setup takes time
- Requires discipline to keep the pipeline fast (slow pipelines get ignored)

---

## 2. Environment Separation

A **deployment environment** is a separate instance of the application for a specific purpose.

### Typical Environment Flow

```
Developer → Local → Dev/Integration → Staging → Production

Local:      Your own machine — anything goes
Dev:        Shared environment for team integration testing
Staging:    Mirror of production — final validation before release
Production: Real users — protect at all costs
```

### Why Separate Environments?

```
Without environment separation:
Developer tests new feature → accidentally breaks database schema
→ Real users see errors and lose data

With separation:
Developer tests on local → validates on staging (staging DB = copy of prod)
→ Only after passing staging is it deployed to production
```

### Environment-Specific Configuration

Each environment has different configuration:

```php
// Production
APP_ENV=production
APP_DEBUG=false    // NEVER show errors in production
DB_HOST=prod-db.example.com
CACHE_DRIVER=redis
QUEUE_CONNECTION=sqs

// Staging
APP_ENV=staging
APP_DEBUG=false
DB_HOST=staging-db.example.com
MAIL_MAILER=log   // don't send real emails in staging

// Local development
APP_ENV=local
APP_DEBUG=true
DB_HOST=127.0.0.1
MAIL_MAILER=log
```

**Critical rules:**
- **Never enable `APP_DEBUG=true` in production** — it exposes stack traces, SQL queries, and configuration to users
- **Never share databases** between environments — staging tests can corrupt production data
- **Staging should mirror production** as closely as possible — same server specs, same services

---

## 3. Configuration Management

Configuration is everything that varies between environments — database credentials, API keys, feature flags, service URLs.

### Store Config in Environment Variables

The **12-Factor App** methodology says: store config in environment variables, not in code.

```php
// BAD — hardcoded in code (committed to git!)
$db = new PDO('mysql:host=prod-db.example.com', 'root', 'supersecret123');
$stripeKey = 'sk_live_...'; // your real Stripe key in git — catastrophic!

// GOOD — from environment
$db = new PDO(
    sprintf('mysql:host=%s;dbname=%s', getenv('DB_HOST'), getenv('DB_NAME')),
    getenv('DB_USER'),
    getenv('DB_PASS')
);
$stripeKey = getenv('STRIPE_SECRET_KEY');
```

### `.env` File (Local Development Only)

```bash
# .env — local development only, NEVER committed to git
APP_ENV=local
APP_DEBUG=true
APP_KEY=base64:...

DB_HOST=127.0.0.1
DB_NAME=myapp
DB_USER=root
DB_PASS=

STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLIC_KEY=pk_test_...
```

```bash
# .gitignore — CRITICAL: prevent .env from being committed
.env
.env.local
.env.production
```

```bash
# .env.example — template committed to git (no real values)
APP_ENV=local
APP_DEBUG=true
DB_HOST=127.0.0.1
DB_NAME=
DB_USER=
DB_PASS=
STRIPE_SECRET_KEY=
```

### Feature Flags

Feature flags let you deploy code but control who sees new features:

```php
// Config-driven feature flags
$features = [
    'new_checkout_flow' => env('FEATURE_NEW_CHECKOUT', false),
    'ai_recommendations' => env('FEATURE_AI_RECOMMENDATIONS', false),
];

if (config('features.new_checkout_flow')) {
    return $this->newCheckoutController->handle($request);
}
return $this->legacyCheckoutController->handle($request);
```

**Benefits:**
- Deploy to production but only enable for internal users first
- Gradual rollout — enable for 10% of users, monitor, then 100%
- Instant rollback — just flip the flag, no redeployment needed

---

## 4. Secrets Handling

**Secrets** are credentials that grant access to sensitive systems — database passwords, API keys, private keys, tokens.

### Rule #1: Secrets Never Go in Git

```bash
# One leaked .env commit can expose production database
# git history keeps it FOREVER even after deletion

# To check if secrets were ever committed:
git log --all --full-history -- .env
git grep 'sk_live_' $(git rev-list --all)
```

### Where to Store Secrets

| Environment | Storage |
|---|---|
| Local development | `.env` file (gitignored) |
| CI/CD pipeline | CI secrets / environment variables (GitHub Secrets, GitLab CI vars) |
| Staging/Production server | OS environment variables, or a secrets manager |
| Kubernetes | Kubernetes Secrets |
| Cloud | AWS Secrets Manager, HashiCorp Vault, Azure Key Vault |

### GitHub Actions Secrets Example

```yaml
# In GitHub: Settings → Secrets → New repository secret
# Add: DB_PASS = mysecretpassword

# .github/workflows/deploy.yml
- name: Deploy
  env:
    DB_PASS: ${{ secrets.DB_PASS }}     # injected at runtime, not in code
    STRIPE_KEY: ${{ secrets.STRIPE_KEY }}
  run: |
    ./deploy.sh
```

### Rotating Secrets

If a secret is ever exposed:
1. **Revoke immediately** — disable the compromised key
2. **Generate a new one** — get fresh credentials
3. **Update all environments** — deploy the new secret
4. **Audit** — check logs for unauthorized use of the exposed secret
5. **Post-mortem** — how did it get exposed? Prevent recurrence.

---

## 5. Blue-Green vs Rolling Deployments

Both strategies minimize downtime during deployments. They solve the problem: "How do you update a live application without taking it down?"

### Blue-Green Deployment

Run **two identical production environments** — Blue (current live) and Green (new version). Switch traffic when ready.

```
Before deployment:
  Load Balancer → Blue (v1) ← all traffic
  Green (v2) exists but gets no traffic

Deployment:
  Deploy new code to Green (v2)
  Run smoke tests on Green
  Switch load balancer: → Green (v2) ← now all traffic
  Blue (v1) kept running as instant rollback

If something goes wrong:
  Switch load balancer back to Blue (v1) ← instant rollback (seconds)
```

**Benefits:**
- Zero downtime — traffic switches instantly
- Instant rollback — just flip back
- Full test of production environment before going live

**Disadvantages:**
- Costs double the infrastructure (two full environments)
- Database migrations must be backward-compatible — both versions share the DB temporarily

### Rolling Deployment

Gradually replace old instances with new ones, one at a time.

```
5 servers running v1:
[v1][v1][v1][v1][v1]  — all traffic

Step 1: Replace server 1
[v2][v1][v1][v1][v1]  — 20% on v2

Step 2: Replace server 2
[v2][v2][v1][v1][v1]  — 40% on v2

... (continue until all replaced)

[v2][v2][v2][v2][v2]  — complete
```

**Benefits:**
- No extra infrastructure (no second full environment)
- Gradual — issues affect only a small % of users initially
- Suitable for most web apps

**Disadvantages:**
- Rollback is slower (must roll back each instance)
- During the transition, two versions run simultaneously — must be compatible

### Canary Deployment

A variant of rolling — route a tiny % of traffic to the new version first to test with real users before full rollout.

```
5% of traffic → v2 (canary)
95% of traffic → v1 (stable)

Monitor error rates and performance for 30 minutes
If all good → gradually increase canary to 100%
If problems → route 100% back to v1
```

---

## 6. Monitoring and Logging Basics

You can't fix what you can't see. Monitoring and logging tell you what your application is doing in production.

### Logging

Logs record events — what happened, when, and why.

```php
// Log levels (RFC 5424)
// debug → info → notice → warning → error → critical → alert → emergency

use Illuminate\Support\Facades\Log;

// Good log entries include context — not just the message
Log::info('User registered', ['user_id' => $user->id, 'email' => $user->email]);

Log::warning('Payment retry attempt', [
    'order_id'  => $order->id,
    'attempt'   => $attempt,
    'error'     => $e->getMessage(),
]);

Log::error('Payment failed permanently', [
    'order_id'       => $order->id,
    'stripe_error'   => $e->getStripeCode(),
    'user_id'        => $order->user_id,
]);
```

**What to log:**
- Authentication events (login, logout, failed attempts)
- Significant state changes (order placed, payment processed, user deleted)
- Errors and exceptions with context
- External API calls (request + response for debugging)
- Performance warnings (slow queries, high memory usage)

**What NOT to log:**
- Passwords, credit card numbers, personal data (GDPR)
- Noise — every DB query in production creates unmanageable logs
- Stack traces for expected errors (404, validation) — only for unexpected errors

### Monitoring

Monitoring measures system health continuously — not just when something breaks.

```
Three pillars of observability:
├── Metrics  → numbers over time (request rate, error rate, latency, CPU)
├── Logs     → event records (what happened)
└── Traces   → request journey through the system (distributed tracing)
```

**Key metrics to monitor:**

| Metric | Why |
|---|---|
| Error rate (5xx responses) | System health |
| Response time (p50, p95, p99) | User experience |
| Throughput (requests/second) | Load and capacity |
| CPU / Memory usage | Infrastructure health |
| Queue depth | Backlog and processing lag |
| Database connection pool | DB capacity |

### Alerting

```yaml
# Example alert rules (PagerDuty / Prometheus concept)
alerts:
  - name: HighErrorRate
    condition: error_rate > 1%  # more than 1% of requests failing
    for: 5 minutes
    action: page_on_call_engineer

  - name: SlowResponseTime
    condition: p95_latency > 2000ms
    for: 10 minutes
    action: notify_slack_channel

  - name: QueueBacklog
    condition: queue_depth > 10000
    for: 15 minutes
    action: notify_team
```

**Tools:**
- **Logging:** Papertrail, Loggly, AWS CloudWatch Logs, ELK Stack (Elasticsearch + Logstash + Kibana)
- **Monitoring:** Datadog, New Relic, Prometheus + Grafana, AWS CloudWatch
- **Error tracking:** Sentry, Bugsnag, Rollbar (captures full stack traces from production)
- **Uptime monitoring:** Pingdom, UptimeRobot (alerts when the site is down)

---

## Interview Q&A

**Q: What is the difference between CI and CD?**
A: CI (Continuous Integration) automatically runs tests and validation on every code push. CD (Continuous Deployment/Delivery) automatically deploys code that passes CI. Together they ensure code is always tested, always deployable, and teams can ship multiple times per day rather than big risky releases.

**Q: Why should secrets never be in git?**
A: Git history is permanent — even if you delete the secret in a later commit, it still exists in the history. Public repos expose it to the entire world instantly. Private repos can be leaked or cloned. Use environment variables, `.env` files (gitignored), or secrets managers. Rotate credentials immediately if they're ever committed.

**Q: What is the difference between blue-green and rolling deployments?**
A: Blue-green runs two full environments and switches traffic instantly — zero downtime, instant rollback, but double infrastructure cost. Rolling gradually replaces instances one by one — no extra infrastructure, but rollback is slower and both versions run simultaneously during transition.

**Q: What is the difference between logging and monitoring?**
A: Logging records discrete events — "user logged in", "payment failed", "exception thrown". Monitoring measures continuous metrics — error rate over time, response latency, CPU usage. Logging helps you understand WHAT happened; monitoring tells you HOW your system is performing. You need both: monitoring catches that something is wrong, logs help you diagnose why.

**Q: Why is environment separation important?**
A: To prevent untested or broken code from reaching real users. Staging is a mirror of production where you can validate behavior before it goes live. Without it, every test and experiment runs against real user data, and a bad deploy immediately impacts everyone. It also allows realistic testing of migrations and infrastructure changes.
