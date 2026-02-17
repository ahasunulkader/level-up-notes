# Practical Design Thinking in PHP

Knowing OOP theory is great, but **knowing when to use what** is what separates a junior from a mid-level developer. This section covers practical decisions you'll face daily.

---

## 1. Composition vs Inheritance

### The Rule: **Favor Composition Over Inheritance**

This is one of the most important design principles. Let's understand why.

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
