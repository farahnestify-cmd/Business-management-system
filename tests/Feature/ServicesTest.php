<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Product;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ServicesTest extends TestCase
{
    use RefreshDatabase;

    public function test_service_lines_are_sold_without_touching_stock_and_do_not_hold_up_delivery(): void
    {
        $this->actingAs(User::create(['name' => 'O', 'email' => 'o@example.com', 'password' => 'secret123', 'role' => 'owner']));
        $sv = $this->postJson('/api/services', ['name' => 'Installation', 'unit' => 'hour', 'rate' => 25, 'active' => true])->assertCreated()->json('id');
        $c = Client::create(['name' => 'C', 'type' => 'End User', 'region' => 'West Bank']);
        $p = Product::create(['name' => 'Lock', 'category' => 'Door Lock', 'cost' => 50, 'stock_on_hand' => 2]);

        $id = $this->postJson('/api/transactions', [
            'clientId' => $c->id, 'region' => 'West Bank', 'dealType' => 'Direct', 'serviceType' => 'Without Programming', 'date' => '2026-11-01',
            'lines' => [
                ['kind' => 'product', 'productId' => $p->id, 'qty' => 2, 'unitPrice' => 100],
                ['kind' => 'service', 'serviceId' => $sv, 'qty' => 6, 'unitPrice' => 25],
                ['kind' => 'service', 'name' => 'Rack wiring', 'unit' => 'point', 'qty' => 4, 'unitPrice' => 10],
            ],
        ])->assertCreated()->json('id');

        $tx = collect($this->getJson('/api/bootstrap')->json('transactions'))->firstWhere('id', $id);
        $this->assertSame(['Lock', 'Installation', 'Rack wiring'], array_column($tx['lineItems'], 'name'));
        $this->assertSame('hour', $tx['lineItems'][1]['unit']);
        $this->assertSame('point', $tx['lineItems'][2]['unit']);
        $this->assertEquals(0, $tx['lineItems'][1]['costSnapshot']);

        foreach (['Agreement', 'Invoiced'] as $s) {
            $this->postJson("/api/transactions/$id/advance", ['status' => $s])->assertOk();
        }
        $this->postJson("/api/transactions/$id/deliver")->assertOk()->assertJsonPath('complete', true);
        $this->assertSame(0, $p->fresh()->stock_on_hand);
    }

    public function test_a_service_line_needs_a_name_and_sales_cannot_edit_the_list(): void
    {
        $this->actingAs(User::create(['name' => 'S', 'email' => 's@example.com', 'password' => 'secret123', 'role' => 'staff']));
        $c = Client::create(['name' => 'C', 'type' => 'End User', 'region' => 'West Bank']);
        $this->postJson('/api/transactions', [
            'clientId' => $c->id, 'region' => 'West Bank', 'dealType' => 'Direct', 'serviceType' => 'Without Programming', 'date' => '2026-11-01',
            'lines' => [['kind' => 'service', 'qty' => 1, 'unitPrice' => 10]],
        ])->assertStatus(422);
        $this->postJson('/api/services', ['name' => 'X', 'rate' => 1])->assertForbidden();
    }
}
