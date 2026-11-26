<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/** The line under the name on every document: "where your home gets a brain." */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('company_settings')->where(fn ($q) => $q->whereNull('tagline')->orWhere('tagline', '')->orWhere('tagline', 'Smart Home Systems'))
            ->update(['tagline' => 'where your home gets a brain.']);
    }

    public function down(): void
    {
        //
    }
};
