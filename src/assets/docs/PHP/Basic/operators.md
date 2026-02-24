# PHP Operators

Operators are symbols that tell PHP to perform operations on values (operands). Understanding them deeply is essential — interviewers love testing edge cases like `==` vs `===`, operator precedence, and the spaceship operator.

---

## 1. Arithmetic Operators

Used for basic math operations.

| Operator | Name | Example | Result |
|----------|------|---------|--------|
| `+` | Addition | `5 + 3` | `8` |
| `-` | Subtraction | `5 - 3` | `2` |
| `*` | Multiplication | `5 * 3` | `15` |
| `/` | Division | `10 / 3` | `3.333...` |
| `%` | Modulo | `10 % 3` | `1` |
| `**` | Exponentiation | `2 ** 8` | `256` |

```php
<?php
$a = 10;
$b = 3;

echo $a + $b;   // 13
echo $a - $b;   // 7
echo $a * $b;   // 30
echo $a / $b;   // 3.3333...
echo $a % $b;   // 1  (remainder of 10/3)
echo $a ** $b;  // 1000 (10 to the power of 3)

// Integer vs float division
echo 10 / 2;    // 5 (integer)
echo 10 / 3;    // 3.333... (float)
echo intdiv(10, 3); // 3 (integer division function)
```

**Real-life use case — modulo for pagination:**
```php
<?php
$totalItems = 47;
$perPage = 10;
$pages = ceil($totalItems / $perPage);     // 5 pages
$remainder = $totalItems % $perPage;       // 7 items on last page

// Modulo for alternating row colors
foreach ($items as $index => $item) {
    $class = ($index % 2 === 0) ? 'even' : 'odd';
    echo "<tr class='{$class}'>";
}
```

> **Interview:** What does `10 % 3` return? `1` — the remainder. Modulo is great for checking even/odd, cycling through indexes, and pagination logic.

---

## 2. Assignment Operators

Assign values to variables. Compound assignment operators combine an operation with assignment.

| Operator | Equivalent | Example |
|----------|-----------|---------|
| `=` | — | `$a = 5` |
| `+=` | `$a = $a + n` | `$a += 3` → `8` |
| `-=` | `$a = $a - n` | `$a -= 3` → `2` |
| `*=` | `$a = $a * n` | `$a *= 3` → `15` |
| `/=` | `$a = $a / n` | `$a /= 2` → `2.5` |
| `%=` | `$a = $a % n` | `$a %= 3` → `2` |
| `**=` | `$a = $a ** n` | `$a **= 2` → `25` |
| `.=` | `$a = $a . s` | `$a .= 'world'` |

```php
<?php
$total = 0;

$total += 29.99;   // add product price
$total += 9.99;    // add shipping
$total -= 5.00;    // apply discount
$total *= 1.20;    // add 20% VAT

$message = 'Hello';
$message .= ', World!';  // "Hello, World!" — string concatenation
```

---

## 3. Comparison Operators

Used to compare values. The most important interview topic here is `==` vs `===`.

| Operator | Name | Example | Result |
|----------|------|---------|--------|
| `==` | Equal (loose) | `"1" == 1` | `true` |
| `===` | Identical (strict) | `"1" === 1` | `false` |
| `!=` | Not equal (loose) | `"1" != 2` | `true` |
| `!==` | Not identical (strict) | `"1" !== 1` | `true` |
| `<` | Less than | `3 < 5` | `true` |
| `>` | Greater than | `5 > 3` | `true` |
| `<=` | Less than or equal | `3 <= 3` | `true` |
| `>=` | Greater than or equal | `5 >= 6` | `false` |
| `<=>` | Spaceship | `3 <=> 5` | `-1` |

### == vs === (The Most Important Distinction)

`==` uses **type coercion** (converts types before comparing).
`===` checks **both value AND type** — no coercion.

```php
<?php
// == loose comparison — type juggling can surprise you
var_dump(0 == "foo");    // true  in PHP 7 (!!), false in PHP 8
var_dump(0 == "");       // true  in PHP 7, false in PHP 8
var_dump("1" == 1);      // true  — string "1" coerced to int 1
var_dump(null == false); // true
var_dump("" == false);   // true
var_dump(0 == false);    // true
var_dump("0" == false);  // true
var_dump(100 == "100px"); // true in PHP 7 — scary!

// === strict comparison — no surprises
var_dump("1" === 1);     // false — different types
var_dump(null === false); // false
var_dump(1 === true);    // false
var_dump(1 === 1);       // true
```

> **Rule:** Always use `===` unless you explicitly need type coercion. It prevents subtle bugs.

**Real-life bug caused by `==`:**
```php
<?php
// Checking if user ID exists — using ==
$userId = getUserIdFromSession(); // returns null if not logged in

if ($userId == 0) {  // BUG: null == 0 is true!
    redirect('/login');
}

// Safe with ===
if ($userId === null || $userId === 0) {
    redirect('/login');
}
```

---

## 4. Logical Operators

Combine boolean expressions. PHP has two sets — `&&`/`||` and `and`/`or` — with different precedence.

| Operator | Name | Example | Result |
|----------|------|---------|--------|
| `&&` | AND | `true && false` | `false` |
| `\|\|` | OR | `true \|\| false` | `true` |
| `!` | NOT | `!true` | `false` |
| `and` | AND (low precedence) | — | — |
| `or` | OR (low precedence) | — | — |
| `xor` | XOR | `true xor true` | `false` |

### && vs and (Critical Difference!)

`&&` has **higher precedence** than `=`.
`and` has **lower precedence** than `=`.

```php
<?php
// && — works as expected
$result = true && false;
// Parsed as: $result = (true && false) → $result = false

// 'and' — assignment happens FIRST!
$result = true and false;
// Parsed as: ($result = true) and false → $result = true  ← SURPRISE!

// Real danger with 'and'
$db = getConnection() or die('Cannot connect');
// OR — works fine here because 'or' after 'die' is fine

// Safe pattern — always use && and ||
if ($user->isActive() && $user->hasPermission('edit')) {
    // ...
}
```

**Short-circuit evaluation:**
```php
<?php
// && — if left is false, right is NOT evaluated
$user = null;
if ($user !== null && $user->isActive()) { // Safe — no null error
    echo 'Active';
}

// || — if left is true, right is NOT evaluated
$config = $override ?? null;
$value = $config || getDefaultConfig(); // getDefaultConfig() only called if $config is falsy
```

**XOR — exclusive OR:**
```php
<?php
// XOR is true only when exactly ONE side is true
var_dump(true xor true);   // false — both true
var_dump(true xor false);  // true
var_dump(false xor true);  // true
var_dump(false xor false); // false — both false

// Use case: toggle logic, mutual exclusion
```

---

## 5. String Operators

| Operator | Name | Example | Result |
|----------|------|---------|--------|
| `.` | Concatenation | `"Hello" . " World"` | `"Hello World"` |
| `.=` | Concat-assign | `$s .= "!"` | appends `!` |

```php
<?php
$first = 'John';
$last  = 'Doe';
$full  = $first . ' ' . $last; // "John Doe"

// Building SQL query (use parameterized queries in real code!)
$query = 'SELECT * FROM users';
$query .= ' WHERE active = 1';
$query .= ' ORDER BY name';

// String interpolation is often cleaner
$greeting = "Hello, {$first}!"; // "Hello, John!"
```

**Performance note:** For many concatenations, use `implode()` or build into an array:
```php
<?php
// Slow for large loops
$output = '';
foreach ($items as $item) {
    $output .= "<li>{$item}</li>"; // each .= creates a new string
}

// Faster
$parts = [];
foreach ($items as $item) {
    $parts[] = "<li>{$item}</li>";
}
$output = implode('', $parts);
```

---

## 6. Array Operators

| Operator | Name | Description |
|----------|------|-------------|
| `+` | Union | Merges arrays (keeps left keys on conflict) |
| `==` | Equality | Same key-value pairs (type coercion) |
| `===` | Identity | Same pairs, same types, same order |
| `!=` / `<>` | Inequality | Not equal |
| `!==` | Non-identity | Not identical |

```php
<?php
$a = ['color' => 'red', 'size' => 'M'];
$b = ['color' => 'blue', 'weight' => '500g'];

// Union — left side wins on key conflict
$c = $a + $b;
// ['color' => 'red', 'size' => 'M', 'weight' => '500g']
// 'color' stays 'red' — left array wins

// Compare
$x = ['a' => 1, 'b' => 2];
$y = ['b' => 2, 'a' => 1];
var_dump($x == $y);   // true  — same key-value pairs
var_dump($x === $y);  // false — different order

// Real use: default config + user overrides
$defaults = ['timeout' => 30, 'retries' => 3, 'debug' => false];
$userConfig = ['debug' => true];
$config = $userConfig + $defaults; // user overrides, defaults fill in rest
```

> **Interview:** What's the difference between `array_merge()` and `+` for arrays?
> `array_merge()` re-indexes numeric keys and right side wins on string key conflicts. `+` keeps left side on string key conflicts and preserves all numeric keys.

---

## 7. Bitwise Operators

Operate on individual **bits** of integers. Less common in everyday PHP, but appear in flag systems and permissions.

| Operator | Name | Example | Result |
|----------|------|---------|--------|
| `&` | AND | `5 & 3` | `1` |
| `\|` | OR | `5 \| 3` | `7` |
| `^` | XOR | `5 ^ 3` | `6` |
| `~` | NOT | `~5` | `-6` |
| `<<` | Left shift | `5 << 1` | `10` |
| `>>` | Right shift | `5 >> 1` | `2` |

**Real-life use — bitmask permissions:**
```php
<?php
// Define permissions as powers of 2
const PERM_READ    = 1;  // 001
const PERM_WRITE   = 2;  // 010
const PERM_DELETE  = 4;  // 100
const PERM_ADMIN   = 8;  // 1000

// Combine permissions with OR
$userPermissions = PERM_READ | PERM_WRITE; // 3 = 011

// Check a permission with AND
if ($userPermissions & PERM_READ) {
    echo 'Can read';
}
if ($userPermissions & PERM_DELETE) {
    echo 'Can delete'; // Won't print
}

// Remove a permission with AND NOT
$userPermissions &= ~PERM_WRITE; // Remove write

// PHP's own error constants use bitmasking
error_reporting(E_ALL & ~E_DEPRECATED);
```

---

## 8. Type Operators

### instanceof

Checks if an object is an instance of a class or implements an interface.

```php
<?php
interface Loggable {}
class User implements Loggable {}
class AdminUser extends User {}

$user = new AdminUser();

var_dump($user instanceof AdminUser); // true
var_dump($user instanceof User);      // true — inheritance
var_dump($user instanceof Loggable);  // true — implements interface

// Real-life — handling different types polymorphically
function process(mixed $item): void
{
    if ($item instanceof Payable) {
        $item->charge();
    } elseif ($item instanceof Refundable) {
        $item->refund();
    }
}

// Better: use match with instanceof
$result = match(true) {
    $item instanceof Payable    => $item->charge(),
    $item instanceof Refundable => $item->refund(),
    default                     => throw new \InvalidArgumentException(),
};
```

---

## 9. Null Coalescing Operator (??)

Returns the left operand if it exists and is **not null**, otherwise returns the right operand. Introduced in PHP 7.0.

```php
<?php
// Before PHP 7 — verbose
$name = isset($_GET['name']) ? $_GET['name'] : 'Guest';

// PHP 7+ — clean
$name = $_GET['name'] ?? 'Guest';

// Chains (left to right)
$value = $a ?? $b ?? $c ?? 'default';

// Real-life: config with fallback
$timeout = $config['db']['timeout'] ?? $env['DB_TIMEOUT'] ?? 30;

// Nested array access — no need to check each level
$city = $user['address']['city'] ?? 'Unknown';
// No error even if 'address' key doesn't exist
```

### ??= (Null Coalescing Assignment — PHP 7.4)

Assigns the right value only if the left is null.

```php
<?php
$data = [];

// Old way
$data['count'] = $data['count'] ?? 0;

// ??= shorthand
$data['count'] ??= 0;
$data['count']++;

// Useful for lazy initialization
$this->cache ??= new Cache();
```

> **Interview:** What's the difference between `??` and `?:`?
> `??` checks for null specifically. `?:` (Elvis) checks for falsiness — so `0 ?? 'default'` returns `0`, but `0 ?: 'default'` returns `'default'`.

---

## 10. Ternary Operator (?:)

A shorthand if-else that returns one of two values.

```php
<?php
// Standard ternary
$status = $user->isActive() ? 'Active' : 'Inactive';

// Equivalent to:
if ($user->isActive()) {
    $status = 'Active';
} else {
    $status = 'Inactive';
}
```

### Elvis Operator (?:)

Shorthand ternary — if left side is truthy, return it; otherwise return right.

```php
<?php
$name = $input ?: 'Anonymous'; // if $input is falsy, use 'Anonymous'
// Equivalent to: $input ? $input : 'Anonymous'

// Difference from ??
$value = 0;
echo $value ?: 'default';  // "default" — 0 is falsy
echo $value ?? 'default';  // 0 — 0 is not null
```

> **Warning:** Avoid nesting ternaries — PHP 8 deprecated left-associative ternary chaining. Use parentheses or if-else.

```php
<?php
// PHP 8 throws deprecation warning for this:
$x = $a ? 'a' : $b ? 'b' : 'c'; // Ambiguous!

// Do this instead:
$x = $a ? 'a' : ($b ? 'b' : 'c'); // Clear with parentheses
```

---

## 11. Spaceship Operator (<=>)

Returns `-1`, `0`, or `1` — whether left is less than, equal to, or greater than right. Introduced in PHP 7. Perfect for custom sort functions.

```php
<?php
echo 1 <=> 2;   // -1 (1 is less)
echo 2 <=> 2;   //  0 (equal)
echo 3 <=> 2;   //  1 (3 is greater)

echo "a" <=> "b"; // -1
echo "b" <=> "a"; //  1

// Real-life — custom sort
$products = [
    ['name' => 'Laptop', 'price' => 999],
    ['name' => 'Phone',  'price' => 499],
    ['name' => 'Tablet', 'price' => 699],
];

// Sort by price ascending
usort($products, fn($a, $b) => $a['price'] <=> $b['price']);

// Sort by name descending
usort($products, fn($a, $b) => $b['name'] <=> $a['name']);

// Multi-column sort
usort($products, function($a, $b) {
    return [$a['category'], $a['price']] <=> [$b['category'], $b['price']];
});
```

> **Interview:** What is the spaceship operator used for?
> Primarily used in `usort()`, `uasort()`, and `uksort()` callbacks — it replaces the pattern of returning -1/0/1 manually from comparisons.

---

## 12. Error Control Operator (@)

Suppresses error messages from an expression. Widely considered **bad practice**.

```php
<?php
// With @, PHP silently ignores any error from this call
$result = @file_get_contents('missing-file.txt');
if ($result === false) {
    // Handle it properly
}

// Without @ — better approach
if (file_exists('file.txt')) {
    $result = file_get_contents('file.txt');
}

// Or use try/catch for modern PHP
try {
    $result = file_get_contents('file.txt');
} catch (\Exception $e) {
    // handle
}
```

**Why `@` is bad:**
- Hides real errors — makes debugging a nightmare
- Performance cost — PHP still generates the error internally
- PHP 8+ makes some errors uncatchable regardless of `@`
- The "right" fix is almost always to validate before acting or catch the exception

---

## 13. Spread / Splat Operator (...)

Unpacks arrays/iterables into argument lists, or collects multiple arguments into an array.

```php
<?php
// Unpack array as function arguments
function add(int $a, int $b, int $c): int
{
    return $a + $b + $c;
}

$numbers = [1, 2, 3];
echo add(...$numbers); // 6

// Collect variadic arguments
function sum(int ...$numbers): int
{
    return array_sum($numbers);
}

echo sum(1, 2, 3, 4, 5); // 15

// Array spreading (PHP 7.4+)
$first = [1, 2, 3];
$second = [4, 5, 6];
$merged = [...$first, ...$second]; // [1, 2, 3, 4, 5, 6]

// Spread with string keys (PHP 8.1+)
$defaults = ['color' => 'red', 'size' => 'M'];
$override = ['color' => 'blue'];
$result = [...$defaults, ...$override]; // ['color' => 'blue', 'size' => 'M']

// Real-life: forwarding arguments
function createUser(string $name, string $email, int $age): User
{
    return new User($name, $email, $age);
}

$args = ['Alice', 'alice@example.com', 30];
$user = createUser(...$args);
```

---

## 14. Operator Precedence

PHP evaluates operators in a specific order. Higher precedence = evaluated first.

| Precedence | Operators |
|------------|-----------|
| Highest | `clone`, `new` |
| | `**` |
| | `++`, `--`, `~`, `(int)`, `(float)`, `(string)`, `(array)`, `(object)`, `(bool)`, `@` |
| | `instanceof` |
| | `!` |
| | `*`, `/`, `%` |
| | `+`, `-`, `.` |
| | `<<`, `>>` |
| | `<`, `<=`, `>`, `>=` |
| | `==`, `!=`, `===`, `!==`, `<=>` |
| | `&` |
| | `^` |
| | `\|` |
| | `&&` |
| | `\|\|` |
| | `??` |
| | `?:` (ternary) |
| | `=`, `+=`, `-=`, etc. |
| | `yield from`, `yield` |
| | `print` |
| | `and` |
| | `xor` |
| Lowest | `or` |

**Why it matters — precedence bugs:**
```php
<?php
// Bug: + has higher precedence than .
echo "Total: " . 2 + 3; // "3" — not "Total: 5"!
// Parsed as: ("Total: " . 2) + 3 → "Total: 2" + 3 → 3

// Fix with parentheses
echo "Total: " . (2 + 3); // "Total: 5"

// Bug: && vs and
$result = true && false;  // false — correct
$result = true and false; // true  — 'and' is lower than =

// Always use parentheses when in doubt!
$isValid = ($age >= 18) && ($hasId === true);
```

---

## Interview Q&A

**Q: What is the difference between `==` and `===`?**
A: `==` is loose equality — it converts types before comparing (`"1" == 1` is `true`). `===` is strict equality — it checks both value and type (`"1" === 1` is `false`). Always prefer `===` to avoid type coercion surprises.

**Q: What does the spaceship operator (`<=>`) return?**
A: `-1` if the left side is less, `0` if equal, `1` if the left side is greater. It's most useful in `usort()` callbacks where you need to return a comparison result.

**Q: What is the null coalescing operator `??` and how does it differ from `?:`?**
A: `??` returns the left operand if it's not null, otherwise the right. `?:` (Elvis) returns the left if it's truthy, otherwise the right. So `0 ?? 'x'` returns `0` (not null), but `0 ?: 'x'` returns `'x'` (0 is falsy).

**Q: Why is the `@` error suppression operator bad practice?**
A: It silently hides errors, making bugs invisible and debugging extremely difficult. It has a performance cost. The correct approach is to validate conditions before operations or use proper exception handling.

**Q: What is the difference between `&&` and `and` in PHP?**
A: Both are logical AND, but `&&` has higher precedence than assignment `=`, while `and` has lower precedence. This means `$x = true and false` sets `$x` to `true` (assignment happens first), while `$x = true && false` sets `$x` to `false`. Always use `&&` and `||`.

**Q: What does the spread operator (`...`) do?**
A: It unpacks an array into a function's argument list, or collects multiple function arguments into an array (variadic). In PHP 8.1+, it also supports string key spreading for arrays.

**Q: Explain operator precedence and give an example where it causes a bug.**
A: Operator precedence determines which operators are evaluated first. A classic bug: `echo "Result: " . 1 + 2` outputs `"3"` not `"Result: 3"` because `.` and `+` have the same precedence and `.` runs first, turning `"Result: 1"` into a number and then adding 2. Fix: use parentheses — `echo "Result: " . (1 + 2)`.
