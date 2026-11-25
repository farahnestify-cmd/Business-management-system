<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Transaction extends Model
{
    use Concerns;

    protected $guarded = [];

    /** Stages a deal may move to from each stage. */
    public const NEXT = [
        'Quotation' => ['Agreement', 'Cancelled'],
        'Agreement' => ['Invoiced', 'Cancelled'],
        'Invoiced' => ['Delivered', 'Cancelled'],
        'Delivered' => [],
        'Cancelled' => [],
    ];

    public function items(): HasMany
    {
        return $this->hasMany(TransactionItem::class);
    }

    public function payments(): HasMany
    {
        return $this->hasMany(Payment::class)->orderBy('date')->orderBy('id');
    }

    /** The reference all versions of this offer share (the first version's). */
    public function rootRef(): string
    {
        return $this->root_ref ?: $this->ref_no;
    }

    /** Every version of this offer, this one included. */
    public function versions()
    {
        $root = $this->rootRef();

        return static::where(fn ($q) => $q->where('root_ref', $root)->orWhere('ref_no', $root));
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function milestones(): HasMany
    {
        return $this->hasMany(Milestone::class)->orderBy('position')->orderBy('id');
    }

    public function subtotal(): float
    {
        return (float) $this->items->sum(fn ($li) => $li->qty * $li->unit_price);
    }

    /**
     * For a deal changed by returns or extra items before the original quotation
     * was kept: works the agreed lines back out of the delivery log. An extra item
     * comes off again, and a unit taken off the deal goes back on.
     */
    public function rebuildOriginalQuote(): bool
    {
        if ($this->quote_snapshot !== null) {
            return false;
        }
        $log = Delivery::where('transaction_id', $this->id)->get();
        $extra = $log->filter(fn ($d) => $d->type === 'out' && str_starts_with((string) $d->note, 'Extra item'));
        $removed = $log->filter(fn ($d) => $d->type === 'return' && str_starts_with((string) $d->note, 'Taken off the deal'));
        if ($extra->isEmpty() && $removed->isEmpty()) {
            return false;
        }

        $lines = [];
        foreach ($this->items()->get() as $li) {
            $row = $li->toApi();
            $row['qty'] = (int) $li->qty
                - (int) $extra->where('transaction_item_id', $li->id)->sum('qty')
                + (int) $removed->where('transaction_item_id', $li->id)->sum('qty');
            // A row that only exists because of extra items was not on the offer.
            if ($row['qty'] <= 0 && $extra->where('transaction_item_id', $li->id)->isNotEmpty()) {
                continue;
            }
            $row['qty'] = max(0, $row['qty']);
            $lines[] = $row;
        }
        $this->quote_snapshot = json_encode($lines);
        $this->save();

        return true;
    }

    /** The discount on the total: it applies to goods, not to labour. */
    public function discountAmount(): float
    {
        return (float) $this->items->where('kind', '!=', 'service')->sum(fn ($li) => $li->qty * $li->unit_price) * (float) $this->discount_pct;
    }

    public function total(): float
    {
        return ($this->subtotal() - $this->discountAmount()) * (1 + $this->vat_pct / 100);
    }

    public function paid(): float
    {
        return (float) $this->payments->sum('amount');
    }

    public function toApi(): array
    {
        return [
            'id' => self::sid($this->id),
            'refNo' => $this->ref_no,
            'rootRef' => $this->root_ref ?: $this->ref_no,
            'version' => (int) ($this->version ?: 1),
            'setId' => self::sid($this->set_id),
            'yymm' => $this->yymm,
            'regionCode' => $this->region_code,
            'typeCode' => $this->type_code,
            'seq' => (int) $this->seq,
            'clientId' => self::sid($this->client_id),
            'clientName' => $this->client_name,
            'clientType' => $this->client_type,
            'region' => $this->region,
            'serviceType' => $this->service_type,
            'status' => $this->status,
            'vatPct' => (float) $this->vat_pct,
            'discountPct' => (float) $this->discount_pct,
            // The lines as quoted, kept once returns or extra items changed the deal (null until then).
            'originalLines' => $this->quote_snapshot ? json_decode($this->quote_snapshot, true) : null,
            'currency' => $this->currency ?: 'USD',
            'fxRate' => (float) ($this->fx_rate ?: 1),
            'lineItems' => $this->items->map(fn ($li) => $li->toApi())->values()->all(),
            'payments' => $this->payments->map(fn ($p) => $p->toApi())->values()->all(),
            'milestones' => $this->milestones->map(fn ($m) => $m->toApi())->values()->all(),
            'quotationDate' => self::d($this->quotation_date),
            'agreementDate' => self::d($this->agreement_date),
            'invoiceDate' => self::d($this->invoice_date),
            'deliveredDate' => self::d($this->delivered_date),
            'dueDate' => self::d($this->due_date),
            'notes' => (string) $this->notes,
            'site' => (string) $this->site,
            'tableTitle' => (string) $this->table_title,
            'soldBy' => (string) $this->sold_by,
            'createdBy' => self::sid($this->created_by),
            'createdByName' => (string) $this->creator?->name,
            // Written from a staff (sales team) account rather than by the office.
            'fromSales' => $this->creator?->role === 'staff',
            'createdAt' => optional($this->created_at)->toIso8601String(),
        ];
    }
}
