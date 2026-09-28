<?php

namespace App\Http\Controllers;

use App\Support\Installer;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;

class InstallController extends Controller
{
    public function show(Request $request)
    {
        return view('install', [
            'checks' => Installer::checks(),
            'old' => ['app_url' => $request->getSchemeAndHttpHost().$request->getBaseUrl(), 'db_host' => 'localhost', 'db_port' => '3306'],
            'error' => null,
        ]);
    }

    public function store(Request $request)
    {
        $in = $request->only(['company', 'app_url', 'timezone', 'db_host', 'db_port', 'db_name', 'db_user', 'db_pass',
            'owner_name', 'owner_email', 'owner_password']);
        $in = array_map(fn ($v) => is_string($v) ? trim($v) : '', $in + array_fill_keys(
            ['company', 'app_url', 'timezone', 'db_host', 'db_port', 'db_name', 'db_user', 'db_pass', 'owner_name', 'owner_email', 'owner_password'], ''));
        $in['db_pass'] = (string) $request->input('db_pass', '');

        $v = Validator::make($in, [
            'app_url' => 'required|url',
            'timezone' => 'nullable|timezone',
            'db_host' => 'required|string',
            'db_port' => 'required|integer',
            'db_name' => 'required|string',
            'db_user' => 'required|string',
            'owner_name' => 'required|string|max:255',
            'owner_email' => 'required|email',
            'owner_password' => 'required|string|min:8',
        ]);

        $error = $v->fails() ? implode(' ', $v->errors()->all()) : null;
        if (! $error) {
            try {
                Installer::run($in);

                return view('install-done', ['url' => rtrim($in['app_url'], '/').'/login']);
            } catch (\Throwable $e) {
                $error = $e->getMessage();
            }
        }

        unset($in['db_pass'], $in['owner_password']);

        return view('install', ['checks' => Installer::checks(), 'old' => $in, 'error' => $error]);
    }
}
