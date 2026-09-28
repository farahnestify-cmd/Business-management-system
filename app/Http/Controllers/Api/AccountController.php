<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rule;

/**
 * Login accounts. The owner manages everyone; each person can change their
 * own password.
 */
class AccountController extends Controller
{
    public function store(Request $request)
    {
        $data = $request->validate([
            'name' => 'required|string|max:255',
            'email' => 'required|email|max:255|unique:users,email',
            'password' => 'required|string|min:8',
            'role' => 'required|in:owner,staff',
        ]);
        $user = User::create($data);

        return response()->json(['id' => (string) $user->id], 201);
    }

    public function update(Request $request, User $user)
    {
        $data = $request->validate([
            'name' => 'required|string|max:255',
            'email' => ['required', 'email', 'max:255', Rule::unique('users', 'email')->ignore($user->id)],
            'password' => 'nullable|string|min:8',
            'role' => 'required|in:owner,staff',
        ]);
        if ($user->isOwner() && $data['role'] !== 'owner' && User::where('role', 'owner')->count() === 1) {
            return response()->json(['message' => 'There must always be at least one owner.'], 409);
        }
        if (empty($data['password'])) {
            unset($data['password']);
        }
        $user->update($data);

        return response()->json(['id' => (string) $user->id]);
    }

    public function destroy(Request $request, User $user)
    {
        if ($user->id === $request->user()->id) {
            return response()->json(['message' => 'You cannot delete the account you are signed in with.'], 409);
        }
        $user->delete();

        return response()->json(['ok' => true]);
    }

    public function password(Request $request)
    {
        $data = $request->validate([
            'current' => 'required|string',
            'password' => 'required|string|min:8',
        ]);
        $user = $request->user();
        if (! Hash::check($data['current'], $user->password)) {
            return response()->json(['message' => 'Your current password is not right.'], 422);
        }
        $user->update(['password' => $data['password']]);

        return response()->json(['ok' => true]);
    }
}
