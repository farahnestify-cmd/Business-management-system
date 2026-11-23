<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Deals can now be delivered in parts: each line remembers how much of it
 * has been handed over. Lines of deals already delivered count as complete.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('transaction_items', function (Blueprint $table) {
            $table->integer('delivered_qty')->default(0)->after('qty');
        });

        DB::table('transaction_items')
            ->whereIn('transaction_id', DB::table('transactions')->where('status', 'Delivered')->select('id'))
            ->update(['delivered_qty' => DB::raw('qty')]);
    }

    public function down(): void
    {
        Schema::table('transaction_items', function (Blueprint $table) {
            $table->dropColumn('delivered_qty');
        });
    }
};
