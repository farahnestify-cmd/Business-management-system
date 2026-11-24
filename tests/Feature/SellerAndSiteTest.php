<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Product;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class SellerAndSiteTest extends TestCase
{
    use RefreshDatabase;

    private function body(Client $c, Product $p, array $extra = []): array
    {
        return $extra + [
            'clientId' => $c->id, 'region' => 'West Bank', 'dealType' => 'Direct',
            'serviceType' => 'Without Programming', 'date' => '2026-11-01',
            'lines' => [['kind' => 'product', 'productId' => $p->id, 'qty' => 1, 'unitPrice' => 100]],
        ];
    }

    public function test_site_seller_and_author_are_kept_and_sales_team_deals_are_marked(): void
    {
        $owner = User::create(['name' => 'Farah', 'email' => 'o@example.com', 'password' => 'secret123', 'role' => 'owner']);
        $staff = User::create(['name' => 'Omar', 'email' => 's@example.com', 'password' => 'secret123', 'role' => 'staff']);
        $c = Client::create(['name' => 'C', 'type' => 'End User', 'region' => 'West Bank']);
        $p = Product::create(['name' => 'Lock', 'category' => 'Door Lock']);

        $office = $this->actingAs($owner)->postJson('/api/transactions', $this->body($c, $p, ['site' => 'Villa 12, Rawabi', 'soldBy' => 'Farah']))->json('id');
        $team = $this->actingAs($staff)->postJson('/api/transactions', $this->body($c, $p, ['soldBy' => 'Omar']))->json('id');

        $deals = collect($this->actingAs($owner)->getJson('/api/bootstrap')->json('transactions'))->keyBy('id');
        $this->assertSame('Villa 12, Rawabi', $deals[$office]['site']);
        $this->assertSame('Farah', $deals[$office]['soldBy']);
        $this->assertSame((string) $owner->id, $deals[$office]['createdBy']);
        $this->assertFalse($deals[$office]['fromSales']);
        $this->assertTrue($deals[$team]['fromSales']);
        $this->assertSame('Omar', $deals[$team]['createdByName']);

        $this->putJson("/api/transactions/$office", $this->body($c, $p, ['site' => 'Shop, Nablus', 'soldBy' => 'Omar']))->assertOk();
        $deal = collect($this->getJson('/api/bootstrap')->json('transactions'))->firstWhere('id', $office);
        $this->assertSame('Shop, Nablus', $deal['site']);
        $this->assertSame('Omar', $deal['soldBy']);
        $this->assertSame((string) $owner->id, $deal['createdBy']);
    }
}
