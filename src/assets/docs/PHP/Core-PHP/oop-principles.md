# Principles of OOP — Abstraction, Encapsulation, Inheritance, Interfaces & Polymorphism

## TL;DR
The 4 pillars of OOP are: **Encapsulation** (hide internals), **Inheritance** (reuse via parent-child), **Abstraction** (define contracts via abstract classes/interfaces), **Polymorphism** (same interface, different behavior). In PHP, abstraction is achieved with `abstract` classes and `interface` — they serve different purposes. Prefer composition over deep inheritance.

---

## 1. Encapsulation

**Hide internal state. Expose only what callers need.**

Encapsulation means wrapping data (properties) and the methods that operate on it inside a class, and controlling access via visibility modifiers.

```php
class BankAccount {
    private float  $balance;    // hidden — callers can't directly set this
    private array  $transactions = [];

    public function __construct(float $initialBalance) {
        if ($initialBalance < 0) {
            throw new \InvalidArgumentException('Balance cannot be negative');
        }
        $this->balance = $initialBalance;
    }

    // Controlled access — only valid operations exposed
    public function deposit(float $amount): void {
        if ($amount <= 0) throw new \InvalidArgumentException('Amount must be positive');
        $this->balance += $amount;
        $this->transactions[] = ['type' => 'deposit', 'amount' => $amount];
    }

    public function withdraw(float $amount): void {
        if ($amount > $this->balance) throw new \RuntimeException('Insufficient funds');
        $this->balance -= $amount;
        $this->transactions[] = ['type' => 'withdrawal', 'amount' => $amount];
    }

    public function getBalance(): float {
        return $this->balance; // read-only access
    }
}

$account = new BankAccount(1000);
$account->deposit(500);
$account->withdraw(200);
echo $account->getBalance(); // 1300

// $account->balance = -99999; // Error: private — impossible
```

**Why it matters:** Without encapsulation, any code anywhere can put the object in an invalid state (`$account->balance = -1000`). Encapsulation makes it impossible to violate business rules.

**Benefits:** Internal implementation can change without breaking callers. Bugs are localized — if balance is wrong, only the class itself could have set it.

---

## 2. Inheritance

**A child class inherits properties and methods from a parent class, and can extend or override them.**

```php
class Animal {
    public function __construct(protected string $name) {}

    public function eat(): void {
        echo "{$this->name} is eating\n";
    }

    public function describe(): string {
        return "I am {$this->name}";
    }
}

class Dog extends Animal {
    // Inherited: eat(), describe(), $name

    // Add new behavior
    public function fetch(): void {
        echo "{$this->name} fetches the ball!\n";
    }

    // Override parent behavior
    public function describe(): string {
        return parent::describe() . ', a dog'; // call parent version first
    }
}

class Cat extends Animal {
    public function describe(): string {
        return parent::describe() . ', a cat';
    }

    public function purr(): void {
        echo "{$this->name} purrs...\n";
    }
}

$dog = new Dog('Rex');
$dog->eat();       // Rex is eating (inherited)
$dog->fetch();     // Rex fetches the ball!
echo $dog->describe(); // I am Rex, a dog

$cat = new Cat('Whiskers');
$cat->eat();       // Whiskers is eating (inherited)
$cat->purr();
echo $cat->describe(); // I am Whiskers, a cat
```

### `parent::` — Calling the Parent Method

```php
class AdminUser extends User {
    public function __construct(string $name, private string $adminLevel) {
        parent::__construct($name); // must call parent constructor
    }

    public function getPermissions(): array {
        $base = parent::getPermissions(); // get parent's permissions
        return array_merge($base, ['delete', 'ban', 'manage_roles']); // add admin ones
    }
}
```

### `final` — Prevent Override or Inheritance

```php
class PaymentGateway {
    final public function charge(float $amount): void {
        // This method cannot be overridden — it's the core algorithm
        $this->validateAmount($amount);
        $this->processPayment($amount);
        $this->logTransaction($amount);
    }

    protected function processPayment(float $amount): void { /* subclass can customize this */ }
}

final class Singleton {
    // This class cannot be extended
}
```

**Pros of inheritance:**
- Reuse code without duplication
- Extend framework base classes (Laravel's `Model`, `Controller`)
- Override specific behavior while keeping the rest

**Cons of inheritance:**
- Deep hierarchies become fragile — change at top breaks everything below
- Creates tight coupling between parent and child
- "Diamond problem" — PHP doesn't support multiple inheritance (use Traits instead)
- Prefer **composition over inheritance** for flexibility

---

## 3. Abstract Classes

An abstract class is a **class that cannot be instantiated directly** — it's meant to be extended. It defines a contract (abstract methods) that subclasses must implement.

```php
abstract class Shape {
    // Abstract method — no body, subclass MUST implement it
    abstract public function area(): float;
    abstract public function perimeter(): float;

    // Concrete method — available to all subclasses
    public function describe(): string {
        return sprintf(
            '%s: area=%.2f, perimeter=%.2f',
            static::class,
            $this->area(),
            $this->perimeter()
        );
    }
}

class Circle extends Shape {
    public function __construct(private float $radius) {}

    public function area(): float {
        return M_PI * $this->radius ** 2;
    }

    public function perimeter(): float {
        return 2 * M_PI * $this->radius;
    }
}

class Rectangle extends Shape {
    public function __construct(
        private float $width,
        private float $height,
    ) {}

    public function area(): float {
        return $this->width * $this->height;
    }

    public function perimeter(): float {
        return 2 * ($this->width + $this->height);
    }
}

// $shape = new Shape(); // Error: Cannot instantiate abstract class

$circle = new Circle(5);
echo $circle->describe(); // Circle: area=78.54, perimeter=31.42

$rect = new Rectangle(4, 6);
echo $rect->describe();   // Rectangle: area=24.00, perimeter=20.00
```

**When to use abstract classes:**
- When you have **shared implementation** that all subclasses use (concrete methods)
- When you want to enforce a contract AND provide a partial default implementation
- Template Method Pattern — define the algorithm skeleton in the abstract class, let subclasses fill in specific steps

---

## 4. Interfaces

An interface defines a **pure contract** — a list of method signatures with no implementation. A class that implements an interface promises to provide all those methods.

```php
interface Payable {
    public function pay(float $amount): bool;
    public function refund(float $amount): bool;
    public function getTransactionId(): string;
}

interface Notifiable {
    public function notify(string $message): void;
}

// A class can implement MULTIPLE interfaces
class StripePayment implements Payable, Notifiable {
    private string $transactionId = '';

    public function pay(float $amount): bool {
        // call Stripe API
        $this->transactionId = 'stripe_' . uniqid();
        return true;
    }

    public function refund(float $amount): bool {
        // call Stripe refund API
        return true;
    }

    public function getTransactionId(): string {
        return $this->transactionId;
    }

    public function notify(string $message): void {
        // send email/SMS
    }
}

class PayPalPayment implements Payable {
    private string $transactionId = '';

    public function pay(float $amount): bool {
        $this->transactionId = 'paypal_' . uniqid();
        return true;
    }

    public function refund(float $amount): bool { return true; }
    public function getTransactionId(): string { return $this->transactionId; }
}

// Type-hint the INTERFACE, not the concrete class — accept any implementation
function processOrder(Payable $payment, float $total): void {
    if ($payment->pay($total)) {
        echo "Paid! Transaction: " . $payment->getTransactionId();
    }
}

processOrder(new StripePayment(), 99.99);
processOrder(new PayPalPayment(), 99.99); // works with any Payable
```

### Interface Inheritance

```php
interface ReadableStorage {
    public function get(string $key): mixed;
}

interface WritableStorage extends ReadableStorage {
    public function set(string $key, mixed $value): void;
    public function delete(string $key): void;
}

class RedisStorage implements WritableStorage {
    public function get(string $key): mixed { /* ... */ }
    public function set(string $key, mixed $value): void { /* ... */ }
    public function delete(string $key): void { /* ... */ }
}
```

---

## 5. Abstract Class vs Interface

This is one of the most common interview questions.

| | Abstract Class | Interface |
|---|---|---|
| Instantiate directly | No | No |
| Implementation | Can have concrete methods | PHP 8+ can have default methods |
| Properties | Can have properties | Cannot have properties (only constants) |
| Constructor | Can have one | Cannot |
| Inheritance | Single only (`extends`) | Multiple (`implements A, B, C`) |
| Access modifiers | Any | All methods are implicitly `public` |
| Use when | Shared implementation + contract | Pure contract, multiple implementations |
| "Is-a" relationship | Strong (Dog is-a Animal) | Capability (Dog can-be Trainable) |

```php
// Abstract class = "is-a" relationship with shared code
abstract class Vehicle {
    protected int $speed = 0;

    public function accelerate(int $amount): void { // shared implementation
        $this->speed += $amount;
    }

    abstract public function fuelType(): string; // contract
}

// Interface = "can-do" capability
interface Serializable {
    public function serialize(): string;
    public function unserialize(string $data): void;
}

interface Loggable {
    public function toLog(): array;
}

// A class can extend ONE abstract class but implement MANY interfaces
class ElectricCar extends Vehicle implements Serializable, Loggable {
    public function fuelType(): string { return 'Electric'; }
    public function serialize(): string { return json_encode(['speed' => $this->speed]); }
    public function unserialize(string $data): void { /* ... */ }
    public function toLog(): array { return ['speed' => $this->speed]; }
}
```

---

## 6. Polymorphism

**The same interface can be used to call different behavior depending on the actual object.**

"Poly" = many, "morph" = form. Same method call → different result based on object type.

```php
// All shapes implement the same interface
interface Drawable {
    public function draw(): string;
    public function area(): float;
}

class Circle implements Drawable {
    public function __construct(private float $radius) {}
    public function draw(): string { return "Drawing a circle with radius {$this->radius}"; }
    public function area(): float  { return M_PI * $this->radius ** 2; }
}

class Square implements Drawable {
    public function __construct(private float $side) {}
    public function draw(): string { return "Drawing a square with side {$this->side}"; }
    public function area(): float  { return $this->side ** 2; }
}

class Triangle implements Drawable {
    public function __construct(
        private float $base,
        private float $height,
    ) {}
    public function draw(): string { return "Drawing a triangle"; }
    public function area(): float  { return 0.5 * $this->base * $this->height; }
}

// Polymorphic function — works with ANY Drawable without knowing the concrete type
function renderAll(array $shapes): void {
    foreach ($shapes as $shape) {
        echo $shape->draw() . "\n";   // same call, different behavior
        echo "Area: " . $shape->area() . "\n";
    }
}

$shapes = [
    new Circle(5),
    new Square(4),
    new Triangle(6, 3),
];

renderAll($shapes); // works for all — no if/switch on type
```

**Without polymorphism (bad):**
```php
function renderAll(array $shapes): void {
    foreach ($shapes as $shape) {
        if ($shape instanceof Circle) {
            echo "Drawing circle...";
        } elseif ($shape instanceof Square) {
            echo "Drawing square...";
        }
        // Every new shape type requires editing this function — violation of Open/Closed Principle
    }
}
```

**With polymorphism (good):** Add a new `Pentagon` class — `renderAll` works with it automatically. No edits needed.

### Method Overriding = Runtime Polymorphism

```php
class Logger {
    public function log(string $message): void {
        echo "[LOG] {$message}\n";
    }
}

class FileLogger extends Logger {
    public function log(string $message): void {
        file_put_contents('app.log', "[LOG] {$message}\n", FILE_APPEND);
    }
}

class SlackLogger extends Logger {
    public function log(string $message): void {
        // send to Slack API
    }
}

// Type-hint the parent — works with any subclass
function doSomething(Logger $logger): void {
    $logger->log("Something happened"); // calls the right log() at runtime
}

doSomething(new Logger());      // prints to stdout
doSomething(new FileLogger());  // writes to file
doSomething(new SlackLogger()); // sends to Slack
```

---

## Interview Q&A

**Q: What are the 4 pillars of OOP?**
A: Encapsulation (hide internal state, expose controlled interface), Inheritance (child class reuses parent's code and can extend/override it), Abstraction (define contracts via abstract classes and interfaces, hide complexity), Polymorphism (same interface, different behavior depending on the actual object type).

**Q: What is the difference between an abstract class and an interface?**
A: Abstract classes can have concrete methods, properties, and a constructor — they're for when classes share implementation AND need a contract. Interfaces are pure contracts — method signatures only, no implementation, and a class can implement multiple interfaces. Use abstract when you have shared code; use interfaces for capabilities that many unrelated classes might share.

**Q: What is the difference between method overriding and method overloading?**
A: Method overriding (PHP supports this) — a subclass provides its own implementation of a method defined in the parent. Method overloading (PHP does NOT support in the traditional sense) — same method name, different parameter counts/types, multiple definitions. PHP's `__call` can simulate overloading.

**Q: What is polymorphism and why is it useful?**
A: Polymorphism lets you write code that works with the interface, not the concrete class. You can add new classes without modifying existing code that uses them (Open/Closed Principle). It eliminates long `if instanceof` chains by routing behavior through the object itself.

**Q: What does `parent::` do?**
A: It calls the parent class's version of a method. Commonly used in overridden methods to run the parent's logic before adding extra behavior, and in constructors to call `parent::__construct()` to initialize the parent's properties.

**Q: Why is deep inheritance considered bad?**
A: Deep inheritance chains (A → B → C → D → E) create tight coupling. A change at the top breaks everything below. Subclasses must understand all parent behavior, which grows increasingly complex. The alternative is composition — instead of extending, inject the behavior you need as a dependency. "Favour composition over inheritance" is a core OOP design principle.
