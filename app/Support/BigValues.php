<?php

namespace App\Support;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;

/**
 * Long texts (pictures kept as data URLs, deleted records that hold one) written to
 * the database in small pieces. MySQL refuses any single statement over its packet
 * limit (1 MB by default in XAMPP and on many hosts) with "server has gone away".
 */
class BigValues
{
    /** Characters per piece: at most ~200 KB even for four-byte characters. */
    private const PIECE = 50000;

    /** The largest single value kept: MySQL's default 1 MB limit applies to a whole value, however it is written. */
    public const SAFE = 900000;

    public static function isBig($value): bool
    {
        return is_string($value) && strlen($value) > self::PIECE;
    }

    /** Fills a column piece by piece; the row must already exist. */
    public static function write(string $table, int $id, string $column, string $value): void
    {
        DB::table($table)->where('id', $id)->update([$column => '']);
        $grammar = DB::getQueryGrammar();
        $t = $grammar->wrapTable($table);
        $c = $grammar->wrap($column);
        $append = DB::getDriverName() === 'sqlite' ? "COALESCE($c, '') || ?" : "CONCAT(COALESCE($c, ''), ?)";
        foreach (mb_str_split($value, self::PIECE) as $piece) {
            DB::update("UPDATE $t SET $c = $append WHERE id = ?", [$piece, $id]);
        }
    }

    /** A row with its long texts set aside (as empty strings) to be written after the insert. */
    public static function split(array $row): array
    {
        $later = [];
        foreach ($row as $k => $v) {
            if (self::isBig($v)) {
                $later[$k] = $v;
                $row[$k] = '';
            }
        }

        return [$row, $later];
    }

    /** Saves a model, writing any long column in pieces afterwards. */
    public static function save(Model $model, array $columns): void
    {
        $later = [];
        $raw = $model->getAttributes();
        foreach ($columns as $col) {
            if (self::isBig($raw[$col] ?? null)) {
                $later[$col] = $raw[$col];
                $raw[$col] = '';
            }
        }
        if ($later) {
            $model->setRawAttributes($raw);
        }
        $model->save();
        foreach ($later as $col => $value) {
            self::write($model->getTable(), $model->getKey(), $col, $value);
            $model->setRawAttributes(array_merge($model->getAttributes(), [$col => $value]), true);
        }
    }
}
