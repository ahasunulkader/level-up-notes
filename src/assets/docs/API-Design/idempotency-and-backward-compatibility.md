# Idempotency & Backward Compatibility

Two concepts that separate junior APIs from production-grade APIs: **handling duplicate requests safely** and **evolving without breaking existing clients**.

---

## Idempotency

### What Does Idempotent Mean?

> An operation is **idempotent** if calling it **once or multiple times produces the same result**.

Think of an **elevator button** — pressing "Floor 5" once or pressing it 20 times gets you to the same floor. That's idempotent.

Think of **placing an order** — placing it once creates 1 order. Placing it again creates ANOTHER order. That's NOT idempotent.

### HTTP Methods and Idempotency

| Method | Idempotent? | Why? |
|---|---|---|
| **GET** | Yes | Reading data never changes anything |
| **PUT** | Yes | Replacing with same data = same result |
| **PATCH** | Yes | Updating same fields = same result |
| **DELETE** | Yes | Deleting something already deleted = still deleted |
| **POST** | **No** | Creating a resource twice = two resources! |

### Why Idempotency Matters

```
Real scenario: User clicks "Pay Now"
→ Request sent to server
→ Network timeout (no response received)
→ User clicks "Pay Now" again
→ WITHOUT idempotency: User is charged TWICE!
→ WITH idempotency: Second request is recognized as duplicate, charged only ONCE
```

### Implementing Idempotency for POST Requests

#### Strategy: Idempotency Key

The client sends a unique key with each request. If the server sees the same key again, it returns the original response instead of processing again.

```php
// Client sends a unique key in the header:
// POST /api/payments
// Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000

class IdempotencyMiddleware
{
    public function handle(Request $request, Closure $next): Response
    {
        // Only apply to POST requests
        if ($request->method() !== 'POST') {
            return $next($request);
        }

        $key = $request->header('Idempotency-Key');
        if (!$key) {
            return $next($request); // No key, process normally
        }

        $cacheKey = 'idempotency:' . auth()->id() . ':' . $key;

        // Check if we've already processed this request
        $cachedResponse = Cache::get($cacheKey);
        if ($cachedResponse) {
            return response()->json(
                $cachedResponse['body'],
                $cachedResponse['status']
            )->header('X-Idempotent-Replayed', 'true');
        }

        // Process the request
        $response = $next($request);

        // Cache the response for 24 hours
        Cache::put($cacheKey, [
            'body' => json_decode($response->getContent(), true),
            'status' => $response->getStatusCode(),
        ], now()->addHours(24));

        return $response;
    }
}
```

```php
// Register the middleware
// In bootstrap/app.php or Kernel.php
Route::middleware([IdempotencyMiddleware::class])->group(function () {
    Route::post('/api/payments', [PaymentController::class, 'store']);
    Route::post('/api/orders', [OrderController::class, 'store']);
});
```

#### Strategy: Database Unique Constraints

Prevent duplicate processing at the database level.

```php
class PaymentController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'order_id' => 'required|integer',
            'amount' => 'required|numeric',
            'idempotency_key' => 'required|uuid',
        ]);

        // Try to create — unique constraint on idempotency_key prevents duplicates
        try {
            $payment = Payment::create([
                'order_id' => $validated['order_id'],
                'amount' => $validated['amount'],
                'idempotency_key' => $validated['idempotency_key'],
                'status' => 'processing',
            ]);

            // Process payment...
            $payment->update(['status' => 'completed']);

            return response()->json($payment, 201);

        } catch (UniqueConstraintViolationException $e) {
            // Duplicate key — return the existing payment
            $existing = Payment::where(
                'idempotency_key', $validated['idempotency_key']
            )->first();

            return response()->json($existing, 200);
        }
    }
}
```

```php
// Migration
Schema::create('payments', function (Blueprint $table) {
    $table->id();
    $table->foreignId('order_id');
    $table->decimal('amount', 10, 2);
    $table->string('idempotency_key')->unique(); // Prevents duplicates!
    $table->string('status');
    $table->timestamps();
});
```

### Making Each HTTP Method Idempotent

#### GET — Naturally Idempotent

```php
// Calling 100 times returns the same data, changes nothing
Route::get('/api/users/42', function () {
    return User::findOrFail(42); // Always the same result
});
```

#### PUT — Naturally Idempotent

```php
// Replacing with the same data 100 times = same result
Route::put('/api/users/42', function (Request $request) {
    $user = User::findOrFail(42);
    $user->update([
        'name' => $request->name,     // Same data → same result
        'email' => $request->email,
    ]);
    return response()->json($user);
});
```

#### DELETE — Make It Idempotent

```php
// BAD — second call throws 404
Route::delete('/api/users/{id}', function (int $id) {
    $user = User::findOrFail($id); // Throws 404 on second call!
    $user->delete();
    return response()->noContent();
});

// GOOD — second call still succeeds
Route::delete('/api/users/{id}', function (int $id) {
    $user = User::find($id);

    if (!$user) {
        return response()->noContent(); // Already deleted — still 204
    }

    $user->delete();
    return response()->noContent();
});
```

#### POST — Must Be Made Idempotent Manually

```php
// BAD — calling twice creates duplicate orders
Route::post('/api/orders', function (Request $request) {
    $order = Order::create($request->all()); // Duplicate!
    return response()->json($order, 201);
});

// GOOD — use idempotency key
Route::post('/api/orders', function (Request $request) {
    $existing = Order::where(
        'idempotency_key', $request->idempotency_key
    )->first();

    if ($existing) {
        return response()->json($existing, 200); // Return existing
    }

    $order = Order::create([
        ...$request->validated(),
        'idempotency_key' => $request->idempotency_key,
    ]);

    return response()->json($order, 201);
});
```

---

## Backward Compatibility

### What Is Backward Compatibility?

> New version of the API **doesn't break** existing clients still using the old version.

Think of **USB ports** — USB 3.0 still works with USB 2.0 devices. That's backward compatible. If USB 3.0 only accepted USB 3.0 devices, that would break backward compatibility.

### Breaking vs Non-Breaking Changes

#### Non-Breaking Changes (Safe to Deploy)

These changes will NOT break existing clients:

```php
// 1. Adding a NEW field to response — existing clients ignore it
// Before
{ "id": 1, "name": "John" }

// After — added "avatar" field
{ "id": 1, "name": "John", "avatar": "https://..." }
// Old clients that only read "id" and "name" still work fine!

// 2. Adding a NEW optional parameter
// Before: GET /api/users
// After:  GET /api/users?include=posts  (optional, old calls still work)

// 3. Adding a NEW endpoint
// Existing: GET /api/users
// New:      GET /api/users/export  (doesn't affect existing endpoint)

// 4. Making a required field optional
// Before: "phone" was required
// After:  "phone" is optional (old clients still send it — works fine)

// 5. Adding new enum values
// Before: status can be "active" or "inactive"
// After:  status can be "active", "inactive", or "suspended"
// Old clients sending "active"/"inactive" still work
```

#### Breaking Changes (Will Break Clients!)

```php
// 1. Removing a field from response
// Before: { "id": 1, "name": "John", "email": "john@mail.com" }
// After:  { "id": 1, "name": "John" }  // "email" removed!
// Client expecting "email" → BREAKS!

// 2. Renaming a field
// Before: { "username": "john" }
// After:  { "display_name": "john" }  // Renamed!
// Client reading "username" → gets null → BREAKS!

// 3. Changing data type
// Before: { "price": "29.99" }   // string
// After:  { "price": 29.99 }     // number
// Client doing string operations on price → BREAKS!

// 4. Making an optional field required
// Before: "avatar" was optional in POST
// After:  "avatar" is required
// Old client not sending "avatar" → 422 error → BREAKS!

// 5. Changing URL structure
// Before: GET /api/users/42
// After:  GET /api/accounts/42  // Renamed!
// Client calling /api/users/42 → 404 → BREAKS!

// 6. Removing an endpoint
// Before: DELETE /api/users/42 existed
// After:  Endpoint removed
// Client calling it → 404 → BREAKS!
```

### Strategies for Backward Compatibility

#### 1. Additive Changes Only

The safest approach — only ADD things, never remove or rename.

```php
// V1 response
{
    "id": 1,
    "name": "John Doe",
    "email": "john@mail.com"
}

// Evolved response — ONLY additions
{
    "id": 1,
    "name": "John Doe",
    "email": "john@mail.com",
    "avatar_url": "https://...",         // Added
    "email_verified": true,               // Added
    "created_at": "2026-01-15T10:30:00Z"  // Added
}
// Old clients still work — they just ignore new fields
```

#### 2. Deprecation Before Removal

Never remove immediately. Warn first, then remove in the next version.

```php
class UserController extends Controller
{
    public function show(int $id): JsonResponse
    {
        $user = User::findOrFail($id);

        return response()->json([
            'id' => $user->id,
            'name' => $user->name,
            'email' => $user->email,

            // Old field (deprecated) — still works but will be removed in v3
            'username' => $user->name,

            // New field (replacement)
            'display_name' => $user->name,
        ])->header('Deprecation', 'true')
          ->header('Sunset', 'Sat, 01 Jun 2027 00:00:00 GMT')
          ->header('Link', '</api/v3/users>; rel="successor-version"');
    }
}
```

#### 3. Default Values for New Required Fields

When adding a field that should be required in the future, give it a default first.

```php
// Migration — add column with default value
Schema::table('users', function (Blueprint $table) {
    $table->string('timezone')->default('UTC'); // Default for existing users
});

// Validation — optional now, required in v3
$request->validate([
    'name' => 'required|string',
    'email' => 'required|email',
    'timezone' => 'sometimes|string|timezone', // Optional for now
]);
```

#### 4. Response Envelope Versioning

Return a version indicator so clients know what format to expect.

```php
public function show(int $id): JsonResponse
{
    $user = User::findOrFail($id);

    return response()->json([
        'api_version' => 'v2',
        'data' => [
            'id' => $user->id,
            'name' => $user->name,
            'email' => $user->email,
        ],
    ]);
}
```

### Deprecation Lifecycle

```
Phase 1: CURRENT (v1)
  → Fully supported, documented

Phase 2: DEPRECATED (v1 still works, v2 released)
  → v1 still works but returns Deprecation headers
  → Documentation says "Use v2 instead"
  → Give clients 6-12 months to migrate

Phase 3: SUNSET (v1 removed)
  → v1 returns 410 Gone with migration instructions
  → Only v2 is supported
```

```php
// Phase 3 — return 410 Gone for removed endpoints
Route::any('/api/v1/{any}', function () {
    return response()->json([
        'success' => false,
        'message' => 'API v1 has been sunset. Please migrate to v2.',
        'migration_guide' => 'https://docs.example.com/v1-to-v2',
        'error_code' => 'API_VERSION_SUNSET',
    ], 410); // 410 Gone
})->where('any', '.*');
```

---

## Idempotency + Backward Compatibility Cheat Sheet

| Concept | Problem It Solves | How |
|---|---|---|
| **Idempotency** | Duplicate requests cause duplicate data | Idempotency keys, unique constraints |
| **Backward Compatibility** | New changes break old clients | Additive changes, deprecation cycle |
| **Versioning** | Need breaking changes eventually | URL versioning (`/v1/`, `/v2/`) |
| **Deprecation Headers** | Clients don't know about upcoming changes | `Deprecation`, `Sunset` headers |

---

## Common Interview Questions

1. **What is idempotency? Give an example.**
   → Calling an operation multiple times produces the same result as calling once. `PUT /users/42 {name: "John"}` — call it 10 times, user is still "John". `POST /orders` is NOT idempotent — calling twice creates 2 orders.

2. **How do you make POST idempotent?**
   → Use an idempotency key. Client sends a unique UUID with each request. Server checks if that key was already processed. If yes, return the cached result instead of creating a duplicate.

3. **Is DELETE idempotent?**
   → Yes. Deleting a resource that's already deleted should still return success (204). The end state is the same — the resource doesn't exist.

4. **How do you handle backward compatibility when removing a field?**
   → Never remove immediately. Step 1: Add the replacement field alongside the old one. Step 2: Mark old field as deprecated with headers. Step 3: After 6-12 months, remove in a new API version.

5. **What's the difference between a breaking and non-breaking change?**
   → Non-breaking: adding fields, adding endpoints, making required fields optional. Breaking: removing fields, renaming fields, changing types, removing endpoints, making optional fields required.

6. **Real-world example: How does Stripe handle idempotency?**
   → Stripe requires an `Idempotency-Key` header on POST requests. If you retry with the same key within 24 hours, Stripe returns the original response. This prevents double charges.
