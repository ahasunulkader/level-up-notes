# Advanced Objects — Anonymous Classes, Comparing, Cloning & Serialization

## TL;DR
**Anonymous classes** are throwaway classes defined inline without a name. **`==` vs `===`** behave differently for objects. **`clone`** makes a shallow copy — use `__clone` for deep copies. **`serialize()`** converts an object to a storable string; `unserialize()` restores it.

---

## 1. Anonymous Classes

An anonymous class is a **class without a name**, defined and instantiated inline. It's useful when you need a one-off class that implements an interface or extends a class — and you don't want to create a permanent named class for it.

### Basic Usage

```php
// Named class (permanent)
class SimpleLogger {
    public function log(string $msg): void {
        echo $msg . "\n";
    }
}
$logger = new SimpleLogger();

// Anonymous class (inline, no name)
$logger = new class {
    public function log(string $msg): void {
        echo $msg . "\n";
    }
};

$logger->log('Hello!'); // Hello!
```

### Anonymous Class Implementing an Interface

The most common use — provide a one-off implementation in a test or a specific context.

```php
interface Logger {
    public function log(string $message): void;
}

interface Mailer {
    public function send(string $to, string $subject, string $body): bool;
}

// Pass a concrete but unnamed implementation of Logger to a function
function processOrder(Logger $logger): void {
    $logger->log('Processing order...');
    // ...
}

processOrder(new class implements Logger {
    public function log(string $message): void {
        file_put_contents('/tmp/order.log', $message . "\n", FILE_APPEND);
    }
});
```

### Constructor Arguments

```php
$prefix = '[APP]';

$logger = new class($prefix) implements Logger {
    public function __construct(private readonly string $prefix) {}

    public function log(string $message): void {
        echo "{$this->prefix} {$message}\n";
    }
};

$logger->log('Started'); // [APP] Started
```

### Anonymous Class Extending Another Class

```php
abstract class Repository {
    abstract protected function tableName(): string;

    public function findAll(): array {
        return []; // simplified — would do DB query
    }
}

// One-off repository for a specific test
$repo = new class extends Repository {
    protected function tableName(): string { return 'temp_products'; }
};
```

### When to Use Anonymous Classes

| Use case | Example |
|---|---|
| Testing — mock objects inline | Pass a fake logger/mailer without creating a MockLogger class |
| Event listeners | Register a one-off listener that won't be reused |
| Factory returns | Return a new instance with specific one-off behavior |
| Closures that need state | When a closure needs multiple methods |

**Pros:**
- No polluting the codebase with single-use named classes
- Keeps related code together (defined where it's used)
- Can implement interfaces and extend classes

**Cons:**
- Can't be reused — not a great choice if used in multiple places
- Harder to type-hint (use the interface type)
- Can reduce readability if the class body is large

---

## 2. Comparing Objects — `==` vs `===`

PHP objects behave differently from primitives when compared.

### `==` — Loose Equality (Same Class + Same Properties)

Two objects are `==` if they are of the **same class** and have the **same property values** (recursively compared).

```php
class Point {
    public function __construct(
        public int $x,
        public int $y,
    ) {}
}

$p1 = new Point(1, 2);
$p2 = new Point(1, 2);
$p3 = new Point(9, 9);

var_dump($p1 == $p2);  // true  — same class, same values
var_dump($p1 == $p3);  // false — different values
var_dump($p1 == $p1);  // true  — same instance
```

### `===` — Strict Equality (Same Instance)

Two objects are `===` only if they are the **exact same object in memory** — same reference.

```php
var_dump($p1 === $p2);  // false — different instances, even if values match
var_dump($p1 === $p1);  // true  — literally the same object

$ref = $p1; // $ref points to the same object
var_dump($p1 === $ref); // true — same instance
```

### Object Assignment = Reference, Not Copy

```php
$a = new Point(1, 2);
$b = $a; // $b is a REFERENCE to the same object — NOT a copy!

$b->x = 99;
echo $a->x; // 99 ← both point to the same object!

// To get an independent copy, use clone
$c = clone $a;
$c->x = 50;
echo $a->x; // 99 ← unaffected
```

---

## 3. Cloning Objects

`clone` creates a **shallow copy** — a new object with the same property values. Primitive values are copied; object references are copied (not cloned).

### Shallow Clone (Default)

```php
class Address {
    public function __construct(public string $city) {}
}

class User {
    public Address $address;

    public function __construct(string $city) {
        $this->address = new Address($city);
    }
}

$original = new User('London');
$copy     = clone $original;

// Primitive properties are independent (there are none here, but e.g. $name)
// Object properties are shared references!
$copy->address->city = 'Paris';
echo $original->address->city; // 'Paris' ← SHARED — bug!
```

### Deep Clone with `__clone`

```php
class User {
    public Address $address;
    public array   $tags;

    public function __construct(string $city, array $tags) {
        $this->address = new Address($city);
        $this->tags    = $tags;
    }

    public function __clone() {
        // Called automatically when `clone $this` is used
        // Deep clone all nested objects
        $this->address = clone $this->address; // create a new Address
        // Arrays are value-typed — they're automatically deep copied
        // But if array contains objects, clone those too:
        // $this->items = array_map(fn($item) => clone $item, $this->items);
    }
}

$original = new User('London', ['admin', 'editor']);
$copy     = clone $original;

$copy->address->city = 'Paris';
$copy->tags[]        = 'viewer';

echo $original->address->city; // 'London' ✅ — independent
echo count($original->tags);   // 2 ✅ — arrays are value-copied
echo count($copy->tags);       // 3
```

### Immutable Object Pattern with Cloning

A popular pattern — methods return a modified clone instead of mutating the original.

```php
class Money {
    public function __construct(
        private readonly float  $amount,
        private readonly string $currency,
    ) {}

    public function add(Money $other): static {
        if ($this->currency !== $other->currency) {
            throw new \InvalidArgumentException('Currency mismatch');
        }
        // Return a NEW object — original is unchanged
        return new static($this->amount + $other->amount, $this->currency);
    }

    public function multiply(float $factor): static {
        return new static($this->amount * $factor, $this->currency);
    }

    public function getAmount(): float  { return $this->amount; }
    public function getCurrency(): string { return $this->currency; }
}

$price     = new Money(100.0, 'USD');
$withTax   = $price->multiply(1.1);    // new object — $price unchanged
$total     = $price->add($withTax);    // new object

echo $price->getAmount();   // 100.0
echo $withTax->getAmount(); // 110.0
echo $total->getAmount();   // 210.0
```

---

## 4. PHP Serialization

Serialization converts an object (or any value) into a **storable/transmittable string** that can later be reconstructed.

### `serialize()` and `unserialize()`

```php
class UserSession {
    public function __construct(
        public readonly int    $userId,
        public readonly string $role,
        public readonly array  $permissions,
    ) {}
}

$session = new UserSession(42, 'admin', ['read', 'write', 'delete']);

// Serialize — convert to string
$serialized = serialize($session);
// 'O:11:"UserSession":3:{s:6:"userId";i:42;s:4:"role";s:5:"admin";s:11:"permissions";a:3:{...}}'

// Store in file, cache, session, database...
file_put_contents('/tmp/session.dat', $serialized);

// Restore later
$data     = file_get_contents('/tmp/session.dat');
$restored = unserialize($data);

echo $restored->userId; // 42
echo $restored->role;   // admin
```

### `__sleep` and `__wakeup` — Serialization Hooks

```php
class CachedResult {
    private \PDO    $db;         // can't serialize a connection!
    private string  $dsn;
    private ?array  $cachedData = null;

    public function __construct(string $dsn) {
        $this->dsn = $dsn;
        $this->db  = new \PDO($dsn);
    }

    // Return only serializable property names
    public function __sleep(): array {
        return ['dsn', 'cachedData']; // $db excluded
    }

    // Re-create non-serializable resources after unserialization
    public function __wakeup(): void {
        $this->db = new \PDO($this->dsn); // reconnect
    }
}
```

### `__serialize` and `__unserialize` (PHP 7.4+ — Preferred)

More powerful than `__sleep`/`__wakeup` — gives you full control over the serialized array.

```php
class SecureToken {
    public function __construct(
        private string $token,
        private int    $userId,
        private string $secret, // should NOT be serialized
    ) {}

    // Return the data to serialize (like __sleep but returns data, not names)
    public function __serialize(): array {
        return [
            'token'  => $this->token,
            'userId' => $this->userId,
            // secret is deliberately excluded
        ];
    }

    // Receive the serialized data and restore properties
    public function __unserialize(array $data): void {
        $this->token  = $data['token'];
        $this->userId = $data['userId'];
        $this->secret = ''; // can't restore secret — it was never stored
    }
}
```

### `Serializable` Interface (Deprecated in PHP 8.1)

```php
// Old way — avoid in new code
class OldStyle implements \Serializable {
    private string $data;

    public function serialize(): string {
        return json_encode(['data' => $this->data]);
    }

    public function unserialize(string $serialized): void {
        $arr = json_decode($serialized, true);
        $this->data = $arr['data'];
    }
}
```

Use `__serialize`/`__unserialize` instead in modern PHP.

### JSON as an Alternative to `serialize()`

```php
class Product {
    public function __construct(
        public readonly int    $id,
        public readonly string $name,
        public readonly float  $price,
    ) {}

    public function toJson(): string {
        return json_encode([
            'id'    => $this->id,
            'name'  => $this->name,
            'price' => $this->price,
        ]);
    }

    public static function fromJson(string $json): static {
        $data = json_decode($json, true);
        return new static($data['id'], $data['name'], $data['price']);
    }
}

$product = new Product(1, 'Laptop', 999.99);
$json    = $product->toJson();      // '{"id":1,"name":"Laptop","price":999.99}'
$restored = Product::fromJson($json);
```

**`serialize()` vs JSON:**

| | `serialize()` | JSON |
|---|---|---|
| PHP-only? | Yes — PHP-specific format | No — language-agnostic |
| Type preservation | Full (int, float, bool, object) | Partial (no distinction between int 1 and bool true in some contexts) |
| Security | Dangerous with untrusted input | Safer |
| Human readable | No | Yes |
| Use when | PHP-to-PHP (sessions, cache) | APIs, cross-language, storage |

### Security Warning

**Never `unserialize()` untrusted user input.** PHP's unserialize can trigger magic methods (`__wakeup`, `__destruct`) on any class in scope — a known attack vector (PHP Object Injection / POP chains).

```php
// DANGEROUS
$data     = $_GET['data'];           // user-controlled input
$obj      = unserialize($data);      // can execute arbitrary code!

// SAFE alternative — use JSON for external input
$data     = $_GET['data'];
$decoded  = json_decode($data, true); // no code execution risk
```

---

## Interview Q&A

**Q: What is an anonymous class and when would you use one?**
A: An anonymous class is a class defined inline without a name — `new class { ... }`. Use it when you need a one-off implementation of an interface or extension of a class that won't be reused elsewhere. Common in tests (fake logger, fake mailer) and event listeners.

**Q: What is the difference between `==` and `===` for objects in PHP?**
A: `==` checks that two objects are of the same class and have equal property values. `===` checks that both variables reference the exact same object instance in memory. Two `new Point(1,2)` objects are `==` but not `===`.

**Q: What is the difference between shallow clone and deep clone?**
A: PHP's `clone` makes a shallow copy — primitive values are duplicated, but object properties are still shared references. A deep clone requires `__clone()` to explicitly clone nested objects (`$this->address = clone $this->address`). Without deep cloning, modifying a nested object in the clone also changes it in the original.

**Q: When is `serialize()` dangerous?**
A: When unserializing untrusted external input. PHP's unserialize instantiates classes and calls magic methods (`__wakeup`, `__destruct`). An attacker can craft a payload that triggers destructive code through existing classes in your codebase (PHP Object Injection). Always use JSON or validate/whitelist data before unserializing.

**Q: What is the difference between `__sleep`/`__wakeup` and `__serialize`/`__unserialize`?**
A: `__sleep` returns an array of property *names* to serialize; `__wakeup` runs after deserialization to restore state. `__serialize` (PHP 7.4+) returns a custom array of *data* to serialize — more flexible because you can transform or exclude values and control the structure. `__unserialize` receives that same array. The new methods are preferred in modern PHP.
