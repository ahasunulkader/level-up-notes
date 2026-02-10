# Laravel Essentials

Laravel is a PHP framework for building modern web applications. It follows the **MVC** (Model-View-Controller) pattern.

## Artisan CLI

Artisan is Laravel's command-line tool. Here are the most common commands:

```bash
# Create things
php artisan make:model Post
php artisan make:controller PostController
php artisan make:migration create_posts_table
php artisan make:seeder PostSeeder

# Database
php artisan migrate
php artisan migrate:rollback
php artisan db:seed

# Development
php artisan serve          # Start dev server
php artisan route:list     # Show all routes
php artisan cache:clear    # Clear cache
```

## Routing

Routes define how your app responds to URLs:

```php
// routes/web.php

// Basic route
Route::get('/hello', function () {
    return 'Hello World!';
});

// Route with controller
Route::get('/posts', [PostController::class, 'index']);
Route::post('/posts', [PostController::class, 'store']);
Route::get('/posts/{id}', [PostController::class, 'show']);

// Resource route (creates all CRUD routes)
Route::resource('posts', PostController::class);
```

## Eloquent ORM

Eloquent is Laravel's database toolkit. Each table has a corresponding "Model":

```php
// Get all posts
$posts = Post::all();

// Find by ID
$post = Post::find(1);

// Query builder
$activePosts = Post::where('active', true)
    ->orderBy('created_at', 'desc')
    ->limit(10)
    ->get();

// Create
$post = Post::create([
    'title' => 'My First Post',
    'body' => 'This is the content.',
]);

// Update
$post->update(['title' => 'Updated Title']);

// Delete
$post->delete();
```

## Blade Templates

Blade is Laravel's templating engine:

```php
{{-- Display data (auto-escaped) --}}
<h1>{{ $post->title }}</h1>

{{-- Conditionals --}}
@if ($posts->count() > 0)
    <p>We have {{ $posts->count() }} posts.</p>
@else
    <p>No posts yet.</p>
@endif

{{-- Loops --}}
@foreach ($posts as $post)
    <div class="post">
        <h2>{{ $post->title }}</h2>
        <p>{{ $post->body }}</p>
    </div>
@endforeach

{{-- Layout inheritance --}}
@extends('layouts.app')

@section('content')
    <h1>My Page</h1>
@endsection
```

## Migrations

Migrations are version control for your database schema:

```php
// Create migration
// php artisan make:migration create_posts_table

public function up(): void
{
    Schema::create('posts', function (Blueprint $table) {
        $table->id();
        $table->string('title');
        $table->text('body');
        $table->boolean('active')->default(true);
        $table->foreignId('user_id')->constrained();
        $table->timestamps();
    });
}
```

> **Tip:** Never edit a migration that has already been run on production. Create a new migration instead.

## Validation

Laravel makes validation easy:

```php
// In controller
$validated = $request->validate([
    'title' => 'required|max:255',
    'body'  => 'required|min:10',
    'email' => 'required|email|unique:users',
]);
```

## Common Helpers

```php
// URLs
url('/posts');             // Full URL
route('posts.show', 1);    // Named route URL

// Strings
Str::slug('Hello World');  // "hello-world"
Str::limit($text, 100);    // Truncate text

// Collections
collect([1, 2, 3])->sum();     // 6
collect($items)->pluck('name'); // Get all names
collect($items)->groupBy('type'); // Group by field
```
