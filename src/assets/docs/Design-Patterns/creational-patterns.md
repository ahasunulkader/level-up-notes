# Creational Design Patterns in PHP

Creational patterns deal with **object creation** — giving you more control over how objects are made instead of just using `new ClassName()`.

> **Interview Tip:** For each pattern, know: What it does, When to use it, When NOT to use it, and a real-world example.

---

## 1. Singleton Pattern

> **Ensures a class has only ONE instance** and provides a global point of access to it.

### The Concept

Imagine a **database connection** — you don't want 100 separate connections. You want ONE shared connection that everyone uses.

### PHP Implementation

```php
class Database
{
    private static ?Database $instance = null;
    private PDO $connection;

    // Private constructor — can't use "new Database()" from outside
    private function __construct()
    {
        $this->connection = new PDO(
            'mysql:host=localhost;dbname=myapp',
            'root',
            'password'
        );
        $this->connection->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    }

    // Prevent cloning
    private function __clone() {}

    // Prevent unserialization
    public function __wakeup()
    {
        throw new RuntimeException("Cannot unserialize a singleton.");
    }

    // The global access point
    public static function getInstance(): self
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    public function query(string $sql, array $params = []): array
    {
        $stmt = $this->connection->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }
}

// Usage
$db = Database::getInstance();
$users = $db->query("SELECT * FROM users WHERE active = ?", [1]);

// Same instance everywhere
$db2 = Database::getInstance();
var_dump($db === $db2); // true — same object!
```

### Why Singleton is Controversial

| Pros | Cons |
|---|---|
| Guarantees single instance | Acts as a **global variable** (hidden dependency) |
| Lazy initialization | **Hard to test** — can't mock easily |
| Shared resource management | **Tight coupling** — classes depend on Singleton directly |
| | Violates **Single Responsibility** — manages its own lifecycle |
| | Breaks in **multi-threaded** environments |

### Better Alternative — Dependency Injection

```php
// Instead of Singleton, use DI with a container
interface DatabaseInterface
{
    public function query(string $sql, array $params = []): array;
}

class MySqlDatabase implements DatabaseInterface
{
    public function __construct(private PDO $pdo) {}

    public function query(string $sql, array $params = []): array
    {
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }
}

// Laravel handles this beautifully
// Register as singleton in the container — same single instance, but injectable and testable
// $this->app->singleton(DatabaseInterface::class, MySqlDatabase::class);
```

### When to Use Singleton

- **Logger** — one log handler across the app
- **Configuration** — one config object loaded once
- **Connection pools** — manage shared connections

### When NOT to Use

- When you can use **Dependency Injection** instead (almost always)
- When you need **testability** (Singletons are hard to mock)
- In **Laravel** — use the Service Container with `singleton()` binding instead

---

## 2. Factory Pattern

> **Creates objects without specifying the exact class** to instantiate. Delegates creation to a method.

### The Concept

Think of a **pizza shop** — you tell the counter "I want a Margherita," and they handle ALL the creation details. You don't walk into the kitchen.

### Simple Factory

```php
interface Notification
{
    public function send(string $to, string $message): bool;
    public function getType(): string;
}

class EmailNotification implements Notification
{
    public function send(string $to, string $message): bool
    {
        echo "Sending EMAIL to $to: $message\n";
        return true;
    }

    public function getType(): string
    {
        return 'email';
    }
}

class SmsNotification implements Notification
{
    public function send(string $to, string $message): bool
    {
        echo "Sending SMS to $to: $message\n";
        return true;
    }

    public function getType(): string
    {
        return 'sms';
    }
}

class PushNotification implements Notification
{
    public function send(string $to, string $message): bool
    {
        echo "Sending PUSH to $to: $message\n";
        return true;
    }

    public function getType(): string
    {
        return 'push';
    }
}

// The Factory
class NotificationFactory
{
    public static function create(string $type): Notification
    {
        return match ($type) {
            'email' => new EmailNotification(),
            'sms'   => new SmsNotification(),
            'push'  => new PushNotification(),
            default => throw new InvalidArgumentException("Unknown notification type: $type"),
        };
    }
}

// Usage — caller doesn't care about which class is created
$notification = NotificationFactory::create('email');
$notification->send('user@example.com', 'Hello!');

// Easy to add new types — just add a new case
```

### Factory Method Pattern

The parent class defines the creation interface, but **subclasses decide** which class to instantiate.

```php
abstract class DocumentCreator
{
    // Factory Method — subclasses decide what to create
    abstract protected function createDocument(): Document;

    // Template that uses the factory method
    public function generateDocument(string $content): Document
    {
        $doc = $this->createDocument();
        $doc->setContent($content);
        $doc->addHeader();
        $doc->addFooter();
        return $doc;
    }
}

interface Document
{
    public function setContent(string $content): void;
    public function addHeader(): void;
    public function addFooter(): void;
    public function render(): string;
}

class PdfDocument implements Document
{
    private string $content = '';

    public function setContent(string $content): void
    {
        $this->content = $content;
    }

    public function addHeader(): void
    {
        $this->content = "=== PDF HEADER ===\n" . $this->content;
    }

    public function addFooter(): void
    {
        $this->content .= "\n=== PDF FOOTER ===";
    }

    public function render(): string
    {
        return "[PDF] " . $this->content;
    }
}

class HtmlDocument implements Document
{
    private string $content = '';

    public function setContent(string $content): void
    {
        $this->content = $content;
    }

    public function addHeader(): void
    {
        $this->content = "<header>HTML Header</header>\n" . $this->content;
    }

    public function addFooter(): void
    {
        $this->content .= "\n<footer>HTML Footer</footer>";
    }

    public function render(): string
    {
        return "<html><body>" . $this->content . "</body></html>";
    }
}

class PdfCreator extends DocumentCreator
{
    protected function createDocument(): Document
    {
        return new PdfDocument();
    }
}

class HtmlCreator extends DocumentCreator
{
    protected function createDocument(): Document
    {
        return new HtmlDocument();
    }
}

// Usage
$creator = new PdfCreator();
$doc = $creator->generateDocument("Invoice #123");
echo $doc->render();
```

### Abstract Factory

Creates **families of related objects** without specifying their concrete classes.

```php
// Abstract Factory — creates a family of related UI components
interface UIFactory
{
    public function createButton(string $label): Button;
    public function createInput(string $placeholder): Input;
    public function createModal(string $title): Modal;
}

interface Button
{
    public function render(): string;
}

interface Input
{
    public function render(): string;
}

interface Modal
{
    public function render(): string;
}

// --- Bootstrap Family ---
class BootstrapButton implements Button
{
    public function __construct(private string $label) {}

    public function render(): string
    {
        return "<button class=\"btn btn-primary\">$this->label</button>";
    }
}

class BootstrapInput implements Input
{
    public function __construct(private string $placeholder) {}

    public function render(): string
    {
        return "<input class=\"form-control\" placeholder=\"$this->placeholder\">";
    }
}

class BootstrapModal implements Modal
{
    public function __construct(private string $title) {}

    public function render(): string
    {
        return "<div class=\"modal\"><h5 class=\"modal-title\">$this->title</h5></div>";
    }
}

class BootstrapUIFactory implements UIFactory
{
    public function createButton(string $label): Button
    {
        return new BootstrapButton($label);
    }

    public function createInput(string $placeholder): Input
    {
        return new BootstrapInput($placeholder);
    }

    public function createModal(string $title): Modal
    {
        return new BootstrapModal($title);
    }
}

// --- Tailwind Family ---
class TailwindButton implements Button
{
    public function __construct(private string $label) {}

    public function render(): string
    {
        return "<button class=\"px-4 py-2 bg-blue-500 text-white rounded\">$this->label</button>";
    }
}

class TailwindInput implements Input
{
    public function __construct(private string $placeholder) {}

    public function render(): string
    {
        return "<input class=\"border rounded px-3 py-2\" placeholder=\"$this->placeholder\">";
    }
}

class TailwindModal implements Modal
{
    public function __construct(private string $title) {}

    public function render(): string
    {
        return "<div class=\"fixed inset-0 bg-black bg-opacity-50\"><h2>$this->title</h2></div>";
    }
}

class TailwindUIFactory implements UIFactory
{
    public function createButton(string $label): Button
    {
        return new TailwindButton($label);
    }

    public function createInput(string $placeholder): Input
    {
        return new TailwindInput($placeholder);
    }

    public function createModal(string $title): Modal
    {
        return new TailwindModal($title);
    }
}

// Usage — switch entire UI framework by changing one line!
function buildLoginForm(UIFactory $factory): string
{
    $emailInput = $factory->createInput("Enter your email");
    $passwordInput = $factory->createInput("Enter your password");
    $submitButton = $factory->createButton("Login");

    return $emailInput->render() . "\n" .
           $passwordInput->render() . "\n" .
           $submitButton->render();
}

// Use Bootstrap
echo buildLoginForm(new BootstrapUIFactory());

// Switch to Tailwind — only change THIS line!
echo buildLoginForm(new TailwindUIFactory());
```

### When to Use Factory

- Object creation is **complex** (many parameters, configuration)
- You need to create **different types** based on input
- You want to **decouple** creation from usage
- You need **families of related objects** (Abstract Factory)

### When NOT to Use

- Simple object creation — just use `new`
- Only one implementation exists — factory adds unnecessary complexity

---

## 3. Builder Pattern

> **Constructs complex objects step by step.** Lets you produce different types using the same construction process.

### The Concept

Think of **ordering a custom burger** — you choose the bun, patty, cheese, sauce, veggies step by step. The builder assembles it.

### PHP Implementation

```php
class QueryBuilder
{
    private string $table = '';
    private array $conditions = [];
    private array $columns = ['*'];
    private ?int $limit = null;
    private ?int $offset = null;
    private array $orderBy = [];
    private array $joins = [];

    public function table(string $table): self
    {
        $this->table = $table;
        return $this; // Return self for chaining
    }

    public function select(string ...$columns): self
    {
        $this->columns = $columns;
        return $this;
    }

    public function where(string $column, string $operator, mixed $value): self
    {
        $this->conditions[] = "$column $operator '$value'";
        return $this;
    }

    public function join(string $table, string $on): self
    {
        $this->joins[] = "JOIN $table ON $on";
        return $this;
    }

    public function orderBy(string $column, string $direction = 'ASC'): self
    {
        $this->orderBy[] = "$column $direction";
        return $this;
    }

    public function limit(int $limit): self
    {
        $this->limit = $limit;
        return $this;
    }

    public function offset(int $offset): self
    {
        $this->offset = $offset;
        return $this;
    }

    public function build(): string
    {
        $query = "SELECT " . implode(', ', $this->columns);
        $query .= " FROM $this->table";

        if (!empty($this->joins)) {
            $query .= " " . implode(' ', $this->joins);
        }

        if (!empty($this->conditions)) {
            $query .= " WHERE " . implode(' AND ', $this->conditions);
        }

        if (!empty($this->orderBy)) {
            $query .= " ORDER BY " . implode(', ', $this->orderBy);
        }

        if ($this->limit !== null) {
            $query .= " LIMIT $this->limit";
        }

        if ($this->offset !== null) {
            $query .= " OFFSET $this->offset";
        }

        return $query;
    }
}

// Usage — build step by step
$query = (new QueryBuilder())
    ->table('users')
    ->select('id', 'name', 'email')
    ->where('active', '=', '1')
    ->where('role', '=', 'admin')
    ->join('departments', 'departments.id = users.department_id')
    ->orderBy('name', 'ASC')
    ->limit(10)
    ->offset(0)
    ->build();

echo $query;
// SELECT id, name, email FROM users
// JOIN departments ON departments.id = users.department_id
// WHERE active = '1' AND role = 'admin'
// ORDER BY name ASC LIMIT 10 OFFSET 0
```

### Real-World Example — API Response Builder

```php
class ApiResponseBuilder
{
    private int $statusCode = 200;
    private bool $success = true;
    private mixed $data = null;
    private ?string $message = null;
    private array $errors = [];
    private array $meta = [];

    public function success(): self
    {
        $this->success = true;
        $this->statusCode = 200;
        return $this;
    }

    public function error(int $code = 400): self
    {
        $this->success = false;
        $this->statusCode = $code;
        return $this;
    }

    public function withData(mixed $data): self
    {
        $this->data = $data;
        return $this;
    }

    public function withMessage(string $message): self
    {
        $this->message = $message;
        return $this;
    }

    public function withErrors(array $errors): self
    {
        $this->errors = $errors;
        return $this;
    }

    public function withMeta(array $meta): self
    {
        $this->meta = $meta;
        return $this;
    }

    public function build(): array
    {
        $response = [
            'success' => $this->success,
            'status' => $this->statusCode,
        ];

        if ($this->message) {
            $response['message'] = $this->message;
        }

        if ($this->data !== null) {
            $response['data'] = $this->data;
        }

        if (!empty($this->errors)) {
            $response['errors'] = $this->errors;
        }

        if (!empty($this->meta)) {
            $response['meta'] = $this->meta;
        }

        return $response;
    }
}

// Success response
$response = (new ApiResponseBuilder())
    ->success()
    ->withMessage('Users fetched successfully')
    ->withData(['users' => [...]])
    ->withMeta(['total' => 100, 'page' => 1])
    ->build();

// Error response
$response = (new ApiResponseBuilder())
    ->error(422)
    ->withMessage('Validation failed')
    ->withErrors([
        'email' => 'Email is required',
        'name' => 'Name must be at least 3 characters',
    ])
    ->build();
```

### When to Use Builder

- Object has **many optional parameters**
- Object creation involves **multiple steps**
- You want to create **different representations** of the same thing
- **Laravel examples:** Query Builder, Mail builder, Notification builder

### When NOT to Use

- Simple objects with few parameters — just use a constructor
- Object can be created in one step

---

## Pattern Comparison

| Pattern | Purpose | Example |
|---|---|---|
| **Singleton** | Exactly one instance | Database connection, Logger |
| **Factory** | Create objects by type | Notification types, Payment gateways |
| **Abstract Factory** | Create families of objects | UI component themes |
| **Builder** | Construct step by step | Query builder, Email builder |

---

## Common Interview Questions

1. **Why is Singleton considered an anti-pattern?**
   → It's a global state, hard to test, creates hidden dependencies. Use DI container's `singleton()` binding instead.

2. **Difference between Factory and Abstract Factory?**
   → Factory creates ONE type of object. Abstract Factory creates a FAMILY of related objects.

3. **When would you use Builder over Factory?**
   → Builder is for complex objects with many optional parameters (step by step). Factory is for choosing which CLASS to create based on input.

4. **Name a real-world use of Builder in Laravel.**
   → `DB::table('users')->where('active', 1)->orderBy('name')->get()` — Laravel's Query Builder is the Builder pattern!

5. **How does Laravel's Service Container relate to Factory?**
   → The container acts as a factory — you ask for an interface, it creates and returns the right concrete class.
