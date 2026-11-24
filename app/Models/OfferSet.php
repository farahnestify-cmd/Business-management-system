<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class OfferSet extends Model
{
    use Concerns;

    protected $guarded = [];

    protected $casts = ['lines' => 'array'];

    public function toApi(): array
    {
        return [
            'id' => self::sid($this->id),
            'name' => $this->name,
            'lines' => array_values($this->lines ?? []),
        ];
    }
}
