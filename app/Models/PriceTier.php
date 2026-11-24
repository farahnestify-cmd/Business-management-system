<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PriceTier extends Model
{
    use Concerns;

    protected $guarded = [];

    protected $casts = ['active' => 'boolean'];

    public function toApi(): array
    {
        return [
            'id' => self::sid($this->id),
            'name' => $this->name,
            'code' => (string) $this->code,
            'basis' => $this->basis,
            'discountPct' => (float) $this->discount_pct,
            'targetYear' => (float) $this->target_year,
            'active' => (bool) $this->active,
        ];
    }
}
