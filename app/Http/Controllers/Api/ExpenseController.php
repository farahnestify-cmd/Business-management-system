<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Expense;
use App\Models\Product;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Expenses. One linked to a product also restocks it by the units bought;
 * editing or deleting the expense adjusts the stock by the difference.
 */
class ExpenseController extends Controller
{
    public function store(Request $request)
    {
        $expense = DB::transaction(fn () => $this->persist(new Expense, $request));

        return response()->json(['id' => (string) $expense->id], 201);
    }

    public function update(Request $request, Expense $expense)
    {
        DB::transaction(fn () => $this->persist($expense, $request));

        return response()->json(['id' => (string) $expense->id]);
    }

    public function destroy(Expense $expense)
    {
        if ($expense->po_id) {
            return response()->json(['message' => 'This cost was booked by a received purchase order and cannot be deleted.'], 409);
        }
        DB::transaction(function () use ($expense) {
            $this->restock($expense->linked_product_id, -$expense->qty_purchased);
            $expense->delete();
        });

        return response()->json(['ok' => true]);
    }

    private function persist(Expense $expense, Request $request): Expense
    {
        $data = $request->validate([
            'date' => 'required|date',
            'category' => 'required|in:'.implode(',', Expense::CATEGORIES),
            'description' => 'required|string|max:255',
            'vendor' => 'nullable|string|max:255',
            'amount' => 'required|numeric|min:0',
            'paymentMethod' => 'required|in:Cash,Bank Transfer,Cheque',
            'linkedProductId' => 'nullable|integer|exists:products,id',
            'qtyPurchased' => 'nullable|integer|min:0',
            'notes' => 'nullable|string|max:5000',
        ]);

        $newProduct = $data['linkedProductId'] ?? null;
        $newQty = $newProduct ? (int) ($data['qtyPurchased'] ?? 0) : 0;

        // Undo what the previous version of this expense added, then apply the new one.
        if ($expense->exists) {
            $this->restock($expense->linked_product_id, -$expense->qty_purchased);
        }
        $this->restock($newProduct, $newQty);

        $expense->fill([
            'date' => $data['date'],
            'category' => $data['category'],
            'description' => $data['description'],
            'vendor' => $data['vendor'] ?? null,
            'amount' => $data['amount'],
            'payment_method' => $data['paymentMethod'],
            'linked_product_id' => $newProduct,
            'qty_purchased' => $newQty,
            'notes' => $data['notes'] ?? $expense->notes,
        ])->save();

        return $expense;
    }

    private function restock($productId, int $delta): void
    {
        if (! $productId || $delta === 0) {
            return;
        }
        $product = Product::lockForUpdate()->find($productId);
        if ($product) {
            $product->stock_on_hand = max(0, $product->stock_on_hand + $delta);
            $product->save();
        }
    }
}
