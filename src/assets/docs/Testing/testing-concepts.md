# Testing Concepts (Framework-Agnostic)

## TL;DR
Tests prove your code works — and keeps working. **Unit tests** check one thing in isolation. **Integration tests** check pieces working together. **E2E tests** check the full user flow. The **test pyramid** says: write many unit tests, fewer integration, few E2E. **Mocks** replace real dependencies; **stubs** fake return values. Test business logic and edge cases — not trivial getters or framework code.

---

## Why Testing Exists

Without tests:
- You make a change → you don't know what broke
- Refactoring is scary — every edit might silently break something
- You manually click through the app after every change
- Bugs reach production that a 10-second test would have caught

Tests give you **confidence to change code**. A good test suite is what enables refactoring, new features, and onboarding — without fear.

---

## 1. Unit vs Integration vs End-to-End Tests

### Unit Tests

Test **one unit of code in isolation** — a single function, method, or class. All dependencies are replaced with fakes (mocks/stubs).

```php
// The unit being tested
class PriceCalculator {
    public function applyDiscount(float $price, float $discountPercent): float {
        if ($discountPercent < 0 || $discountPercent > 100) {
            throw new \InvalidArgumentException('Discount must be 0-100');
        }
        return $price * (1 - $discountPercent / 100);
    }
}

// Unit test (PHPUnit)
class PriceCalculatorTest extends TestCase {
    private PriceCalculator $calc;

    protected function setUp(): void {
        $this->calc = new PriceCalculator();
    }

    public function test_applies_discount_correctly(): void {
        $result = $this->calc->applyDiscount(100.0, 20);
        $this->assertEquals(80.0, $result);
    }

    public function test_throws_on_negative_discount(): void {
        $this->expectException(\InvalidArgumentException::class);
        $this->calc->applyDiscount(100.0, -5);
    }

    public function test_zero_discount_returns_original_price(): void {
        $result = $this->calc->applyDiscount(50.0, 0);
        $this->assertEquals(50.0, $result);
    }
}
```

**Characteristics:**
- Very fast (milliseconds each)
- No database, no network, no filesystem
- Highly focused — one failure = one clear cause
- Can run thousands of them in seconds

---

### Integration Tests

Test **multiple units working together** — real classes interacting with each other, sometimes with a real database or service.

```php
// Tests that UserRepository + real database work together correctly
class UserRepositoryTest extends TestCase {
    use RefreshDatabase; // resets DB before each test

    public function test_creates_and_retrieves_user(): void {
        $repo = new UserRepository(DB::connection());

        $id   = $repo->create('Alice', 'alice@example.com');
        $user = $repo->findById($id);

        $this->assertNotNull($user);
        $this->assertEquals('Alice', $user['name']);
        $this->assertEquals('alice@example.com', $user['email']);
    }

    public function test_returns_null_for_missing_user(): void {
        $repo   = new UserRepository(DB::connection());
        $result = $repo->findById(99999);
        $this->assertNull($result);
    }
}
```

**Characteristics:**
- Slower than unit tests (hits real DB/services)
- Catches issues at integration points — class A works alone, class B works alone, but do they work *together*?
- More realistic — closer to production behavior

---

### End-to-End (E2E) Tests

Test the **entire system from the user's perspective** — browser, HTTP requests, database, everything.

```javascript
// Playwright / Cypress example
test('user can register and log in', async ({ page }) => {
    await page.goto('/register');
    await page.fill('[name=name]', 'Alice');
    await page.fill('[name=email]', 'alice@example.com');
    await page.fill('[name=password]', 'secret123');
    await page.click('button[type=submit]');

    // Should redirect to dashboard after registration
    await expect(page).toHaveURL('/dashboard');
    await expect(page.locator('h1')).toContainText('Welcome, Alice');
});
```

**Characteristics:**
- Slowest — spins up browser, hits real backend, real DB
- Highest confidence — proves the whole flow works
- Brittle — a UI class rename can break the test
- Run fewer of these — only critical user journeys

---

## 2. The Test Pyramid

The test pyramid describes the **ideal balance of test types**:

```
        /\
       /  \
      / E2E \       ← Few (5-10): critical journeys only
     /--------\
    /Integration\   ← Some (20-30%): key integration points
   /--------------\
  /   Unit Tests   \ ← Many (60-70%): fast, isolated, lots of them
 /------------------\
```

**Why this shape?**

| Layer | Speed | Cost | Confidence | Quantity |
|---|---|---|---|---|
| Unit | Very fast | Cheap to write/run | Narrow | Many |
| Integration | Moderate | Medium | Broader | Some |
| E2E | Slow | Expensive (brittle, slow) | Full | Few |

**Anti-pattern — Ice cream cone:**
```
    /------\
   /  Unit  \     ← Very few unit tests
  /------------\
 / Integration  \  ← Some integration
/----------------\
/      E2E        \ ← Lots of slow, fragile E2E tests
```
This is slow, expensive to maintain, and fails constantly due to flakiness.

---

## 3. Mocking vs Stubbing

Both replace real dependencies in tests — but serve different purposes.

### Stub — Control What a Dependency Returns

A **stub** provides a canned (predetermined) response. You don't care how many times it's called or with what — you just need it to return something specific so your test can proceed.

```php
// Real email service — would actually send emails in tests. Bad!
class EmailService {
    public function send(string $to, string $subject): bool { /* SMTP call */ }
}

// Stub — just returns true, does nothing
class EmailServiceStub extends EmailService {
    public function send(string $to, string $subject): bool {
        return true; // always succeeds, no real email sent
    }
}

// Or using PHPUnit's createStub
$emailStub = $this->createStub(EmailService::class);
$emailStub->method('send')->willReturn(true);

// Now test your service without caring about email behavior
$userService = new UserService($emailStub);
$userService->register('alice@example.com');
```

### Mock — Verify Interactions

A **mock** also replaces a dependency AND **verifies it was called correctly** — the right method, the right number of times, with the right arguments.

```php
// Mock — verifies that email was ACTUALLY sent during registration
$emailMock = $this->createMock(EmailService::class);

$emailMock->expects($this->once())           // must be called exactly once
          ->method('send')
          ->with('alice@example.com', 'Welcome!') // with these exact arguments
          ->willReturn(true);

$userService = new UserService($emailMock);
$userService->register('alice@example.com');
// If send() wasn't called, or called twice, or with wrong args → TEST FAILS
```

### Stub vs Mock — Quick Reference

| | Stub | Mock |
|---|---|---|
| Purpose | Control return value | Verify interactions |
| Fails if not called? | No | Yes (if expected) |
| Use when | You need a dependency to return specific data | You need to verify a dependency WAS called |
| Example | Fake repository returning a hardcoded user | Verify email service was called on registration |

### Other Test Doubles

| Term | Description |
|---|---|
| **Dummy** | Passed as required argument but never used |
| **Fake** | Working simplified implementation (e.g., in-memory database) |
| **Spy** | Like a mock but records calls for later assertion |

---

## 4. What to Test and What Not to Test

### Test These

```php
// ✅ Business logic — the "what" of your domain
public function calculateTax(float $price, string $country): float { ... }

// ✅ Edge cases and boundaries
// Price = 0, negative price, maximum discount, empty cart

// ✅ Error paths — exceptions, validation failures
// Invalid email format, missing required field, out-of-stock

// ✅ Integration points — class A calling class B with correct data
// Repository receiving correct query from service

// ✅ Conditional branches — if/else outcomes
// Premium user gets 20% discount, regular gets 5%

// ✅ Transformations / algorithms
// Password hashing, data formatting, sorting logic
```

### Don't Test These

```php
// ❌ Trivial getters/setters — trust the language
public function getName(): string { return $this->name; } // nothing to test

// ❌ Framework internals — trust the framework
// Don't test that Laravel's DB::insert() works

// ❌ Private methods directly — test through public API
// If private method is complex enough to test, extract it to a class

// ❌ Third-party libraries — trust the library's own tests
// Don't test that Stripe SDK makes HTTP calls correctly

// ❌ Constructor assignment — trivial
public function __construct(private string $name) {} // nothing to test

// ❌ Configuration files — not code logic
```

**The right question:** "If this logic breaks, would a test catch it?" Focus on behavior that could break and matter to the user.

---

## 5. Testability in Design

Code that's easy to test is also well-designed. Testability is a natural by-product of good architecture.

### Dependency Injection Makes Testing Possible

```php
// UNTESTABLE — hard-codes the dependency
class OrderService {
    public function processOrder(int $orderId): void {
        $db     = new PDO('mysql:host=localhost;dbname=shop', 'root', '');
        $mailer = new SmtpMailer('smtp.gmail.com', 587);
        // How do you test this without a real DB and SMTP server?
    }
}

// TESTABLE — dependencies injected from outside
class OrderService {
    public function __construct(
        private OrderRepository $orders,
        private MailerInterface $mailer,
    ) {}

    public function processOrder(int $orderId): void {
        $order = $this->orders->findById($orderId); // can be mocked
        $this->mailer->send($order->email, 'Order confirmed'); // can be mocked
    }
}

// In test:
$mockRepo   = $this->createMock(OrderRepository::class);
$mockMailer = $this->createMock(MailerInterface::class);
$service    = new OrderService($mockRepo, $mockMailer);
// Now you can test processOrder() with full control
```

### Single Responsibility = Focused Tests

```php
// HARD TO TEST — does too many things
class UserManager {
    public function registerUser(array $data): void {
        // validates, saves, sends email, updates analytics, logs, sends Slack...
        // Which part failed? Unclear. How do you stub each dependency?
    }
}

// EASY TO TEST — each class has one job
class UserValidator  { public function validate(array $data): array { ... } }
class UserRepository { public function create(array $data): User { ... } }
class WelcomeMailer  { public function send(User $user): void { ... } }

// Each tested independently with minimal setup
```

### Avoid Static Calls and Global State

```php
// HARD TO TEST — can't inject a mock
class OrderService {
    public function getOrders(): array {
        return DB::table('orders')->get()->toArray(); // static call — untestable
    }
}

// EASY TO TEST — use interface + DI
class OrderService {
    public function __construct(private OrderRepositoryInterface $repo) {}

    public function getOrders(): array {
        return $this->repo->all(); // injectable — mockable
    }
}
```

---

## 6. Arrange-Act-Assert (AAA) Pattern

The standard structure for any test:

```php
public function test_discount_applied_correctly(): void {
    // ARRANGE — set up the state and dependencies
    $calculator = new PriceCalculator();
    $price      = 100.0;
    $discount   = 25;

    // ACT — do the thing you're testing
    $result = $calculator->applyDiscount($price, $discount);

    // ASSERT — verify the outcome
    $this->assertEquals(75.0, $result);
}
```

**Tips:**
- One logical assertion per test (not one `assertEquals` — one behavior)
- Test names should describe behavior: `test_throws_when_discount_is_negative`, not `test1`
- Keep each test independent — no shared state between tests

---

## Interview Q&A

**Q: What is the difference between unit and integration tests?**
A: Unit tests test a single unit of code in isolation — all dependencies replaced with mocks/stubs. They're fast and highly focused. Integration tests test multiple components working together, often hitting a real database or service. Unit tests tell you WHERE the problem is; integration tests tell you that the parts work TOGETHER.

**Q: What is the test pyramid?**
A: The test pyramid says you should have many unit tests (fast, cheap), fewer integration tests, and very few E2E tests (slow, expensive). The inverted pyramid (lots of E2E) leads to slow, flaky test suites that developers stop trusting and running.

**Q: What is the difference between a mock and a stub?**
A: A stub controls what a dependency returns — you set a canned response so your code can proceed. A mock does the same BUT also verifies the interaction — it asserts that the dependency was called with specific arguments a specific number of times. Use stubs when you don't care HOW the dependency is used; use mocks when verifying that behavior is critical.

**Q: What makes code testable?**
A: Dependency injection (dependencies come from outside, can be replaced with mocks), single responsibility (small classes with one job), avoiding global state and static calls, and programming to interfaces. Testability and good design go hand in hand — untestable code is usually poorly designed.

**Q: What should you NOT test?**
A: Trivial getters/setters, framework internals, third-party library behavior, simple constructor assignments, and configuration. Focus tests on business logic, edge cases, error paths, and integration points — things that could break and have a real impact.
