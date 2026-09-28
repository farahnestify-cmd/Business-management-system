<?php

namespace Tests\Feature;

use App\Models\Base;
use App\Models\Client;
use App\Models\Cover;
use App\Models\Employee;
use App\Models\Product;
use App\Models\Supplier;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class BusinessFlowTest extends TestCase
{
    use RefreshDatabase;

    private function owner(): User
    {
        return User::create(['name' => 'Owner', 'email' => 'o@example.com', 'password' => 'secret123', 'role' => 'owner']);
    }

    private function staff(): User
    {
        return User::create(['name' => 'Staff', 'email' => 's@example.com', 'password' => 'secret123', 'role' => 'staff']);
    }

    public function test_guests_are_sent_to_login(): void
    {
        $this->get('/')->assertRedirect('/login');
        $this->getJson('/api/bootstrap')->assertUnauthorized();
    }

    public function test_quotation_to_delivery_moves_stock_and_numbers_references(): void
    {
        $this->actingAs($this->owner());
        $client = Client::create(['name' => 'Dealer', 'type' => 'Dealer', 'region' => '48 Region']);
        $product = Product::create(['name' => 'Lock', 'category' => 'Door Lock', 'cost' => 100, 'stock_on_hand' => 10]);
        $base = Base::create(['name' => 'Switch', 'line' => 'Q', 'cost' => 10, 'stock_on_hand' => 20]);
        $cover = Cover::create(['name' => 'Black', 'line' => 'Q', 'cost' => 2, 'stock_on_hand' => 20]);

        $offer = fn ($type) => $this->postJson('/api/transactions', [
            'clientId' => $client->id, 'region' => '48 Region', 'dealType' => $type,
            'serviceType' => 'With Programming', 'date' => '2026-09-10', 'paid' => 100, 'method' => 'Cash',
            'lines' => [
                ['kind' => 'product', 'productId' => $product->id, 'qty' => 2, 'unitPrice' => 200],
                ['kind' => 'combo', 'baseId' => $base->id, 'coverId' => $cover->id, 'qty' => 5, 'unitPrice' => 40],
            ],
        ])->assertCreated();

        $first = $offer('Direct')->json();
        $this->assertSame('2609FD01', $first['refNo']);
        $this->assertSame('2609FP02', $offer('Partner')->json('refNo'));

        $id = $first['id'];
        $this->postJson("/api/transactions/$id/advance", ['status' => 'Invoiced'])->assertStatus(409);
        foreach (['Agreement', 'Invoiced', 'Delivered'] as $stage) {
            $this->postJson("/api/transactions/$id/advance", ['status' => $stage])->assertOk();
        }
        $this->postJson("/api/transactions/$id/payments", ['amount' => 50, 'method' => 'Cheque'])->assertOk();

        $this->assertSame(8, $product->fresh()->stock_on_hand);
        $this->assertSame(15, $base->fresh()->stock_on_hand);
        $this->assertSame(15, $cover->fresh()->stock_on_hand);

        $tx = collect($this->getJson('/api/bootstrap')->json('transactions'))->firstWhere('id', $id);
        $this->assertSame('Delivered', $tx['status']);
        $this->assertSame('Switch · Black', $tx['lineItems'][1]['name']);
        $this->assertEquals(12, $tx['lineItems'][1]['costSnapshot']);
        $this->assertSame(['Down Payment', 'Balance Payment'], array_column($tx['payments'], 'type'));
    }

    public function test_receiving_a_purchase_order_restocks_and_books_the_cost(): void
    {
        $this->actingAs($this->owner());
        $supplier = Supplier::create(['name' => 'Factory']);
        $product = Product::create(['name' => 'Lock', 'category' => 'Door Lock', 'cost' => 100, 'stock_on_hand' => 1]);

        $po = $this->postJson('/api/purchase_orders', [
            'supplierId' => $supplier->id, 'status' => 'Ordered', 'shipping' => 30,
            'lines' => [['kind' => 'product', 'itemId' => $product->id, 'qty' => 4, 'unitCost' => 90]],
        ])->assertCreated()->json('id');

        $this->postJson("/api/purchase_orders/$po/receive")->assertOk();
        $this->postJson("/api/purchase_orders/$po/receive")->assertStatus(409);

        $product->refresh();
        $this->assertSame(5, $product->stock_on_hand);
        $this->assertEquals(90, $product->cost);
        $this->assertDatabaseHas('expenses', ['category' => 'Inventory Purchase', 'amount' => 390, 'vendor' => 'Factory']);
    }

    public function test_expense_restock_is_corrected_on_edit_and_delete(): void
    {
        $this->actingAs($this->owner());
        $product = Product::create(['name' => 'Cable', 'category' => 'Accessory', 'stock_on_hand' => 0]);
        $body = ['date' => '2026-09-01', 'category' => 'Other', 'description' => 'Cables', 'amount' => 20,
            'paymentMethod' => 'Cash', 'linkedProductId' => $product->id, 'qtyPurchased' => 10];

        $id = $this->postJson('/api/expenses', $body)->assertCreated()->json('id');
        $this->assertSame(10, $product->fresh()->stock_on_hand);

        $this->putJson("/api/expenses/$id", ['qtyPurchased' => 6] + $body)->assertOk();
        $this->assertSame(6, $product->fresh()->stock_on_hand);

        $this->deleteJson("/api/expenses/$id")->assertOk();
        $this->assertSame(0, $product->fresh()->stock_on_hand);
    }

    public function test_staff_never_see_or_touch_payroll(): void
    {
        Employee::create(['name' => 'Omar', 'monthly_salary' => 900]);
        $this->actingAs($this->staff());

        $data = $this->getJson('/api/bootstrap')->assertOk()->json();
        $this->assertSame([], $data['employees']);
        $this->assertSame([], $data['payroll']);
        $this->postJson('/api/payroll_payments', ['employeeId' => 1])->assertForbidden();
        $this->postJson('/api/employees', ['name' => 'X'])->assertForbidden();
        $this->putJson('/api/settings', ['name' => 'X'])->assertForbidden();
    }

    public function test_owner_pays_salary_once_per_month(): void
    {
        $this->actingAs($this->owner());
        $e = Employee::create(['name' => 'Omar', 'monthly_salary' => 900]);

        $this->postJson('/api/payroll_payments', ['employeeId' => $e->id])->assertCreated();
        $this->postJson('/api/payroll_payments', ['employeeId' => $e->id])->assertStatus(409);
        $this->assertEquals(900, $this->getJson('/api/bootstrap')->json('payroll.0.amount'));
    }

    public function test_contact_with_deals_cannot_be_deleted(): void
    {
        $this->actingAs($this->owner());
        $client = Client::create(['name' => 'C', 'type' => 'End User', 'region' => 'West Bank']);
        $product = Product::create(['name' => 'P', 'category' => 'Other']);
        $this->postJson('/api/transactions', [
            'clientId' => $client->id, 'region' => 'West Bank', 'dealType' => 'Direct', 'serviceType' => 'Without Programming',
            'date' => '2026-09-10', 'lines' => [['kind' => 'product', 'productId' => $product->id, 'qty' => 1, 'unitPrice' => 5]],
        ])->assertCreated();

        $this->deleteJson("/api/clients/{$client->id}")->assertStatus(409);
        $this->deleteJson("/api/products/{$product->id}")->assertStatus(409);
    }
}
