<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>@yield('title') · Nestify Desk</title>
<link rel="icon" href="{{ asset('favicon.svg') }}" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<link rel="stylesheet" href="{{ asset('assets/css/app.css') }}?v={{ filemtime(public_path('assets/css/app.css')) }}">
</head>
<body>
<div class="auth">
  <div class="sheet @yield('width')">
    <div class="sheet-body">
      <div class="wordmark"><b>Nestify</b><span>Operations</span></div>
      @yield('body')
    </div>
  </div>
</div>
</body>
</html>
