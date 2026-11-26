<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class AutoBackupTest extends TestCase
{
    use RefreshDatabase;

    public function test_the_owner_opening_the_system_makes_a_copy_once_per_period(): void
    {
        $this->actingAs(User::create(['name' => 'O', 'email' => 'o@example.com', 'password' => 'secret123', 'role' => 'owner']));
        Client::create(['name' => 'Kept client', 'type' => 'End User', 'region' => 'West Bank']);

        $first = $this->getJson('/api/bootstrap')->json('autoBackup.name');
        $this->assertMatchesRegularExpression('/^nestify-auto-/', $first);
        // Opening again within the period makes no second copy.
        $this->assertSame($first, $this->getJson('/api/bootstrap')->json('autoBackup.name'));
        $this->assertCount(1, Storage::disk('local')->files('backups'));

        // Fifteen days on, a new one is due.
        $this->travel(15)->days();
        $second = $this->getJson('/api/bootstrap')->json('autoBackup.name');
        $this->assertNotSame($first, $second);

        $this->get('/api/backups/'.$second)->assertOk()->assertDownload($second);
        $this->assertStringContainsString('Kept client', Storage::disk('local')->get('backups/'.$second));
        $this->get('/api/backups/..%2F.env')->assertNotFound();
    }

    public function test_back_up_now_and_turning_it_off(): void
    {
        $this->actingAs(User::create(['name' => 'O', 'email' => 'o@example.com', 'password' => 'secret123', 'role' => 'owner']));
        $this->putJson('/api/backups/settings', ['days' => 0])->assertOk()->assertJsonPath('days', 0);
        $this->assertNull($this->getJson('/api/bootstrap')->json('autoBackup'));
        $this->putJson('/api/backups/settings', ['days' => 5])->assertStatus(422);

        $name = $this->postJson('/api/backups')->assertCreated()->json('name');
        $this->assertSame([$name], array_column($this->getJson('/api/backups')->json('list'), 'name'));
    }

    public function test_staff_get_no_backups(): void
    {
        $this->actingAs(User::create(['name' => 'S', 'email' => 's@example.com', 'password' => 'secret123', 'role' => 'staff']));
        $this->assertNull($this->getJson('/api/bootstrap')->json('autoBackup'));
        $this->assertCount(0, Storage::disk('local')->files('backups'));
        $this->getJson('/api/backups')->assertForbidden();
        $this->postJson('/api/backups')->assertForbidden();
    }
}
