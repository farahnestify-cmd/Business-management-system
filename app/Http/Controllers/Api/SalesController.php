<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Base;
use App\Models\Client;
use App\Models\CompanySetting;
use App\Models\Cover;
use App\Models\Payment;
use App\Models\Product;
use App\Models\Transaction;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Quotations and their life: Quotation → Agreement → Invoiced → Delivered.
 * Reference numbers are YYMM + region (W/F) + type (D/P) + two-digit counter.
 */
class SalesController extends Controller
{
    /** Rounding slack when comparing money amounts. */
    private const CENT = 0.005;

    public function store(Request $request)
    {
        $data = $request->validate($this->offerRules() + [
            'paid' => 'nullable|numeric|min:0',
            'method' => 'nullable|in:Cash,Bank Transfer,Cheque',
        ]);

        $client = Client::findOrFail($data['clientId']);
        $items = $this->buildItems($data['lines']);
        $settings = CompanySetting::current();

        $paid = (float) ($data['paid'] ?? 0);
        $total = $this->itemsSubtotal($items) * (1 + $settings->vat_pct / 100);
        if ($paid > $total + self::CENT) {
            throw ValidationException::withMessages(['paid' => 'The payment is more than the offer total of $'.number_format($total, 2).'.']);
        }

        $date = Carbon::parse($data['date']);
        $yymm = $date->format('ym');
        [$rc, $tc] = $this->codes($data);

        $tx = DB::transaction(function () use ($data, $client, $items, $date, $yymm, $rc, $tc, $settings, $paid) {
            $seq = (int) Transaction::where('yymm', $yymm)->lockForUpdate()->max('seq') + 1;
            $tx = Transaction::create([
                'ref_no' => $this->ref($yymm, $rc, $tc, $seq),
                'yymm' => $yymm, 'region_code' => $rc, 'type_code' => $tc, 'seq' => $seq,
                'client_id' => $client->id, 'client_name' => $client->name, 'client_type' => $client->type,
                'region' => $data['region'], 'service_type' => $data['serviceType'], 'status' => 'Quotation',
                'vat_pct' => $settings->vat_pct,
                'quotation_date' => $date->toDateString(),
                'due_date' => $data['dueDate'] ?? null,
                'notes' => $data['notes'] ?? null,
            ]);
            $tx->items()->createMany($items);
            if ($paid > 0) {
                $tx->payments()->create([
                    'date' => $date->toDateString(), 'amount' => $paid,
                    'method' => $data['method'] ?? 'Cash', 'type' => 'Down Payment',
                ]);
            }

            return $tx;
        });

        return response()->json(['id' => (string) $tx->id, 'refNo' => $tx->ref_no], 201);
    }

    /**
     * Edit a quotation. Once it becomes an agreement the stock is reserved and
     * the paperwork is signed, so it can no longer change.
     */
    public function update(Request $request, Transaction $transaction)
    {
        if ($transaction->status !== 'Quotation') {
            return response()->json(['message' => 'Only quotations can be edited. This deal is already '.strtolower($transaction->status).'.'], 409);
        }
        $data = $request->validate($this->offerRules());
        $client = Client::findOrFail($data['clientId']);
        $items = $this->buildItems($data['lines']);

        $total = $this->itemsSubtotal($items) * (1 + $transaction->vat_pct / 100);
        $paid = $transaction->paid();
        if ($paid > $total + self::CENT) {
            throw ValidationException::withMessages(['lines' => 'The new total ($'.number_format($total, 2).') is less than the $'.number_format($paid, 2).' already paid. Delete or refund a payment first.']);
        }

        [$rc, $tc] = $this->codes($data);
        DB::transaction(function () use ($transaction, $data, $client, $items, $rc, $tc) {
            // The counter and month stay, so the reference keeps its place in the sequence.
            $transaction->update([
                'ref_no' => $this->ref($transaction->yymm, $rc, $tc, $transaction->seq),
                'region_code' => $rc, 'type_code' => $tc,
                'client_id' => $client->id, 'client_name' => $client->name, 'client_type' => $client->type,
                'region' => $data['region'], 'service_type' => $data['serviceType'],
                'quotation_date' => Carbon::parse($data['date'])->toDateString(),
                'due_date' => $data['dueDate'] ?? null,
                'notes' => $data['notes'] ?? null,
            ]);
            $transaction->items()->delete();
            $transaction->items()->createMany($items);
        });

        return response()->json(['id' => (string) $transaction->id, 'refNo' => $transaction->ref_no]);
    }

    public function pay(Request $request, Transaction $transaction)
    {
        $data = $request->validate([
            'amount' => 'required|numeric|gt:0',
            'method' => 'required|in:Cash,Bank Transfer,Cheque',
            'date' => 'nullable|date',
        ]);
        if ($transaction->status === 'Cancelled') {
            return response()->json(['message' => 'This deal is cancelled.'], 409);
        }

        return DB::transaction(function () use ($transaction, $data) {
            // Lock the deal so two quick clicks cannot both pass the balance check.
            $tx = Transaction::lockForUpdate()->findOrFail($transaction->id);
            $balance = $tx->total() - $tx->paid();
            if ($data['amount'] > $balance + self::CENT) {
                throw ValidationException::withMessages(['amount' => $balance > self::CENT
                    ? 'That is more than the $'.number_format($balance, 2).' still owed on this deal.'
                    : 'This deal is already paid in full.']);
            }

            $tx->payments()->create([
                'date' => $data['date'] ?? now()->toDateString(),
                'amount' => $data['amount'],
                'method' => $data['method'],
                'type' => $tx->payments()->exists() ? 'Balance Payment' : 'Down Payment',
            ]);

            return response()->json(['ok' => true]);
        });
    }

    /**
     * Money handed back to the client: everything paid on a cancelled deal, or
     * whatever was paid beyond the total on a live one. Stored as a negative payment.
     */
    public function refund(Request $request, Transaction $transaction)
    {
        $data = $request->validate([
            'amount' => 'required|numeric|gt:0',
            'method' => 'required|in:Cash,Bank Transfer,Cheque',
            'date' => 'nullable|date',
        ]);

        return DB::transaction(function () use ($transaction, $data) {
            $tx = Transaction::lockForUpdate()->findOrFail($transaction->id);
            $paid = $tx->paid();
            $refundable = $tx->status === 'Cancelled' ? $paid : $paid - $tx->total();
            if ($refundable <= self::CENT) {
                throw ValidationException::withMessages(['amount' => 'Nothing is owed back to the client on this deal.']);
            }
            if ($data['amount'] > $refundable + self::CENT) {
                throw ValidationException::withMessages(['amount' => 'Only $'.number_format($refundable, 2).' is owed back to the client.']);
            }

            $tx->payments()->create([
                'date' => $data['date'] ?? now()->toDateString(),
                'amount' => -$data['amount'],
                'method' => $data['method'],
                'type' => 'Refund',
            ]);

            return response()->json(['ok' => true]);
        });
    }

    /** Remove a payment that was recorded by mistake (owner only). */
    public function destroyPayment(Payment $payment)
    {
        $payment->delete();

        return response()->json(['ok' => true]);
    }

    public function advance(Request $request, Transaction $transaction)
    {
        $data = $request->validate(['status' => 'required|in:Agreement,Invoiced,Delivered,Cancelled']);
        $next = $data['status'];

        return DB::transaction(function () use ($transaction, $next) {
            // Locked so a double click cannot run the stage change (and the stock move) twice.
            $tx = Transaction::lockForUpdate()->findOrFail($transaction->id);
            if (! in_array($next, Transaction::NEXT[$tx->status] ?? [], true)) {
                return response()->json(['message' => "A deal in {$tx->status} cannot move to $next."], 409);
            }

            $today = now()->toDateString();
            $tx->status = $next;
            if ($next === 'Agreement') {
                $tx->agreement_date = $today;
            }
            if ($next === 'Invoiced') {
                $tx->invoice_date = $today;
            }
            if ($next === 'Delivered') {
                $tx->delivered_date = $today;
                $this->takeOutOfStock($tx);
            }
            $tx->save();

            return response()->json(['ok' => true]);
        });
    }

    /**
     * Delivered goods leave the shelf. Refuses the whole delivery when any item
     * is short, so stock never silently drops below what was really there.
     */
    private function takeOutOfStock(Transaction $tx): void
    {
        $needs = [];
        foreach ($tx->items as $li) {
            $parts = $li->kind === 'combo'
                ? [[Base::class, $li->base_id], [Cover::class, $li->cover_id]]
                : [[Product::class, $li->product_id]];
            foreach ($parts as [$class, $id]) {
                if ($id) {
                    $needs[$class.':'.$id] = ($needs[$class.':'.$id] ?? 0) + $li->qty;
                }
            }
        }

        $items = [];
        $short = [];
        foreach ($needs as $key => $qty) {
            [$class, $id] = explode(':', $key);
            $item = $class::lockForUpdate()->find($id);
            if (! $item) {
                continue;
            }
            if ($item->stock_on_hand < $qty) {
                $short[] = "{$item->name} (need $qty, have {$item->stock_on_hand})";
            }
            $items[] = [$item, $qty];
        }

        if ($short) {
            throw ValidationException::withMessages(['status' => 'Not enough stock to deliver: '.implode(', ', $short).'. Receive the purchase order or correct the stock first.']);
        }
        foreach ($items as [$item, $qty]) {
            $item->stock_on_hand -= $qty;
            $item->save();
        }
    }

    private function offerRules(): array
    {
        return [
            'clientId' => 'required|integer|exists:clients,id',
            'region' => 'required|in:West Bank,48 Region',
            'dealType' => 'required|in:Direct,Partner',
            'serviceType' => 'required|in:With Programming,Without Programming',
            'date' => 'required|date',
            'dueDate' => 'nullable|date',
            'notes' => 'nullable|string|max:5000',
            'lines' => 'required|array|min:1',
            'lines.*.kind' => 'required|in:product,combo',
            'lines.*.productId' => 'nullable|integer',
            'lines.*.baseId' => 'nullable|integer',
            'lines.*.coverId' => 'nullable|integer',
            'lines.*.qty' => 'required|integer|min:1',
            'lines.*.unitPrice' => 'required|numeric|min:0',
            'lines.*.standardPrice' => 'nullable|numeric|min:0',
        ];
    }

    /** Line items with names and cost taken from the stock records, never from the browser. */
    private function buildItems(array $lines): array
    {
        $items = [];
        foreach ($lines as $i => $line) {
            if ($line['kind'] === 'combo') {
                $base = Base::find($line['baseId'] ?? 0);
                $cover = Cover::find($line['coverId'] ?? 0);
                if (! $base || ! $cover) {
                    throw ValidationException::withMessages(["lines.$i" => 'Choose a base and a cover for every line.']);
                }
                $row = [
                    'kind' => 'combo', 'base_id' => $base->id, 'cover_id' => $cover->id, 'product_id' => null,
                    'name' => $base->name.' · '.$cover->name,
                    'cost_snapshot' => (float) $base->cost + (float) $cover->cost,
                ];
            } else {
                $product = Product::find($line['productId'] ?? 0);
                if (! $product) {
                    throw ValidationException::withMessages(["lines.$i" => 'Choose an item for every line.']);
                }
                $row = [
                    'kind' => 'product', 'product_id' => $product->id, 'base_id' => null, 'cover_id' => null,
                    'name' => $product->name, 'cost_snapshot' => (float) $product->cost,
                ];
            }
            $items[] = $row + [
                'qty' => (int) $line['qty'],
                'unit_price' => round((float) $line['unitPrice'], 2),
                'standard_price' => round((float) ($line['standardPrice'] ?? 0), 2),
            ];
        }

        return $items;
    }

    private function itemsSubtotal(array $items): float
    {
        return array_sum(array_map(fn ($i) => $i['qty'] * $i['unit_price'], $items));
    }

    private function codes(array $data): array
    {
        return [$data['region'] === '48 Region' ? 'F' : 'W', $data['dealType'] === 'Partner' ? 'P' : 'D'];
    }

    private function ref(string $yymm, string $rc, string $tc, int $seq): string
    {
        return $yymm.$rc.$tc.str_pad((string) $seq, 2, '0', STR_PAD_LEFT);
    }
}
