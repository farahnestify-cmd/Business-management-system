<?php

use App\Http\Middleware\EnsureInstalled;
use App\Http\Middleware\OwnerOnly;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Support\Facades\Route;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
        then: function () {
            Route::group([], __DIR__.'/../routes/install.php');
        },
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->prepend(EnsureInstalled::class);
        $middleware->alias(['owner' => OwnerOnly::class]);
        $middleware->redirectGuestsTo(fn () => route('login'));
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        // API calls always get JSON errors, even without an Accept header.
        $exceptions->shouldRenderJsonWhen(fn ($request) => $request->is('api/*') || $request->expectsJson());
    })->create();
