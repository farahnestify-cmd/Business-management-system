<?php

namespace App\Support;

use App\Models\Base;
use App\Models\Cover;
use App\Models\DeletedRecord;
use App\Models\Delivery;
use App\Models\Payment;
use App\Models\PayrollPayment;
use App\Models\Product;
use App\Models\Transaction;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * The Undo button after an action. Each action that can be taken back leaves
 * a short-lived ticket naming exactly what to reverse; only the person who
 * did it can use it, once, within a few minutes.
 */
class Undo
{
    private const MINUTES = 10;

    public static function offer(string $type, array $data): string
    {
        $token = Str::random(32);
        Cache::put('undo:'.$token, ['type' => $type, 'data' => $data, 'user' => auth()->id()], now()->addMinutes(self::MINUTES));

        return $token;
    }

    /** Reverse the action; returns what to tell the person. */
    public static function run(string $token): string
    {
        $ticket = Cache::get('undo:'.$token);
        if (! $ticket || $ticket['user'] !== auth()->id()) {
            throw new RuntimeException('This can no longer be undone.');
        }

        $message = DB::transaction(fn () => match ($ticket['type']) {
            'payment' => self::payment($ticket['data']),
            'advance' => self::advance($ticket['data']),
            'deliver' => self::deliver($ticket['data']),
            'trash' => self::trash($ticket['data']),
            'payroll' => self::payroll($ticket['data']),
        });
        Cache::forget('undo:'.$token);

        return $message;
    }

    private static function payment(array $d): string
    {
        $payment = Payment::find($d['payment_id']);
        if (! $payment) {
            throw new RuntimeException('That payment is already gone.');
        }
        // A stage it paid opens again on its own (the link is cleared with the payment).
        $payment->delete();

        return 'Payment taken back';
    }

    private static function advance(array $d): string
    {
        $tx = Transaction::lockForUpdate()->findOrFail($d['tx_id']);
        if ($tx->status !== $d['after']) {
            throw new RuntimeException('This deal has moved on since, so the stage change cannot be undone.');
        }
        $tx->update($d['before']);
        if (! empty($d['reopen'])) {
            Transaction::whereIn('id', $d['reopen'])->where('status', 'Cancelled')->update(['status' => 'Quotation']);
        }

        return $tx->ref_no.' is back to '.strtolower($d['before']['status']);
    }

    private static function deliver(array $d): string
    {
        $tx = Transaction::lockForUpdate()->findOrFail($d['tx_id']);
        foreach (Delivery::with('line')->whereIn('id', $d['delivery_ids'])->get() as $delivery) {
            $li = $delivery->line;
            $parts = $li->kind === 'combo'
                ? [Base::lockForUpdate()->find($li->base_id), Cover::lockForUpdate()->find($li->cover_id)]
                : [Product::lockForUpdate()->find($li->product_id)];
            foreach (array_filter($parts) as $item) {
                $item->increment('stock_on_hand', $delivery->qty);
            }
            $li->decrement('delivered_qty', $delivery->qty);
            $delivery->delete();
        }
        if ($tx->status === 'Delivered') {
            $tx->update(['status' => 'Invoiced', 'delivered_date' => null]);
        }

        return 'Delivery taken back — the goods are on the shelf again';
    }

    private static function trash(array $d): string
    {
        $rec = DeletedRecord::find($d['id']);
        if (! $rec) {
            throw new RuntimeException('That is no longer in Recently deleted.');
        }

        return RecycleBin::restore($rec);
    }

    private static function payroll(array $d): string
    {
        PayrollPayment::whereKey($d['id'])->delete();

        return 'Salary payment taken back';
    }
}
