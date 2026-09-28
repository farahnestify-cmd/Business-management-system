<?php

namespace Database\Seeders;

use App\Models\Base;
use App\Models\Client;
use App\Models\Cover;
use App\Models\Employee;
use App\Models\Expense;
use App\Models\Product;
use App\Models\Supplier;
use App\Models\Transaction;
use Illuminate\Database\Seeder;

/**
 * Sample records to try the system with: php artisan db:seed --class=DemoSeeder
 */
class DemoSeeder extends Seeder
{
    public function run(): void
    {
        $dealer = Client::create(['name' => 'Al-Quds Electric', 'type' => 'Dealer', 'region' => 'West Bank', 'discount_pct' => 0.05, 'phone' => '0599 000 111']);
        $home = Client::create(['name' => 'Rami Haddad', 'type' => 'End User', 'region' => 'West Bank', 'phone' => '0598 222 333']);
        Client::create(['name' => 'Galil Smart', 'type' => 'Partner', 'region' => '48 Region']);

        $lock = Product::create(['name' => 'Smart door lock', 'category' => 'Door Lock', 'dealer_price_wb' => 180, 'end_user_price_wb' => 240,
            'dealer_price_48' => 210, 'end_user_price_48' => 280, 'programming_fee' => 20, 'cost' => 120, 'stock_on_hand' => 12, 'reorder_threshold' => 4]);
        Product::create(['name' => 'DNAKE indoor monitor', 'category' => 'DNAKE', 'dealer_price_wb' => 150, 'end_user_price_wb' => 205,
            'dealer_price_48' => 170, 'end_user_price_48' => 230, 'programming_fee' => 15, 'cost' => 98, 'stock_on_hand' => 3, 'reorder_threshold' => 5]);

        $base = Base::create(['name' => '1-gang Zigbee switch', 'line' => 'Q', 'dealer_price_wb' => 28, 'end_user_price_wb' => 38,
            'dealer_price_48' => 32, 'end_user_price_48' => 44, 'programming_fee' => 5, 'cost' => 16, 'stock_on_hand' => 40, 'reorder_threshold' => 10]);
        $cover = Cover::create(['name' => 'Champagne Matte', 'line' => 'Q', 'color' => 'Champagne', 'finish' => 'Matte', 'price_add_on' => 6, 'cost' => 3, 'stock_on_hand' => 30, 'reorder_threshold' => 10]);
        Cover::create(['name' => 'Black Glossy', 'line' => 'Q', 'color' => 'Black', 'finish' => 'Glossy', 'price_add_on' => 4, 'cost' => 2.5, 'stock_on_hand' => 25, 'reorder_threshold' => 10]);

        Supplier::create(['name' => 'Shenzhen Smart Co.', 'contact' => 'Lily Wang', 'phone' => '+86 755 0000', 'country' => 'China']);
        Employee::create(['name' => 'Omar', 'role' => 'Installer', 'monthly_salary' => 900]);

        $yymm = now()->format('ym');
        $tx = Transaction::create([
            'ref_no' => $yymm.'WD01', 'yymm' => $yymm, 'region_code' => 'W', 'type_code' => 'D', 'seq' => 1,
            'client_id' => $home->id, 'client_name' => $home->name, 'client_type' => $home->type, 'region' => 'West Bank',
            'service_type' => 'With Programming', 'status' => 'Agreement', 'vat_pct' => 0,
            'quotation_date' => now()->subDays(6)->toDateString(), 'agreement_date' => now()->subDays(3)->toDateString(),
        ]);
        $tx->items()->create(['kind' => 'product', 'product_id' => $lock->id, 'name' => $lock->name, 'qty' => 2, 'standard_price' => 260, 'unit_price' => 260, 'cost_snapshot' => 120]);
        $tx->items()->create(['kind' => 'combo', 'base_id' => $base->id, 'cover_id' => $cover->id, 'name' => $base->name.' · '.$cover->name, 'qty' => 8, 'standard_price' => 49, 'unit_price' => 49, 'cost_snapshot' => 19]);
        $tx->payments()->create(['date' => now()->subDays(3)->toDateString(), 'amount' => 400, 'method' => 'Cash', 'type' => 'Down Payment']);

        $tx2 = Transaction::create([
            'ref_no' => $yymm.'WD02', 'yymm' => $yymm, 'region_code' => 'W', 'type_code' => 'D', 'seq' => 2,
            'client_id' => $dealer->id, 'client_name' => $dealer->name, 'client_type' => $dealer->type, 'region' => 'West Bank',
            'service_type' => 'Without Programming', 'status' => 'Quotation', 'vat_pct' => 0,
            'quotation_date' => now()->toDateString(),
        ]);
        $tx2->items()->create(['kind' => 'product', 'product_id' => $lock->id, 'name' => $lock->name, 'qty' => 5, 'standard_price' => 171, 'unit_price' => 171, 'cost_snapshot' => 120]);

        Expense::create(['date' => now()->toDateString(), 'category' => 'Rent', 'description' => 'Showroom rent', 'vendor' => 'Landlord', 'amount' => 600, 'payment_method' => 'Bank Transfer']);
    }
}
