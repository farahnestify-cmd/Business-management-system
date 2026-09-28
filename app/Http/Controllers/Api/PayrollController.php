<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\PayrollPayment;
use Illuminate\Http\Request;

/**
 * Salary payments. The routes sit behind the owner-only middleware, so staff
 * accounts can neither read nor write payroll.
 */
class PayrollController extends Controller
{
    public function store(Request $request)
    {
        $data = $request->validate([
            'employeeId' => 'required|integer|exists:employees,id',
            'method' => 'nullable|in:Cash,Bank Transfer,Cheque',
        ]);
        $employee = Employee::findOrFail($data['employeeId']);
        $month = now()->format('ym');

        if (PayrollPayment::where('employee_id', $employee->id)->where('month', $month)->exists()) {
            return response()->json(['message' => $employee->name.' is already paid for this month.'], 409);
        }

        $payment = PayrollPayment::create([
            'employee_id' => $employee->id,
            'employee_name' => $employee->name,
            'month' => $month,
            'amount' => $employee->monthly_salary,
            'paid_date' => now()->toDateString(),
            'method' => $data['method'] ?? 'Cash',
        ]);

        return response()->json(['id' => (string) $payment->id], 201);
    }

    public function destroy(PayrollPayment $payrollPayment)
    {
        $payrollPayment->delete();

        return response()->json(['ok' => true]);
    }
}
