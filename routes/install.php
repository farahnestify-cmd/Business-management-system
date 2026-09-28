<?php

use App\Http\Controllers\InstallController;
use Illuminate\Support\Facades\Route;

// Registered without the "web" middleware group: before setup there is no
// APP_KEY for cookies/sessions yet. EnsureInstalled closes it afterwards.
Route::get('/install', [InstallController::class, 'show']);
Route::post('/install', [InstallController::class, 'store']);
