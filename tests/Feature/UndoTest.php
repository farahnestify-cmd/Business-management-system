<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Employee;
use App\Models\PayrollPayment;
use App\Models\Product;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class UndoTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    private Client $client;

    private Product $product;

    protected function setUp(): void
    {
        parent::setUp();
        $this->owner = User::create(['name' => 'O', 'email' => 'o@example.com', 'password' => 'secret123', 'role' => 'owner']);
        $this->actingAs($this->owner);
        $this->client = Client::create(['name' => 'C', 'type' => 'End User', 'region' => 'West Bank']);
        $this->product = Product::create(['name' => 'Lock', 'category' => 'Door Lock', 'stock_on_hand' => 5]);
    }

    private function deal(int $qty = 2): string
    {
        return $this->postJson('/api/transactions', ['clientId' => $this->client->id, 'region' => 'West Bank', 'dealType' => 'Direct',
            'serviceType' => 'Without Programming', 'date' => '2026-11-10',
            'lines' => [['kind' => 'product', 'productId' => $this->product->id, 'qty' => $qty, 'unitPrice' => 100]]])->json('id');
    }

    private function undo(string $token)
    {
        return $this->postJson("/api/undo/$token");
    }

    public function test_a_payment_can_be_taken_back_once(): void
    {
        $id = $this->deal();
        $token = $this->postJson("/api/transactions/$id/payments", ['amount' => 50, 'method' => 'Cash'])->json('undo');
        $this->undo($token)->assertOk();
        $this->assertSame(0, Transaction::find($id)->payments()->count());
        $this->undo($token)->assertStatus(409);
    }

    public function test_a_stage_change_goes_back_and_reopens_cancelled_versions(): void
    {
        $v1 = $this->deal();
        $v2 = $this->postJson("/api/transactions/$v1/revise", ['clientId' => $this->client->id, 'region' => 'West Bank', 'dealType' => 'Direct',
            'serviceType' => 'Without Programming', 'date' => '2026-11-10',
            'lines' => [['kind' => 'product', 'productId' => $this->product->id, 'qty' => 3, 'unitPrice' => 100]]])->json('id');
        $token = $this->postJson("/api/transactions/$v2/advance", ['status' => 'Agreement'])->json('undo');
        $this->assertSame('Cancelled', Transaction::find($v1)->status);

        $this->undo($token)->assertOk();
        $this->assertSame('Quotation', Transaction::find($v2)->status);
        $this->assertNull(Transaction::find($v2)->agreement_date);
        $this->assertSame('Quotation', Transaction::find($v1)->status);
    }

    public function test_a_stage_change_cannot_be_undone_once_the_deal_moved_on(): void
    {
        $id = $this->deal();
        $token = $this->postJson("/api/transactions/$id/advance", ['status' => 'Agreement'])->json('undo');
        $this->postJson("/api/transactions/$id/advance", ['status' => 'Invoiced'])->assertOk();
        $this->undo($token)->assertStatus(409);
    }

    public function test_a_delivery_puts_the_stock_back(): void
    {
        $id = $this->deal(3);
        foreach (['Agreement', 'Invoiced'] as $s) {
            $this->postJson("/api/transactions/$id/advance", ['status' => $s]);
        }
        $token = $this->postJson("/api/transactions/$id/deliver")->json('undo');
        $this->assertSame(2, $this->product->fresh()->stock_on_hand);

        $this->undo($token)->assertOk();
        $this->assertSame(5, $this->product->fresh()->stock_on_hand);
        $tx = Transaction::find($id);
        $this->assertSame('Invoiced', $tx->status);
        $this->assertSame(0, (int) $tx->items()->first()->delivered_qty);
        $this->assertSame([], $this->getJson('/api/bootstrap')->json('deliveries'));
    }

    public function test_a_delete_comes_back_and_a_salary_payment_goes(): void
    {
        $token = $this->deleteJson("/api/products/{$this->product->id}")->json('undo');
        $this->assertNull(Product::find($this->product->id));
        $this->undo($token)->assertOk();
        $this->assertNotNull(Product::find($this->product->id));

        $e = Employee::create(['name' => 'Omar', 'monthly_salary' => 900]);
        $token = $this->postJson('/api/payroll_payments', ['employeeId' => $e->id])->json('undo');
        $this->undo($token)->assertOk();
        $this->assertSame(0, PayrollPayment::count());
    }

    public function test_only_the_person_who_did_it_can_undo(): void
    {
        $id = $this->deal();
        $token = $this->postJson("/api/transactions/$id/payments", ['amount' => 50, 'method' => 'Cash'])->json('undo');
        $this->actingAs(User::create(['name' => 'S', 'email' => 's@example.com', 'password' => 'secret123', 'role' => 'staff']));
        $this->undo($token)->assertStatus(409);
        $this->assertSame(1, Transaction::find($id)->payments()->count());
    }
}
