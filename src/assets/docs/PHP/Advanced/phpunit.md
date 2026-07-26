# PHPUnit — PHP Unit Testing

## TL;DR
**PHPUnit** is the standard testing framework for PHP. It lets you write automated tests that verify your code works correctly — and keeps working as you change it. Tests are classes that extend `TestCase`, methods start with `test`, and you make assertions about expected vs actual output. Run them from the terminal with `./vendor/bin/phpunit`.

---

## Why Unit Testing?

- **Catch bugs early** — before they reach production
- **Refactor confidently** — change code without fear of breaking things silently
- **Document behavior** — tests are executable documentation of what code does
- **Faster feedback** — run 1000 tests in seconds vs clicking through the app manually

---

## a. Installation

```bash
# Install PHPUnit via Composer (dev dependency)
composer require --dev phpunit/phpunit

# Verify installation
./vendor/bin/phpunit --version
# PHPUnit 11.x by Sebastian Bergmann

# Or install globally
composer global require phpunit/phpunit
phpunit --version
```

### phpunit.xml (Configuration File)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<phpunit xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:noNamespaceSchemaLocation="vendor/phpunit/phpunit/phpunit.xsd"
         bootstrap="vendor/autoload.php"
         colors="true"
         stopOnFailure="false">

    <testsuites>
        <testsuite name="Unit">
            <directory>tests/Unit</directory>
        </testsuite>
        <testsuite name="Feature">
            <directory>tests/Feature</directory>
        </testsuite>
    </testsuites>

    <coverage>
        <include>
            <directory suffix=".php">src</directory>
        </include>
    </coverage>

    <php>
        <env name="APP_ENV" value="testing"/>
        <env name="DB_DATABASE" value=":memory:"/>
    </php>
</phpunit>
```

### Project Structure

```
my-project/
├── src/
│   └── Calculator.php
├── tests/
│   ├── Unit/
│   │   └── CalculatorTest.php
│   └── Feature/
│       └── OrderCheckoutTest.php
├── composer.json
└── phpunit.xml
```

---

## b. Writing Unit Tests

### Basic Test Structure

```php
<?php
// src/Calculator.php
class Calculator {
    public function add(float $a, float $b): float      { return $a + $b; }
    public function divide(float $a, float $b): float {
        if ($b === 0.0) throw new \DivisionByZeroError('Cannot divide by zero');
        return $a / $b;
    }
    public function isEven(int $n): bool { return $n % 2 === 0; }
}
```

```php
<?php
// tests/Unit/CalculatorTest.php
use PHPUnit\Framework\TestCase;

class CalculatorTest extends TestCase {
    private Calculator $calc;

    // runs before EACH test method
    protected function setUp(): void {
        $this->calc = new Calculator();
    }

    // test method — must start with "test" OR use @test annotation
    public function test_add_two_positive_numbers(): void {
        $result = $this->calc->add(2, 3);
        $this->assertEquals(5, $result);
    }

    public function test_add_negative_numbers(): void {
        $this->assertEquals(-1, $this->calc->add(-3, 2));
    }

    public function test_divide_returns_correct_result(): void {
        $this->assertEquals(2.5, $this->calc->divide(5, 2));
    }

    public function test_divide_by_zero_throws_exception(): void {
        $this->expectException(\DivisionByZeroError::class);
        $this->expectExceptionMessage('Cannot divide by zero');
        $this->calc->divide(10, 0);
    }

    public function test_even_number_returns_true(): void {
        $this->assertTrue($this->calc->isEven(4));
    }

    public function test_odd_number_returns_false(): void {
        $this->assertFalse($this->calc->isEven(7));
    }
}
```

### Common Assertions

```php
// Equality
$this->assertEquals(5, $result);           // loose equality (==)
$this->assertSame(5, $result);             // strict equality (===)
$this->assertNotEquals(6, $result);
$this->assertNotSame('5', 5);              // different type

// Boolean
$this->assertTrue($value);
$this->assertFalse($value);

// Null
$this->assertNull($value);
$this->assertNotNull($value);

// Strings
$this->assertStringContainsString('hello', 'hello world');
$this->assertStringStartsWith('http', $url);
$this->assertStringEndsWith('.php', $filename);
$this->assertMatchesRegularExpression('/^\d{4}$/', $year);

// Arrays
$this->assertCount(3, $array);
$this->assertContains('apple', $fruits);
$this->assertArrayHasKey('name', $user);
$this->assertEmpty([]);
$this->assertNotEmpty([1, 2, 3]);

// Objects
$this->assertInstanceOf(User::class, $obj);

// Exceptions
$this->expectException(InvalidArgumentException::class);
$this->expectExceptionMessage('must be positive');
$this->expectExceptionCode(404);

// Numbers
$this->assertGreaterThan(0, $price);
$this->assertLessThan(100, $discount);
$this->assertEqualsWithDelta(3.14, $pi, 0.01); // float precision
```

---

## c. Command Line Tests

```bash
# Run all tests
./vendor/bin/phpunit

# Run specific test file
./vendor/bin/phpunit tests/Unit/CalculatorTest.php

# Run specific test method
./vendor/bin/phpunit --filter test_add_two_positive_numbers

# Run a test suite (from phpunit.xml)
./vendor/bin/phpunit --testsuite Unit
./vendor/bin/phpunit --testsuite Feature

# Run with verbose output (shows each test name)
./vendor/bin/phpunit --verbose

# Stop on first failure
./vendor/bin/phpunit --stop-on-failure

# Generate coverage report (HTML)
./vendor/bin/phpunit --coverage-html reports/coverage

# Generate coverage report (text)
./vendor/bin/phpunit --coverage-text

# Run tests in parallel (PHPUnit 10+)
./vendor/bin/phpunit --process-isolation

# List all available tests without running
./vendor/bin/phpunit --list-tests
```

### Output

```
PHPUnit 11.0 by Sebastian Bergmann

......F.E.                                     10 / 10 (100%)

. = passed
F = failed
E = error (exception thrown)
S = skipped
I = incomplete

Time: 00:00.042, Memory: 8.00 MB

FAILURES!
Tests: 10, Assertions: 18, Failures: 1, Errors: 1.
```

---

## d. Organizing Tests

### Folder Structure Best Practice

```
tests/
├── Unit/                  ← Fast, isolated, no DB/network
│   ├── Services/
│   │   ├── PriceCalculatorTest.php
│   │   └── DiscountServiceTest.php
│   ├── Models/
│   │   └── UserTest.php
│   └── Repositories/
│       └── OrderRepositoryTest.php
├── Feature/               ← Integration tests, may hit DB
│   ├── CheckoutTest.php
│   └── AuthTest.php
└── TestCase.php           ← Base test class with helpers
```

### Base Test Class

```php
<?php
// tests/TestCase.php
namespace Tests;

use PHPUnit\Framework\TestCase as BaseTestCase;

abstract class TestCase extends BaseTestCase {
    protected function createUser(array $overrides = []): array {
        return array_merge([
            'id'    => 1,
            'name'  => 'Alice',
            'email' => 'alice@example.com',
            'role'  => 'user',
        ], $overrides);
    }
}
```

### Grouping Tests with Attributes (PHPUnit 10+)

```php
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\TestDox;

#[Group('payment')]
class PaymentTest extends TestCase {

    #[TestDox('Applies 20% discount for premium users')]
    public function test_premium_discount(): void { ... }

    #[Group('slow')]
    public function test_payment_gateway_integration(): void { ... }
}
```

```bash
# Run only the "payment" group
./vendor/bin/phpunit --group payment

# Exclude slow tests
./vendor/bin/phpunit --exclude-group slow
```

---

## e. Fixtures

Fixtures are setup/teardown methods that prepare state for tests.

```php
class DatabaseTest extends TestCase {

    private PDO $pdo;

    // Runs once before ALL tests in this class
    public static function setUpBeforeClass(): void {
        // expensive setup — create schema
    }

    // Runs before EACH test
    protected function setUp(): void {
        $this->pdo = new PDO('sqlite::memory:');
        $this->pdo->exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)');
        $this->seedDatabase();
    }

    private function seedDatabase(): void {
        $this->pdo->exec("INSERT INTO users VALUES (1, 'Alice', 'alice@example.com')");
        $this->pdo->exec("INSERT INTO users VALUES (2, 'Bob',   'bob@example.com')");
    }

    // Runs after EACH test
    protected function tearDown(): void {
        $this->pdo->exec('DROP TABLE IF EXISTS users');
        unset($this->pdo);
    }

    // Runs once after ALL tests in this class
    public static function tearDownAfterClass(): void {
        // cleanup expensive shared resources
    }

    public function test_find_user_by_id(): void {
        $stmt = $this->pdo->query('SELECT * FROM users WHERE id = 1');
        $user = $stmt->fetch(PDO::FETCH_ASSOC);
        $this->assertEquals('Alice', $user['name']);
    }
}
```

### Data Providers (Parameterized Tests)

```php
use PHPUnit\Framework\Attributes\DataProvider;

class ValidatorTest extends TestCase {

    // Data provider — returns array of [input, expected]
    public static function validEmailProvider(): array {
        return [
            'simple email'      => ['alice@example.com', true],
            'subdomain email'   => ['alice@mail.example.com', true],
            'missing @'         => ['aliceexample.com', false],
            'missing domain'    => ['alice@', false],
            'empty string'      => ['', false],
        ];
    }

    #[DataProvider('validEmailProvider')]
    public function test_email_validation(string $email, bool $expected): void {
        $validator = new EmailValidator();
        $this->assertSame($expected, $validator->isValid($email));
    }
}

// PHPUnit runs this test 5 times — once per data set
```

---

## f. Test Doubles (Mocks and Stubs)

### Stub — Control Return Values

```php
interface UserRepository {
    public function findById(int $id): ?User;
    public function save(User $user): void;
}

class UserServiceTest extends TestCase {
    public function test_get_user_returns_null_when_not_found(): void {
        // Stub — returns controlled value
        $stub = $this->createStub(UserRepository::class);
        $stub->method('findById')->willReturn(null);

        $service = new UserService($stub);
        $result  = $service->getUser(999);

        $this->assertNull($result);
    }

    public function test_get_user_returns_user_when_found(): void {
        $user = new User(1, 'Alice');

        $stub = $this->createStub(UserRepository::class);
        $stub->method('findById')->willReturn($user);

        $service = new UserService($stub);
        $this->assertSame($user, $service->getUser(1));
    }
}
```

### Mock — Verify Interactions

```php
class OrderServiceTest extends TestCase {
    public function test_places_order_and_sends_confirmation_email(): void {
        $orderRepo = $this->createStub(OrderRepository::class);
        $orderRepo->method('save')->willReturn(true);

        // Mock — verifies that email IS sent exactly once with correct args
        $mailer = $this->createMock(MailerInterface::class);
        $mailer->expects($this->once())
               ->method('send')
               ->with(
                   $this->equalTo('alice@example.com'),
                   $this->stringContains('Order Confirmed')
               );

        $service = new OrderService($orderRepo, $mailer);
        $service->placeOrder(['email' => 'alice@example.com', 'total' => 99.99]);
    }

    public function test_does_not_send_email_on_failed_order(): void {
        $orderRepo = $this->createStub(OrderRepository::class);
        $orderRepo->method('save')->willReturn(false); // save fails

        $mailer = $this->createMock(MailerInterface::class);
        $mailer->expects($this->never()) // email must NOT be sent
               ->method('send');

        $service = new OrderService($orderRepo, $mailer);
        $service->placeOrder(['email' => 'alice@example.com', 'total' => 99.99]);
    }
}
```

### Return Value Sequences

```php
$stub->method('fetchNext')
     ->willReturnOnConsecutiveCalls('first', 'second', 'third');

$stub->method('getStatus')
     ->willReturnCallback(fn($id) => $id > 100 ? 'active' : 'inactive');

$stub->method('riskyOperation')
     ->willThrowException(new \RuntimeException('Service unavailable'));
```

---

## g. Code Coverage

Code coverage measures what percentage of your source code is executed by tests.

```bash
# Requires Xdebug or PCOV extension

# Text coverage report
./vendor/bin/phpunit --coverage-text

# HTML report (open reports/coverage/index.html in browser)
./vendor/bin/phpunit --coverage-html reports/coverage

# Clover XML (for CI tools like Codecov, SonarQube)
./vendor/bin/phpunit --coverage-clover coverage.xml

# Enforce minimum coverage (fails build if below 80%)
./vendor/bin/phpunit --coverage-text --coverage-min 80
```

### Coverage in phpunit.xml

```xml
<coverage>
    <include>
        <directory suffix=".php">src</directory>
    </include>
    <exclude>
        <directory>src/Migrations</directory>
    </exclude>
    <report>
        <html outputDirectory="reports/coverage"/>
        <clover outputFile="coverage.xml"/>
        <text outputFile="php://stdout"/>
    </report>
</coverage>
```

### Coverage Attributes

```php
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\CoversMethod;

#[CoversClass(Calculator::class)]
class CalculatorTest extends TestCase {
    #[CoversMethod(Calculator::class, 'add')]
    public function test_add(): void { ... }
}
```

---

## h. Error Handling in Tests

```php
class ErrorHandlingTest extends TestCase {

    // Test that specific exception is thrown
    public function test_throws_exception_for_negative_price(): void {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Price must be positive');
        $this->expectExceptionCode(422);

        new Product('Laptop', -999);
    }

    // Test exception type hierarchy
    public function test_custom_exception_extends_runtime(): void {
        $this->expectException(\RuntimeException::class); // accepts child types too
        throw new DatabaseException('Connection failed');
    }

    // Expect NO exception — sometimes useful to document intent
    public function test_valid_price_does_not_throw(): void {
        $this->expectNotToPerformAssertions();
        // if an exception IS thrown, test fails
        new Product('Laptop', 999);
    }

    // Test exception in closure
    public function test_division_by_zero(): void {
        try {
            $this->calc->divide(10, 0);
            $this->fail('Expected DivisionByZeroError was not thrown');
        } catch (\DivisionByZeroError $e) {
            $this->assertEquals('Cannot divide by zero', $e->getMessage());
        }
    }
}
```

---

## i. Extending PHPUnit

### Custom Assertions

```php
// tests/Assertions/CurrencyAssertions.php
trait CurrencyAssertions {
    public function assertIsValidCurrency(string $currency): void {
        $valid = ['USD', 'EUR', 'SGD', 'MYR'];
        $this->assertContains(
            $currency,
            $valid,
            "Expected valid currency, got: $currency"
        );
    }

    public function assertPriceEquals(float $expected, float $actual, float $delta = 0.01): void {
        $this->assertEqualsWithDelta($expected, $actual, $delta,
            "Expected price $expected, got $actual (delta: $delta)"
        );
    }
}

// Usage in test
class PriceTest extends TestCase {
    use CurrencyAssertions;

    public function test_currency_is_valid(): void {
        $this->assertIsValidCurrency('SGD');
    }
}
```

### Custom Test Listener / Extension

```php
// tests/SlowTestDetector.php
use PHPUnit\Framework\TestListener;
use PHPUnit\Framework\TestListenerDefaultImplementation;
use PHPUnit\Framework\Test;

class SlowTestDetector implements TestListener {
    use TestListenerDefaultImplementation;

    private const SLOW_THRESHOLD_MS = 100;

    public function endTest(Test $test, float $time): void {
        $ms = $time * 1000;
        if ($ms > self::SLOW_THRESHOLD_MS) {
            printf("\n⚠ SLOW TEST (%.0fms): %s\n", $ms, $test->getName());
        }
    }
}
```

```xml
<!-- phpunit.xml -->
<extensions>
    <bootstrap class="Tests\SlowTestDetector"/>
</extensions>
```

---

## Interview Q&A

**Q: What is the difference between setUp() and setUpBeforeClass()?**
A: `setUp()` runs before EACH test method — it creates a fresh state for every test, preventing tests from affecting each other. `setUpBeforeClass()` runs once before ALL tests in the class — used for expensive, shared setup (e.g., creating a database schema). Use `setUp()` by default; only use `setUpBeforeClass()` when setup is too slow to repeat.

**Q: What is a data provider in PHPUnit?**
A: A data provider is a static method that returns an array of argument sets. PHPUnit runs the test method once for each set. It's used for parameterized testing — testing the same logic with multiple inputs without duplicating test methods.

**Q: What is the difference between createMock() and createStub()?**
A: `createStub()` creates a test double that returns null/default values by default — you configure it to return specific values (`willReturn()`). `createMock()` creates a test double that also tracks interactions — you can assert it was called with specific arguments (`expects($this->once())`). Use stubs when you only need controlled return values; use mocks when you need to verify behavior.

**Q: What is code coverage and what percentage should you aim for?**
A: Code coverage measures what percentage of your source code is exercised by tests. 100% coverage doesn't mean bug-free (logic can be wrong but still executed). Aim for 80%+ on business logic and critical paths. Don't chase 100% — trivial getters, framework glue, and config don't need tests. Focus coverage on code where bugs would cause real damage.
