# Advanced SQL & Database Programmability — Joins to Sharding (Java & PHP)

## TL;DR
This is the "everything a Senior Backend Engineer should be fluent in" reference for relational databases — from everyday **Joins** and **Indexes** to database-side programmability (**Views, Triggers, Procedures, Functions, Variables**) and scale-out concerns (**Partitioning, Sharding**). Every topic is written as **Problem → What It Solves → How It Works**, with a runnable SQL example plus how you'd actually touch it from **Java (JDBC)** and **PHP (PDO)** application code, because interviewers at large-scale tech companies care as much about "how does your app talk to the DB safely and fast" as they do about raw SQL syntax.

---

## Roadmap

```
                    DATABASE INTERVIEW SURFACE
                             │
      ┌──────────────┬───────┼───────┬──────────────┐
      │              │               │              │
   Querying     Programmability   Performance     Scale-Out
      │              │               │              │
   Joins         Views           Query Profiling  Partitioning
   Subqueries    Triggers        Indexing         Sharding
   CTEs          Procedures      Batch/Pooling
   Set Ops       Functions
   JSON          Variables
                 Constraints
                 Transactions
```

---

## Sections

Each topic below is its own page — problem, what it solves, how it works, complexity, and Java/PHP usage.

1. [Joins](Data-and-Persistence/advanced-sql/joins)
2. [Indexes](Data-and-Persistence/advanced-sql/indexes)
3. [Constraints](Data-and-Persistence/advanced-sql/constraints)
4. [Views](Data-and-Persistence/advanced-sql/views)
5. [Triggers](Data-and-Persistence/advanced-sql/triggers)
6. [Stored Procedures](Data-and-Persistence/advanced-sql/stored-procedures)
7. [Functions](Data-and-Persistence/advanced-sql/functions)
8. [Variables](Data-and-Persistence/advanced-sql/variables)
9. [Query Performance — Profiling & Optimization](Data-and-Persistence/advanced-sql/query-performance)
10. [Subqueries](Data-and-Persistence/advanced-sql/subqueries)
11. [CTEs (Common Table Expressions)](Data-and-Persistence/advanced-sql/ctes)
12. [Set Operations](Data-and-Persistence/advanced-sql/set-operations)
13. [Handling JSON](Data-and-Persistence/advanced-sql/handling-json)
14. [Transactions & Rollback](Data-and-Persistence/advanced-sql/transactions-and-rollback)
15. [Partitioning & Sharding](Data-and-Persistence/advanced-sql/partitioning-and-sharding)
16. [Interview Q&A (SSE Backend style)](Data-and-Persistence/advanced-sql/interview-qa)

---

## See Also
- [SQL Hands-on Practice](Data-and-Persistence/sql-practice) — JOINs, subqueries, CTEs, window functions from first principles
- [Data & Persistence Concepts](Data-and-Persistence/data-persistence-concepts) — ACID, isolation levels, N+1, pagination, CAP theorem
- [Database Types — SQL, NoSQL, Graph & Beyond](Data-and-Persistence/database-types) — choosing the right database for the job
