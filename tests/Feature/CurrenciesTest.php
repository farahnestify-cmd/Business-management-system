<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Product;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class CurrenciesTest extends TestCase
{
    use RefreshDatabase;

    private function offer(int $client, int $product, array $extra = []): array
    {
        return $extra + [
            'clientId' => $client, 'region' => 'West Bank', 'dealType' => 'Direct', 'serviceType' => 'Without Programming', 'date' => '2026-11-01',
            'lines' => [['kind' => 'product', 'productId' => $product, 'qty' => 1, 'unitPrice' => 370]],
        ];
    }

    public function test_an_offer_keeps_its_currency_and_rate(): void
    {
        $this->actingAs(User::create(['name' => 'O', 'email' => 'o@example.com', 'password' => 'secret123', 'role' => 'owner']));
        $this->postJson('/api/currencies', ['code' => 'ils', 'name' => 'Shekel', 'symbol' => '₪', 'rate' => 3.7, 'active' => true])->assertCreated();
        $this->postJson('/api/currencies', ['code' => 'ILS', 'name' => 'Again', 'rate' => 3.7])->assertStatus(422);
        $this->postJson('/api/currencies', ['code' => 'USD', 'name' => 'Dollar', 'rate' => 1])->assertStatus(422);

        $c = Client::create(['name' => 'C', 'type' => 'End User', 'region' => 'West Bank']);
        $p = Product::create(['name' => 'Lock', 'category' => 'Door Lock', 'cost' => 50, 'stock_on_hand' => 5]);

        $id = $this->postJson('/api/transactions', $this->offer($c->id, $p->id, ['currency' => 'ILS', 'fxRate' => 3.65]))->assertCreated()->json('id');
        $tx = collect($this->getJson('/api/bootstrap')->json('transactions'))->firstWhere('id', $id);
        $this->assertSame('ILS', $tx['currency']);
        $this->assertEquals(3.65, $tx['fxRate']);
        $this->assertSame('ILS', $this->getJson('/api/bootstrap')->json('currencies.0.code'));

        // A later change to the list's rate does not touch a saved deal.
        $cur = $this->getJson('/api/bootstrap')->json('currencies.0.id');
        $this->putJson("/api/currencies/$cur", ['code' => 'ILS', 'name' => 'Shekel', 'rate' => 3.9])->assertOk();
        $this->assertEquals(3.65, collect($this->getJson('/api/bootstrap')->json('transactions'))->firstWhere('id', $id)['fxRate']);

        // Dollars are always rate 1, and an unknown code is refused.
        $usd = $this->postJson('/api/transactions', $this->offer($c->id, $p->id, ['currency' => 'USD', 'fxRate' => 9]))->assertCreated()->json('id');
        $this->assertEquals(1, collect($this->getJson('/api/bootstrap')->json('transactions'))->firstWhere('id', $usd)['fxRate']);
        $this->postJson('/api/transactions', $this->offer($c->id, $p->id, ['currency' => 'EUR']))->assertStatus(422);
    }

    public function test_a_deal_with_money_on_it_keeps_its_currency(): void
    {
        $this->actingAs(User::create(['name' => 'O', 'email' => 'o@example.com', 'password' => 'secret123', 'role' => 'owner']));
        $this->postJson('/api/currencies', ['code' => 'JOD', 'name' => 'Dinar', 'rate' => 0.71, 'active' => true])->assertCreated();
        $c = Client::create(['name' => 'C', 'type' => 'End User', 'region' => 'West Bank']);
        $p = Product::create(['name' => 'Lock', 'category' => 'Door Lock', 'cost' => 50, 'stock_on_hand' => 5]);

        $id = $this->postJson('/api/transactions', $this->offer($c->id, $p->id, ['paid' => 100]))->assertCreated()->json('id');
        $this->putJson("/api/transactions/$id", $this->offer($c->id, $p->id, ['currency' => 'JOD']))->assertStatus(422);
        $this->postJson("/api/transactions/$id/revise", $this->offer($c->id, $p->id, ['currency' => 'JOD']))->assertStatus(422);
        $this->postJson("/api/transactions/$id/revise", $this->offer($c->id, $p->id))->assertCreated();

        // Without payments the currency can change.
        $free = $this->postJson('/api/transactions', $this->offer($c->id, $p->id))->assertCreated()->json('id');
        $this->putJson("/api/transactions/$free", $this->offer($c->id, $p->id, ['currency' => 'JOD', 'fxRate' => 0.709]))->assertOk();
    }

    public function test_sales_cannot_edit_the_currency_list(): void
    {
        $this->actingAs(User::create(['name' => 'S', 'email' => 's@example.com', 'password' => 'secret123', 'role' => 'staff']));
        $this->postJson('/api/currencies', ['code' => 'ILS', 'name' => 'Shekel', 'rate' => 3.7])->assertForbidden();
    }
}
