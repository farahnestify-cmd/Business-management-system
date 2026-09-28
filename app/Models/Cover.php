<?php

namespace App\Models;

class Cover extends StockItem
{
    public function toApi(): array
    {
        return $this->common() + [
            'line' => (string) $this->line,
            'color' => (string) $this->color,
            'finish' => $this->finish,
            'priceAddOn' => (float) $this->price_add_on,
        ];
    }
}
