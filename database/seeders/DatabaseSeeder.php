<?php

namespace Database\Seeders;

use App\Models\CompanySetting;
use App\Models\User;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    /**
     * Creates the company settings row and the first owner account.
     * Change the password from Company settings after the first sign-in.
     */
    public function run(): void
    {
        CompanySetting::current();

        User::firstOrCreate(['email' => env('OWNER_EMAIL', 'owner@example.com')], [
            'name' => env('OWNER_NAME', 'Owner'),
            'password' => env('OWNER_PASSWORD', 'change-me-now'),
            'role' => 'owner',
        ]);
    }
}
