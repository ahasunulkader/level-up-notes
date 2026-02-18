# API Versioning, Pagination & Filtering

As your API grows, you need strategies for **evolving without breaking clients**, **handling large datasets**, and **letting users find exactly what they need**.

---

## API Versioning

### Why Version Your API?

You release API v1. Thousands of clients use it. Now you need to change the response format. If you change v1 directly, **every client breaks**.

Versioning lets you evolve the API while keeping old clients working.

### Versioning Strategies Comparison

| Strategy | Example | Pros | Cons |
|---|---|---|---|
| **URL Path** | `/api/v1/users` | Simple, visible, easy to route | URL changes, not "pure" REST |
| **Query Parameter** | `/api/users?version=1` | Easy to add | Easy to forget, messy |
| **Header** | `Accept: application/vnd.api.v1+json` | Clean URLs | Hidden, harder to test |
| **Content Negotiation** | `Accept: application/json;version=1` | RESTful | Complex to implement |

> **Industry Standard:** URL path versioning (`/api/v1/`) is the most common and recommended for PHP/Laravel APIs. GitHub, Stripe, Twitter all use it.

### URL Path Versioning (Recommended)

```php
// routes/api.php

// Version 1
Route::prefix('v1')->group(function () {
    Route::get('/users', [V1\UserController::class, 'index']);
    Route::get('/users/{id}', [V1\UserController::class, 'show']);
    Route::post('/users', [V1\UserController::class, 'store']);
});

// Version 2 — different response format
Route::prefix('v2')->group(function () {
    Route::get('/users', [V2\UserController::class, 'index']);
    Route::get('/users/{id}', [V2\UserController::class, 'show']);
    Route::post('/users', [V2\UserController::class, 'store']);
});
```

```php
// app/Http/Controllers/Api/V1/UserController.php
namespace App\Http\Controllers\Api\V1;

class UserController extends Controller
{
    public function show(int $id): JsonResponse
    {
        $user = User::findOrFail($id);

        // V1 response — flat structure
        return response()->json([
            'id' => $user->id,
            'name' => $user->name,
            'email' => $user->email,
            'created_at' => $user->created_at->toDateTimeString(),
        ]);
    }
}
```

```php
// app/Http/Controllers/Api/V2/UserController.php
namespace App\Http\Controllers\Api\V2;

class UserController extends Controller
{
    public function show(int $id): JsonResponse
    {
        $user = User::with('profile', 'roles')->findOrFail($id);

        // V2 response — nested structure with more data
        return response()->json([
            'data' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'profile' => [
                    'avatar' => $user->profile->avatar_url,
                    'bio' => $user->profile->bio,
                ],
                'roles' => $user->roles->pluck('name'),
            ],
            'meta' => [
                'api_version' => 'v2',
            ],
        ]);
    }
}
```

### Header-Based Versioning

```php
// Using middleware to detect version from header
class ApiVersionMiddleware
{
    public function handle(Request $request, Closure $next): Response
    {
        $version = $request->header('Api-Version', 'v1');
        // or from Accept header:
        // Accept: application/vnd.myapp.v2+json

        $request->attributes->set('api_version', $version);
        return $next($request);
    }
}

// In controller
public function show(Request $request, int $id): JsonResponse
{
    $user = User::findOrFail($id);
    $version = $request->attributes->get('api_version');

    if ($version === 'v2') {
        return $this->showV2($user);
    }

    return $this->showV1($user);
}
```

### When to Create a New Version

| Create New Version | DON'T Create New Version |
|---|---|
| Removing a field from response | Adding a new optional field |
| Changing field data type | Adding a new endpoint |
| Changing URL structure | Fixing a bug |
| Changing authentication method | Adding query parameters |
| Renaming fields | Performance improvements |

---

## Pagination

Loading ALL records at once is **slow and memory-killing**. Pagination loads data in small, manageable chunks.

### Offset-Based Pagination (Simple)

The traditional approach — use `page` and `per_page`.

```php
// GET /api/products?page=2&per_page=20

class ProductController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $perPage = min($request->integer('per_page', 20), 100); // Max 100

        $products = Product::query()
            ->orderBy('created_at', 'desc')
            ->paginate($perPage);

        return response()->json([
            'data' => $products->items(),
            'pagination' => [
                'current_page' => $products->currentPage(),
                'per_page' => $products->perPage(),
                'total' => $products->total(),
                'last_page' => $products->lastPage(),
                'from' => $products->firstItem(),
                'to' => $products->lastItem(),
            ],
            'links' => [
                'first' => $products->url(1),
                'last' => $products->url($products->lastPage()),
                'prev' => $products->previousPageUrl(),
                'next' => $products->nextPageUrl(),
            ],
        ]);
    }
}
```

```json
// Response
{
    "data": [
        { "id": 21, "name": "Product 21", "price": 29.99 },
        { "id": 22, "name": "Product 22", "price": 49.99 }
    ],
    "pagination": {
        "current_page": 2,
        "per_page": 20,
        "total": 150,
        "last_page": 8,
        "from": 21,
        "to": 40
    },
    "links": {
        "first": "/api/products?page=1",
        "last": "/api/products?page=8",
        "prev": "/api/products?page=1",
        "next": "/api/products?page=3"
    }
}
```

### Cursor-Based Pagination (Scalable)

Instead of page numbers, use a **cursor** (pointer to the last seen item). Much faster for large datasets.

```php
// GET /api/products?cursor=eyJpZCI6MjB9&per_page=20

class ProductController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $perPage = min($request->integer('per_page', 20), 100);

        $products = Product::query()
            ->orderBy('id', 'desc')
            ->cursorPaginate($perPage);

        return response()->json([
            'data' => $products->items(),
            'pagination' => [
                'per_page' => $products->perPage(),
                'next_cursor' => $products->nextCursor()?->encode(),
                'prev_cursor' => $products->previousCursor()?->encode(),
                'has_more' => $products->hasMorePages(),
            ],
        ]);
    }
}
```

```json
// Response
{
    "data": [
        { "id": 20, "name": "Product 20" },
        { "id": 19, "name": "Product 19" }
    ],
    "pagination": {
        "per_page": 20,
        "next_cursor": "eyJpZCI6MTl9",
        "prev_cursor": "eyJpZCI6MjB9",
        "has_more": true
    }
}
```

### Offset vs Cursor Comparison

| Feature | Offset (`?page=5`) | Cursor (`?cursor=abc`) |
|---|---|---|
| **Jump to page** | Yes (page 1, 5, 10) | No (sequential only) |
| **Total count** | Yes | No |
| **Performance** | Slow on large data (OFFSET scans rows) | Fast always (uses indexed WHERE) |
| **Consistent results** | Can skip/duplicate if data changes | Always consistent |
| **Best for** | Admin dashboards, small datasets | Social feeds, infinite scroll, large datasets |
| **SQL** | `OFFSET 1000 LIMIT 20` | `WHERE id < 1000 LIMIT 20` |

### When to Use What

- **< 100K records, need page numbers** → Offset pagination
- **> 100K records, infinite scroll** → Cursor pagination
- **Real-time feed (new items added often)** → Cursor pagination
- **Admin panel with "Go to page X"** → Offset pagination

---

## Filtering

Let users narrow down results using query parameters.

### Basic Filtering

```php
// GET /api/products?category=electronics&min_price=100&max_price=500&in_stock=true

class ProductController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $query = Product::query();

        // Exact match filter
        if ($request->filled('category')) {
            $query->where('category', $request->category);
        }

        // Range filter
        if ($request->filled('min_price')) {
            $query->where('price', '>=', $request->float('min_price'));
        }
        if ($request->filled('max_price')) {
            $query->where('price', '<=', $request->float('max_price'));
        }

        // Boolean filter
        if ($request->has('in_stock')) {
            $query->where('in_stock', $request->boolean('in_stock'));
        }

        // Date range filter
        if ($request->filled('created_after')) {
            $query->where('created_at', '>=', $request->date('created_after'));
        }

        return response()->json($query->paginate(20));
    }
}
```

### Clean Filtering with Query Builder Class

```php
// A reusable filter class — much cleaner for complex APIs
class ProductFilter
{
    public function __construct(private Request $request) {}

    public function apply($query)
    {
        return $query
            ->when($this->request->filled('category'), function ($q) {
                $q->where('category', $this->request->category);
            })
            ->when($this->request->filled('min_price'), function ($q) {
                $q->where('price', '>=', $this->request->float('min_price'));
            })
            ->when($this->request->filled('max_price'), function ($q) {
                $q->where('price', '<=', $this->request->float('max_price'));
            })
            ->when($this->request->filled('brand'), function ($q) {
                $q->whereIn('brand', explode(',', $this->request->brand));
            })
            ->when($this->request->filled('search'), function ($q) {
                $q->where(function ($sub) {
                    $term = '%' . $this->request->search . '%';
                    $sub->where('name', 'like', $term)
                        ->orWhere('description', 'like', $term);
                });
            });
    }
}

// In controller — clean and simple
public function index(Request $request): JsonResponse
{
    $filter = new ProductFilter($request);

    $products = $filter->apply(Product::query())
        ->paginate($request->integer('per_page', 20));

    return response()->json($products);
}
```

### Sorting

```php
// GET /api/products?sort=price&order=asc
// GET /api/products?sort=created_at&order=desc
// GET /api/products?sort=-price  (prefix minus = descending)

public function index(Request $request): JsonResponse
{
    $allowedSorts = ['name', 'price', 'created_at', 'rating'];

    $sortField = $request->get('sort', 'created_at');
    $sortOrder = $request->get('order', 'desc');

    // Prevent SQL injection — only allow known columns
    if (!in_array($sortField, $allowedSorts)) {
        $sortField = 'created_at';
    }

    if (!in_array($sortOrder, ['asc', 'desc'])) {
        $sortOrder = 'desc';
    }

    $products = Product::query()
        ->orderBy($sortField, $sortOrder)
        ->paginate(20);

    return response()->json($products);
}
```

### Searching

```php
// GET /api/products?search=wireless+headphones

public function index(Request $request): JsonResponse
{
    $query = Product::query();

    if ($request->filled('search')) {
        $term = $request->search;
        $query->where(function ($q) use ($term) {
            $q->where('name', 'like', "%$term%")
              ->orWhere('description', 'like', "%$term%")
              ->orWhere('sku', 'like', "%$term%");
        });
    }

    return response()->json($query->paginate(20));
}
```

### Field Selection (Sparse Fieldsets)

Let clients request only the fields they need — reduces payload size.

```php
// GET /api/users?fields=id,name,email

public function index(Request $request): JsonResponse
{
    $allowedFields = ['id', 'name', 'email', 'phone', 'created_at'];

    $fields = $request->filled('fields')
        ? array_intersect(explode(',', $request->fields), $allowedFields)
        : $allowedFields;

    $users = User::select($fields)->paginate(20);

    return response()->json($users);
}
```

### Include Related Resources

```php
// GET /api/users?include=posts,profile
// GET /api/products?include=category,reviews

public function index(Request $request): JsonResponse
{
    $allowedIncludes = ['posts', 'profile', 'roles'];

    $query = User::query();

    if ($request->filled('include')) {
        $includes = array_intersect(
            explode(',', $request->include),
            $allowedIncludes
        );
        $query->with($includes); // Eager load only requested relations
    }

    return response()->json($query->paginate(20));
}
```

---

## Complete Real-World Example

```php
// GET /api/products?category=electronics&min_price=50&sort=price&order=asc
//     &search=headphones&include=category,reviews&fields=id,name,price
//     &page=2&per_page=10

class ProductController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $allowedSorts = ['name', 'price', 'created_at', 'rating'];
        $allowedIncludes = ['category', 'reviews', 'brand'];
        $allowedFields = ['id', 'name', 'price', 'description', 'rating', 'created_at'];

        $query = Product::query();

        // Filtering
        $query->when($request->filled('category'), fn($q) =>
            $q->where('category_id', $request->category)
        );
        $query->when($request->filled('min_price'), fn($q) =>
            $q->where('price', '>=', $request->float('min_price'))
        );
        $query->when($request->filled('max_price'), fn($q) =>
            $q->where('price', '<=', $request->float('max_price'))
        );

        // Searching
        $query->when($request->filled('search'), fn($q) =>
            $q->where('name', 'like', '%' . $request->search . '%')
        );

        // Field selection
        if ($request->filled('fields')) {
            $fields = array_intersect(
                explode(',', $request->fields),
                $allowedFields
            );
            $query->select($fields);
        }

        // Includes
        if ($request->filled('include')) {
            $includes = array_intersect(
                explode(',', $request->include),
                $allowedIncludes
            );
            $query->with($includes);
        }

        // Sorting
        $sortField = in_array($request->sort, $allowedSorts)
            ? $request->sort : 'created_at';
        $sortOrder = $request->order === 'asc' ? 'asc' : 'desc';
        $query->orderBy($sortField, $sortOrder);

        // Pagination
        $perPage = min($request->integer('per_page', 20), 100);
        $products = $query->paginate($perPage);

        return response()->json($products);
    }
}
```

---

## Common Interview Questions

1. **Which versioning strategy do you prefer and why?**
   → URL path (`/api/v1/`). It's explicit, easy to route, easy to test in browser, and used by major APIs like GitHub and Stripe.

2. **When would you create a new API version?**
   → Only for breaking changes: removing fields, changing types, renaming fields, restructuring responses. Adding new optional fields does NOT need a new version.

3. **Offset vs cursor pagination — when to use each?**
   → Offset for small datasets with page-jump needs (admin panels). Cursor for large datasets or real-time feeds (social media, infinite scroll).

4. **How do you prevent SQL injection in filtering/sorting?**
   → Whitelist allowed column names. Never pass user input directly to `orderBy()` or `where()` column names. Use parameterized queries for values.

5. **How do you handle pagination when new items are added?**
   → With offset pagination, new items cause duplicates or skips. Cursor pagination avoids this by using a stable pointer (last seen ID).
