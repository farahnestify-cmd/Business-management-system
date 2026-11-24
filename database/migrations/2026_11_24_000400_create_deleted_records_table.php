<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Recently deleted: a copy of each removed record (and its child rows) so the
 * owner can put it back. Kept until restored or cleared on purpose.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('deleted_records', function (Blueprint $table) {
            $table->id();
            $table->string('kind', 40);
            $table->string('label');
            $table->longText('payload');
            $table->foreignId('deleted_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('deleted_records');
    }
};
