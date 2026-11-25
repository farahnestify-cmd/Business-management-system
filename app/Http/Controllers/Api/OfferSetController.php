<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\OfferSet;
use App\Support\RecycleBin;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Offer sets: rows saved once (the usual switches, a partner's usual order)
 * and dropped into any offer. Anyone who writes offers can keep them.
 */
class OfferSetController extends Controller
{
    public function store(Request $request)
    {
        $set = OfferSet::create($this->validated($request));

        return response()->json(['id' => (string) $set->id], 201);
    }

    public function update(Request $request, OfferSet $offerSet)
    {
        $offerSet->update($this->validated($request, $offerSet));

        return response()->json(['id' => (string) $offerSet->id]);
    }

    public function destroy(OfferSet $offerSet)
    {
        DB::transaction(fn () => RecycleBin::trash('offer_set', $offerSet, $offerSet->name));

        return response()->json(['ok' => true, 'undo' => RecycleBin::$lastUndo]);
    }

    private function validated(Request $request, ?OfferSet $existing = null): array
    {
        $data = $request->validate([
            'name' => 'required|string|max:255',
            'lines' => ($existing ? 'sometimes|' : '').'required|array|min:1|max:200',
            'lines.*.kind' => 'required|in:product,combo,service',
            'lines.*.productId' => 'nullable|integer',
            'lines.*.baseId' => 'nullable|integer',
            'lines.*.coverId' => 'nullable|integer',
            'lines.*.coverType' => 'nullable|string|max:20',
            'lines.*.serviceId' => 'nullable|integer',
            'lines.*.name' => 'nullable|string|max:255',
            'lines.*.unit' => 'nullable|string|max:40',
        ]);
        $out = ['name' => $data['name']];
        if (isset($data['lines'])) {
            // Only what identifies a row is kept: a set is the list, not the order.
            $out['lines'] = array_map(fn ($l) => array_filter([
                'kind' => $l['kind'], 'productId' => $l['productId'] ?? null, 'baseId' => $l['baseId'] ?? null,
                'coverId' => $l['coverId'] ?? null, 'coverType' => $l['coverType'] ?? null, 'serviceId' => $l['serviceId'] ?? null,
                'name' => $l['name'] ?? null, 'unit' => $l['unit'] ?? null,
            ], fn ($v) => $v !== null && $v !== ''), array_values($data['lines']));
        }

        return $out;
    }
}
