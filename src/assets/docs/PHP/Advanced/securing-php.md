# Securing PHP Applications

## TL;DR
Security in PHP means: **validate all input**, **escape all output**, **never trust the user**, and **principle of least privilege** everywhere. The most critical threats are SQL Injection (use prepared statements), XSS (escape output), CSRF (use tokens), and insecure authentication (hash passwords with bcrypt). Configuration matters too — hide errors in production, disable dangerous functions, and never expose sensitive files.

---

## a. Web Application Security (OWASP Top 10)

### 1. SQL Injection — #1 Most Dangerous

Never concatenate user input into SQL queries.

```php
// ❌ VULNERABLE — direct string interpolation
$userId = $_GET['id']; // attacker sends: 1 OR 1=1 --
$users  = $pdo->query("SELECT * FROM users WHERE id = $userId"); // dumps ALL users

// Another attack: 1; DROP TABLE users; --
// → deletes your entire users table

// ✅ SAFE — prepared statements with parameterized queries
$stmt = $pdo->prepare('SELECT * FROM users WHERE id = ?');
$stmt->execute([$_GET['id']]);
$user = $stmt->fetch();

// Named parameters (more readable)
$stmt = $pdo->prepare('SELECT * FROM users WHERE email = :email AND active = :active');
$stmt->execute(['email' => $email, 'active' => true]);
```

### 2. Cross-Site Scripting (XSS)

Never output user data without escaping.

```php
// ❌ VULNERABLE — outputs raw HTML
echo "Hello, " . $_GET['name'];
// Attacker sends: ?name=<script>document.cookie='stolen='+document.cookie</script>
// → steals session cookies

// ❌ Also vulnerable — HTML in query string
echo "<input value='" . $_GET['search'] . "'>"; // attacker breaks out of attribute

// ✅ SAFE — always escape output
echo "Hello, " . htmlspecialchars($_GET['name'], ENT_QUOTES, 'UTF-8');
echo "<input value='" . htmlspecialchars($_GET['search'], ENT_QUOTES, 'UTF-8') . "'>";

// ✅ Helper function for consistent escaping
function e(string $value): string {
    return htmlspecialchars($value, ENT_QUOTES | ENT_HTML5, 'UTF-8');
}
echo "Hello, " . e($_GET['name']);
```

**Types of XSS:**
- **Stored XSS** — malicious script saved in DB, served to all users (most dangerous)
- **Reflected XSS** — script in URL parameter, reflected back in response
- **DOM-based XSS** — JavaScript reads from URL and writes to DOM unsafely

### 3. Cross-Site Request Forgery (CSRF)

Protects forms from being submitted by malicious sites.

```php
// Generate CSRF token and store in session
function generateCsrfToken(): string {
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf_token'];
}

// Validate CSRF token on form submission
function validateCsrfToken(string $token): bool {
    return isset($_SESSION['csrf_token'])
        && hash_equals($_SESSION['csrf_token'], $token); // timing-safe comparison
}

// In your form template:
// <input type="hidden" name="csrf_token" value="<?= e(generateCsrfToken()) ?>">

// In form handler:
if (!validateCsrfToken($_POST['csrf_token'] ?? '')) {
    http_response_code(403);
    die('Invalid CSRF token');
}
```

### 4. File Upload Security

```php
function validateUpload(array $file): void {
    // Check for upload errors
    if ($file['error'] !== UPLOAD_ERR_OK) {
        throw new \RuntimeException('Upload failed: ' . $file['error']);
    }

    // Validate file size
    $maxSize = 5 * 1024 * 1024; // 5MB
    if ($file['size'] > $maxSize) {
        throw new \RuntimeException('File too large');
    }

    // Validate MIME type using finfo (NOT $_FILES['type'] — attacker controls that)
    $finfo    = new \finfo(FILEINFO_MIME_TYPE);
    $mimeType = $finfo->file($file['tmp_name']);
    $allowed  = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

    if (!in_array($mimeType, $allowed, true)) {
        throw new \RuntimeException("File type not allowed: $mimeType");
    }

    // Validate extension
    $ext     = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
    $allowed = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
    if (!in_array($ext, $allowed, true)) {
        throw new \RuntimeException("Extension not allowed: $ext");
    }
}

function safeUpload(array $file, string $uploadDir): string {
    validateUpload($file);

    // Generate safe filename — NEVER use the original name
    $ext      = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
    $safeName = bin2hex(random_bytes(16)) . '.' . $ext;
    $destPath = rtrim($uploadDir, '/') . '/' . $safeName;

    if (!move_uploaded_file($file['tmp_name'], $destPath)) {
        throw new \RuntimeException('Failed to save file');
    }

    return $safeName;
}

// NEVER store uploads in webroot — store outside document root
// ❌ /var/www/html/uploads/  (directly accessible via HTTP)
// ✅ /var/uploads/           (not accessible via HTTP — serve via PHP)
```

### 5. Path Traversal

```php
// ❌ VULNERABLE
$file    = $_GET['file']; // attacker sends: ../../etc/passwd
$content = file_get_contents('/var/www/files/' . $file);

// ✅ SAFE — validate the real path
function safeReadFile(string $userInput, string $baseDir): string {
    $baseDir  = realpath($baseDir);
    $filePath = realpath($baseDir . '/' . $userInput);

    // Ensure the resolved path starts with base directory
    if ($filePath === false || !str_starts_with($filePath, $baseDir)) {
        throw new \RuntimeException('Access denied');
    }

    return file_get_contents($filePath);
}
```

---

## b. Password Hashing

**Never store passwords in plain text or with MD5/SHA1.**

```php
// ❌ NEVER — plain text
$password = $_POST['password'];
INSERT INTO users SET password = '$password'

// ❌ NEVER — MD5 or SHA1 (fast algorithms — brute-forceable)
$hash = md5($_POST['password']);
$hash = sha1($_POST['password']);

// ✅ CORRECT — password_hash() with PASSWORD_BCRYPT or PASSWORD_ARGON2ID
$hash = password_hash($_POST['password'], PASSWORD_BCRYPT);
// $2y$10$abcdefgh... (includes algorithm, cost, and salt automatically)

// Verify password
if (password_verify($_POST['password'], $storedHash)) {
    // correct password
}

// ✅ EVEN BETTER — Argon2ID (PHP 7.3+, winner of Password Hashing Competition)
$hash = password_hash($_POST['password'], PASSWORD_ARGON2ID, [
    'memory_cost' => 65536,   // 64MB RAM
    'time_cost'   => 4,       // 4 iterations
    'threads'     => 1,
]);

// Check if hash needs upgrading (e.g., after changing cost factor)
if (password_needs_rehash($storedHash, PASSWORD_ARGON2ID)) {
    $newHash = password_hash($plainPassword, PASSWORD_ARGON2ID);
    // Update stored hash in DB
}
```

### Password Validation

```php
function validatePassword(string $password): array {
    $errors = [];

    if (strlen($password) < 8) {
        $errors[] = 'Password must be at least 8 characters';
    }
    if (!preg_match('/[A-Z]/', $password)) {
        $errors[] = 'Must contain at least one uppercase letter';
    }
    if (!preg_match('/[a-z]/', $password)) {
        $errors[] = 'Must contain at least one lowercase letter';
    }
    if (!preg_match('/[0-9]/', $password)) {
        $errors[] = 'Must contain at least one number';
    }

    return $errors;
}
```

---

## c. Data Filtering & Validation

### Input Validation — Never Trust User Input

```php
// Validate types with filter_var
$email = filter_var($_POST['email'], FILTER_VALIDATE_EMAIL);
$url   = filter_var($_POST['url'],   FILTER_VALIDATE_URL);
$ip    = filter_var($_POST['ip'],    FILTER_VALIDATE_IP);
$int   = filter_var($_POST['age'],   FILTER_VALIDATE_INT, ['options' => ['min_range' => 0, 'max_range' => 150]]);
$float = filter_var($_POST['price'], FILTER_VALIDATE_FLOAT);
$bool  = filter_var($_POST['agree'], FILTER_VALIDATE_BOOLEAN);

if ($email === false) {
    throw new \InvalidArgumentException('Invalid email address');
}

// Sanitize — clean data (use AFTER validation, not instead of it)
$name  = filter_var($_POST['name'],    FILTER_SANITIZE_SPECIAL_CHARS);
$email = filter_var($_POST['email'],   FILTER_SANITIZE_EMAIL);
$url   = filter_var($_POST['url'],     FILTER_SANITIZE_URL);
$int   = filter_var($_POST['qty'],     FILTER_SANITIZE_NUMBER_INT);
```

### Validate with a Library (Recommended)

```bash
composer require respect/validation
```

```php
use Respect\Validation\Validator as v;

// Complex validation
$validator = v::key('name',     v::stringType()->length(2, 50)->notEmpty())
              ->key('email',    v::email())
              ->key('age',      v::intType()->between(18, 120))
              ->key('website',  v::optional(v::url()))
              ->key('password', v::stringType()->length(8, null));

try {
    $validator->assert($_POST);
} catch (\Respect\Validation\Exceptions\NestedValidationException $e) {
    $errors = $e->getMessages(); // ['name' => 'Name must be at least 2 chars', ...]
    return response()->json(['errors' => $errors], 422);
}
```

### Whitelist Validation

```php
// ✅ Whitelist allowed values — reject everything else
$allowedSorts = ['name', 'email', 'created_at'];
$sort         = $_GET['sort'] ?? 'name';

if (!in_array($sort, $allowedSorts, true)) {
    $sort = 'name'; // fallback to safe default
}

$stmt = $pdo->prepare("SELECT * FROM users ORDER BY $sort ASC"); // safe — value from whitelist

// ✅ Whitelist allowed file types
$allowedMimes = ['image/jpeg', 'image/png', 'application/pdf'];
```

---

## d. Configuration Files Security

### Never Hardcode Secrets

```php
// ❌ NEVER hardcode secrets in code
define('DB_PASSWORD', 'my-super-secret-password');
$apiKey = 'sk-1234567890abcdef';

// ✅ Use environment variables
$dbPassword = getenv('DB_PASSWORD');
$apiKey     = getenv('STRIPE_SECRET_KEY');

// ✅ Use .env files (development only) with vlucas/phpdotenv
composer require vlucas/phpdotenv
```

```php
// Bootstrap (index.php or bootstrap.php)
$dotenv = Dotenv\Dotenv::createImmutable(__DIR__);
$dotenv->load();

// Access variables
$dbHost = $_ENV['DB_HOST'];
$dbPass = $_ENV['DB_PASSWORD'];

// Validate required variables
$dotenv->required(['DB_HOST', 'DB_PASSWORD', 'APP_KEY'])->notEmpty();
```

```bash
# .env — never commit to git
DB_HOST=localhost
DB_DATABASE=myapp
DB_PASSWORD=super_secret_pass
STRIPE_SECRET_KEY=sk_live_xxxx
APP_KEY=base64:random32chars

# .gitignore — ALWAYS exclude .env
.env
.env.local
```

### Protect Sensitive Files

```nginx
# Nginx — deny access to .env, .git, composer files
location ~ /\.(env|git|htaccess)$ { deny all; }
location ~ /(composer\.json|composer\.lock|phpunit\.xml)$ { deny all; }
```

```apache
# Apache .htaccess
<Files ".env">
    Order allow,deny
    Deny from all
</Files>
```

---

## e. Register Globals (Historical Context)

`register_globals` was a PHP setting (removed in PHP 5.4) that automatically created global variables from GET/POST/COOKIE input. It was one of the most dangerous PHP features ever — understanding why it's bad helps you write secure code today.

```php
// With register_globals = On (OLD, dangerous behavior)
// URL: http://example.com/admin.php?authenticated=1

if ($authenticated) {  // attacker set this via URL parameter!
    grantAdminAccess();
}

// This worked because PHP automatically created $authenticated = '1' from $_GET['authenticated']

// ✅ Modern PHP — always access superglobals explicitly
$authenticated = $_SESSION['authenticated'] ?? false; // from session (server-controlled)

if ($authenticated === true) {
    grantAdminAccess();
}
```

**Register Globals lessons that apply today:**
- Always initialize variables before use
- Never trust `$_GET`, `$_POST`, `$_COOKIE` as safe
- Use type-strict comparisons (`===` not `==`)
- Keep session data server-side, not client-side

---

## f. Error Reporting (Production vs Development)

```php
// Development — show all errors
error_reporting(E_ALL);
ini_set('display_errors', '1');
ini_set('display_startup_errors', '1');

// Production — HIDE errors from users, LOG them
error_reporting(E_ALL);              // still report all
ini_set('display_errors', '0');     // DON'T show to users
ini_set('log_errors', '1');         // LOG to file
ini_set('error_log', '/var/log/php/error.log');

// php.ini (preferred over ini_set for production)
; php.ini production settings
display_errors = Off
display_startup_errors = Off
log_errors = On
error_log = /var/log/php/error.log
error_reporting = E_ALL
```

**Why hide production errors?**
- Stack traces reveal file paths, database names, class names
- SQL errors can expose schema structure
- Server errors can reveal server software versions
- Attackers use error messages to craft targeted attacks

### Custom Error Handler

```php
set_error_handler(function (int $errno, string $errstr, string $errfile, int $errline): bool {
    // Log it
    error_log(sprintf('[%s] %s in %s on line %d', $errno, $errstr, $errfile, $errline));

    // In production — don't show to user
    if (getenv('APP_ENV') === 'production') {
        return true; // suppress default PHP error handler
    }

    return false; // let PHP handle it in development
});

set_exception_handler(function (\Throwable $e): void {
    error_log('Uncaught: ' . $e->getMessage() . ' in ' . $e->getFile());

    if (getenv('APP_ENV') === 'production') {
        http_response_code(500);
        echo json_encode(['error' => 'Internal server error']); // generic message
    } else {
        throw $e; // re-throw in development for full stack trace
    }
});
```

---

## Security Checklist Summary

```
Authentication & Sessions
 ✓ Hash passwords with password_hash() (bcrypt/argon2id)
 ✓ Regenerate session ID after login: session_regenerate_id(true)
 ✓ Use HTTPS for all pages with session data
 ✓ Set session cookie flags: Secure, HttpOnly, SameSite=Strict

Input & Output
 ✓ Validate ALL user input (whitelist where possible)
 ✓ Use prepared statements for ALL database queries
 ✓ Escape output with htmlspecialchars() before echoing
 ✓ Use CSRF tokens on all state-changing forms

File Handling
 ✓ Validate MIME type with finfo (not $_FILES['type'])
 ✓ Generate random filenames — never use original name
 ✓ Store uploads outside webroot
 ✓ Check realpath() for path traversal

Configuration
 ✓ display_errors = Off in production
 ✓ Secrets in environment variables, not code
 ✓ .env in .gitignore
 ✓ Disable dangerous PHP functions (exec, passthru, system)

Headers (add these to all responses)
 ✓ Content-Security-Policy: default-src 'self'
 ✓ X-Content-Type-Options: nosniff
 ✓ X-Frame-Options: DENY
 ✓ Strict-Transport-Security: max-age=31536000
```

---

## Interview Q&A

**Q: What is SQL Injection and how do you prevent it?**
A: SQL Injection is when an attacker includes SQL code in user input that gets concatenated into a query — potentially reading, modifying, or deleting data. Prevent it with prepared statements (PDO with placeholders). Never concatenate user input into SQL strings.

**Q: What is XSS and how do you prevent it?**
A: Cross-Site Scripting is when user-supplied content containing malicious scripts is rendered in a browser, executing the script in the context of your site. Prevent it by escaping all user data before rendering with `htmlspecialchars()`. For rich HTML, use a whitelist-based HTML sanitizer. Set a Content-Security-Policy header.

**Q: Why is MD5 not safe for passwords?**
A: MD5 is a fast hashing algorithm — designed for speed, not security. An attacker with the hash can try billions of combinations per second (brute force) or use rainbow tables. Use `password_hash()` with bcrypt or argon2id — they're intentionally slow and include automatic salting, making brute force impractical.

**Q: What is CSRF and how do you prevent it?**
A: Cross-Site Request Forgery tricks a logged-in user's browser into submitting a form on another site. The browser automatically sends the user's session cookie — the server can't tell it wasn't intentional. Prevent it with a CSRF token: a random value stored in the session and embedded in forms. Verify the token on submission. Also use `SameSite=Strict` cookie attribute.

**Q: What should you do with errors in production?**
A: Set `display_errors = Off` to hide errors from users — error messages reveal file paths, database structure, and software versions that attackers use. Set `log_errors = On` to log errors server-side. Show generic error messages to users. Always log enough information to diagnose issues without exposing it publicly.
