# PHP Basics

PHP (Hypertext Preprocessor) is a widely-used server-side scripting language for web development.

## Variables

PHP variables start with a `$` sign. No type declaration is needed.

```php
$name = "John";
$age = 25;
$price = 19.99;
$isActive = true;
```

## Data Types

PHP supports several data types:

| Type | Example | Description |
|------|---------|-------------|
| String | `"Hello"` | Text values |
| Integer | `42` | Whole numbers |
| Float | `3.14` | Decimal numbers |
| Boolean | `true` / `false` | True or false |
| Array | `[1, 2, 3]` | Collection of values |
| NULL | `null` | No value |

## Echo vs Print

Both output data, but there are differences:

```php
echo "Hello";    // Faster, no return value
print "Hello";   // Returns 1, slightly slower
```

> **Tip:** Use `echo` in most cases — it's faster and can take multiple parameters.

## Arrays

PHP supports three types of arrays:

### Indexed Arrays

```php
$fruits = ["Apple", "Banana", "Cherry"];
echo $fruits[0]; // Apple
```

### Associative Arrays

```php
$person = [
    "name" => "John",
    "age" => 25,
    "city" => "Dhaka"
];
echo $person["name"]; // John
```

### Useful Array Functions

```php
count($array);          // Count elements
array_push($arr, "new"); // Add to end
array_merge($a, $b);    // Merge arrays
in_array("value", $arr); // Check if exists
sort($array);            // Sort array
```

## Superglobals

Special variables available in all scopes:

- `$_GET` — Data from URL parameters
- `$_POST` — Data from form submissions
- `$_SESSION` — Session data (persists across pages)
- `$_COOKIE` — Cookie data
- `$_SERVER` — Server and execution info
- `$_FILES` — Uploaded file information

## PDO (Database Access)

PDO is the modern, secure way to work with databases:

```php
// Connect
$pdo = new PDO("mysql:host=localhost;dbname=mydb", "user", "pass");

// Query with prepared statement (prevents SQL injection)
$stmt = $pdo->prepare("SELECT * FROM users WHERE id = ?");
$stmt->execute([1]);
$user = $stmt->fetch();
```

> **Important:** Always use prepared statements to prevent SQL injection attacks.

## Useful String Functions

```php
strlen("Hello");           // 5
strtoupper("hello");       // HELLO
strtolower("HELLO");       // hello
str_replace("old", "new", $str); // Replace text
trim("  hello  ");         // "hello"
explode(",", "a,b,c");    // ["a", "b", "c"]
implode(",", $array);      // "a,b,c"
```
