# PHP Arrays

In PHP, an **array is an ordered map** — a data structure that maps **keys to values**. Unlike arrays in many other languages, PHP arrays are flexible: they can act as lists, hash maps, dictionaries, stacks, and queues all at once.

**Core characteristics:**
- Keys can be **integers or strings only**
- Values can be **any type**: scalar, array, object, null, closure
- Insertion **order is preserved**
- Mixed key types are allowed in the same array

---

## 1. Key Type Coercion

PHP silently coerces keys to their canonical form:

```php
<?php
$a = [
    true    => 'bool true',   // key becomes 1
    false   => 'bool false',  // key becomes 0
    null    => 'null key',    // key becomes ""
    1.9     => 'float',       // key becomes 1 (decimal dropped)
    "8"     => 'numeric str', // key becomes 8 (numeric strings cast to int)
    "08"    => 'leading zero',// key stays "08" (not purely numeric)
];

// Duplicate coercion — only one entry remains
$b = ["1" => 'string one', 1 => 'int one']; // count = 1, int wins
```

---

## 2. Indexed Arrays

Use automatic or explicit integer keys starting from 0.

```php
<?php
$fruits = ['apple', 'banana', 'cherry'];  // short syntax (preferred)
$fruits = array('apple', 'banana', 'cherry'); // long syntax

// Append
$fruits[] = 'date'; // auto key = 3

// Access
echo $fruits[0];                          // apple
echo $fruits[array_key_last($fruits)];    // last element (PHP 7.3+)

// Modify
$fruits[1] = 'blueberry';
```

### PHP Has No Negative Index Support

```php
<?php
$arr = ['a', 'b', 'c'];

echo $arr[-1] ?? 'undefined'; // "undefined" — -1 is just another integer key

// Correct ways to get last element:
echo end($arr);                    // c
echo $arr[array_key_last($arr)];   // c
echo $arr[count($arr) - 1];        // c (only for 0-indexed, no gaps)
```

### Auto Key Behavior

```php
<?php
$a = [];
$a[5] = 'five';
$a[]  = 'six';    // key becomes 6 (max + 1)
$a[2] = 'two';
$a[]  = 'seven';  // key becomes 7 (max + 1 = 6+1)

// keys: 5, 6, 2, 7
```

---

## 3. Associative Arrays

Use meaningful string keys instead of numeric indices.

```php
<?php
$user = [
    'id'     => 42,
    'name'   => 'Alice Johnson',
    'email'  => 'alice@example.com',
    'role'   => 'admin',
    'active' => true,
];

// Access, modify, add, delete
echo $user['name'];             // Alice Johnson
$user['role'] = 'superadmin';   // modify
$user['created_at'] = '2024-01-15'; // new key
unset($user['email']);           // delete
```

**Real-life uses:** config arrays, API responses, HTTP headers, form data.

### isset() vs array_key_exists() — Critical Difference

```php
<?php
$data = [
    'name'  => 'Alice',
    'score' => null,     // key EXISTS but value is null
    'count' => 0,
];

// isset() returns false if missing OR value is null
var_dump(isset($data['score']));             // false — null is treated as "not set"!
var_dump(isset($data['nonexistent']));       // false

// array_key_exists() only checks if key is present
var_dump(array_key_exists('score', $data));  // true — key physically exists!
var_dump(array_key_exists('nonexistent', $data)); // false
```

> **Rule:** Use `isset()` when null is not a valid value. Use `array_key_exists()` when null IS a valid value.

---

## 4. Multidimensional Arrays

```php
<?php
// 2D — simulating DB rows
$users = [
    ['id' => 1, 'name' => 'Alice', 'role' => 'admin'],
    ['id' => 2, 'name' => 'Bob',   'role' => 'editor'],
];

echo $users[0]['name']; // Alice

// Shopping cart
$cart = [
    ['product_id' => 101, 'name' => 'Wireless Mouse', 'price' => 29.99, 'qty' => 2],
    ['product_id' => 205, 'name' => 'USB-C Hub',       'price' => 49.99, 'qty' => 1],
];

$total = 0;
foreach ($cart as $item) {
    $total += $item['price'] * $item['qty'];
}
echo number_format($total, 2); // 109.97

// Safe nested access
$country = $company['departments']['hr']['head'] ?? 'No HR dept';
```

---

## 5. Array Creation Methods

```php
<?php
// range() — generate sequences
$digits    = range(0, 9);         // [0,1,...,9]
$evens     = range(0, 10, 2);     // [0,2,4,6,8,10]
$alphabet  = range('a', 'z');     // ['a','b',...,'z']

// array_fill() — fill with a value
$zeros    = array_fill(0, 5, 0);  // [0,0,0,0,0]
$week     = array_fill(0, 7, ['open' => false]);

// array_fill_keys() — fill with specific keys
$keys = ['name', 'email', 'phone'];
$form = array_fill_keys($keys, '');  // ['name'=>'', 'email'=>'', 'phone'=>'']

// array_combine() — pair two arrays as keys/values
$headers = ['product', 'price', 'qty'];
$row     = ['Widget', 9.99, 100];
$record  = array_combine($headers, $row);
// ['product'=>'Widget', 'price'=>9.99, 'qty'=>100]
```

---

## 6. Array Manipulation Functions

### Stack & Queue Operations

```php
<?php
$stack = ['a', 'b', 'c'];

array_push($stack, 'd', 'e'); // add to end
$stack[] = 'f';               // same, single item

$last  = array_pop($stack);   // remove and return last
$first = array_shift($stack); // remove and return first (re-indexes!)
array_unshift($stack, 'z');   // prepend (re-indexes!)
```

### array_splice() — Remove/Insert

```php
<?php
$letters = ['a', 'b', 'c', 'd', 'e'];

// Remove 2 elements at index 1
$removed = array_splice($letters, 1, 2);
// $removed = ['b','c'], $letters = ['a','d','e']

// Insert without removing (length = 0)
array_splice($letters, 1, 0, ['X', 'Y']);
// ['a','X','Y','d','e']
```

### array_slice() — Extract a Portion (Non-Destructive)

```php
<?php
$items = ['a', 'b', 'c', 'd', 'e'];
$slice = array_slice($items, 1, 3); // ['b','c','d'] — $items unchanged

// Real-life: pagination
$page   = 2;
$perPage = 10;
$rows = array_slice($allRows, ($page - 1) * $perPage, $perPage);
```

### array_merge vs + Operator — Critical Difference

```php
<?php
$defaults = ['color' => 'red', 'size' => 'M', 'qty' => 1];
$custom   = ['color' => 'blue', 'qty' => 3, 'label' => 'sale'];

// array_merge: RIGHT side wins on duplicate string keys
$result = array_merge($defaults, $custom);
// ['color'=>'blue', 'size'=>'M', 'qty'=>3, 'label'=>'sale']

// + operator: LEFT side wins — does NOT overwrite
$result = $defaults + $custom;
// ['color'=>'red', 'size'=>'M', 'qty'=>1, 'label'=>'sale']

// With numeric keys — array_merge RE-INDEXES
$a = [0 => 'x', 1 => 'y'];
$b = [0 => 'a', 1 => 'b'];
print_r(array_merge($a, $b)); // [0=>'x', 1=>'y', 2=>'a', 3=>'b']
print_r($a + $b);             // [0=>'x', 1=>'y'] — left wins, nothing added

// Real-life: user config overrides defaults
$config = array_merge($defaults, $userConfig);
```

### compact() and extract()

```php
<?php
// compact() — create array from variable names
$name  = 'Alice';
$age   = 30;
$email = 'alice@example.com';

$user = compact('name', 'age', 'email');
// ['name'=>'Alice', 'age'=>30, 'email'=>'alice@example.com']

// extract() — create variables from array keys
$config = ['host' => 'localhost', 'port' => 3306];
extract($config);
echo $host; // localhost

// WARNING: NEVER use extract() on untrusted input!
// extract($_POST) can overwrite any variable in scope — security risk!
```

---

## 7. Searching Arrays

```php
<?php
$roles = ['admin', 'editor', 'viewer'];

// in_array() — always use strict mode (3rd arg)
in_array('editor', $roles);        // true (loose)
in_array('editor', $roles, true);  // true (strict — checks type too)
in_array('1', [1, 2], true);       // false — '1' !== 1

// array_search() — returns key of first match (or false)
$key = array_search('editor', $roles); // 1
if ($key !== false) { // MUST use !== not !=
    echo "Found at: $key";
}

// array_keys() — get all keys, or keys matching a value
array_keys($user);               // ['id', 'name', 'email']
array_keys($scores, 'admin');    // keys where value = 'admin'

// array_values() — re-index to 0-based integers
$active = array_values(array_filter($users, fn($u) => $u['active']));
```

---

## 8. Sorting Arrays

| Function | Sorts By | Keys After |
|----------|----------|-----------|
| `sort()` | value ASC | Re-indexed |
| `rsort()` | value DESC | Re-indexed |
| `asort()` | value ASC | Preserved |
| `arsort()` | value DESC | Preserved |
| `ksort()` | key ASC | Preserved |
| `krsort()` | key DESC | Preserved |
| `usort()` | custom (value) | Re-indexed |
| `uasort()` | custom (value) | Preserved |
| `uksort()` | custom (key) | Preserved |

```php
<?php
$products = [
    ['name' => 'Laptop',   'price' => 999, 'rating' => 4.5],
    ['name' => 'Mouse',    'price' => 29,  'rating' => 4.8],
    ['name' => 'Monitor',  'price' => 399, 'rating' => 4.2],
];

// Sort by price ascending
usort($products, fn($a, $b) => $a['price'] <=> $b['price']);

// Multi-column sort: rating DESC, then name ASC on tie
usort($products, function ($a, $b) {
    if ($b['rating'] !== $a['rating']) {
        return $b['rating'] <=> $a['rating'];
    }
    return $a['name'] <=> $b['name'];
});

// array_column + array_multisort
$dept   = array_column($data, 'dept');
$salary = array_column($data, 'salary');
array_multisort($dept, SORT_ASC, $salary, SORT_DESC, $data);
```

---

## 9. Array Transformation Functions

### array_map() — Transform Each Element

Returns a **new array** — does not modify the original.

```php
<?php
$numbers = [1, 2, 3, 4, 5];

$squares = array_map(fn($n) => $n ** 2, $numbers); // [1,4,9,16,25]
$clean   = array_map('trim', ['  Alice  ', ' bob@test.com ']); // ['Alice','bob@test.com']

// Real-life: extract a column from records
$names = array_map(fn($u) => $u['name'], $users); // ['Alice', 'Bob']

// Multiple arrays — zip behavior
$sums = array_map(fn($x, $y) => $x + $y, [1,2,3], [10,20,30]); // [11,22,33]
```

### array_filter() — Filter Elements (Keys Preserved!)

```php
<?php
$numbers = [1, 2, 3, 4, 5, 6, 7, 8];

$evens = array_filter($numbers, fn($n) => $n % 2 === 0);
// [1=>2, 3=>4, 5=>6, 7=>8] — KEYS PRESERVED — gaps in keys!

$evens = array_values($evens); // [2,4,6,8] — reindexed

// No callback — removes falsy values (null, false, 0, '', [], '0')
$clean = array_filter([0, 1, '', 'hello', null, false]);
// [1=>1, 3=>'hello']

// Real-life: active users + remove empty form fields
$active = array_values(array_filter($users, fn($u) => $u['active']));
$filled = array_filter($form, fn($v) => $v !== '' && $v !== null);
```

### array_reduce() — Fold to Single Value

```php
<?php
$numbers = [1, 2, 3, 4, 5];

$sum     = array_reduce($numbers, fn($carry, $n) => $carry + $n, 0);   // 15
$product = array_reduce($numbers, fn($carry, $n) => $carry * $n, 1);  // 120

// Real-life: cart total
$total = array_reduce($cart, fn($carry, $item) => $carry + ($item['price'] * $item['qty']), 0.0);

// Real-life: build lookup map (id => name)
$lookup = array_reduce($users, function ($carry, $user) {
    $carry[$user['id']] = $user['name'];
    return $carry;
}, []);
// [1=>'Alice', 2=>'Bob', 3=>'Carol']
```

### array_walk() — Modify In Place

```php
<?php
$prices = ['apple' => 1.50, 'banana' => 0.75];

// Modify each value in place (pass by reference)
array_walk($prices, function (&$price, $key) {
    $price = round($price * 0.9, 2); // 10% discount
});

// With extra data (3rd argument)
array_walk($prices, fn(&$price, $key, $taxRate) => $price *= (1 + $taxRate), 0.08);
```

---

## 10. Array Math & Aggregation

```php
<?php
$numbers = [2, 3, 4, 5];

count($numbers)           // 4
array_sum($numbers)       // 14
array_product($numbers)   // 120
count($matrix, COUNT_RECURSIVE) // counts all nested elements

// Average
$average = array_sum($scores) / count($scores);

// array_unique — remove duplicates (keys preserved, first occurrence kept)
$tags   = ['php', 'laravel', 'php', 'mysql'];
$unique = array_values(array_unique($tags)); // ['php', 'laravel', 'mysql']

// array_flip — swap keys and values
$roles   = ['admin' => 1, 'editor' => 2];
$flipped = array_flip($roles); // [1=>'admin', 2=>'editor']

// O(1) lookup pattern using flip
$allowed = array_flip(['read', 'write', 'delete']);
if (isset($allowed[$permission])) { // O(1) vs O(n) in_array
    // granted
}

// array_chunk — split into batches
$batches = array_chunk($emails, 500);
foreach ($batches as $batch) { sendEmailBatch($batch); }

// array_column — extract a column from 2D array
$names = array_column($users, 'name');            // ['Alice', 'Bob']
$byId  = array_column($users, 'name', 'id');      // [1=>'Alice', 2=>'Bob']
$index = array_column($users, null, 'id');         // rows indexed by id
```

---

## 11. Array Unpacking & Spread Operator

### Destructuring with []

```php
<?php
$coords = [10, 20, 30];
[$x, $y, $z] = $coords;
echo "$x, $y, $z"; // 10, 20, 30

// Skip elements
[, $second, , $fourth] = [1, 2, 3, 4];

// Associative destructuring (PHP 7.1+)
$user = ['id' => 1, 'name' => 'Alice', 'role' => 'admin'];
['name' => $name, 'role' => $role] = $user;

// In foreach
foreach ($people as ['first' => $first, 'last' => $last]) {
    echo "$first $last\n";
}

// Swap variables
[$a, $b] = [$b, $a];
```

### Spread Operator

```php
<?php
// Unpack array as function arguments
function sum(int $a, int $b, int $c): int { return $a + $b + $c; }
$args = [1, 2, 3];
echo sum(...$args); // 6

// Merge arrays
$first  = [1, 2, 3];
$second = [4, 5, 6];
$merged = [...$first, ...$second]; // [1,2,3,4,5,6]

// String keys — PHP 8.1+ (right wins on duplicate keys)
$config = [...$defaults, ...$overrides];
```

---

## 12. Array Difference & Intersection

```php
<?php
$a = ['apple', 'banana', 'cherry', 'date'];
$b = ['banana', 'date', 'elderberry'];

// array_diff — values in $a NOT in $b
$diff = array_diff($a, $b); // [0=>'apple', 2=>'cherry']

// array_diff_key — keys in $a NOT in $b (values ignored)
$diff = array_diff_key($config1, $config2);

// array_diff_assoc — both key AND value must match to be excluded
$diff = array_diff_assoc($a, $b);

// array_intersect — values in BOTH
$common = array_intersect($a, $b); // ['banana', 'cherry']

// Real-life: permission checks
$userPerms     = ['read', 'write', 'delete', 'export'];
$requiredPerms = ['write', 'delete', 'publish'];

$granted = array_intersect($requiredPerms, $userPerms); // ['write', 'delete']
$missing = array_diff($requiredPerms, $userPerms);      // ['publish']

if (empty($missing)) {
    echo 'Access granted';
} else {
    echo 'Missing: ' . implode(', ', $missing);
}
```

---

## 13. isset() vs array_key_exists() vs empty()

| Expression | Key missing | Key exists, value = `null` | value = `0` | value = `''` |
|-----------|------------|--------------------------|------------|-------------|
| `isset($arr['key'])` | `false` | `false` | `true` | `true` |
| `array_key_exists('key', $arr)` | `false` | `true` | `true` | `true` |
| `empty($arr['key'])` | `true` | `true` | `true` | `true` |

```php
<?php
$data = ['score' => null, 'count' => 0, 'name' => 'Alice'];

isset($data['score']);             // false — null is "not set"
array_key_exists('score', $data); // true  — key exists!

isset($data['count']);             // true  — 0 is not null
empty($data['count']);             // true  — 0 is "empty"

// When to use which:
// isset()           — null is not a valid value; also fastest (language construct)
// array_key_exists()— null IS a valid value
// empty()           — treat 0, '', null, false, [] all as "not provided"
```

---

## 14. Memory and Performance

PHP arrays are implemented as **ordered hash tables** in the Zend engine:

| Operation | Complexity |
|-----------|-----------|
| `$arr['key']` read | O(1) average |
| `$arr[] = val` append | O(1) amortized |
| `in_array()` | O(n) — linear scan |
| `isset($arr['key'])` | O(1) — hash lookup |
| `sort()` | O(n log n) |

### Copy-on-Write

PHP arrays use **copy-on-write** — assignment doesn't copy the data until one copy is modified. Read-only passes are free.

```php
<?php
$big = range(1, 100000);
$copy = $big;        // no copy yet — shares internal structure
$copy[] = 100001;    // COPY happens HERE — only when modified

// Avoid copy with reference
function process(array &$arr): void { sort($arr); } // no copy
```

### Performance Pitfalls

```php
<?php
// BAD — array_merge() in a loop is O(n²)
$result = [];
foreach ($rows as $row) {
    $result = array_merge($result, $row); // new array every iteration!
}

// GOOD — append directly
foreach ($rows as $row) {
    foreach ($row as $item) {
        $result[] = $item; // O(1) per item
    }
}

// BAD — in_array() for repeated lookups
foreach ($ids as $id) {
    if (in_array($id, $bigList)) { ... } // O(n) each time
}

// GOOD — flip once, then O(1) lookups
$lookup = array_flip($bigList);
foreach ($ids as $id) {
    if (isset($lookup[$id])) { ... } // O(1)
}
```

---

## Interview Q&A

**Q: What is the difference between `array_merge()` and `+`?**
A: `array_merge()` — right side wins on duplicate string keys, numeric keys are re-indexed (appended). `+` — left side wins on duplicate keys, numeric keys NOT re-indexed. Use `array_merge()` when you want overrides; use `+` for "fill in missing defaults."

**Q: Why does `isset()` return false for a key that exists?**
A: Because the value at that key is `null`. `isset()` returns false when missing OR when value is null. Use `array_key_exists()` when null is a valid value.

**Q: Does `array_filter()` preserve keys?**
A: Yes — always. After filtering, keys may be non-contiguous. Call `array_values()` on the result to reset to 0-based sequential keys.

**Q: What is the difference between `sort()` and `asort()`?**
A: `sort()` sorts values ascending and **resets all keys** to 0-based integers (original keys lost). `asort()` sorts values ascending but **preserves key-value associations**. Use `asort()` whenever keys carry meaning.

**Q: What is copy-on-write in PHP arrays?**
A: Assigning an array to a new variable or passing by value does NOT copy the data immediately — both share the same internal structure. A copy only happens when one of them is modified. This makes read-only operations on large arrays memory-efficient.

**Q: How do you efficiently check if a value exists in a large array repeatedly?**
A: `in_array()` is O(n) — slow for repeated lookups. Instead, `array_flip()` the array once (values become keys), then use `isset()` which is O(1) hash lookup.

**Q: What happens when you `unset()` an element from an indexed array?**
A: The element is removed but remaining keys are NOT reindexed — the array develops a gap. Use `array_values()` after `unset()` to get a clean 0-based array.

**Q: What does `array_column()` do?**
A: Extracts a single column of values from a multidimensional array, optionally indexed by another column. `array_column($users, 'name', 'id')` returns `[1=>'Alice', 2=>'Bob']`.

**Q: When would you use `array_reduce()` over a `foreach`?**
A: `array_reduce()` is better for functional, expression-based aggregations (sum, building a lookup map) — avoids mutable state, more expressive. `foreach` is faster for complex or performance-critical logic due to lower function-call overhead per iteration.
