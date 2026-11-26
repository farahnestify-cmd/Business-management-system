<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Base;
use App\Models\Client;
use App\Models\Cover;
use App\Models\CoverType;
use App\Models\Currency;
use App\Models\Employee;
use App\Models\PriceTier;
use App\Models\Product;
use App\Models\Service;
use App\Models\StockItem;
use App\Models\Supplier;
use App\Models\Transaction;
use App\Models\TransactionItem;
use App\Support\BigValues;
use App\Support\RecycleBin;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

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

    /** collection => [model, who may write it (any | manager | owner), field map (api => [column, rules])] */
    private function config(string $collection): array
    {
        $name = ['name' => ['name', 'required|string|max:255']];

        return match ($collection) {
            'clients' => [Client::class, 'any', $name + [
                'salutation' => ['salutation', 'nullable|in:Mr.,Mrs.,Ms.'],
                'type' => ['type', 'required|in:End User,Dealer,Partner'],
                'tierId' => ['tier_id', 'nullable|integer|exists:price_tiers,id'],
                'region' => ['region', 'required|in:West Bank,48 Region'],
                'discountPct' => ['discount_pct', 'numeric|min:0|max:1'],
                'phone' => ['phone', 'nullable|string|max:60'],
                'email' => ['email', 'nullable|string|max:255'],
                'notes' => ['notes', 'nullable|string|max:5000'],
            ]],
            'products' => [Product::class, 'manager', $name + [
                'imageData' => ['image_data', 'nullable|string|max:3000000'],
                'category' => ['category', 'required|string|max:40'],
            ] + self::PRICE_BOOK + self::STOCK],
            'bases' => [Base::class, 'manager', $name + [
                'imageData' => ['image_data', 'nullable|string|max:3000000'],
                'typeImages' => ['type_images', 'nullable|array|max:20'],
                'line' => ['line', 'nullable|string|max:40'],
            ] + self::PRICE_BOOK + self::STOCK],
            'covers' => [Cover::class, 'manager', $name + [
                'imageData' => ['image_data', 'nullable|string|max:3000000'],
                'line' => ['line', 'nullable|string|max:40'],
                'color' => ['color', 'nullable|string|max:60'],
                'finish' => ['finish', 'required|in:Glossy,Matte'],
                'priceAddOn' => ['price_add_on', 'numeric|min:0'],
            ] + self::STOCK],
            'suppliers' => [Supplier::class, 'owner', $name + [
                'contact' => ['contact', 'nullable|string|max:255'],
                'phone' => ['phone', 'nullable|string|max:60'],
                'email' => ['email', 'nullable|string|max:255'],
                'country' => ['country', 'nullable|string|max:80'],
                'notes' => ['notes', 'nullable|string|max:5000'],
            ]],
            'currencies' => [Currency::class, 'manager', $name + [
                'code' => ['code', 'required|string|size:3|alpha|not_in:USD,usd'],
                'symbol' => ['symbol', 'nullable|string|max:8'],
                'rate' => ['rate', 'required|numeric|gt:0'],
                'active' => ['active', 'boolean'],
            ]],
            'cover_types' => [CoverType::class, 'manager', [
                'code' => ['code', 'required|string|max:20'],
                'name' => ['name', 'nullable|string|max:255'],
                'addOnEndUser' => ['add_on_end_user', 'numeric|min:0'],
                'addOnDealer' => ['add_on_dealer', 'numeric|min:0'],
            ]],
            'price_tiers' => [PriceTier::class, 'manager', $name + [
                'code' => ['code', 'nullable|string|max:20'],
                'basis' => ['basis', 'required|in:End user,Dealer'],
                'discountPct' => ['discount_pct', 'numeric|min:0|max:1'],
                'targetYear' => ['target_year', 'numeric|min:0'],
                'active' => ['active', 'boolean'],
            ]],
            'services' => [Service::class, 'manager', $name + [
                'unit' => ['unit', 'nullable|string|max:40'],
                'rate' => ['rate', 'numeric|min:0'],
                'active' => ['active', 'boolean'],
            ]],
            'employees' => [Employee::class, 'owner', $name + [
                'role' => ['role', 'nullable|string|max:120'],
                'monthlySalary' => ['monthly_salary', 'numeric|min:0'],
                'active' => ['active', 'boolean'],
                'notes' => ['notes', 'nullable|string|max:5000'],
            ]],
            default => abort(404),
        };
    }

    /** One of a base's pictures for a cover type. */
    public function typeImage(int $id, string $code, int $i)
    {
        return Base::findOrFail($id)->typeImageResponse($code, $i);
    }

    /** A stock item's picture, for the Image column of printed offers. */
    public function image(string $kind, int $id)
    {
        return StockItem::classFor($kind)::findOrFail($id)->imageResponse();
    }

    public function store(Request $request, string $collection)
    {
        [$class, , $fields] = $this->guard($request, $collection);
        $model = new $class;
        $this->fill($model, $request, $fields, true);
        if ($collection === 'currencies') {
            $this->uniqueCode($model);
        }
        if ($collection === 'cover_types') {
            $this->uniqueType($model);
        }
        $this->checkImage($model);
        BigValues::save($model, ['image_data', 'type_images']);

        return response()->json(['id' => (string) $model->id], 201);
    }

    public function update(Request $request, string $collection, int $id)
    {
        [$class, , $fields] = $this->guard($request, $collection);
        $model = $class::findOrFail($id);
        $this->fill($model, $request, $fields, false);
        if ($collection === 'currencies') {
            $this->uniqueCode($model);
        }
        if ($collection === 'cover_types') {
            $this->uniqueType($model);
        }
        $this->checkImage($model);
        BigValues::save($model, ['image_data', 'type_images']);

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

        $kind = ['clients' => 'client', 'products' => 'product', 'bases' => 'base', 'covers' => 'cover',
            'suppliers' => 'supplier', 'employees' => 'employee', 'services' => 'service', 'price_tiers' => 'price_tier', 'currencies' => 'currency', 'cover_types' => 'cover_type'][$collection];
        DB::transaction(fn () => RecycleBin::trash($kind, $model, $model->name ?: $model->code));

        return response()->json(['ok' => true, 'undo' => RecycleBin::$lastUndo]);
    }

    /** Only PNG, JPG or WebP data URLs are kept as pictures: one per item, up to four per cover type on a base. */
    private function checkImage(Model $model): void
    {
        $ok = fn ($d) => is_string($d) && preg_match('#^data:image/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$#', $d);
        $data = $model->getAttribute('image_data');
        if ($data && ! $ok($data)) {
            throw ValidationException::withMessages(['imageData' => 'Choose a PNG, JPG or WebP picture.']);
        }
        if ($data && strlen($data) > BigValues::SAFE) {
            throw ValidationException::withMessages(['imageData' => 'That picture is too large to keep. Choose a smaller one (under about 600 KB).']);
        }
        if ($model instanceof Base && $model->type_images) {
            $clean = [];
            foreach ((array) $model->type_images as $code => $list) {
                $list = array_values(array_filter((array) $list));
                if (count($list) > 4) {
                    throw ValidationException::withMessages(['typeImages' => 'Up to four pictures for each cover type.']);
                }
                foreach ($list as $d) {
                    if (! $ok($d)) {
                        throw ValidationException::withMessages(['typeImages' => 'Choose PNG, JPG or WebP pictures.']);
                    }
                }
                if ($list) {
                    $clean[(string) $code] = $list;
                }
            }
            if ($clean && strlen(json_encode($clean)) > BigValues::SAFE) {
                throw ValidationException::withMessages(['typeImages' => 'These pictures are too large together. Use smaller pictures, or fewer of them.']);
            }
            $model->type_images = $clean ?: null;
        }
    }

    private function uniqueType(Model $type): void
    {
        $type->code = strtoupper(trim($type->code));
        if (CoverType::where('code', $type->code)->where('id', '!=', $type->id ?? 0)->exists()) {
            throw ValidationException::withMessages(['code' => 'Cover type '.$type->code.' is already in the list.']);
        }
    }

    private function uniqueCode(Model $currency): void
    {
        $currency->code = strtoupper($currency->code);
        if (Currency::where('code', $currency->code)->where('id', '!=', $currency->id ?? 0)->exists()) {
            throw ValidationException::withMessages(['code' => $currency->code.' is already in the list.']);
        }
    }

    private function guard(Request $request, string $collection): array
    {
        $cfg = $this->config($collection);
        $user = $request->user();
        if (($cfg[1] === 'owner' && ! $user->isOwner()) || ($cfg[1] === 'manager' && ! $user->isManager())) {
            abort(403, $cfg[1] === 'owner' ? 'Only the owner can change this.' : 'Only an owner or admin can change this.');
        }
        // Cost prices are the owner's: anyone else's edit leaves them as they are.
        if (! $user->seesCosts()) {
            unset($cfg[2]['cost']);
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
