@extends('layout-auth')
@section('title', 'Set up')
@section('width', 'wide')
@section('body')
<form method="POST" action="{{ url('/install') }}">
  <h3>Set up Nestify Desk</h3>
  <p class="tiny muted">Create an empty MySQL database and user in your hosting control panel first, then fill in the details below. This page closes itself once setup succeeds.</p>
  <div class="panel panel-pad">
    @foreach ($checks as $label => $ok)
      <div class="check"><span>{{ $label }}</span><span class="pill {{ $ok ? 'good' : 'bad' }}">{{ $ok ? 'OK' : 'Missing' }}</span></div>
    @endforeach
  </div>
  @if ($error)
    <div class="err">{{ $error }}</div>
  @endif
  <p class="eyebrow">Site</p>
  <div class="grid g3">
    <div class="field"><label for="company">Company name</label><input id="company" name="company" value="{{ $old['company'] ?? 'Nestify' }}"></div>
    <div class="field"><label for="app_url">Site address</label><input id="app_url" name="app_url" value="{{ $old['app_url'] ?? '' }}" required></div>
    <div class="field"><label for="timezone">Time zone</label><input id="timezone" name="timezone" value="{{ $old['timezone'] ?? 'Asia/Hebron' }}"></div>
  </div>
  <p class="eyebrow">MySQL database</p>
  <div class="grid g2">
    <div class="field"><label for="db_host">Host</label><input id="db_host" name="db_host" value="{{ $old['db_host'] ?? 'localhost' }}" required></div>
    <div class="field"><label for="db_port">Port</label><input id="db_port" name="db_port" value="{{ $old['db_port'] ?? '3306' }}" required class="mono"></div>
    <div class="field"><label for="db_name">Database name</label><input id="db_name" name="db_name" value="{{ $old['db_name'] ?? '' }}" required></div>
    <div class="field"><label for="db_user">Database user</label><input id="db_user" name="db_user" value="{{ $old['db_user'] ?? '' }}" required></div>
    <div class="field"><label for="db_pass">Database password</label><input id="db_pass" name="db_pass" type="password" autocomplete="off"></div>
  </div>
  <p class="eyebrow">Owner account</p>
  <div class="grid g3">
    <div class="field"><label for="owner_name">Your name</label><input id="owner_name" name="owner_name" value="{{ $old['owner_name'] ?? '' }}" required></div>
    <div class="field"><label for="owner_email">Email</label><input id="owner_email" name="owner_email" type="email" value="{{ $old['owner_email'] ?? '' }}" required></div>
    <div class="field"><label for="owner_password">Password (8+ characters)</label><input id="owner_password" name="owner_password" type="password" required minlength="8" autocomplete="new-password"></div>
  </div>
  <button class="btn primary" type="submit">Install</button>
</form>
@endsection
