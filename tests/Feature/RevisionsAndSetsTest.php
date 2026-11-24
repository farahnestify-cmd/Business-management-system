<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Product;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class RevisionsAndSetsTest extends TestCase
{
    use RefreshDatabase;

    private Client $client;

    private Product $product;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actingAs(User::create(['name' => 'O', 'email' => 'o@example.com', 'password' => 'secret123', 'role' => 'owner']));
        $this->client = Client::create(['name' => 'C', 'type' => 'End User', 'region' => 'West Bank']);
        $this->product = Product::create(['name' => 'Lock', 'category' => 'Door Lock', 'cost' => 50, 'stock_on_hand' => 9]);
    }

    private function body(array $lines, array $extra = []): array
    {
        return $extra + ['clientId' => $this->client->id, 'region' => 'West Bank', 'dealType' => 'Direct',
            'serviceType' => 'Without Programming', 'date' => '2026-11-10', 'lines' => $lines];
    }

    private function line(int $qty, float $price = 100): array
    {
        return ['kind' => 'product', 'productId' => $this->product->id, 'qty' => $qty, 'unitPrice' => $price];
    }

    public function test_revising_keeps_the_reference_adds_a_version_and_moves_the_money(): void
    {
        $v1 = $this->postJson('/api/transactions', $this->body([$this->line(2)], ['paid' => 50,
            'milestones' => [['label' => 'Deposit', 'amount' => 50], ['label' => 'Rest', 'amount' => 150]]]))->json();
        $this->assertSame('2611WD01', $v1['refNo']);

        $v2 = $this->postJson("/api/transactions/{$v1['id']}/revise", $this->body([$this->line(3)],
            ['milestones' => [['label' => 'Rest', 'amount' => 250]]]))->assertCreated()->json();
        $this->assertSame('2611WD01-V2', $v2['refNo']);
        $v3 = $this->postJson("/api/transactions/{$v2['id']}/revise", $this->body([$this->line(1)]))->assertCreated()->json();
        $this->assertSame('2611WD01-V3', $v3['refNo']);

        $deals = collect($this->getJson('/api/bootstrap')->json('transactions'))->keyBy('id');
        $this->assertSame('2611WD01', $deals[$v3['id']]['rootRef']);
        $this->assertSame(3, $deals[$v3['id']]['version']);
        $this->assertEquals(2, $deals[$v1['id']]['lineItems'][0]['qty']);
        // The deposit and the stage it paid travelled to the newest version.
        $this->assertSame([], $deals[$v1['id']]['payments']);
        $this->assertEquals(50, $deals[$v3['id']]['payments'][0]['amount']);
        $this->assertSame(['Deposit'], array_column(array_filter($deals[$v3['id']]['milestones'], fn ($m) => $m['paid']), 'label'));

        // A new offer in the same month still takes the next counter.
        $this->assertSame('2611WD02', $this->postJson('/api/transactions', $this->body([$this->line(1)]))->json('refNo'));
    }

    public function test_confirming_one_version_cancels_the_other_quotations(): void
    {
        $v1 = $this->postJson('/api/transactions', $this->body([$this->line(2)]))->json('id');
        $v2 = $this->postJson("/api/transactions/$v1/revise", $this->body([$this->line(3)]))->json('id');

        $this->postJson("/api/transactions/$v1/advance", ['status' => 'Agreement'])->assertOk()->assertJsonPath('closedVersions', 1);
        $this->assertSame('Cancelled', Transaction::find($v2)->status);
        $this->assertSame('Agreement', Transaction::find($v1)->status);
        $this->postJson("/api/transactions/$v1/revise", $this->body([$this->line(1)]))->assertStatus(409);
    }

    public function test_rows_at_zero_are_kept_as_options_but_one_row_needs_a_quantity(): void
    {
        $this->postJson('/api/transactions', $this->body([$this->line(0)]))->assertStatus(422);
        $id = $this->postJson('/api/transactions', $this->body([$this->line(2), $this->line(0, 80)]))->assertCreated()->json('id');
        $tx = Transaction::with('items')->find($id);
        $this->assertSame([2, 0], $tx->items->pluck('qty')->all());
        $this->assertEquals(200, $tx->subtotal());
    }

    public function test_offer_sets_are_saved_used_and_go_to_the_bin(): void
    {
        $set = $this->postJson('/api/offer_sets', ['name' => 'Flat', 'lines' => [
            ['kind' => 'product', 'productId' => $this->product->id, 'qty' => 5, 'unitPrice' => 999],
            ['kind' => 'service', 'name' => 'Installation', 'unit' => 'hour'],
        ]])->assertCreated()->json('id');
        $saved = $this->getJson('/api/bootstrap')->json('sets.0');
        $this->assertSame('Flat', $saved['name']);
        $this->assertSame(['kind' => 'product', 'productId' => $this->product->id], $saved['lines'][0]);

        $id = $this->postJson('/api/transactions', $this->body([$this->line(1)], ['setId' => $set]))->json('id');
        $this->assertSame((string) $set, collect($this->getJson('/api/bootstrap')->json('transactions'))->firstWhere('id', $id)['setId']);

        $this->putJson("/api/offer_sets/$set", ['name' => 'Flat 3BR'])->assertOk();
        $this->deleteJson("/api/offer_sets/$set")->assertOk();
        $this->assertSame('offer_set', $this->getJson('/api/bootstrap')->json('trash.0.kind'));
    }
}
