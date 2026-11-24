<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Labour and services (installation, programming, site visits…) charged per
 * hour, visit, point… They go on offers like items but carry no stock.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('services', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('unit', 40)->default('hour');
            $table->decimal('rate', 12, 2)->default(0);
            $table->boolean('active')->default(true);
            $table->timestamps();
        });

        Schema::table('transaction_items', function (Blueprint $table) {
            $table->unsignedBigInteger('service_id')->nullable()->after('cover_id');
            $table->string('unit', 40)->nullable()->after('qty');
        });
    }

    public function down(): void
    {
        Schema::table('transaction_items', function (Blueprint $table) {
            $table->dropColumn(['service_id', 'unit']);
        });
        Schema::dropIfExists('services');
    }
};
