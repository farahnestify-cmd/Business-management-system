<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** A cover type such as Q or S, and what it adds to a base's price. */
class CoverType extends Model
{
    use Concerns;

    protected $guarded = [];

    public function addOnFor(string $clientType): float
    {
        return (float) ($clientType === 'Dealer' ? $this->add_on_dealer : $this->add_on_end_user);
    }

    public function toApi(): array
    {
        return [
            'id' => self::sid($this->id),
            'code' => $this->code,
            'name' => (string) ($this->name ?: $this->code),
            'addOnEndUser' => (float) $this->add_on_end_user,
            'addOnDealer' => (float) $this->add_on_dealer,
        ];
    }
}
