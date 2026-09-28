<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
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

    public function subtotal(): float
    {
        return (float) $this->items->sum(fn ($li) => $li->qty * $li->unit_price);
    }

    public function total(): float
    {
        return $this->subtotal() * (1 + $this->vat_pct / 100);
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
            'lineItems' => $this->items->map(fn ($li) => $li->toApi())->values()->all(),
            'payments' => $this->payments->map(fn ($p) => $p->toApi())->values()->all(),
            'quotationDate' => self::d($this->quotation_date),
            'agreementDate' => self::d($this->agreement_date),
            'invoiceDate' => self::d($this->invoice_date),
            'deliveredDate' => self::d($this->delivered_date),
            'dueDate' => self::d($this->due_date),
            'notes' => (string) $this->notes,
            'createdAt' => optional($this->created_at)->toIso8601String(),
        ];
    }
}
