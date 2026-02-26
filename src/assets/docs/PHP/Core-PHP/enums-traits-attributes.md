# PHP Enums, Traits & Attributes

---

## Part 1: PHP Enums (PHP 8.1+)

### TL;DR — Enums
Enums replace magic strings and integers with named, type-safe values. Instead of `$status = 'active'` (a string anyone can typo), use `Status::Active` — which is validated at compile time and has IDE autocomplete.

---

### The Problem Without Enums

```php
// Before PHP 8.1 — "stringly typed" code
const STATUS_PENDING   = 'pending';
const STATUS_ACTIVE    = 'active';
const STATUS_INACTIVE  = 'inactive';

function activateUser(string $status): void {
    if ($status === 'activee') { // typo — no error, silent bug
        // ...
    }
}

activateUser('whatever'); // accepted, no type safety
```

### Pure Enums (No Backing Value)

```php
enum Status {
    case Pending;
    case Active;
    case Inactive;
    case Banned;
}

function activateUser(Status $status): void {
    if ($status === Status::Active) {
        // ...
    }
}

activateUser(Status::Active);   // ✅
// activateUser('active');      // TypeError — must be Status, not string
// activateUser(Status::Activee); // Error — case doesn't exist

// Compare
$s = Status::Pending;
if ($s === Status::Pending) { /* true */ }
if ($s === Status::Active)  { /* false */ }

// Get case name as string
echo Status::Active->name; // 'Active'
```

### Backed Enums — With a Value

Backed enums associate each case with a `string` or `int` value. Useful when storing in a database or JSON.

```php
enum Status: string {  // ': string' makes it a backed enum
    case Pending   = 'pending';
    case Active    = 'active';
    case Inactive  = 'inactive';
}

// Get the backing value
echo Status::Active->value; // 'active'

// Create from a value (e.g., database column)
$fromDb = Status::from('pending');    // Status::Pending — throws if not found
$try    = Status::tryFrom('unknown'); // null — safe version, doesn't throw

// Store to DB
$user->status = Status::Active->value; // stores 'active'

// Read from DB
$status = Status::from($row['status']); // converts 'active' back to Status::Active
```

```php
// Integer-backed enum
enum Priority: int {
    case Low    = 1;
    case Medium = 2;
    case High   = 3;
    case Critical = 4;
}

echo Priority::High->value; // 3
$priority = Priority::from(2); // Priority::Medium
```

### Enums with Methods

```php
enum Status: string {
    case Pending   = 'pending';
    case Active    = 'active';
    case Inactive  = 'inactive';

    public function label(): string {
        return match($this) {
            Status::Pending  => 'Awaiting Approval',
            Status::Active   => 'Active',
            Status::Inactive => 'Deactivated',
        };
    }

    public function canTransitionTo(Status $new): bool {
        return match($this) {
            Status::Pending  => $new === Status::Active,
            Status::Active   => $new === Status::Inactive,
            Status::Inactive => false,
        };
    }

    public function isActive(): bool {
        return $this === Status::Active;
    }
}

echo Status::Pending->label();  // 'Awaiting Approval'
var_dump(Status::Pending->canTransitionTo(Status::Active));   // true
var_dump(Status::Active->canTransitionTo(Status::Inactive));  // true
var_dump(Status::Inactive->canTransitionTo(Status::Active));  // false
```

### Enums Implementing Interfaces

```php
interface HasColor {
    public function color(): string;
}

enum TrafficLight: string implements HasColor {
    case Red    = 'red';
    case Yellow = 'yellow';
    case Green  = 'green';

    public function color(): string {
        return $this->value;
    }

    public function canGo(): bool {
        return $this === self::Green;
    }
}

echo TrafficLight::Red->color(); // 'red'
```

### Listing All Cases

```php
// Get all cases as array
$cases = Status::cases(); // [Status::Pending, Status::Active, Status::Inactive]

// Build a select dropdown
foreach (Status::cases() as $case) {
    echo "<option value='{$case->value}'>{$case->label()}</option>";
}
```

### Pros & Cons of Enums

**Benefits:**
- Type-safe — no invalid values possible
- IDE autocomplete for all cases
- Can carry behavior (methods) unlike constants
- Replace magic strings/integers throughout codebase

**Disadvantages:**
- PHP 8.1+ only — no support in older codebases
- Can't extend enums (no inheritance)
- Pure enums have no value — can't store directly to DB without conversion

---

## Part 2: PHP Traits

### TL;DR — Traits
Traits let you **reuse code across multiple unrelated classes** without inheritance. PHP only allows single inheritance, so Traits solve the "I need this behavior in two classes that have different parents" problem.

---

### The Problem Without Traits

```php
// You can't do this in PHP:
class AdminUser extends User, Loggable, Timestampable { } // ❌ multiple inheritance

// Without traits, you copy-paste code or create awkward inheritance trees
```

### Basic Trait Usage

```php
trait Timestampable {
    private ?DateTime $createdAt = null;
    private ?DateTime $updatedAt = null;

    public function setCreatedAt(): void {
        $this->createdAt = new DateTime();
    }

    public function setUpdatedAt(): void {
        $this->updatedAt = new DateTime();
    }

    public function getCreatedAt(): ?DateTime {
        return $this->createdAt;
    }
}

trait SoftDeletable {
    private ?DateTime $deletedAt = null;

    public function softDelete(): void {
        $this->deletedAt = new DateTime();
    }

    public function isDeleted(): bool {
        return $this->deletedAt !== null;
    }

    public function restore(): void {
        $this->deletedAt = null;
    }
}

// Multiple unrelated classes can use the same traits
class User {
    use Timestampable, SoftDeletable; // use multiple traits

    public function __construct(public readonly string $name) {
        $this->setCreatedAt();
    }
}

class Post {
    use Timestampable, SoftDeletable; // same traits, different class

    public function __construct(public readonly string $title) {
        $this->setCreatedAt();
    }
}

$user = new User('Alice');
$user->softDelete();
echo $user->isDeleted() ? 'deleted' : 'active'; // deleted
$user->restore();
```

### Traits with Abstract Methods

A trait can define an abstract method — forcing the using class to implement it.

```php
trait Validatable {
    abstract protected function rules(): array; // using class must implement this

    public function validate(array $data): bool {
        foreach ($this->rules() as $field => $rule) {
            if ($rule === 'required' && empty($data[$field])) {
                return false;
            }
        }
        return true;
    }
}

class UserForm {
    use Validatable;

    protected function rules(): array { // must implement
        return [
            'name'  => 'required',
            'email' => 'required',
        ];
    }
}
```

### Resolving Trait Conflicts

When two traits define the same method, PHP requires you to resolve the conflict explicitly.

```php
trait A {
    public function hello(): string { return 'Hello from A'; }
}

trait B {
    public function hello(): string { return 'Hello from B'; }
}

class MyClass {
    use A, B {
        A::hello insteadof B; // use A's version
        B::hello as helloB;  // also keep B's as an alias
    }
}

$obj = new MyClass();
echo $obj->hello();  // 'Hello from A'
echo $obj->helloB(); // 'Hello from B'
```

### Traits vs Inheritance vs Interfaces

| | Trait | Inheritance | Interface |
|---|---|---|---|
| Code reuse | Yes | Yes | No (PHP 8 default methods are limited) |
| Multiple use | Yes | No (single parent) | Yes |
| "Is-a" relationship | No | Yes | Partially |
| Can have state | Yes (properties) | Yes | No |
| Use when | Shared behavior across unrelated classes | Base class + specialization | Contract definition |

**Pros of Traits:**
- Solves the "multiple inheritance" limitation
- DRY — write once, use in many classes
- Better than deep inheritance chains

**Cons of Traits:**
- Can be overused — makes code hard to trace ("where does this method come from?")
- No compile-time guarantee — trait methods aren't visible in interface contracts
- Can introduce conflicts when two traits define the same method

---

## Part 3: PHP Attributes (PHP 8.0+)

### TL;DR — Attributes
Attributes (also called annotations) let you add **structured metadata to classes, methods, properties, and parameters** using `#[AttributeName]` syntax. They're read at runtime using the Reflection API. Before PHP 8, developers used PHPDoc comments (`@Route`, `@Column`) — Attributes make this official and structured.

---

### The Problem Before Attributes

```php
// Old way — metadata in comments (no validation, just strings)
/**
 * @Route("/users", methods={"GET"})
 * @Cache(ttl=300)
 */
public function getUsers(): Response { /* ... */ }
// Any framework had to parse these strings manually — fragile
```

### Basic Attribute Syntax

```php
// Declare an attribute class
#[Attribute]
class Route {
    public function __construct(
        public readonly string $path,
        public readonly array  $methods = ['GET'],
    ) {}
}

// Apply the attribute to a method
class UserController {
    #[Route('/users', ['GET'])]
    public function index(): array { return []; }

    #[Route('/users', ['POST'])]
    public function store(): array { return []; }

    #[Route('/users/{id}', ['GET', 'PUT', 'DELETE'])]
    public function show(int $id): array { return []; }
}
```

### Reading Attributes with Reflection API

Attributes are useless until you read them. The Reflection API provides this.

```php
// Simple attribute
#[Attribute]
class Validate {
    public function __construct(
        public readonly string $rule,
        public readonly string $message = '',
    ) {}
}

class UserForm {
    #[Validate('required', 'Name is required')]
    #[Validate('min:2', 'Name must be at least 2 chars')]
    public string $name;

    #[Validate('required')]
    #[Validate('email')]
    public string $email;
}

// Read attributes via Reflection
function validateForm(object $form, array $data): array {
    $errors = [];
    $reflection = new ReflectionClass($form);

    foreach ($reflection->getProperties() as $property) {
        $attributes = $property->getAttributes(Validate::class);

        foreach ($attributes as $attribute) {
            $validate = $attribute->newInstance(); // creates the Validate object
            $fieldName = $property->getName();
            $value = $data[$fieldName] ?? '';

            if ($validate->rule === 'required' && empty($value)) {
                $errors[$fieldName][] = $validate->message ?: "{$fieldName} is required";
            }
            // ... more rule checks
        }
    }

    return $errors;
}

$form   = new UserForm();
$errors = validateForm($form, ['name' => '', 'email' => 'not-an-email']);
```

### Attribute Targets — Where Can They Be Applied?

```php
// Limit where your attribute can be used
#[Attribute(Attribute::TARGET_METHOD)]         // only on methods
#[Attribute(Attribute::TARGET_PROPERTY)]       // only on properties
#[Attribute(Attribute::TARGET_CLASS)]          // only on classes
#[Attribute(Attribute::TARGET_PARAMETER)]      // only on parameters
#[Attribute(Attribute::TARGET_FUNCTION)]       // only on functions
#[Attribute(Attribute::IS_REPEATABLE)]         // allow multiple on same target
#[Attribute(Attribute::TARGET_ALL)]            // anywhere (default)

// Combining:
#[Attribute(Attribute::TARGET_METHOD | Attribute::TARGET_FUNCTION | Attribute::IS_REPEATABLE)]
class Cache {
    public function __construct(public readonly int $ttl = 300) {}
}
```

### Real-World Usage

```php
// Laravel uses attributes for route definitions (Laravel 10+)
use Illuminate\Routing\Attributes\Get;
use Illuminate\Routing\Attributes\Post;

class UserController extends Controller {
    #[Get('/users')]
    public function index(): JsonResponse { /* ... */ }

    #[Post('/users')]
    public function store(Request $request): JsonResponse { /* ... */ }
}

// Symfony uses attributes for column mapping
use Doctrine\ORM\Mapping as ORM;

#[ORM\Entity]
#[ORM\Table(name: 'users')]
class User {
    #[ORM\Id]
    #[ORM\Column(type: 'integer')]
    #[ORM\GeneratedValue]
    private ?int $id = null;

    #[ORM\Column(type: 'string', length: 255)]
    private string $name;
}
```

### Attributes vs PHPDoc Annotations

| | PHP Attributes | PHPDoc (`@annotation`) |
|---|---|---|
| Parsing | Built into PHP via Reflection | Requires a library (Doctrine Annotations) |
| Type safety | Yes — it's real PHP code | No — just strings |
| IDE support | Native | Plugin-dependent |
| PHP version | 8.0+ | All versions |
| Performance | Faster | Slower (string parsing) |

---

## Interview Q&A

**Q: What are PHP enums and what do they replace?**
A: Enums (PHP 8.1) replace collections of constants or "magic strings/integers" with type-safe named values. Instead of `const STATUS_ACTIVE = 'active'` and accepting a raw string, you define `Status::Active` and type-hint `Status $status`. Backed enums also carry a value for database storage.

**Q: What is the difference between a pure enum and a backed enum?**
A: A pure enum has no underlying value — cases are just names (`Status::Pending`). A backed enum maps each case to a string or int (`Status::Pending = 'pending'`), enabling `Status::from('pending')` to convert from database values and `$enum->value` to get the stored value.

**Q: What problem do Traits solve?**
A: PHP only allows single inheritance (`extends`). Traits let you share reusable code across multiple unrelated classes that can't have a common parent. Example: `Timestampable` and `SoftDeletable` traits can be used in `User`, `Post`, `Product` — all with different parents.

**Q: How do Traits differ from Inheritance?**
A: Inheritance creates an "is-a" relationship — a `Dog` IS an `Animal`. Traits are "has-a" or "can-do" — a `User` HAS timestamps, a `Post` HAS timestamps. Multiple traits can be used in one class; only one class can be extended. Traits can't be instantiated on their own.

**Q: What are PHP Attributes used for?**
A: Attributes attach structured metadata to classes, methods, properties, and parameters using `#[AttributeName]` syntax. Frameworks read this metadata at runtime via the Reflection API. Laravel uses them for route definitions, Doctrine ORM uses them for database column mapping. They replace fragile PHPDoc comment annotations with real, type-safe PHP code.

**Q: How do you read attributes at runtime?**
A: Using the Reflection API — `(new ReflectionClass($obj))->getAttributes(MyAttribute::class)` returns all attributes of that type. Call `->newInstance()` on the result to get an instance of the attribute class with all its properties set.
