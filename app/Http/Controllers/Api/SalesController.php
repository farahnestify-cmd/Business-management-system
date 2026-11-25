<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Base;
use App\Models\Client;
use App\Models\CompanySetting;
use App\Models\Cover;
use App\Models\CoverType;
use App\Models\Currency;
use App\Models\Delivery;
use App\Models\Milestone;
use App\Models\Payment;
use App\Models\Product;
use App\Models\Service;
use App\Models\Transaction;
use App\Support\RecycleBin;
use App\Support\Undo;
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
        $this->requireQuantity($items);
        $settings = CompanySetting::current();

        $paid = (float) ($data['paid'] ?? 0);
        $total = $this->itemsSubtotal($items, (float) ($data['discountPct'] ?? 0)) * (1 + $settings->vat_pct / 100);
        if ($paid > $total + self::CENT) {
            throw ValidationException::withMessages(['paid' => 'The payment is more than the offer total of $'.number_format($total, 2).'.']);
        }

        $date = Carbon::parse($data['date']);
        $yymm = $date->format('ym');
        [$rc, $tc] = $this->codes($data);
        [$cur, $rate] = $this->currency($data);

        $tx = DB::transaction(function () use ($data, $client, $items, $date, $yymm, $rc, $tc, $settings, $paid, $cur, $rate) {
            $seq = (int) Transaction::where('yymm', $yymm)->lockForUpdate()->max('seq') + 1;
            $tx = Transaction::create([
                'ref_no' => $this->ref($yymm, $rc, $tc, $seq),
                'yymm' => $yymm, 'region_code' => $rc, 'type_code' => $tc, 'seq' => $seq,
                'client_id' => $client->id, 'client_name' => $client->name, 'client_type' => $client->type,
                'region' => $data['region'], 'service_type' => $data['serviceType'], 'status' => 'Quotation',
                'vat_pct' => $settings->vat_pct,
                'currency' => $cur, 'fx_rate' => $rate,
                'discount_pct' => (float) ($data['discountPct'] ?? 0),
                'quotation_date' => $date->toDateString(),
                'due_date' => $data['dueDate'] ?? null,
                'site' => $data['site'] ?? null,
                'table_title' => $data['tableTitle'] ?? null,
                'sold_by' => $data['soldBy'] ?? null,
                'created_by' => auth()->id(),
                'set_id' => $data['setId'] ?? null,
                'notes' => $data['notes'] ?? null,
            ]);
            $tx->items()->createMany($items);
            $stages = $this->saveMilestones($tx, $data['milestones'] ?? []);
            if ($paid > 0) {
                $payment = $tx->payments()->create([
                    'date' => $date->toDateString(), 'amount' => $paid,
                    'method' => $data['method'] ?? 'Cash', 'type' => 'Down Payment',
                ]);
                // A deposit taken with the offer settles the first stage when it is that stage's amount.
                $first = $stages[0] ?? null;
                if ($first && abs($first->amount - $paid) <= self::CENT) {
                    $first->update(['payment_id' => $payment->id]);
                    $payment->update(['type' => $first->label]);
                }
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
        $this->requireQuantity($items);

        $total = $this->itemsSubtotal($items, (float) ($data['discountPct'] ?? 0)) * (1 + $transaction->vat_pct / 100);
        $paid = $transaction->paid();
        if ($paid > $total + self::CENT) {
            throw ValidationException::withMessages(['lines' => 'The new total ($'.number_format($total, 2).') is less than the $'.number_format($paid, 2).' already paid. Delete or refund a payment first.']);
        }

        [$rc, $tc] = $this->codes($data);
        [$cur, $rate] = $this->currency($data, $paid > 0 ? $transaction : null);
        DB::transaction(function () use ($transaction, $data, $client, $items, $rc, $tc, $cur, $rate) {
            // The counter and month stay, so the reference keeps its place in the sequence. Once an
            // offer has versions its reference is what ties them together, so it no longer changes.
            $hasVersions = $transaction->version > 1 || $transaction->versions()->count() > 1;
            $transaction->update([
                'ref_no' => $hasVersions ? $transaction->ref_no : $this->ref($transaction->yymm, $rc, $tc, $transaction->seq),
                'region_code' => $rc, 'type_code' => $tc,
                'client_id' => $client->id, 'client_name' => $client->name, 'client_type' => $client->type,
                'region' => $data['region'], 'service_type' => $data['serviceType'],
                'currency' => $cur, 'fx_rate' => $rate,
                'discount_pct' => (float) ($data['discountPct'] ?? 0),
                'quotation_date' => Carbon::parse($data['date'])->toDateString(),
                'due_date' => $data['dueDate'] ?? null,
                'site' => $data['site'] ?? null,
                'table_title' => $data['tableTitle'] ?? null,
                'sold_by' => $data['soldBy'] ?? null,
                'notes' => $data['notes'] ?? null,
            ]);
            $transaction->items()->delete();
            $transaction->items()->createMany($items);
            // Paid stages are history and stay; the open ones are replaced by what was sent.
            $transaction->milestones()->whereNull('payment_id')->delete();
            $this->saveMilestones($transaction, $data['milestones'] ?? [], (int) $transaction->milestones()->max('position') + 1);
        });

        return response()->json(['id' => (string) $transaction->id, 'refNo' => $transaction->ref_no]);
    }

    /**
     * The client asks for changes: the offer is read again as a new version
     * (2611WD04-V2). The earlier versions stay as they were; money already
     * taken moves to the new version, since it is the same job.
     */
    public function revise(Request $request, Transaction $transaction)
    {
        if ($transaction->status !== 'Quotation') {
            return response()->json(['message' => 'Only a quotation can be revised.'], 409);
        }
        $data = $request->validate($this->offerRules());
        $client = Client::findOrFail($data['clientId']);
        $items = $this->buildItems($data['lines']);
        $this->requireQuantity($items);

        $tx = DB::transaction(function () use ($transaction, $data, $client, $items) {
            $src = Transaction::lockForUpdate()->findOrFail($transaction->id);
            $root = $src->rootRef();
            $version = (int) $src->versions()->lockForUpdate()->max('version') + 1;
            $vat = $src->vat_pct;

            $paid = $src->paid();
            // Money already taken moves to the new version, so it stays in the same currency.
            [$cur, $rate] = $this->currency($data, $paid > 0 ? $src : null);
            $total = $this->itemsSubtotal($items, (float) ($data['discountPct'] ?? 0)) * (1 + $vat / 100);
            if ($paid > $total + self::CENT) {
                throw ValidationException::withMessages(['lines' => 'The new total ($'.number_format($total, 2).') is less than the $'.number_format($paid, 2).' already paid on this offer.']);
            }

            $new = Transaction::create([
                'ref_no' => $root.'-V'.$version, 'root_ref' => $root, 'version' => $version,
                'yymm' => $src->yymm, 'region_code' => $src->region_code, 'type_code' => $src->type_code, 'seq' => $src->seq,
                'client_id' => $client->id, 'client_name' => $client->name, 'client_type' => $client->type,
                'region' => $data['region'], 'service_type' => $data['serviceType'], 'status' => 'Quotation',
                'vat_pct' => $vat,
                'currency' => $cur, 'fx_rate' => $rate,
                'discount_pct' => (float) ($data['discountPct'] ?? 0),
                'quotation_date' => Carbon::parse($data['date'])->toDateString(),
                'due_date' => $data['dueDate'] ?? null,
                'site' => $data['site'] ?? null,
                'table_title' => $data['tableTitle'] ?? null,
                'sold_by' => $data['soldBy'] ?? null,
                'notes' => $data['notes'] ?? null,
                'created_by' => auth()->id(),
                'set_id' => $data['setId'] ?? $src->set_id,
            ]);
            $new->items()->createMany($items);

            // Money and the stages it paid follow the job to its newest version.
            $src->payments()->update(['transaction_id' => $new->id]);
            $src->milestones()->whereNotNull('payment_id')->update(['transaction_id' => $new->id]);
            $this->saveMilestones($new, $data['milestones'] ?? [], (int) $new->milestones()->max('position') + 1);

            return $new;
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

        return DB::transaction(function () use ($transaction, $data) {
            // Lock the deal so two quick clicks cannot both pass the balance check.
            $tx = Transaction::lockForUpdate()->findOrFail($transaction->id);
            $balance = $tx->total() - $tx->paid();
            if ($data['amount'] > $balance + self::CENT) {
                throw ValidationException::withMessages(['amount' => $balance > self::CENT
                    ? 'That is more than the $'.number_format($balance, 2).' still owed on this deal.'
                    : 'This deal is already paid in full.']);
            }

            $payment = $tx->payments()->create([
                'date' => $data['date'] ?? now()->toDateString(),
                'amount' => $data['amount'],
                'method' => $data['method'],
                'type' => $tx->payments()->exists() ? 'Balance Payment' : 'Down Payment',
            ]);

            return response()->json(['ok' => true, 'undo' => Undo::offer('payment', ['payment_id' => $payment->id])]);
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

            $payment = $tx->payments()->create([
                'date' => $data['date'] ?? now()->toDateString(),
                'amount' => -$data['amount'],
                'method' => $data['method'],
                'type' => 'Refund',
            ]);

            return response()->json(['ok' => true, 'undo' => Undo::offer('payment', ['payment_id' => $payment->id])]);
        });
    }

    /** Record the payment for one stage of the schedule. */
    public function payMilestone(Request $request, Transaction $transaction, Milestone $milestone)
    {
        $data = $request->validate([
            'method' => 'required|in:Cash,Bank Transfer,Cheque',
            'date' => 'nullable|date',
        ]);
        abort_unless($milestone->transaction_id === $transaction->id, 404);

        return DB::transaction(function () use ($transaction, $milestone, $data) {
            $tx = Transaction::lockForUpdate()->findOrFail($transaction->id);
            $stage = Milestone::lockForUpdate()->findOrFail($milestone->id);
            if ($tx->status === 'Cancelled') {
                return response()->json(['message' => 'This deal is cancelled.'], 409);
            }
            if ($stage->payment_id) {
                return response()->json(['message' => 'This stage is already paid.'], 409);
            }
            $balance = $tx->total() - $tx->paid();
            if ($stage->amount > $balance + self::CENT) {
                throw ValidationException::withMessages(['amount' => 'This stage is $'.number_format($stage->amount, 2)
                    .' but only $'.number_format(max(0, $balance), 2).' is still owed. Record the remaining amount as a normal payment instead.']);
            }

            $payment = $tx->payments()->create([
                'date' => $data['date'] ?? now()->toDateString(),
                'amount' => $stage->amount,
                'method' => $data['method'],
                'type' => $stage->label,
            ]);
            $stage->update(['payment_id' => $payment->id]);

            return response()->json(['ok' => true, 'undo' => Undo::offer('payment', ['payment_id' => $payment->id])]);
        });
    }

    /** Remove a payment that was recorded by mistake (owner only). */
    public function destroyPayment(Payment $payment)
    {
        DB::transaction(fn () => RecycleBin::trash('payment', $payment, '$'.number_format((float) $payment->amount, 2).' '.$payment->type));

        return response()->json(['ok' => true, 'undo' => RecycleBin::$lastUndo]);
    }

    public function advance(Request $request, Transaction $transaction)
    {
        $data = $request->validate(['status' => 'required|in:Agreement,Invoiced,Delivered,Cancelled']);
        $next = $data['status'];
        if ($next === 'Delivered') {
            return $this->deliver($transaction);
        }

        return DB::transaction(function () use ($transaction, $next) {
            // Locked so a double click cannot run the stage change twice.
            $tx = Transaction::lockForUpdate()->findOrFail($transaction->id);
            if (! in_array($next, Transaction::NEXT[$tx->status] ?? [], true)) {
                return response()->json(['message' => "A deal in {$tx->status} cannot move to $next."], 409);
            }
            if ($next === 'Cancelled' && $tx->items->sum('delivered_qty') > 0) {
                return response()->json(['message' => 'Part of this deal has already been delivered, so it cannot be cancelled.'], 409);
            }

            $today = now()->toDateString();
            $before = ['status' => $tx->status, 'agreement_date' => optional($tx->agreement_date)->toDateString() ?? $tx->agreement_date,
                'invoice_date' => optional($tx->invoice_date)->toDateString() ?? $tx->invoice_date];
            $tx->status = $next;
            $closed = 0;
            $reopen = [];
            if ($next === 'Agreement') {
                $tx->agreement_date = $today;
                // Only one version can become the deal; the other quotations for the same job close.
                $siblings = $tx->versions()->where('id', '!=', $tx->id)->where('status', 'Quotation');
                $reopen = $siblings->pluck('id')->all();
                $closed = $siblings->update(['status' => 'Cancelled']);
            }
            if ($next === 'Invoiced') {
                $tx->invoice_date = $today;
            }
            $tx->save();

            return response()->json(['ok' => true, 'closedVersions' => $closed,
                'undo' => Undo::offer('advance', ['tx_id' => $tx->id, 'after' => $next, 'before' => $before, 'reopen' => $reopen])]);
        });
    }

    /**
     * Hand over whatever is on the shelf. Lines that are short are delivered
     * in part and the rest waits for stock; the deal becomes Delivered only
     * once every line is complete. Can be called again as stock arrives.
     */
    public function deliver(Transaction $transaction)
    {
        return DB::transaction(function () use ($transaction) {
            $tx = Transaction::lockForUpdate()->findOrFail($transaction->id);
            if ($tx->status !== 'Invoiced') {
                return response()->json(['message' => "A deal in {$tx->status} cannot be delivered. Invoice it first."], 409);
            }

            $stock = [];
            $load = function (string $class, $id) use (&$stock) {
                $key = $class.':'.$id;
                if (! array_key_exists($key, $stock)) {
                    $stock[$key] = $id ? $class::lockForUpdate()->find($id) : null;
                }

                return $stock[$key];
            };

            $handed = [];
            $waiting = [];
            $round = [];
            foreach ($tx->items as $li) {
                $left = $li->remaining();
                if ($left === 0) {
                    continue;
                }
                if ($li->needsColour()) {
                    $waiting[] = ['name' => $li->name.' (choose the cover colours first)', 'qty' => $left];

                    continue;
                }
                $parts = $li->kind === 'combo'
                    ? [$load(Base::class, $li->base_id), $load(Cover::class, $li->cover_id)]
                    : [$load(Product::class, $li->product_id)];
                $parts = array_filter($parts);
                // A base + cover pair can only go out as many times as the scarcer half allows.
                $take = $parts ? min($left, ...array_map(fn ($m) => max(0, $m->stock_on_hand), $parts)) : 0;

                if ($take > 0) {
                    foreach ($parts as $m) {
                        $m->stock_on_hand -= $take;
                    }
                    $li->delivered_qty += $take;
                    $li->save();
                    $round[] = Delivery::create([
                        'transaction_id' => $tx->id, 'transaction_item_id' => $li->id, 'qty' => $take,
                        'delivered_on' => now()->toDateString(), 'user_id' => auth()->id(),
                    ]);
                    $handed[] = ['name' => $li->name, 'qty' => $take];
                }
                if ($left - $take > 0) {
                    $waiting[] = ['name' => $li->name, 'qty' => $left - $take];
                }
            }

            if (! $handed) {
                throw ValidationException::withMessages(['status' => 'Nothing to deliver yet: none of the remaining items are in stock.']);
            }
            foreach (array_filter($stock) as $m) {
                $m->save();
            }

            $complete = ! $waiting;
            if ($complete) {
                $tx->status = 'Delivered';
                $tx->delivered_date = now()->toDateString();
                $tx->save();
            }

            return response()->json(['ok' => true, 'complete' => $complete, 'delivered' => $handed, 'waiting' => $waiting,
                'undo' => Undo::offer('deliver', ['tx_id' => $tx->id, 'delivery_ids' => array_map(fn ($d) => $d->id, $round)])]);
        });
    }

    /**
     * Something delivered comes back. "replace": it goes out again later (faulty unit,
     * wrong colour), so the deal waits for it. "remove": the client does not keep it,
     * so it also comes off the invoice. Either way it is back in stock and in the log.
     */
    public function returnItem(Request $request, Transaction $transaction)
    {
        // One row or several: {lineId, qty, outcome} or items: [{...}, {...}], with one note for all.
        $data = $request->validate([
            'items' => 'nullable|array|min:1|max:50',
            'items.*.lineId' => 'required|integer',
            'items.*.qty' => 'required|integer|min:1',
            'items.*.outcome' => 'required|in:replace,remove',
            'lineId' => 'required_without:items|integer',
            'qty' => 'required_without:items|integer|min:1',
            'outcome' => 'required_without:items|in:replace,remove',
            'note' => 'nullable|string|max:500',
        ]);
        $rows = $data['items'] ?? [['lineId' => $data['lineId'], 'qty' => $data['qty'], 'outcome' => $data['outcome']]];

        return DB::transaction(function () use ($transaction, $data, $rows) {
            $tx = Transaction::lockForUpdate()->findOrFail($transaction->id);
            $this->requireDeliveryStage($tx);
            $this->keepOriginalQuote($tx);
            $lines = $tx->items()->lockForUpdate()->get()->keyBy('id');

            foreach ($rows as $i => $row) {
                $li = $lines->get($row['lineId']);
                if (! $li || $li->kind === 'service') {
                    throw ValidationException::withMessages(["items.$i.lineId" => 'Choose an item that was delivered.']);
                }
                // Checked against what is left after the rows before it, so the same item twice cannot over-return.
                if ($row['qty'] > $li->delivered_qty) {
                    throw ValidationException::withMessages(["items.$i.qty" => 'Only '.$li->delivered_qty.' of '.$li->name.' is with the client.']);
                }
                foreach ($this->stockParts($li) as $m) {
                    $m->stock_on_hand += $row['qty'];
                    $m->save();
                }
                $li->delivered_qty -= $row['qty'];
                if ($row['outcome'] === 'remove') {
                    $li->qty -= $row['qty'];
                }
                $li->save();

                Delivery::create([
                    'transaction_id' => $tx->id, 'transaction_item_id' => $li->id, 'qty' => $row['qty'], 'type' => 'return',
                    'note' => trim(($row['outcome'] === 'remove' ? 'Taken off the deal' : 'To be replaced').'. '.($data['note'] ?? '')),
                    'delivered_on' => now()->toDateString(), 'user_id' => auth()->id(),
                ]);
            }
            $this->settleDeliveryStage($tx->fresh('items'));

            return response()->json(['ok' => true, 'returned' => count($rows)]);
        });
    }

    /**
     * Items the offer did not list go out on this deal: each is added as a new line
     * (at the price given, which may be 0 for something given free) and handed over
     * from stock straight away. What is not in stock waits on the To deliver list.
     */
    public function deliverExtra(Request $request, Transaction $transaction)
    {
        $rowRules = [
            'kind' => 'in:product,combo',
            'productId' => 'nullable|integer',
            'baseId' => 'nullable|integer',
            'coverId' => 'nullable|integer',
            'qty' => 'integer|min:1',
            'unitPrice' => 'numeric|min:0',
        ];
        $rules = ['items' => 'nullable|array|min:1|max:50', 'note' => 'nullable|string|max:500'];
        foreach ($rowRules as $k => $r) {
            $rules["items.*.$k"] = (str_ends_with($k, 'Id') ? '' : 'required|').$r;
            $rules[$k] = (str_ends_with($k, 'Id') ? '' : 'required_without:items|').$r;
        }
        $data = $request->validate($rules);
        $rows = $data['items'] ?? [array_intersect_key($data, $rowRules)];

        return DB::transaction(function () use ($transaction, $data, $rows) {
            $tx = Transaction::lockForUpdate()->findOrFail($transaction->id);
            $this->requireDeliveryStage($tx);
            $this->keepOriginalQuote($tx);
            $delivered = 0;
            $waiting = 0;

            foreach ($rows as $row) {
                if ($row['kind'] === 'combo' && empty($row['coverId'])) {
                    throw ValidationException::withMessages(['items' => 'Choose the cover colour of each base that goes out.']);
                }
                [$item] = $this->buildItems([$row + ['standardPrice' => $row['unitPrice']]]);
                // The same item at the same price joins the row already on the deal instead of a second row.
                $li = $tx->items()->lockForUpdate()->get()->first(fn ($x) => $x->kind === $item['kind']
                    && (int) $x->product_id === (int) ($item['product_id'] ?? 0) && (int) $x->base_id === (int) ($item['base_id'] ?? 0)
                    && (int) $x->cover_id === (int) ($item['cover_id'] ?? 0) && abs($x->unit_price - $item['unit_price']) < 0.005);
                if ($li) {
                    $li->qty += $item['qty'];
                    $li->save();
                } else {
                    $li = $tx->items()->create($item);
                }

                $parts = $this->stockParts($li);
                $take = $parts ? min($item['qty'], ...array_map(fn ($m) => max(0, $m->stock_on_hand), $parts)) : 0;
                if ($take > 0) {
                    foreach ($parts as $m) {
                        $m->stock_on_hand -= $take;
                        $m->save();
                    }
                    $li->update(['delivered_qty' => $li->delivered_qty + $take]);
                    Delivery::create([
                        'transaction_id' => $tx->id, 'transaction_item_id' => $li->id, 'qty' => $take, 'type' => 'out',
                        'note' => trim('Extra item, not on the offer. '.($data['note'] ?? '')),
                        'delivered_on' => now()->toDateString(), 'user_id' => auth()->id(),
                    ]);
                }
                $delivered += $take;
                $waiting += $item['qty'] - $take;
            }
            $this->settleDeliveryStage($tx->fresh('items'));

            return response()->json(['ok' => true, 'delivered' => $delivered, 'waiting' => $waiting]);
        });
    }

    /**
     * Once the client agrees: each base line sold with a cover type gets its colours,
     * split into one line per colour (same price), so stock is reserved and delivered
     * per colour. A line's colours must add up to its quantity.
     */
    public function chooseColours(Request $request, Transaction $transaction)
    {
        $data = $request->validate([
            'lines' => 'required|array|min:1|max:100',
            'lines.*.lineId' => 'required|integer',
            'lines.*.covers' => 'required|array|min:1|max:30',
            'lines.*.covers.*.coverId' => 'required|integer',
            'lines.*.covers.*.qty' => 'required|integer|min:1',
        ]);

        return DB::transaction(function () use ($transaction, $data) {
            $tx = Transaction::lockForUpdate()->findOrFail($transaction->id);
            if (! in_array($tx->status, ['Agreement', 'Invoiced'], true)) {
                return response()->json(['message' => 'Cover colours are chosen once the client has agreed.'], 409);
            }
            foreach ($data['lines'] as $i => $row) {
                $li = $tx->items()->lockForUpdate()->find($row['lineId']);
                if (! $li || ! $li->needsColour() || $li->delivered_qty > 0) {
                    throw ValidationException::withMessages(["lines.$i" => 'That line already has its colours.']);
                }
                $total = array_sum(array_column($row['covers'], 'qty'));
                if ($total !== (int) $li->qty) {
                    throw ValidationException::withMessages(["lines.$i" => 'The colours for '.$li->name.' add up to '.$total.', not '.$li->qty.'.']);
                }
                $base = Base::find($li->base_id);
                foreach (array_values($row['covers']) as $k => $c) {
                    $cover = Cover::find($c['coverId']);
                    if (! $cover || ($li->cover_type && $cover->line && $cover->line !== $li->cover_type)) {
                        throw ValidationException::withMessages(["lines.$i" => 'Choose '.($li->cover_type ?: '').' covers for '.$li->name.'.']);
                    }
                    $target = $k === 0 ? $li : $li->replicate();
                    $target->cover_id = $cover->id;
                    $target->qty = $c['qty'];
                    $target->cost_snapshot = (float) ($base?->cost ?? 0) + (float) $cover->cost;
                    $target->save();
                }
            }

            return response()->json(['ok' => true]);
        });
    }

    /** Keeps the quotation as agreed, once, before returns or extra items change the lines. */
    private function keepOriginalQuote(Transaction $tx): void
    {
        if ($tx->quote_snapshot === null) {
            $tx->quote_snapshot = json_encode($tx->items()->get()->map->toApi()->values());
            $tx->save();
        }
    }

    private function requireDeliveryStage(Transaction $tx): void
    {
        if (! in_array($tx->status, ['Invoiced', 'Delivered'], true)) {
            abort(response()->json(['message' => 'Returns and extra items are recorded once the deal is invoiced.'], 409));
        }
    }

    /** The stock records a line draws on, locked: the product, or the base and the cover. */
    private function stockParts($li): array
    {
        $parts = $li->kind === 'combo'
            ? [Base::lockForUpdate()->find($li->base_id), Cover::lockForUpdate()->find($li->cover_id)]
            : [Product::lockForUpdate()->find($li->product_id)];

        return array_values(array_filter($parts));
    }

    /** Delivered once nothing is waiting; back to Invoiced while something still has to go out. */
    private function settleDeliveryStage(Transaction $tx): void
    {
        $waiting = $tx->items->sum(fn ($li) => $li->remaining());
        if ($waiting > 0 && $tx->status === 'Delivered') {
            $tx->update(['status' => 'Invoiced', 'delivered_date' => null]);
        } elseif ($waiting === 0 && $tx->status === 'Invoiced' && $tx->items->sum('delivered_qty') > 0) {
            $tx->update(['status' => 'Delivered', 'delivered_date' => now()->toDateString()]);
        }
    }

    /** @return Milestone[] */
    private function saveMilestones(Transaction $tx, array $stages, int $start = 0): array
    {
        $out = [];
        foreach (array_values($stages) as $i => $m) {
            $out[] = $tx->milestones()->create([
                'position' => $start + $i,
                'label' => trim($m['label'] ?? '') ?: 'Stage '.($start + $i + 1),
                'amount' => round((float) $m['amount'], 2),
                'due_date' => $m['dueDate'] ?? null,
            ]);
        }

        return $out;
    }

    /**
     * The currency an offer is written in and its rate per $1. Dollars are always 1;
     * any other code must be in the currency list. A deal that already holds money
     * keeps its currency, since those payments were taken in it.
     */
    private function currency(array $data, ?Transaction $locked = null): array
    {
        $code = strtoupper($data['currency'] ?? 'USD');
        if ($locked && $code !== ($locked->currency ?: 'USD')) {
            throw ValidationException::withMessages(['currency' => 'This deal already has payments in '.($locked->currency ?: 'USD').', so it stays in that currency.']);
        }
        if ($code === 'USD') {
            return ['USD', 1];
        }
        $currency = Currency::where('code', $code)->first();
        if (! $currency || (! $currency->active && $code !== $locked?->currency)) {
            throw ValidationException::withMessages(['currency' => $code.' is not in the currency list.']);
        }

        return [$code, round((float) ($data['fxRate'] ?? $currency->rate), 6)];
    }

    private function offerRules(): array
    {
        return [
            'milestones' => 'nullable|array|max:20',
            'milestones.*.label' => 'nullable|string|max:120',
            'milestones.*.amount' => 'required|numeric|gt:0',
            'milestones.*.dueDate' => 'nullable|date',
            'clientId' => 'required|integer|exists:clients,id',
            'region' => 'required|in:West Bank,48 Region',
            'dealType' => 'required|in:Direct,Partner',
            'serviceType' => 'required|in:With Programming,Without Programming',
            'date' => 'required|date',
            'dueDate' => 'nullable|date',
            'notes' => 'nullable|string|max:5000',
            'site' => 'nullable|string|max:255',
            'tableTitle' => 'nullable|string|max:255',
            'soldBy' => 'nullable|string|max:120',
            'lines' => 'required|array|min:1',
            'lines.*.kind' => 'required|in:product,combo,service',
            'lines.*.serviceId' => 'nullable|integer',
            'lines.*.name' => 'nullable|string|max:255',
            'lines.*.unit' => 'nullable|string|max:40',
            'lines.*.productId' => 'nullable|integer',
            'lines.*.baseId' => 'nullable|integer',
            'lines.*.coverId' => 'nullable|integer',
            'lines.*.coverType' => 'nullable|string|max:20',
            // A row at 0 prints as an option the client could add; at least one row needs a quantity.
            'lines.*.qty' => 'required|integer|min:0',
            'setId' => 'nullable|integer|exists:offer_sets,id',
            'currency' => 'nullable|string|size:3',
            'discountPct' => 'nullable|numeric|min:0|max:0.95',
            'fxRate' => 'nullable|numeric|gt:0',
            'lines.*.unitPrice' => 'required|numeric|min:0',
            'lines.*.standardPrice' => 'nullable|numeric|min:0',
        ];
    }

    /** Line items with names and cost taken from the stock records, never from the browser. */
    private function buildItems(array $lines): array
    {
        $items = [];
        foreach ($lines as $i => $line) {
            if ($line['kind'] === 'service') {
                // A listed service, or one typed in for this offer only.
                $service = ! empty($line['serviceId']) ? Service::find($line['serviceId']) : null;
                $name = trim($line['name'] ?? '') ?: $service?->name;
                if (! $name) {
                    throw ValidationException::withMessages(["lines.$i" => 'Say what the work is on every service line.']);
                }
                $items[] = [
                    'kind' => 'service', 'service_id' => $service?->id, 'product_id' => null, 'base_id' => null, 'cover_id' => null,
                    'name' => $name, 'unit' => ($line['unit'] ?? null) ?: $service?->unit, 'cost_snapshot' => 0,
                    'qty' => (int) $line['qty'],
                    'unit_price' => round((float) $line['unitPrice'], 2),
                    'standard_price' => round((float) ($line['standardPrice'] ?? 0), 2),
                ];

                continue;
            }
            if ($line['kind'] === 'combo') {
                // A base is sold with a cover type (Q, S…); the colour may already be known or chosen later.
                $base = Base::find($line['baseId'] ?? 0);
                $cover = ! empty($line['coverId']) ? Cover::find($line['coverId']) : null;
                $type = ($line['coverType'] ?? null) ?: $cover?->line;
                if (! $base || (! $cover && ! $type)) {
                    throw ValidationException::withMessages(["lines.$i" => 'Choose a base and its cover type for every line.']);
                }
                if ($cover && $type && $cover->line && $cover->line !== $type) {
                    throw ValidationException::withMessages(["lines.$i" => $cover->name.' is not a '.$type.' cover.']);
                }
                if (! $cover && ! CoverType::where('code', $type)->exists()) {
                    throw ValidationException::withMessages(["lines.$i" => 'Cover type '.$type.' is not in the list.']);
                }
                $row = [
                    'kind' => 'combo', 'base_id' => $base->id, 'cover_id' => $cover?->id, 'cover_type' => $type, 'product_id' => null,
                    // The client sees the base's name; the colour is the warehouse's business.
                    'name' => $base->name,
                    // Until the colour is chosen, the cover's cost is the average of that type's covers.
                    'cost_snapshot' => (float) $base->cost + (float) ($cover ? $cover->cost : (Cover::where('line', $type)->avg('cost') ?? 0)),
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

    private function requireQuantity(array $items): void
    {
        if (! array_filter($items, fn ($i) => $i['qty'] > 0)) {
            throw ValidationException::withMessages(['lines' => 'Give at least one row a quantity.']);
        }
    }

    /** What the lines come to after the discount on the total (labour is not discounted). */
    private function itemsSubtotal(array $items, float $discount = 0): float
    {
        $all = array_sum(array_map(fn ($i) => $i['qty'] * $i['unit_price'], $items));
        $goods = array_sum(array_map(fn ($i) => $i['kind'] === 'service' ? 0 : $i['qty'] * $i['unit_price'], $items));

        return $all - $goods * $discount;
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
