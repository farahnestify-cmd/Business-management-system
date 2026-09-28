<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Employee extends Model
{
    use Concerns;

    protected $guarded = [];

    protected $casts = ['active' => 'boolean'];

    public function toApi(): array
    {
        return [
            'id' => self::sid($this->id),
            'name' => $this->name,
            'role' => (string) $this->role,
            'monthlySalary' => (float) $this->monthly_salary,
            'active' => (bool) $this->active,
            'notes' => (string) $this->notes,
        ];
    }
}
