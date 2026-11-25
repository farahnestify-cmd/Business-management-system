<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="csrf-token" content="{{ csrf_token() }}">
<meta name="base-url" content="{{ url('/') }}">
<title>Nestify Desk</title>
<link rel="icon" href="{{ asset('favicon.svg') }}" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<link rel="stylesheet" href="{{ asset('assets/css/app.css') }}?v={{ filemtime(public_path('assets/css/app.css')) }}">
</head>
<body>
<div id="app">
  <aside id="rail">
    <div class="wordmark">
      <b id="brand-mark">Nestify</b>
      <span id="brand-sub">Operations</span>
    </div>
    <nav id="nav">
      <button class="nav-btn" data-view="today" aria-current="true">
        <svg viewBox="0 0 20 20"><path d="M3 11l3.5 0 2-5 3 10 2-5H17"/></svg><span class="label">Today</span><span class="nav-count" id="nav-count-today"></span>
      </button>
      <button class="nav-btn" data-view="sales">
        <svg viewBox="0 0 20 20"><path d="M5 2.5h7l3.5 3.5v11H5z"/><path d="M11.5 2.5v4h4"/><path d="M8 10.5h5M8 13.5h3.5"/></svg><span class="label">Sales</span><span class="nav-count" id="nav-count-sales"></span>
      </button>
      <button class="nav-btn" data-view="inventory">
        <svg viewBox="0 0 20 20"><path d="M3 6.5L10 3l7 3.5v7L10 17l-7-3.5z"/><path d="M3 6.5L10 10l7-3.5M10 10v7"/></svg><span class="label">Inventory</span><span class="nav-count" id="nav-count-inventory"></span>
      </button>
      <button class="nav-btn" data-view="contacts">
        <svg viewBox="0 0 20 20"><circle cx="7.5" cy="7" r="2.6"/><path d="M3 16c0-2.5 2-4.2 4.5-4.2S12 13.5 12 16"/><path d="M13 5.2a2.6 2.6 0 010 4.6M14.5 15.6c0-2 .8-3.2 2.5-3.6"/></svg><span class="label">Contacts</span><span class="nav-count" id="nav-count-contacts"></span>
      </button>
      <button class="nav-btn" data-view="money" data-need="owner">
        <svg viewBox="0 0 20 20"><path d="M3 6.5h14v9H3z"/><path d="M3 9.5h14"/><circle cx="13.5" cy="12.8" r="1.1"/></svg><span class="label">Money</span><span class="nav-count" id="nav-count-money"></span>
      </button>
      <button class="nav-btn" data-view="team" data-need="owner">
        <svg viewBox="0 0 20 20"><circle cx="10" cy="6.5" r="3"/><path d="M4.5 16.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/></svg><span class="label">Team</span><span class="nav-count" id="nav-count-team"></span>
      </button>
    </nav>
    <div class="rail-foot">
      <button type="button" data-view="settings" id="settings-link">Company settings</button>
      <button type="button" id="theme-toggle">Switch appearance</button>
      <div class="row"><span id="sync-dot"></span><span id="sync-label">Connecting</span></div>
      <div class="row"><span id="ref-hint" class="mono tiny"></span></div>
      <div class="row"><span id="who" class="tiny"></span></div>
      <form method="POST" action="{{ route('logout') }}">@csrf<button type="submit">Sign out</button></form>
    </div>
  </aside>

  <div id="content">
    <header id="topbar">
      <h1 id="view-title">Today</h1>
      <div id="search-wrap">
        <svg viewBox="0 0 20 20"><circle cx="9" cy="9" r="5.5"/><path d="M13.2 13.2L17 17"/></svg>
        <input id="search" type="text" placeholder="Search anything  ⌘K" autocomplete="off">
      </div>
      <button class="btn primary" id="primary-action" type="button">New offer</button>
    </header>

    <main>
      <!-- ============ TODAY ============ -->
      <section class="view" id="view-today">
        <div class="figures" id="today-figs"></div>
        <div class="split">
          <div class="section">
            <div class="section-head">
              <div><h2>Needs your attention</h2><p class="sub">Ranked by what costs you money first: unpaid balances, then stock, then admin.</p></div>
            </div>
            <div class="panel"><div class="queue" id="queue"></div></div>
          </div>
          <div class="section">
            <div class="section-head"><div><h2>This month</h2></div></div>
            <div class="panel">
              <div class="panel-pad" id="month-summary"></div>
            </div>
            <div class="panel">
              <div class="panel-head"><h3>Latest activity</h3></div>
              <div class="table-wrap"><table>
                <tbody id="today-activity"></tbody>
              </table></div>
            </div>
          </div>
        </div>
      </section>

      <!-- ============ SALES ============ -->
      <section class="view" id="view-sales" hidden>
        <div class="figures" id="sales-figs"></div>
        <div class="section">
          <div class="section-head">
            <div class="segmented" id="sales-filter">
              <button type="button" data-f="open" aria-pressed="true">Open</button>
              <button type="button" data-f="mine">Mine</button>
              <button type="button" data-f="fromsales">From sales</button>
              <button type="button" data-f="all">All</button>
              <button type="button" data-f="Quotation">Quotations</button>
              <button type="button" data-f="Agreement">Agreements</button>
              <button type="button" data-f="Invoiced">Invoiced</button>
              <button type="button" data-f="Delivered">Delivered</button>
              <button type="button" data-f="unpaid">Owes money</button>
              <button type="button" data-f="Cancelled">Cancelled</button>
            </div>
            <span class="tiny faint" id="sales-count"></span>
          </div>
          <div class="panel"><div class="table-wrap"><table>
            <thead><tr>
              <th>Reference</th><th>Client</th><th>Stage</th><th class="num">Total</th><th class="num">Balance</th><th>Age</th><th class="num c-cost">Margin</th>
            </tr></thead>
            <tbody id="sales-body"></tbody>
          </table></div></div>
        </div>
      </section>

      <!-- ============ INVENTORY ============ -->
      <section class="view" id="view-inventory" hidden>
        <div class="figures three" id="inv-figs"></div>
        <div class="segmented" id="inv-tabs">
          <button type="button" data-t="stock" aria-pressed="true">Stock</button>
          <button type="button" data-t="orders" data-need="owner">Purchase orders</button>
          <button type="button" data-t="suppliers" data-need="owner">Suppliers</button>
          <button type="button" data-t="deliver">To deliver</button>
          <button type="button" data-t="services">Services</button>
          <button type="button" data-t="sets">Offer sets</button>
        </div>

        <div id="inv-pane-stock">
          <div class="section">
            <div class="section-head">
              <div><h2>Finished products</h2><p class="sub">Sold as one piece — door locks, DNAKE units, WiFi switches, accessories.</p></div>
              <button class="btn sm" type="button" data-add="product" data-need="manager">Add product</button>
            </div>
            <div class="panel"><div class="table-wrap"><table>
              <thead><tr><th>Product</th><th>Category</th><th class="num c-cost">Cost</th><th class="num">On hand</th><th class="num">Reserved</th><th class="num">Incoming</th><th class="num">Available</th><th>Status</th></tr></thead>
              <tbody id="inv-products"></tbody>
            </table></div></div>
          </div>
          <div class="section" style="margin-top:26px">
            <div class="section-head">
              <div><h2>Bases</h2><p class="sub">The functional unit — unlasered, no finish. One base pairs with any cover in its line.</p></div>
              <button class="btn sm" type="button" data-add="base" data-need="manager">Add base</button>
            </div>
            <div class="panel"><div class="table-wrap"><table>
              <thead><tr><th>Base</th><th>Line</th><th class="num c-cost">Cost</th><th class="num">On hand</th><th class="num">Reserved</th><th class="num">Incoming</th><th class="num">Available</th><th>Status</th></tr></thead>
              <tbody id="inv-bases"></tbody>
            </table></div></div>
          </div>
          <div class="section" style="margin-top:26px">
            <div class="section-head">
              <div><h2>Covers</h2><p class="sub">Colour and finish faceplates, counted separately from the bases they clip onto.</p></div>
              <button class="btn sm" type="button" data-add="cover" data-need="manager">Add cover</button>
            </div>
            <div class="panel"><div class="table-wrap"><table>
              <thead><tr><th>Cover</th><th>Line</th><th>Finish</th><th class="num">Add-on</th><th class="num c-cost">Cost</th><th class="num">On hand</th><th class="num">Reserved</th><th class="num">Available</th><th>Status</th></tr></thead>
              <tbody id="inv-covers"></tbody>
            </table></div></div>
          </div>
        </div>

        <div id="inv-pane-orders" hidden>
          <div class="section">
            <div class="section-head">
              <div><h2>Purchase orders</h2><p class="sub">What you have ordered from suppliers. Receiving an order adds the stock and books the cost in one step.</p></div>
              <button class="btn sm primary" type="button" id="po-new">New purchase order</button>
            </div>
            <div class="panel"><div class="table-wrap"><table>
              <thead><tr><th>Order</th><th>Supplier</th><th>Stage</th><th>Ordered</th><th>Expected</th><th class="num">Items</th><th class="num">Cost</th></tr></thead>
              <tbody id="po-body"></tbody>
            </table></div></div>
          </div>
        </div>

        <div id="inv-pane-services" hidden>
          <div class="section">
            <div class="section-head">
              <div><h2>Labour and services</h2><p class="sub">Installation, programming, site visits… charged per hour, visit or point. They go on offers like items but carry no stock and no cost of goods.</p></div>
              <button class="btn sm" type="button" data-add="service" data-need="manager">Add service</button>
            </div>
            <div class="panel"><div class="table-wrap"><table>
              <thead><tr><th>Service</th><th>Charged per</th><th class="num">Rate</th><th class="num">On deals</th><th>Status</th></tr></thead>
              <tbody id="svc-body"></tbody>
            </table></div></div>
          </div>
        </div>

        <div id="inv-pane-sets" hidden>
          <div class="section">
            <div class="section-head">
              <div><h2>Offer sets</h2><p class="sub">The rows you start an offer from — the usual switches, a partner's usual order. Save one from any offer with “Save as a set”; pick it from “Start from a set…” on the next.</p></div>
            </div>
            <div class="panel"><div class="table-wrap"><table>
              <thead><tr><th>Set</th><th class="num">Rows</th><th>What is in it</th><th class="num">Used</th></tr></thead>
              <tbody id="sets-body"></tbody>
            </table></div></div>
          </div>
        </div>

        <div id="inv-pane-deliver" hidden>
          <div class="section">
            <div class="section-head">
              <div><h2>To deliver</h2><p class="sub">Invoiced items not handed over yet. Open a deal and press Deliver once the stock is in — whatever is on the shelf goes out, the rest stays here.</p></div>
            </div>
            <div class="panel"><div class="table-wrap"><table>
              <thead><tr><th>Deal</th><th>Client</th><th>Item</th><th class="num">Ordered</th><th class="num">Delivered</th><th class="num">Still to deliver</th><th>Status</th></tr></thead>
              <tbody id="deliver-body"></tbody>
            </table></div></div>
          </div>
        </div>

        <div id="inv-pane-suppliers" hidden>
          <div class="section">
            <div class="section-head">
              <div><h2>Suppliers</h2><p class="sub">Who you buy from, and what you have spent with each.</p></div>
              <button class="btn sm" type="button" data-add="supplier">Add supplier</button>
            </div>
            <div class="panel"><div class="table-wrap"><table>
              <thead><tr><th>Supplier</th><th>Contact</th><th>Phone</th><th class="num">Orders</th><th class="num">Spent</th></tr></thead>
              <tbody id="sup-body"></tbody>
            </table></div></div>
          </div>
        </div>
      </section>

      <!-- ============ CONTACTS ============ -->
      <section class="view" id="view-contacts" hidden>
        <div class="figures three" id="contacts-figs"></div>
        <div class="section">
          <div class="section-head">
            <div class="segmented" id="contacts-filter">
              <button type="button" data-f="all" aria-pressed="true">Everyone</button>
              <button type="button" data-f="Dealer">Dealers</button>
              <button type="button" data-f="Partner">Partners</button>
              <button type="button" data-f="End User">End users</button>
              <button type="button" data-f="owing">Owing</button>
            </div>
            <button class="btn sm" type="button" data-add="client">Add contact</button>
          </div>
          <div class="panel"><div class="table-wrap"><table>
            <thead><tr><th>Name</th><th>Type</th><th>Region</th><th class="num">Discount</th><th class="num">Deals</th><th class="num">Billed</th><th class="num">Outstanding</th><th>Last activity</th></tr></thead>
            <tbody id="contacts-body"></tbody>
          </table></div></div>
        </div>
        <div class="section">
          <div class="section-head">
            <div><p class="eyebrow">Price tiers</p><p class="tiny muted">Channels such as Dealer Gold or Partner Silver: the price column a contact is quoted from and the discount that comes with it.</p></div>
            <button class="btn sm" type="button" data-add="tier" data-need="manager">Add tier</button>
          </div>
          <div class="panel"><div class="table-wrap"><table>
            <thead><tr><th>Tier</th><th>Priced from</th><th class="num">Channel discount</th><th class="num">Contacts</th><th class="num">Billed this year</th><th class="num">Yearly target</th></tr></thead>
            <tbody id="tiers-body"></tbody>
          </table></div></div>
        </div>
      </section>

      <!-- ============ MONEY ============ -->
      <section class="view" id="view-money" hidden>
        <div class="figures" id="money-figs"></div>
        <div class="segmented" id="money-tabs">
          <button type="button" data-t="pl" aria-pressed="true">Profit &amp; loss</button>
          <button type="button" data-t="expenses">Expenses</button>
          <button type="button" data-t="ledger">Cash ledger</button>
        </div>

        <div id="money-pane-pl">
          <div class="split">
            <div class="panel">
              <div class="panel-head"><h3>Net result by month</h3><span class="tiny faint">Sales less cost of goods, expenses and salaries</span></div>
              <div class="chart-wrap" id="net-chart"></div>
              <div class="chart-legend" id="net-legend"></div>
            </div>
            <div class="panel">
              <div class="panel-head"><h3>Where the money goes</h3><span class="tiny faint">This year</span></div>
              <div class="table-wrap"><table><tbody id="cost-split"></tbody></table></div>
            </div>
          </div>
          <div class="section" style="margin-top:22px">
            <div class="section-head">
              <div><h2>Monthly profit and loss</h2><p class="sub">Stock purchases are not counted as an expense here — they reach the accounts as cost of goods when the item is delivered, so nothing is counted twice.</p></div>
            </div>
            <div class="panel"><div class="table-wrap"><table>
              <thead><tr><th>Month</th><th class="num">Sales</th><th class="num">Cost of goods</th><th class="num">Gross margin</th><th class="num">Expenses</th><th class="num">Salaries</th><th class="num">Net</th><th class="num">Collected</th></tr></thead>
              <tbody id="pl-body"></tbody>
            </table></div></div>
          </div>
        </div>

        <div id="money-pane-expenses" hidden>
          <div class="section">
            <div class="section-head">
              <div><h2>Expenses</h2><p class="sub">Everything Nestify spends outside salaries. Stock purchases entered here still restock the item.</p></div>
              <button class="btn sm primary" type="button" data-add="expense">Add expense</button>
            </div>
            <div class="panel"><div class="table-wrap"><table>
              <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Paid to</th><th>Method</th><th class="num">Amount</th></tr></thead>
              <tbody id="exp-body"></tbody>
            </table></div></div>
          </div>
        </div>

        <div id="money-pane-ledger" hidden>
          <div class="section">
            <div class="section-head">
              <div><h2>Cash ledger</h2><p class="sub">Every movement in and out, newest first — client payments, expenses, purchase orders and salaries in one list.</p></div>
              <div class="segmented" id="ledger-filter">
                <button type="button" data-f="all" aria-pressed="true">All</button>
                <button type="button" data-f="in">In</button>
                <button type="button" data-f="out">Out</button>
              </div>
            </div>
            <div class="panel"><div class="table-wrap"><table>
              <thead><tr><th>Date</th><th>Movement</th><th>Reference</th><th>Method</th><th class="num">In</th><th class="num">Out</th></tr></thead>
              <tbody id="ledger-body"></tbody>
            </table></div></div>
          </div>
        </div>
      </section>

      <!-- ============ TEAM ============ -->
      <section class="view" id="view-team" hidden>
        <div class="figures three" id="team-figs"></div>
        <div class="section">
          <div class="section-head">
            <div><h2 id="payroll-title">Payroll</h2><p class="sub">Salary data is restricted to the owner by database rules — staff accounts see this page empty, whatever they do.</p></div>
            <button class="btn sm" type="button" data-add="employee">Add person</button>
          </div>
          <div class="panel"><div class="table-wrap"><table>
            <thead><tr><th>Person</th><th>Role</th><th class="num">Monthly</th><th>This month</th><th></th></tr></thead>
            <tbody id="payroll-body"></tbody>
          </table></div></div>
        </div>
        <div class="section">
          <div class="section-head"><div><h2>Payment history</h2></div></div>
          <div class="panel"><div class="table-wrap"><table>
            <thead><tr><th>Month</th><th>Person</th><th>Paid on</th><th class="num">Amount</th></tr></thead>
            <tbody id="payhist-body"></tbody>
          </table></div></div>
        </div>
      </section>

      <!-- ============ SETTINGS ============ -->
      <section class="view" id="view-settings" hidden>
        <div class="section" data-need="manager">
          <div class="section-head">
            <div><h2>Company</h2><p class="sub">These details head every quotation, agreement and invoice you print.</p></div>
          </div>
          <div class="panel panel-pad">
            <div class="grid g2">
              <div class="field"><label for="s-name">Trading name</label><input id="s-name" type="text" placeholder="Nestify"></div>
              <div class="field"><label for="s-tagline">Line under the name</label><input id="s-tagline" type="text" placeholder="Smart Home Systems"></div>
              <div class="field"><label for="s-phone">Phone</label><input id="s-phone" type="text"></div>
              <div class="field"><label for="s-email">Email</label><input id="s-email" type="text"></div>
              <div class="field"><label for="s-website">Website</label><input id="s-website" type="text"></div>
              <div class="field"><label for="s-address">Address</label><input id="s-address" type="text"></div>
              <div class="field"><label for="s-vat">VAT rate shown on documents (%)</label><input id="s-vat" type="number" step="0.1" min="0" class="mono"></div>
              <div class="field"><label for="s-validity">Quotation valid for (days)</label><input id="s-validity" type="number" step="1" min="1" class="mono"></div>
            </div>
          </div>
        </div>
        <div class="section" data-need="manager">
          <div class="section-head"><div><h2>The branded offer</h2><p class="sub">The white cover, the opening page (paragraph, notes and a picture) and the back page of the Full quotation. The Plain version uses none of this; the logo also heads every other document.</p></div></div>
          <div class="panel panel-pad">
            <div class="grid g2">
              <div class="field"><label>Logo</label><div class="brand-box" id="s-logo-box"></div></div>
              <div class="field"><label>Picture under the notes on page 2 (empty = the protocols picture)</label><div class="brand-box" id="s-hero-box"></div></div>
            </div>
            <input type="file" id="s-image-file" accept="image/png,image/jpeg,image/webp" hidden>
            <div class="grid" style="margin-top:14px">
              <div class="field"><label for="s-intro">Opening paragraph</label><textarea id="s-intro" rows="4" placeholder="Thank you for considering Nestify for your smart home…"></textarea></div>
              <div class="field"><label for="s-bullets">What the customer should know — one line each</label><textarea id="s-bullets" rows="5" placeholder="Prices include supply and programming&#10;Installation is scheduled after the deposit"></textarea></div>
              <div class="field"><label for="s-cover-note">Line at the foot of the cover</label><input id="s-cover-note" type="text" placeholder="welcome to smarter living."></div>
            </div>
            <p class="tiny muted" style="margin-top:10px">Text is saved with the Save settings button below; images are saved as soon as you choose them.</p>
          </div>
        </div>
        <div class="section" data-need="manager">
          <div class="section-head"><div><h2>Document wording</h2><p class="sub">Shown at the foot of each document type.</p></div></div>
          <div class="panel panel-pad">
            <div class="grid">
              <div class="field"><label for="s-terms-q">Quotation terms</label><textarea id="s-terms-q"></textarea></div>
              <div class="field"><label for="s-terms-a">Agreement terms</label><textarea id="s-terms-a"></textarea></div>
              <div class="field"><label for="s-terms-i">Invoice terms and payment details</label><textarea id="s-terms-i"></textarea></div>
            </div>
          </div>
        </div>
        <div class="section" data-need="manager">
          <div class="section-head">
            <div><h2>Currencies</h2><p class="sub">The books are kept in US dollars. Add the currencies you quote in and today's rate; each offer keeps the rate it was written at, and every report converts back to dollars.</p></div>
            <button class="btn sm" type="button" id="cur-add">Add currency</button>
          </div>
          <div class="panel"><div class="table-wrap"><table>
            <thead><tr><th>Code</th><th>Name</th><th>Symbol</th><th class="num">Units per $1</th><th class="num">Deals</th></tr></thead>
            <tbody id="cur-body"></tbody>
          </table></div></div>
        </div>
        <div class="section" data-need="manager">
          <div class="section-head"><div><h2>Thresholds</h2><p class="sub">When Today should start warning you.</p></div></div>
          <div class="panel panel-pad">
            <div class="grid g3">
              <div class="field"><label for="s-overdue">Invoice counts as overdue after (days)</label><input id="s-overdue" type="number" step="1" min="1" class="mono"></div>
              <div class="field"><label for="s-stale">Quotation goes stale after (days)</label><input id="s-stale" type="number" step="1" min="1" class="mono"></div>
              <div class="field"><label for="s-variance">Flag a price this far off the book ($)</label><input id="s-variance" type="number" step="1" min="0" class="mono"></div>
            </div>
            <div style="margin-top:18px; display:flex; gap:10px">
              <button class="btn primary" type="button" id="s-save">Save settings</button>
              <span class="tiny faint" id="s-saved" style="align-self:center"></span>
            </div>
          </div>
        </div>
        <div class="section" id="data-section" hidden>
          <div class="section-head"><div><h2>Your data</h2><p class="sub">Keep a copy somewhere safe — a USB stick or Google Drive. The backup holds every record, including Recently deleted; the spreadsheet is for reading and sharing.</p></div></div>
          <div class="panel panel-pad">
            <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center">
              <button class="btn primary" type="button" id="data-backup">Download a full backup</button>
              <button class="btn" type="button" id="data-xlsx">Download as a spreadsheet</button>
              <button class="btn danger" type="button" id="data-restore">Restore from a backup…</button>
              <input type="file" id="data-file" accept=".json,application/json" hidden>
            </div>
            <p class="tiny muted" style="margin-top:12px">Restoring replaces everything in the system with the file's contents. Accounts and passwords stay as they are, and a copy of the current data is kept on the server first.</p>
          </div>
        </div>
        <div class="section" id="trash-section" hidden>
          <div class="section-head">
            <div><h2>Recently deleted</h2><p class="sub">Anything removed waits here until you restore it or clear it on purpose.</p></div>
            <button class="btn sm danger" type="button" id="trash-empty">Clear all</button>
          </div>
          <div class="panel"><div class="table-wrap"><table>
            <thead><tr><th>Item</th><th>Kind</th><th>Removed</th><th></th></tr></thead>
            <tbody id="trash-body"></tbody>
          </table></div></div>
        </div>
        <div class="section" id="accounts-section" hidden>
          <div class="section-head">
            <div><h2>Accounts</h2><p class="sub">Who can sign in. Staff accounts use everything except payroll and company settings.</p></div>
            <button class="btn sm" type="button" id="acc-add">Add account</button>
          </div>
          <div class="panel"><div class="table-wrap"><table>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead>
            <tbody id="acc-body"></tbody>
          </table></div></div>
        </div>
        <div class="section">
          <div class="section-head"><div><h2>Your password</h2><p class="sub">At least eight characters.</p></div></div>
          <div class="panel panel-pad">
            <div class="grid g3">
              <div class="field"><label for="pw-current">Current password</label><input id="pw-current" type="password" autocomplete="current-password"></div>
              <div class="field"><label for="pw-new">New password</label><input id="pw-new" type="password" autocomplete="new-password"></div>
              <div class="field"><label>&nbsp;</label><button class="btn" type="button" id="pw-save">Change password</button></div>
            </div>
          </div>
        </div>
      </section>
    </main>
  </div>
</div>

<!-- ============ OVERLAYS ============ -->
<div class="overlay" id="composer" hidden>
  <div class="sheet">
    <div class="sheet-head">
      <h3 id="of-title">New price offer</h3>
      <div style="display:flex; gap:8px">
        <button class="btn quiet sm" type="button" id="of-cancel">Discard</button>
        <button class="btn primary sm" type="button" id="of-save">Save quotation</button>
      </div>
    </div>
    <div class="sheet-body">
      <div class="grid g5">
        <div class="field"><label for="of-client">Client</label><select id="of-client"></select></div>
        <div class="field"><label for="of-region">Region</label><select id="of-region"><option value="West Bank">West Bank</option><option value="48 Region">48 Region</option></select></div>
        <div class="field"><label for="of-date">Date</label><input id="of-date" type="date" class="mono"></div>
        <div class="field"><label for="of-cur">Quote in</label><div style="display:flex; gap:6px"><select id="of-cur" style="flex:1"></select>
          <input id="of-rate" type="number" step="0.0001" min="0" class="mono" style="width:96px" title="Units per $1 on this offer" hidden></div>
          <div class="tiny faint" id="of-rate-note" hidden></div></div>
        <div class="field"><label>Reference</label><div class="mono" id="of-ref" style="font-size:17px; padding-top:6px; letter-spacing:-0.02em">—</div></div>
      </div>
      <div class="grid g2">
        <div class="field"><label>Deal type</label><div class="choice" id="of-type">
          <label><input type="radio" name="oftype" value="Direct" checked><span>Direct project</span></label>
          <label><input type="radio" name="oftype" value="Partner"><span>Partner</span></label>
        </div></div>
        <div class="field"><label>Programming</label><div class="choice" id="of-service">
          <label><input type="radio" name="ofservice" value="With Programming" checked><span>Included</span></label>
          <label><input type="radio" name="ofservice" value="Without Programming"><span>Supply only</span></label>
        </div></div>
      </div>

      <div class="panel">
        <div class="panel-head"><h3>Items</h3>
          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap">
            <select id="of-set" style="max-width:220px; height:32px; padding:4px 8px; font-size:13px"></select>
            <button class="btn quiet sm" type="button" id="of-set-save">Save as a set</button>
            <button class="btn quiet sm" type="button" id="of-clear-empty">Remove empty rows</button>
            <button class="btn sm" type="button" id="of-add">Add line</button>
          </div></div>
        <div class="panel-pad" id="of-lines"></div>
        <div class="panel-pad" style="padding-top:0"><div class="totals" id="of-totals"></div></div>
      </div>

      <div class="panel">
        <div class="panel-head"><h3>Payment schedule</h3>
          <div style="display:flex; gap:8px">
            <button class="btn sm" type="button" id="of-ms-standard">Standard 40 / 50 / 10</button>
            <button class="btn sm" type="button" id="of-ms-add">Add stage</button>
          </div>
        </div>
        <div class="panel-pad" id="of-milestones"></div>
      </div>

      <div class="grid g3">
        <div class="field" id="of-paid-wrap"><label for="of-paid">Paid now</label><input id="of-paid" type="number" min="0" step="1" value="0" class="mono"></div>
        <div class="field" id="of-method-wrap"><label for="of-method">Method</label><select id="of-method"><option>Cash</option><option>Bank Transfer</option><option>Cheque</option></select></div>
        <div class="field"><label for="of-due">Balance due by</label><input id="of-due" type="date" class="mono"></div>
      </div>
      <div class="grid g3">
        <div class="field"><label for="of-disc-pick">Discount on the total</label>
          <div style="display:flex; gap:6px"><select id="of-disc-pick" style="flex:1"></select>
            <input id="of-disc" type="number" step="0.1" min="0" max="95" class="mono" style="width:84px" value="0" title="Discount (%)" aria-label="Discount (%)"></div>
          <div class="tiny faint" id="of-disc-note"></div></div>
        <div class="field"><label for="of-site">Site or project</label><input id="of-site" type="text" placeholder="Villa 12, Rawabi"></div>
        <div class="field"><label for="of-seller">Sold by</label><input id="of-seller" type="text" list="seller-list" placeholder="Who is handling this" autocomplete="off"><datalist id="seller-list"></datalist></div>
      </div>
      <div class="field"><label for="of-table-title">Heading over the items table (printed)</label><input id="of-table-title" type="text" placeholder="Curved tempered glass &amp; aluminium frame — Matte / Glossy finish"></div>
      <div class="field"><label for="of-notes">Notes on the offer</label><input id="of-notes" type="text" placeholder="Scope, floors covered, delivery expectations…"></div>
    </div>
  </div>
</div>

<div class="overlay" id="drawer-overlay" hidden>
  <div class="sheet drawer" id="drawer">
    <div class="sheet-head"><h3 id="drawer-title">Record</h3><button class="btn quiet sm" type="button" id="drawer-close">Close</button></div>
    <div class="sheet-body" id="drawer-body"></div>
  </div>
</div>

<div class="overlay" id="form-overlay" hidden>
  <div class="sheet">
    <div class="sheet-head"><h3 id="form-title">Edit</h3><button class="btn quiet sm" type="button" id="form-close">Close</button></div>
    <div class="sheet-body" id="form-body"></div>
    <div class="sheet-foot">
      <button class="btn danger" type="button" id="form-delete" hidden style="margin-right:auto">Delete</button>
      <button class="btn quiet" type="button" id="form-cancel">Cancel</button>
      <button class="btn primary" type="button" id="form-save">Save</button>
    </div>
  </div>
</div>

<div class="overlay" id="doc-overlay" hidden>
  <div class="sheet" id="doc-sheet">
    <div class="sheet-head">
      <h3 id="doc-title">Document</h3>
      <div style="display:flex; gap:8px; align-items:center">
        <div class="segmented" id="doc-style">
          <button type="button" data-t="brand" aria-pressed="true">Full</button>
          <button type="button" data-t="plain">Plain</button>
        </div>
        <button class="btn sm primary" type="button" id="doc-pdf">Download PDF</button>
        <button class="btn sm" type="button" id="doc-print">Print</button>
        <button class="btn quiet sm" type="button" id="doc-close">Close</button>
      </div>
    </div>
    <div class="sheet-body"><div id="doc"></div></div>
  </div>
</div>

<div class="overlay" id="palette" hidden>
  <div class="sheet">
    <input id="p-input" type="text" placeholder="Jump to a client, reference, product or order…" autocomplete="off">
    <div class="p-results" id="p-results"></div>
  </div>
</div>

<div id="tip" hidden></div>
<div id="toast" hidden></div>

<script src="{{ asset('assets/js/app.js') }}?v={{ filemtime(public_path('assets/js/app.js')) }}"></script>
</body>
</html>
