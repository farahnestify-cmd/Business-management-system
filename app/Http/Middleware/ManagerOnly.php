<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

/** Owner or admin: the catalogue and the company settings. */
class ManagerOnly
{
    public function handle(Request $request, Closure $next)
    {
        if (! $request->user()?->isManager()) {
            return response()->json(['message' => 'Only an owner or admin can do this.'], 403);
        }

        return $next($request);
    }
}
