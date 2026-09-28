<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class TransactionItem extends Model
{
    use Concerns;

    protected $guarded = [];

    public function toApi(): array
    {
        $row = [
            'kind' => $this->kind,
            'name' => $this->name,
            'qty' => (int) $this->qty,
            'standardPrice' => (float) $this->standard_price,
            'unitPrice' => (float) $this->unit_price,
            'costSnapshot' => (float) $this->cost_snapshot,
        ];
        if ($this->kind === 'combo') {
            $row['baseId'] = self::sid($this->base_id);
            $row['coverId'] = self::sid($this->cover_id);
        } else {
            $row['productId'] = self::sid($this->product_id);
        }

        return $row;
    }
}
