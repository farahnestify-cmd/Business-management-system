<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Base;
use App\Models\Client;
use App\Models\CompanySetting;
use App\Models\Cover;
use App\Models\CoverType;
use App\Models\Currency;
use App\Models\DeletedRecord;
use App\Models\Delivery;
use App\Models\Employee;
use App\Models\Expense;
use App\Models\OfferSet;
use App\Models\PayrollPayment;
use App\Models\PriceTier;
use App\Models\Product;
use App\Models\PurchaseOrder;
use App\Models\Service;
use App\Models\Supplier;
use App\Models\Transaction;
use App\Models\User;
use App\Support\Backups;
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
        // Below the owner, cost prices never leave the server: they arrive as zero.
        $stock = fn ($rows) => $rows->map(fn ($m) => $owner ? $m->toApi() : array_merge($m->toApi(), ['cost' => 0, 'baseCost' => 0]))->values();
        $deals = Transaction::with(['items', 'payments', 'milestones.payment', 'creator'])->orderByDesc('created_at')->orderByDesc('id')->get()
            ->map(function ($t) use ($owner) {
                $row = $t->toApi();
                if (! $owner) {
                    $row['lineItems'] = array_map(fn ($li) => array_merge($li, ['costSnapshot' => 0]), $row['lineItems']);
                }

                return $row;
            })->values();

        // The owner's visit is what makes an automatic backup when one is due.
        $autoBackup = null;
        if ($owner) {
            try {
                Backups::runIfDue();
            } catch (\Throwable $e) {
                report($e); // a full disk must not keep anyone out of the system
            }
            $autoBackup = Backups::latestAuto();
        }

        return response()->json([
            'user' => $user->toApi(),
            'autoBackup' => $autoBackup,
            'settings' => CompanySetting::current()->toApi(),
            'clients' => $api(Client::orderBy('name')->get()),
            'products' => $stock(Product::orderBy('name')->get()),
            'bases' => $stock(Base::orderBy('line')->orderBy('name')->get()),
            'covers' => $stock(Cover::orderBy('line')->orderBy('name')->get()),
            'transactions' => $deals,
            'services' => $api(Service::orderBy('name')->get()),
            'sets' => $api(OfferSet::orderBy('name')->get()),
            'tiers' => $api(PriceTier::orderBy('name')->get()),
            'coverTypes' => $api(CoverType::orderBy('code')->get()),
            'currencies' => $api(Currency::orderBy('code')->get()),
            'deliveries' => $api(Delivery::with(['line', 'user'])->orderByDesc('delivered_on')->orderByDesc('id')->get()),
            // Money, purchasing, salaries, accounts and the bin are the owner's.
            'expenses' => $owner ? $api(Expense::orderByDesc('date')->orderByDesc('id')->get()) : [],
            'suppliers' => $owner ? $api(Supplier::orderBy('name')->get()) : [],
            'orders' => $owner ? $api(PurchaseOrder::with('lines')->orderByDesc('ordered_date')->orderByDesc('id')->get()) : [],
            'employees' => $owner ? $api(Employee::orderBy('name')->get()) : [],
            'payroll' => $owner ? $api(PayrollPayment::orderByDesc('paid_date')->get()) : [],
            'users' => $owner ? $api(User::orderBy('name')->get()) : [],
            'trash' => $owner ? $api(DeletedRecord::with('user')->latest('id')->limit(300)->get()) : [],
        ]);
    }
}
