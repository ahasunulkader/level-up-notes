# PHP File System

PHP provides a rich set of functions for reading, writing, and managing files and directories. Understanding the file system is essential for handling uploads, logs, exports, config files, and more.

---

## 1. Why File System Operations Matter

- **Config files** — reading `.env`, JSON or INI configs
- **File uploads** — profile pictures, documents, CSVs
- **Logging** — writing to log files
- **Reports/Exports** — generating CSV or PDF exports
- **Caching** — file-based cache
- **Data imports** — processing large CSV/XML feeds

**Files vs Database — when to use which:**
| Use Files When | Use Database When |
|----------------|-------------------|
| Data is large and binary (images, PDFs) | Data needs querying/filtering |
| Temporary scratch data | Data has relationships |
| Config/environment settings | Data needs transactions |
| Logs (append-only sequential) | Concurrent read/write access |

---

## 2. File Reading

### file_get_contents() — Simplest Approach

Reads the **entire file** into a string. Best for small to medium files.

```php
<?php
// Read entire file
$content = file_get_contents('/var/www/config.json');
$config = json_decode($content, true);

// Read remote URL (if allow_url_fopen is on)
$html = file_get_contents('https://example.com');

// With context options (timeout, headers)
$context = stream_context_create(['http' => ['timeout' => 5]]);
$data = file_get_contents('https://api.example.com/data', false, $context);

// Check for failure
if ($content === false) {
    throw new \RuntimeException('Could not read file');
}
```

### file() — Read Into Array of Lines

```php
<?php
$lines = file('data.txt', FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);

foreach ($lines as $lineNumber => $line) {
    echo "Line {$lineNumber}: {$line}\n";
}
```

### fopen() + fread() — Low-Level, For Large Files

```php
<?php
$handle = fopen('large-file.txt', 'r');

if ($handle === false) {
    throw new \RuntimeException('Cannot open file');
}

// Read fixed bytes
$chunk = fread($handle, 8192); // 8KB chunks

// Read line by line (memory efficient)
while (!feof($handle)) {
    $line = fgets($handle); // read one line
    processLine($line);
}

fclose($handle);
```

### fgetcsv() — Read CSV Line by Line

```php
<?php
$handle = fopen('products.csv', 'r');
$headers = fgetcsv($handle); // first row = headers

while (($row = fgetcsv($handle, 0, ',')) !== false) {
    $product = array_combine($headers, $row);
    importProduct($product);
}

fclose($handle);
```

---

## 3. File Writing

### file_put_contents() — Simplest Write

```php
<?php
// Write (overwrites existing content)
file_put_contents('output.txt', 'Hello World');

// Append to file
file_put_contents('app.log', "Error at " . date('Y-m-d H:i:s') . "\n", FILE_APPEND);

// Append with exclusive lock (safe for concurrent writes)
file_put_contents('app.log', $message, FILE_APPEND | LOCK_EX);

// Write array — each element becomes a line
$lines = ['Line 1', 'Line 2', 'Line 3'];
file_put_contents('output.txt', implode(PHP_EOL, $lines));

// Returns bytes written or false on failure
$bytes = file_put_contents('data.json', json_encode($data, JSON_PRETTY_PRINT));
if ($bytes === false) {
    throw new \RuntimeException('Failed to write file');
}
```

### fopen() + fwrite() — Manual Control

```php
<?php
$handle = fopen('report.csv', 'w');

// Write CSV headers
fputcsv($handle, ['ID', 'Name', 'Email', 'Total']);

// Write data rows
foreach ($orders as $order) {
    fputcsv($handle, [
        $order->id,
        $order->name,
        $order->email,
        $order->total,
    ]);
}

fclose($handle);
```

---

## 4. fopen() Modes — Complete Reference

| Mode | Description | Creates if Missing | Truncates | Position |
|------|-------------|-------------------|-----------|----------|
| `r` | Read only | No | No | Start |
| `r+` | Read + Write | No | No | Start |
| `w` | Write only | Yes | Yes (clears!) | Start |
| `w+` | Read + Write | Yes | Yes (clears!) | Start |
| `a` | Append only | Yes | No | End |
| `a+` | Read + Append | Yes | No | End |
| `x` | Write only, fail if exists | Creates new only | No | Start |
| `x+` | Read + Write, fail if exists | Creates new only | No | Start |
| `c` | Write, no truncate | Yes | No | Start |
| `c+` | Read + Write, no truncate | Yes | No | Start |
| `b` | Binary mode (add to any) | — | — | — |

```php
<?php
// Always use 'b' on Windows for binary files
$handle = fopen('image.png', 'rb');
$handle = fopen('download.zip', 'wb');

// 'x' is safe for unique file creation — fails if already exists
$handle = fopen('/tmp/lockfile', 'x');
```

---

## 5. File Position Functions

```php
<?php
$handle = fopen('data.bin', 'r+');

// Get current position
$pos = ftell($handle); // returns byte offset

// Move to position
fseek($handle, 100);         // move to byte 100
fseek($handle, -10, SEEK_END); // 10 bytes from end
fseek($handle, 5, SEEK_CUR);  // 5 bytes forward from current

// Reset to beginning
rewind($handle);

// Check end of file
while (!feof($handle)) {
    $line = fgets($handle);
}

fclose($handle);
```

---

## 6. File Information Functions

```php
<?php
$path = '/var/www/uploads/photo.jpg';

// Existence checks
file_exists($path);      // true for files AND directories
is_file($path);          // true only for regular files
is_dir($path);           // true only for directories
is_link($path);          // true for symlinks

// Permissions
is_readable($path);      // can PHP read it?
is_writable($path);      // can PHP write to it?
is_executable($path);    // can PHP execute it?

// File metadata
filesize($path);                     // size in bytes
filemtime($path);                    // last modified timestamp
fileatime($path);                    // last accessed timestamp
filectime($path);                    // last inode change timestamp
date('Y-m-d', filemtime($path));     // formatted date

// Path information
pathinfo($path);
// Returns: ['dirname'=>'/var/www/uploads', 'basename'=>'photo.jpg',
//           'extension'=>'jpg', 'filename'=>'photo']

pathinfo($path, PATHINFO_EXTENSION);  // 'jpg'
pathinfo($path, PATHINFO_FILENAME);   // 'photo'
pathinfo($path, PATHINFO_DIRNAME);    // '/var/www/uploads'

basename($path);          // 'photo.jpg'
dirname($path);           // '/var/www/uploads'
realpath($path);          // resolved absolute path (no ..)
```

**Real-life — validate before operating:**
```php
<?php
function safeReadFile(string $path): string
{
    if (!file_exists($path)) {
        throw new \RuntimeException("File not found: {$path}");
    }

    if (!is_readable($path)) {
        throw new \RuntimeException("File not readable: {$path}");
    }

    return file_get_contents($path);
}
```

---

## 7. File Operations (Copy, Move, Delete)

```php
<?php
// Copy
copy('source.txt', 'destination.txt');  // returns bool

// Move / Rename (works across directories)
rename('old-name.txt', 'new-name.txt');
rename('/tmp/upload.jpg', '/var/www/uploads/photo.jpg'); // move

// Delete
unlink('temp-file.txt');  // deletes the file

// Create symlink
symlink('/var/www/storage/uploads', '/var/www/public/uploads');

// Get temp file
$tmpFile = tempnam(sys_get_temp_dir(), 'myapp_');
file_put_contents($tmpFile, $data);
// ... use it ...
unlink($tmpFile); // clean up
```

---

## 8. Directory Functions

```php
<?php
// Create directory
mkdir('/var/www/uploads');
mkdir('/var/www/uploads/2024/01', 0755, true); // recursive

// Remove directory (must be empty!)
rmdir('/var/www/cache/old');

// List directory contents
$entries = scandir('/var/www/uploads');
// Returns: ['.', '..', 'file1.jpg', 'file2.pdf', ...]

// Filter out . and ..
$files = array_diff(scandir('/var/www/uploads'), ['.', '..']);

// opendir / readdir / closedir (manual iteration)
$dir = opendir('/var/www/uploads');
while (($entry = readdir($dir)) !== false) {
    if ($entry !== '.' && $entry !== '..') {
        echo $entry . "\n";
    }
}
closedir($dir);

// glob() — pattern matching
$phpFiles = glob('/var/www/src/*.php');
$allImages = glob('/var/www/uploads/*.{jpg,png,gif}', GLOB_BRACE);
$allDirs = glob('/var/www/*', GLOB_ONLYDIR);
```

**Real-life — list uploads with details:**
```php
<?php
function getUploadedFiles(string $dir): array
{
    return array_map(
        fn($file) => [
            'name'     => $file,
            'size'     => filesize("{$dir}/{$file}"),
            'modified' => filemtime("{$dir}/{$file}"),
            'ext'      => pathinfo($file, PATHINFO_EXTENSION),
        ],
        array_diff(scandir($dir), ['.', '..'])
    );
}
```

---

## 9. Recursive Directory Operations

```php
<?php
// RecursiveDirectoryIterator — traverse all nested files
$iterator = new RecursiveIteratorIterator(
    new RecursiveDirectoryIterator('/var/www/src', FilesystemIterator::SKIP_DOTS)
);

foreach ($iterator as $file) {
    if ($file->getExtension() === 'php') {
        echo $file->getPathname() . "\n";
    }
}

// Recursive delete (delete directory and all contents)
function deleteDirectory(string $dir): void
{
    if (!is_dir($dir)) return;

    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST // files before directories
    );

    foreach ($iterator as $item) {
        $item->isDir() ? rmdir($item->getPathname()) : unlink($item->getPathname());
    }

    rmdir($dir);
}

// Count files by extension
function countByExtension(string $dir): array
{
    $counts = [];
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS)
    );

    foreach ($iterator as $file) {
        if ($file->isFile()) {
            $ext = $file->getExtension();
            $counts[$ext] = ($counts[$ext] ?? 0) + 1;
        }
    }

    return $counts;
}
```

---

## 10. File Upload Handling

```php
<?php
// $_FILES structure for <input type="file" name="avatar">
// $_FILES['avatar'] = [
//   'name'     => 'photo.jpg',       // original filename
//   'type'     => 'image/jpeg',      // MIME (from browser — NOT TRUSTED)
//   'tmp_name' => '/tmp/phpXyz123',  // temp file on server
//   'error'    => 0,                 // UPLOAD_ERR_OK
//   'size'     => 204800,            // bytes
// ]

function handleUpload(array $file, string $destDir): string
{
    // 1. Check for upload errors
    if ($file['error'] !== UPLOAD_ERR_OK) {
        throw new \RuntimeException("Upload error code: {$file['error']}");
    }

    // 2. Validate file size (e.g., max 5MB)
    $maxBytes = 5 * 1024 * 1024;
    if ($file['size'] > $maxBytes) {
        throw new \RuntimeException('File too large');
    }

    // 3. Validate MIME type by CONTENT, not browser header
    $finfo = new \finfo(FILEINFO_MIME_TYPE);
    $mimeType = $finfo->file($file['tmp_name']);
    $allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
    if (!in_array($mimeType, $allowedTypes, true)) {
        throw new \RuntimeException('Invalid file type');
    }

    // 4. Generate safe filename (never use original name directly!)
    $ext = match($mimeType) {
        'image/jpeg' => 'jpg',
        'image/png'  => 'png',
        'image/gif'  => 'gif',
    };
    $filename = bin2hex(random_bytes(16)) . '.' . $ext;
    $destPath = rtrim($destDir, '/') . '/' . $filename;

    // 5. Move from temp location
    if (!move_uploaded_file($file['tmp_name'], $destPath)) {
        throw new \RuntimeException('Failed to move uploaded file');
    }

    return $filename;
}
```

**Upload error codes:**
| Constant | Value | Meaning |
|----------|-------|---------|
| `UPLOAD_ERR_OK` | 0 | No error |
| `UPLOAD_ERR_INI_SIZE` | 1 | Exceeds upload_max_filesize in php.ini |
| `UPLOAD_ERR_FORM_SIZE` | 2 | Exceeds MAX_FILE_SIZE in form |
| `UPLOAD_ERR_PARTIAL` | 3 | Only partially uploaded |
| `UPLOAD_ERR_NO_FILE` | 4 | No file submitted |
| `UPLOAD_ERR_NO_TMP_DIR` | 6 | No temp directory |
| `UPLOAD_ERR_CANT_WRITE` | 7 | Disk write failure |

---

## 11. File Locking

When multiple processes write to the same file, **race conditions** can corrupt data. `flock()` provides advisory file locking.

```php
<?php
// LOCK_SH — shared lock (multiple readers allowed)
// LOCK_EX — exclusive lock (one writer, blocks others)
// LOCK_UN — release lock
// LOCK_NB — non-blocking (fail instead of wait)

function appendToLog(string $message, string $logFile): void
{
    $handle = fopen($logFile, 'a');

    if (flock($handle, LOCK_EX)) {     // acquire exclusive lock
        fwrite($handle, $message . PHP_EOL);
        fflush($handle);               // flush before unlock
        flock($handle, LOCK_UN);       // release lock
    } else {
        throw new \RuntimeException('Could not lock log file');
    }

    fclose($handle);
}

// Non-blocking — try to lock, skip if busy
$handle = fopen('counter.txt', 'r+');
if (flock($handle, LOCK_EX | LOCK_NB)) {
    $count = (int) fread($handle, 20);
    rewind($handle);
    fwrite($handle, $count + 1);
    flock($handle, LOCK_UN);
} else {
    // Another process has the lock — skip this increment
}
fclose($handle);
```

> **Note:** `flock()` is advisory — it only works if ALL processes that access the file also use `flock()`. It doesn't prevent raw reads/writes.

---

## 12. SplFileObject (OOP Approach)

Modern PHP offers `SplFileObject` as an OOP wrapper around file operations.

```php
<?php
// Read file line by line
$file = new \SplFileObject('data.txt', 'r');
$file->setFlags(\SplFileObject::READ_AHEAD | \SplFileObject::SKIP_EMPTY);

foreach ($file as $line) {
    echo $line;
}

// Write file
$file = new \SplFileObject('output.csv', 'w');
$file->fputcsv(['ID', 'Name', 'Email']);
$file->fputcsv([1, 'Alice', 'alice@example.com']);

// Read CSV
$csv = new \SplFileObject('products.csv', 'r');
$csv->setFlags(\SplFileObject::READ_CSV);

foreach ($csv as $row) {
    print_r($row);
}
```

**SplFileObject vs fopen():**
| Feature | `fopen()` | `SplFileObject` |
|---------|-----------|-----------------|
| Style | Procedural | OOP |
| Iterator support | No | Yes — use in foreach |
| CSV built-in | `fgetcsv()` | `READ_CSV` flag |
| Memory | Same | Same |
| Preference | Legacy code | Modern PHP |

---

## 13. Performance Tips

```php
<?php
// BAD — loads entire file into memory
$content = file_get_contents('10gb-file.log');
$lines = explode("\n", $content); // crash!

// GOOD — stream line by line
$handle = fopen('10gb-file.log', 'r');
while (!feof($handle)) {
    $line = fgets($handle);
    processLine($line);
}
fclose($handle);

// BETTER — generator for memory-efficient lazy processing
function readLinesLazy(string $file): \Generator
{
    $handle = fopen($file, 'r');
    try {
        while (!feof($handle)) {
            yield fgets($handle);
        }
    } finally {
        fclose($handle); // always closes even if consumer throws
    }
}

foreach (readLinesLazy('huge.csv') as $line) {
    process($line);
}
```

---

## 14. Security Considerations

### Path Traversal Attack

```php
<?php
// ATTACK: user supplies filename = "../../etc/passwd"
$filename = $_GET['file'];
$content = file_get_contents('/var/www/docs/' . $filename);
// This could read /etc/passwd — very dangerous!

// FIX 1: Use basename() to strip directory components
$filename = basename($_GET['file']); // strips ../../ etc
$safePath = '/var/www/docs/' . $filename;

// FIX 2: Whitelist allowed files
$allowed = ['guide.pdf', 'manual.pdf', 'readme.txt'];
if (!in_array($_GET['file'], $allowed, true)) {
    abort(403);
}

// FIX 3: realpath() check — ensure resolved path is inside allowed dir
$baseDir = realpath('/var/www/docs');
$requested = realpath('/var/www/docs/' . $_GET['file']);

if ($requested === false || strpos($requested, $baseDir) !== 0) {
    abort(403, 'Invalid file');
}
```

### File Upload Security

```php
<?php
// NEVER trust client-supplied MIME type
$untrustedMime = $_FILES['file']['type']; // "image/jpeg" — attacker controls this!

// ALWAYS check by file content
$finfo = new \finfo(FILEINFO_MIME_TYPE);
$trustedMime = $finfo->file($_FILES['file']['tmp_name']); // reads file magic bytes

// NEVER use original filename directly
$dangerous = $_FILES['file']['name']; // could be "../../config.php"
$safe = bin2hex(random_bytes(16)) . '.' . $allowedExtension;

// Store uploads OUTSIDE web root
$uploadDir = '/var/www/storage/uploads/'; // not /var/www/public/uploads/

// Or block execution in upload dir with .htaccess
// Options -ExecCGI
// php_flag engine off
```

---

## Interview Q&A

**Q: What is the difference between `file_get_contents()` and `fopen()` + `fread()`?**
A: `file_get_contents()` reads the entire file into memory in one call — simple and fine for small files. `fopen()` + `fread()` gives you a file handle for fine-grained control — reading in chunks, seeking, appending — essential for large files where loading everything at once would exhaust memory.

**Q: What is the difference between `include` and `require`?**
A: Both load a file, but `require` throws a fatal error if the file is missing while `include` only emits a warning and continues.

**Q: How do you safely handle file uploads in PHP?**
A: Check `$_FILES['file']['error']`, validate file size, detect MIME type by file content using `finfo` (not the browser-supplied type), generate a random filename instead of using the original, and move with `move_uploaded_file()` to a directory outside the web root.

**Q: What is a path traversal attack and how do you prevent it?**
A: An attacker passes `../../etc/passwd` as a filename to escape the intended directory. Prevent it by using `basename()` to strip directory components, using a whitelist of allowed filenames, or using `realpath()` to verify the resolved path still starts with the allowed base directory.

**Q: What is `flock()` and when do you need it?**
A: `flock()` provides advisory file locking to prevent race conditions when multiple processes access the same file. `LOCK_EX` gives an exclusive write lock, `LOCK_SH` a shared read lock. You need it for log files, counters, or any file written by concurrent processes.

**Q: What is the difference between `file_exists()` and `is_file()`?**
A: `file_exists()` returns true for both files AND directories. `is_file()` returns true only for regular files, not directories. Use `is_file()` when you specifically need a file, not a directory.

**Q: How do you process a large CSV file in PHP without running out of memory?**
A: Stream it line by line using `fopen()` + `fgetcsv()` in a `while` loop instead of loading the whole file. Even better — use a generator function that `yield`s each row, so the caller controls consumption and only one row exists in memory at a time.

**Q: What does `move_uploaded_file()` do and why use it instead of `rename()`?**
A: `move_uploaded_file()` is specifically designed for uploaded files — it validates that the file was actually uploaded via HTTP POST (not a local file path injection trick), then moves it from the temp location. `rename()` has no such security check.
