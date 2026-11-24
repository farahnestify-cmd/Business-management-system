<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PriceTiersTest extends TestCase
{
    use RefreshDatabase;

    public function test_tiers_are_managed_and_linked_to_contacts(): void
    {
        $this->actingAs(User::create(['name' => 'O', 'email' => 'o@example.com', 'password' => 'secret123', 'role' => 'owner']));
        $tier = $this->postJson('/api/price_tiers', ['name' => 'Dealer Gold', 'code' => 'DG', 'basis' => 'Dealer', 'discountPct' => 0.1, 'targetYear' => 50000, 'active' => true])
            ->assertCreated()->json('id');
        $client = $this->postJson('/api/clients', ['name' => 'Shop', 'type' => 'End User', 'region' => 'West Bank', 'tierId' => (int) $tier, 'discountPct' => 0.05])
            ->assertCreated()->json('id');

        $boot = $this->getJson('/api/bootstrap')->json();
        $this->assertSame('Dealer', $boot['tiers'][0]['basis']);
        $this->assertEquals(0.1, $boot['tiers'][0]['discountPct']);
        $this->assertSame($tier, collect($boot['clients'])->firstWhere('id', $client)['tierId']);

        $this->postJson('/api/price_tiers', ['name' => 'Bad', 'basis' => 'Wholesale'])->assertStatus(422);
        $this->postJson('/api/price_tiers', ['name' => 'Bad', 'basis' => 'Dealer', 'discountPct' => 1.5])->assertStatus(422);

        // Deleting a tier unlinks its contacts; restoring it links them back.
        $undo = $this->deleteJson("/api/price_tiers/$tier")->assertOk()->json('undo');
        $this->assertNull(Client::find($client)->tier_id);
        $this->postJson("/api/undo/$undo")->assertOk();
        $this->assertEquals($tier, Client::find($client)->tier_id);
    }

    public function test_sales_can_assign_a_tier_but_not_edit_the_tier_list(): void
    {
        $this->actingAs(User::create(['name' => 'S', 'email' => 's@example.com', 'password' => 'secret123', 'role' => 'staff']));
        $this->postJson('/api/price_tiers', ['name' => 'X', 'basis' => 'Dealer'])->assertForbidden();
        $this->postJson('/api/clients', ['name' => 'C', 'type' => 'Dealer', 'region' => 'West Bank', 'tierId' => 999])->assertStatus(422);
    }
}
