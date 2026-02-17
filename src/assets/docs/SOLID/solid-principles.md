# SOLID Principles in PHP

SOLID is a set of 5 design principles that help you write **clean, maintainable, and scalable** code. Every senior developer is expected to know these.

> **Interview Tip:** Be ready to explain each principle with a real-world PHP/Laravel example.

---

## S — Single Responsibility Principle (SRP)

> **A class should have only ONE reason to change.**

Each class should do ONE thing and do it well. If a class handles multiple responsibilities, a change in one can break the other.

### Bad Example — Multiple Responsibilities

```php
class UserManager
{
    // Responsibility 1: User CRUD
    public function createUser(string $name, string $email): int
    {
        // Insert into database
        $userId = DB::table('users')->insertGetId([
            'name' => $name,
            'email' => $email,
        ]);

        // Responsibility 2: Send email (WHY is this here?)
        mail($email, "Welcome!", "Hello $name, welcome aboard!");

        // Responsibility 3: Log activity (WHY is this here?)
        file_put_contents('log.txt', "User $name created\n", FILE_APPEND);

        return $userId;
    }
}

// Problems:
// - Need to change email template? Modify UserManager.
// - Need to change logging? Modify UserManager.
// - Can't reuse email logic elsewhere
// - Hard to test — creating user also sends email!
```

### Good Example — Single Responsibility Each

```php
class UserRepository
{
    public function create(string $name, string $email): int
    {
        return DB::table('users')->insertGetId([
            'name' => $name,
            'email' => $email,
        ]);
    }

    public function findById(int $id): ?array
    {
        return DB::table('users')->find($id);
    }
}

class WelcomeEmailService
{
    public function send(string $email, string $name): void
    {
        mail($email, "Welcome!", "Hello $name, welcome aboard!");
    }
}

class ActivityLogger
{
    public function log(string $message): void
    {
        file_put_contents('log.txt', "[" . date('Y-m-d H:i:s') . "] $message\n", FILE_APPEND);
    }
}

// Orchestrator — coordinates the services
class UserRegistrationService
{
    public function __construct(
        private UserRepository $userRepo,
        private WelcomeEmailService $emailService,
        private ActivityLogger $logger
    ) {}

    public function register(string $name, string $email): int
    {
        $userId = $this->userRepo->create($name, $email);
        $this->emailService->send($email, $name);
        $this->logger->log("User $name registered");
        return $userId;
    }
}
```

### How to Spot SRP Violations

- Class has methods that don't relate to each other
- Class name includes "And" or "Manager" or "Handler" (too vague)
- You change the class for different reasons
- The class has too many dependencies (injected services)

---

## O — Open/Closed Principle (OCP)

> **Open for extension, closed for modification.**

You should be able to add new behavior **without changing existing code**.

### Bad Example — Modifying Existing Code

```php
class DiscountCalculator
{
    public function calculate(string $customerType, float $amount): float
    {
        // Every new customer type = modify this method!
        if ($customerType === 'regular') {
            return $amount * 0.05;
        } elseif ($customerType === 'premium') {
            return $amount * 0.10;
        } elseif ($customerType === 'vip') {
            return $amount * 0.20;
        }
        // New type? Must modify this class!
        // What if we break existing logic?
        return 0;
    }
}
```

### Good Example — Extend Without Modifying

```php
interface DiscountStrategy
{
    public function calculate(float $amount): float;
    public function supports(string $customerType): bool;
}

class RegularDiscount implements DiscountStrategy
{
    public function calculate(float $amount): float
    {
        return $amount * 0.05;
    }

    public function supports(string $customerType): bool
    {
        return $customerType === 'regular';
    }
}

class PremiumDiscount implements DiscountStrategy
{
    public function calculate(float $amount): float
    {
        return $amount * 0.10;
    }

    public function supports(string $customerType): bool
    {
        return $customerType === 'premium';
    }
}

class VipDiscount implements DiscountStrategy
{
    public function calculate(float $amount): float
    {
        return $amount * 0.20;
    }

    public function supports(string $customerType): bool
    {
        return $customerType === 'vip';
    }
}

class DiscountCalculator
{
    /** @var DiscountStrategy[] */
    private array $strategies;

    public function __construct(DiscountStrategy ...$strategies)
    {
        $this->strategies = $strategies;
    }

    public function calculate(string $customerType, float $amount): float
    {
        foreach ($this->strategies as $strategy) {
            if ($strategy->supports($customerType)) {
                return $strategy->calculate($amount);
            }
        }
        return 0;
    }
}

// Adding new discount = just create a new class!
// No existing code modified!
class StudentDiscount implements DiscountStrategy
{
    public function calculate(float $amount): float
    {
        return $amount * 0.15;
    }

    public function supports(string $customerType): bool
    {
        return $customerType === 'student';
    }
}

$calculator = new DiscountCalculator(
    new RegularDiscount(),
    new PremiumDiscount(),
    new VipDiscount(),
    new StudentDiscount(), // Just add it here!
);
```

### Laravel Example

```php
// Laravel's Middleware is a perfect OCP example
// Add new behavior without changing existing code
// Just create a new middleware class!

class CheckAge
{
    public function handle(Request $request, Closure $next): Response
    {
        if ($request->age < 18) {
            return redirect('home');
        }
        return $next($request);
    }
}
// Register in Kernel — no existing code modified
```

---

## L — Liskov Substitution Principle (LSP)

> **Child classes should be usable wherever parent classes are expected, without breaking behavior.**

If `B extends A`, then you should be able to replace `A` with `B` without anything breaking.

### Bad Example — Breaks Parent's Contract

```php
class Bird
{
    public function fly(): string
    {
        return "Flying high!";
    }
}

class Penguin extends Bird
{
    public function fly(): string
    {
        // VIOLATION! Penguins can't fly, but parent says they can!
        throw new RuntimeException("Penguins can't fly!");
    }
}

// This breaks LSP:
function makeBirdFly(Bird $bird): void
{
    echo $bird->fly(); // Crashes if Penguin is passed!
}

makeBirdFly(new Bird());    // Works
makeBirdFly(new Penguin()); // EXCEPTION!
```

### Good Example — Proper Hierarchy

```php
interface Bird
{
    public function move(): string;
    public function eat(): string;
}

interface FlyingBird extends Bird
{
    public function fly(): string;
}

class Eagle implements FlyingBird
{
    public function move(): string
    {
        return "Soaring through the sky";
    }

    public function fly(): string
    {
        return "Flying high!";
    }

    public function eat(): string
    {
        return "Eating fish";
    }
}

class Penguin implements Bird
{
    public function move(): string
    {
        return "Waddling on ice"; // Penguin moves differently
    }

    public function eat(): string
    {
        return "Eating fish";
    }
    // No fly() method — penguins don't fly!
}

// Both work correctly with their respective interfaces
function feedBird(Bird $bird): void
{
    echo $bird->eat(); // Works for ALL birds
}

function makeFly(FlyingBird $bird): void
{
    echo $bird->fly(); // Only works for flying birds — type safe!
}
```

### Real-World PHP Example

```php
interface FileStorage
{
    public function store(string $path, string $content): bool;
    public function retrieve(string $path): ?string;
    public function delete(string $path): bool;
}

class LocalFileStorage implements FileStorage
{
    public function store(string $path, string $content): bool
    {
        return file_put_contents($path, $content) !== false;
    }

    public function retrieve(string $path): ?string
    {
        return file_exists($path) ? file_get_contents($path) : null;
    }

    public function delete(string $path): bool
    {
        return file_exists($path) && unlink($path);
    }
}

class S3FileStorage implements FileStorage
{
    public function store(string $path, string $content): bool
    {
        // Upload to S3 — same contract, different implementation
        return true;
    }

    public function retrieve(string $path): ?string
    {
        // Download from S3
        return "content";
    }

    public function delete(string $path): bool
    {
        // Delete from S3
        return true;
    }
}

// Both can be swapped freely — LSP satisfied!
function backupFile(FileStorage $storage, string $path): void
{
    $content = $storage->retrieve($path);
    if ($content) {
        $storage->store("backup/$path", $content);
    }
}
```

### LSP Rules to Follow

- **Don't throw unexpected exceptions** in child class
- **Don't add preconditions** (require MORE than parent)
- **Don't weaken postconditions** (return LESS than parent)
- If parent returns `array`, child shouldn't return `null`

---

## I — Interface Segregation Principle (ISP)

> **Don't force classes to implement methods they don't need.**

Many small, specific interfaces are better than one large, fat interface.

### Bad Example — Fat Interface

```php
interface WorkerInterface
{
    public function work(): void;
    public function eat(): void;
    public function sleep(): void;
    public function attendMeeting(): void;
    public function writeReport(): void;
}

class Developer implements WorkerInterface
{
    public function work(): void { echo "Coding...\n"; }
    public function eat(): void { echo "Eating...\n"; }
    public function sleep(): void { echo "Sleeping...\n"; }
    public function attendMeeting(): void { echo "In meeting...\n"; }
    public function writeReport(): void { echo "Writing report...\n"; }
}

class Robot implements WorkerInterface
{
    public function work(): void { echo "Working...\n"; }

    // Robots don't eat, sleep, attend meetings, or write reports!
    public function eat(): void { /* USELESS */ }
    public function sleep(): void { /* USELESS */ }
    public function attendMeeting(): void { /* USELESS */ }
    public function writeReport(): void { /* USELESS */ }
}
```

### Good Example — Segregated Interfaces

```php
interface Workable
{
    public function work(): void;
}

interface Feedable
{
    public function eat(): void;
}

interface Sleepable
{
    public function sleep(): void;
}

interface Reportable
{
    public function writeReport(): void;
    public function attendMeeting(): void;
}

class Developer implements Workable, Feedable, Sleepable, Reportable
{
    public function work(): void { echo "Coding...\n"; }
    public function eat(): void { echo "Eating lunch...\n"; }
    public function sleep(): void { echo "Sleeping 6 hours...\n"; }
    public function writeReport(): void { echo "Writing sprint report...\n"; }
    public function attendMeeting(): void { echo "In standup...\n"; }
}

class Robot implements Workable
{
    public function work(): void { echo "Assembling parts...\n"; }
    // Only implements what it actually needs!
}
```

### Laravel Example — Repository Interfaces

```php
// Bad — one huge interface
interface RepositoryInterface
{
    public function find(int $id): ?Model;
    public function findAll(): Collection;
    public function create(array $data): Model;
    public function update(int $id, array $data): bool;
    public function delete(int $id): bool;
    public function paginate(int $perPage): LengthAwarePaginator;
    public function search(string $query): Collection;
    public function export(): string;
}

// Good — segregated interfaces
interface ReadableRepository
{
    public function find(int $id): ?Model;
    public function findAll(): Collection;
}

interface WritableRepository
{
    public function create(array $data): Model;
    public function update(int $id, array $data): bool;
    public function delete(int $id): bool;
}

interface SearchableRepository
{
    public function search(string $query): Collection;
}

// Compose only what you need
class ProductRepository implements ReadableRepository, WritableRepository, SearchableRepository
{
    // Implements all — makes sense for products
}

class AuditLogRepository implements ReadableRepository
{
    // Read-only — audit logs shouldn't be modified!
}
```

---

## D — Dependency Inversion Principle (DIP)

> **High-level modules should NOT depend on low-level modules. Both should depend on abstractions.**

### Bad Example — High-Level Depends on Low-Level

```php
// Low-level module
class MySqlConnection
{
    public function connect(): void { /* MySQL connection */ }
    public function query(string $sql): array { return []; }
}

// High-level module — DIRECTLY depends on MySQL!
class UserRepository
{
    private MySqlConnection $db;

    public function __construct()
    {
        $this->db = new MySqlConnection(); // Hard dependency!
    }

    public function getAll(): array
    {
        return $this->db->query("SELECT * FROM users");
    }
}

// Problems:
// - Can't switch to PostgreSQL
// - Can't test without real MySQL
// - High-level policy depends on low-level detail
```

### Good Example — Both Depend on Abstraction

```php
// Abstraction (interface)
interface DatabaseConnection
{
    public function connect(): void;
    public function query(string $sql, array $params = []): array;
}

// Low-level module — depends on abstraction
class MySqlConnection implements DatabaseConnection
{
    public function connect(): void
    {
        // MySQL-specific connection
    }

    public function query(string $sql, array $params = []): array
    {
        // MySQL-specific query
        return [];
    }
}

class PostgresConnection implements DatabaseConnection
{
    public function connect(): void
    {
        // PostgreSQL-specific connection
    }

    public function query(string $sql, array $params = []): array
    {
        // PostgreSQL-specific query
        return [];
    }
}

// High-level module — depends on abstraction (interface)
class UserRepository
{
    public function __construct(
        private DatabaseConnection $db // Depends on interface!
    ) {}

    public function getAll(): array
    {
        return $this->db->query("SELECT * FROM users");
    }
}

// Dependency Injection — decide at runtime
$repo = new UserRepository(new MySqlConnection());
$repo = new UserRepository(new PostgresConnection());
```

### Laravel Service Container — DIP in Action

```php
// In AppServiceProvider
public function register(): void
{
    // Bind abstraction to implementation
    $this->app->bind(
        DatabaseConnection::class,  // Interface (abstraction)
        MySqlConnection::class       // Implementation (concrete)
    );

    // Now Laravel auto-injects the right implementation
    // When any class asks for DatabaseConnection, it gets MySqlConnection
}

// In controller — just type-hint the interface
class UserController extends Controller
{
    public function __construct(
        private DatabaseConnection $db // Laravel auto-injects!
    ) {}
}
```

### Complete Real-World Example

```php
// Abstraction
interface PaymentProcessor
{
    public function charge(float $amount, string $currency): PaymentResult;
    public function refund(string $transactionId): bool;
}

class PaymentResult
{
    public function __construct(
        public readonly bool $success,
        public readonly string $transactionId,
        public readonly string $message
    ) {}
}

// Implementation 1
class StripeProcessor implements PaymentProcessor
{
    public function charge(float $amount, string $currency): PaymentResult
    {
        // Stripe API call
        return new PaymentResult(true, 'stripe_txn_123', 'Payment successful');
    }

    public function refund(string $transactionId): bool
    {
        // Stripe refund API
        return true;
    }
}

// Implementation 2
class BkashProcessor implements PaymentProcessor
{
    public function charge(float $amount, string $currency): PaymentResult
    {
        // Bkash API call
        return new PaymentResult(true, 'bkash_txn_456', 'Payment successful');
    }

    public function refund(string $transactionId): bool
    {
        // Bkash refund API
        return true;
    }
}

// High-level — doesn't care which processor
class CheckoutService
{
    public function __construct(
        private PaymentProcessor $processor
    ) {}

    public function checkout(Cart $cart): PaymentResult
    {
        $total = $cart->getTotal();
        return $this->processor->charge($total, 'BDT');
    }
}
```

---

## SOLID Cheat Sheet

| Principle | One-Line Summary | Violation Sign |
|---|---|---|
| **S** — Single Responsibility | One class, one job | Class changes for multiple reasons |
| **O** — Open/Closed | Add features without editing code | `if/else` chains for new types |
| **L** — Liskov Substitution | Child works wherever parent works | Child throws unexpected exceptions |
| **I** — Interface Segregation | Small focused interfaces | Empty/dummy method implementations |
| **D** — Dependency Inversion | Depend on interfaces, not classes | `new ClassName()` inside another class |

---

## Common Interview Questions

1. **Explain SOLID with examples.**
   → Use the examples above — keep them short and practical.

2. **Which principle is most important?**
   → All are important, but **SRP** and **DIP** have the most practical impact. SRP keeps code focused, DIP makes it testable.

3. **How does Laravel use SOLID?**
   → Service Container (DIP), Middleware (OCP), Contracts/Interfaces (ISP + DIP), Single-purpose classes like Form Requests, Jobs, Events (SRP).

4. **What's the difference between DI and DIP?**
   → **DI (Dependency Injection)** is a technique — passing dependencies in. **DIP (Dependency Inversion)** is a principle — depend on abstractions. DI is HOW you achieve DIP.

5. **Give a real violation of LSP.**
   → `ReadOnlyCollection extends Collection` that throws exception on `add()` — breaks the parent's contract.
