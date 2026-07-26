# Covariance & Contravariance in PHP

## TL;DR
**Covariance** means a child class can return a **more specific type** than the parent declared. **Contravariance** means a child class can accept a **more general (wider) type** in its parameters than the parent declared. Together they let you refine method signatures in subclasses without breaking the Liskov Substitution Principle — code that uses the parent type can safely use a child type.

---

## Why This Matters (The Problem)

PHP enforces type safety in inheritance. When you override a method, you can't just change the types arbitrarily — that would break polymorphism. But sometimes you *want* to narrow the return type or widen the parameter type. Covariance and contravariance define the safe rules for doing this.

```php
// Parent says: "I return an Animal"
// Child says:  "I return a Dog" (more specific — is this allowed?)

// Parent says: "I accept a Dog"
// Child says:  "I accept any Animal" (more general — is this allowed?)
```

PHP 7.4 introduced full support for both.

---

## The Type Hierarchy (Used Throughout)

```
Animal
├── Dog
│   └── Labrador
└── Cat
```

```php
class Animal {}
class Dog extends Animal {}
class Labrador extends Dog {}
class Cat extends Animal {}
```

---

## 1. Covariance (Return Types)

> **Covariance:** A child class method may return a **more specific (narrower) type** than the parent.

The child's return type must be a **subtype** of the parent's return type.

```php
interface AnimalShelter {
    public function adopt(): Animal; // parent returns Animal
}

class DogShelter implements AnimalShelter {
    public function adopt(): Dog { // ✅ Dog is a subtype of Animal — COVARIANT
        return new Dog();
    }
}

class CatShelter implements AnimalShelter {
    public function adopt(): Cat { // ✅ Cat is a subtype of Animal — COVARIANT
        return new Cat();
    }
}

// Usage — polymorphism works perfectly
function adoptFromShelter(AnimalShelter $shelter): void {
    $animal = $shelter->adopt(); // caller expects Animal — gets Dog or Cat (both ARE Animals)
    $animal->greet();            // safe — Dog and Cat both extend Animal
}
```

**Why is this safe?** Because a `Dog` IS an `Animal`. Anyone expecting an `Animal` will work fine with a `Dog`. The child narrows the promise (more specific), which is always safe for callers.

```php
// Another real-world example: Repository pattern
interface Repository {
    public function find(int $id): ?Model;
}

class UserRepository implements Repository {
    public function find(int $id): ?User { // ✅ User extends Model — covariant
        return User::find($id);
    }
}

class PostRepository implements Repository {
    public function find(int $id): ?Post { // ✅ Post extends Model — covariant
        return Post::find($id);
    }
}
```

### Covariance Violation (what PHP rejects)

```php
interface AnimalShelter {
    public function adopt(): Dog;
}

class BrokenShelter implements AnimalShelter {
    public function adopt(): Animal { // ❌ Animal is WIDER than Dog — INVALID
        return new Animal();          // Caller expects a Dog, gets Animal — unsafe
    }
}
// Fatal error: Return type must be Dog or a subtype of Dog
```

---

## 2. Contravariance (Parameter Types)

> **Contravariance:** A child class method may accept a **more general (wider) type** than the parent.

The child's parameter type must be a **supertype** of the parent's parameter type.

```php
interface Trainer {
    public function train(Dog $dog): void; // parent accepts Dog
}

class AnimalTrainer implements Trainer {
    public function train(Animal $animal): void { // ✅ Animal is wider than Dog — CONTRAVARIANT
        // Can train any Animal, including Dog — so it satisfies the contract
        $animal->learn();
    }
}
```

**Why is this safe?** The parent contract says "I can train a Dog". The child says "I can train ANY Animal, including Dogs". Any caller passing a Dog still works — the child accepts it. The child is *more capable*, not less.

```php
// Real-world: event handlers / callbacks
interface ClickHandler {
    public function handle(MouseEvent $event): void;
}

class AnyEventHandler implements ClickHandler {
    public function handle(Event $event): void { // ✅ Event is wider than MouseEvent
        log($event->getName());
    }
}

// The caller passes a MouseEvent — AnyEventHandler handles it fine
// because MouseEvent IS an Event
```

### Contravariance Violation (what PHP rejects)

```php
interface Trainer {
    public function train(Animal $animal): void;
}

class BrokenTrainer implements Trainer {
    public function train(Dog $dog): void { // ❌ Dog is NARROWER than Animal — INVALID
        // Caller might pass a Cat — BrokenTrainer can't handle it
    }
}
// Fatal error: Declaration must be compatible with Trainer::train(Animal $animal)
```

---

## 3. Both Together

```php
abstract class AnimalFactory {
    abstract public function createFood(Animal $animal): Food;
}

class DogFactory extends AnimalFactory {
    // Contravariance: accepts Animal (wider than Dog — parent might have said Dog)
    // Covariance: returns DogFood (narrower than Food)
    public function createFood(Animal $animal): DogFood {
        return new DogFood($animal->getWeight());
    }
}
```

---

## 4. Union Types and Contravariance (PHP 8.0+)

```php
class A {
    public function foo(int $value): int|float { return $value; }
}

class B extends A {
    // Contravariance: accepts int|float (wider than int)
    // Covariance: returns int (narrower than int|float)
    public function foo(int|float $value): int {
        return (int) $value;
    }
}
```

---

## 5. Nullable Types

`?Dog` (nullable Dog) is wider than `Dog` (non-nullable):

```php
class Parent {
    public function get(): Dog { ... }       // not nullable
}

class Child extends Parent {
    public function get(): Dog { ... }       // ✅ same
    // public function get(): ?Dog { ... }   // ❌ wider return — not allowed
    // public function get(): Labrador { ... }// ✅ narrower — allowed (covariant)
}

class ParentParam {
    public function set(Dog $d): void { ... }
}

class ChildParam extends ParentParam {
    public function set(?Dog $d): void { ... } // ✅ wider param — allowed (contravariant)
}
```

---

## Memory Aid

```
                  COVARIANCE            CONTRAVARIANCE
                  (return types)        (parameter types)

Direction:        More SPECIFIC         More GENERAL
                  (narrow down)         (widen out)

Safe because:     Caller gets           Caller can still
                  at least what         pass what parent
                  parent promised       expected

Rule:             Child return ⊆        Child param ⊇
                  Parent return         Parent param

Arrow direction:  Return types          Param types go
                  go DOWN               UP the hierarchy
                  (more specific)       (more general)
```

---

## Liskov Substitution Principle Connection

Covariance and contravariance are the formal rules that enforce the **Liskov Substitution Principle (LSP)**:

> *If S is a subtype of T, then objects of type T may be replaced with objects of type S without breaking the program.*

- **Covariant returns:** Child returns something more specific — still satisfies the parent's contract ✓
- **Contravariant params:** Child accepts something more general — can handle everything the parent promised ✓
- **Invariant (neither):** Same type in child as parent ✓
- **Wider returns / Narrower params:** Both break LSP ✗

---

## Pros and Cons

### Pros
- Enables proper polymorphism — write code against abstractions, get concrete behavior
- Enforces LSP at the language level
- More expressive type system — repository patterns, factories, handlers become cleaner
- Caught at compile time — type errors surface before runtime

### Cons
- Conceptually confusing — especially contravariance (counterintuitive to most developers)
- Requires careful design of class hierarchies
- Complex union types with variance can be hard to reason about

---

## Interview Q&A

**Q: What is covariance in PHP?**
A: Covariance applies to return types. A child class method can return a more specific (narrower) type than the parent's declared return type. For example, if the parent returns `Animal`, the child can return `Dog` (a subtype of Animal). This is safe because callers expecting an `Animal` will work fine with a `Dog`.

**Q: What is contravariance in PHP?**
A: Contravariance applies to parameter types. A child class method can accept a more general (wider) type than the parent's parameter type. If the parent accepts a `Dog`, the child can accept an `Animal`. This is safe because any `Dog` passed by the caller is also an `Animal` — the child handles it fine.

**Q: How do covariance and contravariance relate to LSP?**
A: They are the formal type-system rules that enforce LSP. LSP says a subtype must be fully substitutable for its parent. Covariant returns and contravariant parameters guarantee this: the child never fails where the parent would succeed. Widening return types or narrowing parameter types in a child would break substitutability.

**Q: When was covariance/contravariance added to PHP?**
A: PHP 7.4 introduced full support. Before that, PHP enforced strict type invariance in method signatures, making proper polymorphic design difficult without workarounds.
