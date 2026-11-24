<?php

use App\Models\CompanySetting;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Gives the Full quotation's opening page and cover its wording where the
 * company has not written any yet. Text already written is left alone.
 */
return new class extends Migration
{
    public function up(): void
    {
        $fill = [
            'intro_text' => CompanySetting::INTRO,
            'offer_notes' => CompanySetting::NOTES,
            'cover_note' => 'welcome to smarter living.',
        ];
        foreach ($fill as $column => $text) {
            DB::table('company_settings')->where(fn ($q) => $q->whereNull($column)->orWhere($column, ''))->update([$column => $text]);
        }
    }

    public function down(): void
    {
        // Wording is the company's to keep.
    }
};
