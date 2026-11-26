<?php

namespace App\Support;

use App\Models\Base;
use App\Models\Client;
use App\Models\Cover;
use App\Models\CoverType;
use App\Models\Currency;
use App\Models\DeletedRecord;
use App\Models\Employee;
use App\Models\Expense;
use App\Models\Milestone;
use App\Models\OfferSet;
use App\Models\Payment;
use App\Models\PayrollPayment;
use App\Models\PriceTier;
use App\Models\Product;
use App\Models\PurchaseOrder;
use App\Models\Service;
use App\Models\Supplier;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * Deleting moves a record here instead of losing it: its row, its child rows,
 * and the links other records had to it, so a restore puts everything back
 * as it was (and undoes any stock the delete had reversed).
 */
class RecycleBin
{
    /** kind => [model, label shown in the bin] */
    private const KINDS = [
        'client' => [Client::class, 'Contact'],
        'product' => [Product::class, 'Product'],
        'base' => [Base::class, 'Base'],
        'cover' => [Cover::class, 'Cover'],
        'supplier' => [Supplier::class, 'Supplier'],
        'service' => [Service::class, 'Service'],
        'offer_set' => [OfferSet::class, 'Offer set'],
        'price_tier' => [PriceTier::class, 'Price tier'],
        'cover_type' => [CoverType::class, 'Cover type'],
        'currency' => [Currency::class, 'Currency'],
        'employee' => [Employee::class, 'Person'],
        'expense' => [Expense::class, 'Expense'],
        'purchase_order' => [PurchaseOrder::class, 'Purchase order'],
        'payment' => [Payment::class, 'Payment'],
        'payroll_payment' => [PayrollPayment::class, 'Salary payment'],
        'user' => [User::class, 'Account'],
    ];

    public static function kindLabel(string $kind): string
    {
        return self::KINDS[$kind][1] ?? $kind;
    }

    /** Copy the record into the bin, then delete it. */
    /** The Undo ticket for the most recent delete in this request. */
    public static ?string $lastUndo = null;

    public static function trash(string $kind, Model $model, string $label): void
    {
        $payload = ['row' => $model->getAttributes(), 'children' => [], 'links' => []];

        if ($kind === 'purchase_order') {
            $payload['children']['purchase_order_lines'] = DB::table('purchase_order_lines')
                ->where('purchase_order_id', $model->id)->get()->map(fn ($r) => (array) $r)->all();
        }
        if ($kind === 'client') {
            $payload['links']['transactions'] = Transaction::where('client_id', $model->id)->pluck('id')->all();
        }
        if ($kind === 'price_tier') {
            $payload['links']['clients'] = Client::where('tier_id', $model->id)->pluck('id')->all();
        }
        if ($kind === 'employee') {
            $payload['links']['payroll_payments'] = PayrollPayment::where('employee_id', $model->id)->pluck('id')->all();
        }
        if ($kind === 'payment') {
            $payload['links']['milestones'] = Milestone::where('payment_id', $model->id)->pluck('id')->all();
            $tx = Transaction::find($model->transaction_id);
            $label .= $tx ? ' · '.$tx->ref_no.' · '.$tx->client_name : '';
        }

        $rec = new DeletedRecord([
            'kind' => $kind,
            'label' => $label,
            'payload' => $payload,
            'deleted_by' => auth()->id(),
        ]);
        BigValues::save($rec, ['payload']); // a deleted item can carry its pictures
        $model->delete();
        self::$lastUndo = Undo::offer('trash', ['id' => $rec->id]);
    }

    /** Put a record back; returns a short description of what came back. */
    public static function restore(DeletedRecord $rec): string
    {
        $class = self::KINDS[$rec->kind][0] ?? null;
        if (! $class) {
            throw new RuntimeException('This kind of record cannot be restored.');
        }

        return DB::transaction(function () use ($rec, $class) {
            $p = $rec->payload;
            $row = $p['row'];
            $model = new $class;
            $table = $model->getTable();

            self::guardConflicts($rec->kind, $row);

            // Same id when it is still free, so everything that pointed at it lines up again.
            if (DB::table($table)->where('id', $row['id'])->exists()) {
                unset($row['id']);
            }
            $row = self::dropMissingParents($rec->kind, $row);
            $id = DB::table($table)->insertGetId($row);

            foreach ($p['children'] ?? [] as $childTable => $rows) {
                foreach ($rows as $child) {
                    unset($child['id']);
                    $child['purchase_order_id'] = $id;
                    DB::table($childTable)->insert($child);
                }
            }

            $links = $p['links'] ?? [];
            if (! empty($links['transactions'])) {
                Transaction::whereIn('id', $links['transactions'])->whereNull('client_id')->update(['client_id' => $id]);
            }
            if (! empty($links['clients'])) {
                Client::whereIn('id', $links['clients'])->whereNull('tier_id')->update(['tier_id' => $id]);
            }
            if (! empty($links['payroll_payments'])) {
                PayrollPayment::whereIn('id', $links['payroll_payments'])->whereNull('employee_id')->update(['employee_id' => $id]);
            }
            if (! empty($links['milestones'])) {
                Milestone::whereIn('id', $links['milestones'])->whereNull('payment_id')->update(['payment_id' => $id]);
            }
            // Deleting the expense took its restock back off the shelf; restoring puts it back on.
            if ($rec->kind === 'expense' && ! empty($row['linked_product_id']) && (int) ($row['qty_purchased'] ?? 0) > 0) {
                $product = Product::lockForUpdate()->find($row['linked_product_id']);
                if ($product) {
                    $product->increment('stock_on_hand', (int) $row['qty_purchased']);
                }
            }

            $rec->delete();

            return self::kindLabel($rec->kind).' “'.$rec->label.'” restored';
        });
    }

    private static function guardConflicts(string $kind, array $row): void
    {
        if ($kind === 'user' && User::where('email', $row['email'])->exists()) {
            throw new RuntimeException('An account with '.$row['email'].' exists again, so this one cannot come back.');
        }
        if ($kind === 'purchase_order' && PurchaseOrder::where('ref_no', $row['ref_no'])->exists()) {
            throw new RuntimeException('Another purchase order now uses '.$row['ref_no'].'.');
        }
        if ($kind === 'payment' && ! Transaction::whereKey($row['transaction_id'])->exists()) {
            throw new RuntimeException('The deal this payment belonged to no longer exists.');
        }
        if ($kind === 'payroll_payment' && $row['employee_id']
            && PayrollPayment::where('employee_id', $row['employee_id'])->where('month', $row['month'])->exists()) {
            throw new RuntimeException('That person already has a salary payment for this month.');
        }
    }

    /** Links to records that are gone are cleared rather than blocking the restore. */
    private static function dropMissingParents(string $kind, array $row): array
    {
        $parents = [
            'supplier_id' => 'suppliers', 'employee_id' => 'employees', 'linked_product_id' => 'products',
            'po_id' => 'purchase_orders', 'client_id' => 'clients',
        ];
        foreach ($parents as $col => $table) {
            if (! empty($row[$col]) && ! DB::table($table)->where('id', $row[$col])->exists()) {
                $row[$col] = null;
            }
        }

        return $row;
    }
}
