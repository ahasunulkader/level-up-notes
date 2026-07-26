# Sending Emails & Scheduled Jobs in PHP

## TL;DR
**Sending emails** in PHP ranges from the built-in `mail()` function (basic, unreliable) to proper SMTP via PHPMailer/Symfony Mailer (secure, authenticated) to transactional email APIs like Mailgun/SendGrid (scalable, trackable). **Scheduled jobs** let you run PHP code on a time-based schedule — from simple cron jobs to sophisticated queue workers. In production, always send email asynchronously via a queue to avoid blocking the HTTP response.

---

## Part 1: Sending Emails

### Why Not Just Use `mail()`?

```php
// PHP's built-in mail() — looks simple, is dangerous
mail('user@example.com', 'Hello', 'Your order is confirmed');

// Problems:
// - Uses the server's local sendmail — often blocked by hosting providers
// - No authentication → emails land in spam or get blocked
// - No TLS/SSL support built-in
// - No attachments, HTML, or multipart support without manual MIME
// - No error reporting — silent failures
// - No delivery tracking
```

---

### Option 1: PHPMailer (Most Popular Library)

```bash
composer require phpmailer/phpmailer
```

#### Basic HTML Email with SMTP

```php
use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\SMTP;
use PHPMailer\PHPMailer\Exception;

function sendWelcomeEmail(string $toEmail, string $toName): bool {
    $mail = new PHPMailer(true); // true = enable exceptions

    try {
        // SMTP server configuration
        $mail->isSMTP();
        $mail->Host       = 'smtp.gmail.com';    // or smtp.mailgun.org, etc.
        $mail->SMTPAuth   = true;
        $mail->Username   = getenv('SMTP_USER');
        $mail->Password   = getenv('SMTP_PASS');
        $mail->SMTPSecure = PHPMailer::ENCRYPTION_STARTTLS;
        $mail->Port       = 587;

        // Sender
        $mail->setFrom('noreply@yourapp.com', 'MyApp');
        $mail->addReplyTo('support@yourapp.com', 'Support');

        // Recipient
        $mail->addAddress($toEmail, $toName);
        // $mail->addCC('cc@example.com');
        // $mail->addBCC('bcc@example.com');

        // Content
        $mail->isHTML(true);
        $mail->Subject = 'Welcome to MyApp!';
        $mail->Body    = "
            <h1>Welcome, {$toName}!</h1>
            <p>Thank you for signing up. Your account is ready.</p>
            <a href='https://myapp.com/dashboard' style='background:#4F46E5;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;'>
                Go to Dashboard
            </a>
        ";
        $mail->AltBody = "Welcome, {$toName}! Thank you for signing up. Visit: https://myapp.com";

        $mail->send();
        return true;

    } catch (Exception $e) {
        error_log("Email send failed: {$mail->ErrorInfo}");
        return false;
    }
}

// Usage
sendWelcomeEmail('alice@example.com', 'Alice');
```

#### With Attachments

```php
$mail->addAttachment('/var/invoices/invoice-123.pdf', 'Invoice.pdf');
$mail->addAttachment('/var/reports/report.xlsx');

// Embed inline image
$mail->addEmbeddedImage('logo.png', 'logo_cid');
$mail->Body = '<img src="cid:logo_cid" alt="Logo"> Hello!';
```

---

### Option 2: Symfony Mailer (Modern, Framework-Agnostic)

**Symfony Mailer** is a standalone PHP library (part of the Symfony components ecosystem) for sending emails. It is more modern and flexible than PHPMailer — built around PSR standards with a clean fluent API and first-class support for third-party providers (Mailgun, SendGrid, Amazon SES, Postmark) via "transport bridges".

**Why use Symfony Mailer over PHPMailer?**
- Cleaner, chainable API — builds emails like a builder pattern
- Swap transport without changing email code — same `$mailer->send()` whether you use SMTP, Mailgun, or SES
- Works standalone or as part of Symfony Framework
- Used internally by Laravel (via SwiftMailer predecessor) and many modern PHP frameworks

**How it works:**
1. You create a **Transport** — this defines HOW to send (SMTP, API, null for testing)
2. You create a **Mailer** — wraps the transport and exposes `send()`
3. You build an **Email** object with the fluent API — defines WHAT to send
4. You call `$mailer->send($email)` — the mailer hands it to the transport

```bash
composer require symfony/mailer
composer require symfony/smtp-mailer-bridge   # for SMTP transport
```

#### The DSN (Data Source Name) String

The transport is configured via a single **DSN string** — a URL-like format that encodes the provider, credentials, and host in one place:

```text
smtp://username:password@host:port
mailgun+https://key:domain@default
sendgrid+api://api-key@default
null://null           ← discards all emails (useful for testing)
```

This makes it trivial to switch providers — just change the DSN string in `.env`, no code changes:

```bash
# .env
MAILER_DSN=smtp://user:pass@smtp.gmail.com:587
# Switch to Mailgun:
MAILER_DSN=mailgun+https://YOUR_API_KEY:YOUR_DOMAIN@default
```

#### Sending an Email

```php
use Symfony\Component\Mailer\Mailer;
use Symfony\Component\Mailer\Transport;
use Symfony\Component\Mime\Email;
use Symfony\Component\Mime\Address;

// 1. Create transport from DSN
$transport = Transport::fromDsn('smtp://user:pass@smtp.gmail.com:587');

// 2. Create the mailer
$mailer = new Mailer($transport);

// 3. Build the email using fluent chained methods
$email = (new Email())
    ->from(new Address('noreply@yourapp.com', 'MyApp'))  // sender with display name
    ->to(new Address('alice@example.com', 'Alice'))       // recipient with display name
    ->cc('manager@yourapp.com')                           // CC — no display name needed
    ->replyTo('support@yourapp.com')                      // reply-to address
    ->priority(Email::PRIORITY_HIGH)                      // email priority flag
    ->subject('Order Confirmed!')
    ->text('Your order #123 has been confirmed.')         // plain text fallback
    ->html('<h1>Order Confirmed!</h1><p>Order #123 is on its way.</p>') // HTML body
    ->attachFromPath('/var/invoices/invoice-123.pdf', 'Invoice.pdf');   // attachment

// 4. Send — transport handles the actual delivery
$mailer->send($email);
```

#### What Each Method Does

| Method | Purpose |
|---|---|
| `->from()` | Who the email appears to be from |
| `->to()` | Primary recipient(s) |
| `->cc()` | Carbon copy — recipient can see this |
| `->bcc()` | Blind carbon copy — hidden from others |
| `->replyTo()` | Where replies go (can differ from `from`) |
| `->subject()` | Email subject line |
| `->text()` | Plain text version (fallback for email clients that block HTML) |
| `->html()` | HTML body — the rich formatted version |
| `->attachFromPath()` | Attach a file from the filesystem |
| `->priority()` | `PRIORITY_HIGH`, `PRIORITY_NORMAL`, `PRIORITY_LOW` |

#### Multiple Recipients and Attachments

```php
$email = (new Email())
    ->from('noreply@yourapp.com')
    ->to('alice@example.com', 'bob@example.com')     // multiple recipients
    ->bcc('audit@yourapp.com')                        // hidden copy for audit trail
    ->subject('Team Update')
    ->html('<p>Please see the attached report.</p>')
    ->attachFromPath('/var/reports/weekly.pdf', 'WeeklyReport.pdf')
    ->attachFromPath('/var/data/export.csv', 'DataExport.csv');

$mailer->send($email);
```

#### Embedding Inline Images

```php
use Symfony\Component\Mime\Part\DataPart;
use Symfony\Component\Mime\Part\File;

$email = (new Email())
    ->from('noreply@yourapp.com')
    ->to('alice@example.com')
    ->subject('Your Invoice')
    ->embedFromPath('/var/www/public/logo.png', 'logo')     // embed with content ID
    ->html('<img src="cid:logo" alt="Logo"> <p>Thank you!</p>'); // reference via cid:

$mailer->send($email);
```

#### Null Transport for Testing

```php
// In tests — discards all emails, nothing is actually sent
$transport = Transport::fromDsn('null://null');
$mailer    = new Mailer($transport);

// Or use the InMemory transport to inspect what was "sent"
use Symfony\Component\Mailer\Transport\InMemoryTransport;
$transport = new InMemoryTransport();
$mailer    = new Mailer($transport);

$mailer->send($email);
$sentMessages = $transport->getSentMessages(); // inspect in test assertions
```

---

### Option 3: Transactional Email APIs (Production Recommended)

For high-volume or critical emails, use a dedicated email service:

```bash
# Mailgun
composer require mailgun/mailgun-php

# SendGrid
composer require sendgrid/sendgrid
```

```php
// Mailgun — simple, reliable, great deliverability
$mg = Mailgun\Mailgun::create(getenv('MAILGUN_API_KEY'));

$mg->messages()->send('yourdomain.com', [
    'from'    => 'noreply@yourdomain.com',
    'to'      => 'alice@example.com',
    'subject' => 'Order Confirmed!',
    'html'    => '<h1>Your order is confirmed!</h1>',
    'text'    => 'Your order is confirmed!',
    // 'o:tag'          => ['order-confirmation'],    // tags for tracking
    // 'o:tracking'     => 'yes',                     // track opens/clicks
    // 'h:X-Order-ID'   => '12345',                   // custom header
]);
```

```php
// SendGrid
$sg = new \SendGrid(getenv('SENDGRID_API_KEY'));

$email = new \SendGrid\Mail\Mail();
$email->setFrom('noreply@yourapp.com', 'MyApp');
$email->setSubject('Order Confirmed');
$email->addTo('alice@example.com', 'Alice');
$email->addContent('text/plain', 'Your order is confirmed.');
$email->addContent('text/html', '<h1>Your order is confirmed!</h1>');

$response = $sg->send($email);
// $response->statusCode() — 202 = queued for delivery
```

### Email Service Comparison

| | `mail()` | PHPMailer | Mailgun/SendGrid |
|---|---|---|---|
| Setup | Zero | Minimal | API key |
| SMTP auth | No | Yes | Yes (REST API) |
| Deliverability | Poor | Good | Excellent |
| Tracking | No | No | Yes (opens, clicks) |
| Scalability | Low | Medium | High |
| Cost | Free | Free | Paid (free tier) |
| Best for | Never | Small apps | Production |

---

## Part 2: Scheduled Jobs (Cron)

### What Are Scheduled Jobs?

Scheduled jobs run code automatically at defined times — without a user triggering them:
- Send daily digest emails every morning at 8AM
- Clean up expired sessions every hour
- Generate weekly reports on Sundays
- Check for overdue orders every 5 minutes
- Sync data from an external API every 15 minutes

---

### Option 1: Linux Cron (Most Common)

```bash
# Edit crontab
crontab -e

# Format: minute hour day-of-month month day-of-week command
# *       *    *             *      *         command

# Every minute
* * * * * /usr/bin/php /var/www/my-app/cron/process-queue.php

# Every hour at :30
30 * * * * /usr/bin/php /var/www/my-app/cron/sync-users.php

# Every day at 8:00 AM
0 8 * * * /usr/bin/php /var/www/my-app/cron/send-digest.php

# Every Sunday at midnight
0 0 * * 0 /usr/bin/php /var/www/my-app/cron/weekly-report.php

# Every 5 minutes
*/5 * * * * /usr/bin/php /var/www/my-app/cron/check-orders.php

# Log output
0 8 * * * /usr/bin/php /var/www/my-app/cron/send-digest.php >> /var/log/cron.log 2>&1
```

```php
<?php
// cron/send-digest.php

require_once __DIR__ . '/../vendor/autoload.php';

// Prevent overlap: exit if already running
$lockFile = '/tmp/send-digest.lock';
if (file_exists($lockFile)) {
    exit("Already running\n");
}
file_put_contents($lockFile, getmypid());

try {
    $users = getUsersForDigest();
    foreach ($users as $user) {
        sendDigestEmail($user);
    }
    echo date('Y-m-d H:i:s') . " — Digest sent to " . count($users) . " users\n";
} catch (Throwable $e) {
    error_log("Digest cron failed: " . $e->getMessage());
} finally {
    unlink($lockFile); // always release lock
}
```

---

### Option 2: PHP Task Scheduler (crunzphp/crunz)

A more expressive, code-based scheduler for PHP:

```bash
composer require crunzphp/crunz
```

```php
<?php
// tasks/emails.php

use Crunz\Schedule;

$schedule = new Schedule();

// Send daily digest at 8 AM
$schedule->run('php artisan digest:send')
    ->dailyAt('08:00')
    ->description('Send daily email digest')
    ->onError(function () {
        // notify on failure
        mail('admin@example.com', 'Cron Failed', 'Daily digest failed!');
    });

// Clean expired sessions every hour
$schedule->run('php bin/console sessions:cleanup')
    ->hourly()
    ->withoutOverlapping(); // prevents concurrent runs

// Weekly report every Sunday midnight
$schedule->run(function () {
    (new ReportGenerator())->generateWeekly();
})
->sundays()
->at('00:00')
->description('Generate weekly report');

// Every 5 minutes between 9AM-6PM on weekdays
$schedule->run('php cron/check-payments.php')
    ->everyFiveMinutes()
    ->weekdays()
    ->between('09:00', '18:00');

return $schedule;
```

```bash
# Single crontab entry to run Crunz
* * * * * cd /var/www/my-app && vendor/bin/crunz schedule:run >> /var/log/crunz.log 2>&1
```

---

### Option 3: Laravel Scheduler (Most Elegant)

```php
// app/Console/Kernel.php (Laravel 10 and below)
protected function schedule(Schedule $schedule): void {
    // Email tasks
    $schedule->command('emails:send-digest')
        ->dailyAt('08:00')
        ->emailOutputOnFailure('admin@example.com');

    // Cleanup
    $schedule->command('sessions:cleanup')->hourly();

    // Custom PHP closure
    $schedule->call(function () {
        DB::table('temp_tokens')
            ->where('expires_at', '<', now())
            ->delete();
    })->daily()->name('cleanup:tokens')->withoutOverlapping();

    // External command
    $schedule->exec('backup.sh')->weekly()->sundays()->at('02:00');

    // Run on specific environments
    $schedule->command('sync:external-data')
        ->everyFiveMinutes()
        ->environments(['production']);
}
```

```bash
# Laravel — single crontab entry
* * * * * cd /var/www/my-laravel-app && php artisan schedule:run >> /dev/null 2>&1
```

---

### Async Email Sending with Queues

**Never send emails synchronously during an HTTP request** — it adds 200-500ms to response time and fails if the mail server is down.

```php
// BAD — blocks the user waiting for SMTP connection
class RegisterController {
    public function register(Request $request): Response {
        $user = User::create($request->all());
        sendWelcomeEmail($user); // blocks for 300ms — bad UX
        return response()->json(['message' => 'Registered!']);
    }
}
```

```php
// GOOD — queue the email job, return instantly

// Step 1: Create a Job class
class SendWelcomeEmailJob {
    public function __construct(private User $user) {}

    public function handle(MailerInterface $mailer): void {
        $mailer->send($this->user->email, 'Welcome!', $this->buildBody());
    }

    private function buildBody(): string {
        return "<h1>Welcome, {$this->user->name}!</h1>";
    }
}

// Step 2: Dispatch to queue (Redis, Database, SQS)
class RegisterController {
    public function register(Request $request): Response {
        $user = User::create($request->all());
        Queue::push(new SendWelcomeEmailJob($user)); // returns instantly
        return response()->json(['message' => 'Registered!']); // ~5ms response
    }
}

// Step 3: Worker processes the queue in background
// php artisan queue:work  (runs worker continuously)
// Processes SendWelcomeEmailJob → sends email → no user waiting
```

### Queue + Cron Together (Full Flow)

```
User registers
       │
       ▼
HTTP request → Register → push job to Redis queue → return 200ms response
                                    │
                                    ▼
                         Queue Worker (background process)
                                    │
                                    ▼
                            SendWelcomeEmailJob
                                    │
                                    ▼
                            SMTP / Mailgun API
                                    │
                                    ▼
                            Email delivered to user
```

---

## Email Templates Best Practices

```php
// Use template files for maintainable HTML emails
class EmailTemplateRenderer {
    public function render(string $template, array $data): string {
        $html = file_get_contents(__DIR__ . "/templates/{$template}.html");

        foreach ($data as $key => $value) {
            $html = str_replace("{{ $key }}", htmlspecialchars($value), $html);
        }

        return $html;
    }
}

// templates/welcome.html
// <h1>Welcome, {{ name }}!</h1>
// <p>Click <a href="{{ confirmUrl }}">here</a> to confirm your email.</p>

$renderer = new EmailTemplateRenderer();
$html     = $renderer->render('welcome', [
    'name'       => 'Alice',
    'confirmUrl' => 'https://myapp.com/confirm?token=abc123',
]);
```

---

## Interview Q&A

**Q: Why shouldn't you use PHP's `mail()` function in production?**
A: `mail()` relies on the server's local MTA (sendmail), has no authentication, no TLS/SSL, and emails frequently land in spam or get blocked by modern mail servers. Use PHPMailer/Symfony Mailer with SMTP authentication, or a dedicated email service (Mailgun, SendGrid) for reliable delivery, tracking, and proper authentication (SPF, DKIM, DMARC).

**Q: Why should emails be sent asynchronously?**
A: SMTP connections take 200-500ms+ per email. Sending email synchronously during an HTTP request makes the user wait and fails the whole request if the mail server is down. By pushing to a queue, the HTTP response is instant (5-20ms), and a background worker sends the email independently. If sending fails, the job can be retried.

**Q: What is a cron job?**
A: A cron job is a scheduled task that runs automatically at defined times on a Linux server. The crontab file defines when to run which command using a 5-field time format (minute, hour, day, month, weekday). For PHP apps, it's used to send digest emails, clean up data, generate reports, and sync with external services.

**Q: How do you prevent a scheduled job from running twice simultaneously?**
A: Use a lock file, a database flag, or a locking mechanism. Check if the job is already running (e.g., `if (file_exists($lockFile)) exit;`) and release the lock when done. Laravel's `withoutOverlapping()` handles this automatically using the cache.
