# PHP Web Fundamentals — Superglobals, Forms, Sessions, Cookies & File Upload

## TL;DR
PHP's **superglobals** (`$_GET`, `$_POST`, `$_SERVER`, etc.) provide request data. **Forms** send data via GET or POST — always validate and sanitize. **Sessions** store user state server-side; **Cookies** store it client-side. **File uploads** use `$_FILES` — always validate MIME type and use `move_uploaded_file()`.

---

## 1. PHP Superglobals

Superglobals are built-in variables available **everywhere** — in any function, class, or file, without needing `global`.

### `$_GET` — URL Query Parameters

```php
// URL: /search?query=php&page=2
$query = $_GET['query'] ?? '';  // 'php'
$page  = (int) ($_GET['page'] ?? 1); // 2, cast to int

// NEVER trust raw input — always sanitize
$safeQuery = htmlspecialchars($query, ENT_QUOTES, 'UTF-8');
```

### `$_POST` — Form Body Data

```php
// HTML form with method="post"
$name  = $_POST['name']  ?? '';
$email = $_POST['email'] ?? '';

// Strip tags and trim as a minimum
$name = trim(strip_tags($name));
```

### `$_REQUEST` — GET + POST + COOKIE combined

```php
// Avoid — ambiguous source, prefer explicit $_GET or $_POST
$value = $_REQUEST['key'] ?? '';
```

### `$_SERVER` — Server & Environment Info

```php
echo $_SERVER['REQUEST_METHOD'];    // 'GET' or 'POST'
echo $_SERVER['REQUEST_URI'];       // '/search?query=php'
echo $_SERVER['HTTP_HOST'];         // 'example.com'
echo $_SERVER['REMOTE_ADDR'];       // client IP (can be spoofed via X-Forwarded-For)
echo $_SERVER['HTTP_USER_AGENT'];   // browser info
echo $_SERVER['HTTPS'];             // 'on' if HTTPS
echo $_SERVER['PHP_SELF'];          // '/index.php'
echo $_SERVER['DOCUMENT_ROOT'];     // server root path
echo $_SERVER['HTTP_REFERER'];      // previous page URL (if set)
```

### `$_FILES` — Uploaded Files (see File Upload section)

### `$_COOKIE` — Browser Cookies

```php
$userId = $_COOKIE['user_id'] ?? null;
```

### `$_SESSION` — Session Data

```php
session_start();
$_SESSION['user_id'] = 42;
```

### `$_ENV` — Environment Variables

```php
$dbPassword = $_ENV['DB_PASSWORD'] ?? getenv('DB_PASSWORD');
```

### `$_GLOBALS` — All Global Variables

```php
// Access any global variable by name — rarely needed
$GLOBALS['myVar'] = 'test';
```

---

## 2. Basic Routing

PHP doesn't have built-in routing. The simplest approach uses `$_SERVER['REQUEST_URI']`.

```php
// public/index.php
$uri    = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$method = $_SERVER['REQUEST_METHOD'];

// Trim trailing slash
$uri = rtrim($uri, '/') ?: '/';

// Simple router
match(true) {
    $method === 'GET'  && $uri === '/'         => home(),
    $method === 'GET'  && $uri === '/users'    => listUsers(),
    $method === 'POST' && $uri === '/users'    => createUser(),
    $method === 'GET'  && preg_match('#^/users/(\d+)$#', $uri, $m) => showUser((int)$m[1]),
    default => notFound(),
};

function home(): void      { echo "Welcome!"; }
function listUsers(): void { echo "List of users"; }
function createUser(): void { echo "Create user"; }
function showUser(int $id): void { echo "User #{$id}"; }
function notFound(): void  { http_response_code(404); echo "404 Not Found"; }
```

---

## 3. PHP Forms

### HTML Form

```html
<form method="POST" action="/register">
    <input type="text"     name="name"     required>
    <input type="email"    name="email"    required>
    <input type="password" name="password" required>
    <button type="submit">Register</button>
</form>
```

### Form Handling

```php
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    // Show the form
    include 'register-form.html';
    exit;
}

// Process the submission
$name     = trim($_POST['name']     ?? '');
$email    = trim($_POST['email']    ?? '');
$password = trim($_POST['password'] ?? '');
```

### Form Validation

```php
$errors = [];

// Required fields
if (empty($name)) {
    $errors['name'] = 'Name is required';
} elseif (strlen($name) < 2) {
    $errors['name'] = 'Name must be at least 2 characters';
}

// Email validation
if (empty($email)) {
    $errors['email'] = 'Email is required';
} elseif (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    $errors['email'] = 'Email is not valid';
}

// Password
if (empty($password)) {
    $errors['password'] = 'Password is required';
} elseif (strlen($password) < 8) {
    $errors['password'] = 'Password must be at least 8 characters';
}

// Stop if errors
if (!empty($errors)) {
    // Re-show the form with errors
    include 'register-form.html';
    exit;
}

// All valid — process
$hashedPassword = password_hash($password, PASSWORD_BCRYPT);
// Save to database...
```

### `filter_var` — Built-in Sanitization & Validation

```php
// Validate
filter_var($email, FILTER_VALIDATE_EMAIL);        // false if invalid
filter_var($url,   FILTER_VALIDATE_URL);           // false if invalid
filter_var($ip,    FILTER_VALIDATE_IP);            // false if invalid
filter_var($age,   FILTER_VALIDATE_INT, ['options' => ['min_range' => 0, 'max_range' => 120]]);

// Sanitize (clean the input)
$cleanEmail   = filter_var($email, FILTER_SANITIZE_EMAIL);     // strips invalid chars
$cleanUrl     = filter_var($url,   FILTER_SANITIZE_URL);       // strips invalid chars
$cleanInt     = filter_var($value, FILTER_SANITIZE_NUMBER_INT); // strips non-numeric
$cleanString  = htmlspecialchars($input, ENT_QUOTES, 'UTF-8'); // encode HTML entities
```

### CSRF Protection

Cross-Site Request Forgery — an attacker tricks a logged-in user's browser to submit a form to your app.

```php
// Generate a CSRF token when showing the form
session_start();
if (empty($_SESSION['csrf_token'])) {
    $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
}

// Include in the form
echo '<input type="hidden" name="csrf_token" value="' . $_SESSION['csrf_token'] . '">';

// Verify on submission
if (!hash_equals($_SESSION['csrf_token'], $_POST['csrf_token'] ?? '')) {
    http_response_code(403);
    die('CSRF token mismatch');
}
```

**`hash_equals`** is used instead of `===` to prevent timing attacks.

---

## 4. Sessions

A **session** stores user data **on the server** between requests. PHP gives each user a unique session ID (stored in a cookie), and maps it to server-side data.

```
Browser                     Server
  │                            │
  │  GET / (no session)        │
  ├──────────────────────────► │ Creates session file
  │                            │ Session ID: abc123
  │  Set-Cookie: PHPSESSID=abc123
  │ ◄────────────────────────  │
  │                            │
  │  GET /profile              │
  │  Cookie: PHPSESSID=abc123  │
  ├──────────────────────────► │ Loads session data for abc123
  │                            │
```

### Starting and Using Sessions

```php
// Must call session_start() before any output
session_start();

// Store data
$_SESSION['user_id']   = 42;
$_SESSION['user_name'] = 'Alice';
$_SESSION['role']      = 'admin';
$_SESSION['cart']      = ['item1', 'item2'];

// Read data
$userId = $_SESSION['user_id'] ?? null;
if (!$userId) {
    header('Location: /login');
    exit;
}

// Delete a specific key
unset($_SESSION['cart']);

// Destroy the entire session (logout)
session_start();
session_unset();         // clear all session data
session_destroy();       // destroy the session file
// Also clear the cookie
setcookie(session_name(), '', time() - 3600, '/');
```

### Login / Logout Pattern

```php
// login.php
session_start();
session_regenerate_id(true); // prevent session fixation attack

$_SESSION['user_id'] = $user->id;
$_SESSION['role']    = $user->role;

header('Location: /dashboard');
exit;

// logout.php
session_start();
session_destroy();
setcookie('PHPSESSID', '', time() - 3600, '/');
header('Location: /login');
exit;

// auth-check.php (include at top of protected pages)
session_start();
if (!isset($_SESSION['user_id'])) {
    header('Location: /login');
    exit;
}
```

### Session Security

```php
// php.ini best practices (or set in code)
ini_set('session.cookie_httponly', 1);    // JS can't read cookie — XSS protection
ini_set('session.cookie_secure', 1);      // HTTPS only
ini_set('session.cookie_samesite', 'Strict'); // CSRF protection
ini_set('session.use_strict_mode', 1);   // reject uninitialized session IDs

// Regenerate session ID after privilege change (login, role change)
session_regenerate_id(true); // true = delete old session file
```

**Session pros:**
- Data stays server-side — users can't tamper with it
- Can store large amounts of data (array, objects)

**Session cons:**
- Server-side storage (files by default) — doesn't scale well across servers
- Need Redis/database-backed sessions for horizontal scaling
- Session ID in cookie can be stolen (XSS, MITM) — use `httponly` and HTTPS

---

## 5. Cookies

A **cookie** stores data **in the browser**. The browser sends it with every request to the same domain.

```php
// Set a cookie
setcookie(
    name:     'theme',
    value:    'dark',
    expires:  time() + (86400 * 30), // 30 days from now
    path:     '/',                    // available site-wide
    domain:   'example.com',
    secure:   true,                   // HTTPS only
    httponly: true,                   // not accessible via JavaScript
);

// Read a cookie
$theme = $_COOKIE['theme'] ?? 'light';

// Delete a cookie — set expiry in the past
setcookie('theme', '', time() - 3600, '/');
```

### Cookies vs Sessions

| | Session | Cookie |
|---|---|---|
| Storage location | Server | Browser |
| Expiry | Ends when browser closes (default) | Custom expiry |
| Size limit | No practical limit | ~4KB per cookie |
| Security | More secure (data not exposed) | Data visible to user (don't store sensitive info) |
| Server scaling | Harder (need shared store) | Easier (client-side) |
| Use for | Login state, cart, user data | Preferences, tracking, remember-me tokens |

### "Remember Me" with Cookies

```php
// Generate a secure token
$token = bin2hex(random_bytes(32));

// Store hashed token in DB with user ID and expiry
DB::table('remember_tokens')->insert([
    'user_id'    => $user->id,
    'token_hash' => hash('sha256', $token),
    'expires_at' => now()->addDays(30),
]);

// Send the raw token in cookie
setcookie('remember_me', $token, time() + 86400 * 30, '/', '', true, true);

// On next visit — read cookie, hash it, look up in DB
$token = $_COOKIE['remember_me'] ?? null;
if ($token) {
    $record = DB::table('remember_tokens')
        ->where('token_hash', hash('sha256', $token))
        ->where('expires_at', '>', now())
        ->first();
    if ($record) {
        // Log user in
    }
}
```

---

## 6. PHP File Uploading

### HTML Form

```html
<!-- enctype="multipart/form-data" is REQUIRED for file uploads -->
<form method="POST" action="/upload" enctype="multipart/form-data">
    <input type="file" name="avatar" accept="image/*">
    <button type="submit">Upload</button>
</form>
```

### `$_FILES` Structure

```php
// $_FILES['avatar'] contains:
[
    'name'     => 'photo.jpg',       // original filename (user-provided, don't trust it!)
    'type'     => 'image/jpeg',      // MIME type from browser (don't trust this either!)
    'tmp_name' => '/tmp/phpXXXXXX',  // temp path on server
    'error'    => 0,                  // 0 = UPLOAD_ERR_OK
    'size'     => 204800,            // bytes
]
```

### Upload Error Codes

| Code | Constant | Meaning |
|---|---|---|
| 0 | `UPLOAD_ERR_OK` | Success |
| 1 | `UPLOAD_ERR_INI_SIZE` | Exceeds `upload_max_filesize` in php.ini |
| 2 | `UPLOAD_ERR_FORM_SIZE` | Exceeds `MAX_FILE_SIZE` in HTML form |
| 3 | `UPLOAD_ERR_PARTIAL` | Only partially uploaded |
| 4 | `UPLOAD_ERR_NO_FILE` | No file uploaded |
| 6 | `UPLOAD_ERR_NO_TMP_DIR` | Missing temp folder |
| 7 | `UPLOAD_ERR_CANT_WRITE` | Disk write failure |

### Secure Single File Upload

```php
function handleUpload(array $file, string $uploadDir): string {
    // 1. Check for upload errors
    if ($file['error'] !== UPLOAD_ERR_OK) {
        throw new \RuntimeException('Upload failed with error code: ' . $file['error']);
    }

    // 2. Validate file size (max 5MB)
    $maxSize = 5 * 1024 * 1024;
    if ($file['size'] > $maxSize) {
        throw new \RuntimeException('File exceeds 5MB limit');
    }

    // 3. Validate MIME type using finfo (NOT $_FILES['type'] — it's user-controlled)
    $finfo    = new \finfo(FILEINFO_MIME_TYPE);
    $mimeType = $finfo->file($file['tmp_name']); // reads actual file content

    $allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!in_array($mimeType, $allowedMimes, true)) {
        throw new \RuntimeException('Invalid file type: ' . $mimeType);
    }

    // 4. Generate a safe filename (NEVER use the user's filename)
    $extension  = match($mimeType) {
        'image/jpeg' => 'jpg',
        'image/png'  => 'png',
        'image/gif'  => 'gif',
        'image/webp' => 'webp',
    };
    $safeFilename = bin2hex(random_bytes(16)) . '.' . $extension;

    // 5. Move to final destination (use move_uploaded_file — validates it was uploaded)
    $destination = rtrim($uploadDir, '/') . '/' . $safeFilename;
    if (!move_uploaded_file($file['tmp_name'], $destination)) {
        throw new \RuntimeException('Failed to move uploaded file');
    }

    return $safeFilename;
}

// Usage
try {
    $filename = handleUpload($_FILES['avatar'], __DIR__ . '/uploads/avatars');
    echo "Uploaded: {$filename}";
} catch (\RuntimeException $e) {
    echo "Error: " . $e->getMessage();
}
```

### Multiple File Upload

```html
<!-- name="photos[]" with [] for multiple files -->
<input type="file" name="photos[]" multiple>
```

```php
// $_FILES['photos'] with multiple files has a transposed structure:
// ['name' => ['a.jpg', 'b.jpg'], 'tmp_name' => ['/tmp/1', '/tmp/2'], ...]

// Normalize to array of individual file arrays
function normalizeFiles(array $files): array {
    $normalized = [];
    $count = count($files['name']);

    for ($i = 0; $i < $count; $i++) {
        $normalized[] = [
            'name'     => $files['name'][$i],
            'type'     => $files['type'][$i],
            'tmp_name' => $files['tmp_name'][$i],
            'error'    => $files['error'][$i],
            'size'     => $files['size'][$i],
        ];
    }
    return $normalized;
}

$photos = normalizeFiles($_FILES['photos']);
foreach ($photos as $photo) {
    if ($photo['error'] === UPLOAD_ERR_OK) {
        handleUpload($photo, '/uploads/photos');
    }
}
```

### Key Security Rules for File Upload

1. **Never trust `$_FILES['type']`** — it's sent by the browser and can be faked. Use `finfo` to check the actual file content.
2. **Never use the original filename** — it can contain `../../../etc/passwd` or executable names. Generate a random filename.
3. **Store uploads outside the web root** if possible, or disable execution:
```apache
# .htaccess in upload folder — prevents executing uploaded PHP files
php_flag engine off
Options -ExecCGI
```
4. **Use `move_uploaded_file()`** — not `rename()` or `copy()`. It validates the file was actually uploaded via HTTP.

---

## Interview Q&A

**Q: What is the difference between `$_GET` and `$_POST`?**
A: `$_GET` contains query parameters from the URL (visible, bookmarkable, limited to ~2KB). `$_POST` contains form body data (not in URL, better for sensitive data, can handle large payloads and file uploads). Use GET for searches/filters, POST for creating/modifying data.

**Q: Why can't you trust `$_FILES['type']`?**
A: Because it's sent by the browser in the HTTP request — a user can send any MIME type header they want. An attacker could upload a PHP file with `type = 'image/jpeg'`. Always use PHP's `finfo` extension to inspect the actual file bytes to determine the real MIME type.

**Q: What is the difference between a session and a cookie?**
A: Sessions store data server-side — only a session ID is sent to the browser as a cookie. Cookies store data client-side in the browser. Sessions are more secure (data not exposed to the user), cookies persist across browser restarts (sessions expire when the browser closes by default). Don't store sensitive data in cookies.

**Q: What is session fixation and how do you prevent it?**
A: Session fixation is when an attacker sets a known session ID before the user logs in, then waits for the user to authenticate, inheriting the session. Prevent it by calling `session_regenerate_id(true)` on login — this assigns a new random session ID, making the attacker's known ID invalid.

**Q: What is CSRF and how do you prevent it in PHP?**
A: CSRF (Cross-Site Request Forgery) is when a malicious site tricks a user's browser into submitting a request to your site using their credentials. Prevent it with a CSRF token — a secret random value stored in the session, embedded in every form, and verified on submission. Use `hash_equals` to compare tokens to prevent timing attacks.
