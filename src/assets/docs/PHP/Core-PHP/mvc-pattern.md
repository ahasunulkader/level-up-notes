# PHP MVC Pattern

## TL;DR
MVC (Model-View-Controller) separates an application into 3 layers: **Model** (data + business logic), **View** (HTML/output), **Controller** (handles request, coordinates Model and View). Each layer has one job. Every major PHP framework (Laravel, Symfony, CodeIgniter) is built on MVC.

---

## Why MVC Exists

**Without MVC** — the "spaghetti" approach:

```php
// product.php — everything in one file
<?php
$conn = mysqli_connect('localhost', 'root', '', 'shop');

$id      = (int) $_GET['id'];
$result  = mysqli_query($conn, "SELECT * FROM products WHERE id = $id"); // SQL injection!
$product = mysqli_fetch_assoc($result);

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $name  = $_POST['name'];
    mysqli_query($conn, "UPDATE products SET name='$name' WHERE id=$id"); // SQL injection again!
}
?>
<html>
<body>
    <h1><?= $product['name'] ?></h1>
    <p>Price: <?= $product['price'] ?></p>
    <!-- database code mixed with HTML — can't test, can't reuse, can't maintain -->
</body>
</html>
```

**Problems:**
- SQL mixed with HTML — untestable
- Business logic scattered everywhere
- Change the database → update all files
- Change the design → risk breaking PHP logic

---

## The MVC Layers

```
Request
   │
   ▼
Controller  ──── reads/writes ────► Model (data + business logic)
   │                                    │
   │                                    ▼
   │                               Database / Cache / API
   │
   └──── passes data ──────────►  View (HTML/JSON output)
                                       │
                                       ▼
                                  Response to Browser
```

| Layer | Responsibility | What it knows about |
|---|---|---|
| **Model** | Data, business rules, database access | Database, business logic. Knows NOTHING about HTTP or HTML. |
| **View** | Display/output | Data passed to it. Knows NOTHING about DB or routing. |
| **Controller** | Receive request, coordinate | Calls Model, passes data to View. Knows about HTTP. |

---

## Building a Simple PHP MVC

### Folder Structure

```
project/
├── public/
│   └── index.php          ← single entry point (front controller)
├── src/
│   ├── Controllers/
│   │   └── ProductController.php
│   ├── Models/
│   │   └── Product.php
│   └── Views/
│       └── products/
│           ├── index.php
│           └── show.php
└── composer.json
```

### Entry Point — Front Controller

All requests route through one file:

```php
// public/index.php
require_once __DIR__ . '/../vendor/autoload.php';

$uri    = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$method = $_SERVER['REQUEST_METHOD'];

// Simple router
match(true) {
    $uri === '/products' && $method === 'GET'
        => (new App\Controllers\ProductController())->index(),

    preg_match('#^/products/(\d+)$#', $uri, $m) && $method === 'GET'
        => (new App\Controllers\ProductController())->show((int) $m[1]),

    $uri === '/products' && $method === 'POST'
        => (new App\Controllers\ProductController())->store(),

    default => (function() {
        http_response_code(404);
        echo '404 Not Found';
    })(),
};
```

### Model — Data & Business Logic

```php
// src/Models/Product.php
namespace App\Models;

use App\Database\Connection;

class Product {
    public function __construct(
        public readonly int    $id,
        public readonly string $name,
        public readonly float  $price,
        public readonly int    $stock,
    ) {}

    // Active Record style — static methods for queries
    public static function findAll(): array {
        $pdo  = Connection::getInstance();
        $stmt = $pdo->query('SELECT * FROM products ORDER BY name');
        return array_map(
            fn($row) => new static($row['id'], $row['name'], $row['price'], $row['stock']),
            $stmt->fetchAll(\PDO::FETCH_ASSOC)
        );
    }

    public static function findById(int $id): ?static {
        $pdo  = Connection::getInstance();
        $stmt = $pdo->prepare('SELECT * FROM products WHERE id = ?');
        $stmt->execute([$id]);
        $row  = $stmt->fetch(\PDO::FETCH_ASSOC);

        if (!$row) return null;

        return new static($row['id'], $row['name'], $row['price'], $row['stock']);
    }

    public static function create(string $name, float $price, int $stock): static {
        $pdo  = Connection::getInstance();
        $stmt = $pdo->prepare('INSERT INTO products (name, price, stock) VALUES (?, ?, ?)');
        $stmt->execute([$name, $price, $stock]);
        return static::findById((int) $pdo->lastInsertId());
    }

    public function isInStock(): bool {
        return $this->stock > 0;
    }

    public function discountedPrice(float $percent): float {
        return $this->price * (1 - $percent / 100);
    }
}
```

### Controller — Handle Request, Coordinate

```php
// src/Controllers/ProductController.php
namespace App\Controllers;

use App\Models\Product;

class ProductController {
    public function index(): void {
        $products = Product::findAll();         // call Model
        $this->render('products/index', compact('products')); // pass to View
    }

    public function show(int $id): void {
        $product = Product::findById($id);

        if (!$product) {
            http_response_code(404);
            $this->render('errors/404');
            return;
        }

        $this->render('products/show', compact('product'));
    }

    public function store(): void {
        // Validate input
        $name  = trim($_POST['name']  ?? '');
        $price = (float) ($_POST['price'] ?? 0);
        $stock = (int)   ($_POST['stock'] ?? 0);

        $errors = [];
        if (empty($name))   $errors['name']  = 'Name is required';
        if ($price <= 0)    $errors['price'] = 'Price must be positive';

        if (!empty($errors)) {
            $this->render('products/create', ['errors' => $errors, 'old' => $_POST]);
            return;
        }

        $product = Product::create($name, $price, $stock); // call Model
        header('Location: /products/' . $product->id);    // redirect
        exit;
    }

    // Helper — load and render a view template
    private function render(string $view, array $data = []): void {
        extract($data); // makes $products, $product etc. available as variables
        $viewPath = __DIR__ . "/../../src/Views/{$view}.php";

        if (!file_exists($viewPath)) {
            throw new \RuntimeException("View not found: {$view}");
        }

        require $viewPath;
    }
}
```

### Views — Output Only

```php
<!-- src/Views/products/index.php -->
<!DOCTYPE html>
<html>
<head><title>Products</title></head>
<body>
    <h1>Products</h1>
    <a href="/products/create">Add Product</a>
    <ul>
        <?php foreach ($products as $product): ?>
            <li>
                <a href="/products/<?= $product->id ?>">
                    <?= htmlspecialchars($product->name, ENT_QUOTES) ?>
                </a>
                — $<?= number_format($product->price, 2) ?>
                <?= $product->isInStock() ? '✅ In stock' : '❌ Out of stock' ?>
            </li>
        <?php endforeach; ?>
    </ul>
</body>
</html>
```

```php
<!-- src/Views/products/show.php -->
<h1><?= htmlspecialchars($product->name, ENT_QUOTES) ?></h1>
<p>Price: $<?= number_format($product->price, 2) ?></p>
<p>Stock: <?= $product->stock ?> units</p>
<?php if ($product->isInStock()): ?>
    <form method="POST" action="/orders">
        <input type="hidden" name="product_id" value="<?= $product->id ?>">
        <button>Buy Now</button>
    </form>
<?php else: ?>
    <p>Out of stock</p>
<?php endif; ?>
```

**View rules:**
- No database calls
- No business logic
- Only `htmlspecialchars()` for output escaping — prevents XSS
- Use PHP for loops/conditions only to display data

---

## A Second Example — JSON API with MVC

MVC isn't just for HTML. Here's the same pattern for a REST API:

```php
// src/Controllers/Api/UserController.php
namespace App\Controllers\Api;

use App\Models\User;
use App\Models\UserRepository;

class UserController {
    public function __construct(private UserRepository $users) {}

    public function index(): void {
        $users = $this->users->all();
        $this->json(array_map(fn($u) => $u->toArray(), $users));
    }

    public function show(int $id): void {
        $user = $this->users->find($id);
        if (!$user) {
            $this->json(['error' => 'User not found'], 404);
            return;
        }
        $this->json($user->toArray());
    }

    public function store(): void {
        $input = json_decode(file_get_contents('php://input'), true);

        if (empty($input['name']) || empty($input['email'])) {
            $this->json(['error' => 'Name and email are required'], 422);
            return;
        }

        $user = $this->users->create($input['name'], $input['email']);
        $this->json($user->toArray(), 201);
    }

    private function json(mixed $data, int $statusCode = 200): void {
        http_response_code($statusCode);
        header('Content-Type: application/json');
        echo json_encode($data, JSON_PRETTY_PRINT);
    }
}
```

```php
// src/Models/User.php
namespace App\Models;

class User {
    public function __construct(
        public readonly int    $id,
        public readonly string $name,
        public readonly string $email,
    ) {}

    public function toArray(): array {
        return [
            'id'    => $this->id,
            'name'  => $this->name,
            'email' => $this->email,
        ];
    }
}
```

---

## How Laravel Implements MVC

Laravel is pure MVC with more features:

```php
// routes/web.php — routing
Route::get('/products', [ProductController::class, 'index']);
Route::get('/products/{id}', [ProductController::class, 'show']);
Route::post('/products', [ProductController::class, 'store']);

// Controller
class ProductController extends Controller {
    public function index(): View {
        $products = Product::all(); // Eloquent Model
        return view('products.index', compact('products')); // Blade View
    }

    public function store(StoreProductRequest $request): RedirectResponse {
        $product = Product::create($request->validated()); // Model
        return redirect()->route('products.show', $product);
    }
}

// Model (Eloquent)
class Product extends Model {
    protected $fillable = ['name', 'price', 'stock'];

    public function isInStock(): bool {
        return $this->stock > 0;
    }
}

// View (Blade template)
// resources/views/products/index.blade.php
@foreach ($products as $product)
    <li>{{ $product->name }} — ${{ $product->price }}</li>
@endforeach
```

---

## Pros and Cons of MVC

**Benefits:**
- **Separation of concerns** — change HTML without touching PHP logic, and vice versa
- **Testability** — Controllers and Models can be unit-tested independently
- **Reusability** — same Model used by web Controller and API Controller
- **Maintainability** — easy to find where each type of code lives
- **Industry standard** — every framework uses it; your team will understand it

**Disadvantages:**
- **Boilerplate** — more files and classes than a simple script
- **Overkill for simple pages** — a 5-line form doesn't need MVC
- **Learning curve** — understanding the flow takes time initially
- **"Fat Controller" antipattern** — business logic can creep into Controllers; use Service classes to prevent this

---

## Interview Q&A

**Q: What is MVC and what does each layer do?**
A: MVC (Model-View-Controller) is an architectural pattern that separates concerns. Model handles data, database access, and business rules. View handles output (HTML or JSON) and knows nothing about the database. Controller receives the HTTP request, calls the Model, and passes data to the View.

**Q: Why should a View not have database queries?**
A: Views should only display data — mixing DB queries in views violates separation of concerns. It makes the View impossible to test without a database, makes caching harder (can't cache a view that queries DB), and makes the code impossible to read when design and data access are interleaved.

**Q: What is the "fat controller" antipattern?**
A: A fat controller has too much business logic — payment processing, email sending, complex calculations — all stuffed inside the controller method. Controllers should only coordinate: receive request, validate input, call the right service/model, return the response. Business logic should be in Model or Service classes.

**Q: What is a Front Controller?**
A: A single entry point (usually `public/index.php`) that all requests pass through. It initializes the app, handles routing, and dispatches to the correct controller. Laravel's `index.php` bootstraps the framework and passes everything to the router. This is better than having separate PHP files for each URL.

**Q: How does Laravel's MVC differ from raw PHP MVC?**
A: Laravel provides: Eloquent ORM (powerful active record), Blade templating (clean syntax with `{{ }}` auto-escaping), built-in routing (`Route::get()`), form request validation classes, middleware for cross-cutting concerns, and dependency injection. The concepts are the same MVC; Laravel just provides battle-tested implementations of each layer.
