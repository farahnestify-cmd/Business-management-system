<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * Shared behaviour of products, bases and covers.
 */
abstract class StockItem extends Model
{
    use Concerns;

    protected $guarded = [];

    /** Maps the kind used by the frontend to its model class. */
    public static function classFor(string $kind): ?string
    {
        return [
            'product' => Product::class,
            'base' => Base::class,
            'cover' => Cover::class,
        ][$kind] ?? null;
    }

    protected function common(): array
    {
        return [
            'id' => self::sid($this->id),
            'name' => $this->name,
            'cost' => (float) $this->cost,
            'baseCost' => (float) $this->cost,
            'stockOnHand' => (int) $this->stock_on_hand,
            'reorderThreshold' => (int) $this->reorder_threshold,
            'notes' => (string) $this->notes,
        ];
    }

    protected function priceBook(): array
    {
        return [
            'dealerPriceWB' => (float) $this->dealer_price_wb,
            'endUserPriceWB' => (float) $this->end_user_price_wb,
            'dealerPrice48' => (float) $this->dealer_price_48,
            'endUserPrice48' => (float) $this->end_user_price_48,
            'programmingFee' => (float) $this->programming_fee,
        ];
    }

    abstract public function toApi(): array;
}
