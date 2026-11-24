<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class BrandedOfferTest extends TestCase
{
    use RefreshDatabase;

    private const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    public function test_owner_sets_the_branded_offer_and_images_are_served(): void
    {
        $this->actingAs(User::create(['name' => 'O', 'email' => 'o@example.com', 'password' => 'secret123', 'role' => 'owner']));

        $this->putJson('/api/settings', ['name' => 'Nestify', 'introText' => 'Thank you', 'offerNotes' => "One\nTwo", 'coverNote' => 'Ramallah'])->assertOk();
        $this->putJson('/api/brand/logo', ['data' => self::PNG])->assertOk();
        $this->putJson('/api/brand/hero', ['data' => 'data:text/html;base64,PGgxPg=='])->assertStatus(422);

        $s = $this->getJson('/api/bootstrap')->json('settings');
        $this->assertSame('Thank you', $s['introText']);
        $this->assertSame("One\nTwo", $s['offerNotes']);
        $this->assertSame('Ramallah', $s['coverNote']);
        $this->assertStringContainsString('/api/brand/logo?v=', $s['logo']);
        $this->assertSame('', $s['hero']);

        $img = $this->get('/api/brand/logo')->assertOk();
        $this->assertSame('image/png', $img->headers->get('Content-Type'));
        $this->assertStringStartsWith("\x89PNG", $img->getContent());

        $this->deleteJson('/api/brand/logo')->assertOk();
        $this->get('/api/brand/logo')->assertNotFound();
    }

    public function test_staff_can_see_but_not_change_the_brand(): void
    {
        $this->actingAs(User::create(['name' => 'S', 'email' => 's@example.com', 'password' => 'secret123', 'role' => 'staff']));
        $this->putJson('/api/brand/logo', ['data' => self::PNG])->assertForbidden();
        $this->get('/api/brand/logo')->assertNotFound();
    }
}
