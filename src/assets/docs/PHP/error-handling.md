# PHP Error Handling

---

## 1. Error vs Exception — Key Difference

Understanding the distinction between **errors** and **exceptions** is foundational in PHP.

### Errors — Engine-Level Problems

Errors originate from the PHP engine itself — running out of memory, calling an undefined function, syntax mistakes. Before PHP 7, most errors could not be caught with `try/catch`.

### Exceptions — Application-Level Problems

Exceptions arise in your application logic. They are **catchable** and **recoverable**. You throw them intentionally to signal something went wrong.

```php
<?php
function divide(int $a, int $b): float
{
    if ($b === 0) {
        throw new \InvalidArgumentException('Cannot divide by zero.');
    }
    return $a / $b;
}

try {
    $result = divide(10, 0);
} catch (\InvalidArgumentException $e) {
    echo 'Caught: ' . $e->getMessage();
}
```

### PHP 7+ — Unified with the Throwable Interface

PHP 7 introduced `Throwable`, unifying errors and exceptions. Most fatal errors are now thrown as `Error` objects — making them catchable.

```php
<?php
// Engine errors are now catchable
try {
    $result = intdiv(10, 0); // DivisionByZeroError
} catch (\Error $e) {
    echo 'Engine error: ' . $e->getMessage();
}

// Catch absolutely anything
try {
    undefinedFunction();
} catch (\Throwable $e) {
    echo get_class($e) . ': ' . $e->getMessage();
    // Error: Call to undefined function undefinedFunction()
}
```

### The Throwable Hierarchy

```
Throwable (interface)
├── Error                    — PHP engine-level
│   ├── TypeError
│   ├── ValueError
│   ├── ArithmeticError
│   │   └── DivisionByZeroError
│   ├── ParseError
│   └── UnhandledMatchError  (PHP 8)
└── Exception                — Application-level
    ├── RuntimeException
    ├── LogicException
    │   ├── InvalidArgumentException
    │   ├── BadMethodCallException
    │   └── OutOfRangeException
    └── ... (many more)
```

> **Key rule:** You cannot implement `Throwable` directly. You must extend `Error` or `Exception`.

---

## 2. PHP Error Types (Constants)

| Constant | Value | Description |
|----------|-------|-------------|
| `E_ERROR` | 1 | Fatal run-time error — script halts |
| `E_WARNING` | 2 | Non-fatal warning — script continues |
| `E_PARSE` | 4 | Compile-time parse error |
| `E_NOTICE` | 8 | Runtime notice for potentially wrong code |
| `E_DEPRECATED` | 8192 | Warning about deprecated features |
| `E_ALL` | 32767 | All errors and warnings |

### When Each Occurs

```php
<?php
// E_WARNING — file not found, script continues
$handle = fopen('/nonexistent.txt', 'r'); // Warning, returns false
var_dump($handle); // bool(false) — script kept running

// E_NOTICE — accessing undefined array key
$config = ['debug' => true];
$value = $config['timeout']; // Notice: Undefined array key
$value = $config['timeout'] ?? 30; // Fix with null coalescing

// E_DEPRECATED — using deprecated function
// money_format('%.2n', 100.5); // Deprecated in PHP 7.4

// DivisionByZeroError (PHP 7+) — now an Error object
try {
    $r = intdiv(10, 0);
} catch (\DivisionByZeroError $e) {
    echo 'Division error: ' . $e->getMessage();
}
```

---

## 3. error_reporting() and display_errors

### Development vs Production Config

```php
<?php
// Development — show everything
error_reporting(E_ALL);
ini_set('display_errors', '1');
ini_set('log_errors', '1');

// Production — hide from output, log to file
error_reporting(E_ALL & ~E_DEPRECATED);
ini_set('display_errors', '0');
ini_set('log_errors', '1');
ini_set('error_log', '/var/log/php/app_errors.log');

// Manual log
error_log('Payment timeout for order #12345');
```

**php.ini best practice:**
```ini
; Development
error_reporting = E_ALL
display_errors = On
log_errors = On
error_log = /var/log/php/errors.log

; Production
error_reporting = E_ALL & ~E_DEPRECATED
display_errors = Off
log_errors = On
error_log = /var/log/php/errors.log
```

> **Never enable `display_errors` in production** — it leaks internal paths, logic, and sensitive data to users.

---

## 4. set_error_handler()

Registers a custom function to handle PHP errors (E_WARNING, E_NOTICE, etc.).

```php
<?php
set_error_handler(function (
    int    $errno,
    string $errstr,
    string $errfile,
    int    $errline
): bool {
    // Skip suppressed errors (@-prefixed calls)
    if (!(error_reporting() & $errno)) {
        return false;
    }

    $message = sprintf(
        '[%s] Error #%d: %s in %s on line %d',
        date('Y-m-d H:i:s'), $errno, $errstr, $errfile, $errline
    );

    error_log($message, 3, '/var/log/php/custom_errors.log');

    // true  = suppress PHP's default handler
    // false = also run PHP's default handler
    return true;
});

// Test it
fopen('/nonexistent.txt', 'r'); // Triggers E_WARNING → logged
```

### What set_error_handler CANNOT Catch

```php
<?php
// E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR are NOT catchable
// Use register_shutdown_function for fatal errors
register_shutdown_function(function () {
    $error = error_get_last();
    if ($error && $error['type'] === E_ERROR) {
        error_log('Fatal error: ' . $error['message']);
        // Send alert, flush logs, notify monitoring...
    }
});
```

---

## 5. try / catch / finally

The primary mechanism for handling exceptions.

```php
<?php
try {
    $result = riskyOperation();
} catch (SpecificException $e) {
    // Handle specific type
    echo 'Specific: ' . $e->getMessage();
} catch (\Exception $e) {
    // Catch remaining exceptions
    echo 'General: ' . $e->getMessage();
} finally {
    // ALWAYS runs — exception or not, return or not
    echo 'Cleanup done.';
}
```

### Catching Multiple Types (PHP 8 Union Catch)

```php
<?php
try {
    processPayment($order);
} catch (NetworkException | TimeoutException $e) {
    // Both handled the same way
    $queue->push(new RetryPaymentJob($order));
} catch (PaymentDeclinedException $e) {
    notifyUser($order->userId, 'Payment was declined');
}
```

### finally — Always Executes

```php
<?php
function processFile(string $path): string
{
    $handle = fopen($path, 'r');

    try {
        $content = fread($handle, filesize($path));
        return $content;
    } finally {
        fclose($handle); // guaranteed — even if exception thrown or return hit
    }
}
```

> **Gotcha:** A `return` or `throw` inside `finally` overrides the one from `try`/`catch`. The original exception or return value is lost.

### Re-Throwing and Wrapping

```php
<?php
function connectToDatabase(array $config): \PDO
{
    try {
        return new \PDO($config['dsn'], $config['user'], $config['password']);
    } catch (\PDOException $e) {
        // Log internal detail
        logger()->critical('DB connection failed: ' . $e->getMessage());

        // Throw sanitized exception to caller (wrap with $previous for chain)
        throw new \RuntimeException('Database unavailable. Please try again.', 0, $e);
    }
}
```

### Real-life: Database Transaction

```php
<?php
function transferFunds(\PDO $pdo, int $fromId, int $toId, float $amount): void
{
    $pdo->beginTransaction();

    try {
        $pdo->prepare('UPDATE accounts SET balance = balance - ? WHERE id = ?')
            ->execute([$amount, $fromId]);

        $pdo->prepare('UPDATE accounts SET balance = balance + ? WHERE id = ?')
            ->execute([$amount, $toId]);

        $pdo->commit();
    } catch (\PDOException $e) {
        $pdo->rollBack();
        throw new \RuntimeException('Fund transfer failed.', 0, $e);
    }
}
```

---

## 6. Exception Class Hierarchy

### Built-In Error Subclasses

```php
<?php
// TypeError — wrong argument or return type (with strict_types=1)
try {
    double('hello'); // TypeError
} catch (\TypeError $e) {
    echo 'Type error: ' . $e->getMessage();
}

// ValueError — correct type, invalid value
try {
    array_chunk([], -1); // ValueError: must be greater than 0
} catch (\ValueError $e) {
    echo 'Value error: ' . $e->getMessage();
}

// UnhandledMatchError (PHP 8)
try {
    $label = match('unknown') {
        'active' => 'Active',
        'inactive' => 'Inactive',
    };
} catch (\UnhandledMatchError $e) {
    echo 'No match found';
}
```

### Built-In Exception Subclasses — When to Use

```php
<?php
// InvalidArgumentException — caller passed a bad value
function setAge(int $age): void
{
    if ($age < 0 || $age > 150) {
        throw new \InvalidArgumentException("Age must be 0–150, got $age");
    }
}

// RuntimeException — error during execution
function loadConfig(string $path): array
{
    if (!file_exists($path)) {
        throw new \RuntimeException("Config file not found: $path");
    }
    return json_decode(file_get_contents($path), true);
}

// LogicException — programmer bug, should never happen
function process(): void
{
    if (!$this->initialized) {
        throw new \LogicException('initialize() must be called before process()');
    }
}

// OutOfBoundsException — invalid array index
function getItem(array $items, int $index): mixed
{
    if (!array_key_exists($index, $items)) {
        throw new \OutOfBoundsException("Index $index does not exist");
    }
    return $items[$index];
}
```

---

## 7. Custom Exceptions

### Why Create Custom Exceptions

- **Clarity** — `UserNotFoundException` is clearer than generic `RuntimeException`
- **Selective catching** — catch only what you can handle
- **Extra context** — carry user ID, order ID, HTTP status code
- **Hierarchy** — catch by parent class when handling multiple related errors

### Basic Custom Exception

```php
<?php
class UserNotFoundException extends \RuntimeException
{
    public function __construct(int $userId, ?\Throwable $previous = null)
    {
        parent::__construct("User with ID $userId was not found.", 404, $previous);
    }
}

// Usage
function findUser(int $id): array
{
    $user = $db->find($id);
    if ($user === null) {
        throw new UserNotFoundException($id);
    }
    return $user;
}

try {
    $user = findUser(9999);
} catch (UserNotFoundException $e) {
    http_response_code($e->getCode()); // 404
    echo json_encode(['error' => $e->getMessage()]);
}
```

### Adding Extra Context

```php
<?php
class PaymentFailedException extends \RuntimeException
{
    public function __construct(
        private readonly string $orderId,
        private readonly string $gatewayCode,
        string $message = '',
        ?\Throwable $previous = null
    ) {
        parent::__construct(
            $message ?: "Payment failed for order $orderId (gateway: $gatewayCode)",
            402,
            $previous
        );
    }

    public function getOrderId(): string   { return $this->orderId; }
    public function getGatewayCode(): string { return $this->gatewayCode; }
}

// Throwing with context
throw new PaymentFailedException(
    orderId: 'ORD-12345',
    gatewayCode: 'INSUFFICIENT_FUNDS',
    previous: $stripeException
);
```

### Building an App Exception Hierarchy

```php
<?php
// Base
class AppException extends \RuntimeException {}

// Infrastructure
class DatabaseException extends AppException {}
class ExternalServiceException extends AppException {}

// Domain
class DomainException extends AppException {}
class UserException extends DomainException {}
class OrderException extends DomainException {}

// Specific
class UserNotFoundException extends UserException
{
    public function __construct(int $id, ?\Throwable $previous = null)
    {
        parent::__construct("User #$id not found", 404, $previous);
    }
}

// Selective catching
try {
    processOrder($orderId);
} catch (UserNotFoundException $e) {
    return response()->json(['error' => 'User not found'], 404);
} catch (OrderException $e) {
    return response()->json(['error' => $e->getMessage()], 422);
} catch (DatabaseException $e) {
    logger()->critical($e->getMessage());
    return response()->json(['error' => 'Service unavailable'], 503);
}
```

---

## 8. set_exception_handler()

Registers a global handler for **uncaught** exceptions — exceptions not caught by any `try/catch`. After the handler runs, PHP terminates.

```php
<?php
// Real-life — API returns clean JSON instead of HTML stack trace
set_exception_handler(function (\Throwable $e): void {
    $statusCode = match(true) {
        $e instanceof UserNotFoundException     => 404,
        $e instanceof \InvalidArgumentException => 400,
        $e instanceof PaymentFailedException    => 402,
        default                                 => 500,
    };

    logger()->error('Unhandled exception', [
        'exception' => get_class($e),
        'message'   => $e->getMessage(),
        'file'      => $e->getFile(),
        'line'      => $e->getLine(),
    ]);

    http_response_code($statusCode);
    header('Content-Type: application/json');
    echo json_encode([
        'error'   => true,
        'message' => $e->getMessage(),
        'code'    => $statusCode,
    ]);
});
```

---

## 9. PHP 8 Changes

### throw as an Expression

```php
<?php
// In null coalescing
$name = $request['name'] ?? throw new \InvalidArgumentException('Name is required');

// In ternary
$value = $isValid ? $data : throw new \RuntimeException('Invalid data');

// In arrow function
$getUser = fn(int $id) => $id > 0
    ? $this->userRepo->find($id)
    : throw new \InvalidArgumentException("Invalid ID: $id");

// In match default arm
$label = match($status) {
    'active'   => 'Active',
    'inactive' => 'Inactive',
    default    => throw new \ValueError("Unrecognized status: $status"),
};
```

### Catch Without Variable (PHP 8)

```php
<?php
// PHP 7 — had to name $e even if unused
try { riskyOp(); } catch (\RuntimeException $e) { echo 'Error'; }

// PHP 8 — omit variable if not needed
try { riskyOp(); } catch (\RuntimeException) { echo 'Error'; }
```

### Nullsafe Operator (?->)

```php
<?php
// Without nullsafe — verbose
$country = null;
if ($user !== null) {
    if ($user->getAddress() !== null) {
        $country = $user->getAddress()->getCountry();
    }
}

// With nullsafe — PHP 8
$country = $user?->getAddress()?->getCountry();
// Returns null at the first null step instead of throwing Error
```

---

## 10. Error Handling in Laravel

### App\Exceptions\Handler

```php
<?php
namespace App\Exceptions;

use Illuminate\Foundation\Exceptions\Handler as ExceptionHandler;
use Illuminate\Http\Request;

class Handler extends ExceptionHandler
{
    protected $dontReport = [
        \Illuminate\Auth\AuthenticationException::class,
        \Illuminate\Validation\ValidationException::class,
    ];

    public function register(): void
    {
        // report() — controls logging/monitoring
        $this->reportable(function (\Throwable $e): void {
            // app('sentry')->captureException($e);
        });

        // render() — controls HTTP response
        $this->renderable(function (UserNotFoundException $e, Request $request) {
            if ($request->expectsJson()) {
                return response()->json(['message' => $e->getMessage()], 404);
            }
            return null; // fall back to default HTML rendering
        });
    }
}
```

### abort() Helper

```php
<?php
abort(404);                           // 404 Not Found
abort(404, 'Post not found');
abort_if(!$user->isAdmin(), 403);     // 403 if condition is true
abort_unless($order->belongsTo($user), 403); // 403 unless condition is true
```

### Custom Exception with render() and report()

```php
<?php
namespace App\Exceptions;

use Exception;
use Illuminate\Http\Request;

class PaymentFailedException extends Exception
{
    public function __construct(private string $orderId, string $message = 'Payment failed')
    {
        parent::__construct($message, 402);
    }

    public function render(Request $request)
    {
        return response()->json([
            'error'    => true,
            'message'  => $this->getMessage(),
            'order_id' => $this->orderId,
        ], 402);
    }

    public function report(): void
    {
        logger()->error('Payment failed', ['order_id' => $this->orderId]);
    }
}
```

---

## 11. Best Practices

### Never Swallow Exceptions Silently

```php
<?php
// BAD — hidden failure
try {
    sendEmail($user);
} catch (\Exception $e) {
    // silent failure — nobody knows!
}

// GOOD — at minimum, log it
try {
    sendEmail($user);
} catch (\Exception $e) {
    logger()->error('Email failed', ['user_id' => $user->id, 'error' => $e->getMessage()]);
}
```

### Fail Fast — Validate at Entry Point

```php
<?php
// BAD — discovers problems late with an unclear DB error
function createInvoice(array $data): Invoice
{
    $invoice = new Invoice();
    $invoice->userId = $data['user_id']; // might not exist
    $invoice->save(); // fails here with unclear PDO error
}

// GOOD — clear, early failure
function createInvoice(array $data): Invoice
{
    if (empty($data['user_id'])) {
        throw new \InvalidArgumentException('user_id is required');
    }
    if (!is_numeric($data['amount']) || $data['amount'] <= 0) {
        throw new \InvalidArgumentException('amount must be a positive number');
    }
    // ...
}
```

### Wrap Third-Party Exceptions

```php
<?php
// BAD — leaks Stripe's exception type into your domain
public function charge(float $amount): void
{
    \Stripe\Charge::create(['amount' => $amount]); // throws Stripe\Exception\CardException
}

// GOOD — wrap in your own exception type
public function charge(float $amount): void
{
    try {
        \Stripe\Charge::create(['amount' => $amount]);
    } catch (\Stripe\Exception\CardException $e) {
        throw new PaymentDeclinedException($e->getMessage(), 0, $e);
    } catch (\Stripe\Exception\ApiException $e) {
        throw new PaymentGatewayException('Stripe API error', 0, $e);
    }
}
```

**Other best practices:**
- Use specific exception types — not just `\Exception`
- Include meaningful messages with identifiers (`"User #42 not found"`)
- Log full context: class, message, file, line, trace
- Don't use exceptions for normal flow control

---

## Interview Q&A

**Q: What is the difference between Error and Exception?**
A: Both implement `Throwable`. `Exception` is for application-level problems you anticipate and can recover from. `Error` represents engine-level problems (type errors, undefined functions, division by zero) — most were fatal and uncatchable before PHP 7. PHP 7+ made most `Error` instances catchable with `try/catch`.

**Q: What is the Throwable interface?**
A: The root interface of PHP's exception hierarchy (PHP 7+). Both `Error` and `Exception` implement it. Using `catch (\Throwable $e)` catches absolutely everything that can be thrown. You cannot implement it directly — you must extend `Error` or `Exception`.

**Q: When should you use finally?**
A: When cleanup code must run regardless of success or failure — closing file handles, releasing database connections, releasing locks. `finally` always runs even if `return` or `throw` is hit in `try`/`catch`. Caution: a `return` or `throw` inside `finally` overrides the one from `try`/`catch`.

**Q: What are the limitations of set_error_handler()?**
A: It cannot catch `E_ERROR`, `E_PARSE`, `E_CORE_ERROR`, or `E_COMPILE_ERROR`. It handles PHP-level warnings and notices, not exceptions. Use `register_shutdown_function()` with `error_get_last()` to detect fatal errors.

**Q: Why create custom exception classes?**
A: Clarity (`UserNotFoundException` beats generic `RuntimeException`), selective catching (catch only what you can handle), extra context (carry order ID, gateway codes), and hierarchy (catch a parent class to handle a whole group).

**Q: How do you handle exceptions in a REST API?**
A: Use `set_exception_handler()` (or framework equivalent) as a global safety net. Map exception types to HTTP status codes, log full details internally, and return a clean JSON response — never expose stack traces to clients.

**Q: What is the difference between re-throwing and wrapping an exception?**
A: Re-throwing propagates the same exception. Wrapping catches and throws a new exception with the original as `$previous` — this translates implementation details into domain exceptions while preserving the full chain for debugging via `$e->getPrevious()`.

**Q: What changed about throw in PHP 8?**
A: `throw` became an expression — usable inside ternary operators, null coalescing (`??`), arrow functions, and `match` arms. This enables concise guard patterns like `$name = $data['name'] ?? throw new InvalidArgumentException('required')`.
