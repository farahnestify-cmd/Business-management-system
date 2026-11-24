<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Milestone extends Model
{
    use Concerns;

    protected $table = 'payment_milestones';

    protected $guarded = [];

    public function payment(): BelongsTo
    {
        return $this->belongsTo(Payment::class);
    }

    public function toApi(): array
    {
        return [
            'id' => self::sid($this->id),
            'label' => $this->label,
            'amount' => (float) $this->amount,
            'dueDate' => self::d($this->due_date),
            'paid' => $this->payment_id !== null,
            'paidDate' => self::d($this->payment?->date),
        ];
    }
}
