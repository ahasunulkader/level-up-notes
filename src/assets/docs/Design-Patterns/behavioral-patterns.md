# Behavioral Design Patterns in PHP

Behavioral patterns deal with **how objects communicate and distribute responsibilities**. They define clear protocols for object interaction.

---

## 1. Strategy Pattern

> **Defines a family of algorithms, encapsulates each one, and makes them interchangeable** at runtime.

### The Concept

Think of **navigation apps** — you choose driving, walking, or public transit. Same destination, different strategies. You can switch anytime.

### PHP Example — Pricing Strategy

```php
interface PricingStrategy
{
    public function calculate(float $basePrice, int $quantity): float;
    public function getName(): string;
}

class RegularPricing implements PricingStrategy
{
    public function calculate(float $basePrice, int $quantity): float
    {
        return $basePrice * $quantity;
    }

    public function getName(): string
    {
        return "Regular Pricing";
    }
}

class BulkPricing implements PricingStrategy
{
    public function calculate(float $basePrice, int $quantity): float
    {
        // 10% discount for 10+ items, 20% for 50+
        $discount = match (true) {
            $quantity >= 50 => 0.20,
            $quantity >= 10 => 0.10,
            default => 0,
        };

        return $basePrice * $quantity * (1 - $discount);
    }

    public function getName(): string
    {
        return "Bulk Pricing";
    }
}

class SeasonalPricing implements PricingStrategy
{
    public function __construct(private float $discountPercent) {}

    public function calculate(float $basePrice, int $quantity): float
    {
        return $basePrice * $quantity * (1 - $this->discountPercent / 100);
    }

    public function getName(): string
    {
        return "Seasonal Pricing ({$this->discountPercent}% off)";
    }
}

class PremiumMemberPricing implements PricingStrategy
{
    public function calculate(float $basePrice, int $quantity): float
    {
        // 15% member discount + free shipping savings
        return $basePrice * $quantity * 0.85;
    }

    public function getName(): string
    {
        return "Premium Member Pricing";
    }
}

// Context — uses the strategy
class ShoppingCart
{
    private array $items = [];
    private PricingStrategy $pricingStrategy;

    public function __construct(PricingStrategy $strategy)
    {
        $this->pricingStrategy = $strategy;
    }

    // Can switch strategy at runtime!
    public function setPricingStrategy(PricingStrategy $strategy): void
    {
        $this->pricingStrategy = $strategy;
    }

    public function addItem(string $name, float $price, int $quantity): void
    {
        $this->items[] = compact('name', 'price', 'quantity');
    }

    public function getTotal(): float
    {
        $total = 0;
        foreach ($this->items as $item) {
            $total += $this->pricingStrategy->calculate($item['price'], $item['quantity']);
        }
        return round($total, 2);
    }

    public function checkout(): void
    {
        echo "Strategy: {$this->pricingStrategy->getName()}\n";
        foreach ($this->items as $item) {
            $cost = $this->pricingStrategy->calculate($item['price'], $item['quantity']);
            echo "  {$item['name']} x{$item['quantity']}: $$cost\n";
        }
        echo "Total: $" . $this->getTotal() . "\n\n";
    }
}

// Usage
$cart = new ShoppingCart(new RegularPricing());
$cart->addItem("T-Shirt", 25.00, 3);
$cart->addItem("Jeans", 50.00, 2);
$cart->checkout();
// Strategy: Regular Pricing
// T-Shirt x3: $75
// Jeans x2: $100
// Total: $175

// Switch to seasonal pricing!
$cart->setPricingStrategy(new SeasonalPricing(25));
$cart->checkout();
// Strategy: Seasonal Pricing (25% off)
// Total: $131.25
```

### Strategy Eliminates If/Else Chains

```php
// BAD — long if/else chain
function calculateShipping(string $method, float $weight): float
{
    if ($method === 'standard') {
        return $weight * 1.5;
    } elseif ($method === 'express') {
        return $weight * 3.0;
    } elseif ($method === 'overnight') {
        return $weight * 5.0;
    } elseif ($method === 'drone') {
        return $weight * 8.0;
    }
    // Adding new methods = modify this function!
    return 0;
}

// GOOD — Strategy pattern
interface ShippingStrategy
{
    public function calculate(float $weight): float;
}

class StandardShipping implements ShippingStrategy
{
    public function calculate(float $weight): float { return $weight * 1.5; }
}

class ExpressShipping implements ShippingStrategy
{
    public function calculate(float $weight): float { return $weight * 3.0; }
}

// Add new strategies without touching existing code!
class DroneShipping implements ShippingStrategy
{
    public function calculate(float $weight): float { return $weight * 8.0; }
}
```

### When to Use Strategy

- You have **multiple algorithms** for the same task
- You need to **switch algorithms at runtime**
- You want to **eliminate if/else chains** for selecting behavior
- **Laravel examples:** Validation rules, Cache drivers, Queue drivers

### When NOT to Use

- Only 2-3 simple variations — if/else might be fine
- Algorithm never changes at runtime

---

## 2. Observer Pattern

> **When one object changes, all its dependents are notified automatically.** Publish-subscribe mechanism.

### The Concept

Think of **YouTube subscriptions** — when a channel uploads a video, ALL subscribers get notified. The channel doesn't know who the subscribers are; it just broadcasts.

### PHP Example — Event System

```php
// Observer interface — "the subscriber"
interface EventListener
{
    public function handle(string $event, array $data): void;
}

// Subject — "the publisher"
class EventDispatcher
{
    /** @var array<string, EventListener[]> */
    private array $listeners = [];

    public function subscribe(string $event, EventListener $listener): void
    {
        $this->listeners[$event][] = $listener;
    }

    public function unsubscribe(string $event, EventListener $listener): void
    {
        $this->listeners[$event] = array_filter(
            $this->listeners[$event] ?? [],
            fn($l) => $l !== $listener
        );
    }

    public function dispatch(string $event, array $data = []): void
    {
        foreach ($this->listeners[$event] ?? [] as $listener) {
            $listener->handle($event, $data);
        }
    }
}

// Concrete observers
class SendWelcomeEmail implements EventListener
{
    public function handle(string $event, array $data): void
    {
        echo "Sending welcome email to {$data['email']}\n";
    }
}

class CreateDefaultProfile implements EventListener
{
    public function handle(string $event, array $data): void
    {
        echo "Creating default profile for user {$data['name']}\n";
    }
}

class LogRegistration implements EventListener
{
    public function handle(string $event, array $data): void
    {
        echo "LOG: New user registered — {$data['name']} ({$data['email']})\n";
    }
}

class AssignFreeTrialPlan implements EventListener
{
    public function handle(string $event, array $data): void
    {
        echo "Assigning 14-day free trial to {$data['name']}\n";
    }
}

class NotifyAdminOfNewUser implements EventListener
{
    public function handle(string $event, array $data): void
    {
        echo "Admin notified: New user {$data['name']} signed up\n";
    }
}

// Usage
$dispatcher = new EventDispatcher();

// Subscribe listeners to events
$dispatcher->subscribe('user.registered', new SendWelcomeEmail());
$dispatcher->subscribe('user.registered', new CreateDefaultProfile());
$dispatcher->subscribe('user.registered', new LogRegistration());
$dispatcher->subscribe('user.registered', new AssignFreeTrialPlan());
$dispatcher->subscribe('user.registered', new NotifyAdminOfNewUser());

// Dispatch event — ALL listeners are notified!
$dispatcher->dispatch('user.registered', [
    'name' => 'John Doe',
    'email' => 'john@example.com',
]);
// Output:
// Sending welcome email to john@example.com
// Creating default profile for user John Doe
// LOG: New user registered — John Doe (john@example.com)
// Assigning 14-day free trial to John Doe
// Admin notified: New user John Doe signed up
```

### Laravel Events — Observer Pattern

```php
// Laravel uses Observer pattern with Events & Listeners

// Define Event
class OrderPlaced
{
    public function __construct(public readonly Order $order) {}
}

// Define Listeners
class SendOrderConfirmation
{
    public function handle(OrderPlaced $event): void
    {
        Mail::to($event->order->customer_email)->send(
            new OrderConfirmationMail($event->order)
        );
    }
}

class UpdateInventory
{
    public function handle(OrderPlaced $event): void
    {
        foreach ($event->order->items as $item) {
            Product::find($item->product_id)->decrement('stock', $item->quantity);
        }
    }
}

// Register in EventServiceProvider
protected $listen = [
    OrderPlaced::class => [
        SendOrderConfirmation::class,
        UpdateInventory::class,
        NotifyWarehouse::class,
    ],
];

// Dispatch
OrderPlaced::dispatch($order);
```

### When to Use Observer

- **One-to-many** dependency — one event triggers many reactions
- **Loose coupling** — publisher doesn't need to know about subscribers
- **Event-driven architecture** — user actions trigger side effects
- **Laravel examples:** Model Events, Broadcasting, Event Listeners

### When NOT to Use

- Simple direct calls between two objects
- When order of execution matters (observers run independently)
- Debugging can be harder — "who's listening to this event?"

---

## 3. Template Method Pattern

> **Defines the skeleton of an algorithm** in a parent class, letting subclasses override specific steps without changing the structure.

### The Concept

Think of a **recipe template** — every cake follows: mix ingredients → bake → decorate. But WHAT you mix and HOW you decorate changes per cake type.

### PHP Example — Report Generator

```php
abstract class ReportGenerator
{
    // Template Method — defines the algorithm skeleton
    // Marked as "final" so subclasses can't change the order
    final public function generate(): string
    {
        $report = '';
        $report .= $this->buildHeader();
        $report .= $this->buildBody();

        if ($this->includeCharts()) {   // Hook method
            $report .= $this->buildCharts();
        }

        $report .= $this->buildFooter();
        return $report;
    }

    // Steps that MUST be implemented by subclasses
    abstract protected function buildHeader(): string;
    abstract protected function buildBody(): string;
    abstract protected function buildFooter(): string;

    // Optional step — subclasses CAN override (hook)
    protected function includeCharts(): bool
    {
        return false; // Default: no charts
    }

    protected function buildCharts(): string
    {
        return ''; // Default empty
    }
}

class HtmlReport extends ReportGenerator
{
    public function __construct(private array $data) {}

    protected function buildHeader(): string
    {
        return "<html><head><title>Report</title></head><body>\n";
    }

    protected function buildBody(): string
    {
        $html = "<table>\n";
        foreach ($this->data as $row) {
            $html .= "<tr><td>" . implode("</td><td>", $row) . "</td></tr>\n";
        }
        $html .= "</table>\n";
        return $html;
    }

    protected function buildFooter(): string
    {
        $date = date('Y-m-d');
        return "<footer>Generated on $date</footer></body></html>";
    }

    // Override hook — HTML reports include charts
    protected function includeCharts(): bool
    {
        return true;
    }

    protected function buildCharts(): string
    {
        return "<div class='chart'>Chart goes here</div>\n";
    }
}

class CsvReport extends ReportGenerator
{
    public function __construct(private array $data) {}

    protected function buildHeader(): string
    {
        return "Name,Email,Role\n"; // CSV headers
    }

    protected function buildBody(): string
    {
        $csv = '';
        foreach ($this->data as $row) {
            $csv .= implode(',', $row) . "\n";
        }
        return $csv;
    }

    protected function buildFooter(): string
    {
        return "# End of report\n";
    }
    // No charts in CSV — uses default (false)
}

// Usage
$data = [
    ['John', 'john@mail.com', 'Admin'],
    ['Jane', 'jane@mail.com', 'Editor'],
];

$htmlReport = new HtmlReport($data);
echo $htmlReport->generate(); // Full HTML with charts

$csvReport = new CsvReport($data);
echo $csvReport->generate(); // Simple CSV without charts
```

### Real-World Example — Data Import

```php
abstract class DataImporter
{
    final public function import(string $source): array
    {
        $rawData = $this->readData($source);
        $parsedData = $this->parseData($rawData);
        $validData = $this->validateData($parsedData);
        $this->saveData($validData);
        $this->afterImport($validData); // Hook

        return $validData;
    }

    abstract protected function readData(string $source): string;
    abstract protected function parseData(string $rawData): array;

    protected function validateData(array $data): array
    {
        // Default validation — can be overridden
        return array_filter($data, fn($item) => !empty($item));
    }

    protected function saveData(array $data): void
    {
        // Default: insert into database
        foreach ($data as $row) {
            echo "Saving: " . json_encode($row) . "\n";
        }
    }

    // Hook — subclasses can add post-import actions
    protected function afterImport(array $data): void
    {
        // Default: do nothing
    }
}

class CsvImporter extends DataImporter
{
    protected function readData(string $source): string
    {
        return file_get_contents($source);
    }

    protected function parseData(string $rawData): array
    {
        $lines = explode("\n", trim($rawData));
        $headers = str_getcsv(array_shift($lines));

        return array_map(function ($line) use ($headers) {
            return array_combine($headers, str_getcsv($line));
        }, $lines);
    }

    protected function afterImport(array $data): void
    {
        echo "CSV import complete. " . count($data) . " records imported.\n";
    }
}

class JsonImporter extends DataImporter
{
    protected function readData(string $source): string
    {
        return file_get_contents($source);
    }

    protected function parseData(string $rawData): array
    {
        return json_decode($rawData, true) ?? [];
    }
}
```

### When to Use Template Method

- Multiple classes follow the **same algorithm** but differ in specific steps
- You want to **enforce an algorithm's structure** while allowing customization
- **Laravel examples:** Form Requests (authorize + rules), Console Commands (handle)

### When NOT to Use

- Algorithm doesn't have a fixed structure
- Too many abstract methods — subclasses become complex

---

## 4. Command Pattern

> **Encapsulates a request as an object,** allowing you to parameterize, queue, log, and undo operations.

### The Concept

Think of a **restaurant order** — the waiter writes your order on a slip (command object), puts it in the queue, and the kitchen executes it. The order can be tracked, modified, or cancelled.

### PHP Example — Task Queue

```php
interface Command
{
    public function execute(): void;
    public function undo(): void;
    public function describe(): string;
}

class SendEmailCommand implements Command
{
    public function __construct(
        private string $to,
        private string $subject,
        private string $body
    ) {}

    public function execute(): void
    {
        echo "Sending email to {$this->to}: {$this->subject}\n";
        // mail($this->to, $this->subject, $this->body);
    }

    public function undo(): void
    {
        echo "Cancelling email to {$this->to}\n";
        // Remove from mail queue
    }

    public function describe(): string
    {
        return "Send email '{$this->subject}' to {$this->to}";
    }
}

class CreateFileCommand implements Command
{
    public function __construct(
        private string $path,
        private string $content
    ) {}

    public function execute(): void
    {
        file_put_contents($this->path, $this->content);
        echo "Created file: {$this->path}\n";
    }

    public function undo(): void
    {
        if (file_exists($this->path)) {
            unlink($this->path);
            echo "Deleted file: {$this->path}\n";
        }
    }

    public function describe(): string
    {
        return "Create file at {$this->path}";
    }
}

class DatabaseInsertCommand implements Command
{
    private ?int $insertedId = null;

    public function __construct(
        private string $table,
        private array $data
    ) {}

    public function execute(): void
    {
        // $this->insertedId = DB::table($this->table)->insertGetId($this->data);
        $this->insertedId = rand(1, 1000);
        echo "Inserted record into {$this->table} (ID: {$this->insertedId})\n";
    }

    public function undo(): void
    {
        if ($this->insertedId) {
            // DB::table($this->table)->delete($this->insertedId);
            echo "Deleted record {$this->insertedId} from {$this->table}\n";
        }
    }

    public function describe(): string
    {
        return "Insert into {$this->table}";
    }
}

// Command Queue — stores and executes commands
class CommandQueue
{
    /** @var Command[] */
    private array $queue = [];

    /** @var Command[] */
    private array $history = [];

    public function add(Command $command): void
    {
        $this->queue[] = $command;
        echo "Queued: {$command->describe()}\n";
    }

    public function processAll(): void
    {
        echo "\n--- Processing Queue ---\n";
        while (!empty($this->queue)) {
            $command = array_shift($this->queue);
            $command->execute();
            $this->history[] = $command;
        }
        echo "--- Queue Complete ---\n";
    }

    public function undoLast(): void
    {
        if (empty($this->history)) {
            echo "Nothing to undo.\n";
            return;
        }

        $lastCommand = array_pop($this->history);
        echo "Undoing: {$lastCommand->describe()}\n";
        $lastCommand->undo();
    }

    public function undoAll(): void
    {
        echo "\n--- Undoing All ---\n";
        while (!empty($this->history)) {
            $this->undoLast();
        }
    }
}

// Usage
$queue = new CommandQueue();

$queue->add(new CreateFileCommand('/tmp/report.txt', 'Report content'));
$queue->add(new DatabaseInsertCommand('audit_logs', ['action' => 'report_created']));
$queue->add(new SendEmailCommand('admin@example.com', 'Report Ready', 'Your report is ready'));

$queue->processAll();
// --- Processing Queue ---
// Created file: /tmp/report.txt
// Inserted record into audit_logs (ID: 42)
// Sending email to admin@example.com: Report Ready
// --- Queue Complete ---

$queue->undoLast();
// Undoing: Send email 'Report Ready' to admin@example.com
// Cancelling email to admin@example.com
```

### Laravel Artisan Commands — Command Pattern

```php
// Laravel Artisan commands ARE the Command pattern!
class SendWeeklyReport extends Command
{
    protected $signature = 'report:weekly {--email=admin@example.com}';
    protected $description = 'Send weekly report to administrators';

    public function handle(): int
    {
        $email = $this->option('email');
        $this->info("Sending weekly report to $email...");

        // Generate and send report
        // ...

        $this->info("Report sent successfully!");
        return 0;
    }
}

// Dispatch to queue (queued command)
SendWeeklyReport::dispatch();
```

### Laravel Jobs — Command Pattern

```php
// Laravel Jobs are Commands that can be queued
class ProcessPodcast implements ShouldQueue
{
    public function __construct(private Podcast $podcast) {}

    public function handle(): void
    {
        // Process the podcast...
        echo "Processing: {$this->podcast->title}\n";
    }

    public function failed(Throwable $exception): void
    {
        // Handle failure — like an undo
        echo "Failed to process: {$this->podcast->title}\n";
    }
}

// Queue the command for later execution
ProcessPodcast::dispatch($podcast);

// Execute immediately
ProcessPodcast::dispatchSync($podcast);
```

### When to Use Command

- **Queue operations** for later execution
- Need **undo/redo** functionality
- **Log operations** for auditing
- **Decouple** the sender from the executor
- **Laravel examples:** Artisan Commands, Queued Jobs, Bus dispatch

### When NOT to Use

- Simple direct method calls — don't wrap everything in a command
- No need for queuing, undo, or logging

---

## Pattern Comparison

| Pattern | Purpose | Trigger | Real Example |
|---|---|---|---|
| **Strategy** | Swap algorithms at runtime | Client chooses | Pricing rules, Shipping methods |
| **Observer** | Notify many when one changes | State change | Events & Listeners, Webhooks |
| **Template Method** | Fixed algorithm, flexible steps | Inheritance | Report generation, Data import |
| **Command** | Encapsulate operations as objects | Queued/deferred | Artisan commands, Job queue |

---

## Common Interview Questions

1. **Difference between Strategy and Template Method?**
   → Strategy uses **composition** (inject different strategies). Template Method uses **inheritance** (subclasses override steps). Strategy is more flexible.

2. **Where does Laravel use the Observer pattern?**
   → Model Events (creating, created, updating, deleted), Event/Listener system, Broadcasting.

3. **Why use Command pattern instead of just calling a method?**
   → Commands can be **queued, logged, undone, and retried**. Direct method calls can't.

4. **How does Strategy pattern eliminate if/else chains?**
   → Instead of `if (type === 'a')...else if (type === 'b')`, each variation is a separate class implementing the same interface. New types = new class, no modification.

5. **Give a real example of Template Method in PHP.**
   → PHPUnit's `TestCase` — `setUp()`, `test*()`, `tearDown()` follow a fixed template. You override the steps, but the framework controls the order.
