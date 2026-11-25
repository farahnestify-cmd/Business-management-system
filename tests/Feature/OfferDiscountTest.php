<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Product;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class OfferDiscountTest extends TestCase
{
    use RefreshDatabase;

    public function test_the_discount_comes_off_the_goods_on_the_total(): void
    {
        $this->actingAs(User::create(['name' => 'O', 'email' => 'o@example.com', 'password' => 'secret123', 'role' => 'owner']));
        $c = Client::create(['name' => 'C', 'type' => 'End User', 'region' => 'West Bank']);
        $p = Product::create(['name' => 'Lock', 'category' => 'Door Lock', 'stock_on_hand' => 5]);
        $offer = [
            'clientId' => $c->id, 'region' => 'West Bank', 'dealType' => 'Direct', 'serviceType' => 'Without Programming', 'date' => '2026-11-01',
            'discountPct' => 0.1,
            'lines' => [
                ['kind' => 'product', 'productId' => $p->id, 'qty' => 2, 'unitPrice' => 100],
                ['kind' => 'service', 'name' => 'Installation', 'qty' => 1, 'unitPrice' => 50],
            ],
        ];

        // 200 of goods less 10% plus 50 of labour = 230: paying 250 now is too much.
        $this->postJson('/api/transactions', $offer + ['paid' => 250])->assertStatus(422);
        $id = $this->postJson('/api/transactions', $offer + ['paid' => 230])->assertCreated()->json('id');

        $tx = Transaction::with('items')->find($id);
        $this->assertEqualsWithDelta(230, $tx->total(), 0.001);
        $this->assertEquals(0.1, collect($this->getJson('/api/bootstrap')->json('transactions'))->firstWhere('id', $id)['discountPct']);
        $this->postJson('/api/transactions', ['discountPct' => 0.99] + $offer)->assertStatus(422);
    }
}
