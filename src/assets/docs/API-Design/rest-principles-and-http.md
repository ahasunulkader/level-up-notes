# REST Principles & HTTP Methods

REST (Representational State Transfer) is an **architectural style** for building web APIs. It's not a protocol or a standard — it's a set of rules that make APIs predictable, scalable, and easy to use.

> **Interview Tip:** "What makes an API RESTful?" is one of the most common interview questions. Know the 6 principles and HTTP method semantics cold.

---

## What Makes an API RESTful?

### The 6 REST Principles

#### 1. Client-Server Separation

Client (frontend) and server (backend) are **independent**. The client doesn't care how the server stores data. The server doesn't care how the client renders it.

```php
// Server only returns data — doesn't know if it's React, mobile, or CLI
Route::get('/api/users', function () {
    return response()->json(User::all()); // Just data, no HTML
});
```

#### 2. Stateless

Every request must contain **ALL information** needed to process it. The server does NOT remember previous requests.

```php
// BAD — stateful (server remembers who you are via session)
Route::get('/api/profile', function () {
    return $_SESSION['user']; // Depends on server-side session
});

// GOOD — stateless (token carries identity)
Route::get('/api/profile', function (Request $request) {
    $user = auth()->user(); // Identity comes FROM the request (JWT/Bearer token)
    return response()->json($user);
});

// Every request carries its own auth:
// GET /api/profile
// Authorization: Bearer eyJhbGciOiJIUzI1NiJ9...
```

**Why stateless?**
- Any server can handle any request (easy to scale)
- No session storage needed on server
- Load balancer can route to any server

#### 3. Uniform Interface

Use **consistent, predictable URL patterns** and HTTP methods.

```
Resources are NOUNS (not verbs):
  ✅ GET /api/users          (get all users)
  ✅ GET /api/users/42       (get user 42)
  ✅ POST /api/users         (create a user)

  ❌ GET /api/getUsers       (verb in URL — wrong!)
  ❌ POST /api/createUser    (verb in URL — wrong!)
  ❌ GET /api/deleteUser/42  (using GET for delete — wrong!)
```

#### 4. Resource-Based

Everything is a **resource** identified by a URI. Resources are nouns.

```
/api/users              → User resource (collection)
/api/users/42           → Specific user resource
/api/users/42/posts     → Posts belonging to user 42
/api/users/42/posts/7   → Specific post 7 of user 42
```

#### 5. Cacheable

Responses should indicate whether they **can be cached** and for how long.

```php
// Cacheable response
return response()->json($products)
    ->header('Cache-Control', 'public, max-age=3600')  // Cache 1 hour
    ->header('ETag', md5(json_encode($products)));

// Not cacheable (user-specific data)
return response()->json($user->profile)
    ->header('Cache-Control', 'no-cache, private');
```

#### 6. Layered System

Client doesn't know if it's talking to the **actual server** or a proxy/load balancer/cache. Each layer only knows about the next layer.

```
Client → CDN → Load Balancer → API Gateway → PHP Server → Database
(Client only sees: "I sent a request, I got a response")
```

---

## HTTP Methods — The 5 Main Verbs

### Quick Comparison Table

| Method | Purpose | Has Body? | Idempotent? | Safe? | Example |
|---|---|---|---|---|---|
| **GET** | Read/fetch data | No | Yes | Yes | Get all users |
| **POST** | Create new resource | Yes | No | No | Create a user |
| **PUT** | Replace entire resource | Yes | Yes | No | Update full user profile |
| **PATCH** | Update part of resource | Yes | Yes | No | Update just email |
| **DELETE** | Remove resource | No | Yes | No | Delete a user |

> **Safe** = doesn't change server state. **Idempotent** = calling it 10 times gives the same result as calling once.

---

### GET — Read Data

```php
// Get all users (collection)
Route::get('/api/users', function () {
    $users = User::paginate(20);
    return response()->json($users);
});

// Get single user (resource)
Route::get('/api/users/{id}', function (int $id) {
    $user = User::findOrFail($id);
    return response()->json($user);
});

// Get filtered data (query parameters)
// GET /api/users?role=admin&sort=name&order=asc
Route::get('/api/users', function (Request $request) {
    $query = User::query();

    if ($request->has('role')) {
        $query->where('role', $request->role);
    }

    if ($request->has('sort')) {
        $query->orderBy($request->sort, $request->get('order', 'asc'));
    }

    return response()->json($query->paginate(20));
});
```

**Rules for GET:**
- NEVER changes data on the server
- Should be cacheable
- Use query parameters for filtering, sorting, searching
- Returns `200 OK` with data

---

### POST — Create New Resource

```php
Route::post('/api/users', function (Request $request) {
    $validated = $request->validate([
        'name' => 'required|string|max:255',
        'email' => 'required|email|unique:users',
        'password' => 'required|min:8',
    ]);

    $user = User::create([
        'name' => $validated['name'],
        'email' => $validated['email'],
        'password' => bcrypt($validated['password']),
    ]);

    return response()->json($user, 201); // 201 Created
});
```

**Rules for POST:**
- Creates a NEW resource
- Returns `201 Created` with the created resource
- Include `Location` header pointing to the new resource
- NOT idempotent — calling twice creates TWO users

```php
// Include Location header
return response()->json($user, 201)
    ->header('Location', "/api/users/{$user->id}");
```

---

### PUT — Replace Entire Resource

```php
// PUT replaces the ENTIRE resource — you must send ALL fields
Route::put('/api/users/{id}', function (Request $request, int $id) {
    $validated = $request->validate([
        'name' => 'required|string|max:255',
        'email' => 'required|email|unique:users,email,' . $id,
        'phone' => 'required|string',
        'address' => 'required|string',
    ]);

    $user = User::findOrFail($id);
    $user->update($validated); // Replaces ALL fields

    return response()->json($user); // 200 OK
});
```

**Rules for PUT:**
- Send the **complete** resource (all fields)
- If a field is missing, it should be set to null/default
- Idempotent — calling 10 times with same data = same result
- Returns `200 OK` with updated resource

---

### PATCH — Partial Update

```php
// PATCH updates only the fields you send
Route::patch('/api/users/{id}', function (Request $request, int $id) {
    $validated = $request->validate([
        'name' => 'sometimes|string|max:255',    // "sometimes" = only validate if present
        'email' => 'sometimes|email|unique:users,email,' . $id,
        'phone' => 'sometimes|string',
    ]);

    $user = User::findOrFail($id);
    $user->update($validated); // Only updates provided fields

    return response()->json($user);
});
```

---

### PUT vs PATCH — Interview Question!

```php
// User in database:
// { id: 1, name: "John", email: "john@mail.com", phone: "017xxx" }

// PUT /api/users/1  — must send EVERYTHING
{
    "name": "John Updated",
    "email": "john@mail.com",
    "phone": "017xxx"
}
// If you omit "phone", it becomes null!

// PATCH /api/users/1  — send only what changed
{
    "name": "John Updated"
}
// "email" and "phone" stay unchanged
```

| PUT | PATCH |
|---|---|
| Replaces **entire** resource | Updates **partial** fields |
| Must send **all** fields | Send **only changed** fields |
| Missing fields = null/default | Missing fields = unchanged |
| Like **replacing a file** | Like **editing a file** |

---

### DELETE — Remove Resource

```php
Route::delete('/api/users/{id}', function (int $id) {
    $user = User::findOrFail($id);
    $user->delete();

    return response()->json(null, 204); // 204 No Content
});

// Soft delete (preferred in most apps)
Route::delete('/api/users/{id}', function (int $id) {
    $user = User::findOrFail($id);
    $user->delete(); // If model uses SoftDeletes trait

    return response()->json([
        'message' => 'User deleted successfully'
    ]);
});
```

**Rules for DELETE:**
- Returns `204 No Content` (no body) or `200 OK` with a message
- Idempotent — deleting an already-deleted resource should not error (or return 404)
- Consider **soft deletes** for data recovery

---

## Complete Laravel Resource Controller

This is how a full RESTful controller looks in Laravel:

```php
class ProductController extends Controller
{
    // GET /api/products
    public function index(Request $request): JsonResponse
    {
        $products = Product::query()
            ->when($request->search, fn($q, $s) => $q->where('name', 'like', "%$s%"))
            ->when($request->category, fn($q, $c) => $q->where('category_id', $c))
            ->orderBy($request->get('sort', 'created_at'), $request->get('order', 'desc'))
            ->paginate($request->get('per_page', 20));

        return response()->json($products);
    }

    // GET /api/products/{id}
    public function show(int $id): JsonResponse
    {
        $product = Product::with('category', 'reviews')->findOrFail($id);
        return response()->json($product);
    }

    // POST /api/products
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'price' => 'required|numeric|min:0',
            'category_id' => 'required|exists:categories,id',
            'description' => 'nullable|string',
        ]);

        $product = Product::create($validated);

        return response()->json($product, 201);
    }

    // PUT /api/products/{id}
    public function update(Request $request, int $id): JsonResponse
    {
        $product = Product::findOrFail($id);

        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'price' => 'required|numeric|min:0',
            'category_id' => 'required|exists:categories,id',
            'description' => 'nullable|string',
        ]);

        $product->update($validated);

        return response()->json($product);
    }

    // DELETE /api/products/{id}
    public function destroy(int $id): JsonResponse
    {
        $product = Product::findOrFail($id);
        $product->delete();

        return response()->json(null, 204);
    }
}

// routes/api.php — one line registers ALL routes
Route::apiResource('products', ProductController::class);

// This creates:
// GET    /api/products          → index()
// POST   /api/products          → store()
// GET    /api/products/{id}     → show()
// PUT    /api/products/{id}     → update()
// DELETE /api/products/{id}     → destroy()
```

---

## URL Design Best Practices

### Good URL Patterns

```
# Use nouns, not verbs
✅ GET  /api/users
❌ GET  /api/getUsers

# Use plural nouns
✅ /api/users
❌ /api/user

# Nested resources for relationships
✅ GET /api/users/42/orders          (orders of user 42)
✅ GET /api/users/42/orders/5        (order 5 of user 42)

# Use query params for filtering (not URL segments)
✅ GET /api/products?category=electronics&min_price=100
❌ GET /api/products/category/electronics/min_price/100

# Use kebab-case for multi-word resources
✅ /api/order-items
❌ /api/orderItems
❌ /api/order_items
```

### Nested vs Flat — When to Nest

```
# Nest when there's a clear parent-child relationship
GET /api/users/42/posts         ✅ Posts BELONG to user 42
GET /api/posts/7/comments       ✅ Comments BELONG to post 7

# Don't nest more than 2 levels deep
GET /api/users/42/posts/7/comments/3/replies  ❌ Too deep!
GET /api/comments/3/replies                    ✅ Flatten it

# Use flat when the resource can exist independently
GET /api/posts?user_id=42       ✅ Also valid (flat with filter)
```

---

## Common Interview Questions

1. **What makes an API RESTful?**
   → 6 principles: Client-server, Stateless, Uniform interface, Resource-based, Cacheable, Layered system.

2. **Difference between PUT and PATCH?**
   → PUT replaces the entire resource (send ALL fields). PATCH updates only the fields you send. PUT sets missing fields to null, PATCH leaves them unchanged.

3. **Is POST idempotent?**
   → No. Calling `POST /api/users` twice creates TWO users. GET, PUT, PATCH, DELETE are all idempotent.

4. **What does "safe" mean for HTTP methods?**
   → A safe method doesn't modify server state. Only GET and HEAD are safe. POST, PUT, PATCH, DELETE all change data.

5. **Why use nouns instead of verbs in URLs?**
   → The HTTP method IS the verb. `GET /users` reads, `POST /users` creates, `DELETE /users/1` deletes. Adding verbs like `/getUsers` is redundant.

6. **When would you use query params vs URL segments?**
   → URL segments for **identifying** resources (`/users/42`). Query params for **filtering/sorting/searching** (`/users?role=admin&sort=name`).
