<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Client extends Model
{
    use Concerns;

    protected $guarded = [];

    public function toApi(): array
    {
        return [
            'id' => self::sid($this->id),
            'name' => $this->name,
            'type' => $this->type,
            'region' => $this->region,
            'discountPct' => (float) $this->discount_pct,
            'phone' => (string) $this->phone,
            'email' => (string) $this->email,
            'notes' => (string) $this->notes,
        ];
    }
}
