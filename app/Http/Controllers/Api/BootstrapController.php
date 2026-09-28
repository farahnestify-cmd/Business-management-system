<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Base;
use App\Models\Client;
use App\Models\CompanySetting;
use App\Models\Cover;
use App\Models\Employee;
use App\Models\Expense;
use App\Models\PayrollPayment;
use App\Models\Product;
use App\Models\PurchaseOrder;
use App\Models\Supplier;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Http\Request;

/**
 * Everything the single-page frontend needs in one response. The browser
 * does the reporting maths, the same way the original app did.
 */
class BootstrapController extends Controller
{
    public function __invoke(Request $request)
    {
        $user = $request->user();
        $owner = $user->isOwner();
        $api = fn ($rows) => $rows->map->toApi()->values();

        return response()->json([
            'user' => $user->toApi(),
            'settings' => CompanySetting::current()->toApi(),
            'clients' => $api(Client::orderBy('name')->get()),
            'products' => $api(Product::orderBy('name')->get()),
            'bases' => $api(Base::orderBy('line')->orderBy('name')->get()),
            'covers' => $api(Cover::orderBy('line')->orderBy('name')->get()),
            'transactions' => $api(Transaction::with(['items', 'payments'])->orderByDesc('created_at')->orderByDesc('id')->get()),
            'expenses' => $api(Expense::orderByDesc('date')->orderByDesc('id')->get()),
            'suppliers' => $api(Supplier::orderBy('name')->get()),
            'orders' => $api(PurchaseOrder::with('lines')->orderByDesc('ordered_date')->orderByDesc('id')->get()),
            // Salary data never leaves the server for staff accounts.
            'employees' => $owner ? $api(Employee::orderBy('name')->get()) : [],
            'payroll' => $owner ? $api(PayrollPayment::orderByDesc('paid_date')->get()) : [],
            'users' => $owner ? $api(User::orderBy('name')->get()) : [],
        ]);
    }
}
