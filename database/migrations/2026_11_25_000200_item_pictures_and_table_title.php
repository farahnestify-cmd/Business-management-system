<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A picture for each stock item (shown in the Image column of printed offers)
 * and an optional heading printed over a deal's items table.
 */
return new class extends Migration
{
    public function up(): void
    {
        foreach (['products', 'bases', 'covers'] as $table) {
            Schema::table($table, function (Blueprint $t) {
                $t->longText('image_data')->nullable();
            });
        }
        Schema::table('transactions', function (Blueprint $t) {
            $t->string('table_title')->nullable();
        });
    }

    public function down(): void
    {
        foreach (['products', 'bases', 'covers'] as $table) {
            Schema::table($table, function (Blueprint $t) {
                $t->dropColumn('image_data');
            });
        }
        Schema::table('transactions', function (Blueprint $t) {
            $t->dropColumn('table_title');
        });
    }
};
