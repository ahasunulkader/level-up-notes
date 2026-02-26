# Class Constants, Static Properties & Late Static Binding

## TL;DR
**Class constants** are fixed values that belong to the class, not any object. **Static properties/methods** are shared across all instances and called with `::` not `->`. **Late Static Binding** (`static::`) lets subclasses override static behavior properly — unlike `self::` which always refers to the class where the code was written.

---

## 1. Class Constants

A constant belongs to the **class itself**, not to any object. Its value never changes.

```php
class HttpStatus {
    const OK                = 200;
    const CREATED           = 201;
    const NOT_FOUND         = 404;
    const INTERNAL_ERROR    = 500;
}

// Access via ClassName::CONSTANT_NAME
echo HttpStatus::OK;        // 200
echo HttpStatus::NOT_FOUND; // 404

// Inside the class use self::
class Order {
    const STATUS_PENDING    = 'pending';
    const STATUS_PROCESSING = 'processing';
    const STATUS_COMPLETED  = 'completed';

    public string $status;

    public function complete(): void {
        $this->status = self::STATUS_COMPLETED; // self:: inside the class
    }

    public function isPending(): bool {
        return $this->status === self::STATUS_PENDING;
    }
}

$order = new Order();
$order->status = Order::STATUS_PENDING;
```

### Typed Constants (PHP 8.3+)

```php
class Config {
    const string  APP_NAME    = 'MyApp';
    const int     MAX_RETRIES = 3;
    const float   TAX_RATE    = 0.15;
}
```

### Interface Constants

Constants can also live in interfaces:

```php
interface Colorable {
    const RED   = 'red';
    const GREEN = 'green';
    const BLUE  = 'blue';
}

class Circle implements Colorable {
    public string $color = self::RED; // inherits the constant
}
```

### Constants vs `define()` vs `static` properties

| | Class Constant | `define()` | Static Property |
|---|---|---|---|
| Scope | Class-scoped | Global | Class-scoped |
| Value mutable? | No | No | Yes |
| Access | `Class::CONST` | `CONST_NAME` | `Class::$prop` |
| Type-safe | Yes (PHP 8.3) | No | Yes |
| Use when | Fixed class config | Global flags | Shared mutable state |

**When to use constants:**
- Magic numbers that belong to a domain concept (`MAX_RETRIES = 3`)
- Status codes, color codes, HTTP codes
- Config values that truly never change

---

## 2. Static Properties and Methods

### What "Static" Means

Static members belong to the **class itself**, not to any instance. All objects share the same static property — changing it from one object changes it for all.

```php
class Counter {
    public static int $count = 0; // shared across ALL instances

    public function __construct() {
        self::$count++; // increment when any object is created
    }

    public static function getCount(): int {
        return self::$count;
    }

    public static function reset(): void {
        self::$count = 0;
    }
}

$a = new Counter();
$b = new Counter();
$c = new Counter();

echo Counter::$count;      // 3  — shared across all
echo Counter::getCount();  // 3

Counter::reset();
echo Counter::$count;      // 0
```

### Static Methods

```php
class MathHelper {
    // No $this — no instance needed
    public static function add(int $a, int $b): int {
        return $a + $b;
    }

    public static function clamp(int $value, int $min, int $max): int {
        return max($min, min($max, $value));
    }
}

// Call directly on the class — no `new` needed
echo MathHelper::add(3, 5);        // 8
echo MathHelper::clamp(150, 0, 100); // 100
```

### Factory Pattern with Static Methods

```php
class User {
    private function __construct(
        public readonly int    $id,
        public readonly string $name,
        public readonly string $role,
    ) {}

    // Static factory methods — meaningful named constructors
    public static function createAdmin(int $id, string $name): static {
        return new static($id, $name, 'admin');
    }

    public static function createGuest(int $id, string $name): static {
        return new static($id, $name, 'guest');
    }

    public static function fromArray(array $data): static {
        return new static($data['id'], $data['name'], $data['role']);
    }
}

$admin = User::createAdmin(1, 'Alice');
$guest = User::createGuest(2, 'Bob');
$user  = User::fromArray(['id' => 3, 'name' => 'Carol', 'role' => 'editor']);
```

### Singleton Pattern

```php
class Database {
    private static ?Database $instance = null;
    private \PDO $pdo;

    private function __construct() {
        $this->pdo = new \PDO('mysql:host=localhost;dbname=shop', 'user', 'pass');
    }

    public static function getInstance(): static {
        if (static::$instance === null) {
            static::$instance = new static(); // only created once
        }
        return static::$instance;
    }

    public function query(string $sql): \PDOStatement {
        return $this->pdo->query($sql);
    }
}

$db1 = Database::getInstance();
$db2 = Database::getInstance();
var_dump($db1 === $db2); // true — same object
```

**Pros of Static:**
- No instantiation needed — convenient for utilities and helpers
- Shared state across all instances (counters, config, singletons)
- Factory methods give meaningful creation semantics

**Cons of Static:**
- Hard to test (can't inject a mock in place of a static method)
- Static state persists for the life of the request — can cause hidden bugs
- Tight coupling — callers are hardcoded to the class name
- Avoid for anything that touches a database or external service — prefer instance methods with dependency injection

---

## 3. `self::` vs `static::` — Late Static Binding

### The Problem with `self::`

`self::` always refers to the **class where the code is physically written**, not the class that was actually called.

```php
class ParentModel {
    public static function create(): static {
        return new self(); // self:: = ParentModel, always!
    }

    public static function className(): string {
        return self::class; // always 'ParentModel'
    }
}

class UserModel extends ParentModel {}

$user = UserModel::create();
var_dump($user instanceof UserModel);   // FALSE ← bug! Created ParentModel, not UserModel
var_dump($user instanceof ParentModel); // TRUE
```

### The Fix — `static::` (Late Static Binding, PHP 5.3+)

`static::` is **resolved at runtime** — it refers to the class that was actually called (the "late" part of Late Static Binding).

```php
class ParentModel {
    public static function create(): static {
        return new static(); // static:: = whatever class was called at runtime
    }

    public static function className(): string {
        return static::class; // resolved at call time
    }
}

class UserModel extends ParentModel {
    public string $type = 'user';
}

class AdminModel extends ParentModel {
    public string $type = 'admin';
}

$user  = UserModel::create();
$admin = AdminModel::create();

var_dump($user instanceof UserModel);   // TRUE ✅
var_dump($admin instanceof AdminModel); // TRUE ✅

echo UserModel::className();  // 'UserModel'
echo AdminModel::className(); // 'AdminModel'
```

### `self::` vs `static::` vs `parent::` Summary

| Keyword | Refers to | Resolved at | Use case |
|---|---|---|---|
| `self::` | Class where code is written | Compile time | When you WANT to lock to the current class |
| `static::` | Class that was actually called | Runtime | Inheritance-safe static methods |
| `parent::` | The parent class | Compile time | Calling parent's overridden method |

### Real Example — Active Record Pattern

```php
class Model {
    protected static string $table = 'models'; // override in subclass

    public static function findAll(): array {
        $table = static::$table; // uses the subclass's $table, not 'models'
        // DB query: SELECT * FROM {$table}
        return [];
    }

    public static function create(array $data): static {
        // returns correct subclass type
        $instance = new static();
        // ... set properties
        return $instance;
    }
}

class User extends Model {
    protected static string $table = 'users'; // override
}

class Post extends Model {
    protected static string $table = 'posts'; // override
}

User::findAll(); // SELECT * FROM users ✅ (static::$table = 'users')
Post::findAll(); // SELECT * FROM posts ✅ (static::$table = 'posts')
```

---

## Interview Q&A

**Q: What is the difference between a class constant and a static property?**
A: A class constant (`const FOO = 'bar'`) is immutable — its value can never change. A static property (`public static $count = 0`) is mutable — it can be read and written at runtime. Use constants for values that should never change; use static properties for shared mutable state.

**Q: When should you NOT use static methods?**
A: Avoid static methods when the method needs to call a database, external API, or any service that you'd want to mock in tests. Static calls are hardcoded — you can't inject a fake. Prefer instance methods with dependency injection. Static methods are fine for pure utility functions (`MathHelper::add`) with no side effects.

**Q: What is Late Static Binding?**
A: It's the mechanism where `static::` is resolved at runtime to refer to the class that was actually called, not the class where the code was written. `self::` is resolved at compile time and always points to the defining class — which breaks in inheritance. `static::` fixes this by deferring resolution to call time.

**Q: Why use a static factory method instead of a constructor?**
A: Factory methods have names — `User::createAdmin()` and `User::createGuest()` are much clearer than passing a `'admin'` or `'guest'` string to `new User()`. They can also validate, cache, or return subclass instances, which constructors can't do.
