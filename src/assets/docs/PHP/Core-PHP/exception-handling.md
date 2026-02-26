# PHP Exception Handling

## TL;DR
PHP has two error systems: old-style **Errors** (notices, warnings, fatals) and OOP-style **Exceptions**. Both implement `Throwable`. Use `try/catch/finally` to handle exceptions gracefully. Create custom exception classes for meaningful error categorization. `finally` always runs — even after a `return` or `throw`.

---

## 1. Errors vs Exceptions

Before PHP 7, errors were separate from exceptions — you couldn't catch a fatal error. PHP 7 unified them under the `Throwable` interface.

```
Throwable (interface)
├── Error         ← PHP engine errors (TypeError, ParseError, etc.)
│   ├── TypeError
│   ├── ValueError
│   ├── ArithmeticError
│   ├── DivisionByZeroError
│   └── ParseError
└── Exception     ← Application exceptions (your code + libraries)
    ├── RuntimeException
    ├── InvalidArgumentException
    ├── LogicException
    ├── BadMethodCallException
    ├── OutOfRangeException
    └── ... (many more SPL exceptions)
```

```php
// Error — PHP engine threw this
function badCall(string $required): void {}
try {
    badCall();                  // missing argument
} catch (\TypeError $e) {
    echo "Type error: " . $e->getMessage();
}

// Catch BOTH with Throwable
try {
    $result = 1 / 0;
} catch (\DivisionByZeroError $e) {
    echo "Division error";
} catch (\Throwable $e) {
    echo "Something else: " . $e->getMessage();
}
```

---

## 2. Try / Catch / Finally

### Basic Structure

```php
try {
    // Code that might throw
    $result = riskyOperation();
} catch (SpecificException $e) {
    // Handle SpecificException
} catch (AnotherException | YetAnotherException $e) {
    // Handle multiple exception types (union catch, PHP 8+)
} catch (\Exception $e) {
    // Catch any remaining Exception
} finally {
    // ALWAYS runs — whether exception thrown or not, even after return
    cleanup();
}
```

### `finally` Always Runs

```php
function getUser(int $id): User {
    $connection = openConnection();

    try {
        $user = $connection->query("SELECT * FROM users WHERE id = ?", [$id]);
        return $user; // ← return triggers finally before actually returning!
    } catch (\Exception $e) {
        Log::error("Failed to get user", ['id' => $id, 'error' => $e->getMessage()]);
        throw $e; // re-throw after logging
    } finally {
        $connection->close(); // always runs — even after return or re-throw
    }
}
```

**Key `finally` behaviors:**
- Runs even if `return` is inside `try` or `catch`
- Runs even if an exception is thrown and re-thrown
- Does NOT run if `exit()` / `die()` is called
- A `return` inside `finally` overrides any return from `try`/`catch`

### Exception Properties

```php
try {
    throw new \RuntimeException('Something broke', 500);
} catch (\RuntimeException $e) {
    echo $e->getMessage();   // 'Something broke'
    echo $e->getCode();      // 500
    echo $e->getFile();      // /path/to/file.php
    echo $e->getLine();      // line number
    echo $e->getTraceAsString(); // full stack trace as string
    echo $e->getPrevious();  // previous exception (if chained)
}
```

### Catching Multiple Types (PHP 8)

```php
try {
    connectToDatabase();
} catch (\PDOException | \RuntimeException $e) {
    // Handle both exception types the same way
    Log::error($e->getMessage());
}
```

---

## 3. Throwing Exceptions

### `throw` as a Statement

```php
function divide(float $a, float $b): float {
    if ($b === 0.0) {
        throw new \DivisionByZeroError('Cannot divide by zero');
    }
    return $a / $b;
}

function getUser(int $id): User {
    $user = User::find($id);
    if ($user === null) {
        throw new \RuntimeException("User #{$id} not found");
    }
    return $user;
}
```

### `throw` as an Expression (PHP 8)

In PHP 8, `throw` can be used inline — in ternary, null coalescing, arrow functions, etc.

```php
// In ternary
$user = findUser($id) ?? throw new \RuntimeException("User not found");

// In arrow function
$getName = fn($user) => $user?->name ?? throw new \InvalidArgumentException('No user');

// In match
$status = match($code) {
    200 => 'ok',
    404 => 'not found',
    default => throw new \UnexpectedValueException("Unknown code: {$code}"),
};

// In null coalescing
$config = $this->config['key'] ?? throw new \RuntimeException('Missing config key');
```

### Exception Chaining

When catching and re-throwing, pass the original as `$previous` to preserve the full error chain.

```php
try {
    $pdo->execute($query);
} catch (\PDOException $e) {
    // Wrap in your domain exception — but keep the original as context
    throw new \App\Exceptions\DatabaseException(
        'Failed to save order',
        previous: $e   // ← chained — accessible via getPrevious()
    );
}

// Later in the catch block:
catch (\App\Exceptions\DatabaseException $e) {
    $e->getMessage();          // 'Failed to save order'
    $e->getPrevious()->getMessage(); // original PDOException message
}
```

---

## 4. Custom Exception Classes

Create custom exceptions to represent domain-specific error categories.

```php
// Base domain exception
class AppException extends \RuntimeException {}

// Specific exceptions for different scenarios
class ValidationException extends AppException {
    private array $errors;

    public function __construct(array $errors, string $message = 'Validation failed') {
        parent::__construct($message);
        $this->errors = $errors;
    }

    public function getErrors(): array {
        return $this->errors;
    }
}

class NotFoundException extends AppException {
    public function __construct(string $resource, int|string $id) {
        parent::__construct("{$resource} with id '{$id}' was not found", 404);
    }
}

class PaymentException extends AppException {
    public function __construct(
        string $message,
        private readonly string $transactionId,
        ?\Throwable $previous = null,
    ) {
        parent::__construct($message, 0, $previous);
    }

    public function getTransactionId(): string {
        return $this->transactionId;
    }
}

// Throwing custom exceptions
function findUser(int $id): User {
    $user = User::find($id);
    if (!$user) throw new NotFoundException('User', $id);
    return $user;
}

function validateForm(array $data): void {
    $errors = [];
    if (empty($data['email'])) $errors['email'] = 'Email is required';
    if (empty($data['name']))  $errors['name']  = 'Name is required';

    if (!empty($errors)) throw new ValidationException($errors);
}

// Catching custom exceptions
try {
    $user = findUser(999);
} catch (NotFoundException $e) {
    http_response_code(404);
    echo json_encode(['error' => $e->getMessage()]); // User with id '999' was not found
}

try {
    validateForm(['email' => '', 'name' => '']);
} catch (ValidationException $e) {
    echo json_encode([
        'message' => $e->getMessage(),  // 'Validation failed'
        'errors'  => $e->getErrors(),   // ['email' => '...', 'name' => '...']
    ]);
}
```

---

## 5. Global Exception Handler

`set_exception_handler()` registers a function that catches any uncaught exception — last resort handling.

```php
// Register a global handler (usually in bootstrap/app.php)
set_exception_handler(function (\Throwable $e): void {
    // Log the full exception
    error_log($e->getMessage() . "\n" . $e->getTraceAsString());

    // Return a user-friendly response
    if (php_sapi_name() !== 'cli') {
        http_response_code(500);
        echo json_encode(['error' => 'An unexpected error occurred']);
    } else {
        echo "Error: " . $e->getMessage() . "\n";
    }
});

// Similarly for errors — convert all PHP errors to exceptions
set_error_handler(function (int $severity, string $message, string $file, int $line): bool {
    if (!(error_reporting() & $severity)) return false; // respect error_reporting level

    throw new \ErrorException($message, 0, $severity, $file, $line);
    // Now notices, warnings, etc. become catchable exceptions
});
```

### Laravel's Exception Handler

In Laravel, `App\Exceptions\Handler` centralizes exception handling:

```php
class Handler extends ExceptionHandler {
    // Exceptions to skip reporting (e.g., 404s, validation errors)
    protected $dontReport = [
        NotFoundException::class,
        ValidationException::class,
    ];

    // Transform exception to HTTP response
    public function render($request, \Throwable $e): Response {
        if ($e instanceof NotFoundException) {
            return response()->json(['error' => $e->getMessage()], 404);
        }

        if ($e instanceof ValidationException) {
            return response()->json(['errors' => $e->getErrors()], 422);
        }

        return parent::render($request, $e);
    }

    // Control what gets logged/reported
    public function report(\Throwable $e): void {
        if ($e instanceof PaymentException) {
            // Send to Sentry, Slack, etc.
            app('sentry')->captureException($e);
        }
        parent::report($e);
    }
}
```

---

## 6. Best Practices

### Catch Specific Exceptions, Not `\Exception`

```php
// BAD — catches everything, even exceptions you shouldn't handle
try {
    $result = processPayment($order);
} catch (\Exception $e) {
    echo "Error"; // masks real problems
}

// GOOD — catch what you can actually handle
try {
    $result = processPayment($order);
} catch (PaymentDeclinedException $e) {
    return response()->json(['error' => 'Card declined'], 402);
} catch (InsufficientFundsException $e) {
    return response()->json(['error' => 'Insufficient funds'], 402);
}
// Let other exceptions bubble up — you can't handle them here
```

### Don't Use Exceptions for Flow Control

```php
// BAD — exceptions for normal cases
try {
    $user = $userRepo->findOrFail($id);
} catch (\Exception $e) {
    $user = User::createGuest();
}

// GOOD — use null return for expected "not found" cases
$user = $userRepo->find($id) ?? User::createGuest();
```

### Add Context to Exceptions

```php
// BAD — no context
throw new \RuntimeException('Database error');

// GOOD — context makes debugging possible
throw new \RuntimeException(
    "Failed to update order #{$orderId}: {$pdo->errorInfo()[2]}",
    previous: $e
);
```

---

## Interview Q&A

**Q: What is the difference between `Error` and `Exception` in PHP?**
A: Both implement `Throwable`. `Error` is thrown by the PHP engine itself — `TypeError` (wrong argument type), `DivisionByZeroError`, `ParseError`. `Exception` is for application-level issues that your code (or libraries) throw deliberately. Since PHP 7, you can catch both with `Throwable`.

**Q: When does `finally` NOT run?**
A: `finally` always runs after `try`/`catch` — including after a `return` or `throw`. The only exceptions are: `exit()` / `die()` calls, or if the PHP process itself crashes (segfault, OOM kill).

**Q: Why should you create custom exception classes?**
A: Custom exceptions allow specific, targeted `catch` blocks — you can handle a `NotFoundException` differently from a `PaymentException`. They can carry extra context (e.g., `getErrors()` on `ValidationException`). They make the code self-documenting — exception names are part of the API contract.

**Q: What is exception chaining and why is it useful?**
A: Exception chaining preserves the original exception when wrapping it in a higher-level one — `new AppException('message', previous: $originalException)`. It maintains the full error trail: you know that a `DatabaseException` was caused by a `PDOException` with a specific SQL error. Access via `getPrevious()`.

**Q: What is `set_exception_handler` used for?**
A: It registers a global callback for uncaught exceptions — a last-resort handler. It's used in framework bootstrapping to log the error and return a clean error response instead of PHP's default fatal error page. Laravel's `Handler` class achieves the same thing in a more structured way.
