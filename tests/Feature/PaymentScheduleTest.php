<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Payment;
use App\Models\Product;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PaymentScheduleTest extends TestCase
{
    use RefreshDatabase;

    private Client $client;

    private Product $product;

    protected function setUp(): void
    {
        parent::setUp();
        $this->actingAs(User::create(['name' => 'O', 'email' => 'o@example.com', 'password' => 'secret123', 'role' => 'owner']));
        $this->client = Client::create(['name' => 'C', 'type' => 'End User', 'region' => 'West Bank']);
        $this->product = Product::create(['name' => 'Lock', 'category' => 'Door Lock', 'stock_on_hand' => 10]);
    }

    private function offer(array $stages, float $paid = 0, array $extra = []): string
    {
        return $this->postJson('/api/transactions', $extra + [
            'clientId' => $this->client->id, 'region' => 'West Bank', 'dealType' => 'Direct',
            'serviceType' => 'Without Programming', 'date' => '2026-11-01', 'paid' => $paid,
            'lines' => [['kind' => 'product', 'productId' => $this->product->id, 'qty' => 1, 'unitPrice' => 1000]],
            'milestones' => $stages,
        ])->assertCreated()->json('id');
    }

    private function deal(string $id): array
    {
        return collect($this->getJson('/api/bootstrap')->json('transactions'))->firstWhere('id', $id);
    }

    private function standard(): array
    {
        return [
            ['label' => 'Deposit on order', 'amount' => 400, 'dueDate' => '2026-11-01'],
            ['label' => 'On delivery', 'amount' => 500, 'dueDate' => '2026-11-20'],
            ['label' => 'On handover', 'amount' => 100],
        ];
    }

    public function test_stages_are_saved_with_the_offer_in_order(): void
    {
        $tx = $this->deal($this->offer($this->standard()));
        $this->assertSame(['Deposit on order', 'On delivery', 'On handover'], array_column($tx['milestones'], 'label'));
        $this->assertSame([false, false, false], array_column($tx['milestones'], 'paid'));
        $this->assertNull($tx['milestones'][2]['dueDate']);
    }

    public function test_a_down_payment_equal_to_the_first_stage_pays_it(): void
    {
        $tx = $this->deal($this->offer($this->standard(), 400));
        $this->assertTrue($tx['milestones'][0]['paid']);
        $this->assertFalse($tx['milestones'][1]['paid']);
        $this->assertSame('Deposit on order', $tx['payments'][0]['type']);

        $other = $this->deal($this->offer($this->standard(), 250));
        $this->assertFalse($other['milestones'][0]['paid']);
    }

    public function test_recording_a_stage_creates_its_payment_once(): void
    {
        $id = $this->offer($this->standard());
        $stage = $this->deal($id)['milestones'][1];

        $this->postJson("/api/transactions/$id/milestones/{$stage['id']}/pay", ['method' => 'Cheque'])->assertOk();
        $this->postJson("/api/transactions/$id/milestones/{$stage['id']}/pay", ['method' => 'Cheque'])->assertStatus(409);

        $tx = $this->deal($id);
        $this->assertTrue($tx['milestones'][1]['paid']);
        $this->assertCount(1, $tx['payments']);
        $this->assertEquals(500, $tx['payments'][0]['amount']);
        $this->assertSame('On delivery', $tx['payments'][0]['type']);
    }

    public function test_a_stage_larger_than_the_balance_is_refused(): void
    {
        $id = $this->offer($this->standard());
        $this->postJson("/api/transactions/$id/payments", ['amount' => 950, 'method' => 'Cash'])->assertOk();
        $stage = $this->deal($id)['milestones'][1];
        $this->postJson("/api/transactions/$id/milestones/{$stage['id']}/pay", ['method' => 'Cash'])->assertStatus(422);
    }

    public function test_deleting_the_payment_reopens_its_stage(): void
    {
        $id = $this->offer($this->standard(), 400);
        Payment::where('transaction_id', $id)->first()->delete();
        $this->assertFalse($this->deal($id)['milestones'][0]['paid']);
    }

    public function test_editing_a_quotation_keeps_paid_stages_and_replaces_open_ones(): void
    {
        $id = $this->offer($this->standard(), 400);
        $this->putJson("/api/transactions/$id", [
            'clientId' => $this->client->id, 'region' => 'West Bank', 'dealType' => 'Direct',
            'serviceType' => 'Without Programming', 'date' => '2026-11-01',
            'lines' => [['kind' => 'product', 'productId' => $this->product->id, 'qty' => 1, 'unitPrice' => 1000]],
            'milestones' => [['label' => 'Balance on handover', 'amount' => 600]],
        ])->assertOk();

        $ms = $this->deal($id)['milestones'];
        $this->assertSame(['Deposit on order', 'Balance on handover'], array_column($ms, 'label'));
        $this->assertSame([true, false], array_column($ms, 'paid'));
    }

    public function test_stage_from_another_deal_is_rejected(): void
    {
        $a = $this->offer($this->standard());
        $b = $this->offer($this->standard());
        $stage = $this->deal($b)['milestones'][0];
        $this->postJson("/api/transactions/$a/milestones/{$stage['id']}/pay", ['method' => 'Cash'])->assertNotFound();
    }
}
