<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Revisions: a quotation read again for the client keeps its reference and
 * gains a version (2611WD04-V2), so the month counter is shared across
 * versions. Offer sets: rows saved once and dropped into any offer.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('transactions', function (Blueprint $table) {
            $table->string('root_ref', 20)->nullable()->after('ref_no');
            $table->unsignedInteger('version')->default(1)->after('root_ref');
            $table->unsignedBigInteger('set_id')->nullable()->after('created_by');
        });
        Schema::table('transactions', function (Blueprint $table) {
            $table->dropUnique(['yymm', 'seq']);
            $table->unique(['yymm', 'seq', 'version']);
        });

        Schema::create('offer_sets', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->longText('lines');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('offer_sets');
        Schema::table('transactions', function (Blueprint $table) {
            $table->dropUnique(['yymm', 'seq', 'version']);
            $table->unique(['yymm', 'seq']);
        });
        Schema::table('transactions', function (Blueprint $table) {
            $table->dropColumn(['root_ref', 'version', 'set_id']);
        });
    }
};
