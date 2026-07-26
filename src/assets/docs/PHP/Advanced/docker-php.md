# Docker & Setting Up a PHP Application

## TL;DR
**Docker** packages your application and ALL its dependencies (PHP version, extensions, web server, database) into portable, isolated **containers**. You run the same container on your laptop, your teammate's machine, and production — it behaves identically everywhere. No more "works on my machine". PHP apps typically use `docker-compose` to run multiple containers together (PHP-FPM + Nginx + MySQL + Redis).

---

## What is Docker?

### The Problem Docker Solves

Without Docker:
- Developer A: PHP 8.1, MySQL 5.7, Ubuntu
- Developer B: PHP 8.3, MySQL 8.0, Windows
- Production: PHP 8.0, MySQL 8.1, CentOS
- **Result:** Subtle bugs that only appear in certain environments

With Docker:
- Everyone runs the **exact same container** — same PHP version, same extensions, same config
- New developer onboards in minutes: `docker compose up`
- Production matches development exactly

### Core Concepts

| Concept | Analogy | Description |
|---|---|---|
| **Image** | Recipe | Blueprint for a container — defines what's installed |
| **Container** | Dish from recipe | Running instance of an image |
| **Dockerfile** | Recipe instructions | Script to build a custom image |
| **docker-compose** | Meal plan | Defines and runs multiple containers together |
| **Volume** | External hard drive | Persistent storage that survives container restarts |
| **Network** | Private LAN | Containers talk to each other via Docker networks |
| **Registry** | App store | Hub where images are stored (Docker Hub, ECR) |

```
Dockerfile  →  docker build  →  Image  →  docker run  →  Container
                                                              │
                                                         Running process
                                                         (PHP, Nginx, MySQL)
```

---

## Installing Docker

```bash
# macOS / Windows: Download Docker Desktop from docker.com

# Ubuntu/Debian
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-plugin

# Verify
docker --version          # Docker version 24.x
docker compose version    # Docker Compose version 2.x

# Run without sudo (Linux)
sudo usermod -aG docker $USER
newgrp docker
```

---

## Project Structure

```
my-php-app/
├── docker/
│   ├── php/
│   │   ├── Dockerfile        ← Custom PHP image
│   │   └── php.ini           ← PHP configuration
│   └── nginx/
│       └── default.conf      ← Nginx virtual host config
├── src/                      ← PHP application code
│   ├── public/
│   │   └── index.php
│   └── composer.json
├── docker-compose.yml        ← Orchestrates all services
└── .env                      ← Environment variables
```

---

## Step 1: The Dockerfile (Custom PHP Image)

```dockerfile
# docker/php/Dockerfile

# Base image: official PHP with FPM (FastCGI Process Manager)
FROM php:8.3-fpm-alpine

# Install system dependencies
RUN apk add --no-cache \
    git \
    curl \
    libpng-dev \
    libxml2-dev \
    zip \
    unzip

# Install PHP extensions
RUN docker-php-ext-install \
    pdo \
    pdo_mysql \
    mbstring \
    exif \
    pcntl \
    bcmath \
    gd \
    xml

# Install Redis extension via PECL
RUN pecl install redis && docker-php-ext-enable redis

# Install Composer (PHP package manager)
COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

# Set working directory inside container
WORKDIR /var/www

# Copy application code into the image
COPY src/ .

# Install PHP dependencies
RUN composer install --no-dev --optimize-autoloader

# Create non-root user for security
RUN addgroup -g 1000 -S www && adduser -u 1000 -S www -G www
USER www

# Expose PHP-FPM port
EXPOSE 9000

# Start PHP-FPM
CMD ["php-fpm"]
```

---

## Step 2: PHP Configuration

```ini
; docker/php/php.ini
[PHP]
display_errors = Off
error_reporting = E_ALL
log_errors = On
error_log = /var/log/php/error.log

memory_limit = 256M
max_execution_time = 60
upload_max_filesize = 64M
post_max_size = 64M

; Session
session.gc_maxlifetime = 1440

; OpCache (critical for production performance)
[opcache]
opcache.enable = 1
opcache.revalidate_freq = 0
opcache.validate_timestamps = 0
opcache.max_accelerated_files = 10000
opcache.memory_consumption = 192
opcache.interned_strings_buffer = 16
opcache.fast_shutdown = 1
```

---

## Step 3: Nginx Configuration

```nginx
# docker/nginx/default.conf
server {
    listen 80;
    server_name localhost;
    root /var/www/public;   # must match WORKDIR + public folder

    index index.php index.html;

    # Serve static files directly, route everything else to PHP
    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    # Pass PHP files to PHP-FPM container
    location ~ \.php$ {
        fastcgi_pass php:9000;           # "php" = container name from docker-compose
        fastcgi_index index.php;
        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
        include fastcgi_params;
    }

    # Deny access to hidden files
    location ~ /\.ht {
        deny all;
    }

    # Logging
    error_log  /var/log/nginx/error.log;
    access_log /var/log/nginx/access.log;
}
```

---

## Step 4: docker-compose.yml

```yaml
# docker-compose.yml
version: '3.8'

services:

  # PHP-FPM service
  php:
    build:
      context: .
      dockerfile: docker/php/Dockerfile
    container_name: app_php
    restart: unless-stopped
    volumes:
      - ./src:/var/www                    # mount source code (dev only)
      - ./docker/php/php.ini:/usr/local/etc/php/php.ini
    networks:
      - app-network
    depends_on:
      - mysql
      - redis
    environment:
      - DB_HOST=mysql
      - DB_PORT=3306
      - DB_DATABASE=${DB_DATABASE}
      - DB_USERNAME=${DB_USERNAME}
      - DB_PASSWORD=${DB_PASSWORD}
      - REDIS_HOST=redis

  # Nginx web server
  nginx:
    image: nginx:alpine
    container_name: app_nginx
    restart: unless-stopped
    ports:
      - "8080:80"                         # host:container port mapping
    volumes:
      - ./src:/var/www
      - ./docker/nginx/default.conf:/etc/nginx/conf.d/default.conf
    networks:
      - app-network
    depends_on:
      - php

  # MySQL database
  mysql:
    image: mysql:8.0
    container_name: app_mysql
    restart: unless-stopped
    ports:
      - "3306:3306"                       # expose for local DB tools
    environment:
      MYSQL_DATABASE: ${DB_DATABASE}
      MYSQL_USER: ${DB_USERNAME}
      MYSQL_PASSWORD: ${DB_PASSWORD}
      MYSQL_ROOT_PASSWORD: ${DB_ROOT_PASSWORD}
    volumes:
      - mysql_data:/var/lib/mysql         # persist DB data
      - ./docker/mysql/init.sql:/docker-entrypoint-initdb.d/init.sql
    networks:
      - app-network

  # Redis cache
  redis:
    image: redis:7-alpine
    container_name: app_redis
    restart: unless-stopped
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    networks:
      - app-network

  # Optional: phpMyAdmin for DB UI
  phpmyadmin:
    image: phpmyadmin:latest
    container_name: app_phpmyadmin
    restart: unless-stopped
    ports:
      - "8081:80"
    environment:
      PMA_HOST: mysql
    networks:
      - app-network
    profiles:
      - dev                               # only starts with --profile dev

volumes:
  mysql_data:
  redis_data:

networks:
  app-network:
    driver: bridge
```

---

## Step 5: Environment Variables

```bash
# .env
DB_DATABASE=myapp
DB_USERNAME=myapp_user
DB_PASSWORD=secret123
DB_ROOT_PASSWORD=root_secret
APP_ENV=local
APP_DEBUG=true
```

---

## Step 6: Application Code

```php
<?php
// src/public/index.php

$host     = getenv('DB_HOST')     ?: 'mysql';
$dbname   = getenv('DB_DATABASE') ?: 'myapp';
$username = getenv('DB_USERNAME') ?: 'root';
$password = getenv('DB_PASSWORD') ?: '';

try {
    $pdo = new PDO("mysql:host=$host;dbname=$dbname", $username, $password);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

    $stmt = $pdo->query('SELECT NOW() as time');
    $row  = $stmt->fetch();

    echo "Connected! Server time: " . $row['time'];
} catch (PDOException $e) {
    echo "Connection failed: " . $e->getMessage();
}
```

---

## Common Docker Commands

```bash
# Start all services (detached mode)
docker compose up -d

# Start with rebuild (after Dockerfile changes)
docker compose up -d --build

# View running containers
docker compose ps

# View logs
docker compose logs -f           # all services
docker compose logs -f php        # just PHP

# Execute commands inside a container
docker compose exec php bash            # open shell in PHP container
docker compose exec php php artisan migrate
docker compose exec php composer install

# Stop all services
docker compose down

# Stop and remove volumes (DELETES database data!)
docker compose down -v

# Restart a single service
docker compose restart php

# Build image without starting
docker compose build php

# Run a one-off command
docker compose run --rm php php -v
```

---

## Development vs Production

### Development (docker-compose.yml)
- Mount source code as volume (changes reflect immediately)
- Enable Xdebug
- Show errors

### Production (docker-compose.prod.yml)
- COPY code into image (immutable)
- No Xdebug
- Hide errors, enable OpCache

```yaml
# docker-compose.prod.yml — overrides for production
version: '3.8'
services:
  php:
    build:
      target: production        # multi-stage build target
    environment:
      APP_ENV: production
      APP_DEBUG: "false"
    # NO volume mount — code is baked into image
```

```bash
# Deploy production
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

---

## Multi-Stage Builds (Best Practice for Production)

```dockerfile
# Dockerfile with multi-stage build

# Stage 1: Install dependencies (has composer, dev tools)
FROM php:8.3-fpm-alpine AS builder
COPY --from=composer:latest /usr/bin/composer /usr/bin/composer
WORKDIR /app
COPY src/composer.json src/composer.lock ./
RUN composer install --no-dev --no-scripts --prefer-dist

# Stage 2: Production image (lean, no composer)
FROM php:8.3-fpm-alpine AS production
RUN docker-php-ext-install pdo pdo_mysql opcache
WORKDIR /var/www
COPY --from=builder /app/vendor ./vendor   # copy only built vendor
COPY src/ .
RUN adduser -D www && chown -R www /var/www
USER www
CMD ["php-fpm"]
```

**Result:** Production image has no Composer, no dev dependencies, smaller attack surface.

---

## Debugging with Xdebug

```dockerfile
# Add to Dockerfile for development only
RUN pecl install xdebug && docker-php-ext-enable xdebug
```

```ini
; docker/php/xdebug.ini
[xdebug]
xdebug.mode = debug
xdebug.start_with_request = yes
xdebug.client_host = host.docker.internal  ; connects to your IDE on the host
xdebug.client_port = 9003
```

---

## Pros and Cons of Docker

### Pros
- **Consistency** — identical environment from dev to production
- **Isolation** — each project has its own PHP version, extensions, config
- **Onboarding** — new devs up and running with one command
- **Reproducibility** — exact same build forever
- **Microservices ready** — natural fit for service-oriented architectures
- **Easy cleanup** — destroy container, no leftover config on your machine

### Cons
- **Learning curve** — Dockerfile, networking, volumes, compose syntax
- **Performance overhead** — slight overhead vs native (minimal on Linux, more noticeable on Mac/Windows via VM)
- **Complexity** — adds a layer of abstraction to debug
- **Disk space** — images accumulate, need periodic cleanup (`docker system prune`)
- **Windows/Mac quirks** — file system performance in volumes can be slow

---

## Interview Q&A

**Q: What is Docker and why do we use it?**
A: Docker is a containerization platform that packages an application with all its dependencies into a lightweight, isolated container. We use it to eliminate environment inconsistencies ("works on my machine"), speed up onboarding, and ensure production matches development exactly.

**Q: What is the difference between a Docker image and a container?**
A: An image is a read-only blueprint (like a class). A container is a running instance of an image (like an object). You build images with Dockerfiles and run them as containers. Multiple containers can run from the same image simultaneously.

**Q: What is docker-compose?**
A: docker-compose is a tool for defining and running multi-container applications. You declare all services (PHP, Nginx, MySQL, Redis) in a `docker-compose.yml` file and manage them together with a single command (`docker compose up/down`). It handles networking, volumes, and dependencies between services.

**Q: What is a volume in Docker?**
A: A volume is a persistent storage mechanism that exists outside the container's lifecycle. Without volumes, data is lost when a container stops. You use volumes to persist database files, share source code between host and container (in development), and share data between containers.

**Q: What is PHP-FPM and why is it used with Nginx?**
A: PHP-FPM (FastCGI Process Manager) is a PHP runtime that handles PHP requests via the FastCGI protocol. Nginx is a high-performance web server but can't execute PHP natively. Nginx handles static files and HTTP, then passes `.php` requests to PHP-FPM via FastCGI. Together they're faster and more resource-efficient than Apache+mod_php.
