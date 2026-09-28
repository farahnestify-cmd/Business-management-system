<?php

namespace App\Models;

class Base extends StockItem
{
    protected $table = 'bases';

    public function toApi(): array
    {
        return $this->common() + $this->priceBook() + ['line' => (string) $this->line];
    }
}
