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
