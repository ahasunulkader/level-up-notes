# PHP Magic Methods

## TL;DR
Magic methods are special methods starting with `__` that PHP calls **automatically** at specific moments — when getting/setting undefined properties, calling undefined methods, converting to string, invoking an object like a function, etc. They let you add custom behavior to your classes without changing the calling code.

---

## Overview

| Magic Method | Called When |
|---|---|
| `__construct()` | Object is created with `new` |
| `__destruct()` | Object is destroyed / script ends |
| `__get($name)` | Reading an inaccessible/undefined property |
| `__set($name, $value)` | Writing to an inaccessible/undefined property |
| `__isset($name)` | `isset()` or `empty()` called on inaccessible property |
| `__unset($name)` | `unset()` called on inaccessible property |
| `__call($name, $args)` | Calling an inaccessible/undefined method |
| `__callStatic($name, $args)` | Calling an inaccessible/undefined **static** method |
| `__toString()` | Object used where a string is expected |
| `__invoke($args)` | Object called like a function: `$obj()` |
| `__clone()` | Object is cloned with `clone` |
| `__debugInfo()` | `var_dump()` is called on the object |
| `__sleep()` | Before `serialize()` |
| `__wakeup()` | After `unserialize()` |

---

## 1. `__construct` and `__destruct`

Covered in [oop-basics.md](oop-basics.md). In short: `__construct` initializes the object; `__destruct` cleans up when it's garbage collected.

---

## 2. `__get` and `__set` — Dynamic Properties

Called when accessing **private/protected or non-existent** properties from outside.

```php
class DynamicModel {
    private array $data = [];

    // Called when reading a non-accessible property
    public function __get(string $name): mixed {
        return $this->data[$name] ?? null;
    }

    // Called when writing to a non-accessible property
    public function __set(string $name, mixed $value): void {
        $this->data[$name] = $value;
    }

    // Called when isset($obj->prop) on non-accessible property
    public function __isset(string $name): bool {
        return isset($this->data[$name]);
    }

    // Called when unset($obj->prop) on non-accessible property
    public function __unset(string $name): void {
        unset($this->data[$name]);
    }
}

$model = new DynamicModel();
$model->name = 'Alice';       // triggers __set
$model->age  = 30;            // triggers __set
echo $model->name;            // triggers __get → 'Alice'
echo $model->missing;         // triggers __get → null
echo isset($model->name);     // triggers __isset → true
unset($model->name);          // triggers __unset
```

**Real-life use case — Laravel Eloquent models:**
```php
// You can do $user->name even though 'name' is stored in $attributes array
// Eloquent uses __get/__set to route property access to $attributes['name']
$user = User::find(1);
echo $user->name;       // __get routes to $user->attributes['name']
$user->name = 'Bob';   // __set routes to $user->attributes['name'] = 'Bob'
```

**Pros:** Enables powerful patterns like ORMs, proxy objects, dynamic DTOs.
**Cons:** Hides what properties exist — no IDE autocomplete, harder to debug.

---

## 3. `__call` and `__callStatic` — Method Overloading

Called when invoking an **undefined or inaccessible method**.

```php
class ApiClient {
    private string $baseUrl;

    public function __construct(string $baseUrl) {
        $this->baseUrl = $baseUrl;
    }

    // Called when $client->getSomething() doesn't exist as a real method
    public function __call(string $name, array $arguments): mixed {
        // Pattern: getUsers() → GET /users, postOrder() → POST /order
        if (str_starts_with($name, 'get')) {
            $endpoint = strtolower(substr($name, 3)); // 'getUsers' → 'users'
            return $this->request('GET', "/{$endpoint}", $arguments[0] ?? []);
        }

        if (str_starts_with($name, 'post')) {
            $endpoint = strtolower(substr($name, 4));
            return $this->request('POST', "/{$endpoint}", $arguments[0] ?? []);
        }

        throw new \BadMethodCallException("Method {$name} not found");
    }

    // Called for static calls: ApiClient::someStaticMethod()
    public static function __callStatic(string $name, array $arguments): mixed {
        $instance = new static($arguments[0]);
        return $instance;
    }

    private function request(string $method, string $path, array $data): array {
        // ... actual HTTP call
        return [];
    }
}

$client = new ApiClient('https://api.example.com');
$users  = $client->getUsers();   // __call → GET /users
$orders = $client->getOrders();  // __call → GET /orders
$result = $client->postOrder(['product_id' => 1]); // __call → POST /order
```

**Real-life use case:** Laravel's `DB::table()`, `Mail::to()`, and many facade calls route through `__callStatic`.

---

## 4. `__toString` — String Conversion

Called when the object is used **where a string is expected** — `echo`, string concatenation, `(string)` cast.

```php
class Money {
    public function __construct(
        private float  $amount,
        private string $currency = 'USD'
    ) {}

    public function __toString(): string {
        return number_format($this->amount, 2) . ' ' . $this->currency;
    }
}

$price = new Money(1999.5, 'EUR');
echo $price;              // 1,999.50 EUR
echo "Total: {$price}";  // Total: 1,999.50 EUR
$str = (string) $price;  // '1,999.50 EUR'
```

```php
class User {
    public function __construct(
        public readonly int    $id,
        public readonly string $name,
    ) {}

    public function __toString(): string {
        return "User#{$this->id}({$this->name})";
    }
}

$user = new User(42, 'Alice');
echo $user;   // User#42(Alice)
Log::info("Logged in: {$user}"); // Logged in: User#42(Alice)
```

**Pros:** Convenient for logging, debugging, simple output.
**Cons:** Easy to accidentally use an object as a string and get confusing output if `__toString` isn't defined (it throws a Fatal Error pre-PHP 8, returns an empty string in some contexts).

---

## 5. `__invoke` — Callable Objects

Makes an object **callable like a function** — `$obj()`.

```php
class Multiplier {
    public function __construct(private int $factor) {}

    public function __invoke(int $value): int {
        return $value * $this->factor;
    }
}

$double = new Multiplier(2);
$triple = new Multiplier(3);

echo $double(5);   // 10
echo $triple(5);   // 15

// Can be used anywhere a callable is expected
$numbers = [1, 2, 3, 4, 5];
$doubled = array_map($double, $numbers); // [2, 4, 6, 8, 10]

// Check if an object is callable
var_dump(is_callable($double)); // true
```

**Real-life use case — Middleware:**
```php
class RateLimitMiddleware {
    public function __construct(
        private int $maxRequests,
        private RedisClient $redis,
    ) {}

    public function __invoke(Request $request, Closure $next): Response {
        $key = 'rate_limit:' . $request->ip();

        if ($this->redis->incr($key) > $this->maxRequests) {
            return response('Too Many Requests', 429);
        }

        return $next($request);
    }
}

// Laravel registers it as a callable middleware
$app->middleware(new RateLimitMiddleware(100, $redis));
// Internally: $middleware($request, $next) — invokes __invoke
```

---

## 6. `__clone` — Object Cloning Hook

Called **after** an object is cloned with `clone`. Used to perform a deep copy of nested objects.

```php
class Address {
    public function __construct(public string $city) {}
}

class User {
    public Address $address;

    public function __construct(string $city) {
        $this->address = new Address($city);
    }

    public function __clone() {
        // Shallow clone copies the reference — both users would share address object
        // Deep clone: create a new Address object for the clone
        $this->address = clone $this->address;
    }
}

$original = new User('London');
$copy     = clone $original;

$copy->address->city = 'Paris';

echo $original->address->city; // London ✅ (deep clone — original unaffected)
echo $copy->address->city;     // Paris  ✅
```

**Without `__clone`:**
```php
$copy->address->city = 'Paris';
echo $original->address->city; // Paris ← shared reference! Bug.
```

---

## 7. `__debugInfo` — Custom `var_dump` Output

Control what appears when `var_dump()` or `print_r()` dumps the object. Hide sensitive info.

```php
class PaymentCard {
    public function __construct(
        private string $cardNumber,
        private string $cvv,
        private string $holderName,
    ) {}

    public function __debugInfo(): array {
        return [
            'cardNumber'  => '****-****-****-' . substr($this->cardNumber, -4),
            'holderName'  => $this->holderName,
            // cvv is completely hidden — never shown in dumps
        ];
    }
}

$card = new PaymentCard('4111111111111111', '123', 'Alice Smith');
var_dump($card);
// object(PaymentCard)#1 {
//   ["cardNumber"] => string(19) "****-****-****-1111"
//   ["holderName"] => string(11) "Alice Smith"
// }
```

---

## 8. `__sleep` and `__wakeup` — Serialization Hooks

```php
class DatabaseConnection {
    private \PDO $connection;
    private string $dsn;

    public function __construct(string $dsn) {
        $this->dsn        = $dsn;
        $this->connection = new \PDO($dsn); // can't serialize PDO!
    }

    // Called before serialize() — return only serializable property names
    public function __sleep(): array {
        return ['dsn']; // don't try to serialize $connection
    }

    // Called after unserialize() — restore what can't be serialized
    public function __wakeup(): void {
        $this->connection = new \PDO($this->dsn); // re-establish connection
    }
}

$db         = new DatabaseConnection('mysql:host=localhost;dbname=shop');
$serialized = serialize($db);    // calls __sleep → stores only 'dsn'
$restored   = unserialize($serialized); // calls __wakeup → reconnects
```

---

## When to Use Magic Methods

| Magic Method | Common Use Case |
|---|---|
| `__get` / `__set` | ORMs (Eloquent), dynamic property bags |
| `__call` / `__callStatic` | Facades, proxy objects, fluent APIs |
| `__toString` | Logging, display, value objects |
| `__invoke` | Middleware, handlers, single-action classes |
| `__clone` | Deep copying objects with nested objects |
| `__debugInfo` | Hiding sensitive data from var_dump |
| `__sleep` / `__wakeup` | Serializing objects with non-serializable state |

---

## Pros and Cons of Magic Methods

**Benefits:**
- Enable powerful patterns (ORMs, facades, proxies) with less code
- Transparent to callers — usage looks like normal property/method access
- Flexible dynamic behavior

**Disadvantages:**
- No IDE autocomplete for `__get`/`__set` accessed properties (unless you add `@property` docblocks)
- Harder to debug — a typo in a property name silently hits `__get` instead of throwing an error
- Performance overhead — slightly slower than direct property access
- Can make code feel "magical" — hard for newcomers to understand where behavior comes from

---

## Interview Q&A

**Q: What is the difference between `__get` and a regular getter method?**
A: A regular getter (`public function getName()`) is explicit — you see it in the class. `__get` is triggered automatically for any undefined or inaccessible property, allowing you to handle all properties dynamically with one method. ORMs like Eloquent use `__get` so `$user->name` works even though there's no `$name` property — it reads from `$attributes['name']`.

**Q: What does `__invoke` do and when would you use it?**
A: `__invoke` makes an object callable like a function — `$obj(args)`. Use it for single-responsibility callable classes — middleware, event listeners, validators. It's cleaner than closures when the callable needs constructor-injected dependencies.

**Q: Why is `__clone` needed for deep copying?**
A: PHP's `clone` does a shallow copy — it copies the object's values, but object properties are copied by reference. If a `User` has an `Address` object, both the original and the clone share the same `Address`. `__clone` lets you explicitly `clone` nested objects to create truly independent copies.

**Q: When would you use `__sleep` and `__wakeup`?**
A: When your object holds a non-serializable resource — a database connection, file handle, or socket. `__sleep` returns the list of serializable properties (excluding the resource). `__wakeup` re-creates the resource after deserialization. Modern code often uses `__serialize`/`__unserialize` (PHP 7.4+) instead for more control.
