# PHP Functions

---

## 1. What is a Function? Why Functions Exist

A **function** is a named, reusable block of code that performs a specific task. You define it once and call it as many times as needed.

### The DRY Principle

**DRY** stands for **Don't Repeat Yourself**. Functions are the primary tool for eliminating duplicated logic.

```php
<?php
// BAD — repeated logic
$tax1 = 100 * 0.21;
$tax2 = 250 * 0.21;
$tax3 = 80  * 0.21;

// GOOD — single function, called multiple times
function calculateTax(float $amount, float $rate = 0.21): float
{
    return $amount * $rate;
}

$tax1 = calculateTax(100);
$tax2 = calculateTax(250);
$tax3 = calculateTax(80);
```

**Why functions exist:**
- **Reusability** — write once, use anywhere
- **DRY** — avoid duplicated logic that leads to inconsistent bugs
- **Testability** — isolated functions are easy to unit-test
- **Readability** — a well-named function is self-documenting code
- **Maintainability** — fix a bug in one place

---

## 2. Regular / Named Functions

The most common function type. Defined with the `function` keyword.

```php
<?php
function greet(string $name): string
{
    return "Hello, $name!";
}

echo greet("Alice"); // Hello, Alice!
```

### Type Hints — Parameters and Return Types

```php
<?php
function divide(float $a, float $b): float
{
    if ($b === 0.0) {
        throw new \InvalidArgumentException("Division by zero.");
    }
    return $a / $b;
}
```

### Default Parameter Values

```php
<?php
function createSlug(string $title, string $separator = '-'): string
{
    return strtolower(str_replace(' ', $separator, $title));
}

echo createSlug("Hello World");       // hello-world
echo createSlug("Hello World", '_');  // hello_world
```

> Parameters with defaults must come **after** required parameters.

### Named Arguments (PHP 8.0)

```php
<?php
function createUser(
    string $name,
    int $age = 18,
    string $role = 'viewer',
    bool $active = true
): array {
    return compact('name', 'age', 'role', 'active');
}

$user = createUser(name: 'Bob', role: 'admin');
// ['name' => 'Bob', 'age' => 18, 'role' => 'admin', 'active' => true]
```

### Passing by Reference

```php
<?php
function increment(int &$value): void
{
    $value++;
}

$count = 5;
increment($count);
echo $count; // 6
```

---

## 3. Anonymous Functions (Closures)

An anonymous function (closure) has no name. It can be stored in a variable, passed as an argument, or returned from another function.

```php
<?php
$square = function(int $n): int {
    return $n * $n;
};

echo $square(5); // 25
```

### Passing Closures as Callbacks

```php
<?php
$numbers = [1, 2, 3, 4, 5];

$doubled = array_map(function(int $n): int {
    return $n * 2;
}, $numbers);
// [2, 4, 6, 8, 10]
```

### The `use` Keyword — Capturing Outer Scope

```php
<?php
$prefix = 'Hello';

$greet = function(string $name) use ($prefix): string {
    return "$prefix, $name!";
};

echo $greet("Alice"); // Hello, Alice!
```

> Without `use ($prefix)`, the closure cannot access `$prefix`.

### By Value vs By Reference Capture

```php
<?php
// By value — captures a COPY at definition time
$message = "Hello";
$greet = function() use ($message) { echo $message; };
$message = "Goodbye";
$greet(); // still prints: Hello

// By reference — live reference
$count = 0;
$increment = function() use (&$count) { $count++; };
$increment();
$increment();
echo $count; // 2
```

### Real-life: usort with Closure

```php
<?php
$products = [
    ['name' => 'Laptop',  'price' => 999],
    ['name' => 'Mouse',   'price' => 25],
    ['name' => 'Monitor', 'price' => 350],
];

usort($products, function(array $a, array $b): int {
    return $a['price'] <=> $b['price'];
});
// Mouse: 25, Monitor: 350, Laptop: 999
```

### Real-life: array_filter with Closure

```php
<?php
$users = [
    ['name' => 'Alice', 'active' => true],
    ['name' => 'Bob',   'active' => false],
    ['name' => 'Carol', 'active' => true],
];

$activeUsers = array_filter($users, fn($user) => $user['active']);
```

**Benefits vs Disadvantages:**
| Benefit | Disadvantage |
|---------|-------------|
| Stored, passed, returned | Verbose for simple one-liners |
| Captures outer scope | `use` keyword easy to forget |
| Great for callbacks | Harder to read in stack traces |

---

## 4. Arrow Functions (PHP 7.4)

Arrow functions are **shorter closures** with auto-capture of outer scope — no `use` needed. Body is a **single expression**.

```php
<?php
$square = fn(int $n): int => $n * $n;

// Auto-captures outer scope
$taxRate = 0.21;
$addTax = fn(float $price): float => $price * (1 + $taxRate);

echo $addTax(100); // 121.0
```

### Real-life: Array Operations

```php
<?php
$users = [
    ['name' => 'Alice', 'score' => 88],
    ['name' => 'Bob',   'score' => 72],
    ['name' => 'Carol', 'score' => 95],
];

$minScore = 80;
$passing = array_filter($users, fn($u) => $u['score'] >= $minScore);
$names   = array_map(fn($u) => $u['name'], $passing);
// ['Alice', 'Carol']
```

### Arrow Function vs Closure

| Feature | Closure (`function`) | Arrow Function (`fn`) |
|---------|---------------------|----------------------|
| Syntax | Verbose | Concise |
| Outer scope capture | Explicit `use` | Automatic (by value) |
| Body | Multiple statements | Single expression only |
| Modifying outer scope | `use (&$var)` | Cannot modify outer vars |

> Use arrow functions for simple transformations. Use closures for complex logic or reference capture.

---

## 5. Variadic Functions (...$args)

Accept a **variable number of arguments** using the splat operator `...`.

```php
<?php
function sum(int ...$numbers): int
{
    return array_sum($numbers);
}

echo sum(1, 2, 3);        // 6
echo sum(10, 20, 30, 40); // 100
```

### Type-Hinted Variadic

```php
<?php
function logMessages(string $level, string ...$messages): void
{
    foreach ($messages as $msg) {
        echo "[$level] $msg\n";
    }
}

logMessages('ERROR', 'Disk full', 'Write failed', 'Aborting');
```

### Splat for Unpacking

```php
<?php
function add(int $a, int $b, int $c): int
{
    return $a + $b + $c;
}

$args = [1, 2, 3];
echo add(...$args); // 6
```

### Real-life: Flexible Query Builder

```php
<?php
function buildQuery(string $table, string ...$columns): string
{
    $cols = empty($columns) ? '*' : implode(', ', $columns);
    return "SELECT {$cols} FROM {$table}";
}

echo buildQuery('users');                         // SELECT * FROM users
echo buildQuery('users', 'id', 'name', 'email'); // SELECT id, name, email FROM users
```

---

## 6. Recursive Functions

A function that calls itself. Needs a **base case** (stops recursion) and a **recursive case** (calls self with smaller input).

### Factorial

```php
<?php
function factorial(int $n): int
{
    if ($n <= 1) return 1;           // base case
    return $n * factorial($n - 1);   // recursive case
}

echo factorial(5); // 120
```

### Real-life: Category Tree

```php
<?php
$categories = [
    ['id' => 1, 'name' => 'Electronics', 'parent_id' => null],
    ['id' => 2, 'name' => 'Laptops',     'parent_id' => 1],
    ['id' => 3, 'name' => 'Phones',      'parent_id' => 1],
    ['id' => 4, 'name' => 'Gaming',      'parent_id' => 2],
];

function buildTree(array $categories, ?int $parentId = null, int $depth = 0): void
{
    foreach ($categories as $cat) {
        if ($cat['parent_id'] === $parentId) {
            echo str_repeat('  ', $depth) . "- {$cat['name']}\n";
            buildTree($categories, $cat['id'], $depth + 1);
        }
    }
}

buildTree($categories);
// - Electronics
//   - Laptops
//     - Gaming
//   - Phones
```

### Fibonacci with Memoization

```php
<?php
function fibMemo(int $n, array &$cache = []): int
{
    if ($n <= 1) return $n;
    if (isset($cache[$n])) return $cache[$n];

    $cache[$n] = fibMemo($n - 1, $cache) + fibMemo($n - 2, $cache);
    return $cache[$n];
}

echo fibMemo(40); // 102334155 (fast)
```

### Recursion vs Iteration

| Scenario | Prefer Recursion | Prefer Iteration |
|----------|-----------------|-----------------|
| Tree/graph traversal | Yes — natural | Complex to code |
| Unknown depth (nested arrays) | Yes | Requires manual stack |
| Simple loops (sum, count) | Overkill | Yes — faster, less memory |
| Very large input | Risk stack overflow | Yes — safe |

> **Stack overflow risk:** Each call adds a frame. Very deep recursion throws `Fatal Error: Maximum function nesting level reached`.

---

## 7. Type-Hinted Functions & Return Types

### Scalar Types and void

```php
<?php
function multiply(int $a, float $b): float { return $a * $b; }
function isAdmin(string $role): bool { return $role === 'admin'; }

function logError(string $message): void
{
    file_put_contents('/var/log/app.log', $message . PHP_EOL, FILE_APPEND);
}
```

### never (PHP 8.1) — Function Never Returns

```php
<?php
function abort(int $code, string $message): never
{
    http_response_code($code);
    echo $message;
    exit();
}

function fail(string $message): never
{
    throw new \RuntimeException($message);
}
```

### Nullable (?Type), Union (|), Intersection (&)

```php
<?php
// Nullable — returns array or null
function findUser(int $id): ?array
{
    return $users[$id] ?? null;
}

// Union — accepts int or string
function formatId(int|string $id): string
{
    return is_int($id) ? "ID-$id" : strtoupper($id);
}

// Intersection (PHP 8.1) — must satisfy ALL interfaces
function process(Countable&Stringable $obj): void { /* ... */ }
```

### Type Declaration Summary

| Type | PHP Version | Meaning |
|------|------------|---------|
| `int`, `float`, `string`, `bool` | 7.0+ | Scalar types |
| `void` | 7.1+ | Returns nothing |
| `?Type` | 7.1+ | Nullable — type or null |
| `mixed` | 8.0+ | Any type |
| `int\|string` | 8.0+ | Union — one of multiple types |
| `never` | 8.1+ | Never returns normally |
| `A&B` | 8.1+ | Intersection — must satisfy all |

---

## 8. Built-in Function Categories

### String Functions

```php
<?php
strlen("Hello")                           // 5
strtolower("HELLO") / strtoupper("hello") // "hello" / "HELLO"
trim("  Hello  ")                         // "Hello"
str_replace("World", "PHP", "Hello, World!") // "Hello, PHP!"
substr("Hello World", 6, 5)              // "World"
strpos("Hello World", "World")           // 6
str_contains("Hello World", "lo")        // true  (PHP 8.0)
str_starts_with("Hello", "He")           // true  (PHP 8.0)
str_ends_with("Hello", "lo")             // true  (PHP 8.0)
str_pad("5", 3, "0", STR_PAD_LEFT)       // "005"
explode(",", "a,b,c")                    // ["a", "b", "c"]
implode("-", ["a", "b", "c"])            // "a-b-c"
sprintf("Price: %.2f", 9.5)              // "Price: 9.50"
htmlspecialchars("<b>text</b>")          // "&lt;b&gt;text&lt;/b&gt;"
```

### Array Functions

```php
<?php
count($arr)                   // count elements
array_sum([1,2,3])            // 6
array_unique([1,1,2,3,3])     // [1,2,3]
sort($arr) / rsort($arr)      // sort ascending/descending
array_reverse($arr)           // reversed copy
in_array(4, $arr)             // true/false
array_search(4, $arr)         // key of first match
array_push($arr, 10)          // append
array_pop($arr)               // remove/return last
array_shift($arr)             // remove/return first
array_unshift($arr, 0)        // prepend
array_slice($arr, 1, 3)       // portion of array
array_merge([1,2], [3,4])     // [1,2,3,4]
array_keys(['a'=>1,'b'=>2])   // ['a','b']
array_values(['a'=>1,'b'=>2]) // [1,2]
array_chunk([1,2,3,4,5], 2)  // [[1,2],[3,4],[5]]
array_flip(['a'=>1,'b'=>2])   // [1=>'a',2=>'b']
array_combine(['a','b'],[1,2]) // ['a'=>1,'b'=>2]
```

### Functional Array Helpers

```php
<?php
$numbers = [1, 2, 3, 4, 5, 6];

// array_map — transform each element
$squares = array_map(fn($n) => $n ** 2, $numbers);
// [1, 4, 9, 16, 25, 36]

// array_filter — keep elements where callback returns true
$evens = array_filter($numbers, fn($n) => $n % 2 === 0);
// [2, 4, 6]

// array_reduce — fold to single value
$product = array_reduce($numbers, fn($carry, $n) => $carry * $n, 1);
// 720
```

---

## 9. Higher-Order Functions

A higher-order function either **takes functions as arguments** or **returns a function**.

### Function Factory (Returns a Function)

```php
<?php
function makeMultiplier(int $factor): Closure
{
    return fn(int $n): int => $n * $factor;
}

$double = makeMultiplier(2);
$triple = makeMultiplier(3);

echo $double(5); // 10
echo $triple(5); // 15
```

### Pipeline Example

```php
<?php
function pipeline(mixed $value, callable ...$fns): mixed
{
    foreach ($fns as $fn) {
        $value = $fn($value);
    }
    return $value;
}

$result = pipeline(
    "  hello world  ",
    'trim',
    'strtoupper',
    fn($s) => str_replace(' ', '-', $s),
    fn($s) => $s . '!'
);

echo $result; // HELLO-WORLD!
```

### Order Total with array_reduce

```php
<?php
$orders = [
    ['product' => 'Laptop', 'qty' => 1, 'price' => 999],
    ['product' => 'Mouse',  'qty' => 2, 'price' => 25],
];

$total = array_reduce($orders, function(float $carry, array $order): float {
    return $carry + ($order['qty'] * $order['price']);
}, 0.0);

echo number_format($total, 2); // 1,049.00
```

---

## 10. First-Class Callable Syntax (PHP 8.1)

Get a `Closure` reference to any named function using `functionName(...)`.

```php
<?php
// Old way — string-based, not IDE-friendly
$lengths = array_map('strlen', ['hello', 'world']);

// PHP 8.1 — clean, IDE-safe
$lengths    = array_map(strlen(...), ['hello', 'world']);
$uppercased = array_map(strtoupper(...), ['hello', 'world']);

// With static methods
$fn = MathHelper::double(...);
echo $fn(5);

// With instance methods
$helper = new MathHelper();
$fn = $helper->triple(...);
echo $fn(5);
```

| Feature | Old `Closure::fromCallable` | New `fn(...)` |
|---------|----------------------------|---------------|
| Syntax | Verbose | Concise |
| IDE support | String — no autocomplete | Fully recognized |
| Refactor safety | Breaks silently on rename | Caught by static analysis |

---

## 11. Static Variables in Functions

A `static` variable inside a function is **initialized only once** and **retains its value** between calls.

```php
<?php
function counter(): int
{
    static $count = 0;
    return ++$count;
}

echo counter(); // 1
echo counter(); // 2
echo counter(); // 3
```

### Real-life: Config Cache

```php
<?php
function getConfig(string $key): mixed
{
    static $config = null;

    if ($config === null) {
        $config = parse_ini_file('app.ini'); // loaded only ONCE
    }

    return $config[$key] ?? null;
}
```

| Good Use Case | Avoid When |
|---------------|-----------|
| Caching expensive operations | State causes unexpected side effects |
| Sequential ID generation | Tests require resettable state |
| One-time initialization | Multiple instances need separate state |

---

## 12. Generator Functions (yield)

A generator **pauses at each `yield`**, returns a value to the caller, then **resumes from where it left off** on the next iteration. Uses almost no memory for large datasets.

```php
<?php
// Regular: builds entire array — 8MB for 1M items
function rangeArray(int $start, int $end): array
{
    $result = [];
    for ($i = $start; $i <= $end; $i++) {
        $result[] = $i;
    }
    return $result;
}

// Generator: one value at a time — constant memory
function rangeGenerator(int $start, int $end): \Generator
{
    for ($i = $start; $i <= $end; $i++) {
        yield $i;
    }
}

foreach (rangeGenerator(1, 1_000_000) as $n) {
    if ($n > 5) break;
    echo $n; // 1 2 3 4 5
}
```

### Real-life: Stream Large CSV File

```php
<?php
function readCsvRows(string $filePath): \Generator
{
    $handle = fopen($filePath, 'r');
    $headers = fgetcsv($handle);

    while (($row = fgetcsv($handle)) !== false) {
        yield array_combine($headers, $row); // one row at a time
    }

    fclose($handle);
}

// Process a 5GB CSV with minimal memory
foreach (readCsvRows('/data/sales.csv') as $row) {
    processRow($row);
}
```

### Yielding Key-Value Pairs

```php
<?php
function indexedFruits(): \Generator
{
    yield 'a' => 'apple';
    yield 'b' => 'banana';
    yield 'c' => 'cherry';
}

foreach (indexedFruits() as $key => $value) {
    echo "$key: $value\n";
}
```

### Generator vs Array

| Feature | Array | Generator |
|---------|-------|-----------|
| Memory | All data loaded at once | One item at a time |
| Rewindable | Yes | No (one-pass only) |
| Lazy evaluation | No | Yes |
| Infinite sequences | Not possible | Possible |
| Use case | Small, reusable collections | Large datasets, streams |

---

## Interview Q&A

**Q: What is the difference between a closure and an arrow function?**
A: Both are anonymous functions. A closure uses `function` keyword, requires explicit `use` to access outer scope, and supports multi-statement bodies. An arrow function uses `fn`, auto-captures outer scope by value (no `use` needed), but only supports a single expression body. Use arrow functions for simple one-liners, closures for complex logic.

**Q: What does `use (&$var)` do in a closure?**
A: It captures the variable by reference rather than by value. The closure and the outer scope share the same variable, so changes inside the closure affect the original and vice versa. Without `&`, only a copy is captured at definition time.

**Q: What is `strict_types=1` and how does it affect type-hinted functions?**
A: Declaring `strict_types=1` at the top of a file makes PHP enforce type declarations strictly for all function calls in that file. Without it, PHP silently coerces types (e.g., `"5"` → `5`). With it, a type mismatch throws a `TypeError`. It only applies to the file declaring it.

**Q: What is the difference between `void` and `never` return types?**
A: `void` means the function returns nothing but does return to the caller (can use a bare `return;`). `never` (PHP 8.1) means the function never returns to the caller at all — it always throws an exception or calls `exit()`.

**Q: What are generators and why are they memory-efficient?**
A: Generators use `yield` to produce values one at a time, pausing between each. Unlike building an array (which holds all elements in memory), a generator keeps only the current value. Perfect for processing large files, database result sets, or infinite sequences.

**Q: What is the first-class callable syntax in PHP 8.1?**
A: `strlen(...)` creates a `Closure` equivalent to `Closure::fromCallable('strlen')`. It's IDE-safe, refactor-safe (caught by static analysis if renamed), and cleaner than passing function names as strings.

**Q: What is a higher-order function? Give a PHP example.**
A: A function that takes or returns other functions. PHP's `array_map`, `array_filter`, and `array_reduce` are built-in examples. Custom: `function makeMultiplier(int $n): Closure { return fn($x) => $x * $n; }` — returns a new function each call.

**Q: What is a static variable inside a function?**
A: Initialized only once on first call, then retains its value between subsequent calls. Useful for caching (loading config once), sequential ID generation, or counting invocations without global variables.
