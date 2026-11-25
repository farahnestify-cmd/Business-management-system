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
            'introText' => 'nullable|string|max:5000',
            'offerNotes' => 'nullable|string|max:5000',
            'coverNote' => 'nullable|string|max:255',
        ]);

        $s = CompanySetting::current();
        $s->fill([
            'name' => ($data['name'] ?? '') ?: 'nestify',
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
            'intro_text' => $data['introText'] ?? null,
            'offer_notes' => $data['offerNotes'] ?? null,
            'cover_note' => $data['coverNote'] ?? null,
        ])->save();

        return response()->json($s->toApi());
    }

    /** The logo or cover photo, as the image itself. */
    public function image(string $which)
    {
        $data = CompanySetting::current()->{$which.'_data'};
        if (! $data || ! preg_match('#^data:(image/(?:png|jpeg|webp));base64,(.+)$#s', $data, $m)) {
            abort(404);
        }

        return response(base64_decode($m[2]), 200, [
            'Content-Type' => $m[1],
            'Cache-Control' => 'private, max-age=31536000',
        ]);
    }

    public function saveImage(Request $request, string $which)
    {
        $data = $request->validate(['data' => 'required|string|max:4000000'])['data'];
        if (! preg_match('#^data:image/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$#', $data)) {
            return response()->json(['message' => 'Choose a PNG, JPG or WebP image.'], 422);
        }
        $s = CompanySetting::current();
        $s->{$which.'_data'} = $data;
        $s->save();

        return response()->json($s->toApi());
    }

    public function removeImage(string $which)
    {
        $s = CompanySetting::current();
        $s->{$which.'_data'} = null;
        $s->save();

        return response()->json($s->toApi());
    }
}
