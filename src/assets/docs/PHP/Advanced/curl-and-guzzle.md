# PHP cURL & Guzzle — HTTP Clients

## TL;DR
**cURL** is PHP's built-in library for making HTTP requests — powerful but verbose with a procedural API. **Guzzle** is a modern PSR-7 compliant HTTP client built on top of cURL — cleaner syntax, middleware support, async requests, and better error handling. Use Guzzle for any real application; use raw cURL only when you can't install Composer packages.

---

## Part 1: PHP cURL

### What is cURL?

cURL (Client URL) is a library for transferring data with URLs — GET, POST, PUT, DELETE, file upload, authentication, cookies, SSL. It's built into PHP (`ext-curl` extension).

### Basic GET Request

```php
// Initialize
$ch = curl_init();

// Set options
curl_setopt($ch, CURLOPT_URL,            'https://jsonplaceholder.typicode.com/users/1');
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);  // return response as string (not print)
curl_setopt($ch, CURLOPT_TIMEOUT,        30);     // timeout in seconds
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);   // follow redirects
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);   // verify SSL certificate

// Execute
$response = curl_exec($ch);

// Check for errors
if (curl_errno($ch)) {
    throw new \RuntimeException('cURL error: ' . curl_error($ch));
}

// Get status code
$statusCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);

// Close
curl_close($ch);

// Decode
$data = json_decode($response, true);
echo $data['name']; // Leanne Graham
```

### POST Request (JSON)

```php
$payload = json_encode([
    'title'  => 'New Post',
    'body'   => 'Post content here',
    'userId' => 1,
]);

$ch = curl_init('https://jsonplaceholder.typicode.com/posts');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => $payload,
    CURLOPT_HTTPHEADER     => [
        'Content-Type: application/json',
        'Content-Length: ' . strlen($payload),
        'Authorization: Bearer my-token-here',
        'Accept: application/json',
    ],
    CURLOPT_TIMEOUT        => 30,
]);

$response   = curl_exec($ch);
$statusCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($statusCode >= 400) {
    throw new \RuntimeException("Request failed with status $statusCode");
}

$data = json_decode($response, true);
```

### PUT / DELETE Requests

```php
// PUT
$ch = curl_init('https://api.example.com/users/1');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CUSTOMREQUEST  => 'PUT',
    CURLOPT_POSTFIELDS     => json_encode(['name' => 'Alice Updated']),
    CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
]);
curl_exec($ch);
curl_close($ch);

// DELETE
$ch = curl_init('https://api.example.com/users/1');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CUSTOMREQUEST  => 'DELETE',
]);
curl_exec($ch);
curl_close($ch);
```

### Form Data (Multipart) & File Upload

```php
// Multipart form POST (file upload)
$ch = curl_init('https://api.example.com/upload');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => [
        'name'   => 'Alice',
        'avatar' => new CURLFile('/path/to/avatar.jpg', 'image/jpeg', 'avatar.jpg'),
    ],
    // DO NOT set Content-Type header manually — cURL sets multipart/form-data automatically
]);
$response = curl_exec($ch);
curl_close($ch);
```

### Helper Wrapper Class

```php
class HttpClient {
    private array $defaultOptions = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_SSL_VERIFYPEER => true,
    ];

    public function get(string $url, array $headers = []): array {
        return $this->request('GET', $url, null, $headers);
    }

    public function post(string $url, array $data, array $headers = []): array {
        return $this->request('POST', $url, $data, $headers);
    }

    private function request(string $method, string $url, ?array $data, array $headers): array {
        $ch = curl_init($url);
        $options = $this->defaultOptions;

        if ($method !== 'GET') {
            $options[CURLOPT_CUSTOMREQUEST] = $method;
            $options[CURLOPT_POSTFIELDS]    = json_encode($data);
            $headers[] = 'Content-Type: application/json';
        }

        if ($headers) {
            $options[CURLOPT_HTTPHEADER] = $headers;
        }

        curl_setopt_array($ch, $options);

        $body   = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error  = curl_error($ch);
        curl_close($ch);

        if ($error) {
            throw new \RuntimeException("cURL error: $error");
        }

        return ['status' => $status, 'body' => json_decode($body, true)];
    }
}

$client   = new HttpClient();
$response = $client->get('https://api.github.com/users/octocat', ['User-Agent: MyApp/1.0']);
```

---

## Part 2: Guzzle HTTP Client

### Installation

```bash
composer require guzzlehttp/guzzle
```

### Why Guzzle Over Raw cURL?

| Feature | Raw cURL | Guzzle |
|---|---|---|
| Syntax | Verbose, procedural | Fluent, clean OOP |
| Async requests | Manual, complex | Built-in promise-based |
| Middleware | Not supported | Full pipeline support |
| PSR-7 compliance | No | Yes |
| Error handling | Manual status checking | Exceptions on 4xx/5xx |
| Streaming | Complex | Simple |
| Mock in tests | Hard | Easy (MockHandler) |

### Basic Usage

```php
use GuzzleHttp\Client;
use GuzzleHttp\Exception\RequestException;
use GuzzleHttp\Exception\ClientException;  // 4xx
use GuzzleHttp\Exception\ServerException;  // 5xx

$client = new Client([
    'base_uri' => 'https://jsonplaceholder.typicode.com',
    'timeout'  => 30,
    'headers'  => [
        'Accept'        => 'application/json',
        'Authorization' => 'Bearer ' . getenv('API_TOKEN'),
        'User-Agent'    => 'MyApp/1.0',
    ],
]);

// GET
$response = $client->get('/users/1');
$user     = json_decode($response->getBody()->getContents(), true);
echo $user['name'];

// Status code
$statusCode = $response->getStatusCode(); // 200
$reason     = $response->getReasonPhrase(); // OK
```

### POST, PUT, DELETE

```php
// POST with JSON body
$response = $client->post('/posts', [
    'json' => [
        'title'  => 'New Post',
        'body'   => 'Content',
        'userId' => 1,
    ],
]);
$created = json_decode($response->getBody()->getContents(), true);

// POST with form data
$response = $client->post('/login', [
    'form_params' => [
        'username' => 'alice',
        'password' => 'secret',
    ],
]);

// POST with file upload (multipart)
$response = $client->post('/upload', [
    'multipart' => [
        ['name' => 'name',   'contents' => 'Alice'],
        ['name' => 'avatar', 'contents' => fopen('/path/to/avatar.jpg', 'r'), 'filename' => 'avatar.jpg'],
    ],
]);

// PUT
$response = $client->put('/users/1', [
    'json' => ['name' => 'Alice Updated'],
]);

// PATCH
$response = $client->patch('/users/1', [
    'json' => ['active' => false],
]);

// DELETE
$response = $client->delete('/users/1');
```

### Error Handling

```php
use GuzzleHttp\Exception\GuzzleException;
use GuzzleHttp\Exception\ClientException;
use GuzzleHttp\Exception\ServerException;
use GuzzleHttp\Exception\ConnectException;

try {
    $response = $client->get('/users/999');

} catch (ClientException $e) {
    // 4xx errors (400 Bad Request, 401 Unauthorized, 404 Not Found, etc.)
    $status = $e->getResponse()->getStatusCode();
    $body   = $e->getResponse()->getBody()->getContents();
    echo "Client error $status: $body";

} catch (ServerException $e) {
    // 5xx errors (500 Internal Server Error, 503 Service Unavailable)
    echo "Server error: " . $e->getResponse()->getStatusCode();

} catch (ConnectException $e) {
    // Network errors (DNS failure, timeout, refused connection)
    echo "Connection failed: " . $e->getMessage();

} catch (GuzzleException $e) {
    // Catch-all for any Guzzle error
    echo "Request failed: " . $e->getMessage();
}

// Disable automatic exception on 4xx/5xx
$response = $client->get('/users/999', ['http_errors' => false]);
if ($response->getStatusCode() === 404) {
    return null;
}
```

### Query Parameters

```php
$response = $client->get('/users', [
    'query' => [
        'page'     => 1,
        'per_page' => 20,
        'sort'     => 'name',
        'filter'   => 'active',
    ],
]);
// Sends: GET /users?page=1&per_page=20&sort=name&filter=active
```

### Async Requests (Concurrent)

```php
use GuzzleHttp\Promise;

// Fire multiple requests concurrently
$promises = [
    'users'    => $client->getAsync('/users'),
    'posts'    => $client->getAsync('/posts'),
    'comments' => $client->getAsync('/comments'),
];

// Wait for ALL to complete
$responses = Promise\Utils::unwrap($promises);

$users    = json_decode($responses['users']->getBody()->getContents(), true);
$posts    = json_decode($responses['posts']->getBody()->getContents(), true);
$comments = json_decode($responses['comments']->getBody()->getContents(), true);
// All 3 requests ran in parallel — much faster than sequential
```

### Middleware (Guzzle Handler Stack)

```php
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Middleware;
use Psr\Http\Message\RequestInterface;
use Psr\Http\Message\ResponseInterface;

$stack = HandlerStack::create();

// Add logging middleware
$stack->push(Middleware::tap(
    function (RequestInterface $request) {
        echo "→ {$request->getMethod()} {$request->getUri()}\n";
    },
    function (ResponseInterface $response) {
        echo "← {$response->getStatusCode()}\n";
    }
));

// Add retry middleware (retry on 5xx, up to 3 times)
$stack->push(Middleware::retry(
    function (int $retries, RequestInterface $request, ?ResponseInterface $response) {
        if ($retries >= 3) return false;
        if ($response && $response->getStatusCode() >= 500) return true;
        return false;
    },
    fn(int $retries) => $retries * 1000 // wait 1s, 2s, 3s between retries
));

$client = new Client(['handler' => $stack]);
```

### Mocking in Tests

```php
use GuzzleHttp\Client;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Psr7\Response;

class GitHubServiceTest extends TestCase {
    public function test_fetches_user_profile(): void {
        // Mock responses
        $mock = new MockHandler([
            new Response(200, [], json_encode([
                'login' => 'octocat',
                'name'  => 'The Octocat',
                'email' => 'octocat@github.com',
            ])),
        ]);

        $client  = new Client(['handler' => HandlerStack::create($mock)]);
        $service = new GitHubService($client);
        $user    = $service->getUser('octocat');

        $this->assertEquals('The Octocat', $user['name']);
    }

    public function test_handles_api_error(): void {
        $mock = new MockHandler([
            new Response(404, [], '{"message": "Not Found"}'),
        ]);

        $client  = new Client(['handler' => HandlerStack::create($mock)]);
        $service = new GitHubService($client);

        $this->expectException(UserNotFoundException::class);
        $service->getUser('nobody');
    }
}
```

### Complete API Client Example

```php
class StripeClient {
    private Client $http;

    public function __construct(string $apiKey) {
        $this->http = new Client([
            'base_uri' => 'https://api.stripe.com/v1/',
            'auth'     => [$apiKey, ''], // HTTP Basic auth
            'timeout'  => 30,
            'headers'  => ['Accept' => 'application/json'],
        ]);
    }

    public function createCharge(int $amountCents, string $currency, string $token): array {
        try {
            $response = $this->http->post('charges', [
                'form_params' => [
                    'amount'   => $amountCents,
                    'currency' => $currency,
                    'source'   => $token,
                ],
            ]);

            return json_decode($response->getBody()->getContents(), true);

        } catch (ClientException $e) {
            $error = json_decode($e->getResponse()->getBody()->getContents(), true);
            throw new PaymentException($error['error']['message'] ?? 'Payment failed');
        }
    }

    public function getCharge(string $chargeId): array {
        $response = $this->http->get("charges/{$chargeId}");
        return json_decode($response->getBody()->getContents(), true);
    }
}
```

---

## Pros and Cons

### cURL
**Pros:** Built-in (no dependency), full control, works everywhere
**Cons:** Verbose, procedural, hard to test, no middleware, tedious error handling

### Guzzle
**Pros:** Clean API, async support, middleware, PSR-7, easy to mock in tests, retry/logging built-in
**Cons:** Requires Composer, extra dependency, slight overhead

---

## Interview Q&A

**Q: What is the difference between cURL and Guzzle?**
A: cURL is PHP's built-in procedural HTTP library. Guzzle is a modern OOP HTTP client built on cURL with a cleaner API, PSR-7 compliance, async support, middleware pipeline, and easy mocking for tests. Guzzle is preferred for real applications; raw cURL when you can't use Composer.

**Q: How do you handle errors with Guzzle?**
A: Guzzle throws `ClientException` for 4xx responses, `ServerException` for 5xx, and `ConnectException` for network errors. You can disable this behavior with `'http_errors' => false` and check the status code manually. Always wrap API calls in try-catch and handle errors explicitly.

**Q: How do you make concurrent HTTP requests in Guzzle?**
A: Use async methods (`getAsync()`, `postAsync()`) which return Promises. Collect them in an array and use `Promise\Utils::unwrap()` to wait for all to complete. This runs requests concurrently (parallel I/O) — much faster than sequential requests.

**Q: How do you mock Guzzle in tests?**
A: Use `MockHandler` with a stack of pre-configured `Response` objects. Pass the mocked handler to the `Client`. The client returns mock responses in order without making real HTTP requests — making tests fast, deterministic, and isolated.
