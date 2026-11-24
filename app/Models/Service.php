<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Service extends Model
{
    use Concerns;

    protected $guarded = [];

    protected $casts = ['active' => 'boolean'];

    public function toApi(): array
    {
        return [
            'id' => self::sid($this->id),
            'name' => $this->name,
            'unit' => (string) $this->unit,
            'rate' => (float) $this->rate,
            'active' => (bool) $this->active,
        ];
    }
}
