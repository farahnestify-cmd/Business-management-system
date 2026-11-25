<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Product;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ItemPicturesTest extends TestCase
{
    use RefreshDatabase;

    private const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    public function test_a_product_picture_is_saved_served_and_removed(): void
    {
        $this->actingAs(User::create(['name' => 'O', 'email' => 'o@example.com', 'password' => 'secret123', 'role' => 'owner']));
        $p = Product::create(['name' => 'Lock', 'category' => 'Door Lock']);

        $this->putJson("/api/products/{$p->id}", ['name' => 'Lock', 'category' => 'Door Lock', 'imageData' => 'data:text/html;base64,PGI+'])->assertStatus(422);
        $this->putJson("/api/products/{$p->id}", ['name' => 'Lock', 'category' => 'Door Lock', 'imageData' => self::PNG])->assertOk();

        $url = collect($this->getJson('/api/bootstrap')->json('products'))->firstWhere('id', (string) $p->id)['image'];
        $this->assertStringContainsString("/api/images/product/{$p->id}", $url);
        $this->get("/api/images/product/{$p->id}")->assertOk()->assertHeader('Content-Type', 'image/png');

        // Saving without the field keeps it; sending null removes it.
        $this->putJson("/api/products/{$p->id}", ['name' => 'Lock 2', 'category' => 'Door Lock'])->assertOk();
        $this->assertNotNull($p->fresh()->image_data);
        $this->putJson("/api/products/{$p->id}", ['name' => 'Lock 2', 'category' => 'Door Lock', 'imageData' => null])->assertOk();
        $this->assertNull($p->fresh()->image_data);
        $this->get("/api/images/product/{$p->id}")->assertNotFound();
    }

    public function test_an_offer_keeps_its_table_heading(): void
    {
        $this->actingAs(User::create(['name' => 'O', 'email' => 'o@example.com', 'password' => 'secret123', 'role' => 'owner']));
        $c = Client::create(['name' => 'C', 'type' => 'End User', 'region' => 'West Bank']);
        $p = Product::create(['name' => 'Lock', 'category' => 'Door Lock']);
        $id = $this->postJson('/api/transactions', [
            'clientId' => $c->id, 'region' => 'West Bank', 'dealType' => 'Direct', 'serviceType' => 'Without Programming', 'date' => '2026-11-01',
            'tableTitle' => 'Curved glass — Matte finish',
            'lines' => [['kind' => 'product', 'productId' => $p->id, 'qty' => 1, 'unitPrice' => 90]],
        ])->assertCreated()->json('id');
        $this->assertSame('Curved glass — Matte finish', collect($this->getJson('/api/bootstrap')->json('transactions'))->firstWhere('id', $id)['tableTitle']);
    }
}
