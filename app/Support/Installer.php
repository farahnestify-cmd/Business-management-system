<?php

namespace App\Support;

use App\Models\CompanySetting;
use App\Models\User;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use PDO;
use RuntimeException;

/**
 * One-time setup for shared hosting where there is no SSH: writes .env,
 * creates the tables and the owner account.
 */
class Installer
{
    public static function installed(): bool
    {
        return (bool) config('app.installed') || is_file(self::lockFile());
    }

    public static function lockFile(): string
    {
        return storage_path('app/installed');
    }

    /** Folders that must be writable, with whether they are. */
    public static function checks(): array
    {
        return [
            'PHP 8.2 or newer' => version_compare(PHP_VERSION, '8.2.0', '>='),
            'PDO MySQL extension' => extension_loaded('pdo_mysql'),
            'OpenSSL extension' => extension_loaded('openssl'),
            'Mbstring extension' => extension_loaded('mbstring'),
            'Project folder writable (for .env)' => is_writable(base_path()),
            'storage/ writable' => is_writable(storage_path()),
            'bootstrap/cache/ writable' => is_writable(base_path('bootstrap/cache')),
        ];
    }

    public static function run(array $in): void
    {
        $db = [
            'driver' => 'mysql',
            'host' => $in['db_host'],
            'port' => $in['db_port'],
            'database' => $in['db_name'],
            'username' => $in['db_user'],
            'password' => $in['db_pass'],
            'charset' => 'utf8mb4',
            'collation' => 'utf8mb4_unicode_ci',
            'prefix' => '',
            'strict' => true,
            'engine' => null,
        ];

        try {
            new PDO("mysql:host={$db['host']};port={$db['port']};dbname={$db['database']}", $db['username'], $db['password'], [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_TIMEOUT => 5,
            ]);
        } catch (\PDOException $e) {
            throw new RuntimeException('Could not connect to MySQL: '.$e->getMessage());
        }

        $key = 'base64:'.base64_encode(random_bytes(32));
        $env = [
            'APP_NAME' => 'Nestify Desk',
            'APP_ENV' => 'production',
            'APP_KEY' => $key,
            'APP_DEBUG' => 'false',
            'APP_URL' => rtrim($in['app_url'], '/'),
            'APP_INSTALLED' => 'true',
            'APP_TIMEZONE' => $in['timezone'] ?: 'Asia/Hebron',
            'LOG_CHANNEL' => 'single',
            'LOG_LEVEL' => 'error',
            'DB_CONNECTION' => 'mysql',
            'DB_HOST' => $db['host'],
            'DB_PORT' => $db['port'],
            'DB_DATABASE' => $db['database'],
            'DB_USERNAME' => $db['username'],
            'DB_PASSWORD' => $db['password'],
            'SESSION_DRIVER' => 'file',
            'SESSION_LIFETIME' => '480',
            'CACHE_STORE' => 'file',
            'QUEUE_CONNECTION' => 'sync',
            'FILESYSTEM_DISK' => 'local',
            'MAIL_MAILER' => 'log',
        ];
        $lines = [];
        foreach ($env as $k => $v) {
            $lines[] = $k.'='.self::quote((string) $v);
        }
        if (file_put_contents(base_path('.env'), implode("\n", $lines)."\n") === false) {
            throw new RuntimeException('Could not write the .env file. Make the project folder writable and try again.');
        }

        config([
            'database.connections.mysql' => $db,
            'database.default' => 'mysql',
            'app.key' => $key,
        ]);
        DB::purge('mysql');

        Artisan::call('migrate', ['--force' => true]);

        User::updateOrCreate(['email' => $in['owner_email']], [
            'name' => $in['owner_name'],
            'password' => $in['owner_password'],
            'role' => 'owner',
        ]);
        CompanySetting::current()->update(['name' => $in['company'] ?: 'Nestify']);

        file_put_contents(self::lockFile(), date('c'));
    }

    private static function quote(string $v): string
    {
        if ($v === '' || preg_match('/^[A-Za-z0-9_.:\/@+-]+$/', $v)) {
            return $v;
        }
        if (! str_contains($v, "'")) {
            return "'".$v."'";
        }

        return '"'.str_replace(['\\', '"', '$'], ['\\\\', '\\"', '\\$'], $v).'"';
    }
}
