# PHP PDO — PHP Data Objects

## TL;DR
PDO is PHP's **database abstraction layer** — one API that works with MySQL, PostgreSQL, SQLite, and more. Always use **prepared statements** (never string-concatenate SQL). Use `PDO::ERRMODE_EXCEPTION` to catch errors as exceptions. Use `beginTransaction()`/`commit()`/`rollBack()` for atomic operations.

---

## Why PDO?

Before PDO, PHP had separate extensions for each database: `mysql_*`, `mysqli_*`, `pg_*`. Switching databases meant rewriting all database code.

PDO provides:
- **One API** for 12+ databases — switch database with just a DSN change
- **Prepared statements** — the correct way to prevent SQL injection
- **OOP interface** — works naturally with modern PHP
- **Exception-based error handling** — no more checking return values

---

## 1. Connecting to a Database

```php
// DSN format: driver:host=...;dbname=...;charset=...
$dsn = 'mysql:host=localhost;dbname=shop;charset=utf8mb4';

$options = [
    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,    // throw exceptions on error
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,          // fetch as associative array
    PDO::ATTR_EMULATE_PREPARES   => false,                      // use native prepared statements
];

try {
    $pdo = new PDO($dsn, 'username', 'password', $options);
    echo "Connected!";
} catch (\PDOException $e) {
    // Don't expose DB errors to users — log and show a generic message
    error_log($e->getMessage());
    die('Database connection failed');
}
```

### DSN for Different Databases

```php
// MySQL
$dsn = 'mysql:host=localhost;dbname=mydb;charset=utf8mb4';

// PostgreSQL
$dsn = 'pgsql:host=localhost;dbname=mydb';

// SQLite (file-based — great for testing)
$dsn = 'sqlite:/path/to/database.db';
$dsn = 'sqlite::memory:'; // in-memory — fast for tests

// SQL Server
$dsn = 'sqlsrv:Server=localhost;Database=mydb';
```

### Singleton Connection Pattern

```php
class Connection {
    private static ?\PDO $instance = null;

    public static function getInstance(): \PDO {
        if (static::$instance === null) {
            $dsn = sprintf(
                'mysql:host=%s;dbname=%s;charset=utf8mb4',
                getenv('DB_HOST'),
                getenv('DB_NAME')
            );
            static::$instance = new \PDO(
                $dsn,
                getenv('DB_USER'),
                getenv('DB_PASS'),
                [
                    \PDO::ATTR_ERRMODE            => \PDO::ERRMODE_EXCEPTION,
                    \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC,
                    \PDO::ATTR_EMULATE_PREPARES   => false,
                ]
            );
        }
        return static::$instance;
    }
}

// Usage anywhere
$pdo = Connection::getInstance();
```

---

## 2. Prepared Statements — The Safe Way

### Why Prepared Statements?

```php
// DANGEROUS — SQL Injection vulnerability
$id   = $_GET['id'];                                          // user input
$sql  = "SELECT * FROM users WHERE id = $id";                // direct concatenation
$user = $pdo->query($sql)->fetch();

// What if $id = "1 OR 1=1" → returns ALL users!
// What if $id = "1; DROP TABLE users; --" → deletes everything!

// SAFE — prepared statement
$stmt = $pdo->prepare('SELECT * FROM users WHERE id = ?');
$stmt->execute([$id]);  // PDO escapes $id, treats it as DATA not SQL
$user = $stmt->fetch();
// SQL injection is impossible — ? is a placeholder for data, not SQL
```

### Positional Parameters (`?`)

```php
$stmt = $pdo->prepare('SELECT * FROM products WHERE category = ? AND price < ?');
$stmt->execute(['electronics', 500]);
$products = $stmt->fetchAll();
```

### Named Parameters (`:name`)

```php
$stmt = $pdo->prepare('SELECT * FROM users WHERE email = :email AND active = :active');
$stmt->execute([
    ':email'  => 'alice@example.com',
    ':active' => 1,
]);
$user = $stmt->fetch();
```

Named parameters are clearer when there are many parameters — no need to count `?` positions.

---

## 3. CRUD Operations

### SELECT — Fetch One

```php
$stmt = $pdo->prepare('SELECT * FROM users WHERE id = ?');
$stmt->execute([$id]);
$user = $stmt->fetch(); // PDO::FETCH_ASSOC by default
// ['id' => 1, 'name' => 'Alice', 'email' => 'alice@example.com']

// Returns false if not found
if (!$user) {
    throw new \RuntimeException("User #{$id} not found");
}
```

### SELECT — Fetch All

```php
$stmt = $pdo->prepare('SELECT * FROM products WHERE category = ? ORDER BY price ASC');
$stmt->execute(['electronics']);
$products = $stmt->fetchAll(); // array of associative arrays

foreach ($products as $product) {
    echo "{$product['name']} — \${$product['price']}\n";
}
```

### SELECT — Fetch Single Value

```php
$stmt = $pdo->prepare('SELECT COUNT(*) FROM users WHERE active = ?');
$stmt->execute([1]);
$count = $stmt->fetchColumn(); // returns a single scalar value
echo "Active users: {$count}";

$stmt = $pdo->prepare('SELECT email FROM users WHERE id = ?');
$stmt->execute([$id]);
$email = $stmt->fetchColumn(); // 'alice@example.com'
```

### INSERT

```php
$stmt = $pdo->prepare(
    'INSERT INTO users (name, email, password, created_at) VALUES (?, ?, ?, NOW())'
);
$stmt->execute([
    'Bob',
    'bob@example.com',
    password_hash('secret', PASSWORD_BCRYPT),
]);

$newId = (int) $pdo->lastInsertId(); // get the auto-incremented ID
echo "Created user #{$newId}";

$stmt->rowCount(); // rows affected (1 for a single insert)
```

### UPDATE

```php
$stmt = $pdo->prepare('UPDATE users SET name = ?, email = ? WHERE id = ?');
$stmt->execute(['Alice Updated', 'alice@new.com', $userId]);

$rowsAffected = $stmt->rowCount(); // how many rows were updated
if ($rowsAffected === 0) {
    echo "No rows updated — user may not exist";
}
```

### DELETE

```php
$stmt = $pdo->prepare('DELETE FROM users WHERE id = ?');
$stmt->execute([$userId]);

echo "Deleted {$stmt->rowCount()} row(s)";
```

---

## 4. Fetch Modes

```php
// PDO::FETCH_ASSOC (default) — associative array
$user = $stmt->fetch(PDO::FETCH_ASSOC);
// ['id' => 1, 'name' => 'Alice']

// PDO::FETCH_OBJ — stdClass object
$user = $stmt->fetch(PDO::FETCH_OBJ);
echo $user->name; // Alice

// PDO::FETCH_CLASS — populate a class
class User {
    public int    $id;
    public string $name;
    public string $email;
}
$stmt->setFetchMode(PDO::FETCH_CLASS, User::class);
$user = $stmt->fetch();
echo $user->name; // Alice (now a User object)

// Fetch all as specific class
$users = $stmt->fetchAll(PDO::FETCH_CLASS, User::class);

// PDO::FETCH_NUM — indexed array (rarely useful)
$user = $stmt->fetch(PDO::FETCH_NUM);
// [0 => 1, 1 => 'Alice', 2 => 'alice@example.com']

// PDO::FETCH_COLUMN — only the first column
$emails = $pdo->query('SELECT email FROM users')->fetchAll(PDO::FETCH_COLUMN);
// ['alice@example.com', 'bob@example.com', ...]

// PDO::FETCH_KEY_PAIR — [key => value] from 2 columns
$nameById = $pdo->query('SELECT id, name FROM users')->fetchAll(PDO::FETCH_KEY_PAIR);
// [1 => 'Alice', 2 => 'Bob', ...]
```

---

## 5. Transactions

A transaction groups multiple SQL statements into an **atomic unit** — either all succeed, or all are rolled back.

```php
try {
    $pdo->beginTransaction();

    // Debit from sender
    $pdo->prepare('UPDATE accounts SET balance = balance - ? WHERE id = ?')
        ->execute([100, $fromAccountId]);

    // Credit to receiver
    $pdo->prepare('UPDATE accounts SET balance = balance + ? WHERE id = ?')
        ->execute([100, $toAccountId]);

    // Create transaction record
    $pdo->prepare('INSERT INTO transfers (from_id, to_id, amount) VALUES (?, ?, ?)')
        ->execute([$fromAccountId, $toAccountId, 100]);

    $pdo->commit(); // all three succeed — commit
    echo "Transfer successful";

} catch (\PDOException $e) {
    $pdo->rollBack(); // any failure — undo everything
    throw new \RuntimeException('Transfer failed: ' . $e->getMessage(), previous: $e);
}
```

### Nested Transaction Helper

```php
function withTransaction(\PDO $pdo, callable $fn): mixed {
    try {
        $pdo->beginTransaction();
        $result = $fn($pdo);
        $pdo->commit();
        return $result;
    } catch (\Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
}

// Clean usage
$result = withTransaction($pdo, function (\PDO $pdo) use ($fromId, $toId, $amount) {
    $pdo->prepare('UPDATE accounts SET balance = balance - ? WHERE id = ?')
        ->execute([$amount, $fromId]);
    $pdo->prepare('UPDATE accounts SET balance = balance + ? WHERE id = ?')
        ->execute([$amount, $toId]);
    return true;
});
```

---

## 6. Error Handling

```php
// With ERRMODE_EXCEPTION (recommended), all errors throw PDOException
try {
    $stmt = $pdo->prepare('SELECT * FROM nonexistent_table');
    $stmt->execute();
} catch (\PDOException $e) {
    echo $e->getMessage();    // SQLSTATE[42S02]: Table 'db.nonexistent_table' doesn't exist
    echo $e->getCode();       // SQLSTATE error code: '42S02'
    echo $e->errorInfo[1];   // MySQL error code: 1146
    echo $e->errorInfo[2];   // MySQL error message
}

// Three error modes:
// PDO::ERRMODE_SILENT  (default in old PHP) — errors silently return false — dangerous
// PDO::ERRMODE_WARNING  — issues a PHP warning — rarely used
// PDO::ERRMODE_EXCEPTION (recommended) — throws PDOException — catchable, loggable
```

---

## 7. Real-World Repository Pattern

Instead of scattering PDO calls everywhere, encapsulate them in a repository class.

```php
class UserRepository {
    public function __construct(private \PDO $pdo) {}

    public function findById(int $id): ?array {
        $stmt = $this->pdo->prepare('SELECT * FROM users WHERE id = ? LIMIT 1');
        $stmt->execute([$id]);
        return $stmt->fetch() ?: null;
    }

    public function findByEmail(string $email): ?array {
        $stmt = $this->pdo->prepare('SELECT * FROM users WHERE email = ? LIMIT 1');
        $stmt->execute([$email]);
        return $stmt->fetch() ?: null;
    }

    public function findAll(int $limit = 50, int $offset = 0): array {
        $stmt = $this->pdo->prepare('SELECT * FROM users ORDER BY name LIMIT ? OFFSET ?');
        $stmt->execute([$limit, $offset]);
        return $stmt->fetchAll();
    }

    public function create(string $name, string $email, string $password): int {
        $stmt = $this->pdo->prepare(
            'INSERT INTO users (name, email, password, created_at) VALUES (?, ?, ?, NOW())'
        );
        $stmt->execute([$name, $email, password_hash($password, PASSWORD_BCRYPT)]);
        return (int) $this->pdo->lastInsertId();
    }

    public function update(int $id, array $data): bool {
        $sets   = implode(', ', array_map(fn($k) => "{$k} = ?", array_keys($data)));
        $values = array_values($data);
        $values[] = $id;

        $stmt = $this->pdo->prepare("UPDATE users SET {$sets} WHERE id = ?");
        $stmt->execute($values);
        return $stmt->rowCount() > 0;
    }

    public function delete(int $id): bool {
        $stmt = $this->pdo->prepare('DELETE FROM users WHERE id = ?');
        $stmt->execute([$id]);
        return $stmt->rowCount() > 0;
    }

    public function count(): int {
        return (int) $this->pdo->query('SELECT COUNT(*) FROM users')->fetchColumn();
    }
}

// Usage
$repo = new UserRepository(Connection::getInstance());
$user = $repo->findById(1);
$id   = $repo->create('Carol', 'carol@example.com', 'pass123');
$repo->update(1, ['name' => 'Alice Updated']);
$repo->delete(99);
```

---

## 8. Security Best Practices

```php
// 1. ALWAYS use prepared statements — never concatenate user input
// BAD:
$pdo->query("SELECT * FROM users WHERE email = '{$_POST['email']}'");
// GOOD:
$stmt = $pdo->prepare('SELECT * FROM users WHERE email = ?');
$stmt->execute([$_POST['email']]);

// 2. Never expose the raw PDOException message to users
catch (\PDOException $e) {
    error_log($e->getMessage()); // log internally
    http_response_code(500);
    echo json_encode(['error' => 'Database error']); // safe user-facing message
}

// 3. Limit DB user permissions — the PHP app user shouldn't have DROP/CREATE privileges
// DB user should only have: SELECT, INSERT, UPDATE, DELETE on specific tables

// 4. Store credentials in .env, not in code
$dsn  = sprintf('mysql:host=%s;dbname=%s', $_ENV['DB_HOST'], $_ENV['DB_NAME']);
$user = $_ENV['DB_USER'];
$pass = $_ENV['DB_PASS'];

// 5. Use ATTR_EMULATE_PREPARES = false for true native prepared statements
// (emulated prepares still protect against injection but use client-side string substitution)
$pdo->setAttribute(PDO::ATTR_EMULATE_PREPARES, false);
```

---

## PDO vs MySQLi

| | PDO | MySQLi |
|---|---|---|
| Database support | 12+ databases | MySQL/MariaDB only |
| API style | OOP only | OOP + procedural |
| Named parameters | Yes (`:name`) | No (positional `?` only) |
| `FETCH_CLASS` | Yes | Yes (limited) |
| Stored procedures | Yes | Yes |
| Use when | Any new project | Migrating from old `mysql_*` code |

**Always choose PDO** for new projects — flexibility to change databases without rewriting.

---

## Interview Q&A

**Q: What is PDO and why use it over `mysqli`?**
A: PDO (PHP Data Objects) is a database abstraction layer that provides a single API for 12+ databases. `mysqli` is MySQL-only. PDO supports named parameters (`:name`), has a cleaner fetch API (`FETCH_CLASS`, `FETCH_KEY_PAIR`), and uses the same code regardless of the underlying database.

**Q: What is a prepared statement and how does it prevent SQL injection?**
A: A prepared statement separates the SQL query structure from the data. The query is compiled once (`prepare()`), then data is bound separately (`execute([data])`). The database driver escapes the data as a literal value — it can never be interpreted as SQL. Direct string concatenation like `"WHERE id = $id"` allows an attacker to inject SQL syntax.

**Q: What is `PDO::ATTR_EMULATE_PREPARES` and should you set it to `false`?**
A: When `true` (the default), PDO simulates prepared statements client-side by escaping and inserting the values into the query string before sending it. When `false`, the query and values are sent separately to the database for true native prepared statements. Set it to `false` for better performance (the DB compiles the query once) and type safety (the DB knows the parameter type).

**Q: What does `rowCount()` return for a SELECT statement?**
A: It's unreliable for SELECT — it may return 0, -1, or the actual count depending on the driver. Use `fetchAll()` and `count()` on the result array, or use `SELECT COUNT(*)` with `fetchColumn()`.

**Q: When should you use a transaction?**
A: Whenever you have multiple SQL statements that must all succeed or all fail together — e.g., transferring money (debit + credit must both happen), creating an order + order items, or any operation where partial success would leave data inconsistent. If the DB connection fails mid-transaction, `rollBack()` ensures no partial changes are committed.
