@extends('layout-auth')
@section('title', 'Sign in')
@section('body')
<form method="POST" action="{{ url('/login') }}">
  @csrf
  <h3>Sign in</h3>
  @if ($errors->any())
    <div class="err">{{ $errors->first() }}</div>
  @endif
  <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" value="{{ old('email') }}" required autofocus autocomplete="username"></div>
  <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" required autocomplete="current-password"></div>
  <label class="remember"><input type="checkbox" name="remember" value="1"> Keep me signed in</label>
  <button class="btn primary" type="submit">Sign in</button>
</form>
@endsection
