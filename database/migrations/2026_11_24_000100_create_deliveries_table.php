<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * One row per item handed over in a delivery round, so each product's
 * history shows who received how many and when. Deliveries made before
 * this log existed are recorded once, on the deal's delivery date.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('deliveries', function (Blueprint $table) {
            $table->id();
            $table->foreignId('transaction_id')->constrained('transactions')->cascadeOnDelete();
            $table->foreignId('transaction_item_id')->constrained('transaction_items')->cascadeOnDelete();
            $table->integer('qty');
            $table->date('delivered_on')->index();
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });

        $rows = DB::table('transaction_items as i')
            ->join('transactions as t', 't.id', '=', 'i.transaction_id')
            ->where('i.delivered_qty', '>', 0)
            ->select('i.id', 'i.transaction_id', 'i.delivered_qty', 't.delivered_date', 't.invoice_date')
            ->get();
        foreach ($rows as $r) {
            DB::table('deliveries')->insert([
                'transaction_id' => $r->transaction_id,
                'transaction_item_id' => $r->id,
                'qty' => $r->delivered_qty,
                'delivered_on' => $r->delivered_date ?? $r->invoice_date ?? now()->toDateString(),
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('deliveries');
    }
};
