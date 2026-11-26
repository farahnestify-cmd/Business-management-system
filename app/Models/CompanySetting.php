<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CompanySetting extends Model
{
    protected $guarded = [];

    public const DEFAULTS = [
        'name' => 'nestify',
        'tagline' => 'where your home gets a brain.',
        'vat_pct' => 0,
        'validity_days' => 14,
        'overdue_days' => 14,
        'stale_days' => 21,
        'variance_flag' => 15,
        'auto_backup_days' => 14,
        'terms_quotation' => 'All prices in USD. This quotation is valid for {validity} days from the date above. A down payment confirms the order and reserves the stock listed.',
        'terms_agreement' => 'This agreement confirms the scope and prices listed above. The balance falls due on delivery unless a date is stated. nestify remains the owner of the goods until payment is received in full.',
        'terms_invoice' => 'Payment due on receipt. Please quote the reference number above with your transfer.',
        'intro_text' => self::INTRO,
        'offer_notes' => self::NOTES,
        'cover_note' => 'welcome to smarter living.',
    ];

    /** The opening page of the Full quotation, until the company writes its own. */
    public const INTRO = 'Thank you for considering nestify. Below is your personalized price offer, designed to meet your needs with the highest standards of quality and innovation. This offer includes premium devices supporting ZigBee.';

    public const NOTES = "Prices are in USD and exclude VAT.\nDelivery time: within 2–4 weeks from approval of the quotation.\nThe quotation does not include electrical wiring or connection works.\nThree-year warranty on all switches.";

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
            'introText' => (string) $this->intro_text,
            'offerNotes' => (string) $this->offer_notes,
            'coverNote' => (string) $this->cover_note,
            'autoBackupDays' => (int) $this->auto_backup_days,
            // Images are served by their own route; the version makes a new upload show at once.
            'logo' => $this->logo_data ? url('/api/brand/logo').'?v='.substr(md5($this->logo_data), 0, 10) : '',
            'hero' => $this->hero_data ? url('/api/brand/hero').'?v='.substr(md5($this->hero_data), 0, 10) : '',
        ];
    }
}
