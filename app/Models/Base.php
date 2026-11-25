<?php

namespace App\Models;

class Base extends StockItem
{
    protected $table = 'bases';

    protected $casts = ['type_images' => 'array'];

    public function toApi(): array
    {
        // Pictures per cover type, as addresses the browser can load: {"Q": [url, …]}.
        $pics = [];
        foreach ((array) $this->type_images as $code => $list) {
            foreach (array_values((array) $list) as $i => $data) {
                $pics[$code][] = url('/api/images/base/'.$this->id.'/type/'.rawurlencode($code).'/'.$i).'?v='.substr(md5($data), 0, 10);
            }
        }

        return $this->common() + $this->priceBook() + ['line' => (string) $this->line, 'typeImages' => (object) $pics];
    }

    public function typeImageResponse(string $code, int $i)
    {
        $data = ((array) $this->type_images)[$code][$i] ?? null;
        if (! $data || ! preg_match('#^data:(image/(?:png|jpeg|webp));base64,(.+)$#s', $data, $m)) {
            abort(404);
        }

        return response(base64_decode($m[2]), 200, ['Content-Type' => $m[1], 'Cache-Control' => 'private, max-age=31536000']);
    }
}
