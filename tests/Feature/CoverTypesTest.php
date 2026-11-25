<?php

namespace Tests\Feature;

use App\Models\Base;
use App\Models\Client;
use App\Models\Cover;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class CoverTypesTest extends TestCase
{
    use RefreshDatabase;

    private const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    public function test_a_base_is_quoted_by_type_and_coloured_after_agreement(): void
    {
        $this->actingAs(User::create(['name' => 'O', 'email' => 'o@example.com', 'password' => 'secret123', 'role' => 'owner']));
        $this->postJson('/api/cover_types', ['code' => 'q', 'name' => 'Q glass', 'addOnEndUser' => 50, 'addOnDealer' => 40])->assertCreated();
        $this->postJson('/api/cover_types', ['code' => 'Q', 'addOnEndUser' => 1])->assertStatus(422);
        $base = Base::create(['name' => '2-gang switch', 'cost' => 20, 'stock_on_hand' => 10]);
        $black = Cover::create(['name' => 'Black Glossy', 'line' => 'Q', 'finish' => 'Glossy', 'cost' => 8, 'stock_on_hand' => 10]);
        $gold = Cover::create(['name' => 'Champagne Matte', 'line' => 'Q', 'finish' => 'Matte', 'cost' => 12, 'stock_on_hand' => 10]);
        $other = Cover::create(['name' => 'S White', 'line' => 'S', 'finish' => 'Glossy', 'cost' => 5, 'stock_on_hand' => 10]);

        // Up to four pictures per type on the base, served back as images.
        $this->putJson("/api/bases/{$base->id}", ['name' => '2-gang switch', 'typeImages' => ['Q' => array_fill(0, 5, self::PNG)]])->assertStatus(422);
        $this->putJson("/api/bases/{$base->id}", ['name' => '2-gang switch', 'typeImages' => ['Q' => [self::PNG, self::PNG]]])->assertOk();
        $urls = collect($this->getJson('/api/bootstrap')->json('bases'))->firstWhere('id', (string) $base->id)['typeImages']['Q'];
        $this->assertCount(2, $urls);
        $this->get("/api/images/base/{$base->id}/type/Q/1")->assertOk()->assertHeader('Content-Type', 'image/png');

        $c = Client::create(['name' => 'C', 'type' => 'End User', 'region' => 'West Bank']);
        $id = $this->postJson('/api/transactions', [
            'clientId' => $c->id, 'region' => 'West Bank', 'dealType' => 'Direct', 'serviceType' => 'Without Programming', 'date' => '2026-11-01',
            'lines' => [['kind' => 'combo', 'baseId' => $base->id, 'coverType' => 'Q', 'qty' => 5, 'unitPrice' => 150]],
        ])->assertCreated()->json('id');
        $line = Transaction::find($id)->items()->first();
        $this->assertSame('2-gang switch', $line->name);
        $this->assertNull($line->cover_id);
        $this->assertEqualsWithDelta(30, $line->cost_snapshot, 0.01); // 20 + the average Q cover (8 and 12)

        // Colours are for after the client agrees.
        $colours = ['lines' => [['lineId' => $line->id, 'covers' => [['coverId' => $black->id, 'qty' => 3], ['coverId' => $gold->id, 'qty' => 2]]]]];
        $this->postJson("/api/transactions/$id/colours", $colours)->assertStatus(409);
        $this->postJson("/api/transactions/$id/advance", ['status' => 'Agreement'])->assertOk();
        $this->postJson("/api/transactions/$id/advance", ['status' => 'Invoiced'])->assertOk();

        // Nothing goes out while the colours are unknown.
        $this->postJson("/api/transactions/$id/deliver")->assertStatus(422);

        $this->postJson("/api/transactions/$id/colours", ['lines' => [['lineId' => $line->id, 'covers' => [['coverId' => $black->id, 'qty' => 2]]]]])->assertStatus(422);
        $this->postJson("/api/transactions/$id/colours", ['lines' => [['lineId' => $line->id, 'covers' => [['coverId' => $other->id, 'qty' => 5]]]]])->assertStatus(422);
        $this->postJson("/api/transactions/$id/colours", $colours)->assertOk();

        $tx = Transaction::with('items')->find($id);
        $this->assertCount(2, $tx->items);
        $this->assertEqualsWithDelta(750, $tx->total(), 0.01);
        $this->assertEquals([3, 2], $tx->items->pluck('qty')->all());

        $this->postJson("/api/transactions/$id/deliver")->assertOk()->assertJsonPath('complete', true);
        $this->assertSame(5, $base->fresh()->stock_on_hand);
        $this->assertSame(7, $black->fresh()->stock_on_hand);
        $this->assertSame(8, $gold->fresh()->stock_on_hand);
    }
}
