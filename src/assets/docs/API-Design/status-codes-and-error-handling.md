# HTTP Status Codes & Error Response Design

Status codes tell the client **what happened** with their request. Using the right code is crucial — it's the difference between a professional API and a confusing one.

> **Interview Tip:** Don't just memorize codes. Know WHY each one exists and WHEN to use it.

---

## Status Code Categories

| Range | Category | Meaning |
|---|---|---|
| **1xx** | Informational | Request received, continuing... |
| **2xx** | Success | Request was successful |
| **3xx** | Redirection | Client needs to take additional action |
| **4xx** | Client Error | Client sent a bad request |
| **5xx** | Server Error | Server failed to process a valid request |

> **Quick rule:** 2xx = your fault (you did it right). 4xx = client's fault. 5xx = server's fault.

---

## Most Important Status Codes (Interview Must-Know)

### 2xx — Success

#### 200 OK

The most common. Request succeeded and response has data.

```php
// GET /api/users/42
public function show(int $id): JsonResponse
{
    $user = User::findOrFail($id);
    return response()->json($user, 200); // 200 is default, can omit
}

// PUT /api/users/42 (update succeeded)
public function update(Request $request, int $id): JsonResponse
{
    $user = User::findOrFail($id);
    $user->update($request->validated());
    return response()->json($user); // 200 OK with updated data
}
```

#### 201 Created

A new resource was **created** successfully. Always use with POST.

```php
// POST /api/users
public function store(Request $request): JsonResponse
{
    $user = User::create($request->validated());

    return response()->json([
        'message' => 'User created successfully',
        'data' => $user,
    ], 201); // 201 Created — NOT 200!
}
```

#### 204 No Content

Action succeeded, but there's **nothing to return**. Common for DELETE.

```php
// DELETE /api/users/42
public function destroy(int $id): Response
{
    User::findOrFail($id)->delete();
    return response()->noContent(); // 204 — empty body
}
```

### 2xx Comparison

| Code | When to Use | Has Response Body? |
|---|---|---|
| **200** | GET, PUT, PATCH succeeded | Yes — return the data |
| **201** | POST created a resource | Yes — return created resource |
| **204** | DELETE succeeded, nothing to return | No — empty body |

---

### 3xx — Redirection

#### 301 Moved Permanently

Resource has permanently moved to a new URL.

```php
// Old API version permanently redirected
Route::get('/api/v1/users', function () {
    return redirect('/api/v2/users', 301);
});
```

#### 304 Not Modified

Used with caching. "Your cached version is still valid."

```php
Route::get('/api/products', function (Request $request) {
    $products = Product::all();
    $etag = md5($products->toJson());

    if ($request->header('If-None-Match') === $etag) {
        return response('', 304); // Client's cache is still valid
    }

    return response()->json($products)
        ->header('ETag', $etag);
});
```

---

### 4xx — Client Errors

#### 400 Bad Request

The request is **malformed** or has invalid syntax.

```php
// Request body is not valid JSON
public function store(Request $request): JsonResponse
{
    $data = json_decode($request->getContent(), true);

    if (json_last_error() !== JSON_ERROR_NONE) {
        return response()->json([
            'error' => 'Bad Request',
            'message' => 'Invalid JSON in request body',
        ], 400);
    }

    // Process data...
}
```

#### 401 Unauthorized

Client is **not authenticated**. "Who are you? Show me your ID."

```php
// No token or invalid token
Route::middleware('auth:sanctum')->get('/api/profile', function () {
    return auth()->user();
});

// If no token is sent, Laravel returns:
// 401 { "message": "Unauthenticated." }
```

#### 403 Forbidden

Client IS authenticated but **doesn't have permission**. "I know who you are, but you can't do this."

```php
public function destroy(int $id): JsonResponse
{
    $post = Post::findOrFail($id);

    if ($post->user_id !== auth()->id()) {
        return response()->json([
            'error' => 'Forbidden',
            'message' => 'You can only delete your own posts',
        ], 403);
    }

    $post->delete();
    return response()->noContent();
}
```

#### 401 vs 403 — Interview Question!

| 401 Unauthorized | 403 Forbidden |
|---|---|
| NOT logged in | IS logged in |
| "Who are you?" | "You can't do this" |
| Missing/invalid token | Valid token, no permission |
| Fix: login/send token | Fix: get admin role/permission |
| **Authentication** failure | **Authorization** failure |

#### 404 Not Found

Resource **doesn't exist**.

```php
public function show(int $id): JsonResponse
{
    $user = User::find($id);

    if (!$user) {
        return response()->json([
            'error' => 'Not Found',
            'message' => "User with ID $id not found",
        ], 404);
    }

    return response()->json($user);
}

// Or use findOrFail() — Laravel auto-returns 404
$user = User::findOrFail($id); // Throws ModelNotFoundException → 404
```

#### 405 Method Not Allowed

The HTTP method is **not supported** for this route.

```
POST /api/users     → 201 (works — POST is allowed)
PUT  /api/users     → 405 (wrong — PUT needs /api/users/{id})
```

#### 409 Conflict

The request **conflicts** with the current state of the resource.

```php
public function store(Request $request): JsonResponse
{
    $existing = User::where('email', $request->email)->first();

    if ($existing) {
        return response()->json([
            'error' => 'Conflict',
            'message' => 'A user with this email already exists',
        ], 409);
    }

    $user = User::create($request->validated());
    return response()->json($user, 201);
}
```

#### 422 Unprocessable Entity

Request is well-formed but has **validation errors**. Laravel's default for validation failures.

```php
public function store(Request $request): JsonResponse
{
    // Laravel automatically returns 422 if validation fails
    $validated = $request->validate([
        'name' => 'required|string|max:255',
        'email' => 'required|email|unique:users',
        'age' => 'required|integer|min:18',
    ]);

    // If validation fails, Laravel returns:
    // 422 {
    //   "message": "The given data was invalid.",
    //   "errors": {
    //     "email": ["The email has already been taken."],
    //     "age": ["The age must be at least 18."]
    //   }
    // }
}
```

#### 429 Too Many Requests

Client has sent **too many requests** (rate limited).

```php
// Laravel throttle middleware
Route::middleware('throttle:60,1')->group(function () {
    Route::get('/api/users', [UserController::class, 'index']);
});

// After 60 requests in 1 minute:
// 429 { "message": "Too Many Attempts." }
// Headers:
//   Retry-After: 30
//   X-RateLimit-Limit: 60
//   X-RateLimit-Remaining: 0
```

### 4xx Quick Reference

| Code | Name | When to Use |
|---|---|---|
| **400** | Bad Request | Malformed syntax, invalid JSON |
| **401** | Unauthorized | Not authenticated (no/bad token) |
| **403** | Forbidden | Authenticated but no permission |
| **404** | Not Found | Resource doesn't exist |
| **405** | Method Not Allowed | Wrong HTTP method for this route |
| **409** | Conflict | Duplicate resource, state conflict |
| **422** | Unprocessable Entity | Validation errors |
| **429** | Too Many Requests | Rate limited |

---

### 5xx — Server Errors

#### 500 Internal Server Error

Something went **wrong on the server**. This is a bug — not the client's fault.

```php
// This should NEVER be intentionally returned
// It happens when unhandled exceptions occur

public function show(int $id): JsonResponse
{
    // If database is down, this throws → 500
    $user = User::findOrFail($id);
    return response()->json($user);
}
```

#### 502 Bad Gateway

Server received an **invalid response** from an upstream server.

```
Client → Nginx → PHP-FPM (crashed) → Nginx returns 502
```

#### 503 Service Unavailable

Server is **temporarily down** (maintenance, overloaded).

```php
// During maintenance mode
// php artisan down
// All requests return 503
```

---

## Error Response Design

### Bad Error Response

```json
{
    "error": true,
    "message": "Something went wrong"
}
```

No details, no error code, not helpful at all.

### Good Error Response — Standard Structure

```php
// Create a consistent error response format
class ApiResponse
{
    public static function error(
        string $message,
        int $status = 400,
        array $errors = [],
        ?string $code = null
    ): JsonResponse {
        $response = [
            'success' => false,
            'message' => $message,
        ];

        if ($code) {
            $response['error_code'] = $code;
        }

        if (!empty($errors)) {
            $response['errors'] = $errors;
        }

        return response()->json($response, $status);
    }

    public static function success(
        mixed $data = null,
        string $message = 'Success',
        int $status = 200
    ): JsonResponse {
        $response = [
            'success' => true,
            'message' => $message,
        ];

        if ($data !== null) {
            $response['data'] = $data;
        }

        return response()->json($response, $status);
    }
}
```

### Using the Standard Response

```php
class UserController extends Controller
{
    public function show(int $id): JsonResponse
    {
        $user = User::find($id);

        if (!$user) {
            return ApiResponse::error(
                message: 'User not found',
                status: 404,
                code: 'USER_NOT_FOUND'
            );
        }

        return ApiResponse::success($user);
    }

    public function store(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'name' => 'required|string',
            'email' => 'required|email|unique:users',
        ]);

        if ($validator->fails()) {
            return ApiResponse::error(
                message: 'Validation failed',
                status: 422,
                errors: $validator->errors()->toArray(),
                code: 'VALIDATION_ERROR'
            );
        }

        $user = User::create($validator->validated());

        return ApiResponse::success($user, 'User created', 201);
    }
}
```

### Response Examples

```json
// Success — 200
{
    "success": true,
    "message": "User fetched successfully",
    "data": {
        "id": 42,
        "name": "John Doe",
        "email": "john@mail.com"
    }
}

// Validation Error — 422
{
    "success": false,
    "message": "Validation failed",
    "error_code": "VALIDATION_ERROR",
    "errors": {
        "email": ["The email has already been taken."],
        "name": ["The name field is required."]
    }
}

// Not Found — 404
{
    "success": false,
    "message": "User not found",
    "error_code": "USER_NOT_FOUND"
}

// Auth Error — 401
{
    "success": false,
    "message": "Invalid or expired token",
    "error_code": "TOKEN_EXPIRED"
}
```

---

## Global Exception Handler (Laravel)

Handle ALL errors consistently in one place.

```php
// app/Exceptions/Handler.php (or bootstrap/app.php in Laravel 11+)
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

->withExceptions(function (Exceptions $exceptions) {

    // 404 — Model not found
    $exceptions->render(function (ModelNotFoundException $e) {
        $model = class_basename($e->getModel());
        return response()->json([
            'success' => false,
            'message' => "$model not found",
            'error_code' => strtoupper($model) . '_NOT_FOUND',
        ], 404);
    });

    // 401 — Not authenticated
    $exceptions->render(function (AuthenticationException $e) {
        return response()->json([
            'success' => false,
            'message' => 'Authentication required',
            'error_code' => 'UNAUTHENTICATED',
        ], 401);
    });

    // 422 — Validation failed
    $exceptions->render(function (ValidationException $e) {
        return response()->json([
            'success' => false,
            'message' => 'Validation failed',
            'error_code' => 'VALIDATION_ERROR',
            'errors' => $e->errors(),
        ], 422);
    });
});
```

---

## Common Interview Questions

1. **Difference between 401 and 403?**
   → 401 = not authenticated (who are you?). 403 = authenticated but not authorized (you can't do this).

2. **When to use 400 vs 422?**
   → 400 = malformed request (bad JSON, missing content-type). 422 = well-formed but invalid data (validation errors). Laravel uses 422 for validation.

3. **Should error responses include stack traces?**
   → NEVER in production. Only in development. Stack traces leak internal code structure and are a security risk.

4. **Why use consistent error response format?**
   → Frontend developers can write ONE error handler instead of handling different formats for each endpoint. Makes debugging easier.

5. **What status code for rate limiting?**
   → 429 Too Many Requests. Include `Retry-After` header to tell client when to try again.

6. **What's the difference between 404 and 410?**
   → 404 = resource not found (might exist later). 410 = resource is permanently gone (deleted forever, never coming back).
