# PHP Date & Time

Date and time handling is deceptively complex — timezones, Daylight Saving Time, leap years, and format inconsistencies cause real bugs in production. PHP provides both procedural and OOP approaches, and knowing the difference between them is a common interview topic.

---

## 1. Why Date/Time is Complex

- **Timezones** — same instant, different local times
- **Daylight Saving Time (DST)** — clocks shift, some "times" don't exist or occur twice
- **Leap years & leap seconds** — February 29 doesn't always exist
- **Format ambiguity** — `01/02/03` could mean 3 different dates depending on locale
- **Mutation bugs** — modifying a `DateTime` object affects all references

---

## 2. Unix Timestamp

A Unix timestamp is the number of **seconds since January 1, 1970, 00:00:00 UTC** (the Unix epoch). It's timezone-independent at its core — the same integer represents the same moment everywhere on Earth.

```php
<?php
$now = time(); // current Unix timestamp, e.g. 1708516800

echo $now;                          // 1708516800
echo date('Y-m-d H:i:s', $now);    // formatted in server's timezone

// Convert a date string to timestamp
$ts = strtotime('2026-02-21 14:30:00');

// Timestamps are great for comparisons
$expiry = strtotime('+30 days');
if (time() > $expiry) {
    echo 'Token has expired';
}
```

**Why store as Unix timestamp?** Easy arithmetic, timezone-independent, language-neutral, efficient integer comparison.

---

## 3. date() Function

Formats a timestamp (or current time) as a string.

**Syntax:** `date(string $format, int $timestamp = time()): string`

```php
<?php
echo date('Y-m-d');          // 2026-02-21
echo date('d/m/Y');          // 21/02/2026
echo date('H:i:s');          // 14:30:00
echo date('Y-m-d H:i:s');   // 2026-02-21 14:30:00
echo date('D, d M Y');       // Sat, 21 Feb 2026
echo date('l, F j, Y');      // Saturday, February 21, 2026
echo date('g:i A');          // 2:30 PM
echo date('U');               // Unix timestamp (same as time())

// Format a specific timestamp
echo date('Y-m-d', strtotime('2026-12-25')); // 2026-12-25
```

### Format Character Reference

| Char | Description | Example |
|------|-------------|---------|
| `Y` | 4-digit year | `2026` |
| `y` | 2-digit year | `26` |
| `m` | Month, zero-padded | `02` |
| `n` | Month, no padding | `2` |
| `M` | Month abbreviation | `Feb` |
| `F` | Month full name | `February` |
| `d` | Day, zero-padded | `05` |
| `j` | Day, no padding | `5` |
| `D` | Day abbreviation | `Sat` |
| `l` | Day full name | `Saturday` |
| `N` | Day of week (1=Mon, 7=Sun) | `6` |
| `w` | Day of week (0=Sun, 6=Sat) | `5` |
| `H` | 24-hour hour, zero-padded | `14` |
| `G` | 24-hour hour, no padding | `14` |
| `h` | 12-hour hour, zero-padded | `02` |
| `g` | 12-hour hour, no padding | `2` |
| `i` | Minutes, zero-padded | `05` |
| `s` | Seconds, zero-padded | `09` |
| `A` | AM or PM | `PM` |
| `a` | am or pm | `pm` |
| `W` | ISO week number | `08` |
| `t` | Days in the month | `28` |
| `L` | Leap year (1 or 0) | `1` |
| `U` | Unix timestamp | `1708516800` |
| `c` | ISO 8601 full | `2026-02-21T14:30:00+00:00` |
| `r` | RFC 2822 | `Sat, 21 Feb 2026 14:30:00 +0000` |

---

## 4. mktime() Function

Creates a Unix timestamp from individual date/time components.

**Syntax:** `mktime(int $hour, int $min, int $sec, int $month, int $day, int $year): int`

```php
<?php
// Create specific timestamp
$ts = mktime(14, 30, 0, 2, 21, 2026); // 2026-02-21 14:30:00
echo date('Y-m-d H:i:s', $ts);

// Overflow handling — PHP normalizes out-of-range values
$ts = mktime(0, 0, 0, 13, 1, 2026);   // month 13 → Jan 2027
echo date('Y-m-d', $ts);              // 2027-01-01

$ts = mktime(0, 0, 0, 2, 30, 2026);   // Feb 30 → Mar 2
echo date('Y-m-d', $ts);              // 2026-03-02

// Real-life: "is this date in the past?"
$dueDate = mktime(0, 0, 0, 6, 15, 2026);
if (time() > $dueDate) {
    echo 'Overdue!';
}

// First and last day of month
$firstDay = mktime(0, 0, 0, date('n'), 1, date('Y'));
$lastDay  = mktime(0, 0, 0, date('n') + 1, 0, date('Y')); // day 0 = last day of prev month
```

---

## 5. strtotime() Function

Parses an English-language date/time string into a Unix timestamp.

```php
<?php
$ts = strtotime('2026-02-21');         // specific date
$ts = strtotime('21 February 2026');   // natural language
$ts = strtotime('next Monday');        // relative
$ts = strtotime('last Friday');        // relative
$ts = strtotime('+1 day');             // from now
$ts = strtotime('+2 weeks');
$ts = strtotime('+1 month');
$ts = strtotime('-3 months');
$ts = strtotime('next month');
$ts = strtotime('first day of next month');
$ts = strtotime('last day of this month');

// Real-life: date arithmetic
$orderDate   = strtotime('2026-02-01');
$deliveryDate = strtotime('+5 days', $orderDate); // relative to another timestamp
echo date('Y-m-d', $deliveryDate); // 2026-02-06

// Real-life: subscription expiry
$subscriptionStart = strtotime('2026-01-01');
$expiry = strtotime('+1 year', $subscriptionStart);
echo date('Y-m-d', $expiry); // 2027-01-01
```

### strtotime() Pitfalls

```php
<?php
// Ambiguous formats — depends on locale
strtotime('01/02/03'); // Could be MM/DD/YY (Jan 2) or DD/MM/YY (Feb 1) or YY/MM/DD
// ALWAYS use unambiguous format: YYYY-MM-DD or ISO 8601

// Returns false on failure — always check!
$ts = strtotime('not a date');
if ($ts === false) {
    throw new \InvalidArgumentException('Invalid date string');
}

// Month arithmetic — day overflow
strtotime('+1 month', strtotime('2026-01-31')); // March 3 (not Feb 28!)
// For "end of month" arithmetic, use DateTimeImmutable instead
```

---

## 6. checkdate() — Validate Date Components

```php
<?php
// checkdate(month, day, year): bool
var_dump(checkdate(2, 29, 2024)); // true  — 2024 is a leap year
var_dump(checkdate(2, 29, 2026)); // false — 2026 is not a leap year
var_dump(checkdate(4, 31, 2026)); // false — April has only 30 days
var_dump(checkdate(12, 31, 2026));// true

// Real-life: validate user-submitted date
function validateDate(int $year, int $month, int $day): bool
{
    return checkdate($month, $day, $year)
        && $year >= 1900
        && $year <= (int) date('Y') + 100;
}
```

---

## 7. DateTime Class (OOP Approach)

The OOP approach is more readable, chainable, and less error-prone than procedural functions.

```php
<?php
// Creating
$now  = new \DateTime();                              // now
$date = new \DateTime('2026-02-21');                  // specific date
$date = new \DateTime('2026-02-21 14:30:00');         // with time
$date = new \DateTime('now', new \DateTimeZone('UTC')); // with timezone

// From custom format
$date = \DateTime::createFromFormat('d/m/Y', '21/02/2026');
$date = \DateTime::createFromFormat('m-d-Y H:i', '02-21-2026 14:30');

// Formatting output
echo $date->format('Y-m-d');           // 2026-02-21
echo $date->format('D, d M Y H:i:s'); // Sat, 21 Feb 2026 14:30:00

// Modifying (mutates the object!)
$date = new \DateTime('2026-02-21');
$date->modify('+1 day');      // 2026-02-22
$date->modify('next Monday'); // next Monday from current value
$date->modify('-2 months');

// add() / sub() with DateInterval
$date = new \DateTime('2026-02-21');
$date->add(new \DateInterval('P1Y2M3D'));  // +1 year, 2 months, 3 days
$date->sub(new \DateInterval('PT4H30M')); // -4 hours, 30 minutes

echo $date->getTimestamp(); // Unix timestamp
```

### Comparing DateTime Objects

```php
<?php
$date1 = new \DateTime('2026-01-01');
$date2 = new \DateTime('2026-06-15');

var_dump($date1 < $date2);  // true
var_dump($date1 > $date2);  // false
var_dump($date1 == $date2); // false

// Difference
$diff = $date1->diff($date2);
echo $diff->days;  // total days
echo $diff->m;     // months component
echo $diff->d;     // days component
echo ($diff->invert ? '-' : '+'); // direction
```

---

## 8. DateTimeImmutable — The Safer Choice

`DateTime` is **mutable** — calling `modify()`, `add()`, or `sub()` changes the object in place. This causes subtle bugs when the same `DateTime` is referenced from multiple places.

`DateTimeImmutable` is **immutable** — every modification returns a **new object**, leaving the original unchanged.

```php
<?php
// THE MUTATION BUG with DateTime
$start = new \DateTime('2026-01-01');
$end   = $start;         // both point to the SAME object
$end->modify('+30 days');

echo $start->format('Y-m-d'); // 2026-01-31 — SURPRISE! start was changed too!
echo $end->format('Y-m-d');   // 2026-01-31

// SAFE with DateTimeImmutable
$start = new \DateTimeImmutable('2026-01-01');
$end   = $start->modify('+30 days'); // returns NEW object, $start unchanged

echo $start->format('Y-m-d'); // 2026-01-01 — unchanged!
echo $end->format('Y-m-d');   // 2026-01-31 — correct!
```

### DateTimeImmutable in Practice

```php
<?php
$subscription = new \DateTimeImmutable('2026-02-21');

// Each method returns a new object — chain or assign individually
$monthLater  = $subscription->modify('+1 month');
$yearLater   = $subscription->modify('+1 year');
$withTime    = $subscription->setTime(23, 59, 59);

// They're all independent — $subscription is unchanged
echo $subscription->format('Y-m-d'); // 2026-02-21

// Create from format
$date = \DateTimeImmutable::createFromFormat('d/m/Y', '21/02/2026');

// Convert between mutable and immutable
$mutable   = new \DateTime('2026-02-21');
$immutable = \DateTimeImmutable::createFromMutable($mutable);
$backToMutable = \DateTime::createFromImmutable($immutable);
```

> **Best practice:** Always use `DateTimeImmutable` in modern PHP. Use `DateTime` only when you explicitly need in-place mutation.

---

## 9. DateInterval

Represents a duration of time (not a point in time).

**Format:** `P[years]Y[months]M[days]DT[hours]H[minutes]M[seconds]S`
- `P` = Period (required prefix)
- `T` = Time separator (required before time components)

```php
<?php
// Create intervals
$oneYear     = new \DateInterval('P1Y');        // 1 year
$sixMonths   = new \DateInterval('P6M');        // 6 months
$oneWeek     = new \DateInterval('P7D');        // 7 days
$twoHours    = new \DateInterval('PT2H');       // 2 hours (note T before H)
$mixed       = new \DateInterval('P1Y2M3DT4H5M6S'); // full

// Use with DateTime
$date = new \DateTimeImmutable('2026-01-01');
echo $date->add($oneYear)->format('Y-m-d');  // 2027-01-01
echo $date->sub($sixMonths)->format('Y-m-d'); // 2025-07-01

// date_diff() — calculate difference between two dates
$start = new \DateTimeImmutable('2024-01-15');
$end   = new \DateTimeImmutable('2026-02-21');

$diff = $start->diff($end);
echo $diff->y;     // 2 (years)
echo $diff->m;     // 1 (months component)
echo $diff->d;     // 6 (days component)
echo $diff->days;  // 767 (total days)
echo $diff->invert; // 0 (0 = positive, 1 = negative/past)

// Real-life: human-readable "time since"
function timeSince(\DateTimeInterface $date): string
{
    $diff = $date->diff(new \DateTimeImmutable());

    if ($diff->y > 0) return $diff->y . ' year(s) ago';
    if ($diff->m > 0) return $diff->m . ' month(s) ago';
    if ($diff->d > 0) return $diff->d . ' day(s) ago';
    if ($diff->h > 0) return $diff->h . ' hour(s) ago';
    return $diff->i . ' minute(s) ago';
}

// Real-life: check subscription expiry
function isExpired(\DateTimeImmutable $expiry): bool
{
    return $expiry < new \DateTimeImmutable();
}
```

---

## 10. DatePeriod — Iterate Over a Range of Dates

`DatePeriod` lets you iterate over a series of dates with a fixed interval.

```php
<?php
$start    = new \DateTimeImmutable('2026-02-01');
$interval = new \DateInterval('P1D');  // 1 day
$end      = new \DateTimeImmutable('2026-02-08');

$period = new \DatePeriod($start, $interval, $end);

foreach ($period as $date) {
    echo $date->format('Y-m-d l') . "\n";
}
// 2026-02-01 Sunday
// 2026-02-02 Monday
// ...
// 2026-02-07 Saturday
// Note: end date itself is NOT included

// Include the end date with count instead of end date
$period = new \DatePeriod($start, $interval, 6); // 6 occurrences after start

// Real-life: generate all weekdays in a month
$start  = new \DateTimeImmutable('first day of this month');
$end    = new \DateTimeImmutable('first day of next month');
$period = new \DatePeriod($start, new \DateInterval('P1D'), $end);

$weekdays = [];
foreach ($period as $day) {
    if ($day->format('N') < 6) { // 1=Mon...5=Fri, 6=Sat, 7=Sun
        $weekdays[] = $day->format('Y-m-d');
    }
}

// Real-life: generate recurring invoice dates
$start    = new \DateTimeImmutable('2026-01-01');
$interval = new \DateInterval('P1M'); // every month
$end      = new \DateTimeImmutable('2026-12-31');
$period   = new \DatePeriod($start, $interval, $end);

foreach ($period as $invoiceDate) {
    createInvoice($invoiceDate->format('Y-m-d'));
}
```

---

## 11. Timezone Handling

```php
<?php
// Set default timezone for the application
date_default_timezone_set('UTC');  // always use UTC in config

// Get current timezone
echo date_default_timezone_get(); // UTC

// Create DateTime with specific timezone
$utcTime   = new \DateTimeImmutable('now', new \DateTimeZone('UTC'));
$nycTime   = new \DateTimeImmutable('now', new \DateTimeZone('America/New_York'));
$dhakaTime = new \DateTimeImmutable('now', new \DateTimeZone('Asia/Dhaka'));

// Convert timezone
$utc     = new \DateTimeImmutable('2026-02-21 12:00:00', new \DateTimeZone('UTC'));
$dhaka   = $utc->setTimezone(new \DateTimeZone('Asia/Dhaka'));

echo $utc->format('Y-m-d H:i:s T');   // 2026-02-21 12:00:00 UTC
echo $dhaka->format('Y-m-d H:i:s T'); // 2026-02-21 18:00:00 +06

// List all timezones
$zones = \DateTimeZone::listIdentifiers(\DateTimeZone::ALL);
```

### UTC Storage Pattern (Best Practice)

```php
<?php
// ALWAYS store dates as UTC in the database
// ALWAYS convert to local time only for display

// Storing (convert user's local time → UTC)
function toUtc(string $localTime, string $userTimezone): string
{
    return (new \DateTimeImmutable($localTime, new \DateTimeZone($userTimezone)))
        ->setTimezone(new \DateTimeZone('UTC'))
        ->format('Y-m-d H:i:s');
}

// Displaying (convert UTC → user's local time)
function toLocal(string $utcTime, string $userTimezone): string
{
    return (new \DateTimeImmutable($utcTime, new \DateTimeZone('UTC')))
        ->setTimezone(new \DateTimeZone($userTimezone))
        ->format('Y-m-d H:i:s');
}

$utcStored  = toUtc('2026-02-21 18:00:00', 'Asia/Dhaka');   // stored in DB
$displayed  = toLocal($utcStored, 'America/New_York');       // shown to NY user
```

**Common timezone bugs:**
- Server in one timezone, DB in another
- Not accounting for DST transitions
- Comparing timestamps without normalizing to the same timezone
- Forgetting `date_default_timezone_set('UTC')` in bootstrap

---

## 12. Carbon Library

Carbon is a PHP library that wraps `DateTime` with a much more fluent, readable API. It's the standard in Laravel applications.

```php
<?php
// Install: composer require nesbot/carbon
use Carbon\Carbon;
use Carbon\CarbonImmutable;

// Creation
$now      = Carbon::now();
$now      = Carbon::now('Asia/Dhaka');
$date     = Carbon::parse('2026-02-21');
$tomorrow = Carbon::tomorrow();
$yesterday = Carbon::yesterday();
$date     = Carbon::create(2026, 2, 21, 14, 30, 0);

// Arithmetic
$date = Carbon::parse('2026-02-21');
echo $date->addDays(7)->format('Y-m-d');   // 2026-02-28
echo $date->subMonths(1)->format('Y-m-d'); // 2026-01-21
echo $date->addYear()->format('Y-m-d');    // 2027-02-21
echo $date->startOfMonth()->format('Y-m-d'); // 2026-02-01
echo $date->endOfMonth()->format('Y-m-d');   // 2026-02-28

// Human-readable differences (diffForHumans)
$past = Carbon::parse('2026-01-01');
echo $past->diffForHumans();  // "7 weeks ago"

$future = Carbon::parse('2026-12-25');
echo $future->diffForHumans(); // "10 months from now"

// Comparisons
$date->isPast();
$date->isFuture();
$date->isToday();
$date->isWeekend();
$date->isSameDay(Carbon::parse('2026-02-21'));

// CarbonImmutable — safe, no mutation
$immutable = CarbonImmutable::now();
$next = $immutable->addDays(7); // original unchanged
```

---

## 13. Procedural vs OOP Approach

| | Procedural | OOP (DateTime) |
|---|-----------|---------------|
| Functions | `date()`, `strtotime()`, `mktime()` | `new DateTime()`, `->format()`, `->modify()` |
| Mutation | N/A (timestamps are values) | `DateTime` mutates; `DateTimeImmutable` doesn't |
| Timezone | `date_default_timezone_set()` | Per-object `DateTimeZone` |
| Interval | Manual math | `DateInterval` |
| Comparison | Integer compare timestamps | `<`, `>`, `->diff()` |
| Readability | Good for simple cases | Better for complex logic |
| Recommended | Simple one-liners | Always prefer for complex logic |

---

## Interview Q&A

**Q: What is the difference between `DateTime` and `DateTimeImmutable`?**
A: `DateTime` is mutable — methods like `modify()`, `add()`, and `sub()` change the object in place, affecting all references to it. `DateTimeImmutable` is immutable — every modification returns a **new object**, leaving the original unchanged. Always prefer `DateTimeImmutable` to avoid accidental mutation bugs when the same date is referenced in multiple places.

**Q: What is the difference between `strtotime()` and `DateTime::createFromFormat()`?**
A: `strtotime()` accepts English date strings and attempts to auto-parse them — it's convenient but ambiguous formats like `01/02/03` can produce unexpected results. `DateTime::createFromFormat()` requires you to specify the **exact format**, making parsing unambiguous and reliable. Use `createFromFormat()` when accepting user input or parsing dates from external systems.

**Q: Why should you store dates as UTC in the database?**
A: UTC is timezone-independent — the same timestamp represents the same moment for all users worldwide. Storing in local time creates inconsistencies when users are in different timezones, when servers change timezone, or when DST transitions cause ambiguity (some local times occur twice or not at all). Store UTC, convert to local time only for display.

**Q: What is `DateInterval` and what is its format string?**
A: `DateInterval` represents a duration (not a point in time). The format is `P[n]Y[n]M[n]DT[n]H[n]M[n]S` where `P` is required, `T` separates date from time components. Example: `P1Y2M3DT4H5M6S` = 1 year, 2 months, 3 days, 4 hours, 5 minutes, 6 seconds.

**Q: What is `DatePeriod` used for?**
A: `DatePeriod` iterates over a series of dates with a fixed interval between a start and end date. Useful for generating calendar slots, recurring invoice dates, reporting periods, or any scenario requiring all dates between two points at a regular interval. Note: the end date itself is not included.

**Q: What does `strtotime('+1 month', strtotime('2026-01-31'))` return?**
A: `2026-03-03` (or March 3) — not February 28. `strtotime` adds a month literally (Jan → Feb) but since Feb 31 doesn't exist, it overflows to March. For safe "end of month" arithmetic, use `DateTimeImmutable::modify('last day of next month')` instead.

**Q: How do you calculate the difference between two dates in PHP?**
A: Use `$date1->diff($date2)` which returns a `DateInterval` object. Use `$diff->days` for total days, or `$diff->y`, `$diff->m`, `$diff->d` for year/month/day components. The `$diff->invert` property is `1` if the result is negative.

**Q: What is the purpose of Carbon?**
A: Carbon is a PHP library wrapping `DateTime` with a fluent, human-readable API. It adds methods like `addDays()`, `isPast()`, `isWeekend()`, `diffForHumans()` (returns "3 days ago"), and is the standard date library in Laravel. `CarbonImmutable` provides the same API without mutation.
