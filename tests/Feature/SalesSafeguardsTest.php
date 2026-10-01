<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Payment;
use App\Models\Product;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class SalesSafeguardsTest extends TestCase
{
    use RefreshDatabase;

    private Client $client;

    private Product $product;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actingAs(User::create(['name' => 'O', 'email' => 'o@example.com', 'password' => 'secret123', 'role' => 'owner']));
        $this->client = Client::create(['name' => 'C', 'type' => 'End User', 'region' => 'West Bank']);
        $this->product = Product::create(['name' => 'Lock', 'category' => 'Door Lock', 'cost' => 50, 'stock_on_hand' => 3]);
    }

    private function quote(int $qty = 2, float $price = 100, float $paid = 0): string
    {
        return $this->postJson('/api/transactions', [
            'clientId' => $this->client->id, 'region' => 'West Bank', 'dealType' => 'Direct',
            'serviceType' => 'Without Programming', 'date' => now()->toDateString(), 'paid' => $paid,
            'lines' => [['kind' => 'product', 'productId' => $this->product->id, 'qty' => $qty, 'unitPrice' => $price]],
        ])->assertCreated()->json('id');
    }

    private function moveTo(string $id, string ...$stages): void
    {
        foreach ($stages as $s) {
            $this->postJson("/api/transactions/$id/advance", ['status' => $s])->assertOk();
        }
    }

    public function test_payments_cannot_exceed_what_is_owed(): void
    {
        $id = $this->quote(2, 100, 50);
        $this->postJson("/api/transactions/$id/payments", ['amount' => 151, 'method' => 'Cash'])->assertStatus(422);
        $this->postJson("/api/transactions/$id/payments", ['amount' => 150, 'method' => 'Cash'])->assertOk();
        $this->postJson("/api/transactions/$id/payments", ['amount' => 1, 'method' => 'Cash'])
            ->assertStatus(422)->assertJsonPath('message', 'This deal is already paid in full.');
    }

    public function test_down_payment_cannot_exceed_the_offer_total(): void
    {
        $this->postJson('/api/transactions', [
            'clientId' => $this->client->id, 'region' => 'West Bank', 'dealType' => 'Direct',
            'serviceType' => 'Without Programming', 'date' => now()->toDateString(), 'paid' => 500,
            'lines' => [['kind' => 'product', 'productId' => $this->product->id, 'qty' => 1, 'unitPrice' => 100]],
        ])->assertStatus(422);
    }

    public function test_delivery_is_refused_when_stock_is_short(): void
    {
        $id = $this->quote(5);
        $this->moveTo($id, 'Agreement', 'Invoiced');
        $this->postJson("/api/transactions/$id/advance", ['status' => 'Delivered'])
            ->assertStatus(422)->assertJsonPath('message', fn ($m) => str_contains($m, 'Lock (need 5, have 3)'));
        $this->assertSame(3, $this->product->fresh()->stock_on_hand);

        $this->product->update(['stock_on_hand' => 5]);
        $this->moveTo($id, 'Delivered');
        $this->assertSame(0, $this->product->fresh()->stock_on_hand);
    }

    public function test_cancelled_deal_with_payment_can_be_refunded_in_full_only(): void
    {
        $id = $this->quote(2, 100, 80);
        $this->moveTo($id, 'Cancelled');

        $this->postJson("/api/transactions/$id/payments", ['amount' => 10, 'method' => 'Cash'])->assertStatus(409);
        $this->postJson("/api/transactions/$id/refunds", ['amount' => 81, 'method' => 'Cash'])->assertStatus(422);
        $this->postJson("/api/transactions/$id/refunds", ['amount' => 80, 'method' => 'Cash'])->assertOk();
        $this->postJson("/api/transactions/$id/refunds", ['amount' => 1, 'method' => 'Cash'])->assertStatus(422);

        $this->assertDatabaseHas('payments', ['transaction_id' => $id, 'type' => 'Refund', 'amount' => -80]);
    }

    public function test_live_deal_refund_is_limited_to_overpayment(): void
    {
        $id = $this->quote(1, 100, 100);
        $this->postJson("/api/transactions/$id/refunds", ['amount' => 10, 'method' => 'Cash'])->assertStatus(422);
    }

    public function test_quotation_can_be_edited_until_it_becomes_an_agreement(): void
    {
        $id = $this->quote(2, 100);
        $partner = Client::create(['name' => 'P', 'type' => 'Partner', 'region' => '48 Region']);

        $res = $this->putJson("/api/transactions/$id", [
            'clientId' => $partner->id, 'region' => '48 Region', 'dealType' => 'Partner',
            'serviceType' => 'With Programming', 'date' => now()->toDateString(), 'notes' => 'changed',
            'lines' => [['kind' => 'product', 'productId' => $this->product->id, 'qty' => 1, 'unitPrice' => 75]],
        ])->assertOk();
        $this->assertSame(now()->format('ym').'FP01', $res->json('refNo'));

        $tx = collect($this->getJson('/api/bootstrap')->json('transactions'))->firstWhere('id', $id);
        $this->assertSame('P', $tx['clientName']);
        $this->assertCount(1, $tx['lineItems']);
        $this->assertEquals(75, $tx['lineItems'][0]['unitPrice']);

        $this->moveTo($id, 'Agreement');
        $this->putJson("/api/transactions/$id", [
            'clientId' => $partner->id, 'region' => '48 Region', 'dealType' => 'Partner', 'serviceType' => 'With Programming',
            'date' => now()->toDateString(), 'lines' => [['kind' => 'product', 'productId' => $this->product->id, 'qty' => 1, 'unitPrice' => 1]],
        ])->assertStatus(409);
    }

    public function test_edit_cannot_drop_total_below_what_was_paid(): void
    {
        $id = $this->quote(2, 100, 150);
        $this->putJson("/api/transactions/$id", [
            'clientId' => $this->client->id, 'region' => 'West Bank', 'dealType' => 'Direct', 'serviceType' => 'Without Programming',
            'date' => now()->toDateString(), 'lines' => [['kind' => 'product', 'productId' => $this->product->id, 'qty' => 1, 'unitPrice' => 100]],
        ])->assertStatus(422);
    }

    public function test_only_the_owner_can_delete_a_payment(): void
    {
        $id = $this->quote(2, 100, 50);
        $payment = Payment::where('transaction_id', $id)->first();

        $this->actingAs(User::create(['name' => 'S', 'email' => 's@example.com', 'password' => 'secret123', 'role' => 'staff']));
        $this->deleteJson("/api/payments/{$payment->id}")->assertForbidden();

        $this->actingAs(User::where('role', 'owner')->first());
        $this->deleteJson("/api/payments/{$payment->id}")->assertOk();
        $this->assertDatabaseMissing('payments', ['id' => $payment->id]);
    }
}
