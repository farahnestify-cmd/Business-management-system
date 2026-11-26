<?php

namespace App\Support;

use App\Http\Controllers\Api\DataController;
use App\Models\CompanySetting;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Storage;

/**
 * Full copies of the data kept on the server (storage/app/backups). An automatic
 * copy is made when the owner opens the system and the last one is older than the
 * chosen period, so no scheduled job is needed on the hosting.
 */
class Backups
{
    private const DIR = 'backups';

    /** Names the system writes: nestify-auto-…, nestify-manual-… and before-restore-…. */
    public const NAME = '/^(nestify-(auto|manual)|before-restore)-\d{4}-\d{2}-\d{2}-\d{6}\.json$/';

    public static function save(string $kind): string
    {
        $name = 'nestify-'.$kind.'-'.now()->format('Y-m-d-His').'.json';
        Storage::disk('local')->put(self::DIR.'/'.$name, json_encode(DataController::snapshot(), JSON_UNESCAPED_UNICODE));
        self::prune();

        return $name;
    }

    /** @return array<int, array{name: string, kind: string, size: int, createdAt: string}> newest first */
    public static function all(): array
    {
        $out = [];
        foreach (Storage::disk('local')->files(self::DIR) as $path) {
            $name = basename($path);
            if (! preg_match(self::NAME, $name, $m)
                || ! preg_match('/(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})\.json$/', $name, $t)) {
                continue;
            }
            $out[] = [
                'name' => $name,
                'kind' => $m[1] === 'before-restore' ? 'before-restore' : $m[2],
                'size' => Storage::disk('local')->size($path),
                // The time is in the name, written in the server's clock.
                'createdAt' => Carbon::create($t[1], $t[2], $t[3], $t[4], $t[5], $t[6])->toIso8601String(),
            ];
        }
        usort($out, fn ($a, $b) => [$b['createdAt'], $b['name']] <=> [$a['createdAt'], $a['name']]);

        return $out;
    }

    public static function latestAuto(): ?array
    {
        foreach (self::all() as $b) {
            if ($b['kind'] === 'auto') {
                return $b;
            }
        }

        return null;
    }

    /** Makes the automatic copy when one is due; returns its name, or null. */
    public static function runIfDue(): ?string
    {
        $days = (int) CompanySetting::current()->auto_backup_days;
        if ($days <= 0) {
            return null;
        }
        $last = self::latestAuto();
        if ($last && strtotime($last['createdAt']) > now()->subDays($days)->getTimestamp()) {
            return null;
        }

        // Two people opening the system at the same moment make one copy, not two.
        return Cache::lock('nestify-auto-backup', 120)->get(function () use ($days) {
            $again = self::latestAuto();
            if ($again && strtotime($again['createdAt']) > now()->subDays($days)->getTimestamp()) {
                return null;
            }

            return self::save('auto');
        });
    }

    public static function path(string $name): ?string
    {
        if (! preg_match(self::NAME, $name) || ! Storage::disk('local')->exists(self::DIR.'/'.$name)) {
            return null;
        }

        return Storage::disk('local')->path(self::DIR.'/'.$name);
    }

    /** The newest 12 automatic and 12 manual copies stay; copies made before a restore are never removed. */
    private static function prune(): void
    {
        foreach (['auto', 'manual'] as $kind) {
            $mine = array_values(array_filter(self::all(), fn ($b) => $b['kind'] === $kind));
            foreach (array_slice($mine, 12) as $old) {
                Storage::disk('local')->delete(self::DIR.'/'.$old['name']);
            }
        }
    }
}
