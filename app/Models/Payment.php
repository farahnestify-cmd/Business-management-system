<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Payment extends Model
{
    use Concerns;

    protected $guarded = [];

    public function toApi(): array
    {
        return [
            'id' => self::sid($this->id),
            'date' => self::d($this->date),
            'amount' => (float) $this->amount,
            'method' => $this->method,
            'type' => $this->type,
            'note' => (string) $this->note,
        ];
    }
}
