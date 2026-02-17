# Core OOP Concepts in PHP

Object-Oriented Programming (OOP) is a way of organizing code around **objects** — bundles of data and behavior that model real-world things.

> **Interview Tip:** Interviewers love asking "Explain the 4 pillars of OOP." Know them cold with PHP examples.

---

## 1. Encapsulation

Encapsulation means **hiding internal details** and exposing only what's necessary through public methods.

Think of it like a **TV remote** — you press buttons (public methods), but you don't see the circuit board inside (private properties).

### Why It Matters

- **Protects data** from accidental modification
- **Controls access** — you decide who can read/write
- **Easier to change** internals without breaking other code

### PHP Example

```php
class BankAccount
{
    private float $balance = 0; // Hidden from outside

    public function deposit(float $amount): void
    {
        if ($amount <= 0) {
            throw new InvalidArgumentException("Amount must be positive");
        }
        $this->balance += $amount;
    }

    public function withdraw(float $amount): void
    {
        if ($amount > $this->balance) {
            throw new RuntimeException("Insufficient funds");
        }
        $this->balance -= $amount;
    }

    public function getBalance(): float
    {
        return $this->balance; // Read-only access
    }
}

$account = new BankAccount();
$account->deposit(1000);
$account->withdraw(200);
echo $account->getBalance(); // 800

// $account->balance = -999; // ERROR! Can't access private property
```

### Key Points for Interview

- **private** — accessible only within the class
- **protected** — accessible within the class and child classes
- **public** — accessible from anywhere
- Always use **getters/setters** instead of public properties
- Encapsulation is NOT just about making things private — it's about **controlling access**

---

## 2. Abstraction

Abstraction means **showing only essential features** and hiding the complex implementation details.

Think of it like **driving a car** — you use the steering wheel and pedals (interface), but you don't need to understand the engine (implementation).

### Why It Matters

- **Simplifies usage** — users of your class don't need to know HOW it works
- **Reduces complexity** — focus on WHAT something does, not HOW
- **Easier to maintain** — change internals without affecting users

### PHP Example with Abstract Class
- An abstract class is a class that contains at least one abstract method. An abstract method is a method that is declared, but not implemented in the abstract class. The implementation must be done in the child class(es).
- An abstract class or method is defined with the `abstract` keyword.

When a child class is inherited from an abstract class, we have the following rules:

- The child class method must be defined with the same name and it redeclares the parent abstract method
- The child class method must be defined with the same or a less restricted access modifier. So, if the abstract method is defined as protected, the child class method must be defined as either protected or public, but not private.
- The number of required arguments must be the same. However, the child class may have optional arguments in addition

```php
abstract class PaymentGateway
{
    // Abstract method — MUST be implemented by child classes
    abstract protected function processPayment(float $amount): bool;
    abstract protected function getGatewayName(): string;

    // Concrete method — shared logic
    public function pay(float $amount): string
    {
        if ($amount <= 0) {
            return "Invalid amount";
        }

        $success = $this->processPayment($amount);

        return $success
            ? "Payment of $$amount via {$this->getGatewayName()} successful"
            : "Payment failed";
    }
}

class StripePayment extends PaymentGateway
{
    // Parent's abtract method defined as protected but in clild defined with the same (protected) or a less (public) restricted access modifier
    public function processPayment(float $amount, string $optinalArgument = ".."): bool
    {
        // Complex Stripe API logic hidden here
        // Connect to Stripe, create charge, handle response...
        $optionalArg = $optinalArgument;
        return true;
    }

    protected function getGatewayName(): string
    {
        return "Stripe";
    }
}

class PayPalPayment extends PaymentGateway
{
    protected function processPayment(float $amount): bool
    {
        // Complex PayPal API logic hidden here
        return true;
    }

    protected function getGatewayName(): string
    {
        return "PayPal";
    }
}

// Usage — caller doesn't care about internal details
$payment = new StripePayment();
echo $payment->pay(99.99); // "Payment of $99.99 via Stripe successful"
```

### PHP Example with Interface

An Interface lets you define which public methods a class MUST implement, without defining how they should be implemented.

Interfaces are declared with the interface keyword, and the methods declared in an interface must be <span style="color:red">public</span>

```php
interface CacheDriver
{
    public function get(string $key): mixed;
    public function set(string $key, mixed $value, int $ttl = 3600): bool;
    public function delete(string $key): bool;
}

class RedisCache implements CacheDriver
{
    public function get(string $key): mixed
    {
        // Redis-specific logic
        return null;
    }

    public function set(string $key, mixed $value, int $ttl = 3600): bool
    {
        // Redis-specific logic
        return true;
    }

    public function delete(string $key): bool
    {
        // Redis-specific logic
        return true;
    }
}
```

### Abstract vs Interface

| Feature | Interface | Abstract Class |
|---------|-----------|----------------|
| Properties | Cannot have properties | Can have properties |
| Method Visibility | All methods must be `public` | Methods can be `public` or `protected` |
| Method Implementation | All methods are abstract and cannot have implementation; `abstract` keyword not necessary | Can have abstract methods and also fully implemented methods |
| Inheritance/Implementation | Classes can implement an interface while inheriting from another class | Classes can only extend one abstract class |

 > Interfaces make it easy to use a variety of different classes in the same way. When one or more classes use the same interface, it is referred to as "polymorphism". 

### Abstraction vs Encapsulation — Interview Question!

| Abstraction | Encapsulation |
|---|---|
| Hides **complexity** | Hides **data** |
| Focus on **what** an object does | Focus on **how** it protects data |
| Achieved via abstract classes/interfaces | Achieved via access modifiers (private/protected) |
| Design level concept | Implementation level concept |

---

## 3. Inheritance

Inheritance allows a class to **reuse properties and methods** from a parent class.

Think of it like **family traits** — a child inherits features from parents but can also have unique ones.

### Why It Matters

- **Code reuse** — don't repeat yourself (DRY)
- **Establishes "is-a" relationship** — a Cat IS an Animal
- **Polymorphic behavior** — treat child objects as parent type

### PHP Example

```php
class User
{
    public function __construct(
        protected string $name,
        protected string $email
    ) {}

    public function getInfo(): string
    {
        return "{$this->name} ({$this->email})";
    }

    public function getRole(): string
    {
        return "user";
    }
}

class Admin extends User
{
    private array $permissions;

    public function __construct(string $name, string $email, array $permissions)
    {
        parent::__construct($name, $email); // Call parent constructor
        $this->permissions = $permissions;
    }

    // Override parent method
    public function getRole(): string
    {
        return "admin";
    }

    // New method only in Admin
    public function hasPermission(string $permission): bool
    {
        return in_array($permission, $this->permissions);
    }
}

$user = new User("John", "john@email.com");
echo $user->getRole(); // "user"

$admin = new Admin("Jane", "jane@email.com", ["manage_users", "edit_posts"]);
echo $admin->getRole();  // "admin"
echo $admin->getInfo();  // "Jane (jane@email.com)" — inherited method
echo $admin->hasPermission("manage_users"); // true
```

### Key Points for Interview

- PHP supports **single inheritance** only (one parent class)
- Use **interfaces** to achieve multiple inheritance behavior
- Use `parent::` to call parent methods
- Mark class as `final` to **prevent** inheritance
- **Prefer composition over inheritance** when possible (more on this in Practical Design Thinking)

```php
final class Singleton
{
    // Cannot be extended
}

// class Extended extends Singleton {} // ERROR!
```

---

## 4. Polymorphism

Polymorphism means **"many forms"** — same method name behaves differently based on the object calling it.

Think of it like the word **"open"** — you can open a door, open a book, or open a file. Same word, different actions.

### Why It Matters

- **Write flexible code** that works with different object types
- **Easy to extend** — add new classes without changing existing code
- **Cleaner code** — no long if/else or switch statements

### Types of Polymorphism

#### A. Method Overriding (Runtime Polymorphism)

```php
interface Shape
{
    public function area(): float;
    public function describe(): string;
}

class Circle implements Shape
{
    public function __construct(private float $radius) {}

    public function area(): float
    {
        return pi() * $this->radius ** 2;
    }

    public function describe(): string
    {
        return "Circle with radius {$this->radius}";
    }
}

class Rectangle implements Shape
{
    public function __construct(
        private float $width,
        private float $height
    ) {}

    public function area(): float
    {
        return $this->width * $this->height;
    }

    public function describe(): string
    {
        return "Rectangle {$this->width}x{$this->height}";
    }
}

class Triangle implements Shape
{
    public function __construct(
        private float $base,
        private float $height
    ) {}

    public function area(): float
    {
        return 0.5 * $this->base * $this->height;
    }

    public function describe(): string
    {
        return "Triangle with base {$this->base} and height {$this->height}";
    }
}

// Polymorphism in action — same method, different behavior
function printShapeInfo(Shape $shape): void
{
    echo $shape->describe() . " → Area: " . $shape->area() . "\n";
}

$shapes = [
    new Circle(5),
    new Rectangle(4, 6),
    new Triangle(3, 8),
];

foreach ($shapes as $shape) {
    printShapeInfo($shape); // Each shape calculates area differently
}
// Circle with radius 5 → Area: 78.54
// Rectangle 4x6 → Area: 24
// Triangle with base 3 and height 8 → Area: 12
```

#### B. Real-World Example: Notification System

```php
interface Notifiable
{
    public function send(string $to, string $message): bool;
    public function getChannel(): string;
}

class EmailNotification implements Notifiable
{
    public function send(string $to, string $message): bool
    {
        // Send via SMTP
        echo "Email to $to: $message\n";
        return true;
    }

    public function getChannel(): string
    {
        return "email";
    }
}

class SmsNotification implements Notifiable
{
    public function send(string $to, string $message): bool
    {
        // Send via SMS API
        echo "SMS to $to: $message\n";
        return true;
    }

    public function getChannel(): string
    {
        return "sms";
    }
}

class PushNotification implements Notifiable
{
    public function send(string $to, string $message): bool
    {
        // Send via push service
        echo "Push to $to: $message\n";
        return true;
    }

    public function getChannel(): string
    {
        return "push";
    }
}

// Usage — doesn't care which notification type
class NotificationService
{
    /**
     * @param Notifiable[] $channels
     */
    public function notify(array $channels, string $to, string $message): void
    {
        foreach ($channels as $channel) {
            $channel->send($to, $message); // Polymorphism!
        }
    }
}

$service = new NotificationService();
$service->notify(
    [new EmailNotification(), new SmsNotification()],
    "user@example.com",
    "Your order has been shipped!"
);
```

### Key Points for Interview

- PHP does **NOT** support method overloading (same method name, different parameters) like Java
- PHP uses `__call()` and `__callStatic()` magic methods as a workaround
- **Type hinting with interfaces** is the most common way to achieve polymorphism in PHP
- Polymorphism eliminates the need for long `if/else` or `switch` chains

---

## Quick Comparison Table — All 4 Pillars

| Concept | What It Does | PHP Feature | Real-World Analogy |
|---|---|---|---|
| **Encapsulation** | Hides data, controls access | `private`, `protected`, getters/setters | TV remote (buttons hide circuits) |
| **Abstraction** | Hides complexity, shows essentials | `abstract class`, `interface` | Car dashboard (hides engine) |
| **Inheritance** | Reuses code from parent class | `extends`, `parent::` | Family traits |
| **Polymorphism** | Same method, different behavior | Method overriding, interfaces | Word "open" (door/book/file) |

---

## Common Interview Questions

1. **What are the 4 pillars of OOP?**
   → Encapsulation, Abstraction, Inheritance, Polymorphism

2. **Difference between abstract class and interface?**
   → Abstract class can have implemented methods + properties; interface only defines contracts (PHP 8+ allows default methods in interfaces)

3. **Can PHP do multiple inheritance?**
   → No, but you can implement multiple interfaces and use Traits

4. **What is the difference between encapsulation and abstraction?**
   → Encapsulation hides DATA (access modifiers), Abstraction hides COMPLEXITY (interfaces/abstract classes)

5. **Give a real-world example of polymorphism.**
   → Payment gateways — `Stripe`, `PayPal`, `Bkash` all implement `PaymentGateway` interface. Same `pay()` method, different internal logic.
