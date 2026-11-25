<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/** The brand is written "nestify", with a small n. */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('company_settings')->where('name', 'Nestify')->update(['name' => 'nestify']);
        DB::table('company_settings')->where('terms_agreement', 'like', '%Nestify remains%')
            ->update(['terms_agreement' => DB::raw("REPLACE(terms_agreement, 'Nestify remains', 'nestify remains')")]);
    }

    public function down(): void
    {
        //
    }
};
