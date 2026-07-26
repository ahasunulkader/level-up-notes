# Clean Code and Maintainability

## TL;DR
Clean code is code that **reads like well-written prose** — the next developer (or future you) understands it without needing to ask. Key principles: names reveal intent, methods do one thing, code smells signal design problems, refactoring improves structure without changing behavior, and technical debt is the cost of shortcuts.

---

## Why Clean Code Matters

Code is read far more than it is written. A function takes 10 minutes to write and gets read 100 times over its lifetime. Code that is hard to read:
- Slows down every new developer joining the team
- Makes bugs harder to find (unclear code hides bugs)
- Makes changes risky (you're not sure what you'll break)
- Accumulates technical debt that eventually paralyzes the team

> "Any fool can write code that a computer can understand. Good programmers write code that humans can understand." — Martin Fowler

---

## 1. Readability

Code should communicate **intent clearly** — what it does and why, not just how.

### Comments Shouldn't Explain WHAT — The Code Should

```php
// BAD — comment explains what the code does (the code should do that itself)
// Get user by id and check if active
$u = DB::table('users')->where('id', $id)->first();
if ($u && $u->status == 1) { ... }

// GOOD — code explains itself, comment only explains WHY (when not obvious)
$user = $this->userRepository->findById($userId);
if ($user->isActive()) {
    $this->grantAccess($user);
}

// Good use of a comment: explains WHY, not WHAT
// Stripe requires idempotency key to prevent double charges on network retry
$charge = $stripe->charges->create($params, ['idempotency_key' => $orderId]);
```

### Keep Related Things Together

```php
// BAD — setup scattered, hard to follow
$discount = 0.1;
$user = User::find($id);
$taxRate = 0.15;
$products = $user->cart()->get();
$shipping = 9.99;
$subtotal = $products->sum('price');
$total = ($subtotal * (1 - $discount) + $shipping) * (1 + $taxRate);

// GOOD — logically grouped, reads as a narrative
$user     = User::find($id);
$products = $user->cart()->get();

$subtotal = $products->sum('price');
$discount = 0.10;
$shipping = 9.99;
$taxRate  = 0.15;

$total = ($subtotal * (1 - $discount) + $shipping) * (1 + $taxRate);
```

### One Level of Abstraction Per Function

```php
// BAD — mixes high-level (user registration) with low-level (SQL, email headers)
public function register(array $data): void {
    $stmt = $this->db->prepare('INSERT INTO users (name, email, password) VALUES (?, ?, ?)');
    $stmt->execute([$data['name'], $data['email'], password_hash($data['password'], PASSWORD_BCRYPT)]);
    $userId = $this->db->lastInsertId();
    mail($data['email'], 'Welcome!', 'Hi ' . $data['name'], 'From: no-reply@app.com');
    $this->db->exec("INSERT INTO audit_log (action, user_id) VALUES ('register', $userId)");
}

// GOOD — high-level method reads as a story, details hidden in helper methods
public function register(array $data): User {
    $user = $this->userRepository->create($data);
    $this->mailer->sendWelcome($user);
    $this->auditLog->record('register', $user->id);
    return $user;
}
```

---

## 2. Naming

Good names are the single biggest contributor to readable code. Names should **reveal intent** — what the variable IS, what the function DOES, what the class REPRESENTS.

### Variables — Name What It Represents

```php
// BAD — cryptic abbreviations, meaningless names
$d  = new DateTime();
$u  = User::find($id);
$arr = $order->items()->get();
$tmp = $price * 0.15;
$flag = true;

// GOOD — reveals purpose
$now           = new DateTime();
$currentUser   = User::find($id);
$orderItems    = $order->items()->get();
$taxAmount     = $price * TAX_RATE;
$isUserActive  = true;
```

### Functions — Name What They DO

```php
// BAD — vague names
public function process(array $data): bool { ... }
public function handle(User $user): void { ... }
public function check(string $email): bool { ... }
public function getData(): array { ... }

// GOOD — verb + noun describes the action
public function registerUser(array $data): User { ... }
public function deactivateAccount(User $user): void { ... }
public function isValidEmail(string $email): bool { ... }
public function getActiveOrders(): array { ... }
```

### Boolean Names — Answer a Yes/No Question

```php
// BAD
$active   = true;
$result   = $user->check();
$verified = $this->status;

// GOOD — reads naturally in if statements
$isActive      = true;
$isEmailValid  = $user->hasVerifiedEmail();
$hasPermission = $this->isAdmin;

if ($isEmailValid && $hasPermission) { ... } // reads like English
```

### Class Names — Noun (What It IS)

```php
// BAD — verb names for classes, vague "Manager/Helper/Util" names
class ProcessData { }
class UserHelper { }
class DataManager { }

// GOOD — nouns that describe a clear concept
class OrderProcessor { }    // still ok — a processor is a noun role
class UserRepository { }    // stores/retrieves users
class EmailValidator { }    // validates emails
class PriceCalculator { }   // calculates prices
class OrderSummary { }      // represents a summary
```

### Avoid Mental Mapping

```php
// BAD — reader has to map: what is 'a'? what is 'r'?
foreach ($a as $r) {
    sendEmail($r->e);
}

// GOOD — self-documenting
foreach ($activeUsers as $user) {
    sendEmail($user->email);
}
```

---

## 3. Method Size

A method should do **one thing, do it well, and do it only**.

### Signs a Method is Too Long

- You need to write a comment before each section ("// validate input", "// save to DB", "// send email")
- You scroll to see the whole method
- It's hard to name — if you name it `validateAndSaveAndNotify()`, it does too much

```php
// BAD — one long method doing everything
public function checkout(int $userId, array $items): array {
    // validate
    if (empty($items)) throw new \InvalidArgumentException('Cart is empty');
    foreach ($items as $item) {
        $product = Product::find($item['product_id']);
        if (!$product || $product->stock < $item['qty']) {
            throw new \RuntimeException("Product {$item['product_id']} unavailable");
        }
    }
    // calculate
    $subtotal = 0;
    foreach ($items as $item) {
        $product   = Product::find($item['product_id']);
        $subtotal += $product->price * $item['qty'];
    }
    $tax   = $subtotal * 0.15;
    $total = $subtotal + $tax;
    // save order
    $order = Order::create(['user_id' => $userId, 'total' => $total, 'status' => 'pending']);
    foreach ($items as $item) {
        OrderItem::create(['order_id' => $order->id, 'product_id' => $item['product_id'], 'qty' => $item['qty']]);
        Product::where('id', $item['product_id'])->decrement('stock', $item['qty']);
    }
    // notify
    Mail::to(User::find($userId)->email)->send(new OrderConfirmation($order));
    Slack::notify('#orders', "New order #{$order->id}");
    return $order->toArray();
}

// GOOD — each step is a clearly named method
public function checkout(int $userId, array $items): Order {
    $this->validateCartItems($items);

    $total = $this->calculateOrderTotal($items);
    $order = $this->createOrder($userId, $items, $total);
    $this->notifyOrderPlaced($order);

    return $order;
}

private function validateCartItems(array $items): void { ... }
private function calculateOrderTotal(array $items): float { ... }
private function createOrder(int $userId, array $items, float $total): Order { ... }
private function notifyOrderPlaced(Order $order): void { ... }
```

**Rule of thumb:** If a method needs to be scrolled to read, it's too long. If you need to add a comment to explain a section, extract that section into a named method.

---

## 4. Code Smells

Code smells are symptoms of deeper design problems. They don't necessarily mean broken code — they mean the code will be hard to change, test, or understand.

### Long Method
See above. Extract into smaller, named private methods.

### Large Class (God Object)

A class that does everything — knows everything, controls everything.

```php
// SMELL — UserManager does 8 different jobs
class UserManager {
    public function register() { }
    public function login() { }
    public function resetPassword() { }
    public function updateProfile() { }
    public function sendEmail() { }
    public function chargeCard() { }
    public function generateReport() { }
    public function exportCsv() { }
}

// FIX — split by responsibility
class UserAuthService    { public function register() {} public function login() {} }
class UserProfileService { public function update() {} }
class PasswordResetService { public function reset() {} }
class UserReportService  { public function generate() {} public function exportCsv() {} }
```

### Duplicate Code (DRY Violation)

```php
// SMELL — same logic in two places
public function createAdminUser(array $data): User {
    $data['password'] = password_hash($data['password'], PASSWORD_BCRYPT);
    $data['role']     = 'admin';
    $user             = User::create($data);
    Mail::to($user->email)->send(new WelcomeMail($user));
    return $user;
}

public function createRegularUser(array $data): User {
    $data['password'] = password_hash($data['password'], PASSWORD_BCRYPT);
    $data['role']     = 'user';
    $user             = User::create($data);
    Mail::to($user->email)->send(new WelcomeMail($user));
    return $user;
}

// FIX — extract common logic
public function createUser(array $data, string $role = 'user'): User {
    $data['password'] = password_hash($data['password'], PASSWORD_BCRYPT);
    $data['role']     = $role;
    $user             = User::create($data);
    Mail::to($user->email)->send(new WelcomeMail($user));
    return $user;
}

public function createAdminUser(array $data): User {
    return $this->createUser($data, 'admin');
}
```

### Feature Envy

A method uses data from another class more than its own — it should probably live there.

```php
// SMELL — OrderPrinter reaches into Order's internals constantly
class OrderPrinter {
    public function printSummary(Order $order): string {
        return sprintf(
            "Order #%d: %d items, subtotal: %.2f, tax: %.2f, total: %.2f",
            $order->id,
            count($order->items),
            $order->subtotal,
            $order->subtotal * $order->taxRate,
            $order->subtotal * (1 + $order->taxRate)
        );
    }
}

// FIX — the logic belongs in Order itself
class Order {
    public function getSummary(): string {
        return sprintf(
            "Order #%d: %d items, subtotal: %.2f, tax: %.2f, total: %.2f",
            $this->id, count($this->items), $this->subtotal,
            $this->subtotal * $this->taxRate,
            $this->total()
        );
    }
}
```

### Magic Numbers / Strings

```php
// SMELL — what does 0.15 mean? What is 5?
if ($user->type === 2) {
    $price = $price * 0.85;
}
if ($loginAttempts > 5) {
    $this->lockAccount();
}

// FIX — named constants reveal intent
const TAX_RATE             = 0.15;
const PREMIUM_DISCOUNT     = 0.15;
const MAX_LOGIN_ATTEMPTS   = 5;
const USER_TYPE_PREMIUM    = 2;

if ($user->type === self::USER_TYPE_PREMIUM) {
    $price = $price * (1 - self::PREMIUM_DISCOUNT);
}
if ($loginAttempts > self::MAX_LOGIN_ATTEMPTS) {
    $this->lockAccount();
}
```

### Long Parameter List

```php
// SMELL — 7 parameters, easy to pass in wrong order
public function createOrder(int $userId, string $status, float $subtotal,
    float $tax, float $shipping, string $couponCode, bool $isGift): Order { }

// FIX — use a Data Transfer Object
class CreateOrderData {
    public function __construct(
        public readonly int    $userId,
        public readonly string $status,
        public readonly float  $subtotal,
        public readonly float  $tax,
        public readonly float  $shipping,
        public readonly string $couponCode = '',
        public readonly bool   $isGift     = false,
    ) {}
}

public function createOrder(CreateOrderData $data): Order { }
```

### Common Code Smells Summary

| Smell | Symptom | Fix |
|---|---|---|
| Long Method | Scrolling required, needs section comments | Extract methods |
| Large Class | Does too many things | Split by responsibility |
| Duplicate Code | Copy-pasted logic | Extract to shared method/class |
| Feature Envy | Method uses another class's data more than its own | Move method to that class |
| Magic Numbers | Unexplained `0.15`, `2`, `500` | Named constants |
| Long Parameter List | 5+ parameters | DTO / Parameter Object |
| Deeply Nested Code | 4+ levels of if/for | Early returns, extract methods |
| Dead Code | Commented out code, unused methods | Delete it |

---

## 5. Refactoring Basics

Refactoring means **changing the internal structure of code without changing its external behavior**. Tests are your safety net — they confirm the behavior didn't change.

### Extract Method

```php
// BEFORE
public function printOrder(Order $order): void {
    echo "=== ORDER #{$order->id} ===\n";
    echo "Date: " . $order->created_at->format('Y-m-d') . "\n";
    echo "Customer: {$order->user->name}\n";
    echo "\nItems:\n";
    foreach ($order->items as $item) {
        echo "  - {$item->product->name}: {$item->qty} x \${$item->price}\n";
    }
    echo "\nTotal: \${$order->total}\n";
    echo "=========================\n";
}

// AFTER — each section extracted
public function printOrder(Order $order): void {
    $this->printHeader($order);
    $this->printItems($order->items);
    $this->printFooter($order->total);
}

private function printHeader(Order $order): void {
    echo "=== ORDER #{$order->id} ===\n";
    echo "Date: " . $order->created_at->format('Y-m-d') . "\n";
    echo "Customer: {$order->user->name}\n";
}
```

### Replace Conditional with Polymorphism

```php
// BEFORE — every new payment type requires editing this method
public function processPayment(string $type, float $amount): bool {
    if ($type === 'stripe') {
        return $this->stripe->charge($amount);
    } elseif ($type === 'paypal') {
        return $this->paypal->pay($amount);
    } elseif ($type === 'bitcoin') {
        return $this->bitcoin->send($amount);
    }
    throw new \InvalidArgumentException("Unknown type: {$type}");
}

// AFTER — each type handles itself
interface PaymentMethod {
    public function process(float $amount): bool;
}

class StripePayment implements PaymentMethod { ... }
class PayPalPayment implements PaymentMethod { ... }
class BitcoinPayment implements PaymentMethod { ... }

public function processPayment(PaymentMethod $method, float $amount): bool {
    return $method->process($amount); // no if/else needed — add new types without touching this
}
```

### Replace Magic Number with Named Constant

```php
// BEFORE
if ($score >= 90) { $grade = 'A'; }
elseif ($score >= 80) { $grade = 'B'; }

// AFTER
const GRADE_A_THRESHOLD = 90;
const GRADE_B_THRESHOLD = 80;

if ($score >= self::GRADE_A_THRESHOLD) { $grade = 'A'; }
elseif ($score >= self::GRADE_B_THRESHOLD) { $grade = 'B'; }
```

### Key Refactoring Rules

1. **Never refactor without tests** — you can't know if you broke something
2. **Small steps** — one refactoring at a time, run tests after each
3. **Don't add functionality while refactoring** — separate concerns
4. **Leave the code better than you found it** (Boy Scout Rule)

---

## 6. Technical Debt

Technical debt is **the future cost of shortcuts taken today**. Like financial debt, it accumulates interest — the longer you leave it, the more expensive it becomes to fix.

### Types of Technical Debt

| Type | Example | Intentional? |
|---|---|---|
| **Deliberate** | "We'll clean this up after the launch" | Yes |
| **Accidental** | Not knowing a better approach existed | No |
| **Bit rot** | Old code that worked but doesn't fit new patterns | Gradual |

### What Technical Debt Looks Like

```php
// TODO: fix this — it breaks when qty > 1000 (added 8 months ago, never fixed)
public function calculateShipping(int $qty): float {
    return $qty * 0.5; // doesn't account for bulk discounts
}

// copy-pasted from UserController — should extract to service
// (found in 4 different controllers)
$user = DB::table('users')->where('email', $email)->where('active', 1)->first();

// This works for now but doesn't scale — rewrite when we hit 10k users
// (written 2 years ago, now 100k users)
foreach (User::all() as $user) { ... }
```

### Managing Technical Debt

```
High Priority (fix now):
- Security vulnerabilities
- Performance bottlenecks affecting users
- Bugs that cause incorrect behavior

Medium Priority (schedule a sprint):
- Architectural issues that slow down new features
- Duplicated code that keeps causing bugs

Low Priority (track in backlog):
- Style inconsistencies
- Minor naming improvements
- Old comments
```

**Strategies:**
- **Track it** — add TODO comments with date and ticket number, not just "TODO: fix"
- **Boy Scout Rule** — every time you touch code, leave it slightly better
- **Budget for it** — allocate 10-20% of each sprint to debt reduction
- **Don't pay it all at once** — big rewrites almost always fail; iterate
- **Prevent it** — code review, linting, automated style enforcement

---

## Interview Q&A

**Q: What is the difference between clean code and working code?**
A: Working code does what it's supposed to. Clean code does what it's supposed to AND is easy to read, understand, and change. All production code should be both. Clean code reduces the cost of every future change — every bug fix, feature addition, and onboarding of a new developer.

**Q: What are code smells? Give 3 examples.**
A: Code smells are symptoms that suggest design problems. Examples: (1) Long Method — a method that does too many things, hard to understand and test; (2) Duplicate Code — the same logic copy-pasted in multiple places; (3) Magic Numbers — unexplained literal values like `0.15` or `2` that readers can't understand without context.

**Q: What is refactoring and when should you NOT refactor?**
A: Refactoring is improving code structure without changing behavior. Don't refactor without tests — you can't verify you didn't break anything. Don't refactor while also adding features in the same commit — it becomes impossible to tell what caused a bug. Don't refactor code you don't understand yet.

**Q: What is technical debt?**
A: Technical debt is the accumulated cost of shortcuts, quick fixes, and deferred improvements. It grows over time like interest — small debt today becomes large maintenance cost tomorrow. It slows down feature development as more and more time is spent working around bad code instead of building new things.

**Q: Why is naming so important in clean code?**
A: Code is read far more than it is written. A good name makes the reader understand intent without diving into implementation. Bad names force readers to mentally translate what `$d`, `$tmp`, or `process()` mean. Good naming reduces the cognitive load of reading code — which is what developers spend most of their time doing.
