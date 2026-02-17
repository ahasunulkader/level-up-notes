# Practical Design Thinking in PHP

Knowing OOP theory is great, but **knowing when to use what** is what separates a junior from a mid-level developer. This section covers practical decisions you'll face daily.

---

## 1. Composition vs Inheritance

### What is Composition?

Composition means **building a class by combining smaller objects inside it** instead of inheriting from a parent class. The class doesn't DO the work itself — it **delegates** to the objects it holds.

> **Simple way to remember:** Inheritance = "I AM a ___" | Composition = "I HAVE a ___"

```
Inheritance:  Car extends Vehicle (Car IS-A Vehicle)
Composition:  Car has an Engine, has Wheels, has GPS (Car HAS these things)
```

### Real-World Example — Order Processing

Imagine building an order system. You need: payment, notification, and inventory management. Watch how composition makes this clean.

```php
// Step 1: Define small, focused classes (each does ONE thing)

class PaymentService
{
    public function charge(float $amount, string $method): bool
    {
        echo "Charged $$amount via $method\n";
        return true;
    }

    public function refund(float $amount): bool
    {
        echo "Refunded $$amount\n";
        return true;
    }
}

class NotificationService
{
    public function sendEmail(string $to, string $subject): void
    {
        echo "Email to $to: $subject\n";
    }

    public function sendSms(string $to, string $message): void
    {
        echo "SMS to $to: $message\n";
    }
}

class InventoryService
{
    public function reserve(int $productId, int $qty): bool
    {
        echo "Reserved $qty of product #$productId\n";
        return true;
    }

    public function release(int $productId, int $qty): void
    {
        echo "Released $qty of product #$productId\n";
    }
}
```

```php
// Step 2: COMPOSE them into OrderService (HAS-A relationship)

class OrderService
{
    // OrderService HAS a PaymentService
    // OrderService HAS a NotificationService
    // OrderService HAS an InventoryService
    public function __construct(
        private PaymentService $payment,
        private NotificationService $notification,
        private InventoryService $inventory
    ) {}

    public function placeOrder(array $order): bool
    {
        // Delegate to InventoryService
        $this->inventory->reserve($order['product_id'], $order['qty']);

        // Delegate to PaymentService
        $success = $this->payment->charge($order['total'], 'bkash');

        if (!$success) {
            $this->inventory->release($order['product_id'], $order['qty']);
            return false;
        }

        // Delegate to NotificationService
        $this->notification->sendEmail($order['email'], 'Order Confirmed!');
        $this->notification->sendSms($order['phone'], 'Your order is placed!');

        return true;
    }

    public function cancelOrder(array $order): void
    {
        $this->payment->refund($order['total']);
        $this->inventory->release($order['product_id'], $order['qty']);
        $this->notification->sendEmail($order['email'], 'Order Cancelled');
    }
}

// Usage
$orderService = new OrderService(
    new PaymentService(),
    new NotificationService(),
    new InventoryService()
);

$orderService->placeOrder([
    'product_id' => 1,
    'qty' => 2,
    'total' => 599.99,
    'email' => 'user@mail.com',
    'phone' => '01700000000',
]);
```

### Why This is Powerful

- **Each class is small and testable** — test PaymentService alone without the rest
- **Easy to swap** — replace `PaymentService` with `StripePaymentService` without touching OrderService
- **No inheritance chain** — no fragile parent-child hierarchy
- **Reusable** — `NotificationService` can be used by OrderService, UserService, ReportService, etc.
- **Laravel does this everywhere** — Controllers compose Services, Services compose Repositories

### How Inheritance Would Fail Here

```php
// BAD — Can't inherit from 3 classes!
class OrderService extends PaymentService, NotificationService, InventoryService
{
    // PHP Fatal Error: Class cannot extend multiple classes!
}

// BAD — Even with single inheritance, it makes no sense
class OrderService extends PaymentService
{
    // OrderService IS-A PaymentService? No! It just USES payment.
}
```

### The Rule: **Favor Composition Over Inheritance**

This is one of the most important design principles. Let's understand why with a direct comparison.

### Inheritance Approach (Fragile)

```php
class Logger
{
    public function log(string $message): void
    {
        echo "[LOG] $message\n";
    }
}

class UserService extends Logger
{
    public function createUser(string $name): void
    {
        // Business logic
        $this->log("User $name created"); // Inherited from Logger
    }
}

// Problem: UserService IS-A Logger? That makes no sense!
// Problem: What if UserService also needs to extend another class?
// Problem: Tightly coupled — can't swap logger implementation
```

### Composition Approach (Flexible)

```php
interface LoggerInterface
{
    public function log(string $message): void;
}

class FileLogger implements LoggerInterface
{
    public function log(string $message): void
    {
        file_put_contents('app.log', "[LOG] $message\n", FILE_APPEND);
    }
}

class ConsoleLogger implements LoggerInterface
{
    public function log(string $message): void
    {
        echo "[LOG] $message\n";
    }
}

class UserService
{
    public function __construct(
        private LoggerInterface $logger // Composition — HAS-A logger
    ) {}

    public function createUser(string $name): void
    {
        // Business logic
        $this->logger->log("User $name created");
    }
}

// Flexible — swap logger anytime
$service = new UserService(new FileLogger());
$service = new UserService(new ConsoleLogger());
```

### When to Use What

| Use Inheritance When... | Use Composition When... |
|---|---|
| True **"is-a"** relationship | **"has-a"** relationship |
| `Cat extends Animal` | `Car` has an `Engine` |
| Sharing **behavior + state** | Sharing **behavior only** |
| Few levels deep (max 2-3) | Any depth of nesting |
| You control the parent class | Using third-party classes |

### Key Interview Point

> **"Prefer composition over inheritance because it's more flexible, avoids tight coupling, and PHP doesn't support multiple inheritance."**

---

## 2. Favor Interfaces Over Implementations

### Bad — Depending on Concrete Class

```php
class OrderService
{
    private MySqlDatabase $db; // Tied to MySQL forever!

    public function __construct()
    {
        $this->db = new MySqlDatabase(); // Hard-coded dependency
    }

    public function getOrders(): array
    {
        return $this->db->query("SELECT * FROM orders");
    }
}

// Problems:
// - Can't switch to PostgreSQL without modifying this class
// - Can't mock database in tests
// - Violates Open/Closed Principle
```

### Good — Depending on Interface

```php
interface DatabaseInterface
{
    public function query(string $sql, array $params = []): array;
    public function insert(string $table, array $data): int;
    public function update(string $table, array $data, array $where): bool;
}

class MySqlDatabase implements DatabaseInterface
{
    public function query(string $sql, array $params = []): array
    {
        // MySQL-specific implementation
        return [];
    }

    public function insert(string $table, array $data): int
    {
        return 1;
    }

    public function update(string $table, array $data, array $where): bool
    {
        return true;
    }
}

class PostgresDatabase implements DatabaseInterface
{
    public function query(string $sql, array $params = []): array
    {
        // PostgreSQL-specific implementation
        return [];
    }

    public function insert(string $table, array $data): int
    {
        return 1;
    }

    public function update(string $table, array $data, array $where): bool
    {
        return true;
    }
}

class OrderService
{
    public function __construct(
        private DatabaseInterface $db // Depends on interface!
    ) {}

    public function getOrders(): array
    {
        return $this->db->query("SELECT * FROM orders");
    }
}

// Now we can swap implementations freely
$service = new OrderService(new MySqlDatabase());
$service = new OrderService(new PostgresDatabase());
```

### Benefits

- **Swappable** — change implementation without touching business logic
- **Testable** — mock the interface in unit tests
- **Decoupled** — classes don't know about each other's internals
- **Laravel uses this everywhere** — Service Container binds interfaces to implementations

```php
// Laravel example
$this->app->bind(DatabaseInterface::class, MySqlDatabase::class);
```

---

## 3. When OOP Breaks Down

OOP isn't always the answer. Know when it **adds unnecessary complexity**.

### Scenario 1: Simple Scripts

```php
// DON'T create a class for a simple script
// Bad — over-engineered
class CsvImporter
{
    private string $filePath;
    private array $data;

    public function __construct(string $filePath)
    {
        $this->filePath = $filePath;
    }

    public function read(): self
    {
        $this->data = array_map('str_getcsv', file($this->filePath));
        return $this;
    }

    public function getData(): array
    {
        return $this->data;
    }
}

$importer = new CsvImporter('data.csv');
$data = $importer->read()->getData();

// Good — just a function
function importCsv(string $filePath): array
{
    return array_map('str_getcsv', file($filePath));
}

$data = importCsv('data.csv');
```

### Scenario 2: Over-Abstraction

```php
// Bad — abstraction for the sake of abstraction
interface StringFormatterInterface
{
    public function format(string $input): string;
}

class UpperCaseFormatter implements StringFormatterInterface
{
    public function format(string $input): string
    {
        return strtoupper($input);
    }
}

// Good — just use the function
$result = strtoupper($input);
```

### Scenario 3: Anemic Domain Models

```php
// Bad — class with only getters/setters (no behavior)
class User
{
    private string $name;
    private string $email;

    public function getName(): string { return $this->name; }
    public function setName(string $name): void { $this->name = $name; }
    public function getEmail(): string { return $this->email; }
    public function setEmail(string $email): void { $this->email = $email; }
}
// This is just a glorified array! Use a simple array or DTO instead.

// Good — class with actual behavior
class User
{
    public function __construct(
        private string $name,
        private string $email,
        private bool $isVerified = false
    ) {}

    public function verify(): void
    {
        if ($this->isVerified) {
            throw new RuntimeException("User already verified");
        }
        $this->isVerified = true;
    }

    public function changeEmail(string $newEmail): void
    {
        if (!filter_var($newEmail, FILTER_VALIDATE_EMAIL)) {
            throw new InvalidArgumentException("Invalid email");
        }
        $this->email = $newEmail;
        $this->isVerified = false; // Require re-verification
    }
}
```

### When to Use OOP vs Procedural

| Use OOP | Use Procedural/Functional |
|---|---|
| Complex business logic | Simple scripts & utilities |
| Multiple related operations | One-off data transformations |
| State management needed | Stateless operations |
| Code reuse across project | Single-use logic |
| Team collaboration | Solo quick scripts |

---

## 4. Designing for Change

Good code is **easy to change**. Here's how to design for it.

### Principle: Isolate What Changes

```php
// Bad — change notification method = change this entire class
class OrderProcessor
{
    public function process(Order $order): void
    {
        // Process order...

        // Notification is hard-coded
        mail($order->email, "Order Confirmed", "Your order #{$order->id}");
    }
}

// Good — notification is pluggable
interface OrderNotifier
{
    public function notify(Order $order): void;
}

class EmailOrderNotifier implements OrderNotifier
{
    public function notify(Order $order): void
    {
        mail($order->email, "Order Confirmed", "Your order #{$order->id}");
    }
}

class SmsOrderNotifier implements OrderNotifier
{
    public function notify(Order $order): void
    {
        // Send SMS
    }
}

class OrderProcessor
{
    public function __construct(
        private OrderNotifier $notifier
    ) {}

    public function process(Order $order): void
    {
        // Process order...
        $this->notifier->notify($order); // Pluggable!
    }
}
```

### Principle: Use PHP Traits for Cross-Cutting Concerns

```php
trait HasTimestamps
{
    private ?DateTime $createdAt = null;
    private ?DateTime $updatedAt = null;

    public function setCreatedAt(): void
    {
        $this->createdAt = new DateTime();
    }

    public function setUpdatedAt(): void
    {
        $this->updatedAt = new DateTime();
    }

    public function getCreatedAt(): ?DateTime
    {
        return $this->createdAt;
    }
}

trait SoftDeletes
{
    private ?DateTime $deletedAt = null;

    public function softDelete(): void
    {
        $this->deletedAt = new DateTime();
    }

    public function isDeleted(): bool
    {
        return $this->deletedAt !== null;
    }

    public function restore(): void
    {
        $this->deletedAt = null;
    }
}

class Post
{
    use HasTimestamps, SoftDeletes; // Compose behaviors!

    public function __construct(
        private string $title,
        private string $content
    ) {
        $this->setCreatedAt();
    }
}

$post = new Post("Hello", "World");
$post->softDelete();
echo $post->isDeleted(); // true
$post->restore();
echo $post->isDeleted(); // false
```

### Principle: Depend on Stable Things

```php
// Stability ranking (most stable → least stable):
// 1. PHP language features (array, string, etc.)
// 2. Interfaces you define
// 3. Abstract classes
// 4. Concrete classes
// 5. Third-party library classes (can change anytime!)

// Bad — depends on unstable third-party class directly
class ReportGenerator
{
    public function generate(): string
    {
        $dompdf = new \Dompdf\Dompdf(); // Direct dependency
        // ...
    }
}

// Good — wrap unstable dependency behind your own interface
interface PdfGeneratorInterface
{
    public function generateFromHtml(string $html): string;
}

class DompdfGenerator implements PdfGeneratorInterface
{
    public function generateFromHtml(string $html): string
    {
        $dompdf = new \Dompdf\Dompdf();
        $dompdf->loadHtml($html);
        $dompdf->render();
        return $dompdf->output();
    }
}

class ReportGenerator
{
    public function __construct(
        private PdfGeneratorInterface $pdfGenerator // Stable dependency!
    ) {}
}
```

---

## Common Interview Questions

1. **When would you use composition over inheritance?**
   → When there's a "has-a" relationship, when you need flexibility to swap behaviors, or when you'd need multiple inheritance.

2. **Why favor interfaces over implementations?**
   → Loose coupling, easy testing with mocks, ability to swap implementations without changing business logic.

3. **When does OOP add unnecessary complexity?**
   → Simple scripts, one-off operations, data-only classes with no behavior, when a plain function would suffice.

4. **What are PHP Traits? When to use them?**
   → Traits are a mechanism for code reuse in single inheritance. Use for cross-cutting concerns like timestamps, soft deletes, or logging that multiple unrelated classes need.

5. **How do you design code that's easy to change?**
   → Isolate what varies behind interfaces, use dependency injection, depend on abstractions not concretions, and keep classes small with single responsibilities.
