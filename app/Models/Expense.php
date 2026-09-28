<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Expense extends Model
{
    use Concerns;

    protected $guarded = [];

    public const CATEGORIES = ['Inventory Purchase', 'Rent', 'Utilities', 'Transport', 'Marketing', 'Tools & Equipment', 'Shipping', 'Fees', 'Other'];

    public function toApi(): array
    {
        return [
            'id' => self::sid($this->id),
            'date' => self::d($this->date),
            'category' => $this->category,
            'description' => $this->description,
            'vendor' => (string) $this->vendor,
            'amount' => (float) $this->amount,
            'paymentMethod' => $this->payment_method,
            'linkedProductId' => (string) $this->linked_product_id,
            'qtyPurchased' => (int) $this->qty_purchased,
            'poRef' => (string) $this->po_ref,
            'poId' => (string) $this->po_id,
            'notes' => (string) $this->notes,
        ];
    }
}
