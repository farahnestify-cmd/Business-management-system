<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('company_settings', function (Blueprint $table) {
            $table->id();
            $table->string('name')->default('Nestify');
            $table->string('tagline')->nullable();
            $table->string('phone')->nullable();
            $table->string('email')->nullable();
            $table->string('website')->nullable();
            $table->string('address')->nullable();
            $table->decimal('vat_pct', 6, 2)->default(0);
            $table->unsignedInteger('validity_days')->default(14);
            $table->unsignedInteger('overdue_days')->default(14);
            $table->unsignedInteger('stale_days')->default(21);
            $table->decimal('variance_flag', 12, 2)->default(15);
            $table->text('terms_quotation')->nullable();
            $table->text('terms_agreement')->nullable();
            $table->text('terms_invoice')->nullable();
            $table->timestamps();
        });

        Schema::create('clients', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('type', 20)->default('End User'); // End User | Dealer | Partner
            $table->string('region', 30)->default('West Bank'); // West Bank | 48 Region
            $table->decimal('discount_pct', 6, 4)->default(0); // fraction, 0.1 = 10%
            $table->string('phone')->nullable();
            $table->string('email')->nullable();
            $table->text('notes')->nullable();
            $table->timestamps();
        });

        // Finished products and bases share the same price book columns.
        foreach (['products', 'bases'] as $name) {
            Schema::create($name, function (Blueprint $table) use ($name) {
                $table->id();
                $table->string('name');
                if ($name === 'products') {
                    $table->string('category', 40)->default('Accessory');
                } else {
                    $table->string('line', 40)->nullable();
                }
                $table->decimal('dealer_price_wb', 12, 2)->default(0);
                $table->decimal('end_user_price_wb', 12, 2)->default(0);
                $table->decimal('dealer_price_48', 12, 2)->default(0);
                $table->decimal('end_user_price_48', 12, 2)->default(0);
                $table->decimal('programming_fee', 12, 2)->default(0);
                $table->decimal('cost', 12, 2)->default(0);
                $table->integer('stock_on_hand')->default(0);
                $table->integer('reorder_threshold')->default(5);
                $table->text('notes')->nullable();
                $table->timestamps();
            });
        }

        Schema::create('covers', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('line', 40)->nullable();
            $table->string('color')->nullable();
            $table->string('finish', 20)->default('Glossy');
            $table->decimal('price_add_on', 12, 2)->default(0);
            $table->decimal('cost', 12, 2)->default(0);
            $table->integer('stock_on_hand')->default(0);
            $table->integer('reorder_threshold')->default(5);
            $table->text('notes')->nullable();
            $table->timestamps();
        });

        Schema::create('transactions', function (Blueprint $table) {
            $table->id();
            $table->string('ref_no', 20)->unique();
            $table->string('yymm', 4)->index();
            $table->string('region_code', 1);
            $table->string('type_code', 1);
            $table->unsignedInteger('seq');
            $table->foreignId('client_id')->nullable()->constrained('clients')->nullOnDelete();
            $table->string('client_name');
            $table->string('client_type', 20);
            $table->string('region', 30);
            $table->string('service_type', 30);
            $table->string('status', 20)->default('Quotation')->index();
            $table->decimal('vat_pct', 6, 2)->default(0);
            $table->date('quotation_date')->nullable();
            $table->date('agreement_date')->nullable();
            $table->date('invoice_date')->nullable();
            $table->date('delivered_date')->nullable();
            $table->date('due_date')->nullable();
            $table->text('notes')->nullable();
            $table->timestamps();
            $table->unique(['yymm', 'seq']);
        });

        Schema::create('transaction_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('transaction_id')->constrained('transactions')->cascadeOnDelete();
            $table->string('kind', 10)->default('product'); // product | combo
            $table->unsignedBigInteger('product_id')->nullable();
            $table->unsignedBigInteger('base_id')->nullable();
            $table->unsignedBigInteger('cover_id')->nullable();
            $table->string('name');
            $table->integer('qty');
            $table->decimal('standard_price', 12, 2)->default(0);
            $table->decimal('unit_price', 12, 2)->default(0);
            $table->decimal('cost_snapshot', 12, 2)->default(0);
            $table->timestamps();
        });

        Schema::create('payments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('transaction_id')->constrained('transactions')->cascadeOnDelete();
            $table->date('date');
            $table->decimal('amount', 12, 2);
            $table->string('method', 30)->default('Cash');
            $table->string('type', 30)->default('Payment');
            $table->string('note')->nullable();
            $table->timestamps();
        });

        Schema::create('suppliers', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('contact')->nullable();
            $table->string('phone')->nullable();
            $table->string('email')->nullable();
            $table->string('country')->nullable();
            $table->text('notes')->nullable();
            $table->timestamps();
        });

        Schema::create('purchase_orders', function (Blueprint $table) {
            $table->id();
            $table->string('ref_no', 20)->unique();
            $table->foreignId('supplier_id')->nullable()->constrained('suppliers')->nullOnDelete();
            $table->string('supplier_name')->nullable();
            $table->string('status', 20)->default('Draft'); // Draft | Ordered | Received | Cancelled
            $table->date('ordered_date')->nullable();
            $table->date('expected_date')->nullable();
            $table->date('received_date')->nullable();
            $table->decimal('shipping', 12, 2)->default(0);
            $table->text('notes')->nullable();
            $table->timestamps();
        });

        Schema::create('purchase_order_lines', function (Blueprint $table) {
            $table->id();
            $table->foreignId('purchase_order_id')->constrained('purchase_orders')->cascadeOnDelete();
            $table->string('kind', 10); // product | base | cover
            $table->unsignedBigInteger('item_id');
            $table->string('name')->nullable();
            $table->integer('qty');
            $table->decimal('unit_cost', 12, 2)->default(0);
            $table->timestamps();
        });

        Schema::create('expenses', function (Blueprint $table) {
            $table->id();
            $table->date('date')->index();
            $table->string('category', 40)->default('Other');
            $table->string('description');
            $table->string('vendor')->nullable();
            $table->decimal('amount', 12, 2)->default(0);
            $table->string('payment_method', 30)->default('Cash');
            $table->unsignedBigInteger('linked_product_id')->nullable();
            $table->integer('qty_purchased')->default(0);
            $table->string('po_ref', 20)->nullable();
            $table->unsignedBigInteger('po_id')->nullable();
            $table->text('notes')->nullable();
            $table->timestamps();
        });

        Schema::create('employees', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('role')->nullable();
            $table->decimal('monthly_salary', 12, 2)->default(0);
            $table->boolean('active')->default(true);
            $table->text('notes')->nullable();
            $table->timestamps();
        });

        Schema::create('payroll_payments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('employee_id')->nullable()->constrained('employees')->nullOnDelete();
            $table->string('employee_name');
            $table->string('month', 4); // YYMM
            $table->decimal('amount', 12, 2);
            $table->date('paid_date')->nullable();
            $table->string('method', 30)->default('Cash');
            $table->text('notes')->nullable();
            $table->timestamps();
            $table->unique(['employee_id', 'month']);
        });
    }

    public function down(): void
    {
        foreach ([
            'payroll_payments', 'employees', 'expenses', 'purchase_order_lines', 'purchase_orders',
            'suppliers', 'payments', 'transaction_items', 'transactions', 'covers', 'bases',
            'products', 'clients', 'company_settings',
        ] as $table) {
            Schema::dropIfExists($table);
        }
    }
};
