# PHP Generators

## TL;DR
A **Generator** is a special function that can **pause execution and yield values one at a time** instead of computing and returning everything at once. Instead of building a huge array in memory, a generator produces values on demand — making it perfect for large datasets, infinite sequences, and lazy pipelines. They look like functions but behave like iterators.

---

## What Problem Do Generators Solve?

Without generators, reading a million rows from a database or a huge file loads everything into RAM at once:

```php
// BAD — loads ALL 1,000,000 rows into memory
function getAllUsers(): array {
    return DB::query('SELECT * FROM users'); // 500MB in RAM
}

foreach (getAllUsers() as $user) {
    process($user);
}
```

With a generator, only ONE item lives in memory at a time:

```php
// GOOD — yields one row at a time, uses almost no extra memory
function getUsersLazily(): Generator {
    $stmt = DB::query('SELECT * FROM users');
    while ($row = $stmt->fetch()) {
        yield $row; // pause here, give caller this row, resume on next iteration
    }
}

foreach (getUsersLazily() as $user) {
    process($user); // only one user in memory at a time
}
```

---

## How Generators Work

### The `yield` Keyword

`yield` is what makes a function a generator. When PHP sees `yield` in a function, the function returns a `Generator` object instead of running normally.

```php
function myGenerator(): Generator {
    echo "Start\n";
    yield 1;           // pause, return 1 to caller
    echo "After 1\n";
    yield 2;           // pause, return 2 to caller
    echo "After 2\n";
    yield 3;           // pause, return 3 to caller
    echo "End\n";
}

$gen = myGenerator(); // nothing runs yet — just creates Generator object

echo $gen->current(); // runs until first yield → prints "Start", returns 1
$gen->next();         // resumes → prints "After 1", pauses at yield 2
echo $gen->current(); // returns 2
$gen->next();         // resumes → prints "After 2", pauses at yield 3
echo $gen->current(); // returns 3
$gen->next();         // resumes → prints "End", generator done

// Or simply use foreach — it calls current()/next() automatically
foreach (myGenerator() as $value) {
    echo $value . "\n"; // 1, 2, 3
}
```

**Key insight:** The function body is frozen at `yield`. It only resumes when the caller asks for the next value.

---

## Generator Syntax

### 1. Simple yield

```php
function numbers(): Generator {
    yield 1;
    yield 2;
    yield 3;
}
```

### 2. yield with keys (like an associative array)

```php
function keyedData(): Generator {
    yield 'name'  => 'Alice';
    yield 'email' => 'alice@example.com';
    yield 'role'  => 'admin';
}

foreach (keyedData() as $key => $value) {
    echo "$key: $value\n";
    // name: Alice
    // email: alice@example.com
    // role: admin
}
```

### 3. yield from (delegation)

`yield from` delegates to another generator, array, or iterable:

```php
function inner(): Generator {
    yield 1;
    yield 2;
}

function outer(): Generator {
    yield 0;
    yield from inner();   // delegates to inner()
    yield from [3, 4, 5]; // delegates to array
    yield 6;
}

foreach (outer() as $v) {
    echo $v . " "; // 0 1 2 3 4 5 6
}
```

### 4. Sending values INTO a generator

Generators are two-way — you can send values back with `send()`:

```php
function accumulator(): Generator {
    $total = 0;
    while (true) {
        $value  = yield $total; // yield current total, receive new value
        $total += $value;
    }
}

$gen = accumulator();
$gen->current();       // initialize — $total = 0
$gen->send(10);        // sends 10 in, $total = 10
$gen->send(20);        // sends 20 in, $total = 30
echo $gen->current();  // 30
```

### 5. Generator return value

Generators can return a final value (accessed after the generator is exhausted):

```php
function countItems(): Generator {
    $count = 0;
    while (true) {
        $item = yield;
        if ($item === null) break;
        $count++;
    }
    return $count; // final return value
}

$gen = countItems();
$gen->current();
$gen->send('apple');
$gen->send('banana');
$gen->send('cherry');
$gen->send(null); // signal done

echo $gen->getReturn(); // 3
```

---

## Generator Interface (Methods)

```php
$gen = myGenerator();

$gen->current();    // get current yielded value
$gen->next();       // advance to next yield
$gen->key();        // get current yield key
$gen->send($value); // send a value in and advance
$gen->rewind();     // only works before first next() call
$gen->valid();      // false when generator is exhausted
$gen->getReturn();  // get the return value (after exhaustion)
```

---

## Generator vs Iterator vs Array

| Feature | Array | Iterator (class) | Generator (function) |
|---|---|---|---|
| Memory | All in RAM | Depends on impl | One item at a time |
| Syntax | Simple | Verbose (5 methods) | Simple (just yield) |
| Rewindable | Yes | Yes (if implemented) | No (one-pass only) |
| Send values in | No | No | Yes (send()) |
| Lazy evaluation | No | Yes | Yes |
| Use case | Small data | Reusable cursors | Large/infinite data |

### Generator vs Iterator class

An Iterator requires implementing 5 methods:

```php
// Iterator — verbose, 5 methods required
class RangeIterator implements Iterator {
    private int $current;
    public function __construct(private int $start, private int $end) {
        $this->current = $start;
    }
    public function current(): int  { return $this->current; }
    public function key(): int      { return $this->current - $this->start; }
    public function next(): void    { $this->current++; }
    public function rewind(): void  { $this->current = $this->start; }
    public function valid(): bool   { return $this->current <= $this->end; }
}

// Generator — same result, 3 lines
function range_gen(int $start, int $end): Generator {
    for ($i = $start; $i <= $end; $i++) {
        yield $i;
    }
}
```

---

## Real-World Examples

### Reading a Large File Line by Line

```php
function readLines(string $path): Generator {
    $file = fopen($path, 'r');
    try {
        while (!feof($file)) {
            yield fgets($file); // one line at a time — no memory spike
        }
    } finally {
        fclose($file); // always closes even if caller breaks early
    }
}

foreach (readLines('/var/log/nginx/access.log') as $line) {
    if (str_contains($line, '500')) {
        echo "Error: $line";
    }
}
```

### Infinite Sequences

```php
function fibonacci(): Generator {
    [$a, $b] = [0, 1];
    while (true) {
        yield $a;
        [$a, $b] = [$b, $a + $b];
    }
}

$fib = fibonacci();
for ($i = 0; $i < 10; $i++) {
    echo $fib->current() . " "; // 0 1 1 2 3 5 8 13 21 34
    $fib->next();
}
```

### Lazy Pipeline (CSV Processing)

```php
function readCsv(string $path): Generator {
    $file = fopen($path, 'r');
    $headers = fgetcsv($file);
    while ($row = fgetcsv($file)) {
        yield array_combine($headers, $row);
    }
    fclose($file);
}

function filterActive(Generator $rows): Generator {
    foreach ($rows as $row) {
        if ($row['status'] === 'active') {
            yield $row;
        }
    }
}

function transformToEmail(Generator $rows): Generator {
    foreach ($rows as $row) {
        yield strtolower($row['email']);
    }
}

// Lazy pipeline — processes one row at a time through all stages
$pipeline = transformToEmail(
    filterActive(
        readCsv('users.csv')
    )
);

foreach ($pipeline as $email) {
    sendNewsletter($email);
}
```

### Database Batch Processing

```php
function streamUsers(PDO $pdo): Generator {
    $stmt = $pdo->query('SELECT * FROM users ORDER BY id');
    $stmt->setFetchMode(PDO::FETCH_ASSOC);
    foreach ($stmt as $row) {
        yield $row;
    }
}

// Process 10 million users without memory issues
$memory_start = memory_get_usage();

foreach (streamUsers($pdo) as $user) {
    processUser($user);
}

echo "Memory used: " . (memory_get_usage() - $memory_start) . " bytes";
// ~thousands of bytes, not megabytes
```

---

## Pros and Cons

### Pros
- **Memory efficient** — O(1) memory regardless of dataset size
- **Simple syntax** — much less code than a full Iterator class
- **Lazy evaluation** — compute only what's needed, stop early if needed
- **Two-way communication** — `send()` lets you pass values in
- **Composable** — pipe generators into each other for lazy pipelines

### Cons
- **Not rewindable** — once exhausted, you can't iterate again (need to recreate)
- **Not countable** — can't call `count()` on a generator
- **Debugging complexity** — suspended state can be confusing to trace
- **Single-pass only** — can't seek to a position or go backwards
- **Return type** — always returns `Generator`, not your specific type

---

## Interview Q&A

**Q: What is a PHP Generator and how does it differ from a regular function?**
A: A generator is a function containing `yield`. When called, it returns a `Generator` object instead of executing immediately. The body runs lazily — it pauses at each `yield` and only resumes when the caller requests the next value. A regular function runs to completion and returns once. Generators are memory-efficient because they produce values one at a time.

**Q: What is the difference between a Generator and an Iterator?**
A: Both are iterable, but a Generator is created with a function and `yield` — much simpler syntax. An Iterator requires implementing 5 interface methods in a class. Generators can't be rewound after the first iteration; Iterators can implement `rewind()`. Use a Generator for simplicity and one-pass iteration; use an Iterator class when you need reusability or rewindability.

**Q: When would you use a generator?**
A: When processing large datasets (file lines, database rows, API pagination) where loading everything into memory is not feasible. Also for infinite sequences (Fibonacci, IDs), lazy evaluation pipelines, and anywhere you want to decouple production from consumption of data.

**Q: What does `yield from` do?**
A: It delegates to another generator, iterator, or array, yielding all its values in turn. It's used to compose generators and build pipelines without manually looping through the inner generator. The outer generator is effectively transparent to the caller during the delegation.
