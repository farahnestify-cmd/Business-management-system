@extends('layout-auth')
@section('title', 'Ready')
@section('body')
<h3>All set</h3>
<p class="muted">The tables are created and your owner account is ready. The installer is now switched off.</p>
<a class="btn primary" href="{{ $url }}">Go to sign in</a>
@endsection
