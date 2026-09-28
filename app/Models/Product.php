<?php

namespace App\Models;

class Product extends StockItem
{
    public function toApi(): array
    {
        return $this->common() + $this->priceBook() + ['category' => $this->category];
    }
}
