<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class PurchaseOrder extends Model
{
    use Concerns;

    protected $guarded = [];

    public function lines(): HasMany
    {
        return $this->hasMany(PurchaseOrderLine::class);
    }

    public function total(): float
    {
        return (float) $this->lines->sum(fn ($l) => $l->qty * $l->unit_cost) + (float) $this->shipping;
    }

    public function toApi(): array
    {
        return [
            'id' => self::sid($this->id),
            'refNo' => $this->ref_no,
            'supplierId' => self::sid($this->supplier_id),
            'supplierName' => (string) $this->supplier_name,
            'status' => $this->status,
            'lines' => $this->lines->map(fn ($l) => [
                'kind' => $l->kind,
                'itemId' => self::sid($l->item_id),
                'name' => (string) $l->name,
                'qty' => (int) $l->qty,
                'unitCost' => (float) $l->unit_cost,
            ])->values()->all(),
            'orderedDate' => self::d($this->ordered_date),
            'expectedDate' => self::d($this->expected_date),
            'receivedDate' => self::d($this->received_date),
            'shipping' => (float) $this->shipping,
            'notes' => (string) $this->notes,
        ];
    }
}
