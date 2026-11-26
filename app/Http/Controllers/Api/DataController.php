<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\CompanySetting;
use App\Models\DeletedRecord;
use App\Models\User;
use App\Support\Backups;
use App\Support\BigValues;
use App\Support\RecycleBin;
use App\Support\Undo;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use RuntimeException;

/**
 * The owner's "Your data" tools: a full backup file, restoring from one, and
 * the Recently deleted bin.
 */
class DataController extends Controller
{
    /** Parents before children, so a restore can insert in this order. */
    private const TABLES = [
        'company_settings', 'currencies', 'price_tiers', 'cover_types', 'clients', 'products', 'bases', 'covers', 'services', 'offer_sets', 'suppliers', 'employees',
        'transactions', 'transaction_items', 'payments', 'payment_milestones', 'deliveries',
        'purchase_orders', 'purchase_order_lines', 'expenses', 'payroll_payments', 'deleted_records',
    ];

    /** Columns that point at login accounts; accounts are not part of a restore. */
    private const USER_COLUMNS = [
        'transactions' => 'created_by', 'deliveries' => 'user_id', 'deleted_records' => 'deleted_by',
    ];

    /** The copies kept on the server, and how often an automatic one is made. */
    public function backups()
    {
        $days = (int) CompanySetting::current()->auto_backup_days;
        $last = Backups::latestAuto();

        return response()->json([
            'days' => $days,
            'list' => Backups::all(),
            'nextDue' => $days > 0 ? ($last ? Carbon::parse($last['createdAt'])->addDays($days)->toDateString() : now()->toDateString()) : null,
        ]);
    }

    /** "Back up now": a copy kept on the server, which the browser then downloads. */
    public function backupNow()
    {
        return response()->json(['name' => Backups::save('manual')], 201);
    }

    public function downloadBackup(string $name)
    {
        $path = Backups::path($name);
        abort_if(! $path, 404);

        return response()->download($path, $name, ['Content-Type' => 'application/json']);
    }

    public function backupSettings(Request $request)
    {
        $data = $request->validate(['days' => 'required|integer|in:0,7,14,30']);
        CompanySetting::current()->update(['auto_backup_days' => $data['days']]);

        return $this->backups();
    }

    public function backup()
    {
        $name = 'nestify-backup-'.now()->format('Y-m-d-His').'.json';

        return response()->streamDownload(function () {
            echo json_encode(self::snapshot(), JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
        }, $name, ['Content-Type' => 'application/json']);
    }

    /**
     * A backup sent in pieces, so neither the host's upload limit nor its post limit
     * stands in the way of a large file. The pieces are put together on the server.
     */
    public function restorePiece(Request $request)
    {
        $data = $request->validate([
            'upload' => ['required', 'string', 'regex:/^[A-Za-z0-9]{16,40}$/'],
            'index' => 'required|integer|min:0|max:1000',
            // The file's own bytes, base64-encoded: nothing on the way can trim or reshape them.
            'data' => ['required', 'string', 'regex:/^[A-Za-z0-9+\/=]+$/'],
        ]);
        $bytes = base64_decode($data['data'], true);
        abort_if($bytes === false, 422, 'A piece of the file was damaged on the way. Try again.');
        $path = 'restore-uploads/'.$data['upload'].'.json';
        if ($data['index'] === 0) {
            Storage::disk('local')->put($path, $bytes);
        } else {
            abort_if(! Storage::disk('local')->exists($path), 409, 'Start the upload again.');
            Storage::disk('local')->append($path, $bytes, '');
        }

        return response()->json(['ok' => true]);
    }

    public function restoreAssembled(Request $request)
    {
        $data = $request->validate(['upload' => ['required', 'string', 'regex:/^[A-Za-z0-9]{16,40}$/']]);
        $path = 'restore-uploads/'.$data['upload'].'.json';
        abort_if(! Storage::disk('local')->exists($path), 404, 'The uploaded file was not found. Try again.');
        $text = Storage::disk('local')->get($path);
        Storage::disk('local')->delete($path);

        return $this->restoreFrom((string) $text);
    }

    public function restore(Request $request)
    {
        $request->validate(['file' => 'required|file|max:51200']);

        return $this->restoreFrom((string) file_get_contents($request->file('file')->getRealPath()));
    }

    private function restoreFrom(string $text)
    {
        $data = json_decode($text, true);
        if (! is_array($data) || ($data['app'] ?? null) !== 'nestify-desk' || ! is_array($data['tables'] ?? null)) {
            return response()->json(['message' => 'This is not a Nestify Desk backup file.'], 422);
        }

        // A copy of what is here now, in case the restore was a mistake.
        $safety = 'backups/before-restore-'.now()->format('Y-m-d-His').'.json';
        Storage::disk('local')->put($safety, json_encode(self::snapshot(), JSON_UNESCAPED_UNICODE));

        $userIds = User::pluck('id')->all();
        $counts = [];
        $skipped = 0;
        Schema::disableForeignKeyConstraints();
        try {
            DB::transaction(function () use ($data, $userIds, &$counts, &$skipped) {
                foreach (array_reverse(self::TABLES) as $table) {
                    DB::table($table)->delete();
                }
                foreach (self::TABLES as $table) {
                    $columns = array_flip(Schema::getColumnListing($table));
                    // Rows go in in small batches, and pictures in pieces, so no single statement
                    // is larger than MySQL accepts (1 MB by default in XAMPP).
                    $batch = [];
                    $later = [];
                    $bytes = 0;
                    $flush = function () use ($table, &$batch, &$later, &$bytes) {
                        if ($batch) {
                            DB::table($table)->insert($batch);
                        }
                        foreach ($later as [$id, $cols]) {
                            foreach ($cols as $col => $value) {
                                BigValues::write($table, $id, $col, $value);
                            }
                        }
                        $batch = [];
                        $later = [];
                        $bytes = 0;
                    };
                    $count = 0;
                    foreach ($data['tables'][$table] ?? [] as $row) {
                        // Older or newer backups: keep only the columns this version has.
                        $row = array_intersect_key((array) $row, $columns);
                        $col = self::USER_COLUMNS[$table] ?? null;
                        if ($col && ! empty($row[$col]) && ! in_array($row[$col], $userIds)) {
                            $row[$col] = null;
                        }
                        // A value over the database's limit (an outsized picture) cannot be kept:
                        // it is left out, and a deleted record carrying one is dropped, so the rest comes back.
                        $tooBig = array_filter($row, fn ($v) => is_string($v) && strlen($v) > BigValues::SAFE);
                        if ($tooBig) {
                            if ($table === 'deleted_records') {
                                $skipped++;

                                continue;
                            }
                            foreach (array_keys($tooBig) as $k) {
                                $row[$k] = null;
                                $skipped++;
                            }
                        }
                        [$row, $big] = BigValues::split($row);
                        if ($big) {
                            $later[] = [$row['id'], $big];
                        }
                        $size = strlen(json_encode($row));
                        if ($batch && ($bytes + $size > 300000 || count($batch) >= 200)) {
                            $flush();
                        }
                        $batch[] = $row;
                        $bytes += $size;
                        $count++;
                    }
                    $flush();
                    $counts[$table] = $count;
                }
            });
        } finally {
            Schema::enableForeignKeyConstraints();
        }

        return response()->json([
            'ok' => true,
            'deals' => $counts['transactions'] ?? 0,
            'contacts' => $counts['clients'] ?? 0,
            'from' => $data['created_at'] ?? null,
            'skipped' => $skipped,
        ]);
    }

    public function restoreDeleted(DeletedRecord $deletedRecord)
    {
        try {
            return response()->json(['ok' => true, 'message' => RecycleBin::restore($deletedRecord)]);
        } catch (RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 409);
        }
    }

    /** The Undo button: reverse what this person just did. */
    public function undo(string $token)
    {
        try {
            return response()->json(['ok' => true, 'message' => Undo::run($token)]);
        } catch (RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 409);
        }
    }

    public function forget(DeletedRecord $deletedRecord)
    {
        $deletedRecord->delete();

        return response()->json(['ok' => true]);
    }

    public function emptyBin()
    {
        DeletedRecord::query()->delete();

        return response()->json(['ok' => true]);
    }

    public static function snapshot(): array
    {
        $tables = [];
        foreach (self::TABLES as $table) {
            $tables[$table] = DB::table($table)->orderBy('id')->get()->map(fn ($r) => (array) $r)->all();
        }

        return [
            'app' => 'nestify-desk',
            'version' => 1,
            'created_at' => now()->toIso8601String(),
            'tables' => $tables,
            // For reference only: accounts and passwords are never restored from a file.
            'accounts' => User::orderBy('id')->get(['name', 'email', 'role'])->toArray(),
        ];
    }
}
