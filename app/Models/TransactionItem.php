<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class TransactionItem extends Model
{
    use Concerns;

    protected $guarded = [];

    public function remaining(): int
    {
        // Labour is not taken off a shelf, so it never waits for delivery.
        if ($this->kind === 'service') {
            return 0;
        }

        return max(0, $this->qty - (int) $this->delivered_qty);
    }

    /** A base sold with a cover type waits for its colour before it can go out. */
    public function needsColour(): bool
    {
        return $this->kind === 'combo' && ! $this->cover_id;
    }

    public function toApi(): array
    {
        $row = [
            'id' => (string) $this->id,
            'kind' => $this->kind,
            'name' => $this->name,
            'qty' => (int) $this->qty,
            'deliveredQty' => (int) $this->delivered_qty,
            'standardPrice' => (float) $this->standard_price,
            'unitPrice' => (float) $this->unit_price,
            'costSnapshot' => (float) $this->cost_snapshot,
        ];
        if ($this->kind === 'service') {
            $row['serviceId'] = self::sid($this->service_id);
            $row['unit'] = (string) $this->unit;
        } elseif ($this->kind === 'combo') {
            $row['baseId'] = self::sid($this->base_id);
            $row['coverId'] = self::sid($this->cover_id);
            $row['coverType'] = (string) $this->cover_type;
        } else {
            $row['productId'] = self::sid($this->product_id);
        }

        return $row;
    }
}
