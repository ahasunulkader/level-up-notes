# OOP Basics — Introduction, Classes & Objects

## TL;DR
OOP organizes code around **objects** (data + behavior together) instead of loose functions. A **class** is the blueprint; an **object** is an instance of it. PHP 8.x adds property promotion, typed properties, and readonly — making classes cleaner and safer.

---

## 1. What Is OOP and Why Does It Exist?

Before OOP, code was procedural — long sequences of functions with data passed around as arrays. As apps grew, this became unmaintainable.

**OOP solves:**
- **Spaghetti code** — group related data and behavior into one place
- **Duplication** — share behavior through inheritance and composition
- **Complexity** — hide internal details, expose only what's needed

**Real-life analogy:** A `Car` class is the blueprint. Every car you build from it is an object — same structure, different state (color, speed, fuel).

**4 pillars of OOP:** Encapsulation, Inheritance, Abstraction, Polymorphism *(covered in depth in [oop-principles.md](oop-principles.md))*.

---

## 2. Classes and Objects

```php
// Define the blueprint
class Car {
    public string $brand;
    public int $speed = 0;

    public function accelerate(int $by): void {
        $this->speed += $by;
    }

    public function info(): string {
        return "{$this->brand} going at {$this->speed} km/h";
    }
}

// Create objects (instances)
$toyota = new Car();
$toyota->brand = 'Toyota';
$toyota->accelerate(60);
echo $toyota->info(); // Toyota going at 60 km/h

$bmw = new Car();
$bmw->brand = 'BMW';
$bmw->accelerate(120);
// $toyota and $bmw are independent objects — different state, same class
```

**`$this`** refers to the current object instance inside a method.

---

## 3. Typed Properties (PHP 7.4+)

Without types, any value can be assigned to any property — silent bugs.

```php
class User {
    public int    $id;
    public string $name;
    public ?string $email = null; // nullable — can be null or string
    public float  $balance = 0.0;
    public bool   $active  = true;
}

$user = new User();
$user->id   = 1;
$user->name = 'Alice';
// $user->name = 42; // TypeError — caught immediately

// Uninitialized typed property:
$u = new User();
echo $u->name; // Error: must be initialized before access
```

**Benefits:**
- Bugs caught at assignment, not later when you use the value
- Self-documenting — no need to write `@var string` comments
- IDE autocomplete works correctly

**Disadvantage:** All typed properties must be assigned before being read — requires discipline in constructors.

---

## 4. Constructor (`__construct`)

The constructor runs **automatically when an object is created** with `new`. Use it to set up initial state.

```php
class Product {
    public string $name;
    public float  $price;
    public int    $stock;

    public function __construct(string $name, float $price, int $stock = 0) {
        $this->name  = $name;
        $this->price = $price;
        $this->stock = $stock;
    }
}

$laptop = new Product('Laptop', 999.99, 50);
$phone  = new Product('Phone', 499.99); // stock defaults to 0
```

**Why it exists:** Ensures the object is always in a valid state right from creation. Prevents partially-initialized objects.

---

## 5. Property Promotion (PHP 8.0+)

PHP 8 lets you declare and assign constructor parameters as properties in one line — eliminates boilerplate.

```php
// OLD way (repetitive)
class Order {
    public int    $id;
    public string $status;
    public float  $total;

    public function __construct(int $id, string $status, float $total) {
        $this->id     = $id;
        $this->status = $status;
        $this->total  = $total;
    }
}

// NEW way — PHP 8 Property Promotion (same result, much less code)
class Order {
    public function __construct(
        public readonly int    $id,
        public string          $status,
        public float           $total,
        private string         $notes = '',
    ) {} // body can be empty!
}

$order = new Order(id: 1, status: 'pending', total: 199.99);
echo $order->id;     // 1
echo $order->status; // pending
```

**`readonly`** (PHP 8.1) means the property can be set once (in the constructor) and never changed after.

```php
class Config {
    public function __construct(
        public readonly string $dbHost,
        public readonly int    $dbPort,
    ) {}
}

$config = new Config('localhost', 3306);
// $config->dbHost = 'other'; // Error: Cannot modify readonly property
```

**Benefits of promotion:**
- Removes 3 lines per property (declare + `$this->x = $x`)
- `readonly` enforces immutability — great for value objects
- Named arguments (`id: 1`) make usage readable

---

## 6. Destructor (`__destruct`)

Runs automatically when the object is **destroyed** — when the script ends, or when no references remain.

```php
class DatabaseConnection {
    private \PDO $pdo;

    public function __construct(string $dsn) {
        $this->pdo = new \PDO($dsn);
        echo "Connection opened\n";
    }

    public function __destruct() {
        // PHP closes PDO connections automatically, but explicit is clearer
        echo "Connection closed\n";
    }
}

$db = new DatabaseConnection('mysql:host=localhost;dbname=shop');
// ... use $db
// When $db goes out of scope: "Connection closed" is printed
```

**Real use cases:** Closing file handles, releasing locks, flushing buffers, logging.

**Caution:** Don't rely on destructor order — in complex apps, destructors may fire in unexpected order. Prefer explicit `close()` methods for critical cleanup.

---

## 7. Access Modifiers

Control **who** can read/write properties and call methods.

| Modifier | Accessible from |
|---|---|
| `public` | Anywhere — inside, outside, subclasses |
| `protected` | Inside the class + subclasses only |
| `private` | Inside that exact class only |

```php
class BankAccount {
    public    string $owner;       // anyone can read/write
    protected float  $balance;     // only this class and subclasses
    private   string $secretPin;   // only this class

    public function __construct(string $owner, float $balance, string $pin) {
        $this->owner     = $owner;
        $this->balance   = $balance;
        $this->secretPin = $pin;
    }

    public function deposit(float $amount): void {
        $this->validateAmount($amount); // can call private method internally
        $this->balance += $amount;
    }

    public function getBalance(): float {
        return $this->balance; // controlled access via getter
    }

    private function validateAmount(float $amount): void {
        if ($amount <= 0) throw new \InvalidArgumentException('Amount must be positive');
    }
}

$account = new BankAccount('Alice', 1000.0, '1234');
$account->deposit(500);
echo $account->getBalance(); // 1500
// $account->balance;    // Error: protected
// $account->secretPin;  // Error: private
```

**Why this matters:**
- Hides internal implementation — you can change internals without breaking callers
- Prevents invalid state (only `deposit()` can change balance, with validation)
- Makes code intent clear

---

## 8. Method Chaining

Return `$this` from methods so you can chain multiple calls on the same line.

```php
class QueryBuilder {
    private string $table  = '';
    private array  $wheres = [];
    private ?int   $limit  = null;

    public function from(string $table): static {
        $this->table = $table;
        return $this; // return the same object
    }

    public function where(string $condition): static {
        $this->wheres[] = $condition;
        return $this;
    }

    public function limit(int $n): static {
        $this->limit = $n;
        return $this;
    }

    public function toSql(): string {
        $sql = "SELECT * FROM {$this->table}";
        if ($this->wheres) {
            $sql .= ' WHERE ' . implode(' AND ', $this->wheres);
        }
        if ($this->limit) {
            $sql .= " LIMIT {$this->limit}";
        }
        return $sql;
    }
}

// Fluent interface — reads like English
$sql = (new QueryBuilder())
    ->from('users')
    ->where('active = 1')
    ->where('age > 18')
    ->limit(10)
    ->toSql();

// "SELECT * FROM users WHERE active = 1 AND age > 18 LIMIT 10"
```

**Tip:** Use `static` return type (not `self`) so subclasses return the correct type.

**Real-life use:** Laravel's Eloquent, query builders, and HTTP clients all use method chaining.

---

## 9. `stdClass` and Type Casting

`stdClass` is PHP's generic object — a plain object with no predefined properties.

```php
// Creating a stdClass object
$user = new \stdClass();
$user->name  = 'Bob';
$user->email = 'bob@example.com';
echo $user->name; // Bob

// Converting array to object (type cast)
$data = ['name' => 'Alice', 'age' => 30];
$obj  = (object) $data;
echo $obj->name; // Alice
echo $obj->age;  // 30

// Converting object to array
$arr = (array) $obj;
echo $arr['name']; // Alice

// JSON decode gives stdClass by default
$json = '{"name":"Charlie","score":95}';
$obj  = json_decode($json);          // stdClass
$arr  = json_decode($json, true);    // array (second param = true)
echo $obj->name; // Charlie
echo $arr['name']; // Charlie
```

**When to use `stdClass`:**
- Quick data containers from JSON or database results
- When you just need a named bunch of properties without a full class

**When NOT to use it:**
- Anything with behavior (methods) → use a proper class
- Any domain model → use typed classes for safety

---

## 10. Pros & Cons of OOP in PHP

**Benefits:**
- Code is organized around real-world concepts (User, Order, Product)
- Encapsulation prevents invalid state
- Inheritance and traits reduce duplication
- Easy to test — inject dependencies, mock objects
- Frameworks like Laravel are built entirely on OOP

**Disadvantages:**
- More boilerplate than simple procedural scripts
- Wrong hierarchy design is worse than no OOP (deep inheritance = fragile)
- Performance overhead is negligible in PHP (FPM restarts per request)

---

## Interview Q&A

**Q: What is the difference between a class and an object?**
A: A class is the blueprint (definition). An object is an instance created from that blueprint. Multiple objects can be created from one class, each with its own independent state.

**Q: What is property promotion in PHP 8?**
A: Property promotion lets you declare and initialize class properties directly in the constructor parameters using access modifiers. Instead of declaring the property, adding a parameter, and assigning `$this->x = $x`, you write just `public string $x` in the constructor signature and PHP does the rest.

**Q: What does `readonly` do?**
A: A `readonly` property can only be written once — during initialization in the constructor. Any attempt to modify it afterward throws an `Error`. It's ideal for value objects and DTOs that should never change after creation.

**Q: When would you use `protected` vs `private`?**
A: Use `private` when the property/method is purely internal implementation detail and should never be accessible even by subclasses. Use `protected` when subclasses need to access or override it. Start with `private` and loosen to `protected` only when needed.

**Q: What is method chaining and how do you implement it?**
A: Method chaining (fluent interface) is when methods return `$this` (or `static`) so calls can be chained. Implement it by returning `$this` (or `return $this->clone()` for immutable versions) from each setter/builder method. Used extensively in Laravel's query builder, HTTP client, and mail builder.
