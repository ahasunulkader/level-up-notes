# Database Security

### The Problem
- A database holds the most valuable thing a company owns: **its data** (users, passwords, payments, health records). Attackers and mistakes can:
  - **Steal** data (leak all emails and password hashes).
  - **Change or delete** data (set your balance to 1,000,000, or `DROP TABLE`).
  - **Take over** the server (run commands on the machine).
- Many breaches are not clever hacking. They come from **simple mistakes**: one all-powerful account used by the app, user input pasted into SQL, passwords stored as plain text, a database open to the whole internet.

```
Attacker ──► web form ──► App ──► Database      One weak spot is enough to read everything.
```

### What It Solves
Security is built in **layers** (called *defense in depth*). If one layer fails, the next one still protects you.

```
┌──────────────────────────────────────────────────────────────┐
│ 1. Network     : firewall, private network, no public DB IP  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 2. Authentication : who are you? (strong passwords, TLS)│  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │ 3. Authorization : what may you do? (GRANT, roles)│  │  │
│  │  │  ┌────────────────────────────────────────────┐  │  │  │
│  │  │  │ 4. Application : parameterized queries      │  │  │  │
│  │  │  │  ┌──────────────────────────────────────┐  │  │  │  │
│  │  │  │  │ 5. Data : encryption, hashing, masking│  │  │  │  │
│  │  │  │  └──────────────────────────────────────┘  │  │  │  │
│  │  │  └────────────────────────────────────────────┘  │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────┘  │
│ 6. Audit & monitoring : log who did what, alert on oddities  │
└──────────────────────────────────────────────────────────────┘
```

### How It Works

#### 1. SQL Injection (the most famous attack)
**What:** the attacker types SQL code into an input field. If your code glues that text into the query, the database **runs the attacker's code**.

**Vulnerable code (do NOT do this):**
```php
// User types the username into a login form
$user = $_POST['username'];
$pass = $_POST['password'];

// BAD: user text is glued directly into the SQL string
$sql = "SELECT * FROM users WHERE username = '$user' AND password = '$pass'";
```
**Attack:** the attacker enters `admin' --` as username and anything as password.
```
What you wanted:
SELECT * FROM users WHERE username = 'admin' AND password = 'secret'

What actually runs:
SELECT * FROM users WHERE username = 'admin' -- ' AND password = 'xxx'
                                              ^^
                                  "--" starts a comment, so the password check is IGNORED
=> Logged in as admin with no password.
```
**Worse attacks:**
| Input | Result |
|---|---|
| `' OR '1'='1` | Condition always true, returns **all** rows |
| `'; DROP TABLE users; --` | Deletes a table (if multiple statements are allowed) |
| `' UNION SELECT card_no, cvv FROM payments --` | Reads data from **other tables** |
| Time delay `' OR SLEEP(5) --` | "Blind" injection: attacker learns data from response time |

**The fix: parameterized queries (prepared statements).** The SQL text and the data are sent **separately**. The database treats the data as a *value only*, never as code.

```
Unsafe : SQL + data are mixed in ONE string        -> data can become code
Safe   : SQL template ("... WHERE name = ?") sent first,
         values sent separately                    -> values can never become code
```

**Safe PHP (PDO):**
```php
// The ? placeholder marks where a VALUE goes. The SQL structure is fixed.
$stmt = $pdo->prepare('SELECT * FROM users WHERE username = ? AND password_hash = ?');
$stmt->execute([$user, $hash]);   // values are sent separately and cannot change the SQL
$row = $stmt->fetch();
```
**Safe Java (JDBC):**
```java
String sql = "SELECT * FROM users WHERE username = ?";   // template
try (PreparedStatement ps = conn.prepareStatement(sql)) {
    ps.setString(1, username);        // value is bound as DATA, even if it contains quotes or SQL
    try (ResultSet rs = ps.executeQuery()) {
        // ...
    }
}
```
Now `admin' --` is just a weird username that matches no one.

**Things placeholders cannot do:** you can't bind a *table name*, *column name*, or `ORDER BY` direction. For those, use an **allow-list**:
```php
$allowed = ['name', 'created_at', 'price'];                // only these are valid sort columns
$col = in_array($_GET['sort'], $allowed, true) ? $_GET['sort'] : 'name';
$sql = "SELECT * FROM products ORDER BY $col";             // safe: $col is from OUR list
```

**Other defenses for injection:**
- Use an ORM / query builder correctly (they bind parameters, but raw-SQL fragments are still dangerous).
- Validate input type/length (`id` must be an integer).
- App user has minimal rights (so even a successful injection can do little).
- Hide detailed SQL errors from users (they help attackers).

---

#### 2. Authentication — proving who you are
| Practice | Why |
|---|---|
| Strong, unique passwords per account; keep them in a secrets manager / env vars, **never in git** | Leaked repos are a top breach cause |
| Disable or rename default accounts (`root`, `postgres`, `sa`) and remove empty passwords | Attackers try defaults first |
| Use **TLS/SSL** for connections | Stops anyone on the network reading queries and passwords |
| Prefer certificate / IAM / Kerberos auth where possible | No long-lived password to leak |
| Limit by host: `'app'@'10.0.1.%'` | An account only works from your app servers |

```sql
-- MySQL: require encrypted connections for this user
CREATE USER 'app'@'10.0.1.%' IDENTIFIED BY 'long-random-secret' REQUIRE SSL;
```
```
# PostgreSQL pg_hba.conf: only app subnet may connect, must use TLS and scram password
# TYPE    DATABASE  USER   ADDRESS        METHOD
hostssl   shop      app    10.0.1.0/24    scram-sha-256
```

---

#### 3. Authorization — `GRANT`, `REVOKE`, and the principle of least privilege
**Principle of least privilege:** give each account **only** the permissions it needs, nothing more.

```
BAD:  web app connects as root       -> a single bug lets attacker do ANYTHING
GOOD: web app has SELECT, INSERT, UPDATE on a few tables only
```

**Core commands:**
```sql
-- Create an account (MySQL syntax)
CREATE USER 'shop_app'@'10.0.1.%' IDENTIFIED BY 'long-random-secret';

-- Give only what is needed, on only the needed objects
GRANT SELECT, INSERT, UPDATE ON shop.orders   TO 'shop_app'@'10.0.1.%';
GRANT SELECT                  ON shop.products TO 'shop_app'@'10.0.1.%';
-- Note: no DELETE, no DROP, no access to other tables or databases

-- Take a permission back
REVOKE UPDATE ON shop.orders FROM 'shop_app'@'10.0.1.%';

-- See what an account can do
SHOW GRANTS FOR 'shop_app'@'10.0.1.%';
```

**Common privileges:**
| Privilege | Allows |
|---|---|
| `SELECT` | Read rows |
| `INSERT` / `UPDATE` / `DELETE` | Change rows |
| `CREATE` / `ALTER` / `DROP` | Change structure (keep away from the app!) |
| `EXECUTE` | Run stored procedures |
| `GRANT OPTION` | Pass permissions on to others (dangerous) |
| `ALL PRIVILEGES` | Everything (almost never needed) |

**Roles — manage permissions for groups, not people:**
```sql
-- PostgreSQL / MySQL 8: create a role once, grant it to many users
CREATE ROLE reporting_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO reporting_reader;   -- PostgreSQL syntax

CREATE USER alice WITH PASSWORD '...';
GRANT reporting_reader TO alice;      -- Alice inherits the role's permissions
-- Alice leaves the company: DROP USER alice;   (role and others unaffected)
```

**Separate accounts for separate jobs:**
```
shop_app      : runtime queries (SELECT/INSERT/UPDATE on needed tables)
shop_migrator : schema changes (CREATE/ALTER), used only during deploy
shop_readonly : reports and BI tools (SELECT only)
shop_backup   : backups only
```

**Hide columns/rows using views or procedures:** give access to a view that omits sensitive columns.
```sql
-- Support staff may see customers but never their card numbers
CREATE VIEW support_customers AS
SELECT id, name, email FROM customers;           -- card_number is NOT included

GRANT SELECT ON support_customers TO support_role;   -- no access to the base table
```
(See [Views](Data-and-Persistence/advanced-sql/views).)

---

#### 4. Row-Level Security (RLS) — different rows for different users
**Problem:** in a multi-tenant app, company A must never see company B's rows, even if a developer forgets a `WHERE tenant_id = ...`.
**Solution:** the database itself adds an invisible filter to every query.

```
Table invoices                          User of tenant 1 runs:  SELECT * FROM invoices;
+----+-----------+--------+             DB silently rewrites to:
| id | tenant_id | amount |             SELECT * FROM invoices WHERE tenant_id = 1;
+----+-----------+--------+
| 1  | 1         | 100    | ◄── visible
| 2  | 2         | 250    |     hidden
| 3  | 1         | 75     | ◄── visible
+----+-----------+--------+
```
```sql
-- PostgreSQL Row-Level Security
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

-- Policy: a row is visible/changeable only if it belongs to the tenant stored in the session setting
CREATE POLICY tenant_isolation ON invoices
    USING (tenant_id = current_setting('app.tenant_id')::int);

-- The app sets the tenant once per connection/transaction after login
SET app.tenant_id = '1';
SELECT * FROM invoices;     -- now returns only tenant 1's rows
```
MySQL has no built-in RLS: use views with `WHERE tenant_id = ...` plus restricted accounts, or enforce in the application layer.

---

#### 5. Protecting data itself
**a) Passwords: hash, never encrypt or store plain text**
```
Plain text  : "secret123"                      -> breach = everyone's password is exposed
Fast hash   : MD5/SHA1("secret123")            -> cracked in seconds with rainbow tables/GPUs
Slow salted : bcrypt/argon2("secret123"+salt)  -> each guess is deliberately slow
```
- **Hash** = one-way (can't be reversed). **Salt** = random extra text per user so identical passwords have different hashes.
- Use **bcrypt, scrypt, or Argon2**. Never MD5/SHA-1/plain SHA-256 alone.

```php
// PHP: store only the hash
$hash = password_hash($password, PASSWORD_ARGON2ID);        // salt is created automatically
// INSERT INTO users (email, password_hash) VALUES (?, ?)

// Login: compare typed password against stored hash
if (password_verify($typedPassword, $hashFromDb)) { /* logged in */ }
```
```java
// Java (Spring Security / BCrypt)
String hash = new BCryptPasswordEncoder().encode(password);          // store this
boolean ok  = new BCryptPasswordEncoder().matches(typed, hash);      // check at login
```

**b) Encryption**
| Kind | Protects against | How |
|---|---|---|
| **In transit** | Eavesdropping on the network | TLS between app and DB |
| **At rest** | Stolen disks/backups | Transparent Data Encryption (TDE), disk/volume encryption |
| **Column-level / application-level** | Even DBAs or a SQL dump leaking sensitive fields | Encrypt card numbers, SSNs in app code before saving; keys in a KMS (Key Management Service) |

Keep **keys separate** from the data (different server/service); otherwise encryption is pointless.

**c) Data masking and minimizing**
- Show `**** **** **** 1234` instead of the full card number.
- Use **fake data** in dev/test environments (never copy raw production data).
- Don't store what you don't need (PCI rules forbid storing the CVV at all).

```sql
-- Mask in a view: only last 4 digits are visible
CREATE VIEW masked_cards AS
SELECT id, CONCAT('**** **** **** ', RIGHT(card_number, 4)) AS card_display FROM cards;
```

---

#### 6. Network and server hardening
| Do | Why |
|---|---|
| Put the DB in a **private subnet** / no public IP | Internet scanners can't even reach it |
| Firewall: allow only app servers on the DB port (3306 / 5432) | Shrinks attack surface |
| Keep the DB engine **patched** | Known vulnerabilities get exploited fast |
| Disable unused features (`LOAD DATA LOCAL`, `xp_cmdshell`, unused extensions) | Fewer ways to escalate to OS access |
| Run DB as a non-root OS user | A compromise stays contained |
| Encrypt and restrict **backups** | Backups often leak when primary data is safe |

---

#### 7. Auditing and monitoring
Know **who did what and when**, so you can detect and investigate attacks.
```
Audit log entry:  2026-11-01 14:03:11 | user=shop_app | ip=10.0.1.7 | DELETE FROM orders ...
```
| Tool | Purpose |
|---|---|
| Query/general log, **pgAudit**, MySQL Enterprise Audit / MariaDB audit plugin | Record statements and logins |
| Trigger-based audit table | Record row changes yourself |
| Alerts on: many failed logins, new admin accounts, huge `SELECT`s, off-hours access | Detect attacks early |

```sql
-- Simple trigger-based audit trail (MySQL)
CREATE TABLE salary_audit (
    id INT AUTO_INCREMENT PRIMARY KEY,
    employee_id INT, old_salary INT, new_salary INT,
    changed_by VARCHAR(100), changed_at DATETIME
);

CREATE TRIGGER trg_salary_audit AFTER UPDATE ON employees
FOR EACH ROW
    INSERT INTO salary_audit (employee_id, old_salary, new_salary, changed_by, changed_at)
    VALUES (OLD.id, OLD.salary, NEW.salary, CURRENT_USER(), NOW());
-- Only runs a log INSERT; cost is small but every UPDATE now writes one extra row
```
(Triggers are covered in [Triggers](Data-and-Persistence/advanced-sql/triggers).)

**Soft delete + history:** instead of deleting, mark `deleted_at`. Helpful for recovery and auditing (but remember privacy laws like GDPR may require *real* deletion on request).

---

#### 8. Quick security checklist
```
[ ] App uses parameterized queries everywhere
[ ] App account has least privilege (no DROP/ALTER, no ALL PRIVILEGES)
[ ] Default/root account locked down; no empty passwords
[ ] Passwords hashed with bcrypt/argon2
[ ] TLS enforced for connections
[ ] DB not exposed to the public internet
[ ] Backups encrypted and access-controlled
[ ] Secrets in a vault/env, not in source code
[ ] Auditing + alerts on failed logins and admin changes
[ ] Dev/test uses masked or fake data
[ ] Regular patching and restore tests
```

### Time & Space Complexity
- **Parameterized queries:** no extra cost; they are often *faster*, because the database can reuse the parsed query plan.
- **Password hashing:** deliberately slow (e.g. ~100 ms per check). It is a cost you *choose* so attackers need years to try many guesses.
- **TLS:** small CPU overhead per connection (handshake) and per byte (encryption). Use connection pooling to pay the handshake rarely.
- **Row-Level Security:** adds a filter to each query. With an index on the policy column (`tenant_id`) the extra cost is tiny (≈ O(log n)); without it, it becomes a full scan.
- **Auditing/triggers:** every audited change writes an extra row, so write cost roughly doubles for those tables. **Space** grows with log volume, so archive/rotate old logs.

### Alternatives
| Goal | Alternative | Note |
|---|---|---|
| Avoid raw SQL mistakes | ORM / query builder | Still safe only if you don't concatenate raw strings |
| Multi-tenant isolation | Separate schema or separate database per tenant | Stronger isolation, more operational work |
| No password in code | Cloud IAM database auth, Vault dynamic credentials | Short-lived credentials |
| Block attacks at the edge | Web Application Firewall (WAF) | A safety net, **not** a replacement for parameterized queries |
| Protect sensitive fields | Tokenization (replace card numbers with tokens held by a payment provider) | Best way: don't hold the data at all |

### Common Mistakes
- Building SQL with string concatenation or `sprintf`.
- Using `root`/`sa` for the application.
- Storing passwords with MD5 or SHA-1 (or plain text).
- Committing `.env`, config files, or dumps with secrets to git.
- Opening port 3306/5432 to `0.0.0.0/0`.
- Showing raw database errors to end users.
- Restoring production backups into a dev environment with real customer data.
- Trusting the front-end validation only.

### Quick Interview Answers
- **What is SQL injection and how do you prevent it?** User input is run as SQL code. Prevent with parameterized queries/prepared statements, input validation, least privilege, and no raw error messages.
- **Why do prepared statements stop injection?** The query structure is sent first and values separately, so values can never be parsed as SQL.
- **Principle of least privilege?** Each account gets only the permissions it needs; the app never uses an admin account.
- **How do you store passwords?** Slow, salted hash (bcrypt/Argon2), never plain text or fast hashes.
- **Encryption at rest vs in transit?** At rest protects stored files/backups; in transit (TLS) protects data on the network.
- **What is Row-Level Security?** Database-enforced filtering of rows per user/tenant using policies.
