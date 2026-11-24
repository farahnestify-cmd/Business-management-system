<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Quoting in other currencies. The books stay in US dollars: every deal keeps
 * the currency it was written in and the rate (units per $1) used that day.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('currencies', function (Blueprint $table) {
            $table->id();
            $table->string('code', 3)->unique();
            $table->string('name');
            $table->string('symbol', 8)->nullable();
            $table->decimal('rate', 14, 6)->default(1); // units of this currency per $1
            $table->boolean('active')->default(true);
            $table->timestamps();
        });
        Schema::table('transactions', function (Blueprint $table) {
            $table->string('currency', 3)->default('USD')->after('vat_pct');
            $table->decimal('fx_rate', 14, 6)->default(1)->after('currency');
        });
    }

    public function down(): void
    {
        Schema::table('transactions', function (Blueprint $table) {
            $table->dropColumn(['currency', 'fx_rate']);
        });
        Schema::dropIfExists('currencies');
    }
};
