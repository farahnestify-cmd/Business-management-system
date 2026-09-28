<?php

namespace App\Models;

/**
 * Small helpers shared by the models' API presenters.
 */
trait Concerns
{
    protected static function sid($v): ?string
    {
        return $v === null ? null : (string) $v;
    }

    protected static function d($v): ?string
    {
        if ($v === null) {
            return null;
        }

        return $v instanceof \DateTimeInterface ? $v->format('Y-m-d') : substr((string) $v, 0, 10);
    }
}
