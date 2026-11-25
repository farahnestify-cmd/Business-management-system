<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Cover types (Q, S…): an offer names the base and the type only, priced as the
 * base plus the type's add-on; the colours are chosen once the client agrees.
 * Each base keeps its own pictures for each type, printed in the offer.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('cover_types', function (Blueprint $table) {
            $table->id();
            $table->string('code', 20)->unique();      // matches covers.line, e.g. Q
            $table->string('name')->nullable();
            $table->decimal('add_on_end_user', 12, 2)->default(0);
            $table->decimal('add_on_dealer', 12, 2)->default(0);
            $table->timestamps();
        });
        Schema::table('bases', function (Blueprint $table) {
            $table->longText('type_images')->nullable(); // {"Q": [data URL, …], "S": […]}
        });
        Schema::table('transaction_items', function (Blueprint $table) {
            $table->string('cover_type', 20)->nullable();
        });

        // The cover lines already in use become types, and old lines know theirs.
        $codes = DB::table('covers')->whereNotNull('line')->where('line', '!=', '')->distinct()->pluck('line');
        foreach ($codes as $code) {
            DB::table('cover_types')->insert(['code' => $code, 'name' => $code, 'created_at' => now(), 'updated_at' => now()]);
        }
        foreach (DB::table('covers')->whereNotNull('line')->get(['id', 'line']) as $c) {
            DB::table('transaction_items')->where('cover_id', $c->id)->update(['cover_type' => $c->line]);
        }
    }

    public function down(): void
    {
        Schema::table('transaction_items', function (Blueprint $table) {
            $table->dropColumn('cover_type');
        });
        Schema::table('bases', function (Blueprint $table) {
            $table->dropColumn('type_images');
        });
        Schema::dropIfExists('cover_types');
    }
};
