<?php

use App\Http\Controllers\Api\AccountController;
use App\Http\Controllers\Api\BootstrapController;
use App\Http\Controllers\Api\DataController;
use App\Http\Controllers\Api\ExpenseController;
use App\Http\Controllers\Api\OfferSetController;
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
        Route::get('brand/{which}', [SettingsController::class, 'image'])->whereIn('which', ['logo', 'hero']);
        Route::get('images/base/{id}/type/{code}/{i}', [RecordController::class, 'typeImage'])->whereNumber('id')->whereNumber('i');
        Route::get('images/{kind}/{id}', [RecordController::class, 'image'])->whereIn('kind', ['product', 'base', 'cover'])->whereNumber('id');

        Route::post('transactions', [SalesController::class, 'store']);
        Route::post('transactions/{transaction}/payments', [SalesController::class, 'pay']);
        Route::put('transactions/{transaction}', [SalesController::class, 'update']);
        Route::post('transactions/{transaction}/advance', [SalesController::class, 'advance']);
        Route::post('transactions/{transaction}/deliver', [SalesController::class, 'deliver']);
        Route::post('transactions/{transaction}/returns', [SalesController::class, 'returnItem']);
        Route::post('transactions/{transaction}/extra', [SalesController::class, 'deliverExtra']);
        Route::post('transactions/{transaction}/colours', [SalesController::class, 'chooseColours']);
        Route::post('transactions/{transaction}/milestones/{milestone}/pay', [SalesController::class, 'payMilestone']);
        Route::post('transactions/{transaction}/refunds', [SalesController::class, 'refund']);
        Route::post('transactions/{transaction}/revise', [SalesController::class, 'revise']);
        Route::post('offer_sets', [OfferSetController::class, 'store']);
        Route::put('offer_sets/{offerSet}', [OfferSetController::class, 'update']);
        Route::delete('offer_sets/{offerSet}', [OfferSetController::class, 'destroy']);

        Route::post('account/password', [AccountController::class, 'password']);
        Route::post('undo/{token}', [DataController::class, 'undo'])->where('token', '[A-Za-z0-9]{32}');

        Route::middleware('manager')->group(function () {
            Route::put('settings', [SettingsController::class, 'update']);
            Route::put('brand/{which}', [SettingsController::class, 'saveImage'])->whereIn('which', ['logo', 'hero']);
            Route::delete('brand/{which}', [SettingsController::class, 'removeImage'])->whereIn('which', ['logo', 'hero']);
        });

        // Money and purchasing: the owner only.
        Route::middleware('owner')->group(function () {
            Route::post('purchase_orders', [PurchaseOrderController::class, 'store']);
            Route::put('purchase_orders/{purchaseOrder}', [PurchaseOrderController::class, 'update']);
            Route::post('purchase_orders/{purchaseOrder}/receive', [PurchaseOrderController::class, 'receive']);
            Route::delete('purchase_orders/{purchaseOrder}', [PurchaseOrderController::class, 'destroy']);
            Route::post('expenses', [ExpenseController::class, 'store']);
            Route::put('expenses/{expense}', [ExpenseController::class, 'update']);
            Route::delete('expenses/{expense}', [ExpenseController::class, 'destroy']);
            Route::delete('payments/{payment}', [SalesController::class, 'destroyPayment']);
            Route::get('backup', [DataController::class, 'backup']);
            Route::get('backups', [DataController::class, 'backups']);
            Route::post('backups', [DataController::class, 'backupNow']);
            Route::put('backups/settings', [DataController::class, 'backupSettings']);
            Route::get('backups/{name}', [DataController::class, 'downloadBackup'])->where('name', '[A-Za-z0-9._-]+');
            Route::post('restore', [DataController::class, 'restore']);
            Route::post('deleted/{deletedRecord}/restore', [DataController::class, 'restoreDeleted']);
            Route::delete('deleted/{deletedRecord}', [DataController::class, 'forget']);
            Route::delete('deleted', [DataController::class, 'emptyBin']);
            Route::post('payroll_payments', [PayrollController::class, 'store']);
            Route::delete('payroll_payments/{payrollPayment}', [PayrollController::class, 'destroy']);
            Route::post('users', [AccountController::class, 'store']);
            Route::put('users/{user}', [AccountController::class, 'update']);
            Route::delete('users/{user}', [AccountController::class, 'destroy']);
        });

        $records = ['clients', 'products', 'bases', 'covers', 'suppliers', 'employees', 'services', 'price_tiers', 'currencies', 'cover_types'];
        Route::post('{collection}', [RecordController::class, 'store'])->whereIn('collection', $records);
        Route::put('{collection}/{id}', [RecordController::class, 'update'])->whereIn('collection', $records)->whereNumber('id');
        Route::delete('{collection}/{id}', [RecordController::class, 'destroy'])->whereIn('collection', $records)->whereNumber('id');
    });
});
