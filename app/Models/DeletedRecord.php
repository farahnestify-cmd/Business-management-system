<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DeletedRecord extends Model
{
    use Concerns;

    protected $guarded = [];

    protected $casts = ['payload' => 'array'];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'deleted_by');
    }

    public function toApi(): array
    {
        return [
            'id' => self::sid($this->id),
            'kind' => $this->kind,
            'label' => $this->label,
            'removed' => optional($this->created_at)->toIso8601String(),
            'by' => (string) $this->user?->name,
        ];
    }
}
