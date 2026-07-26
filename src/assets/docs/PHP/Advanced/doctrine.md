# Doctrine PHP — ORM, DBAL, Query Builder & Migrations

## TL;DR
**Doctrine** is PHP's most powerful database library. **DBAL** (Database Abstraction Layer) is a thin layer over PDO giving you a clean, database-agnostic API. **ORM** (Object-Relational Mapper) maps PHP classes to database tables — you work with PHP objects and Doctrine handles SQL. **Query Builder** builds queries programmatically. **Migrations** version-control your schema. Doctrine is the backbone of Symfony and many enterprise PHP apps.

---

## Installation

```bash
# Install ORM (includes DBAL and Query Builder)
composer require doctrine/orm

# Migrations
composer require doctrine/migrations

# Annotations support (if using annotation mapping)
composer require doctrine/annotations
```

---

## a. Basic Doctrine Concepts

### Core Components

| Component | What It Does |
|---|---|
| **EntityManager** | Central object — persists, fetches, removes entities |
| **Entity** | A PHP class mapped to a database table |
| **Repository** | Queries for a specific entity type |
| **Unit of Work** | Tracks changes to entities, batches SQL |
| **DBAL** | Raw SQL/query builder without ORM overhead |
| **Migrations** | Version-controlled schema changes |

### How Doctrine Works

```
PHP Object (Entity)
      │
      ▼
EntityManager
      │
      ├── persist($entity)   → tracks new entity (INSERT planned)
      ├── remove($entity)    → tracks deletion (DELETE planned)
      ├── flush()            → executes all planned SQL
      └── find(User::class, 1) → SELECT * FROM users WHERE id = 1
```

---

## b. DBAL (Database Abstraction Layer)

DBAL is Doctrine's low-level database layer — use it when you want raw SQL power without ORM overhead.

### Setup

```php
use Doctrine\DBAL\DriverManager;

$connection = DriverManager::getConnection([
    'dbname'   => 'myapp',
    'user'     => 'root',
    'password' => 'secret',
    'host'     => 'localhost',
    'driver'   => 'pdo_mysql',
]);

// Or with DSN
$connection = DriverManager::getConnection([
    'url' => 'mysql://root:secret@localhost/myapp',
]);
```

### Querying with DBAL

```php
// Fetch all rows
$users = $connection->fetchAllAssociative('SELECT * FROM users');

// Fetch one row
$user = $connection->fetchAssociative(
    'SELECT * FROM users WHERE id = ?',
    [1]
);

// Fetch single value
$count = $connection->fetchOne('SELECT COUNT(*) FROM users');

// Named parameters
$user = $connection->fetchAssociative(
    'SELECT * FROM users WHERE email = :email AND active = :active',
    ['email' => 'alice@example.com', 'active' => true]
);

// Insert
$connection->insert('users', [
    'name'       => 'Alice',
    'email'      => 'alice@example.com',
    'created_at' => date('Y-m-d H:i:s'),
]);
$id = $connection->lastInsertId();

// Update
$affected = $connection->update(
    'users',
    ['name' => 'Alice Updated'],   // data
    ['id'   => 1]                  // where
);

// Delete
$connection->delete('users', ['id' => 1]);

// Execute (for DDL statements)
$connection->executeStatement('CREATE INDEX idx_email ON users (email)');
```

### Transactions with DBAL

```php
$connection->beginTransaction();
try {
    $connection->insert('orders', ['user_id' => 1, 'total' => 99.99]);
    $orderId = $connection->lastInsertId();

    $connection->insert('order_items', [
        'order_id'   => $orderId,
        'product_id' => 42,
        'quantity'   => 2,
    ]);

    $connection->executeStatement(
        'UPDATE products SET stock = stock - ? WHERE id = ?',
        [2, 42]
    );

    $connection->commit();
} catch (\Throwable $e) {
    $connection->rollBack();
    throw $e;
}
```

---

## c. ORM (Object-Relational Mapper)

The ORM maps PHP classes (Entities) to database tables. You work with objects; Doctrine generates SQL.

### Entity Setup (PHP 8 Attributes — Modern Approach)

```php
use Doctrine\ORM\Mapping as ORM;

#[ORM\Entity(repositoryClass: UserRepository::class)]
#[ORM\Table(name: 'users')]
class User {
    #[ORM\Id]
    #[ORM\GeneratedValue]
    #[ORM\Column(type: 'integer')]
    private ?int $id = null;

    #[ORM\Column(type: 'string', length: 100)]
    private string $name;

    #[ORM\Column(type: 'string', length: 255, unique: true)]
    private string $email;

    #[ORM\Column(type: 'boolean', options: ['default' => true])]
    private bool $active = true;

    #[ORM\Column(type: 'datetime')]
    private \DateTime $createdAt;

    // One User has Many Orders
    #[ORM\OneToMany(targetEntity: Order::class, mappedBy: 'user', cascade: ['persist'])]
    private Collection $orders;

    public function __construct(string $name, string $email) {
        $this->name      = $name;
        $this->email     = $email;
        $this->createdAt = new \DateTime();
        $this->orders    = new ArrayCollection();
    }

    // Getters and setters
    public function getId(): ?int        { return $this->id; }
    public function getName(): string    { return $this->name; }
    public function getEmail(): string   { return $this->email; }
    public function isActive(): bool     { return $this->active; }
    public function getOrders(): Collection { return $this->orders; }

    public function setName(string $name): void   { $this->name = $name; }
    public function deactivate(): void             { $this->active = false; }
}
```

### Relationships

```php
// Order Entity
#[ORM\Entity]
#[ORM\Table(name: 'orders')]
class Order {
    #[ORM\Id, ORM\GeneratedValue, ORM\Column(type: 'integer')]
    private ?int $id = null;

    // Many Orders belong to One User
    #[ORM\ManyToOne(targetEntity: User::class, inversedBy: 'orders')]
    #[ORM\JoinColumn(nullable: false)]
    private User $user;

    #[ORM\Column(type: 'decimal', precision: 10, scale: 2)]
    private string $total;

    // Many-to-Many: Order has many Products, Product has many Orders
    #[ORM\ManyToMany(targetEntity: Product::class)]
    #[ORM\JoinTable(name: 'order_products')]
    private Collection $products;

    public function __construct(User $user, float $total) {
        $this->user     = $user;
        $this->total    = (string) $total;
        $this->products = new ArrayCollection();
    }
}
```

### EntityManager Setup

```php
use Doctrine\ORM\ORMSetup;
use Doctrine\ORM\EntityManager;
use Doctrine\DBAL\DriverManager;

// Config
$config = ORMSetup::createAttributeMetadataConfiguration(
    paths: [__DIR__ . '/src/Entity'],
    isDevMode: true,
);

// Connection
$connection = DriverManager::getConnection([
    'url' => 'mysql://root:secret@localhost/myapp',
], $config);

$em = new EntityManager($connection, $config);
```

### CRUD with EntityManager

```php
// CREATE
$user = new User('Alice', 'alice@example.com');
$em->persist($user);
$em->flush();
echo $user->getId(); // auto-generated ID after flush

// READ
$user  = $em->find(User::class, 1);             // by primary key
$users = $em->getRepository(User::class)->findAll(); // all users

// UPDATE — just modify the object, then flush
$user = $em->find(User::class, 1);
$user->setName('Alice Updated');
$em->flush(); // Doctrine detects change, issues UPDATE automatically

// DELETE
$user = $em->find(User::class, 1);
$em->remove($user);
$em->flush();
```

### Repository Pattern with Doctrine

```php
use Doctrine\ORM\EntityRepository;
use Doctrine\ORM\QueryBuilder;

class UserRepository extends EntityRepository {
    public function findActiveUsers(): array {
        return $this->findBy(['active' => true], ['createdAt' => 'DESC']);
    }

    public function findByEmailDomain(string $domain): array {
        return $this->createQueryBuilder('u')
            ->where('u.email LIKE :domain')
            ->setParameter('domain', "%@{$domain}")
            ->orderBy('u.name', 'ASC')
            ->getQuery()
            ->getResult();
    }

    public function countActiveUsers(): int {
        return (int) $this->createQueryBuilder('u')
            ->select('COUNT(u.id)')
            ->where('u.active = true')
            ->getQuery()
            ->getSingleScalarResult();
    }

    public function findWithOrders(): array {
        return $this->createQueryBuilder('u')
            ->leftJoin('u.orders', 'o')
            ->addSelect('o')   // eager load orders in one query
            ->where('SIZE(u.orders) > 0')
            ->getQuery()
            ->getResult();
    }
}
```

---

## d. Query Builder

The Query Builder creates SQL programmatically — type-safe, composable, and database-agnostic.

### DQL (Doctrine Query Language) vs SQL

DQL works on **entity objects**, not tables. SQL works on tables directly.

```php
// DQL — references entity class and property names
$dql   = 'SELECT u FROM App\Entity\User u WHERE u.email = :email';

// SQL — references table and column names
$sql   = 'SELECT * FROM users WHERE email = :email';
```

### Query Builder Examples

```php
$qb = $em->createQueryBuilder();

// SELECT with conditions
$users = $qb
    ->select('u')
    ->from(User::class, 'u')
    ->where('u.active = :active')
    ->andWhere('u.createdAt > :date')
    ->setParameter('active', true)
    ->setParameter('date', new \DateTime('-30 days'))
    ->orderBy('u.name', 'ASC')
    ->setMaxResults(20)
    ->setFirstResult(0)     // offset for pagination
    ->getQuery()
    ->getResult();

// COUNT
$count = $qb
    ->select('COUNT(u.id)')
    ->from(User::class, 'u')
    ->where('u.active = true')
    ->getQuery()
    ->getSingleScalarResult();

// JOIN
$results = $qb
    ->select('u, o')
    ->from(User::class, 'u')
    ->innerJoin('u.orders', 'o')
    ->where('o.total > :min')
    ->setParameter('min', 100)
    ->getQuery()
    ->getResult();

// UPDATE (bulk)
$em->createQueryBuilder()
   ->update(User::class, 'u')
   ->set('u.active', ':active')
   ->where('u.lastLogin < :date')
   ->setParameter('active', false)
   ->setParameter('date', new \DateTime('-1 year'))
   ->getQuery()
   ->execute();

// DELETE (bulk)
$em->createQueryBuilder()
   ->delete(User::class, 'u')
   ->where('u.createdAt < :date')
   ->setParameter('date', new \DateTime('-5 years'))
   ->getQuery()
   ->execute();
```

### Aggregations and Grouping

```php
$stats = $em->createQueryBuilder()
    ->select('u.role, COUNT(u.id) AS userCount, AVG(o.total) AS avgOrder')
    ->from(User::class, 'u')
    ->leftJoin('u.orders', 'o')
    ->groupBy('u.role')
    ->having('COUNT(u.id) > :min')
    ->setParameter('min', 5)
    ->getQuery()
    ->getResult();
```

---

## e. Doctrine Migrations

Migrations version-control your database schema. Instead of manually running ALTER TABLE commands, you write migration classes that can be run, rolled back, and tracked.

### Setup

```php
// migrations.php (or doctrine-migrations.php)
use Doctrine\Migrations\Configuration\EntityManager\ExistingEntityManager;
use Doctrine\Migrations\Configuration\Migration\PhpFile;
use Doctrine\Migrations\DependencyFactory;

$config = new PhpFile('migrations-config.php');
return DependencyFactory::fromEntityManager($config, new ExistingEntityManager($em));
```

```php
// migrations-config.php
return [
    'table_storage' => [
        'table_name'                 => 'doctrine_migration_versions',
        'version_column_name'        => 'version',
        'version_column_length'      => 191,
        'executed_at_column_name'    => 'executed_at',
        'execution_time_column_name' => 'execution_time',
    ],
    'migrations_paths' => [
        'App\Migrations' => __DIR__ . '/migrations',
    ],
    'all_or_nothing'          => true,
    'transactional'           => true,
    'check_database_platform' => true,
    'organize_migrations'     => 'none',
];
```

### Creating and Running Migrations

```bash
# Generate migration from diff between entities and DB schema
vendor/bin/doctrine-migrations diff

# Create blank migration
vendor/bin/doctrine-migrations generate

# Run all pending migrations
vendor/bin/doctrine-migrations migrate

# Rollback last migration
vendor/bin/doctrine-migrations migrate prev

# Show migration status
vendor/bin/doctrine-migrations status

# List all migrations
vendor/bin/doctrine-migrations list
```

### Migration Class

```php
<?php
// migrations/Version20260306100000.php
namespace App\Migrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20260306100000 extends AbstractMigration {
    public function getDescription(): string {
        return 'Create users and orders tables';
    }

    // Applied when running forward (migrate)
    public function up(Schema $schema): void {
        $users = $schema->createTable('users');
        $users->addColumn('id',         'integer', ['autoincrement' => true]);
        $users->addColumn('name',       'string',  ['length' => 100]);
        $users->addColumn('email',      'string',  ['length' => 255]);
        $users->addColumn('active',     'boolean', ['default' => true]);
        $users->addColumn('created_at', 'datetime');
        $users->setPrimaryKey(['id']);
        $users->addUniqueIndex(['email']);

        $orders = $schema->createTable('orders');
        $orders->addColumn('id',      'integer', ['autoincrement' => true]);
        $orders->addColumn('user_id', 'integer');
        $orders->addColumn('total',   'decimal',  ['precision' => 10, 'scale' => 2]);
        $orders->addColumn('status',  'string',   ['length' => 20]);
        $orders->setPrimaryKey(['id']);
        $orders->addForeignKeyConstraint('users', ['user_id'], ['id']);
    }

    // Applied when rolling back (migrate prev)
    public function down(Schema $schema): void {
        $schema->dropTable('orders');
        $schema->dropTable('users');
    }
}
```

---

## Pros and Cons of Doctrine ORM

### Pros
- **Productivity** — work with PHP objects, not raw SQL
- **Database portability** — switch from MySQL to PostgreSQL with minimal changes
- **Relationships made easy** — load related objects naturally (`$user->getOrders()`)
- **Change tracking** — Doctrine detects modified properties automatically
- **Migrations** — schema versioning built in
- **Repository pattern** — clean separation of persistence from business logic

### Cons
- **Learning curve** — configuration, entity mapping, DQL, Unit of Work all take time
- **Performance overhead** — ORM adds abstraction cost; complex queries may need raw SQL
- **N+1 query problem** — lazy loading can trigger hundreds of queries accidentally
- **Overhead for simple apps** — overkill for small scripts or simple CRUD
- **Magic** — Doctrine's proxies and lazy loading can be confusing to debug

---

## N+1 Query Problem and Fix

```php
// BAD — N+1 queries
$users = $em->getRepository(User::class)->findAll(); // 1 query

foreach ($users as $user) {
    // Each access triggers a separate SELECT for orders — N queries!
    echo $user->getOrders()->count();
}
// Result: 1 + N queries (101 queries for 100 users)

// GOOD — eager loading with JOIN
$users = $em->createQueryBuilder()
    ->select('u, o')           // select both
    ->from(User::class, 'u')
    ->leftJoin('u.orders', 'o')
    ->getQuery()
    ->getResult();
// Result: 1 query, all orders loaded
```

---

## Interview Q&A

**Q: What is the difference between Doctrine DBAL and ORM?**
A: DBAL is the low-level database layer — it abstracts PDO and lets you run SQL queries in a database-agnostic way. ORM sits on top of DBAL and maps PHP objects (Entities) to database tables — you persist/retrieve PHP objects and Doctrine generates SQL. Use DBAL for complex queries or when you want full SQL control; use ORM when you want to work with domain objects.

**Q: What is the Unit of Work in Doctrine?**
A: The Unit of Work tracks all entities managed by the EntityManager. When you call `flush()`, it compares the current state of entities to their original state (when loaded) and generates the minimal SQL needed — INSERTs for new, UPDATEs for changed, DELETEs for removed. This batches SQL and avoids redundant queries.

**Q: What is the N+1 query problem and how do you fix it?**
A: N+1 happens when you load a collection (1 query) and then access a related entity inside a loop (1 query per item = N queries). Fix it with eager loading — use `JOIN` in your query to fetch the related data in the same query. In Doctrine, use `leftJoin` + `addSelect` in the Query Builder.

**Q: What are Doctrine Migrations?**
A: Migrations are versioned PHP classes that describe schema changes (create table, add column, etc.) with an `up()` method (apply) and `down()` method (rollback). They're committed to version control so the whole team applies the same changes in the same order. This replaces manually writing ALTER TABLE commands across environments.
