<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Expense;
use App\Models\Product;
use App\Models\PurchaseOrder;
use App\Models\Supplier;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Tests\TestCase;

class DataSafetyTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->owner = User::create(['name' => 'Farah', 'email' => 'o@example.com', 'password' => 'secret123', 'role' => 'owner']);
        $this->actingAs($this->owner);
    }

    private function bin(): array
    {
        return $this->getJson('/api/bootstrap')->json('trash');
    }

    public function test_deleted_contact_goes_to_the_bin_and_comes_back_linked_to_its_deals(): void
    {
        $c = Client::create(['name' => 'Galil', 'type' => 'Partner', 'region' => '48 Region']);
        $p = Product::create(['name' => 'Lock', 'category' => 'Door Lock']);
        $id = $this->postJson('/api/transactions', [
            'clientId' => $c->id, 'region' => '48 Region', 'dealType' => 'Partner', 'serviceType' => 'Without Programming',
            'date' => '2026-11-01', 'lines' => [['kind' => 'product', 'productId' => $p->id, 'qty' => 1, 'unitPrice' => 10]],
        ])->json('id');
        $this->postJson("/api/transactions/$id/advance", ['status' => 'Cancelled'])->assertOk();

        $this->deleteJson("/api/clients/{$c->id}")->assertOk();
        $this->assertNull(Client::find($c->id));
        $this->assertNull(Transaction::find($id)->client_id);
        $this->assertSame([['kind' => 'client', 'label' => 'Galil', 'by' => 'Farah']],
            array_map(fn ($r) => array_intersect_key($r, ['kind' => 1, 'label' => 1, 'by' => 1]), $this->bin()));

        $this->postJson('/api/deleted/'.$this->bin()[0]['id'].'/restore')->assertOk();
        $this->assertSame('Galil', Client::find($c->id)->name);
        $this->assertSame($c->id, Transaction::find($id)->client_id);
        $this->assertSame([], $this->bin());
    }

    public function test_purchase_order_comes_back_with_its_lines(): void
    {
        $s = Supplier::create(['name' => 'Factory']);
        $p = Product::create(['name' => 'Lock', 'category' => 'Door Lock']);
        $po = $this->postJson('/api/purchase_orders', ['supplierId' => $s->id,
            'lines' => [['kind' => 'product', 'itemId' => $p->id, 'qty' => 4, 'unitCost' => 9]]])->json('id');
        $this->deleteJson("/api/purchase_orders/$po")->assertOk();
        $this->postJson('/api/deleted/'.$this->bin()[0]['id'].'/restore')->assertOk();

        $this->assertSame(4, PurchaseOrder::find($po)->lines()->first()->qty);
    }

    public function test_restoring_an_expense_puts_its_restock_back(): void
    {
        $p = Product::create(['name' => 'Cable', 'category' => 'Accessory', 'stock_on_hand' => 0]);
        $e = $this->postJson('/api/expenses', ['date' => '2026-11-01', 'category' => 'Other', 'description' => 'Cables', 'amount' => 5,
            'paymentMethod' => 'Cash', 'linkedProductId' => $p->id, 'qtyPurchased' => 7])->json('id');
        $this->deleteJson("/api/expenses/$e")->assertOk();
        $this->assertSame(0, $p->fresh()->stock_on_hand);

        $this->postJson('/api/deleted/'.$this->bin()[0]['id'].'/restore')->assertOk();
        $this->assertSame(7, $p->fresh()->stock_on_hand);
        $this->assertNotNull(Expense::find($e));
    }

    public function test_restoring_a_payment_reconnects_its_stage(): void
    {
        $c = Client::create(['name' => 'C', 'type' => 'End User', 'region' => 'West Bank']);
        $p = Product::create(['name' => 'Lock', 'category' => 'Door Lock']);
        $id = $this->postJson('/api/transactions', [
            'clientId' => $c->id, 'region' => 'West Bank', 'dealType' => 'Direct', 'serviceType' => 'Without Programming',
            'date' => '2026-11-01', 'paid' => 40, 'milestones' => [['label' => 'Deposit', 'amount' => 40], ['label' => 'Rest', 'amount' => 60]],
            'lines' => [['kind' => 'product', 'productId' => $p->id, 'qty' => 1, 'unitPrice' => 100]],
        ])->json('id');
        $pay = Transaction::find($id)->payments()->first();

        $this->deleteJson("/api/payments/{$pay->id}")->assertOk();
        $this->assertNull(Transaction::find($id)->milestones()->first()->payment_id);
        $this->postJson('/api/deleted/'.$this->bin()[0]['id'].'/restore')->assertOk();
        $this->assertSame($pay->id, Transaction::find($id)->milestones()->first()->payment_id);
    }

    public function test_staff_cannot_reach_backup_restore_or_the_bin(): void
    {
        $this->actingAs(User::create(['name' => 'S', 'email' => 's@example.com', 'password' => 'secret123', 'role' => 'staff']));
        $this->get('/api/backup')->assertForbidden();
        $this->postJson('/api/restore')->assertForbidden();
        $this->deleteJson('/api/deleted')->assertForbidden();
        $this->assertSame([], $this->getJson('/api/bootstrap')->json('trash'));
    }

    public function test_backup_then_restore_brings_the_data_back_and_keeps_accounts(): void
    {
        $c = Client::create(['name' => 'شركة النور', 'type' => 'Dealer', 'region' => 'West Bank']);
        Product::create(['name' => 'Lock', 'category' => 'Door Lock', 'stock_on_hand' => 5]);
        $file = $this->get('/api/backup')->assertOk()->streamedContent();
        $this->assertSame('nestify-desk', json_decode($file, true)['app']);

        $c->update(['name' => 'Changed']);
        Client::create(['name' => 'Added later', 'type' => 'Dealer', 'region' => 'West Bank']);
        $staff = User::create(['name' => 'New staff', 'email' => 'n@example.com', 'password' => 'secret123', 'role' => 'staff']);

        $this->post('/api/restore', ['file' => UploadedFile::fake()->createWithContent('b.json', $file)], ['Accept' => 'application/json'])
            ->assertOk()->assertJsonPath('contacts', 1);

        $this->assertSame(['شركة النور'], Client::pluck('name')->all());
        $this->assertSame(5, Product::first()->stock_on_hand);
        $this->assertNotNull(User::find($staff->id));
        $this->getJson('/api/bootstrap')->assertOk();
    }

    public function test_a_file_that_is_not_a_backup_is_refused(): void
    {
        $this->post('/api/restore', ['file' => UploadedFile::fake()->createWithContent('x.json', '{"hello":1}')], ['Accept' => 'application/json'])
            ->assertStatus(422);
    }
}
