<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DeletedRecord;
use App\Models\User;
use App\Support\RecycleBin;
use App\Support\Undo;
use Illuminate\Http\Request;
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
        'company_settings', 'clients', 'products', 'bases', 'covers', 'services', 'offer_sets', 'suppliers', 'employees',
        'transactions', 'transaction_items', 'payments', 'payment_milestones', 'deliveries',
        'purchase_orders', 'purchase_order_lines', 'expenses', 'payroll_payments', 'deleted_records',
    ];

    /** Columns that point at login accounts; accounts are not part of a restore. */
    private const USER_COLUMNS = [
        'transactions' => 'created_by', 'deliveries' => 'user_id', 'deleted_records' => 'deleted_by',
    ];

    public function backup()
    {
        $name = 'nestify-backup-'.now()->format('Y-m-d-His').'.json';

        return response()->streamDownload(function () {
            echo json_encode($this->snapshot(), JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
        }, $name, ['Content-Type' => 'application/json']);
    }

    public function restore(Request $request)
    {
        $request->validate(['file' => 'required|file|max:51200']);
        $data = json_decode((string) file_get_contents($request->file('file')->getRealPath()), true);
        if (! is_array($data) || ($data['app'] ?? null) !== 'nestify-desk' || ! is_array($data['tables'] ?? null)) {
            return response()->json(['message' => 'This is not a Nestify Desk backup file.'], 422);
        }

        // A copy of what is here now, in case the restore was a mistake.
        $safety = 'backups/before-restore-'.now()->format('Y-m-d-His').'.json';
        Storage::disk('local')->put($safety, json_encode($this->snapshot(), JSON_UNESCAPED_UNICODE));

        $userIds = User::pluck('id')->all();
        $counts = [];
        Schema::disableForeignKeyConstraints();
        try {
            DB::transaction(function () use ($data, $userIds, &$counts) {
                foreach (array_reverse(self::TABLES) as $table) {
                    DB::table($table)->delete();
                }
                foreach (self::TABLES as $table) {
                    $columns = array_flip(Schema::getColumnListing($table));
                    $rows = [];
                    foreach ($data['tables'][$table] ?? [] as $row) {
                        // Older or newer backups: keep only the columns this version has.
                        $row = array_intersect_key((array) $row, $columns);
                        $col = self::USER_COLUMNS[$table] ?? null;
                        if ($col && ! empty($row[$col]) && ! in_array($row[$col], $userIds)) {
                            $row[$col] = null;
                        }
                        $rows[] = $row;
                    }
                    foreach (array_chunk($rows, 200) as $chunk) {
                        DB::table($table)->insert($chunk);
                    }
                    $counts[$table] = count($rows);
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

    private function snapshot(): array
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
