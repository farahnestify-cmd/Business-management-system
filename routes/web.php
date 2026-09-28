<?php

use App\Http\Controllers\Api\AccountController;
use App\Http\Controllers\Api\BootstrapController;
use App\Http\Controllers\Api\ExpenseController;
use App\Http\Controllers\Api\PayrollController;
use App\Http\Controllers\Api\PurchaseOrderController;
use App\Http\Controllers\Api\RecordController;
use App\Http\Controllers\Api\SalesController;
use App\Http\Controllers\Api\SettingsController;
use App\Http\Controllers\AppController;
use App\Http\Controllers\AuthController;
use Illuminate\Support\Facades\Route;

Route::get('/login', [AuthController::class, 'show'])->name('login');
Route::post('/login', [AuthController::class, 'login'])->middleware('throttle:10,1');
Route::post('/logout', [AuthController::class, 'logout'])->name('logout');

Route::middleware('auth')->group(function () {
    Route::get('/', AppController::class)->name('app');

    // JSON API used by public/assets/js/app.js (session cookie + CSRF header).
    Route::prefix('api')->group(function () {
        Route::get('bootstrap', BootstrapController::class);

        Route::post('transactions', [SalesController::class, 'store']);
        Route::post('transactions/{transaction}/payments', [SalesController::class, 'pay']);
        Route::post('transactions/{transaction}/advance', [SalesController::class, 'advance']);

        Route::post('purchase_orders', [PurchaseOrderController::class, 'store']);
        Route::put('purchase_orders/{purchaseOrder}', [PurchaseOrderController::class, 'update']);
        Route::post('purchase_orders/{purchaseOrder}/receive', [PurchaseOrderController::class, 'receive']);
        Route::delete('purchase_orders/{purchaseOrder}', [PurchaseOrderController::class, 'destroy']);

        Route::post('expenses', [ExpenseController::class, 'store']);
        Route::put('expenses/{expense}', [ExpenseController::class, 'update']);
        Route::delete('expenses/{expense}', [ExpenseController::class, 'destroy']);

        Route::post('account/password', [AccountController::class, 'password']);

        Route::middleware('owner')->group(function () {
            Route::put('settings', [SettingsController::class, 'update']);
            Route::post('payroll_payments', [PayrollController::class, 'store']);
            Route::delete('payroll_payments/{payrollPayment}', [PayrollController::class, 'destroy']);
            Route::post('users', [AccountController::class, 'store']);
            Route::put('users/{user}', [AccountController::class, 'update']);
            Route::delete('users/{user}', [AccountController::class, 'destroy']);
        });

        $records = ['clients', 'products', 'bases', 'covers', 'suppliers', 'employees'];
        Route::post('{collection}', [RecordController::class, 'store'])->whereIn('collection', $records);
        Route::put('{collection}/{id}', [RecordController::class, 'update'])->whereIn('collection', $records)->whereNumber('id');
        Route::delete('{collection}/{id}', [RecordController::class, 'destroy'])->whereIn('collection', $records)->whereNumber('id');
    });
});
