# PHP Control Structures

Control structures direct the **flow of execution** in a PHP script. Without them, code runs top to bottom with no decisions, no repetition, and no flexibility. Every real application depends on them.

---

## 1. Conditional Statements

### if / elseif / else

The most fundamental control structure — run code only when a condition is true.

```php
<?php
$age = 20;

if ($age < 18) {
    echo "Minor";
} elseif ($age >= 18 && $age < 65) {
    echo "Adult";
} else {
    echo "Senior";
}
```

**Real-life use case — user access check:**
```php
<?php
function getAccessLevel(User $user): string
{
    if ($user->isAdmin()) {
        return 'full';
    } elseif ($user->isEditor()) {
        return 'edit';
    } else {
        return 'read-only';
    }
}
```

**Best practice — Early Return Pattern (avoid deep nesting):**
```php
<?php
// Bad — pyramid of doom
function processOrder(Order $order): void
{
    if ($order->isPaid()) {
        if ($order->isInStock()) {
            if ($order->hasShippingAddress()) {
                // ship it
            }
        }
    }
}

// Good — fail fast with early returns
function processOrder(Order $order): void
{
    if (!$order->isPaid()) {
        throw new \RuntimeException('Order not paid');
    }

    if (!$order->isInStock()) {
        throw new \RuntimeException('Out of stock');
    }

    if (!$order->hasShippingAddress()) {
        throw new \RuntimeException('No shipping address');
    }

    // ship it — clean and clear
}
```

> **Interview:** Why prefer early returns over deep nesting?
> Early returns reduce cyclomatic complexity, make code linear and readable, and fail fast — catching problems early rather than burying success logic deep inside conditions.

---

## 2. Loops

Loops repeat a block of code while a condition holds.

### for Loop

Use when you know exactly **how many times** to iterate.

```php
<?php
// Basic
for ($i = 0; $i < 5; $i++) {
    echo $i; // 0 1 2 3 4
}

// Countdown
for ($i = 10; $i > 0; $i--) {
    echo $i . ' ';
}

// Loop through indexed array by position
$items = ['apple', 'banana', 'cherry'];
for ($i = 0; $i < count($items); $i++) {
    echo $items[$i];
}
```

**Real-life:** Generating paginated page numbers:
```php
<?php
$totalPages = 10;
for ($page = 1; $page <= $totalPages; $page++) {
    echo "<a href='?page={$page}'>{$page}</a> ";
}
```

---

### while Loop

Use when you don't know **how many iterations** — keep going while condition is true.

```php
<?php
$retries = 0;
$maxRetries = 3;

while ($retries < $maxRetries) {
    $success = attemptApiCall();
    if ($success) break;
    $retries++;
    sleep(1);
}
```

**Real-life — reading a file line by line:**
```php
<?php
$handle = fopen('large-file.csv', 'r');

while (($line = fgets($handle)) !== false) {
    processLine($line);
}

fclose($handle);
```

**Difference from for:** `while` has no built-in counter — it's purely condition-based. Use `for` when you have a counter, `while` when you're waiting for a state change.

---

### do...while Loop

Same as `while` but **always executes at least once** — the condition is checked AFTER the first run.

```php
<?php
$input = '';

do {
    $input = readline("Enter a number: ");
} while (!is_numeric($input));

echo "You entered: $input";
```

**Real-life:** Menu-driven CLI app that must show menu at least once:
```php
<?php
do {
    $choice = showMenuAndGetChoice();
    handleChoice($choice);
} while ($choice !== 'exit');
```

> **Interview:** When would you use `do...while` instead of `while`?
> When the action must happen at least once before the check — like showing a menu, asking for user input, or making an initial request before deciding to retry.

---

### foreach Loop

Designed for **arrays and iterables** — the cleanest way to loop over collections.

```php
<?php
// Indexed array
$fruits = ['apple', 'banana', 'cherry'];
foreach ($fruits as $fruit) {
    echo $fruit;
}

// Associative array
$user = ['name' => 'Alice', 'email' => 'alice@example.com'];
foreach ($user as $key => $value) {
    echo "{$key}: {$value}\n";
}

// Modify array values by reference (&)
$prices = [10.0, 20.0, 30.0];
foreach ($prices as &$price) {
    $price *= 1.1; // 10% increase
}
unset($price); // IMPORTANT: break reference after loop

// Multidimensional
$orders = [
    ['id' => 1, 'total' => 99.99],
    ['id' => 2, 'total' => 149.99],
];
foreach ($orders as $order) {
    echo "Order #{$order['id']}: \${$order['total']}\n";
}
```

> **Interview:** Why must you `unset($value)` after a `foreach` by reference?
> After the loop ends, `$value` still holds a reference to the last element. If you later modify `$value`, it modifies the last array element. `unset()` breaks the reference to prevent accidental mutation.

---

### break and continue

**`break`** — exits the loop entirely.
**`continue`** — skips the rest of the current iteration and jumps to the next.

```php
<?php
// break — stop when found
$users = [1, 2, 3, 4, 5];
foreach ($users as $id) {
    if ($id === 3) {
        echo "Found user 3!";
        break; // stop looking
    }
}

// continue — skip inactive users
foreach ($users as $user) {
    if (!$user['active']) {
        continue; // skip this one
    }
    sendEmail($user);
}

// break/continue with levels (nested loops)
for ($i = 0; $i < 3; $i++) {
    for ($j = 0; $j < 3; $j++) {
        if ($j === 1) {
            break 2; // break BOTH loops
        }
        echo "$i,$j ";
    }
}
```

---

## 3. switch Statement

`switch` evaluates an expression once and compares against multiple **cases using loose (==) comparison**.

```php
<?php
$status = 'pending';

switch ($status) {
    case 'pending':
        echo 'Order is pending';
        break;
    case 'paid':
        echo 'Order is paid';
        break;
    case 'shipped':
    case 'delivered': // Intentional fallthrough — both do same thing
        echo 'Order is on its way';
        break;
    default:
        echo 'Unknown status';
}
```

**Key behaviors:**
- Uses **loose `==` comparison** (type coercion applies)
- **Falls through** to next case if `break` is missing — can be intentional or a bug
- `default` runs if no case matches (optional but recommended)

**Pitfall — loose comparison:**
```php
<?php
$value = 0;
switch ($value) {
    case false:  // 0 == false is TRUE — unexpected match!
        echo 'false matched';
        break;
    case 0:
        echo 'zero matched';
        break;
}
// Output: "false matched" — surprising!
```

---

## 4. match Expression (PHP 8.0)

`match` is the modern, safer replacement for `switch`. It's an **expression** (returns a value), uses **strict === comparison**, and has **no fallthrough**.

```php
<?php
$status = 'paid';

$message = match($status) {
    'pending' => 'Order is pending',
    'paid'    => 'Order is paid',
    'shipped', 'delivered' => 'Order is on its way', // multiple arms
    default   => 'Unknown status',
};

echo $message; // "Order is paid"
```

**match with no-match throws an error:**
```php
<?php
$status = 'unknown';

// This throws UnhandledMatchError if no arm matches and no default
$result = match($status) {
    'paid' => 'Paid',
    'pending' => 'Pending',
    // No default — throws UnhandledMatchError
};
```

**match as inline expression:**
```php
<?php
$discount = match(true) {
    $cart->total() > 500 => 0.20,
    $cart->total() > 200 => 0.10,
    $cart->total() > 100 => 0.05,
    default              => 0.00,
};
```

---

## 5. match vs switch — Full Comparison

| Feature | `switch` | `match` |
|---------|----------|---------|
| Comparison | Loose `==` | Strict `===` |
| Returns value | No (executes block) | Yes (is an expression) |
| Fallthrough | Yes (need `break`) | No (never falls through) |
| No match behavior | Silent (uses default or nothing) | Throws `UnhandledMatchError` |
| Multiple conditions | `case a: case b:` (stack) | `a, b =>` (comma-separated) |
| PHP version | All versions | PHP 8.0+ |

**Same scenario — both ways:**
```php
<?php
$role = 'editor';

// switch — old way
switch ($role) {
    case 'admin':
        $access = 'full';
        break;
    case 'editor':
        $access = 'write';
        break;
    default:
        $access = 'read';
}

// match — modern way (cleaner!)
$access = match($role) {
    'admin'  => 'full',
    'editor' => 'write',
    default  => 'read',
};
```

**When to use which:**
- Use `match` in PHP 8+ — it's safer, cleaner, and returns a value
- Use `switch` only for legacy codebases or when you need intentional fallthrough
- Never rely on accidental `switch` fallthrough — it's a common source of bugs

---

## 6. return Statement

`return` exits the current function and optionally sends a value back.

```php
<?php
// Return a value
function add(int $a, int $b): int
{
    return $a + $b;
}

// Return nothing (void)
function logMessage(string $msg): void
{
    file_put_contents('app.log', $msg . PHP_EOL, FILE_APPEND);
    return; // optional — PHP exits function here anyway
}

// Returning multiple values (as array)
function getMinMax(array $numbers): array
{
    return [min($numbers), max($numbers)];
}

[$min, $max] = getMinMax([3, 1, 9, 5]);
```

**Early return for guards:**
```php
<?php
function calculateDiscount(int $total): float
{
    if ($total <= 0) {
        return 0.0; // guard clause — exit early
    }

    if ($total < 100) {
        return 0.05;
    }

    return 0.10;
}
```

---

## 7. declare Statement

`declare` sets **execution directives** for a block of code or the entire file.

### declare(strict_types=1)

**What problem does it solve?** PHP coerces types by default. `function add(int $a, int $b)` called with `add("3", "5")` would silently work in non-strict mode, converting strings to ints. With strict types, it throws a `TypeError`.

```php
<?php
declare(strict_types=1); // MUST be first line of file

function add(int $a, int $b): int
{
    return $a + $b;
}

add(3, 5);      // OK
add(3.5, 5);    // TypeError — float not int
add("3", "5");  // TypeError — string not int
```

**Benefits:**
- Catches type bugs at the call site
- Makes function signatures trustworthy
- Encourages explicit type handling

**Rules:**
- Must be the very first statement in the file
- Applies only to the file it's declared in (not included files)
- Only affects internal PHP type checks (not user-defined)

### declare(ticks=N)

```php
<?php
declare(ticks=1); // call tick function after every N tickable statements

register_tick_function(function () {
    // called after every tickable statement
    // e.g., for profiling, debugging
});

$a = 1; // tick fires here
$b = 2; // tick fires here
$c = $a + $b; // tick fires here
```

**When used:** Rarely in modern PHP. Historically used for signal handling, profiling, or implementing cooperative multitasking.

### declare(encoding='UTF-8')

```php
<?php
declare(encoding='UTF-8');
// Tells PHP the source file encoding
// Rarely needed — most editors default to UTF-8
```

---

## 8. Tickable Statements

A **tick** is an internal event that fires after every N **tickable statements** (simple statements that PHP can tick on — assignments, function calls, etc.). Not all statements are tickable (e.g., `declare` itself is not).

```php
<?php
declare(ticks=1);

function myTickHandler(): void
{
    static $count = 0;
    $count++;
    echo "Tick #$count\n";
}

register_tick_function('myTickHandler');

$x = 1;    // Tick #1
$y = 2;    // Tick #2
$z = $x + $y; // Tick #3
```

**Why it exists:** Allows inserting logic between every statement — useful for profiling execution, debugging, or handling POSIX signals in long-running CLI scripts.

**Why rarely used today:**
- Performance overhead on every statement
- Modern alternatives (Xdebug for profiling, event loops for async) are better
- Most web apps don't need it

---

## 9. include and require

PHP allows splitting code across files and loading them at runtime.

### include

Loads and executes a PHP file. If the file is **not found**, emits a **warning** and continues execution.

```php
<?php
include 'header.php';      // relative path
include '/var/www/config.php'; // absolute path
include __DIR__ . '/utils.php'; // best practice — reliable path
```

### require

Same as `include` but if the file is **not found**, throws a **fatal error** and stops execution.

```php
<?php
require __DIR__ . '/config.php'; // Must exist — app can't run without it
require __DIR__ . '/database.php';
```

**When to use:**
- Use `require` for critical files (config, DB, bootstrap) — app cannot function without them
- Use `include` for optional parts (templates, widgets) — app can survive without them

### include_once and require_once

Ensure a file is loaded **only once**, even if the statement is encountered multiple times.

```php
<?php
require_once __DIR__ . '/Database.php'; // Only loads once even if called 10x
include_once __DIR__ . '/helpers.php';
```

**Why they exist:** Prevent function/class redeclaration errors when the same file is included from multiple places.

```php
<?php
// Without _once — causes "Cannot redeclare class User"
include 'User.php'; // loads class User
include 'User.php'; // Fatal Error: Cannot redeclare class User

// With _once — safe
require_once 'User.php';
require_once 'User.php'; // Second call is ignored
```

**Performance note:** `_once` checks a registry of loaded files on every call — slightly slower than plain `include`/`require`. In modern apps using Composer autoloading, you rarely need `_once` yourself.

### Comparison Table

| | `include` | `require` | `include_once` | `require_once` |
|---|-----------|-----------|----------------|----------------|
| File missing | Warning, continues | Fatal error, stops | Warning, continues | Fatal error, stops |
| Load once | No | No | Yes | Yes |
| Use for | Optional files | Critical files | Optional, re-included | Critical, re-included |

### Path Resolution

```php
<?php
// Bad — depends on include_path setting
include 'config.php';

// Good — always resolves relative to current file
require __DIR__ . '/config.php';

// Even better with constants
define('BASE_PATH', dirname(__DIR__));
require BASE_PATH . '/config/database.php';
```

**Real-life — before Composer existed:**
```php
<?php
// index.php
require_once __DIR__ . '/config/config.php';
require_once __DIR__ . '/lib/Database.php';
require_once __DIR__ . '/lib/User.php';
require_once __DIR__ . '/lib/Router.php';
```

---

## Interview Q&A

**Q: What is the difference between `include` and `require`?**
A: Both load and execute a PHP file. `include` emits a warning and continues if the file is missing. `require` throws a fatal error and halts execution. Use `require` for files the application cannot work without.

**Q: What's the difference between `for`, `while`, and `foreach`?**
A: `for` is for counted loops with a known number of iterations. `while` is condition-based and runs as long as the condition is true. `foreach` is specifically designed for iterating over arrays and Traversable objects — it's the cleanest option for collections.

**Q: What is `match` and how is it better than `switch`?**
A: `match` (PHP 8.0) is an expression that uses strict `===` comparison, never falls through between arms, returns a value, and throws `UnhandledMatchError` if no arm matches without a default. `switch` uses loose `==`, falls through silently without `break`, and doesn't return a value.

**Q: When would you use `do...while` instead of `while`?**
A: When the loop body must execute at least once before the condition is checked — like user input prompts, showing a menu, or making an initial connection attempt.

**Q: Why is `declare(strict_types=1)` important?**
A: It prevents PHP from silently coercing types in function arguments, making type declarations meaningful. Without it, calling `add(int $a, int $b)` with strings silently works. With it, a `TypeError` is thrown, catching bugs early.

**Q: What is the difference between `break` and `continue`?**
A: `break` exits the loop entirely. `continue` skips the remainder of the current iteration and jumps to the next one. Both can take an optional integer argument to affect outer loops (`break 2` exits two levels of nesting).

**Q: When should you use early return?**
A: To avoid deep nesting (the "pyramid of doom"). Instead of wrapping the main logic in multiple `if` conditions, guard against invalid states at the top of the function with early returns — making the happy path read linearly.
