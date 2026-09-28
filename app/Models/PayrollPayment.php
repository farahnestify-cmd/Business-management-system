<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PayrollPayment extends Model
{
    use Concerns;

    protected $guarded = [];

    public function toApi(): array
    {
        return [
            'id' => self::sid($this->id),
            'employeeId' => self::sid($this->employee_id),
            'employeeName' => $this->employee_name,
            'month' => $this->month,
            'amount' => (float) $this->amount,
            'paid' => true,
            'paidDate' => self::d($this->paid_date),
            'method' => $this->method,
            'notes' => (string) $this->notes,
        ];
    }
}
