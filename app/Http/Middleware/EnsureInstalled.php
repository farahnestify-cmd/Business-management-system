<?php

namespace App\Http\Middleware;

use App\Support\Installer;
use Closure;
use Illuminate\Http\Request;

/**
 * Sends every request to the web installer until the app is set up, and
 * closes the installer once it is.
 */
class EnsureInstalled
{
    public function handle(Request $request, Closure $next)
    {
        $installing = $request->is('install');

        if (! Installer::installed() && ! $installing && ! $request->is('up')) {
            return redirect(rtrim($request->getBaseUrl(), '/').'/install');
        }
        if (Installer::installed() && $installing) {
            abort(404);
        }

        return $next($request);
    }
}
