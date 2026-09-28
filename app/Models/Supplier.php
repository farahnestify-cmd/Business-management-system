<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Supplier extends Model
{
    use Concerns;

    protected $guarded = [];

    public function toApi(): array
    {
        return [
            'id' => self::sid($this->id),
            'name' => $this->name,
            'contact' => (string) $this->contact,
            'phone' => (string) $this->phone,
            'email' => (string) $this->email,
            'country' => (string) $this->country,
            'notes' => (string) $this->notes,
        ];
    }
}
