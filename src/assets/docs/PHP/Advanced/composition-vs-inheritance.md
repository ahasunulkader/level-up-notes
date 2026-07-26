# Composition vs Inheritance in PHP

## TL;DR
**Inheritance** models an "is-a" relationship — a `Dog` *is an* `Animal`. **Composition** models a "has-a" relationship — a `Car` *has an* `Engine`. The famous rule is **"Favor composition over inheritance"** — inheritance creates tight coupling and fragile hierarchies; composition keeps things flexible and independently testable. Use inheritance when the "is-a" relationship is genuinely true and stable. Use composition when you want to assemble behavior from interchangeable parts.

---

## The Problem Inheritance Creates

Inheritance feels natural at first — but it breaks down quickly in the real world.

```php
// Seems fine initially...
class Animal {
    public function eat(): void   { echo "eating\n"; }
    public function sleep(): void { echo "sleeping\n"; }
}

class Dog extends Animal {
    public function bark(): void { echo "woof\n"; }
}

class Cat extends Animal {
    public function meow(): void { echo "meow\n"; }
}

// Problem: now we need a RobotDog
class RobotDog extends Dog {
    // RobotDog doesn't eat or sleep — but inherits those methods anyway
    // We're forced to override and do nothing, or throw exceptions
    public function eat(): void  { throw new \Exception("Robots don't eat!"); }
    public function sleep(): void { /* do nothing */ }
}
```

**Issues:**
- **Gorilla-banana problem** — you wanted the banana (bark), but got the gorilla (Animal) and the entire jungle (all inherited state and behavior) too
- **Fragile base class** — changing `Animal` breaks `Dog`, `Cat`, `RobotDog` unpredictably
- **Cannot reuse selectively** — you inherit ALL of the parent, not just what you need
- **Deep hierarchies** — `Vehicle → MotorVehicle → Car → ElectricCar → TeslaModel3` becomes unmaintainable

---

## Inheritance — When It IS Right

Inheritance is appropriate when:
1. The "is-a" relationship is genuinely true **in all contexts**
2. The child really does extend (not replace or contradict) the parent
3. The hierarchy is shallow (1–2 levels)
4. The parent is an **abstract** concept, not a concrete implementation

```php
// Good inheritance — Exception hierarchy
class DatabaseException extends \RuntimeException {}
class ConnectionException extends DatabaseException {}
class QueryException extends DatabaseException {}

// Good — shape hierarchy with shared abstract behavior
abstract class Shape {
    abstract public function area(): float;
    abstract public function perimeter(): float;

    public function describe(): string {
        return sprintf('%s: area=%.2f, perimeter=%.2f',
            static::class, $this->area(), $this->perimeter());
    }
}

class Circle extends Shape {
    public function __construct(private float $radius) {}
    public function area(): float      { return M_PI * $this->radius ** 2; }
    public function perimeter(): float { return 2 * M_PI * $this->radius; }
}

class Rectangle extends Shape {
    public function __construct(private float $w, private float $h) {}
    public function area(): float      { return $this->w * $this->h; }
    public function perimeter(): float { return 2 * ($this->w + $this->h); }
}
```

---

## Composition — How It Works

Instead of inheriting behavior, you **inject behavior as dependencies**:

```php
// Behaviors as separate, injectable interfaces
interface CanEat {
    public function eat(): void;
}

interface CanSleep {
    public function sleep(): void;
}

interface CanBark {
    public function bark(): void;
}

// Concrete implementations
class NormalEating implements CanEat {
    public function eat(): void { echo "Om nom nom\n"; }
}

class NormalSleeping implements CanSleep {
    public function sleep(): void { echo "Zzz...\n"; }
}

class DogBark implements CanBark {
    public function bark(): void { echo "Woof!\n"; }
}

// No-op implementations for robots
class NoEating implements CanEat {
    public function eat(): void { /* robots don't eat */ }
}

// Dog composed of behaviors
class Dog {
    public function __construct(
        private CanEat   $eating,
        private CanSleep $sleeping,
        private CanBark  $barking,
    ) {}

    public function eat(): void  { $this->eating->eat(); }
    public function sleep(): void { $this->sleeping->sleep(); }
    public function bark(): void  { $this->barking->bark(); }
}

// RobotDog — same structure, different behaviors
class RobotDog {
    public function __construct(
        private CanEat  $eating,  // inject NoEating — no runtime exceptions
        private CanBark $barking,
    ) {}

    public function eat(): void  { $this->eating->eat(); }
    public function bark(): void { $this->barking->bark(); }
}

// Wire up
$dog      = new Dog(new NormalEating(), new NormalSleeping(), new DogBark());
$robotDog = new RobotDog(new NoEating(), new DogBark());

$dog->bark();      // Woof!
$robotDog->bark(); // Woof!
$dog->eat();       // Om nom nom
$robotDog->eat();  // (nothing — clean, no exception)
```

---

## Real-World Example: Logger System

### With Inheritance (Fragile)

```php
class Logger {
    public function log(string $message): void {
        file_put_contents('app.log', $message . PHP_EOL, FILE_APPEND);
    }
}

class DatabaseLogger extends Logger {
    public function log(string $message): void {
        // Can't easily add database logging + keep file logging
        // Must duplicate or call parent — tight coupling
        parent::log($message);
        DB::insert('logs', ['message' => $message]);
    }
}

// What if we need email + file + database? The hierarchy explodes:
// FileLogger, DatabaseLogger, EmailLogger
// FileDatabaseLogger, FileEmailLogger, DatabaseEmailLogger
// FileDatabaseEmailLogger...
```

### With Composition (Flexible)

```php
interface LogHandler {
    public function handle(string $level, string $message): void;
}

class FileLogHandler implements LogHandler {
    public function handle(string $level, string $message): void {
        file_put_contents('app.log', "[$level] $message\n", FILE_APPEND);
    }
}

class DatabaseLogHandler implements LogHandler {
    public function handle(string $level, string $message): void {
        DB::insert('logs', ['level' => $level, 'message' => $message]);
    }
}

class EmailLogHandler implements LogHandler {
    public function __construct(private string $alertEmail) {}
    public function handle(string $level, string $message): void {
        if ($level === 'critical') {
            mail($this->alertEmail, "Alert: $level", $message);
        }
    }
}

// Logger is composed of multiple handlers
class Logger {
    /** @param LogHandler[] $handlers */
    public function __construct(private array $handlers = []) {}

    public function addHandler(LogHandler $handler): void {
        $this->handlers[] = $handler;
    }

    public function log(string $level, string $message): void {
        foreach ($this->handlers as $handler) {
            $handler->handle($level, $message);
        }
    }
}

// Compose freely — no new classes needed
$logger = new Logger([
    new FileLogHandler(),
    new DatabaseLogHandler(),
    new EmailLogHandler('admin@example.com'),
]);

$logger->log('info',     'User logged in');
$logger->log('critical', 'Database down!'); // triggers email too
```

---

## Composition with Traits (PHP's middle ground)

PHP Traits let you share behavior across classes without inheritance:

```php
trait Timestampable {
    private ?DateTime $createdAt = null;
    private ?DateTime $updatedAt = null;

    public function setCreatedAt(): void { $this->createdAt = new DateTime(); }
    public function setUpdatedAt(): void { $this->updatedAt = new DateTime(); }
    public function getCreatedAt(): ?DateTime { return $this->createdAt; }
    public function getUpdatedAt(): ?DateTime { return $this->updatedAt; }
}

trait SoftDeletable {
    private ?DateTime $deletedAt = null;

    public function softDelete(): void { $this->deletedAt = new DateTime(); }
    public function isDeleted(): bool  { return $this->deletedAt !== null; }
    public function restore(): void    { $this->deletedAt = null; }
}

class User {
    use Timestampable, SoftDeletable;
    public function __construct(public string $name) {}
}

class Post {
    use Timestampable, SoftDeletable;
    public function __construct(public string $title) {}
}

$user = new User('Alice');
$user->setCreatedAt();
$user->softDelete();
echo $user->isDeleted() ? 'deleted' : 'active'; // deleted
```

**Note:** Traits are a form of "mixin" composition — better than inheritance for reuse, but still have limitations (no DI, harder to test/mock).

---

## Side-by-Side Comparison

| | Inheritance | Composition |
|---|---|---|
| Relationship | "is-a" | "has-a" |
| Coupling | Tight (child depends on parent internals) | Loose (depends on interface) |
| Reuse | All-or-nothing | Pick and choose |
| Flexibility | Low — can't change at runtime | High — swap implementations |
| Testability | Hard — can't mock parent | Easy — inject mocks |
| Hierarchy depth | Gets deep and tangled | Stays flat |
| Violates LSP? | Easy to accidentally do so | Naturally avoids it |
| Appropriate when | Genuine "is-a", stable, shallow | Most other cases |

---

## When to Use Each

**Use Inheritance when:**
- Clear, stable "is-a" relationship (`Dog is an Animal`)
- Child genuinely extends (not replaces) parent behavior
- Hierarchy stays shallow (max 2 levels deep)
- Working with framework base classes (`Controller`, `Model`, `Exception`)

**Use Composition when:**
- "has-a" or "uses-a" relationship
- You need to share behavior across unrelated classes
- Behavior should be swappable at runtime
- You want to avoid the god-class problem
- You need easy unit testing (inject mocks)
- You're unsure — composition is the safer default

---

## Interview Q&A

**Q: What does "Favor composition over inheritance" mean?**
A: It's a design principle saying you should prefer building classes from injected dependencies (composition) rather than extending parent classes (inheritance). Inheritance creates tight coupling — changing the parent breaks children unpredictably. Composition lets you swap behaviors independently, test pieces in isolation, and combine them freely without deep hierarchies.

**Q: When IS inheritance appropriate?**
A: When there's a genuine, stable "is-a" relationship — `Circle is a Shape`, `DatabaseException is a RuntimeException`. The key tests: does the child truly extend (not contradict) the parent? Would the Liskov Substitution Principle hold? Is the hierarchy shallow? If yes to all, inheritance is fine. For cross-cutting behaviors (logging, timestamps, soft-delete), use Traits or interfaces with composition.

**Q: What is the gorilla-banana problem?**
A: A metaphor for the inheritance problem — you wanted the banana (a small behavior), but you had to take the gorilla (the parent class) and the entire jungle (all the parent's dependencies, state, and behavior) with it. Inheritance bundles everything; you can't inherit selectively.

**Q: How do PHP Traits relate to composition?**
A: Traits are a form of horizontal code reuse — similar to mixins. They let you share method implementations across unrelated classes without inheritance. They're better than deep inheritance for cross-cutting concerns but don't support dependency injection (you can't inject a Trait). For fully testable, swappable behavior, use interface + composition with DI. Traits are a pragmatic middle ground.
