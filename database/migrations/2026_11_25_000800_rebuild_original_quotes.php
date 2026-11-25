<?php

use App\Models\Transaction;
use Illuminate\Database\Migrations\Migration;

/**
 * Deals that had returns or extra items before the original quotation was kept
 * get it back, worked out from their delivery log.
 */
return new class extends Migration
{
    public function up(): void
    {
        Transaction::whereNull('quote_snapshot')->whereIn('status', ['Invoiced', 'Delivered'])
            ->each(fn (Transaction $t) => $t->rebuildOriginalQuote());
    }

    public function down(): void
    {
        //
    }
};
