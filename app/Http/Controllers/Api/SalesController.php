<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Base;
use App\Models\Client;
use App\Models\CompanySetting;
use App\Models\Cover;
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
    public function store(Request $request)
    {
        $data = $request->validate([
            'clientId' => 'required|integer|exists:clients,id',
            'region' => 'required|in:West Bank,48 Region',
            'dealType' => 'required|in:Direct,Partner',
            'serviceType' => 'required|in:With Programming,Without Programming',
            'date' => 'required|date',
            'dueDate' => 'nullable|date',
            'notes' => 'nullable|string|max:5000',
            'paid' => 'nullable|numeric|min:0',
            'method' => 'nullable|in:Cash,Bank Transfer,Cheque',
            'lines' => 'required|array|min:1',
            'lines.*.kind' => 'required|in:product,combo',
            'lines.*.productId' => 'nullable|integer',
            'lines.*.baseId' => 'nullable|integer',
            'lines.*.coverId' => 'nullable|integer',
            'lines.*.qty' => 'required|integer|min:1',
            'lines.*.unitPrice' => 'required|numeric|min:0',
            'lines.*.standardPrice' => 'nullable|numeric|min:0',
        ]);

        $client = Client::findOrFail($data['clientId']);
        $items = [];
        foreach ($data['lines'] as $i => $line) {
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

        $date = Carbon::parse($data['date']);
        $yymm = $date->format('ym');
        $rc = $data['region'] === '48 Region' ? 'F' : 'W';
        $tc = $data['dealType'] === 'Partner' ? 'P' : 'D';
        $settings = CompanySetting::current();

        $tx = DB::transaction(function () use ($data, $client, $items, $date, $yymm, $rc, $tc, $settings) {
            $seq = (int) Transaction::where('yymm', $yymm)->lockForUpdate()->max('seq') + 1;
            $tx = Transaction::create([
                'ref_no' => $yymm.$rc.$tc.str_pad((string) $seq, 2, '0', STR_PAD_LEFT),
                'yymm' => $yymm, 'region_code' => $rc, 'type_code' => $tc, 'seq' => $seq,
                'client_id' => $client->id, 'client_name' => $client->name, 'client_type' => $client->type,
                'region' => $data['region'], 'service_type' => $data['serviceType'], 'status' => 'Quotation',
                'vat_pct' => $settings->vat_pct,
                'quotation_date' => $date->toDateString(),
                'due_date' => $data['dueDate'] ?? null,
                'notes' => $data['notes'] ?? null,
            ]);
            $tx->items()->createMany($items);
            if (($data['paid'] ?? 0) > 0) {
                $tx->payments()->create([
                    'date' => $date->toDateString(), 'amount' => $data['paid'],
                    'method' => $data['method'] ?? 'Cash', 'type' => 'Down Payment',
                ]);
            }

            return $tx;
        });

        return response()->json(['id' => (string) $tx->id, 'refNo' => $tx->ref_no], 201);
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

        $transaction->payments()->create([
            'date' => $data['date'] ?? now()->toDateString(),
            'amount' => $data['amount'],
            'method' => $data['method'],
            'type' => $transaction->payments()->exists() ? 'Balance Payment' : 'Down Payment',
        ]);

        return response()->json(['ok' => true]);
    }

    public function advance(Request $request, Transaction $transaction)
    {
        $data = $request->validate(['status' => 'required|in:Agreement,Invoiced,Delivered,Cancelled']);
        $next = $data['status'];
        if (! in_array($next, Transaction::NEXT[$transaction->status] ?? [], true)) {
            return response()->json(['message' => "A deal in {$transaction->status} cannot move to $next."], 409);
        }

        DB::transaction(function () use ($transaction, $next) {
            $today = now()->toDateString();
            $transaction->status = $next;
            if ($next === 'Agreement') {
                $transaction->agreement_date = $today;
            }
            if ($next === 'Invoiced') {
                $transaction->invoice_date = $today;
            }
            if ($next === 'Delivered') {
                $transaction->delivered_date = $today;
                // Delivered goods leave the shelf.
                foreach ($transaction->items as $li) {
                    $targets = $li->kind === 'combo'
                        ? [Base::find($li->base_id), Cover::find($li->cover_id)]
                        : [Product::find($li->product_id)];
                    foreach (array_filter($targets) as $item) {
                        $item->stock_on_hand = max(0, $item->stock_on_hand - $li->qty);
                        $item->save();
                    }
                }
            }
            $transaction->save();
        });

        return response()->json(['ok' => true]);
    }
}
