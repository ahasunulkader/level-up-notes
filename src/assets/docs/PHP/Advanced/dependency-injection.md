# Dependency Injection & DI Containers in PHP

## TL;DR
**Dependency Injection (DI)** means giving a class its dependencies from the outside instead of having it create them itself. This keeps classes loosely coupled, testable, and focused on one thing. A **DI Container** automates the wiring — you register what depends on what, and the container builds and injects everything automatically when you need an object.

---

## The Problem DI Solves

```php
// WITHOUT DI — class creates its own dependencies (tightly coupled)
class OrderService {
    private $db;
    private $mailer;
    private $logger;

    public function __construct() {
        // Hard-coded dependencies — can't swap them for testing or different environments
        $this->db     = new MySQLConnection('localhost', 'root', 'secret', 'shop');
        $this->mailer = new SmtpMailer('smtp.gmail.com', 587, 'user', 'pass');
        $this->logger = new FileLogger('/var/log/app.log');
    }
}

// Problems:
// 1. Can't test without a real MySQL database and SMTP server
// 2. Can't swap MySQLMailer for a mock in tests
// 3. OrderService knows HOW to build its own dependencies — not its job
// 4. Config is scattered inside class constructors
// 5. Every test hits real services → slow, fragile, side effects
```

---

## Types of Dependency Injection

### 1. Constructor Injection (Preferred)

Dependencies are passed in the constructor. They're available for the entire lifetime of the object.

```php
interface MailerInterface {
    public function send(string $to, string $subject, string $body): void;
}

interface LoggerInterface {
    public function log(string $level, string $message): void;
}

interface OrderRepositoryInterface {
    public function save(Order $order): void;
    public function findById(int $id): ?Order;
}

class OrderService {
    // Dependencies are interfaces — can be swapped
    public function __construct(
        private OrderRepositoryInterface $orders,
        private MailerInterface          $mailer,
        private LoggerInterface          $logger,
    ) {}

    public function placeOrder(array $data): Order {
        $order = new Order($data);
        $this->orders->save($order);
        $this->mailer->send($data['email'], 'Order Confirmed', "Your order #{$order->id}");
        $this->logger->log('info', "Order placed: {$order->id}");
        return $order;
    }
}

// In production: inject real implementations
$service = new OrderService(
    new MysqlOrderRepository($pdo),
    new SmtpMailer($config),
    new FileLogger('/var/log/app.log')
);

// In tests: inject fakes
$service = new OrderService(
    new InMemoryOrderRepository(),
    new FakeMailer(),
    new NullLogger()
);
```

### 2. Setter Injection

Dependencies are passed via setter methods. Use when a dependency is optional.

```php
class ReportGenerator {
    private ?LoggerInterface $logger = null;

    // Required dependency
    public function __construct(private DataSource $source) {}

    // Optional dependency via setter
    public function setLogger(LoggerInterface $logger): void {
        $this->logger = $logger;
    }

    public function generate(): Report {
        $data = $this->source->fetch();
        $this->logger?->log('info', 'Report generated');
        return new Report($data);
    }
}

$gen = new ReportGenerator($dataSource);
$gen->setLogger($logger); // optional — works without it too
```

### 3. Interface Injection

The class implements an interface that defines how it receives the dependency:

```php
interface LoggerAware {
    public function setLogger(LoggerInterface $logger): void;
}

class PaymentService implements LoggerAware {
    private LoggerInterface $logger;

    public function setLogger(LoggerInterface $logger): void {
        $this->logger = $logger;
    }
}
```

### Comparison

| Type | When to Use | Notes |
|---|---|---|
| Constructor | Required dependencies | Best default choice |
| Setter | Optional dependencies | Can change at runtime |
| Interface | Framework-driven injection | Less common, more boilerplate |

---

## Programming to Interfaces

The key to DI working well is depending on **abstractions** (interfaces), not concrete classes:

```php
// ❌ Depending on concrete class — tightly coupled
class UserService {
    public function __construct(private MySqlUserRepository $repo) {}
}

// ✅ Depending on interface — loosely coupled, swappable
class UserService {
    public function __construct(private UserRepositoryInterface $repo) {}
}

interface UserRepositoryInterface {
    public function findById(int $id): ?User;
    public function save(User $user): void;
    public function findByEmail(string $email): ?User;
}

// Multiple implementations of the same interface
class MysqlUserRepository implements UserRepositoryInterface { /* ... */ }
class InMemoryUserRepository implements UserRepositoryInterface { /* testing */ }
class CachedUserRepository implements UserRepositoryInterface {
    public function __construct(
        private UserRepositoryInterface $inner,
        private CacheInterface $cache
    ) {}

    public function findById(int $id): ?User {
        return $this->cache->remember("user:$id", fn() => $this->inner->findById($id));
    }
}
```

---

## DI Container

A DI Container (also called IoC Container) **automates object creation and dependency wiring**. Instead of manually building the dependency tree, you register bindings and the container resolves them.

### The Problem Without a Container

```php
// Manual wiring — painful for large apps
$pdo        = new PDO('mysql:host=localhost', 'root', 'secret');
$userRepo   = new MysqlUserRepository($pdo);
$mailer     = new SmtpMailer('smtp.gmail.com', 587, 'user', 'pass');
$logger     = new FileLogger('/var/log/app.log');
$cache      = new RedisCache($redisConnection);
$cachedRepo = new CachedUserRepository($userRepo, $cache);
$service    = new UserService($cachedRepo, $mailer, $logger);

// For every class you need, you manually build the whole tree
// Change one dependency → update every place you build it manually
```

### Building a Simple DI Container

```php
class Container {
    private array $bindings  = [];
    private array $instances = [];

    // Register a binding (factory callable)
    public function bind(string $abstract, callable $factory): void {
        $this->bindings[$abstract] = $factory;
    }

    // Register a singleton (same instance every time)
    public function singleton(string $abstract, callable $factory): void {
        $this->bindings[$abstract] = function () use ($abstract, $factory) {
            if (!isset($this->instances[$abstract])) {
                $this->instances[$abstract] = $factory($this);
            }
            return $this->instances[$abstract];
        };
    }

    // Resolve a binding
    public function make(string $abstract): mixed {
        if (isset($this->bindings[$abstract])) {
            return ($this->bindings[$abstract])($this);
        }
        // Auto-resolve using reflection if no binding registered
        return $this->resolve($abstract);
    }

    // Auto-wire using PHP Reflection
    private function resolve(string $class): object {
        $reflector   = new ReflectionClass($class);
        $constructor = $reflector->getConstructor();

        if (!$constructor) {
            return new $class();
        }

        $dependencies = array_map(
            fn(ReflectionParameter $param) => $this->make($param->getType()->getName()),
            $constructor->getParameters()
        );

        return $reflector->newInstanceArgs($dependencies);
    }
}

// Register bindings
$container = new Container();

$container->singleton(PDO::class, fn() =>
    new PDO('mysql:host=localhost;dbname=shop', 'root', 'secret')
);

$container->bind(UserRepositoryInterface::class, fn(Container $c) =>
    new MysqlUserRepository($c->make(PDO::class))
);

$container->bind(MailerInterface::class, fn() =>
    new SmtpMailer('smtp.gmail.com', 587)
);

$container->bind(LoggerInterface::class, fn() =>
    new FileLogger('/var/log/app.log')
);

// Now just ask for what you need
$service = $container->make(UserService::class);
// Container automatically builds UserService with all its dependencies!
```

---

## Using PHP-DI (Popular DI Container)

```bash
composer require php-di/php-di
```

```php
use DI\ContainerBuilder;

// Build the container
$builder = new ContainerBuilder();

// Register bindings in a definitions array
$builder->addDefinitions([
    // Interface → implementation binding
    UserRepositoryInterface::class => DI\create(MysqlUserRepository::class),

    MailerInterface::class => DI\factory(function () {
        return new SmtpMailer(getenv('SMTP_HOST'), getenv('SMTP_PORT'));
    }),

    // Scalar values
    LoggerInterface::class => DI\create(FileLogger::class)
        ->constructor(DI\value('/var/log/app.log')),

    // Singleton — same instance everywhere
    PDO::class => DI\factory(function () {
        return new PDO(getenv('DB_DSN'), getenv('DB_USER'), getenv('DB_PASS'));
    })->lazy(), // created only when first needed
]);

$container = $builder->build();

// PHP-DI auto-wires using type hints — no manual binding needed for concrete classes
$service = $container->get(UserService::class);
// Automatically injects UserRepositoryInterface and MailerInterface!
```

### Auto-wiring (PHP-DI's killer feature)

```php
// PHP-DI reads constructor type hints via Reflection and resolves automatically
class UserService {
    // PHP-DI sees UserRepositoryInterface → looks up binding → injects MysqlUserRepository
    public function __construct(
        private UserRepositoryInterface $repo,    // auto-wired from binding
        private MailerInterface         $mailer,  // auto-wired from binding
        private FileLogger              $logger,  // auto-wired (concrete class, no binding needed)
    ) {}
}

// Just ask for it — no manual wiring
$service = $container->get(UserService::class);
```

---

## Using Laravel's Service Container

Laravel has a built-in DI container — the most used PHP container in practice:

```php
// app/Providers/AppServiceProvider.php
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider {
    public function register(): void {
        // Bind interface to implementation
        $this->app->bind(
            UserRepositoryInterface::class,
            MysqlUserRepository::class
        );

        // Singleton — one instance for the whole request
        $this->app->singleton(CacheInterface::class, fn() =>
            new RedisCache(config('cache.redis'))
        );
    }
}

// Controller — Laravel auto-injects via type hints
class UserController extends Controller {
    // Laravel resolves UserService and all its dependencies automatically
    public function __construct(private UserService $service) {}

    public function show(int $id): JsonResponse {
        return response()->json($this->service->getUser($id));
    }
}
```

---

## Real-World DI Example

```php
// Layered application with full DI

interface ProductRepositoryInterface {
    public function findById(int $id): ?Product;
    /** @return Product[] */
    public function findAll(): array;
}

interface PricingServiceInterface {
    public function calculatePrice(Product $product, User $user): float;
}

class ProductService {
    public function __construct(
        private ProductRepositoryInterface $products,
        private PricingServiceInterface    $pricing,
        private LoggerInterface            $logger,
        private CacheInterface             $cache,
    ) {}

    public function getProductForUser(int $productId, User $user): array {
        $cacheKey = "product:$productId:user:{$user->id}";

        return $this->cache->remember($cacheKey, 300, function () use ($productId, $user) {
            $product = $this->products->findById($productId);

            if (!$product) {
                throw new ProductNotFoundException($productId);
            }

            $price = $this->pricing->calculatePrice($product, $user);
            $this->logger->log('info', "Product $productId fetched for user {$user->id}");

            return ['product' => $product, 'price' => $price];
        });
    }
}

// Test — inject mocks freely
class ProductServiceTest extends TestCase {
    public function test_returns_discounted_price_for_premium_user(): void {
        $product = new Product(1, 'Laptop', 1000.0);
        $user    = new User(1, 'Alice', 'premium');

        $productRepo = $this->createStub(ProductRepositoryInterface::class);
        $productRepo->method('findById')->willReturn($product);

        $pricing = $this->createStub(PricingServiceInterface::class);
        $pricing->method('calculatePrice')->willReturn(800.0); // 20% off for premium

        $logger = $this->createStub(LoggerInterface::class);
        $cache  = new ArrayCache(); // in-memory implementation

        $service = new ProductService($productRepo, $pricing, $logger, $cache);
        $result  = $service->getProductForUser(1, $user);

        $this->assertEquals(800.0, $result['price']);
    }
}
```

---

## Pros and Cons

### Pros
- **Testability** — inject mocks/stubs instead of real dependencies
- **Loose coupling** — classes don't know how their dependencies are built
- **Single Responsibility** — classes focus on their job, not on construction
- **Flexibility** — swap implementations without changing the class (e.g., swap MySQL for Redis cache)
- **Explicit dependencies** — constructor shows exactly what a class needs

### Cons
- **More boilerplate** — interfaces and bindings add code volume
- **Indirection** — harder to trace where a dependency comes from
- **Container magic** — auto-wiring can feel opaque
- **Over-engineering risk** — simple scripts don't need a full DI container

---

## Interview Q&A

**Q: What is Dependency Injection?**
A: DI is a pattern where a class receives its dependencies from outside rather than creating them itself. Instead of `new Database()` inside the class, the database is passed through the constructor. This decouples the class from its dependencies, making it testable (swap real DB for mock), flexible (swap implementations), and easier to understand.

**Q: What is the difference between DI and a DI Container?**
A: DI is the pattern — passing dependencies from outside. A DI Container is a tool that automates this. Instead of manually building the entire dependency tree every time, you register bindings once and the container resolves and injects everything automatically using reflection and your configuration.

**Q: Why should you inject interfaces rather than concrete classes?**
A: Depending on an interface means you can swap the implementation without changing the class. A `UserService` that depends on `UserRepositoryInterface` works with `MysqlUserRepository` in production and `InMemoryUserRepository` in tests — same code, different wiring. Depending on `MysqlUserRepository` directly locks you in to that implementation forever.

**Q: What is auto-wiring?**
A: Auto-wiring is when a DI container uses PHP Reflection to read a class's constructor type hints and automatically resolve and inject them — without you writing explicit bindings. PHP-DI and Laravel's container both support this. If `UserService` needs `UserRepositoryInterface`, the container sees the type hint, finds the binding, and injects it.
