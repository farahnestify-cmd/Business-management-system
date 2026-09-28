<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Base;
use App\Models\Client;
use App\Models\Cover;
use App\Models\Employee;
use App\Models\Product;
use App\Models\Supplier;
use App\Models\Transaction;
use App\Models\TransactionItem;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;

/**
 * Create / update / delete for the plain records: contacts, stock items,
 * suppliers and employees. The frontend sends camelCase fields, exactly as
 * it receives them.
 */
class RecordController extends Controller
{
    private const PRICE_BOOK = [
        'dealerPriceWB' => ['dealer_price_wb', 'numeric|min:0'],
        'endUserPriceWB' => ['end_user_price_wb', 'numeric|min:0'],
        'dealerPrice48' => ['dealer_price_48', 'numeric|min:0'],
        'endUserPrice48' => ['end_user_price_48', 'numeric|min:0'],
        'programmingFee' => ['programming_fee', 'numeric|min:0'],
    ];

    private const STOCK = [
        'cost' => ['cost', 'numeric|min:0'],
        'stockOnHand' => ['stock_on_hand', 'integer|min:0'],
        'reorderThreshold' => ['reorder_threshold', 'integer|min:0'],
        'notes' => ['notes', 'nullable|string|max:5000'],
    ];

    /** collection => [model, owner only, field map (api => [column, rules])] */
    private function config(string $collection): array
    {
        $name = ['name' => ['name', 'required|string|max:255']];

        return match ($collection) {
            'clients' => [Client::class, false, $name + [
                'type' => ['type', 'required|in:End User,Dealer,Partner'],
                'region' => ['region', 'required|in:West Bank,48 Region'],
                'discountPct' => ['discount_pct', 'numeric|min:0|max:1'],
                'phone' => ['phone', 'nullable|string|max:60'],
                'email' => ['email', 'nullable|string|max:255'],
                'notes' => ['notes', 'nullable|string|max:5000'],
            ]],
            'products' => [Product::class, false, $name + [
                'category' => ['category', 'required|string|max:40'],
            ] + self::PRICE_BOOK + self::STOCK],
            'bases' => [Base::class, false, $name + [
                'line' => ['line', 'nullable|string|max:40'],
            ] + self::PRICE_BOOK + self::STOCK],
            'covers' => [Cover::class, false, $name + [
                'line' => ['line', 'nullable|string|max:40'],
                'color' => ['color', 'nullable|string|max:60'],
                'finish' => ['finish', 'required|in:Glossy,Matte'],
                'priceAddOn' => ['price_add_on', 'numeric|min:0'],
            ] + self::STOCK],
            'suppliers' => [Supplier::class, false, $name + [
                'contact' => ['contact', 'nullable|string|max:255'],
                'phone' => ['phone', 'nullable|string|max:60'],
                'email' => ['email', 'nullable|string|max:255'],
                'country' => ['country', 'nullable|string|max:80'],
                'notes' => ['notes', 'nullable|string|max:5000'],
            ]],
            'employees' => [Employee::class, true, $name + [
                'role' => ['role', 'nullable|string|max:120'],
                'monthlySalary' => ['monthly_salary', 'numeric|min:0'],
                'active' => ['active', 'boolean'],
                'notes' => ['notes', 'nullable|string|max:5000'],
            ]],
            default => abort(404),
        };
    }

    public function store(Request $request, string $collection)
    {
        [$class, , $fields] = $this->guard($request, $collection);
        $model = new $class;
        $this->fill($model, $request, $fields, true);
        $model->save();

        return response()->json(['id' => (string) $model->id], 201);
    }

    public function update(Request $request, string $collection, int $id)
    {
        [$class, , $fields] = $this->guard($request, $collection);
        $model = $class::findOrFail($id);
        $this->fill($model, $request, $fields, false);
        $model->save();

        return response()->json(['id' => (string) $model->id]);
    }

    public function destroy(Request $request, string $collection, int $id)
    {
        [$class] = $this->guard($request, $collection);
        $model = $class::findOrFail($id);

        if ($collection === 'clients' && Transaction::where('client_id', $id)->where('status', '!=', 'Cancelled')->exists()) {
            return response()->json(['message' => 'This contact has deals on record. Cancel them first, or keep the contact.'], 409);
        }
        $column = ['products' => 'product_id', 'bases' => 'base_id', 'covers' => 'cover_id'][$collection] ?? null;
        if ($column && TransactionItem::where($column, $id)->exists()) {
            return response()->json(['message' => 'This item appears on deals, so it cannot be deleted. Set its stock to zero instead.'], 409);
        }

        $model->delete();

        return response()->json(['ok' => true]);
    }

    private function guard(Request $request, string $collection): array
    {
        $cfg = $this->config($collection);
        if ($cfg[1] && ! $request->user()->isOwner()) {
            abort(403, 'Only the owner can change this.');
        }

        return $cfg;
    }

    private function fill(Model $model, Request $request, array $fields, bool $creating): void
    {
        $rules = [];
        foreach ($fields as $key => [, $rule]) {
            // On update, fields the client left out keep their stored value.
            $rules[$key] = ($creating || str_starts_with($rule, 'required') ? '' : 'sometimes|').$rule;
        }
        $data = $request->validate($rules);

        foreach ($fields as $key => [$column]) {
            if (array_key_exists($key, $data)) {
                $model->{$column} = $data[$key];
            }
        }
    }
}
