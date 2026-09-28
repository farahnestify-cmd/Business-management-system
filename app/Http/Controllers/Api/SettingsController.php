<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\CompanySetting;
use Illuminate\Http\Request;

class SettingsController extends Controller
{
    public function update(Request $request)
    {
        $data = $request->validate([
            'name' => 'nullable|string|max:255',
            'tagline' => 'nullable|string|max:255',
            'phone' => 'nullable|string|max:60',
            'email' => 'nullable|string|max:255',
            'website' => 'nullable|string|max:255',
            'address' => 'nullable|string|max:255',
            'vatPct' => 'nullable|numeric|min:0|max:100',
            'validityDays' => 'nullable|integer|min:1',
            'overdueDays' => 'nullable|integer|min:1',
            'staleDays' => 'nullable|integer|min:1',
            'varianceFlag' => 'nullable|numeric|min:0',
            'termsQuotation' => 'nullable|string|max:5000',
            'termsAgreement' => 'nullable|string|max:5000',
            'termsInvoice' => 'nullable|string|max:5000',
        ]);

        $s = CompanySetting::current();
        $s->fill([
            'name' => ($data['name'] ?? '') ?: 'Nestify',
            'tagline' => $data['tagline'] ?? null,
            'phone' => $data['phone'] ?? null,
            'email' => $data['email'] ?? null,
            'website' => $data['website'] ?? null,
            'address' => $data['address'] ?? null,
            'vat_pct' => $data['vatPct'] ?? 0,
            'validity_days' => $data['validityDays'] ?? 14,
            'overdue_days' => $data['overdueDays'] ?? 14,
            'stale_days' => $data['staleDays'] ?? 21,
            'variance_flag' => $data['varianceFlag'] ?? 15,
            'terms_quotation' => $data['termsQuotation'] ?? null,
            'terms_agreement' => $data['termsAgreement'] ?? null,
            'terms_invoice' => $data['termsInvoice'] ?? null,
        ])->save();

        return response()->json($s->toApi());
    }
}
