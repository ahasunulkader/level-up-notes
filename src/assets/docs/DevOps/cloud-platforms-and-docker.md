# Cloud Platforms (AWS, GCP, Azure) & Docker

## TL;DR
**Cloud platforms** rent you compute, storage, and managed services so you don't run your own servers. **AWS** leads in market share, **GCP** in data/ML, **Azure** in enterprise/Microsoft shops. **Docker** packages apps with their dependencies into portable containers. In interviews: show you understand *why* containers exist, name a handful of core cloud services, and explain the trade-off between managed vs self-managed.

---

## Part 1: Cloud Platforms

## Why Cloud? (The Core Idea)

**Before cloud:** You buy physical servers, wait weeks for delivery, pay whether you use them or not, manage hardware failures yourself.

**After cloud:**
```
On-Demand Resources:
  Need 1 server?  → launch in 30 seconds
  Need 100?       → auto-scale in minutes
  Done with them? → terminate, stop paying

Pay-as-you-go:
  Cost = (resources used) × (time used)
```

---

## Cloud Service Models

```
┌─────────────────────────────────────────────────────┐
│  SaaS  — You use the app (Gmail, Salesforce)        │
├─────────────────────────────────────────────────────┤
│  PaaS  — You deploy code, cloud manages servers     │
│          (Heroku, App Engine, Elastic Beanstalk)     │
├─────────────────────────────────────────────────────┤
│  IaaS  — You get raw VMs, storage, networking       │
│          (EC2, Compute Engine, Azure VMs)            │
├─────────────────────────────────────────────────────┤
│  Physical Hardware (you manage everything)           │
└─────────────────────────────────────────────────────┘
  ▲ More control                    More managed ▲
```

**Your responsibility increases as you go lower.**

---

## AWS — Core Services to Know

### Compute
| Service | What It Does | Interview One-Liner |
|---|---|---|
| **EC2** | Virtual machines (IaaS) | "Rented VMs — you control the OS and above" |
| **Lambda** | Serverless functions | "Run code on events, no server to manage, pay per invocation" |
| **ECS/EKS** | Container orchestration | "ECS is AWS-native, EKS is managed Kubernetes" |
| **Elastic Beanstalk** | PaaS for web apps | "Upload your code, AWS handles scaling and servers" |

### Storage
| Service | What It Does | Interview One-Liner |
|---|---|---|
| **S3** | Object storage | "Store files/blobs — cheap, durable, globally accessible" |
| **RDS** | Managed relational DB | "Managed MySQL/Postgres — AWS handles backups, patching" |
| **DynamoDB** | Managed NoSQL | "Key-value/document DB — millisecond latency at any scale" |
| **ElastiCache** | Managed Redis/Memcached | "In-memory cache — session storage, hot data" |

### Networking / Other
| Service | What It Does | Interview One-Liner |
|---|---|---|
| **VPC** | Virtual private network | "Isolated network — control who can reach your resources" |
| **CloudFront** | CDN | "Cache static assets at edge locations globally" |
| **SQS** | Message queue | "Decouple services — producer pushes, consumer pulls" |
| **SNS** | Pub/sub notifications | "Fan-out messages to multiple subscribers" |
| **IAM** | Identity & access management | "Controls who/what can access which AWS resources" |

---

## GCP — Core Services (Comparison)

| AWS | GCP Equivalent | What It Does |
|---|---|---|
| EC2 | Compute Engine | Virtual machines |
| Lambda | Cloud Functions | Serverless |
| EKS | GKE (Google Kubernetes Engine) | Managed K8s — Google invented Kubernetes |
| S3 | Cloud Storage | Object storage |
| RDS | Cloud SQL | Managed relational DB |
| DynamoDB | Firestore / Bigtable | NoSQL — Firestore for apps, Bigtable for analytics |
| CloudFront | Cloud CDN | Content delivery |
| SQS | Pub/Sub | Message queue |

**GCP's strength:** Big data (BigQuery), AI/ML (Vertex AI), Kubernetes (they built it).

---

## Azure — Core Services (Comparison)

| AWS | Azure Equivalent | What It Does |
|---|---|---|
| EC2 | Azure VMs | Virtual machines |
| Lambda | Azure Functions | Serverless |
| EKS | AKS (Azure Kubernetes Service) | Managed K8s |
| S3 | Azure Blob Storage | Object storage |
| RDS | Azure SQL Database | Managed SQL Server / PostgreSQL |
| ElastiCache | Azure Cache for Redis | Managed Redis |
| SQS | Azure Service Bus / Queue Storage | Message queuing |

**Azure's strength:** Enterprise integration, Active Directory/AD integration, Microsoft ecosystem (Office 365, Teams, .NET).

---

## Cloud Architecture Concepts

### Regions and Availability Zones
```
AWS Region: ap-southeast-1 (Singapore)
  │
  ├── Availability Zone: ap-southeast-1a  (data center 1)
  ├── Availability Zone: ap-southeast-1b  (data center 2)
  └── Availability Zone: ap-southeast-1c  (data center 3)

Deploy across AZs → survive a single data center failure
Deploy across Regions → survive a regional disaster
```

### Auto Scaling
```
Traffic spike:
  10 AM: 100 req/s  → 2 EC2 instances
  12 PM: 5000 req/s → auto-scales to 20 instances
  2 PM:  200 req/s  → scales back to 3 instances
```

---

## Part 2: Docker & Containerization

## The Problem Docker Solves

**"Works on my machine" problem:**
```
Developer's machine:    PHP 8.1, MySQL 5.7, Redis 6
Staging server:         PHP 8.0, MySQL 8.0, Redis 7
Production server:      PHP 7.4, MySQL 8.0, Redis 5

Result: Different behavior in each environment
```

**Docker's solution:** Bundle the app + its exact dependencies into one portable unit.

---

## VMs vs Containers

```
Virtual Machines:                    Containers:
┌──────────────────┐                ┌──────────────────┐
│  App A           │                │  App A           │
│  OS (2GB RAM)    │                ├──────────────────┤
├──────────────────┤                │  App B           │
│  App B           │                ├──────────────────┤
│  OS (2GB RAM)    │                │  Docker Engine   │
├──────────────────┤                ├──────────────────┤
│  Hypervisor      │                │  Host OS         │
├──────────────────┤                ├──────────────────┤
│  Host Hardware   │                │  Host Hardware   │
└──────────────────┘                └──────────────────┘

Each VM: full OS copy (GBs)         Containers share host OS kernel
Startup: minutes                    Startup: milliseconds
```

**Key difference:** Containers are lightweight because they share the host OS kernel. VMs have full OS isolation.

---

## Core Docker Concepts

### Image vs Container
```
Dockerfile  ──build──►  Image  ──run──►  Container (running instance)
(recipe)               (template)       (like a process)

Image is immutable — like a class
Container is a running instance — like an object
One image can spawn many containers
```

### Dockerfile
```dockerfile
# Start from an official base image
FROM php:8.2-fpm

# Set working directory
WORKDIR /var/www/html

# Install system dependencies
RUN apt-get update && apt-get install -y \
    libpng-dev \
    && docker-php-ext-install pdo pdo_mysql gd

# Copy composer files first (layer caching optimization)
COPY composer.json composer.lock ./
RUN composer install --no-scripts --no-autoloader

# Copy application code
COPY . .

# Generate autoload
RUN composer dump-autoload --optimize

# Expose port
EXPOSE 9000

# Start PHP-FPM
CMD ["php-fpm"]
```

### Docker Layer Caching (Important for CI/CD)
```
Layer 1: FROM php:8.2-fpm          ← rarely changes, always cached
Layer 2: RUN apt-get install ...   ← rarely changes, usually cached
Layer 3: COPY composer.json ...    ← changes when deps change
Layer 4: RUN composer install      ← rebuilds when layer 3 changes
Layer 5: COPY . .                  ← changes every build (your code)
Layer 6: CMD ["php-fpm"]           ← rarely changes

Pro tip: Put frequently-changing layers LAST to maximize cache hits
```

---

## Docker Compose — Multi-Container Apps

```yaml
# docker-compose.yml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "8000:9000"
    volumes:
      - .:/var/www/html
    depends_on:
      - db
      - redis
    environment:
      DB_HOST: db
      REDIS_HOST: redis

  db:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: secret
      MYSQL_DATABASE: myapp
    volumes:
      - db_data:/var/lib/mysql

  redis:
    image: redis:7-alpine

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf
    depends_on:
      - app

volumes:
  db_data:
```

```bash
docker-compose up -d        # start all services in background
docker-compose down         # stop and remove containers
docker-compose logs -f app  # follow logs for 'app' service
docker-compose exec app bash # open shell in running container
```

---

## Docker Networking

```
Default bridge network:
┌─────────────────────────────────────────┐
│  Docker Network (bridge)                │
│  ┌─────────┐    ┌─────────┐            │
│  │  app    │───►│   db    │            │
│  │172.17.x │    │172.17.y │            │
│  └─────────┘    └─────────┘            │
└─────────────────────────────────────────┘
         ▲
    Host port mapping: 0.0.0.0:8000 → container:9000
```

Containers in the same Docker network reach each other **by service name** (e.g., `db`, `redis`).

---

## Docker Volumes — Persistent Data

```bash
# Named volume (managed by Docker) — for databases
volumes:
  db_data:/var/lib/mysql

# Bind mount (maps host path) — for development
volumes:
  ./src:/var/www/html   # live code editing without rebuilding
```

---

## Container Orchestration (Kubernetes Basics)

When you have dozens of containers across many servers, you need **orchestration**:

```
Kubernetes Cluster:
┌─────────────────────────────────────────────────────┐
│  Control Plane (master)                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ API      │  │Scheduler │  │Controller Manager│  │
│  │ Server   │  │          │  │(maintains desired│  │
│  └──────────┘  └──────────┘  │ state)           │  │
│                               └──────────────────┘  │
├─────────────────────────────────────────────────────┤
│  Worker Nodes                                        │
│  ┌──────────────┐  ┌──────────────┐                 │
│  │ Node 1       │  │ Node 2       │                 │
│  │ ┌───┐ ┌───┐ │  │ ┌───┐ ┌───┐ │                 │
│  │ │Pod│ │Pod│ │  │ │Pod│ │Pod│ │                 │
│  │ └───┘ └───┘ │  │ └───┘ └───┘ │                 │
│  └──────────────┘  └──────────────┘                 │
└─────────────────────────────────────────────────────┘
```

**Key K8s concepts:**
- **Pod** — smallest deployable unit, holds 1+ containers
- **Deployment** — declares desired state (e.g., "run 3 replicas of this pod")
- **Service** — stable network endpoint for a set of pods
- **Ingress** — HTTP routing rules (like nginx, but managed by K8s)

---

## Interview Q&A — Ready Answers

**Q: What is Docker and why would you use it?**
> "Docker packages an application with all its dependencies into a container — the exact versions of PHP, libraries, config. This eliminates 'works on my machine' problems since dev, CI, and production all run the same container. Containers also start in milliseconds, unlike VMs which boot a full OS."

**Q: What's the difference between an image and a container?**
> "An image is the static blueprint — an immutable snapshot built from a Dockerfile. A container is a running instance of that image. Like a class vs an object in OOP. You can run many containers from one image."

**Q: How would you structure a PHP app with Docker?**
> "I'd use Docker Compose with separate services: PHP-FPM for the app, Nginx as the web server, MySQL for the database, Redis for caching. Each service runs in its own container, connected via a Docker network. In development I use bind mounts for live code reloading; in production I bake the code into the image."

**Q: What cloud services have you used or would use for a web app?**
> "For a typical web app: EC2 or ECS for compute, RDS for the database, ElastiCache (Redis) for sessions and caching, S3 for file storage, CloudFront as CDN. For auto-scaling, I'd put EC2 in an Auto Scaling Group behind a Load Balancer. IAM roles control what each service can access."

**Q: What's the difference between AWS, GCP, and Azure?**
> "All three offer the same core services — compute, storage, managed databases, serverless. AWS has the largest market share and most mature ecosystem. GCP excels in Kubernetes (they built it) and big data with BigQuery. Azure dominates in enterprise environments, especially where there's Microsoft infrastructure — Active Directory integration is seamless. The choice often comes down to what the team already knows."

**Q: What is serverless and when would you use it?**
> "Serverless means you provide code, not servers. AWS Lambda runs your function in response to an event (HTTP request, S3 upload, queue message) and you pay per execution. Ideal for event-driven, spiky, or infrequent workloads — like image processing, webhook handlers, or scheduled jobs. Poor fit for sustained high traffic or long-running processes."

---

## Key Vocabulary

- **Immutable infrastructure** — deploy new instances instead of patching running ones
- **Blue-green deployment** — two identical environments, switch traffic between them
- **Load balancer** — distributes traffic across multiple instances
- **CDN (Content Delivery Network)** — caches assets at edge locations near users
- **Managed service** — cloud provider handles maintenance, patching, scaling
- **Multi-tenancy** — multiple customers share the same infrastructure (cloud's model)
- **FinOps** — practice of optimizing cloud costs
