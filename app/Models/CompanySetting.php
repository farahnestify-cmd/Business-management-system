<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CompanySetting extends Model
{
    protected $guarded = [];

    public const DEFAULTS = [
        'name' => 'Nestify',
        'tagline' => 'Smart Home Systems',
        'vat_pct' => 0,
        'validity_days' => 14,
        'overdue_days' => 14,
        'stale_days' => 21,
        'variance_flag' => 15,
        'terms_quotation' => 'All prices in USD. This quotation is valid for {validity} days from the date above. A down payment confirms the order and reserves the stock listed.',
        'terms_agreement' => 'This agreement confirms the scope and prices listed above. The balance falls due on delivery unless a date is stated. Nestify remains the owner of the goods until payment is received in full.',
        'terms_invoice' => 'Payment due on receipt. Please quote the reference number above with your transfer.',
    ];

    public static function current(): self
    {
        return static::query()->first() ?? static::create(self::DEFAULTS);
    }

    public function toApi(): array
    {
        return [
            'name' => $this->name,
            'tagline' => (string) $this->tagline,
            'phone' => (string) $this->phone,
            'email' => (string) $this->email,
            'website' => (string) $this->website,
            'address' => (string) $this->address,
            'vatPct' => (float) $this->vat_pct,
            'validityDays' => (int) $this->validity_days,
            'overdueDays' => (int) $this->overdue_days,
            'staleDays' => (int) $this->stale_days,
            'varianceFlag' => (float) $this->variance_flag,
            'termsQuotation' => (string) $this->terms_quotation,
            'termsAgreement' => (string) $this->terms_agreement,
            'termsInvoice' => (string) $this->terms_invoice,
        ];
    }
}
