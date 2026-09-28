<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

class OwnerOnly
{
    public function handle(Request $request, Closure $next)
    {
        if (! $request->user()?->isOwner()) {
            return response()->json(['message' => 'Only the owner can do this.'], 403);
        }

        return $next($request);
    }
}
