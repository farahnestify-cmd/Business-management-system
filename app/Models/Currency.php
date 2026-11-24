<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Currency extends Model
{
    use Concerns;

    protected $guarded = [];

    protected $casts = ['active' => 'boolean'];

    public function toApi(): array
    {
        return [
            'id' => self::sid($this->id),
            'code' => $this->code,
            'name' => $this->name,
            'symbol' => (string) $this->symbol,
            'rate' => (float) $this->rate,
            'active' => (bool) $this->active,
        ];
    }
}
