# Structural Design Patterns in PHP

Structural patterns deal with **how classes and objects are composed** to form larger structures. They help ensure that when one part changes, the whole structure doesn't need to change.

---

## 1. Adapter Pattern

> **Makes incompatible interfaces work together.** Acts as a translator between two systems.

### The Concept

Think of a **power adapter** — your laptop charger has a US plug, but you're in Europe. The adapter converts one interface to another without changing either device.

### Real-World Example — Payment Gateway Adapter

```php
// Your app's standard payment interface
interface PaymentGateway
{
    public function charge(float $amount, string $currency, array $cardDetails): PaymentResponse;
    public function refund(string $transactionId, float $amount): bool;
}

class PaymentResponse
{
    public function __construct(
        public readonly bool $success,
        public readonly string $transactionId,
        public readonly string $message
    ) {}
}

// Third-party Stripe SDK — has its own interface (you can't modify it)
class StripeSDK
{
    public function createCharge(array $params): array
    {
        // Stripe's own method signature
        // Returns: ['id' => 'ch_xxx', 'status' => 'succeeded', 'amount' => 1000]
        return [
            'id' => 'ch_' . uniqid(),
            'status' => 'succeeded',
            'amount' => $params['amount'],
        ];
    }

    public function createRefund(array $params): array
    {
        return ['id' => 're_' . uniqid(), 'status' => 'succeeded'];
    }
}

// Third-party bKash SDK — completely different interface
class BkashSDK
{
    public function executePayment(string $paymentId, float $amount): object
    {
        return (object) [
            'paymentID' => 'bk_' . uniqid(),
            'transactionStatus' => 'Completed',
            'amount' => $amount,
        ];
    }

    public function refundTransaction(string $trxId, float $amount, string $reason): object
    {
        return (object) ['refundTrxID' => 'ref_' . uniqid(), 'transactionStatus' => 'Completed'];
    }
}

// Adapter for Stripe — translates Stripe's interface to ours
class StripeAdapter implements PaymentGateway
{
    public function __construct(private StripeSDK $stripe) {}

    public function charge(float $amount, string $currency, array $cardDetails): PaymentResponse
    {
        $result = $this->stripe->createCharge([
            'amount' => (int) ($amount * 100), // Stripe uses cents
            'currency' => strtolower($currency),
            'source' => $cardDetails['token'] ?? '',
        ]);

        return new PaymentResponse(
            success: $result['status'] === 'succeeded',
            transactionId: $result['id'],
            message: 'Stripe charge ' . $result['status']
        );
    }

    public function refund(string $transactionId, float $amount): bool
    {
        $result = $this->stripe->createRefund([
            'charge' => $transactionId,
            'amount' => (int) ($amount * 100),
        ]);
        return $result['status'] === 'succeeded';
    }
}

// Adapter for bKash — translates bKash's interface to ours
class BkashAdapter implements PaymentGateway
{
    public function __construct(private BkashSDK $bkash) {}

    public function charge(float $amount, string $currency, array $cardDetails): PaymentResponse
    {
        $result = $this->bkash->executePayment($cardDetails['paymentId'] ?? '', $amount);

        return new PaymentResponse(
            success: $result->transactionStatus === 'Completed',
            transactionId: $result->paymentID,
            message: 'bKash payment ' . $result->transactionStatus
        );
    }

    public function refund(string $transactionId, float $amount): bool
    {
        $result = $this->bkash->refundTransaction($transactionId, $amount, 'Customer request');
        return $result->transactionStatus === 'Completed';
    }
}

// Usage — your code only depends on PaymentGateway interface
class CheckoutService
{
    public function __construct(private PaymentGateway $gateway) {}

    public function processPayment(float $amount): PaymentResponse
    {
        return $this->gateway->charge($amount, 'BDT', ['token' => 'tok_xxx']);
    }
}

// Swap gateways without changing business logic
$checkout = new CheckoutService(new StripeAdapter(new StripeSDK()));
$checkout = new CheckoutService(new BkashAdapter(new BkashSDK()));
```

### When to Use Adapter

- Integrating **third-party libraries** with different interfaces
- Making **legacy code** work with new systems
- When you **can't modify** the existing class but need it to fit your interface

### When NOT to Use

- You control both interfaces — just make them compatible directly
- Adding too many adapters = a sign of poor architecture

---

## 2. Decorator Pattern

> **Adds new behavior to objects dynamically** without modifying their code. Wraps objects like layers.

### The Concept

Think of **dressing up** — you start with a shirt, then add a jacket, then a coat. Each layer adds something without changing the layers beneath.

### PHP Example — Logger Decorator

```php
interface Logger
{
    public function log(string $message): void;
}

// Base implementation
class FileLogger implements Logger
{
    public function log(string $message): void
    {
        file_put_contents('app.log', $message . "\n", FILE_APPEND);
    }
}

// Decorator base — wraps another Logger
abstract class LoggerDecorator implements Logger
{
    public function __construct(protected Logger $logger) {}
}

// Decorator 1: Add timestamps
class TimestampLogger extends LoggerDecorator
{
    public function log(string $message): void
    {
        $timestamp = date('Y-m-d H:i:s');
        $this->logger->log("[$timestamp] $message");
    }
}

// Decorator 2: Add log level
class LevelLogger extends LoggerDecorator
{
    public function __construct(
        Logger $logger,
        private string $level = 'INFO'
    ) {
        parent::__construct($logger);
    }

    public function log(string $message): void
    {
        $this->logger->log("[{$this->level}] $message");
    }
}

// Decorator 3: Add JSON formatting
class JsonLogger extends LoggerDecorator
{
    public function log(string $message): void
    {
        $json = json_encode(['message' => $message, 'timestamp' => time()]);
        $this->logger->log($json);
    }
}

// Stack decorators — each wraps the previous!
$logger = new FileLogger();
$logger = new TimestampLogger($logger);     // Add timestamps
$logger = new LevelLogger($logger, 'ERROR'); // Add log level

$logger->log("Database connection failed");
// Output in file: [ERROR] [2026-02-17 10:30:00] Database connection failed
```

### Real-World Example — Caching Decorator

```php
interface ProductRepository
{
    public function findById(int $id): ?array;
    public function findAll(): array;
}

class DatabaseProductRepository implements ProductRepository
{
    public function findById(int $id): ?array
    {
        // Slow database query
        echo "Querying database...\n";
        return ['id' => $id, 'name' => 'Product ' . $id, 'price' => 99.99];
    }

    public function findAll(): array
    {
        echo "Querying all products from database...\n";
        return [
            ['id' => 1, 'name' => 'Product 1'],
            ['id' => 2, 'name' => 'Product 2'],
        ];
    }
}

// Caching decorator — adds caching WITHOUT modifying the original class
class CachedProductRepository implements ProductRepository
{
    private array $cache = [];

    public function __construct(
        private ProductRepository $repository
    ) {}

    public function findById(int $id): ?array
    {
        $key = "product_$id";

        if (!isset($this->cache[$key])) {
            $this->cache[$key] = $this->repository->findById($id);
        } else {
            echo "Cache hit!\n";
        }

        return $this->cache[$key];
    }

    public function findAll(): array
    {
        if (!isset($this->cache['all'])) {
            $this->cache['all'] = $this->repository->findAll();
        } else {
            echo "Cache hit for all products!\n";
        }

        return $this->cache['all'];
    }
}

// Usage
$repo = new CachedProductRepository(new DatabaseProductRepository());
$repo->findById(1); // "Querying database..."
$repo->findById(1); // "Cache hit!" — no DB query!
```

### When to Use Decorator

- Add behavior **without modifying** existing class
- Need to **combine behaviors** in flexible ways (stack decorators)
- **Laravel examples:** Middleware (each wraps the next), Cache decorators

### When NOT to Use

- Simple objects that don't need multiple layers of behavior
- When subclassing is simpler and sufficient

---

## 3. Proxy Pattern

> **Controls access to another object.** Acts as a gatekeeper or stand-in.

### The Concept

Think of a **security guard** — they control who can enter a building. They don't do the work inside, but they control access to it.

### Types of Proxy

- **Protection Proxy** — controls access based on permissions
- **Virtual Proxy** — delays object creation until needed (lazy loading)
- **Logging Proxy** — logs all access to the object

### PHP Example — Protection Proxy

```php
interface DocumentService
{
    public function read(string $docId): string;
    public function write(string $docId, string $content): bool;
    public function delete(string $docId): bool;
}

class RealDocumentService implements DocumentService
{
    public function read(string $docId): string
    {
        return "Content of document $docId";
    }

    public function write(string $docId, string $content): bool
    {
        echo "Writing to document $docId\n";
        return true;
    }

    public function delete(string $docId): bool
    {
        echo "Deleting document $docId\n";
        return true;
    }
}

// Protection Proxy — adds authorization checks
class SecureDocumentProxy implements DocumentService
{
    public function __construct(
        private DocumentService $service,
        private User $currentUser
    ) {}

    public function read(string $docId): string
    {
        // Everyone can read
        $this->logAccess('read', $docId);
        return $this->service->read($docId);
    }

    public function write(string $docId, string $content): bool
    {
        // Only editors and admins can write
        if (!$this->currentUser->hasRole('editor') && !$this->currentUser->hasRole('admin')) {
            throw new RuntimeException("Access denied: You need editor or admin role to write");
        }
        $this->logAccess('write', $docId);
        return $this->service->write($docId, $content);
    }

    public function delete(string $docId): bool
    {
        // Only admins can delete
        if (!$this->currentUser->hasRole('admin')) {
            throw new RuntimeException("Access denied: Only admins can delete documents");
        }
        $this->logAccess('delete', $docId);
        return $this->service->delete($docId);
    }

    private function logAccess(string $action, string $docId): void
    {
        echo "[AUDIT] User {$this->currentUser->getName()} performed '$action' on document $docId\n";
    }
}
```

### Virtual Proxy — Lazy Loading

```php
class HeavyImage
{
    private string $data;

    public function __construct(private string $filename)
    {
        // Expensive operation — loads image into memory
        echo "Loading image from disk: $filename\n";
        $this->data = file_get_contents($filename);
    }

    public function display(): void
    {
        echo "Displaying image: $this->filename (" . strlen($this->data) . " bytes)\n";
    }
}

// Proxy — delays loading until actually needed
class ImageProxy
{
    private ?HeavyImage $image = null;

    public function __construct(private string $filename) {}

    public function display(): void
    {
        // Load only when display() is called (lazy loading)
        if ($this->image === null) {
            $this->image = new HeavyImage($this->filename);
        }
        $this->image->display();
    }
}

// Usage — image is NOT loaded until display() is called
$image = new ImageProxy('large-photo.jpg');
// ... do other stuff ...
$image->display(); // NOW it loads
```

### When to Use Proxy

- **Access control** — check permissions before allowing operations
- **Lazy loading** — delay expensive object creation
- **Logging/auditing** — log all interactions
- **Caching** — cache results from expensive operations
- **Laravel examples:** Eloquent's lazy loading relationships, Facades

---

## 4. Facade Pattern

> **Provides a simplified interface** to a complex subsystem. Hides the complexity behind a clean API.

### The Concept

Think of a **hotel concierge** — you ask "I want to check in" and they handle room assignment, key cards, billing, housekeeping notification. You interact with ONE person, not five departments.

### PHP Example — Order Processing Facade

```php
// Complex subsystem classes
class InventoryService
{
    public function checkStock(int $productId, int $quantity): bool
    {
        echo "Checking stock for product $productId\n";
        return true;
    }

    public function reserveStock(int $productId, int $quantity): void
    {
        echo "Reserved $quantity units of product $productId\n";
    }
}

class PaymentService
{
    public function validateCard(array $cardDetails): bool
    {
        echo "Validating card...\n";
        return true;
    }

    public function processPayment(float $amount, array $cardDetails): string
    {
        echo "Processing payment of $$amount\n";
        return 'txn_' . uniqid();
    }
}

class ShippingService
{
    public function calculateShipping(string $address, float $weight): float
    {
        echo "Calculating shipping to $address\n";
        return 5.99;
    }

    public function createShipment(string $address, array $items): string
    {
        echo "Creating shipment to $address\n";
        return 'ship_' . uniqid();
    }
}

class NotificationService
{
    public function sendOrderConfirmation(string $email, string $orderId): void
    {
        echo "Sending confirmation email to $email for order $orderId\n";
    }

    public function sendShippingNotification(string $email, string $trackingId): void
    {
        echo "Sending shipping notification to $email\n";
    }
}

// Facade — ONE simple method that coordinates everything
class OrderFacade
{
    public function __construct(
        private InventoryService $inventory,
        private PaymentService $payment,
        private ShippingService $shipping,
        private NotificationService $notification
    ) {}

    public function placeOrder(
        array $items,
        array $cardDetails,
        string $address,
        string $email
    ): array {
        // Step 1: Check inventory
        foreach ($items as $item) {
            if (!$this->inventory->checkStock($item['id'], $item['qty'])) {
                throw new RuntimeException("Product {$item['id']} is out of stock");
            }
        }

        // Step 2: Reserve stock
        foreach ($items as $item) {
            $this->inventory->reserveStock($item['id'], $item['qty']);
        }

        // Step 3: Validate and process payment
        if (!$this->payment->validateCard($cardDetails)) {
            throw new RuntimeException("Invalid card details");
        }

        $total = array_sum(array_column($items, 'price'));
        $shippingCost = $this->shipping->calculateShipping($address, 2.5);
        $total += $shippingCost;

        $transactionId = $this->payment->processPayment($total, $cardDetails);

        // Step 4: Create shipment
        $trackingId = $this->shipping->createShipment($address, $items);

        // Step 5: Notify customer
        $orderId = 'ORD_' . uniqid();
        $this->notification->sendOrderConfirmation($email, $orderId);
        $this->notification->sendShippingNotification($email, $trackingId);

        return [
            'orderId' => $orderId,
            'transactionId' => $transactionId,
            'trackingId' => $trackingId,
            'total' => $total,
        ];
    }
}

// Usage — simple! One call does everything
$orderFacade = new OrderFacade(
    new InventoryService(),
    new PaymentService(),
    new ShippingService(),
    new NotificationService()
);

$result = $orderFacade->placeOrder(
    items: [
        ['id' => 1, 'qty' => 2, 'price' => 29.99],
        ['id' => 3, 'qty' => 1, 'price' => 49.99],
    ],
    cardDetails: ['number' => '4242...', 'expiry' => '12/27'],
    address: 'Dhaka, Bangladesh',
    email: 'customer@example.com'
);
```

### Laravel Facades

```php
// Laravel uses the Facade pattern extensively!

// Instead of this complex code:
$cache = app('cache');
$store = $cache->store('redis');
$store->put('key', 'value', 3600);

// You write:
Cache::put('key', 'value', 3600);  // Facade!

// Other Laravel Facades:
DB::table('users')->get();
Auth::user();
Session::get('key');
Mail::to('user@example.com')->send(new WelcomeMail());
```

### When to Use Facade

- Simplify access to a **complex subsystem**
- Provide a **clean API** for common operations
- **Decouple** clients from subsystem implementation details

### When NOT to Use

- Don't create a facade that becomes a **"God class"** doing everything
- Don't use it to hide bad design — fix the underlying architecture instead

---

## Pattern Comparison

| Pattern | Purpose | Real-World Example |
|---|---|---|
| **Adapter** | Convert interface A to interface B | Payment gateway SDKs |
| **Decorator** | Add behavior dynamically in layers | Middleware, Caching, Logging |
| **Proxy** | Control access to an object | Auth checks, Lazy loading |
| **Facade** | Simplify complex subsystem | Laravel Facades, Order processing |

### How to Tell Them Apart (Interview Question!)

- **Adapter** changes the interface — makes X look like Y
- **Decorator** enhances the interface — adds new behavior to X
- **Proxy** controls the interface — same interface, controlled access
- **Facade** simplifies the interface — hides complexity behind one method

---

## Common Interview Questions

1. **Difference between Adapter and Facade?**
   → Adapter converts ONE interface to ANOTHER. Facade provides a simplified interface to MULTIPLE classes.

2. **Difference between Decorator and Proxy?**
   → Decorator ADDS new behavior. Proxy CONTROLS access to existing behavior.

3. **Where does Laravel use the Decorator pattern?**
   → Middleware — each middleware wraps the next handler, adding behavior (auth, CORS, logging).

4. **What are Laravel Facades? Are they real Facades?**
   → Laravel Facades are technically proxies to service container bindings, not pure Facade pattern. But they simplify access to complex services, which is the spirit of the pattern.

5. **When would you use Proxy over Decorator?**
   → Proxy when you need access control, lazy loading, or auditing. Decorator when you need to dynamically add or combine behaviors.
