<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Expense;
use App\Models\PurchaseOrder;
use App\Models\StockItem;
use App\Models\Supplier;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Supplier orders. Receiving one adds every line to stock, updates the item
 * cost and books the order total as an "Inventory Purchase" expense.
 */
class PurchaseOrderController extends Controller
{
    public function store(Request $request)
    {
        $po = DB::transaction(function () use ($request) {
            $po = new PurchaseOrder(['ref_no' => $this->nextRef()]);

            return $this->persist($po, $request);
        });

        return response()->json(['id' => (string) $po->id], 201);
    }

    public function update(Request $request, PurchaseOrder $purchaseOrder)
    {
        if ($purchaseOrder->status === 'Received') {
            return response()->json(['message' => 'This order is already received.'], 409);
        }
        DB::transaction(fn () => $this->persist($purchaseOrder, $request));

        return response()->json(['id' => (string) $purchaseOrder->id]);
    }

    public function receive(Request $request, PurchaseOrder $purchaseOrder)
    {
        if ($purchaseOrder->status === 'Received') {
            return response()->json(['message' => 'This order is already received.'], 409);
        }

        DB::transaction(function () use ($request, $purchaseOrder) {
            // The form may hold edits that were not saved yet.
            if ($request->has('lines')) {
                $this->persist($purchaseOrder, $request);
            }
            $purchaseOrder->load('lines');

            foreach ($purchaseOrder->lines as $line) {
                $class = StockItem::classFor($line->kind);
                $item = $class ? $class::lockForUpdate()->find($line->item_id) : null;
                if (! $item) {
                    continue;
                }
                $item->stock_on_hand += $line->qty;
                if ($line->unit_cost > 0) {
                    $item->cost = $line->unit_cost;
                }
                $item->save();
            }

            Expense::create([
                'date' => now()->toDateString(),
                'category' => 'Inventory Purchase',
                'description' => 'Stock received on '.$purchaseOrder->ref_no,
                'vendor' => $purchaseOrder->supplier_name,
                'amount' => $purchaseOrder->total(),
                'payment_method' => 'Bank Transfer',
                'po_ref' => $purchaseOrder->ref_no,
                'po_id' => $purchaseOrder->id,
            ]);

            $purchaseOrder->update(['status' => 'Received', 'received_date' => now()->toDateString()]);
        });

        return response()->json(['ok' => true]);
    }

    public function destroy(PurchaseOrder $purchaseOrder)
    {
        if ($purchaseOrder->status === 'Received') {
            return response()->json(['message' => 'A received order has already moved stock and cannot be deleted.'], 409);
        }
        $purchaseOrder->delete();

        return response()->json(['ok' => true]);
    }

    private function persist(PurchaseOrder $po, Request $request): PurchaseOrder
    {
        $data = $request->validate([
            'supplierId' => 'nullable|integer|exists:suppliers,id',
            'status' => 'nullable|in:Draft,Ordered,Cancelled',
            'orderedDate' => 'nullable|date',
            'expectedDate' => 'nullable|date',
            'shipping' => 'nullable|numeric|min:0',
            'notes' => 'nullable|string|max:5000',
            'lines' => 'required|array|min:1',
            'lines.*.kind' => 'required|in:product,base,cover',
            'lines.*.itemId' => 'required|integer',
            'lines.*.qty' => 'required|integer|min:1',
            'lines.*.unitCost' => 'nullable|numeric|min:0',
        ]);

        $supplier = isset($data['supplierId']) ? Supplier::find($data['supplierId']) : null;
        $po->fill([
            'supplier_id' => $supplier?->id,
            'supplier_name' => $supplier?->name ?? '',
            'status' => $data['status'] ?? ($po->status ?: 'Draft'),
            'ordered_date' => $data['orderedDate'] ?? now()->toDateString(),
            'expected_date' => $data['expectedDate'] ?? null,
            'shipping' => $data['shipping'] ?? 0,
            'notes' => $data['notes'] ?? null,
        ])->save();

        $po->lines()->delete();
        foreach ($data['lines'] as $line) {
            $class = StockItem::classFor($line['kind']);
            $item = $class::find($line['itemId']);
            if (! $item) {
                continue;
            }
            $po->lines()->create([
                'kind' => $line['kind'],
                'item_id' => $item->id,
                'name' => $item->name,
                'qty' => $line['qty'],
                'unit_cost' => $line['unitCost'] ?? 0,
            ]);
        }

        return $po;
    }

    /** PO + YYMM + two-digit counter, e.g. PO260901. */
    private function nextRef(): string
    {
        $prefix = 'PO'.now()->format('ym');
        $last = PurchaseOrder::where('ref_no', 'like', $prefix.'%')->lockForUpdate()->pluck('ref_no')
            ->map(fn ($r) => (int) substr($r, strlen($prefix)))->max() ?? 0;

        return $prefix.str_pad((string) ($last + 1), 2, '0', STR_PAD_LEFT);
    }
}
