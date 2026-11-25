<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Product;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class DeliveryReturnsTest extends TestCase
{
    use RefreshDatabase;

    private function deliveredDeal(Product $p, int $qty = 3): string
    {
        $c = Client::create(['name' => 'C', 'type' => 'End User', 'region' => 'West Bank']);
        $id = $this->postJson('/api/transactions', [
            'clientId' => $c->id, 'region' => 'West Bank', 'dealType' => 'Direct', 'serviceType' => 'Without Programming', 'date' => '2026-11-01',
            'lines' => [['kind' => 'product', 'productId' => $p->id, 'qty' => $qty, 'unitPrice' => 100]],
        ])->assertCreated()->json('id');
        foreach (['Agreement', 'Invoiced'] as $s) {
            $this->postJson("/api/transactions/$id/advance", ['status' => $s])->assertOk();
        }
        $this->postJson("/api/transactions/$id/deliver")->assertOk();

        return $id;
    }

    public function test_a_faulty_unit_comes_back_and_goes_out_again(): void
    {
        $this->actingAs(User::create(['name' => 'O', 'email' => 'o@example.com', 'password' => 'secret123', 'role' => 'owner']));
        $p = Product::create(['name' => 'Lock', 'category' => 'Door Lock', 'stock_on_hand' => 5]);
        $id = $this->deliveredDeal($p);
        $line = Transaction::find($id)->items()->first();
        $this->assertSame('Delivered', Transaction::find($id)->status);

        $this->postJson("/api/transactions/$id/returns", ['lineId' => $line->id, 'qty' => 4, 'outcome' => 'replace'])->assertStatus(422);
        $this->postJson("/api/transactions/$id/returns", ['lineId' => $line->id, 'qty' => 1, 'outcome' => 'replace', 'note' => 'Screen cracked'])->assertOk();
        $this->assertSame(3, $p->fresh()->stock_on_hand);
        $this->assertSame('Invoiced', Transaction::find($id)->status);
        $this->assertEqualsWithDelta(300, Transaction::with('items')->find($id)->total(), 0.01);

        // The replacement goes out with the normal Deliver button.
        $this->postJson("/api/transactions/$id/deliver")->assertOk()->assertJsonPath('complete', true);
        $this->assertSame(2, $p->fresh()->stock_on_hand);

        $log = collect($this->getJson('/api/bootstrap')->json('deliveries'))->where('transactionId', $id);
        $this->assertSame(['out', 'return', 'out'], $log->sortBy('id')->pluck('type')->values()->all());
        $this->assertStringContainsString('Screen cracked', $log->firstWhere('type', 'return')['note']);
    }

    public function test_a_unit_the_client_does_not_keep_comes_off_the_invoice(): void
    {
        $this->actingAs(User::create(['name' => 'O', 'email' => 'o@example.com', 'password' => 'secret123', 'role' => 'owner']));
        $p = Product::create(['name' => 'Lock', 'category' => 'Door Lock', 'stock_on_hand' => 5]);
        $id = $this->deliveredDeal($p);
        $line = Transaction::find($id)->items()->first();

        $this->postJson("/api/transactions/$id/returns", ['lineId' => $line->id, 'qty' => 1, 'outcome' => 'remove'])->assertOk();
        $tx = Transaction::with('items')->find($id);
        $this->assertSame('Delivered', $tx->status);
        $this->assertEqualsWithDelta(200, $tx->total(), 0.01);
        $this->assertSame(3, $p->fresh()->stock_on_hand);
    }

    public function test_an_extra_item_is_added_and_handed_over(): void
    {
        $this->actingAs(User::create(['name' => 'O', 'email' => 'o@example.com', 'password' => 'secret123', 'role' => 'owner']));
        $p = Product::create(['name' => 'Lock', 'category' => 'Door Lock', 'stock_on_hand' => 5]);
        $extra = Product::create(['name' => 'Sensor', 'category' => 'Accessory', 'stock_on_hand' => 1, 'cost' => 10]);
        $id = $this->deliveredDeal($p);

        // Two asked for, one on the shelf: one goes out now and the deal waits for the other.
        $this->postJson("/api/transactions/$id/extra", ['kind' => 'product', 'productId' => $extra->id, 'qty' => 2, 'unitPrice' => 0])
            ->assertOk()->assertJsonPath('delivered', 1)->assertJsonPath('waiting', 1);
        $tx = Transaction::with('items')->find($id);
        $this->assertSame('Invoiced', $tx->status);
        $this->assertCount(2, $tx->items);
        $this->assertEqualsWithDelta(300, $tx->total(), 0.01);
        $this->assertSame(0, $extra->fresh()->stock_on_hand);
    }

    public function test_nothing_is_returned_before_the_invoice(): void
    {
        $this->actingAs(User::create(['name' => 'O', 'email' => 'o@example.com', 'password' => 'secret123', 'role' => 'owner']));
        $p = Product::create(['name' => 'Lock', 'category' => 'Door Lock', 'stock_on_hand' => 5]);
        $c = Client::create(['name' => 'C', 'type' => 'End User', 'region' => 'West Bank']);
        $id = $this->postJson('/api/transactions', [
            'clientId' => $c->id, 'region' => 'West Bank', 'dealType' => 'Direct', 'serviceType' => 'Without Programming', 'date' => '2026-11-01',
            'lines' => [['kind' => 'product', 'productId' => $p->id, 'qty' => 1, 'unitPrice' => 100]],
        ])->json('id');
        $this->postJson("/api/transactions/$id/extra", ['kind' => 'product', 'productId' => $p->id, 'qty' => 1, 'unitPrice' => 0])->assertStatus(409);
    }

    public function test_several_items_come_back_or_go_out_in_one_go(): void
    {
        $this->actingAs(User::create(['name' => 'O', 'email' => 'o@example.com', 'password' => 'secret123', 'role' => 'owner']));
        $p = Product::create(['name' => 'Lock', 'category' => 'Door Lock', 'stock_on_hand' => 5]);
        $a = Product::create(['name' => 'Sensor', 'category' => 'Accessory', 'stock_on_hand' => 4]);
        $b = Product::create(['name' => 'Hub', 'category' => 'Accessory', 'stock_on_hand' => 4]);
        $id = $this->deliveredDeal($p);
        $line = Transaction::find($id)->items()->first();

        // The same line twice may not add up to more than went out; nothing is saved when one row fails.
        $this->postJson("/api/transactions/$id/returns", ['items' => [
            ['lineId' => $line->id, 'qty' => 2, 'outcome' => 'replace'],
            ['lineId' => $line->id, 'qty' => 2, 'outcome' => 'remove'],
        ]])->assertStatus(422);
        $this->assertSame(2, $p->fresh()->stock_on_hand);

        $this->postJson("/api/transactions/$id/returns", ['note' => 'Client changed the plan', 'items' => [
            ['lineId' => $line->id, 'qty' => 1, 'outcome' => 'replace'],
            ['lineId' => $line->id, 'qty' => 1, 'outcome' => 'remove'],
        ]])->assertOk();
        $this->assertSame(4, $p->fresh()->stock_on_hand);
        $this->assertSame(2, $line->fresh()->qty);

        $this->postJson("/api/transactions/$id/extra", ['items' => [
            ['kind' => 'product', 'productId' => $a->id, 'qty' => 2, 'unitPrice' => 20],
            ['kind' => 'product', 'productId' => $b->id, 'qty' => 1, 'unitPrice' => 0],
        ]])->assertOk()->assertJsonPath('delivered', 3)->assertJsonPath('waiting', 0);
        $this->assertSame(2, $a->fresh()->stock_on_hand);
        $this->assertSame(3, $b->fresh()->stock_on_hand);
        $this->assertCount(3, Transaction::find($id)->items);
    }

    public function test_the_same_item_joins_its_row_and_the_original_quote_is_kept(): void
    {
        $this->actingAs(User::create(['name' => 'O', 'email' => 'o@example.com', 'password' => 'secret123', 'role' => 'owner']));
        $p = Product::create(['name' => 'Screen', 'category' => 'DNAKE', 'stock_on_hand' => 5]);
        $id = $this->deliveredDeal($p, 2);

        // Same item, same price: one row of 3. A different price stays a row of its own.
        $this->postJson("/api/transactions/$id/extra", ['items' => [['kind' => 'product', 'productId' => $p->id, 'qty' => 1, 'unitPrice' => 100]]])->assertOk();
        $tx = Transaction::with('items')->find($id);
        $this->assertCount(1, $tx->items);
        $this->assertSame(3, $tx->items[0]->qty);
        $this->assertSame(3, $tx->items[0]->delivered_qty);
        $this->assertSame('Delivered', $tx->status);
        $this->postJson("/api/transactions/$id/extra", ['items' => [['kind' => 'product', 'productId' => $p->id, 'qty' => 1, 'unitPrice' => 0]]])->assertOk();
        $this->assertCount(2, Transaction::find($id)->items);

        // The quotation as agreed is still there: one line of 2.
        $original = collect($this->getJson('/api/bootstrap')->json('transactions'))->firstWhere('id', $id)['originalLines'];
        $this->assertCount(1, $original);
        $this->assertSame(2, $original[0]['qty']);
    }

    public function test_an_older_deal_gets_its_original_quote_back_from_the_log(): void
    {
        $this->actingAs(User::create(['name' => 'O', 'email' => 'o@example.com', 'password' => 'secret123', 'role' => 'owner']));
        $p = Product::create(['name' => 'Screen', 'category' => 'DNAKE', 'stock_on_hand' => 9]);
        $q = Product::create(['name' => 'Lock', 'category' => 'Door Lock', 'stock_on_hand' => 9]);
        $id = $this->deliveredDeal($p, 2);
        $line = Transaction::find($id)->items()->first();
        $this->postJson("/api/transactions/$id/extra", ['items' => [
            ['kind' => 'product', 'productId' => $p->id, 'qty' => 1, 'unitPrice' => 100],
            ['kind' => 'product', 'productId' => $q->id, 'qty' => 1, 'unitPrice' => 50],
        ]])->assertOk();
        $this->postJson("/api/transactions/$id/returns", ['items' => [['lineId' => $line->id, 'qty' => 1, 'outcome' => 'remove']]])->assertOk();

        // As if all that happened before originals were kept.
        $tx = Transaction::find($id);
        $tx->quote_snapshot = null;
        $tx->save();
        $this->assertTrue($tx->fresh()->rebuildOriginalQuote());

        $original = collect($this->getJson('/api/bootstrap')->json('transactions'))->firstWhere('id', $id)['originalLines'];
        $this->assertCount(1, $original);
        $this->assertSame('Screen', $original[0]['name']);
        $this->assertSame(2, $original[0]['qty']);
    }
}
