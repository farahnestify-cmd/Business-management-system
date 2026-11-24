<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The branded quotation: logo and cover photo (kept in the database as
 * data URLs so they travel with backups and need no writable folder on the
 * host), the opening paragraph, the points the customer should know, and
 * the small print on the cover.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('company_settings', function (Blueprint $table) {
            $table->longText('logo_data')->nullable();
            $table->longText('hero_data')->nullable();
            $table->text('intro_text')->nullable();
            $table->text('offer_notes')->nullable();
            $table->string('cover_note')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('company_settings', function (Blueprint $table) {
            $table->dropColumn(['logo_data', 'hero_data', 'intro_text', 'offer_notes', 'cover_note']);
        });
    }
};
