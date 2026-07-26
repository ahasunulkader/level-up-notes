# Security Fundamentals

## TL;DR
Security is not optional — it's built in from the start. **Authentication** verifies who you are; **authorization** controls what you can do. **SQL injection and XSS** are the most common attack vectors — parameterized queries and output escaping stop both. **Least privilege** limits damage when things go wrong. **Input is always untrusted** — validate and sanitize everything. **Passwords are hashed** — never stored in plain text.

---

## Why Security Matters

Security breaches have real consequences:
- User data exposed (GDPR fines up to 4% of global revenue)
- Reputation destroyed — users lose trust permanently
- Financial damage — ransom, fraud, legal liability
- Downtime — attackers can take your service offline

Most attacks exploit known, preventable vulnerabilities — not exotic zero-days. The OWASP Top 10 lists the most common web vulnerabilities. Understanding them means you can prevent the vast majority of real-world attacks.

---

## 1. Authentication vs Authorization

These two concepts are often confused but are completely different.

### Authentication — "Who Are You?"

Authentication **verifies identity** — proving you are who you claim to be.

```php
// Authentication: verifying the user's credentials
public function login(string $email, string $password): ?User {
    $user = User::where('email', $email)->first();

    if (!$user) {
        return null; // user doesn't exist
    }

    // password_verify compares against the bcrypt hash — NEVER compare plain text
    if (!password_verify($password, $user->password_hash)) {
        return null; // wrong password
    }

    return $user; // identity confirmed ✅
}
```

**Authentication methods:**
- Username + password (most common)
- API keys / tokens (for services)
- OAuth (login with Google, GitHub)
- MFA / 2FA (password + code from phone)
- Biometrics (fingerprint, face)

### Authorization — "What Are You Allowed to Do?"

Authorization **controls access** — what actions an authenticated user can perform.

```php
// Authorization: checking permissions AFTER identity is confirmed
class ArticleController {
    public function update(Request $request, int $articleId): Response {
        $article = Article::findOrFail($articleId);

        // AUTHENTICATE: is someone logged in?
        $user = $request->user();
        if (!$user) {
            return response()->json(['error' => 'Unauthenticated'], 401);
        }

        // AUTHORIZE: does THIS user have permission to edit THIS article?
        if ($article->author_id !== $user->id && !$user->hasRole('admin')) {
            return response()->json(['error' => 'Forbidden'], 403); // 403 not 401!
        }

        $article->update($request->validated());
        return response()->json($article);
    }
}
```

### Authentication vs Authorization — Key Differences

| | Authentication | Authorization |
|---|---|---|
| Question | Who are you? | What can you do? |
| When | First — before anything else | After authentication |
| Failure code | 401 Unauthorized | 403 Forbidden |
| Example | Login with email + password | Only admins can delete users |
| Handles | Identity | Permissions |

**Common mistake:** Checking authentication but forgetting authorization.

```php
// BAD — checks login but not ownership
if (!$user) return redirect('/login'); // authentication ✅
$order = Order::find($orderId);
return view('orders.show', $order); // anyone logged in can see ANY order! ❌

// GOOD — checks login AND ownership
if (!$user) return redirect('/login');
$order = Order::where('id', $orderId)
               ->where('user_id', $user->id) // must OWN this order
               ->firstOrFail(); // 404 if not found or not theirs
return view('orders.show', $order);
```

---

## 2. Common Security Risks — SQL Injection & XSS

### SQL Injection

SQL injection happens when **user input is inserted directly into a SQL query** — allowing an attacker to modify the query itself.

```php
// VULNERABLE — string concatenation with user input
$username = $_GET['username']; // attacker sends: ' OR '1'='1
$query = "SELECT * FROM users WHERE username = '$username'";
// Becomes: SELECT * FROM users WHERE username = '' OR '1'='1'
// Returns ALL users — bypasses authentication!

// WORSE
$username = $_GET['username']; // attacker sends: '; DROP TABLE users; --
$query = "SELECT * FROM users WHERE username = '$username'";
// Becomes: SELECT * FROM users WHERE username = ''; DROP TABLE users; --
// Deletes the entire users table!

// SAFE — parameterized query (prepared statement)
$stmt = $pdo->prepare('SELECT * FROM users WHERE username = ?');
$stmt->execute([$username]);
// The ? placeholder is NEVER interpreted as SQL — always treated as literal data
// No injection possible regardless of what $username contains
```

**Why prepared statements work:** The SQL structure is sent to the database first (during `prepare()`), then the data is sent separately (`execute()`). The database never allows data to change the query structure.

```php
// Laravel Eloquent (safe by default — uses parameterized queries)
User::where('email', $email)->first(); // safe ✅

// Raw queries in Laravel — must use bindings
DB::select('SELECT * FROM users WHERE email = ?', [$email]); // safe ✅
DB::select("SELECT * FROM users WHERE email = '$email'");    // UNSAFE ❌
```

### Cross-Site Scripting (XSS)

XSS happens when **user-supplied content is rendered as HTML/JavaScript** without escaping, allowing attackers to inject scripts that run in other users' browsers.

```php
// VULNERABLE — rendering user input directly as HTML
echo "<h1>Welcome back, " . $_GET['name'] . "!</h1>";
// Attacker visits: /page?name=<script>document.cookie</script>
// ALL users viewing this page run the attacker's JavaScript
// The script can steal session cookies, redirect users, log keystrokes

// SAFE — escape HTML entities before output
echo "<h1>Welcome back, " . htmlspecialchars($_GET['name'], ENT_QUOTES, 'UTF-8') . "!</h1>";
// <script> becomes &lt;script&gt; — displayed as text, not executed
```

**In Blade (Laravel) — escaped by default:**
```php
// Blade auto-escapes with {{ }}
{{ $user->name }}         // safe — htmlspecialchars applied automatically
{!! $user->bio !!}        // UNSAFE — raw output, only use for trusted HTML
```

**Stored XSS — the dangerous variant:**
```php
// User saves a malicious comment to the database
// Comment: <script>fetch('/api/steal?cookie='+document.cookie)</script>
// Every user who views that comment has their session stolen

// Prevent: escape on OUTPUT (not just on input)
// Even "clean" database data should be escaped when rendering
echo htmlspecialchars($comment->body, ENT_QUOTES, 'UTF-8');
```

**Content Security Policy (CSP)** — defense in depth:
```html
<!-- HTTP header or meta tag — restricts what scripts can run -->
Content-Security-Policy: default-src 'self'; script-src 'self' https://cdn.example.com
<!-- Even if XSS payload is injected, the browser won't execute scripts from other origins -->
```

---

## 3. Input Validation

**Never trust input from outside your system** — HTTP request parameters, uploaded files, API responses, database values from external sources.

### Validate at the Boundary

```php
class RegisterUserRequest extends FormRequest {
    public function rules(): array {
        return [
            'name'     => ['required', 'string', 'min:2', 'max:100'],
            'email'    => ['required', 'email', 'unique:users,email'],
            'password' => ['required', 'string', 'min:8', 'confirmed'],
            'age'      => ['required', 'integer', 'min:18', 'max:120'],
        ];
    }
}

// Controller — Laravel validates before the method is reached
public function register(RegisterUserRequest $request): JsonResponse {
    $data = $request->validated(); // only contains validated fields
    // Data is guaranteed to be valid here — no need to re-check
    $user = User::create($data);
    return response()->json($user, 201);
}
```

### Whitelist, Not Blacklist

```php
// BAD — blacklisting (trying to filter out bad characters)
$input = str_replace(['<', '>', '"', "'", ';'], '', $input);
// Attackers find encodings and variations you didn't think of

// GOOD — whitelist (only allow known-good characters)
if (!preg_match('/^[a-zA-Z0-9\s\-_]+$/', $username)) {
    throw new \InvalidArgumentException('Username contains invalid characters');
}
// Only alphanumeric, spaces, hyphens, and underscores are allowed — everything else rejected
```

### Validate Type and Range

```php
// Validate that input is what you expect
$userId    = filter_var($_GET['id'],     FILTER_VALIDATE_INT);
$email     = filter_var($_POST['email'], FILTER_VALIDATE_EMAIL);
$price     = filter_var($_POST['price'], FILTER_VALIDATE_FLOAT);

if ($userId === false || $userId <= 0) {
    throw new \InvalidArgumentException('Invalid user ID');
}

// Validate against known values (enum-style)
$allowedStatuses = ['pending', 'active', 'inactive', 'banned'];
if (!in_array($status, $allowedStatuses, true)) {
    throw new \InvalidArgumentException("Invalid status: {$status}");
}
```

### Mass Assignment Protection

```php
// BAD — user can send any field and it gets saved
// Attacker sends: {"name": "Alice", "role": "admin", "is_verified": true}
User::create($request->all()); // saves ALL fields including role!

// GOOD — explicit whitelist of fillable fields
class User extends Model {
    // Only these fields can be mass-assigned
    protected $fillable = ['name', 'email', 'password'];
    // Or: protected $guarded = ['role', 'is_admin']; — blacklist approach
}

// Or use validated() with explicit field list
User::create($request->only(['name', 'email', 'password']));
```

---

## 4. Least Privilege Principle

Give each entity (user, service, process, database account) **the minimum permissions needed to do its job** — nothing more.

### Why It Matters

If something is compromised (hacked, exploited, misconfigured), least privilege limits the blast radius:
- A compromised read-only service can't delete data
- A frontend service with DB read access can't drop tables
- A user with view permissions can't change other users' data

### Database Least Privilege

```sql
-- BAD — application uses root / superuser
GRANT ALL PRIVILEGES ON *.* TO 'app_user'@'%'; -- can do anything!

-- GOOD — only what the app actually needs
GRANT SELECT, INSERT, UPDATE, DELETE ON myapp.* TO 'app_user'@'localhost';
-- Can't DROP TABLE, can't access other databases, can only connect from localhost
-- Separate read-only user for reporting queries
GRANT SELECT ON myapp.* TO 'reporting_user'@'localhost';
```

### API and Service Permissions

```php
// BAD — using admin API key for everything
$stripe = new \Stripe\StripeClient(env('STRIPE_ADMIN_KEY')); // can do anything
// If this key leaks, attacker has full Stripe control

// GOOD — use restricted keys
// Stripe: Create restricted key with only "charges:create" permission
// If it leaks, attacker can only create charges, can't read customer data or refund

// AWS IAM: S3 bucket access for profile photos only
// Bad: AmazonS3FullAccess policy — can read/write/delete ALL buckets
// Good: specific policy for one bucket, specific actions
{
    "Action": ["s3:GetObject", "s3:PutObject"],
    "Resource": "arn:aws:s3:::myapp-profile-photos/*",
    "Effect": "Allow"
}
```

### Role-Based Access Control (RBAC)

```php
// Roles carry permissions — assign role, not individual permissions
enum Role: string {
    case Guest    = 'guest';
    case User     = 'user';
    case Editor   = 'editor';
    case Admin    = 'admin';
}

$permissions = [
    Role::Guest  => ['articles:read'],
    Role::User   => ['articles:read', 'comments:create'],
    Role::Editor => ['articles:read', 'articles:create', 'articles:edit', 'comments:create'],
    Role::Admin  => ['*'], // all permissions
];

// Check permission
function can(User $user, string $permission): bool {
    $userPerms = $permissions[$user->role] ?? [];
    return in_array('*', $userPerms) || in_array($permission, $userPerms);
}

// Usage
if (!can($user, 'articles:edit')) {
    return response()->json(['error' => 'Forbidden'], 403);
}
```

---

## 5. Data Protection Basics

### Password Hashing — Never Store Plain Text

```php
// BAD — storing plain text password
$user->password = $request->password; // if DB leaks, attacker has all passwords

// BAD — reversible encryption
$user->password = encrypt($request->password); // if key leaks, decrypt all passwords

// GOOD — one-way hash (bcrypt)
$user->password = password_hash($request->password, PASSWORD_BCRYPT);
// Stored: $2y$12$AbCdEfGhIjKlMnOpQrStUuVwXyZ123456789...
// Cannot be reversed — even if DB leaks, passwords are safe

// Verify login
if (password_verify($inputPassword, $user->password)) {
    // password matches
}

// Future-proofing — check if hash needs upgrade
if (password_needs_rehash($user->password, PASSWORD_BCRYPT)) {
    $user->update(['password' => password_hash($inputPassword, PASSWORD_BCRYPT)]);
}
```

**Why bcrypt (not MD5/SHA1)?**
- bcrypt is intentionally slow — makes brute-force attacks impractical
- MD5/SHA1 are fast — GPUs can compute billions of hashes per second
- bcrypt has a built-in cost factor — increase it as hardware gets faster

### Sensitive Data at Rest

```php
// Don't store what you don't need
// BAD — storing full card number
$user->card_number = '4111111111111111'; // PCI DSS violation

// GOOD — store only last 4 digits and let payment processor handle the rest
$user->card_last_four = '1111';
$user->stripe_customer_id = 'cus_...'; // Stripe stores the actual card

// Encrypt what you must store (e.g., sensitive PII)
// Laravel's encrypt/decrypt (uses AES-256)
$user->ssn_encrypted = encrypt($ssn);
$ssn = decrypt($user->ssn_encrypted);
```

### HTTPS Everywhere

```php
// Redirect HTTP to HTTPS in Laravel
// AppServiceProvider::boot()
if (!app()->environment('local')) {
    URL::forceScheme('https');
}

// Set secure cookies
config(['session.secure' => true]); // cookie only sent over HTTPS
config(['session.cookie' => 'httponly']); // JS can't read session cookie

// HSTS header — tell browsers to ONLY use HTTPS for this domain
header('Strict-Transport-Security: max-age=31536000; includeSubDomains');
```

---

## 6. Secure API Design

### Authentication — Token-Based

```php
// JWT / Bearer token authentication
// Client sends: Authorization: Bearer eyJhbGciOiJIUzI1NiJ9...

public function authenticate(Request $request): JsonResponse {
    $token = $request->bearerToken();
    if (!$token) {
        return response()->json(['error' => 'No token provided'], 401);
    }

    try {
        $payload = JWT::decode($token, env('JWT_SECRET'), ['HS256']);
        $user    = User::findOrFail($payload->user_id);
        // Continue with authenticated user
    } catch (\Exception $e) {
        return response()->json(['error' => 'Invalid or expired token'], 401);
    }
}
```

### Rate Limiting

Prevent brute-force attacks and API abuse:

```php
// Laravel rate limiting middleware
Route::middleware(['throttle:api'])->group(function () {
    Route::post('/login', [AuthController::class, 'login']);
});

// Custom rate limiter
RateLimiter::for('login', function (Request $request) {
    return Limit::perMinute(5)->by($request->ip()); // 5 login attempts per minute per IP
});

// Even stricter for sensitive endpoints
RateLimiter::for('password-reset', function (Request $request) {
    return Limit::perHour(3)->by($request->ip());
});
```

### Never Expose Internal Details

```php
// BAD — leaks internal implementation
return response()->json([
    'error' => $e->getMessage(), // "SQLSTATE[42S22]: Column not found: email_address"
    'trace' => $e->getTraceAsString(), // full stack trace!
    'query' => $query, // your SQL!
]);

// GOOD — generic message to client, detailed log internally
Log::error('User lookup failed', ['exception' => $e, 'user_id' => $userId]);
return response()->json(['error' => 'An error occurred. Please try again.'], 500);
```

### API Security Checklist

```
Authentication:
  ✅ All endpoints require authentication (except public ones)
  ✅ Tokens expire and can be revoked
  ✅ Passwords hashed with bcrypt

Authorization:
  ✅ Users can only access their own resources
  ✅ Role-based permissions enforced server-side (not just hidden in UI)
  ✅ Admin endpoints require admin role

Input:
  ✅ All inputs validated and sanitized
  ✅ File uploads: validate MIME type via finfo, not $_FILES['type']
  ✅ Mass assignment protection

Output:
  ✅ No sensitive data in responses (passwords, tokens, internal IDs)
  ✅ Error messages don't leak implementation details
  ✅ Appropriate CORS headers (not wildcard * in production)

Transport:
  ✅ HTTPS enforced
  ✅ Cookies: secure=true, httponly=true, samesite=strict
  ✅ HSTS header set

Rate limiting:
  ✅ Login attempts limited per IP
  ✅ API endpoints rate-limited per user/IP
  ✅ Password reset limited
```

---

## Interview Q&A

**Q: What is the difference between authentication and authorization?**
A: Authentication verifies identity — "who are you?" (login with email + password). Authorization controls access — "what are you allowed to do?" (only the owner can delete their own posts). Authentication happens first; authorization happens after. Failed authentication = 401 Unauthorized. Failed authorization = 403 Forbidden.

**Q: What is SQL injection and how do you prevent it?**
A: SQL injection is when user input is concatenated directly into a SQL query, allowing an attacker to modify the query. Example: `$query = "SELECT * FROM users WHERE id = $id"` — if `$id` is `1 OR 1=1`, the query returns all users. Prevention: always use parameterized queries (prepared statements) where the SQL structure and data are sent separately to the database.

**Q: What is XSS and how do you prevent it?**
A: Cross-Site Scripting injects malicious JavaScript into pages viewed by other users. If user input is rendered as HTML without escaping, an attacker can inject `<script>stealCookies()</script>`. Prevention: always escape output with `htmlspecialchars()` before rendering user data as HTML. In Laravel Blade, `{{ $var }}` escapes automatically; `{!! $var !!}` is unsafe.

**Q: Why should passwords be hashed with bcrypt instead of MD5?**
A: MD5 and SHA1 are fast hashing algorithms — modern GPUs can compute billions per second, making brute-force attacks trivial. Bcrypt is intentionally slow and has a configurable cost factor. Even if the database is compromised, bcrypt hashes take years to crack by brute force. MD5 hashes of common passwords can be reversed instantly with rainbow tables.

**Q: What is the principle of least privilege?**
A: Each user, service, or process should have only the minimum permissions required for its job. A read-only reporting service shouldn't have write access. A user shouldn't be able to access other users' data. This limits the damage when something is compromised — a stolen read-only API key can't delete data.

**Q: What is the difference between input validation and output escaping? Do you need both?**
A: Input validation checks that data conforms to expected format before processing (email is a valid email, age is a positive integer). Output escaping transforms data when displaying it so it can't be interpreted as code (converting `<` to `&lt;`). Yes, you need both — validate on input to reject garbage, escape on output to prevent XSS. Don't rely on input sanitization alone to prevent XSS; always escape at output.
