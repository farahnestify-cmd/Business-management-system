<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Delivery extends Model
{
    use Concerns;

    protected $guarded = [];

    public function line(): BelongsTo
    {
        return $this->belongsTo(TransactionItem::class, 'transaction_item_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** Flattened with the line's item ids so the browser can filter by product, base or cover. */
    public function toApi(): array
    {
        $li = $this->line;

        return [
            'id' => self::sid($this->id),
            'transactionId' => self::sid($this->transaction_id),
            'name' => (string) $li?->name,
            'kind' => $li?->kind,
            'productId' => self::sid($li?->product_id),
            'baseId' => self::sid($li?->base_id),
            'coverId' => self::sid($li?->cover_id),
            'qty' => (int) $this->qty,
            'date' => self::d($this->delivered_on),
            'by' => (string) $this->user?->name,
        ];
    }
}
