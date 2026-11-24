<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Expense;
use App\Models\Product;
use App\Models\Supplier;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class RolesTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $role): User
    {
        return User::create(['name' => ucfirst($role), 'email' => $role.'@example.com', 'password' => 'secret123', 'role' => $role]);
    }

    private function seedDeal(): Product
    {
        $owner = User::where('role', 'owner')->first() ?? $this->user('owner');
        $p = Product::create(['name' => 'Lock', 'category' => 'Door Lock', 'cost' => 120, 'stock_on_hand' => 5]);
        $c = Client::create(['name' => 'C', 'type' => 'End User', 'region' => 'West Bank']);
        Supplier::create(['name' => 'Factory']);
        Expense::create(['date' => '2026-11-01', 'category' => 'Rent', 'description' => 'Rent', 'amount' => 600, 'payment_method' => 'Cash']);
        $this->actingAs($owner)->postJson('/api/transactions', [
            'clientId' => $c->id, 'region' => 'West Bank', 'dealType' => 'Direct', 'serviceType' => 'Without Programming',
            'date' => '2026-11-01', 'lines' => [['kind' => 'product', 'productId' => $p->id, 'qty' => 1, 'unitPrice' => 200]],
        ])->assertCreated();

        return $p;
    }

    public function test_owner_sees_costs_and_money(): void
    {
        $this->seedDeal();
        $d = $this->getJson('/api/bootstrap')->json();
        $this->assertEquals(120, $d['products'][0]['cost']);
        $this->assertEquals(120, $d['transactions'][0]['lineItems'][0]['costSnapshot']);
        $this->assertCount(1, $d['expenses']);
        $this->assertCount(1, $d['suppliers']);
    }

    public function test_admin_and_sales_never_receive_costs_or_money(): void
    {
        $this->seedDeal();
        foreach (['admin', 'staff'] as $role) {
            $d = $this->actingAs($this->user($role))->getJson('/api/bootstrap')->json();
            $this->assertEquals(0, $d['products'][0]['cost'], $role);
            $this->assertEquals(0, $d['transactions'][0]['lineItems'][0]['costSnapshot'], $role);
            $this->assertSame([], $d['expenses'], $role);
            $this->assertSame([], $d['suppliers'], $role);
            $this->assertSame([], $d['orders'], $role);
            $this->assertSame([], $d['payroll'], $role);
        }
    }

    public function test_admin_keeps_the_catalogue_and_settings_but_not_costs_or_purchasing(): void
    {
        $p = $this->seedDeal();
        $this->actingAs($this->user('admin'));

        $this->putJson("/api/products/{$p->id}", ['name' => 'Lock X', 'category' => 'Door Lock', 'cost' => 1, 'endUserPriceWB' => 260])->assertOk();
        $p->refresh();
        $this->assertSame('Lock X', $p->name);
        $this->assertEquals(260, $p->end_user_price_wb);
        $this->assertEquals(120, $p->cost);

        $this->putJson('/api/settings', ['name' => 'Nestify Co'])->assertOk();
        $this->postJson('/api/expenses', ['date' => '2026-11-02', 'category' => 'Other', 'description' => 'x', 'amount' => 1, 'paymentMethod' => 'Cash'])->assertForbidden();
        $this->postJson('/api/purchase_orders', ['lines' => [['kind' => 'product', 'itemId' => $p->id, 'qty' => 1]]])->assertForbidden();
        $this->postJson('/api/suppliers', ['name' => 'X'])->assertForbidden();
        $this->postJson('/api/users', ['name' => 'X', 'email' => 'x@example.com', 'password' => 'secret123', 'role' => 'staff'])->assertForbidden();
    }

    public function test_sales_sells_but_cannot_change_the_catalogue_or_settings(): void
    {
        $p = $this->seedDeal();
        $this->actingAs($this->user('staff'));

        $this->postJson('/api/clients', ['name' => 'New client', 'type' => 'Dealer', 'region' => 'West Bank'])->assertCreated();
        $this->postJson('/api/products', ['name' => 'X', 'category' => 'Other'])->assertForbidden();
        $this->putJson("/api/products/{$p->id}", ['name' => 'Y', 'category' => 'Other'])->assertForbidden();
        $this->putJson('/api/settings', ['name' => 'X'])->assertForbidden();
    }

    public function test_owner_can_make_admin_accounts(): void
    {
        $this->actingAs($this->user('owner'));
        $this->postJson('/api/users', ['name' => 'A', 'email' => 'a2@example.com', 'password' => 'secret123', 'role' => 'admin'])->assertCreated();
        $this->assertSame('admin', User::where('email', 'a2@example.com')->value('role'));
    }
}
