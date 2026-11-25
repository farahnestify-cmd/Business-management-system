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
    public const KINDS = [
        'product' => Product::class,
        'base' => Base::class,
        'cover' => Cover::class,
    ];

    public static function classFor(string $kind): ?string
    {
        return self::KINDS[$kind] ?? null;
    }

    /** The picture itself, decoded from the stored data URL. */
    public function imageResponse()
    {
        if (! $this->image_data || ! preg_match('#^data:(image/(?:png|jpeg|webp));base64,(.+)$#s', $this->image_data, $m)) {
            abort(404);
        }

        return response(base64_decode($m[2]), 200, ['Content-Type' => $m[1], 'Cache-Control' => 'private, max-age=31536000']);
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
            'image' => $this->image_data
                ? url('/api/images/'.array_search(static::class, self::KINDS).'/'.$this->id).'?v='.substr(md5($this->image_data), 0, 10) : '',
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
