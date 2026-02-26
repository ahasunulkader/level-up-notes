# Namespaces, PSR Standards & Autoloading

## TL;DR
**Namespaces** prevent name collisions between classes. **PSR-1/PSR-12** define code style rules everyone follows. **PSR-4 + Composer autoloading** lets PHP find your classes automatically by folder structure — no more manual `require` statements.

---

## 1. PHP Namespaces

### The Problem Without Namespaces

```php
// Your code
class User { ... }

// A third-party library also has:
class User { ... } // Fatal error: Cannot redeclare class User
```

Two classes with the same name = fatal crash. Before namespaces, developers prefixed everything: `MyApp_User`, `Stripe_User`, `Library_User`. Ugly.

### Declaring a Namespace

```php
<?php
// File: src/Models/User.php
namespace App\Models;  // must be the FIRST statement (after <?php)

class User {
    public function __construct(
        public readonly int    $id,
        public readonly string $name,
    ) {}
}
```

### Using Classes from Namespaces

```php
<?php
namespace App\Controllers;

// Option 1: use statement (import) — most common
use App\Models\User;
use App\Services\PaymentService;

class UserController {
    public function show(int $id): User {
        return new User($id, 'Alice'); // short name, no prefix needed
    }
}

// Option 2: Fully qualified name (verbose, use sparingly)
$user = new \App\Models\User(1, 'Bob');

// Option 3: Alias (when two classes have the same short name)
use App\Models\User as UserModel;
use Admin\Models\User as AdminUser;
```

### Sub-namespaces

```php
namespace App\Http\Controllers\Api\V1;
// Mirrors the folder structure: src/Http/Controllers/Api/V1/
```

### Namespace Rules

- Must be first line of file (after `<?php`)
- One namespace per file (best practice)
- Mirrors directory structure (PSR-4 requirement)
- `\` at the start means global namespace: `\Exception`, `\PDO`

**Use cases:**
- Organizing large codebases into logical groups
- Using multiple third-party libraries without name conflicts
- Every Laravel controller, model, service uses namespaces

**Pros:**
- No name collisions across packages
- Mirrors folder structure — easy to find files
- Makes autoloading possible

**Cons:**
- Adds `use` statements at the top of every file
- Absolute beginners find the `\` syntax confusing

---

## 2. PHP Code Style — PSR-1 & PSR-12

PSR stands for **PHP Standards Recommendation**, maintained by PHP-FIG (Framework Interop Group). PSR-1 and PSR-12 define how PHP code should look so all PHP codebases are readable by anyone.

### PSR-1: Basic Coding Standard

```php
<?php
// 1. Files MUST use only <?php or <?= tags (no short <? tags)

// 2. Files MUST use UTF-8 encoding

// 3. Class names MUST use StudlyCaps (PascalCase)
class UserRepository {}       // ✅
class user_repository {}      // ❌

// 4. Constants MUST be all uppercase with underscores
const MAX_LOGIN_ATTEMPTS = 5; // ✅
const maxLoginAttempts = 5;   // ❌

// 5. Method names MUST use camelCase
public function getUserById() {} // ✅
public function get_user_by_id() {} // ❌
```

### PSR-12: Extended Coding Style

PSR-12 builds on PSR-1 with more specific formatting rules.

```php
<?php

declare(strict_types=1); // declare at the top, after <?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Services\AuthService;
                                        // blank line after use block
class UserController extends BaseController implements Authenticatable
{                                       // opening brace on NEW LINE for classes
    private AuthService $authService;

    public function __construct(AuthService $authService)
    {                                   // opening brace on NEW LINE for methods
        $this->authService = $authService;
    }

    public function login(string $email, string $password): bool
    {
        if (!$this->authService->validate($email, $password)) {
            return false;               // 4 spaces indentation (not tabs)
        }

        return true;
    }
}
```

**Key PSR-12 rules summary:**

| Rule | Detail |
|---|---|
| Indentation | 4 spaces (no tabs) |
| Line length | Soft limit 80 chars, hard limit 120 |
| Class opening brace | New line |
| Method opening brace | New line |
| Control structure brace | Same line (`if (x) {`) |
| `use` statements | One per line, grouped, alphabetical |
| Blank lines | One blank line after namespace, after `use` block |
| Type declarations | `public function foo(): string` (colon, space, type) |

### Enforcing PSR-12 Automatically

```bash
# Install PHP CS Fixer
composer require --dev friendsofphp/php-cs-fixer

# Check for violations
./vendor/bin/php-cs-fixer check src/

# Auto-fix violations
./vendor/bin/php-cs-fixer fix src/

# Or use PHP_CodeSniffer
composer require --dev squizlabs/php_codesniffer
./vendor/bin/phpcs --standard=PSR12 src/
./vendor/bin/phpcbf --standard=PSR12 src/  # auto-fix
```

**Why follow PSR standards?**
- Every PHP developer knows them — new team members can read your code immediately
- Required by all major frameworks (Laravel, Symfony, Drupal)
- CI/CD can auto-reject non-compliant code
- IDEs and tools can auto-format to PSR-12

---

## 3. Autoloading & PSR-4

### The Problem Without Autoloading

```php
// You had to manually require every file you used
require_once 'User.php';
require_once 'UserRepository.php';
require_once 'PaymentService.php';
require_once 'EmailService.php';
// ... dozens of requires in every file
```

### PSR-4 Autoloading Standard

PSR-4 defines a **mapping between namespaces and directory structure**. The rule:

```
Namespace prefix:  App\
Maps to directory: src/

App\Models\User        → src/Models/User.php
App\Http\Controllers\UserController → src/Http/Controllers/UserController.php
App\Services\Payment\StripeGateway  → src/Services/Payment/StripeGateway.php
```

One class per file. Filename must match class name exactly (case-sensitive).

### Autoloading with Composer

**Step 1:** Define the namespace-to-directory mapping in `composer.json`:

```json
{
    "name": "myapp/myapp",
    "autoload": {
        "psr-4": {
            "App\\": "src/"
        }
    },
    "require": {
        "php": ">=8.1"
    }
}
```

**Step 2:** Generate the autoloader:
```bash
composer dump-autoload
# or
composer install  # also generates autoloader
```

**Step 3:** Include the autoloader once in your entry point:
```php
<?php
// public/index.php or bootstrap/app.php
require_once __DIR__ . '/../vendor/autoload.php';

// Now ANY class in src/ is available automatically
$user = new \App\Models\User(1, 'Alice');
// PHP sees App\Models\User → looks for src/Models/User.php → loads it automatically
```

### Multiple Namespace Mappings

```json
{
    "autoload": {
        "psr-4": {
            "App\\": "src/",
            "Tests\\": "tests/",
            "Database\\": "database/"
        }
    }
}
```

### Autoloading Third-Party Packages

```bash
composer require guzzlehttp/guzzle
```

Composer automatically handles the autoloading for all packages in `vendor/`. You just `require vendor/autoload.php` once.

```php
<?php
require 'vendor/autoload.php';

// Guzzle is instantly available — no require_once needed
$client = new \GuzzleHttp\Client();
$response = $client->get('https://api.example.com');
```

### classmap Autoloading (Legacy Code)

For code that doesn't follow PSR-4 (old libraries without namespaces):

```json
{
    "autoload": {
        "classmap": ["legacy/", "old-library/"]
    }
}
```

Composer scans those directories and maps every class to its file.

### files Autoloading (Helper Functions)

For global helper functions (not classes):

```json
{
    "autoload": {
        "files": ["src/helpers.php"]
    }
}
```

```php
// src/helpers.php
function str_limit(string $value, int $limit = 100): string {
    return strlen($value) > $limit ? substr($value, 0, $limit) . '...' : $value;
}
// Now str_limit() is available everywhere after autoload
```

---

## How PSR-4 Autoloading Works Internally

```
1. You write: new App\Models\User()
2. PHP doesn't know this class yet → triggers __autoload / spl_autoload_register
3. Composer registered a loader with spl_autoload_register
4. Loader receives "App\Models\User"
5. Strips the prefix "App\" → "Models\User"
6. Replaces "\" with directory separator → "Models/User"
7. Prepends the base path "src/" → "src/Models/User"
8. Appends ".php" → "src/Models/User.php"
9. Does file_exists check → loads file with require
10. Class is now available → object created
```

---

## Interview Q&A

**Q: What problem do namespaces solve?**
A: Name collisions. Without namespaces, two libraries both defining a `User` class cause a fatal error. Namespaces scope class names to a prefix (e.g., `App\Models\User` vs `Vendor\Auth\User`), so both can coexist.

**Q: What is PSR-4 and why do we use it?**
A: PSR-4 is a standard that maps namespace prefixes to directory paths. Following it allows Composer's autoloader to find any class automatically by converting the namespace to a file path. Without PSR-4, you'd manually `require` every file you use.

**Q: What does `composer dump-autoload` do?**
A: It regenerates the autoloader files in `vendor/autoload.php` based on your `composer.json` autoload config. Run it after adding new classes or changing namespace mappings.

**Q: What is the difference between PSR-1 and PSR-12?**
A: PSR-1 is the basic standard — class naming (PascalCase), method naming (camelCase), constant naming (UPPER_CASE). PSR-12 is the extended style guide — indentation (4 spaces), brace placement, line length, `use` statement formatting. PSR-12 supersedes the older PSR-2.

**Q: How does PHP know where to find a class?**
A: Through `spl_autoload_register`. Composer registers a callback that converts a fully-qualified class name to a file path using PSR-4 rules and loads the file. This is triggered automatically when PHP encounters an unknown class name.
