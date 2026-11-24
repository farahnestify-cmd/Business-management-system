<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Channels and price tiers (Dealer Gold, Partner Silver…): which price column
 * a contact is quoted from, the channel discount on top, and a yearly target.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('price_tiers', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('code', 20)->nullable();
            $table->string('basis', 20)->default('End user'); // End user | Dealer
            $table->decimal('discount_pct', 6, 4)->default(0); // fraction, 0.15 = 15%
            $table->decimal('target_year', 14, 2)->default(0);
            $table->boolean('active')->default(true);
            $table->timestamps();
        });
        Schema::table('clients', function (Blueprint $table) {
            $table->foreignId('tier_id')->nullable()->after('type')->constrained('price_tiers')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('clients', function (Blueprint $table) {
            $table->dropConstrainedForeignId('tier_id');
        });
        Schema::dropIfExists('price_tiers');
    }
};
