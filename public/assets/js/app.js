(function(){
"use strict";

/* ============================================================
   1. STATE
   ============================================================ */
var DEFAULTS = {
  name:"Nestify", tagline:"Smart Home Systems", phone:"", email:"", website:"", address:"",
  vatPct:0, validityDays:14, overdueDays:14, staleDays:21, varianceFlag:15,
  termsQuotation:"All prices in USD. This quotation is valid for {validity} days from the date above. A down payment confirms the order and reserves the stock listed.",
  termsAgreement:"This agreement confirms the scope and prices listed above. The balance falls due on delivery unless a date is stated. Nestify remains the owner of the goods until payment is received in full.",
  termsInvoice:"Payment due on receipt. Please quote the reference number above with your transfer."
};

var state = {
  view:"today", tab:{inventory:"stock", money:"pl"},
  filters:{sales:"open", contacts:"all", ledger:"all"},
  clients:[], products:[], bases:[], covers:[], transactions:[], expenses:[],
  employees:[], payroll:[], suppliers:[], orders:[], users:[], user:null,
  settings:Object.assign({}, DEFAULTS),
  offer:{lines:[]}, ready:false, q:""
};

/* ============================================================
   2. SMALL HELPERS
   ============================================================ */
function $(id){ return document.getElementById(id); }
function el(tag, cls, html){ var n=document.createElement(tag); if(cls) n.className=cls; if(html!=null) n.innerHTML=html; return n; }
function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
function num(v){ var n=Number(v); return isFinite(n)?n:0; }
function money(v, dp){
  var n=num(v); var d=dp==null?2:dp;
  return (n<0?"−$":"$") + Math.abs(n).toLocaleString("en-US",{minimumFractionDigits:d, maximumFractionDigits:d});
}
function money0(v){ return money(v,0); }
function pct(v, dp){ return (num(v)*100).toFixed(dp==null?1:dp) + "%"; }
function todayISO(){ var d=new Date(); return new Date(d.getTime()-d.getTimezoneOffset()*6e4).toISOString().slice(0,10); }
function parseISO(s){ if(!s) return null; var p=String(s).slice(0,10).split("-"); if(p.length!==3) return null; var d=new Date(Number(p[0]),Number(p[1])-1,Number(p[2])); return isNaN(d)?null:d; }
function daysSince(iso){ var d=parseISO(iso); if(!d) return null; return Math.floor((new Date(todayISO()) - d)/864e5); }
function fmtDate(iso){ var d=parseISO(iso); if(!d) return "—";
  var m=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return d.getDate()+" "+m[d.getMonth()]+" "+d.getFullYear(); }
function monthKey(iso){ return iso ? String(iso).slice(0,7) : ""; }
function monthLabel(key){
  if(!key) return "—";
  var m=["January","February","March","April","May","June","July","August","September","October","November","December"];
  var p=key.split("-"); return m[Number(p[1])-1]+" "+p[0];
}
function monthShort(key){
  var m=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  var p=key.split("-"); return m[Number(p[1])-1]+" ’"+p[0].slice(2);
}
function addMonths(key, n){
  var p=key.split("-"), d=new Date(Number(p[0]), Number(p[1])-1+n, 1);
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");
}
function thisMonth(){ return todayISO().slice(0,7); }
function sortBy(arr, fn, desc){
  return arr.slice().sort(function(a,b){ var x=fn(a), y=fn(b); if(x===y) return 0; return (x<y ? -1 : 1) * (desc?-1:1); });
}
function sum(arr, fn){ return arr.reduce(function(s,x){ return s + num(fn(x)); },0); }

function toast(msg, bad){
  var t=$("toast"); t.textContent=msg; t.className = bad?"bad":""; t.hidden=false;
  clearTimeout(t._h); t._h=setTimeout(function(){ t.hidden=true; }, 3000);
}

/* Tooltip used by the chart */
function showTip(html, x, y){
  var t=$("tip"); t.innerHTML=html; t.hidden=false;
  var r=t.getBoundingClientRect();
  t.style.left = Math.max(8, Math.min(window.innerWidth-r.width-8, x - r.width/2)) + "px";
  t.style.top  = Math.max(8, y - r.height - 12) + "px";
}
function hideTip(){ $("tip").hidden=true; }

/* ============================================================
   3. REFERENCE NUMBERS  (YYMM + region + type + counter)
   ============================================================ */
function yymmOf(iso){ var d=parseISO(iso)||new Date(); return String(d.getFullYear()%100).padStart(2,"0") + String(d.getMonth()+1).padStart(2,"0"); }
function regionCode(r){ return r==="48 Region" ? "F" : "W"; }
function typeCode(t){ return t==="Partner" ? "P" : "D"; }
function buildRef(yymm, rc, tc, seq){ return yymm + rc + tc + String(seq).padStart(2,"0"); }
function agreementRef(ref){ return ref.slice(0,6) + "A" + ref.slice(6); }
function invoiceRef(ref){ return ref.slice(0,6) + "I" + ref.slice(6); }
function nextSeq(yymm){
  var used = state.transactions.filter(function(t){ return t.yymm===yymm; }).map(function(t){ return num(t.seq); });
  return (used.length ? Math.max.apply(null, used) : 0) + 1;
}
function nextPoRef(){
  var ym = yymmOf(todayISO());
  var used = state.orders.filter(function(o){ return (o.refNo||"").indexOf("PO"+ym)===0; })
    .map(function(o){ return num(String(o.refNo).slice(-2)); });
  return "PO" + ym + String((used.length?Math.max.apply(null,used):0)+1).padStart(2,"0");
}

/* ============================================================
   4. LOOKUPS, PRICING, COST
   ============================================================ */
function byId(list,id){ for(var i=0;i<list.length;i++){ if(list[i].id===id) return list[i]; } return null; }
function clientById(id){ return byId(state.clients,id); }
function productById(id){ return byId(state.products,id); }
function baseById(id){ return byId(state.bases,id); }
function coverById(id){ return byId(state.covers,id); }
function supplierById(id){ return byId(state.suppliers,id); }

/* Price book: dealer vs end user, per region, plus programming */
function standardUnitPrice(item, clientType, region, service){
  if(!item) return 0;
  var dealer = clientType==="Dealer";
  var base = region==="West Bank"
    ? (dealer ? item.dealerPriceWB : item.endUserPriceWB)
    : (dealer ? item.dealerPrice48 : item.endUserPrice48);
  return num(base) + (service==="With Programming" ? num(item.programmingFee) : 0);
}
function itemCost(item){ return item ? num(item.cost!=null ? item.cost : item.baseCost) : 0; }

function lineStandard(line, ctx){
  if(line.kind==="combo"){
    var b=baseById(line.baseId), c=coverById(line.coverId);
    if(!b) return 0;
    return standardUnitPrice(b, ctx.clientType, ctx.region, ctx.service) + (c ? num(c.priceAddOn) : 0);
  }
  return standardUnitPrice(productById(line.productId), ctx.clientType, ctx.region, ctx.service);
}
function lineCost(line){
  if(line.kind==="combo") return itemCost(baseById(line.baseId)) + itemCost(coverById(line.coverId));
  return itemCost(productById(line.productId));
}
function lineName(line){
  if(line.kind==="combo"){
    var b=baseById(line.baseId), c=coverById(line.coverId);
    if(!b) return "";
    return b.name + (c ? " · " + c.name : "");
  }
  var p=productById(line.productId);
  return p ? p.name : "";
}
function lineReady(line){ return line.kind==="combo" ? !!(line.baseId && line.coverId) : !!line.productId; }

/* ============================================================
   5. TRANSACTION MATHS
   ============================================================ */
function txSubtotal(tx){ return sum(tx.lineItems||[], function(li){ return num(li.qty)*num(li.unitPrice); }); }
function txVat(tx){ return txSubtotal(tx) * (num(tx.vatPct)/100); }
function txTotal(tx){ return txSubtotal(tx) + txVat(tx); }
function normalizedPayments(tx){
  if(tx.payments && tx.payments.length) return tx.payments.slice();
  var out=[];
  if(num(tx.downPayment)>0) out.push({date:tx.quotationDate||todayISO(), amount:num(tx.downPayment), method:"Cash", type:"Down Payment"});
  if(num(tx.otherPayments)>0) out.push({date:tx.agreementDate||tx.invoiceDate||tx.quotationDate||todayISO(), amount:num(tx.otherPayments), method:"Cash", type:"Balance Payment"});
  return out;
}
function txPaid(tx){ return sum(normalizedPayments(tx), function(p){ return p.amount; }); }
function txBalance(tx){ return txTotal(tx) - txPaid(tx); }
function txCOGS(tx){
  return sum(tx.lineItems||[], function(li){
    var unit = (li.costSnapshot!=null) ? num(li.costSnapshot) : lineCost(li);
    return num(li.qty) * unit;
  });
}
function txMargin(tx){ return txSubtotal(tx) - txCOGS(tx); }
function txHasCost(tx){ return txCOGS(tx) > 0; }
function payState(tx){
  var paid=txPaid(tx), bal=txBalance(tx);
  if(paid<=0) return "Unpaid";
  if(bal<=0.004) return "Paid";
  return "Partial";
}
function isLive(tx){ return tx.status!=="Cancelled"; }
/* Money to hand back: all of it on a cancelled deal, the overpaid part on a live one. */
function refundDue(tx){ return tx.status==="Cancelled" ? Math.max(0, txPaid(tx)) : Math.max(0, -txBalance(tx)); }
function isBilled(tx){ return tx.status==="Invoiced" || tx.status==="Delivered"; }
function txRecognisedDate(tx){ return tx.invoiceDate || tx.deliveredDate || tx.agreementDate || tx.quotationDate; }
function txAge(tx){ return daysSince(txRecognisedDate(tx)); }
function txDocDate(tx){ return tx.quotationDate || (tx.createdAt||"").slice(0,10); }

/* ============================================================
   6. STOCK
   ============================================================ */
function reservedFor(kind, id){
  var total=0;
  state.transactions.forEach(function(t){
    if(t.status!=="Agreement" && t.status!=="Invoiced") return;
    (t.lineItems||[]).forEach(function(li){
      if(kind==="product" && li.kind!=="combo" && li.productId===id) total+=num(li.qty);
      if(kind==="base" && li.kind==="combo" && li.baseId===id) total+=num(li.qty);
      if(kind==="cover" && li.kind==="combo" && li.coverId===id) total+=num(li.qty);
    });
  });
  return total;
}
function incomingFor(kind, id){
  var total=0;
  state.orders.forEach(function(o){
    if(o.status!=="Ordered") return;
    (o.lines||[]).forEach(function(l){ if(l.kind===kind && l.itemId===id) total+=num(l.qty); });
  });
  return total;
}
function availableOf(kind, item){ return num(item.stockOnHand) - reservedFor(kind, item.id); }
function isLow(kind, item){ return availableOf(kind,item) <= num(item.reorderThreshold); }
function stockValue(){
  return sum(state.products,function(p){ return num(p.stockOnHand)*itemCost(p); })
       + sum(state.bases,function(b){ return num(b.stockOnHand)*itemCost(b); })
       + sum(state.covers,function(c){ return num(c.stockOnHand)*itemCost(c); });
}
function allStockRows(){
  return state.products.map(function(p){ return {kind:"product", item:p, label:p.name}; })
    .concat(state.bases.map(function(b){ return {kind:"base", item:b, label:b.name+" · base"}; }))
    .concat(state.covers.map(function(c){ return {kind:"cover", item:c, label:c.name+" · cover"}; }));
}

/* ============================================================
   7. CONTACT ROLL-UPS
   ============================================================ */
function txForClient(id){ return state.transactions.filter(function(t){ return t.clientId===id && isLive(t); }); }
function clientStats(c){
  var rows=txForClient(c.id);
  return {
    deals: rows.length,
    billed: sum(rows, txTotal),
    paid: sum(rows, txPaid),
    outstanding: sum(rows, function(t){ return Math.max(0, txBalance(t)); }),
    last: rows.length ? sortBy(rows, function(t){ return txRecognisedDate(t)||""; }, true)[0] : null
  };
}
function supplierStats(s){
  var rows=state.orders.filter(function(o){ return o.supplierId===s.id && o.status!=="Cancelled"; });
  return { orders: rows.length, spent: sum(rows, poTotal) };
}
function poTotal(o){ return sum(o.lines||[], function(l){ return num(l.qty)*num(l.unitCost); }) + num(o.shipping); }
function poUnits(o){ return sum(o.lines||[], function(l){ return num(l.qty); }); }

/* ============================================================
   8. MONEY
   ============================================================ */
function operatingExpenses(list){ /* stock purchases reach the P&L as cost of goods instead */
  return list.filter(function(e){ return e.category!=="Inventory Purchase"; });
}
function ledgerRows(){
  var rows=[];
  /* Cancelled deals included: money received stays received until it is refunded. */
  state.transactions.forEach(function(t){
    normalizedPayments(t).forEach(function(p){
      var a=num(p.amount);
      rows.push({date:p.date, dir:a<0?"out":"in", label:(p.type||"Payment")+" — "+(t.clientName||""), ref:t.refNo, method:p.method||"", amount:Math.abs(a)});
    });
  });
  state.expenses.forEach(function(e){
    rows.push({date:e.date, dir:"out", label:(e.description||e.category||"Expense")+(e.vendor?" — "+e.vendor:""), ref:e.poRef||e.category||"", method:e.paymentMethod||"", amount:num(e.amount)});
  });
  state.payroll.forEach(function(p){
    rows.push({date:p.paidDate||(p.month?p.month+"-01":""), dir:"out", label:"Salary — "+(p.employeeName||""), ref:p.month||"", method:p.method||"", amount:num(p.amount)});
  });
  return sortBy(rows, function(r){ return r.date||""; }, true);
}
function monthKeys(n){
  var keys=[], k=thisMonth();
  for(var i=n-1;i>=0;i--) keys.push(addMonths(k,-i));
  return keys;
}
function payrollMonthKey(p){
  var m=String(p.month||"");
  if(m.length===4) return "20"+m.slice(0,2)+"-"+m.slice(2);
  return monthKey(p.paidDate);
}
function collectedInMonth(key){
  var total=0;
  state.transactions.forEach(function(t){
    normalizedPayments(t).forEach(function(p){ if(monthKey(p.date)===key) total+=num(p.amount); });
  });
  return total;
}
function plForMonth(key){
  var billed = state.transactions.filter(function(t){ return isLive(t) && isBilled(t) && monthKey(txRecognisedDate(t))===key; });
  var sales = sum(billed, txTotal);
  var cogs = sum(billed, txCOGS);
  var exp = sum(operatingExpenses(state.expenses).filter(function(e){ return monthKey(e.date)===key; }), function(e){ return e.amount; });
  var pay = sum(state.payroll.filter(function(p){ return payrollMonthKey(p)===key; }), function(p){ return p.amount; });
  return { key:key, sales:sales, cogs:cogs, gross:sales-cogs, expenses:exp, payroll:pay,
           net:sales-cogs-exp-pay, collected:collectedInMonth(key), deals:billed.length };
}
function outstandingTotal(){
  return sum(state.transactions.filter(isLive), function(t){ return Math.max(0, txBalance(t)); });
}

/* ============================================================
   9. SERVER (Laravel JSON API, session cookie + CSRF token)
   ============================================================ */
var BASE = (document.querySelector('meta[name="base-url"]')||{}).content || "";
BASE = BASE.replace(/\/$/, "");
var CSRF = (document.querySelector('meta[name="csrf-token"]')||{}).content || "";
var loading = null;

function setSync(ok, label){
  $("sync-dot").className = ok ? "" : "off";
  $("sync-label").textContent = label || (ok ? "Saved live" : "Offline — changes are not saved");
}
function api(method, path, body){
  return fetch(BASE + "/api/" + path, {
    method:method, credentials:"same-origin",
    headers:{"Accept":"application/json", "Content-Type":"application/json", "X-CSRF-TOKEN":CSRF, "X-Requested-With":"XMLHttpRequest"},
    body: body==null ? undefined : JSON.stringify(body)
  }).then(function(r){
    if(r.status===401 || r.status===419){ location.href = BASE + "/login"; throw new Error("Signed out"); }
    return r.json().catch(function(){ return {}; }).then(function(j){
      if(!r.ok){
        var msg = j.message || "Could not save";
        if(j.errors){ var k=Object.keys(j.errors)[0]; if(k && j.errors[k][0]) msg=j.errors[k][0]; }
        var err = new Error(msg); err.status = r.status; throw err;
      }
      return j;
    });
  });
}
/* Pull every record from the server and redraw. */
function reload(){
  if(loading) return loading;
  loading = api("GET", "bootstrap").then(function(d){
    ["clients","products","bases","covers","transactions","expenses","employees","payroll","suppliers","orders","users"].forEach(function(k){
      state[k] = d[k] || [];
    });
    state.user = d.user;
    state.settings = Object.assign({}, DEFAULTS, d.settings || {});
    state.ready = true;
    setSync(true);
    applyBrand(); render();
  }).catch(function(e){
    if(e.message!=="Signed out") setSync(false, "Offline — retrying");
  }).then(function(){ loading = null; });
  return loading;
}
function startDb(){
  reload();
  /* Other people's changes appear within half a minute. */
  setInterval(function(){ if(!document.hidden && $("form-overlay").hidden && $("composer").hidden) reload(); }, 30000);
  document.addEventListener("visibilitychange", function(){ if(!document.hidden) reload(); });
}
/* Run a write, refresh the data, then continue. */
var sending=false;
function send(method, path, body, done, okMsg){
  /* Ignore a second click while the first is still on its way. */
  if(sending) return Promise.resolve();
  sending=true; document.body.style.cursor="progress";
  document.querySelectorAll("#drawer-body button, #form-overlay .sheet-foot button").forEach(function(b){ b.disabled=true; });
  return api(method, path, body).then(function(res){
    return reload().then(function(){ if(okMsg) toast(okMsg); if(done) done(res); });
  }).catch(function(e){
    if(e.message!=="Signed out") toast(e.message || "Could not save", true);
  }).then(function(){
    sending=false; document.body.style.cursor="";
    document.querySelectorAll("#drawer-body button, #form-overlay .sheet-foot button").forEach(function(b){ b.disabled=false; });
  });
}
function save(collection, id, data, done){
  send(id ? "PUT" : "POST", collection + (id ? "/" + id : ""), data, done);
}
function remove(collection, id, what, done){
  if(!window.confirm("Delete " + (what || "this record") + "? This cannot be undone.")) return;
  send("DELETE", collection + "/" + id, null, function(){ closeForm(); if(done) done(); }, "Deleted");
}
function isOwner(){ return !!(state.user && state.user.role==="owner"); }

/* ============================================================
   10. NAVIGATION
   ============================================================ */
var VIEWS = {
  today:{title:"Today", action:{label:"New offer", fn:openComposer}},
  sales:{title:"Sales", action:{label:"New offer", fn:openComposer}},
  inventory:{title:"Inventory", action:{label:"Add product", fn:function(){ editStock("product", null); }}},
  contacts:{title:"Contacts", action:{label:"Add contact", fn:function(){ editClient(null); }}},
  money:{title:"Money", action:{label:"Add expense", fn:function(){ editExpense(null); }}},
  team:{title:"Team", action:{label:"Add person", fn:function(){ editEmployee(null); }}},
  settings:{title:"Company settings", action:null}
};
function setView(name){
  state.view = name;
  document.querySelectorAll(".view").forEach(function(v){ v.hidden = (v.id !== "view-"+name); });
  document.querySelectorAll(".nav-btn").forEach(function(b){ b.setAttribute("aria-current", String(b.dataset.view===name)); });
  var cfg = VIEWS[name] || VIEWS.today;
  $("view-title").textContent = cfg.title;
  var pa = $("primary-action");
  if(cfg.action){ pa.hidden=false; pa.textContent=cfg.action.label; pa.onclick=cfg.action.fn; } else { pa.hidden=true; }
  if(name==="inventory") syncInventoryAction();
  window.scrollTo(0,0);
  render();
}
function syncInventoryAction(){
  var pa=$("primary-action");
  if(state.tab.inventory==="orders"){ pa.textContent="New purchase order"; pa.onclick=function(){ editOrder(null); }; }
  else if(state.tab.inventory==="suppliers"){ pa.textContent="Add supplier"; pa.onclick=function(){ editSupplier(null); }; }
  else { pa.textContent="Add product"; pa.onclick=function(){ editStock("product", null); }; }
}
document.querySelectorAll(".nav-btn").forEach(function(b){
  b.addEventListener("click", function(){ setView(b.dataset.view); });
});
$("settings-link").addEventListener("click", function(){ setView("settings"); });

$("theme-toggle").addEventListener("click", function(){
  var root=document.documentElement;
  var now = root.getAttribute("data-theme");
  var next = now==="dark" ? "light" : (now==="light" ? "dark" : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "light" : "dark"));
  root.setAttribute("data-theme", next);
});

/* Segmented controls */
function wireSegmented(id, onPick){
  var wrap=$(id); if(!wrap) return;
  wrap.addEventListener("click", function(e){
    var b=e.target.closest("button"); if(!b) return;
    wrap.querySelectorAll("button").forEach(function(x){ x.setAttribute("aria-pressed", String(x===b)); });
    onPick(b.dataset.f || b.dataset.t);
  });
}
wireSegmented("sales-filter", function(v){ state.filters.sales=v; renderSales(); });
wireSegmented("contacts-filter", function(v){ state.filters.contacts=v; renderContacts(); });
wireSegmented("ledger-filter", function(v){ state.filters.ledger=v; renderLedger(); });
wireSegmented("inv-tabs", function(v){
  state.tab.inventory=v;
  $("inv-pane-stock").hidden = v!=="stock";
  $("inv-pane-orders").hidden = v!=="orders";
  $("inv-pane-suppliers").hidden = v!=="suppliers";
  syncInventoryAction(); renderInventory();
});
wireSegmented("money-tabs", function(v){
  state.tab.money=v;
  $("money-pane-pl").hidden = v!=="pl";
  $("money-pane-expenses").hidden = v!=="expenses";
  $("money-pane-ledger").hidden = v!=="ledger";
  renderMoney();
});

/* ============================================================
   11. GENERIC FORM SHEET
   ============================================================ */
var formSave=null;
function fieldHtml(f){
  var v = f.value==null ? "" : f.value;
  var inner;
  if(f.type==="select"){
    inner = '<select id="'+f.id+'">' + (f.options||[]).map(function(o){
      var val = typeof o==="string" ? o : o.value, lab = typeof o==="string" ? o : o.label;
      return '<option value="'+esc(val)+'"'+(String(val)===String(v)?" selected":"")+'>'+esc(lab)+'</option>';
    }).join("") + '</select>';
  } else if(f.type==="textarea"){
    inner = '<textarea id="'+f.id+'">'+esc(v)+'</textarea>';
  } else {
    inner = '<input id="'+f.id+'" type="'+(f.type||"text")+'"'+(f.step?' step="'+f.step+'"':'')+(f.min!=null?' min="'+f.min+'"':'')+
            (f.type==="number"?' class="mono"':'')+' value="'+esc(v)+'"'+(f.placeholder?' placeholder="'+esc(f.placeholder)+'"':'')+'>';
  }
  return '<div class="field">' + (f.label?'<label for="'+f.id+'">'+esc(f.label)+'</label>':'') + inner + '</div>';
}
var formDelete=null;
function openForm(title, groups, onSave, onDelete){
  $("form-title").textContent = title;
  $("form-body").innerHTML = groups.map(function(g){
    if(g.heading) return '<p class="eyebrow" style="margin-top:4px">'+esc(g.heading)+'</p>';
    if(g.note) return '<p class="tiny muted">'+esc(g.note)+'</p>';
    var cols = g.fields.length>=3 ? "g3" : (g.fields.length===2 ? "g2" : "");
    return '<div class="grid '+cols+'">' + g.fields.map(fieldHtml).join("") + '</div>';
  }).join("");
  formSave = onSave;
  setFormDelete(onDelete);
  $("form-overlay").hidden = false;
  var first = $("form-body").querySelector("input,select,textarea"); if(first) first.focus();
}
function closeForm(){ $("form-overlay").hidden = true; formSave = null; setFormDelete(null); }
function setFormDelete(fn){ formDelete = fn || null; $("form-delete").hidden = !formDelete; }
$("form-delete").addEventListener("click", function(){ if(formDelete) formDelete(); });
function val(id){ var n=$(id); return n ? n.value.trim() : ""; }
function valNum(id){ return num(val(id)); }
$("form-close").addEventListener("click", closeForm);
$("form-cancel").addEventListener("click", closeForm);
$("form-save").addEventListener("click", function(){ if(formSave && formSave()!==false) closeForm(); });

/* Drawer */
function openDrawer(title, html){
  $("drawer-title").textContent = title;
  $("drawer-body").innerHTML = html;
  $("drawer-overlay").hidden = false;
}
function closeDrawer(){ $("drawer-overlay").hidden = true; }
$("drawer-close").addEventListener("click", closeDrawer);

[["drawer-overlay",closeDrawer],["form-overlay",closeForm],["composer",closeComposer],
 ["doc-overlay",function(){ $("doc-overlay").hidden=true; }],["palette",closePalette]].forEach(function(p){
  $(p[0]).addEventListener("click", function(e){ if(e.target===$(p[0])) p[1](); });
});
document.addEventListener("keydown", function(e){
  if(e.key==="Escape"){
    if(!$("palette").hidden) return closePalette();
    if(!$("doc-overlay").hidden) return ($("doc-overlay").hidden=true);
    if(!$("form-overlay").hidden) return closeForm();
    if(!$("drawer-overlay").hidden) return closeDrawer();
    if(!$("composer").hidden) return closeComposer();
  }
  if((e.metaKey||e.ctrlKey) && e.key.toLowerCase()==="k"){ e.preventDefault(); openPalette(); }
});

/* ============================================================
   12. SEARCH / COMMAND PALETTE
   ============================================================ */
function searchIndex(){
  var out=[];
  state.transactions.forEach(function(t){
    out.push({label:t.clientName||"—", meta:t.refNo, type:t.status, go:function(){ setView("sales"); openTx(t.id); }});
  });
  state.clients.forEach(function(c){
    out.push({label:c.name, meta:c.type+" · "+c.region, type:"Contact", go:function(){ setView("contacts"); openContact(c.id); }});
  });
  allStockRows().forEach(function(r){
    out.push({label:r.label, meta:money(itemCost(r.item))+" cost", type:"Stock", go:function(){ setView("inventory"); editStock(r.kind, r.item); }});
  });
  state.orders.forEach(function(o){
    out.push({label:o.supplierName||"Purchase order", meta:o.refNo, type:"Order", go:function(){ setView("inventory"); state.tab.inventory="orders"; editOrder(o); }});
  });
  state.suppliers.forEach(function(s){
    out.push({label:s.name, meta:"Supplier", type:"Supplier", go:function(){ setView("inventory"); editSupplier(s); }});
  });
  return out;
}
function runSearch(q){
  q = q.trim().toLowerCase();
  if(!q) return [];
  return searchIndex().filter(function(r){
    return (r.label+" "+r.meta+" "+r.type).toLowerCase().indexOf(q) >= 0;
  }).slice(0,40);
}
var paletteRows=[], paletteSel=0;
function openPalette(prefill){
  $("palette").hidden=false;
  var input=$("p-input");
  input.value = prefill || "";
  renderPalette(runSearch(input.value));
  input.focus(); input.select();
}
function closePalette(){ $("palette").hidden=true; }
function renderPalette(rows){
  paletteRows=rows; paletteSel=0;
  var box=$("p-results");
  if(!rows.length){
    box.innerHTML = '<div class="empty-block">'+($("p-input").value.trim() ? "Nothing matches that." : "Type to search clients, references, stock and orders.")+'</div>';
    return;
  }
  box.innerHTML = rows.map(function(r,i){
    return '<button class="p-item'+(i===0?" sel":"")+'" data-i="'+i+'" type="button"><span>'+esc(r.label)+'</span>'+
      '<span class="mono">'+esc(r.meta||"")+'</span><span class="type">'+esc(r.type||"")+'</span></button>';
  }).join("");
  box.querySelectorAll(".p-item").forEach(function(b){
    b.addEventListener("click", function(){ closePalette(); paletteRows[Number(b.dataset.i)].go(); });
  });
}
$("p-input").addEventListener("input", function(){ renderPalette(runSearch(this.value)); });
$("p-input").addEventListener("keydown", function(e){
  if(e.key==="ArrowDown"||e.key==="ArrowUp"){
    e.preventDefault();
    if(!paletteRows.length) return;
    paletteSel = (paletteSel + (e.key==="ArrowDown"?1:-1) + paletteRows.length) % paletteRows.length;
    $("p-results").querySelectorAll(".p-item").forEach(function(b,i){ b.classList.toggle("sel", i===paletteSel); });
    var sel=$("p-results").querySelector(".p-item.sel"); if(sel) sel.scrollIntoView({block:"nearest"});
  }
  if(e.key==="Enter" && paletteRows[paletteSel]){ closePalette(); paletteRows[paletteSel].go(); }
});
$("search").addEventListener("focus", function(){ openPalette(this.value); this.blur(); });

/* ============================================================
   13. BRAND
   ============================================================ */
function applyBrand(){
  var s=state.settings;
  $("brand-mark").textContent = s.name || "Nestify";
  $("brand-sub").textContent = "Operations";
  $("ref-hint").textContent = buildRef(yymmOf(todayISO()),"W","D", nextSeq(yymmOf(todayISO())));
  if(state.user) $("who").textContent = state.user.name + " · " + (state.user.role==="owner" ? "Owner" : "Staff");
}

/* ============================================================
   14. RENDER DISPATCH
   ============================================================ */
function figure(name, value, small){
  return '<div class="figure"><div class="v'+(small?" small":"")+'">'+value+'</div><div class="n">'+esc(name)+'</div></div>';
}
function stagePill(s){
  var m={Quotation:"neutral", Agreement:"accent", Invoiced:"info", Delivered:"good", Cancelled:"bad"};
  return '<span class="pill '+(m[s]||"neutral")+'">'+esc(s||"—")+'</span>';
}
function payPill(tx){
  if(refundDue(tx)>0.004) return '<span class="pill bad">Refund due</span>';
  if(!isLive(tx)) return '<span class="pill neutral">Closed</span>';
  var s=payState(tx), m={Paid:"good", Partial:"warn", Unpaid:"bad"};
  return '<span class="pill '+m[s]+'">'+s+'</span>';
}
function emptyRow(cols, msg){ return '<tr class="empty"><td colspan="'+cols+'">'+esc(msg)+'</td></tr>'; }

function render(){
  applyBrand();
  renderNavCounts();
  if(state.view==="today") renderToday();
  if(state.view==="sales") renderSales();
  if(state.view==="inventory") renderInventory();
  if(state.view==="contacts") renderContacts();
  if(state.view==="money") renderMoney();
  if(state.view==="team") renderTeam();
  if(state.view==="settings"){ renderSettings(); renderAccounts(); }
  if(!$("composer").hidden) renderComposer();
}
function renderNavCounts(){
  var q = buildQueue();
  var by = function(pred){ return q.filter(pred).length || ""; };
  $("nav-count-today").textContent = q.filter(function(i){ return i.sev==="bad"; }).length || "";
  $("nav-count-sales").textContent = by(function(i){ return i.area==="sales" && i.sev==="bad"; });
  $("nav-count-inventory").textContent = by(function(i){ return i.area==="inventory" && i.sev!=="info"; });
  $("nav-count-money").textContent = "";
  $("nav-count-contacts").textContent = "";
  $("nav-count-team").textContent = by(function(i){ return i.area==="team"; });
}

/* ============================================================
   15. TODAY
   ============================================================ */
function buildQueue(){
  var s=state.settings, items=[];

  state.transactions.filter(function(t){ return isLive(t) && isBilled(t) && txBalance(t) > 0.004; }).forEach(function(t){
    var age = txAge(t);
    if(age!=null && age > num(s.overdueDays)){
      items.push({sev:"bad", area:"sales", title:t.clientName+" owes "+money(txBalance(t)),
        detail:"Invoice "+invoiceRef(t.refNo)+" · "+age+" days old", value:money(txBalance(t)),
        go:function(){ setView("sales"); openTx(t.id); }});
    }
  });
  state.transactions.filter(function(t){ return refundDue(t)>0.004; }).forEach(function(t){
    items.push({sev:"bad", area:"sales", title:"Refund "+money(refundDue(t))+" to "+t.clientName,
      detail:t.refNo+(t.status==="Cancelled" ? " · cancelled after payment" : " · paid more than the total"), value:money(refundDue(t)),
      go:function(){ setView("sales"); openTx(t.id); }});
  });
  state.transactions.filter(function(t){ return t.status==="Agreement" && txBalance(t)>0.004; }).forEach(function(t){
    var age = daysSince(t.agreementDate);
    if(age!=null && age > num(s.overdueDays)){
      items.push({sev:"warn", area:"sales", title:t.clientName+" — agreement not yet invoiced",
        detail:"Signed "+age+" days ago · "+money(txBalance(t))+" outstanding", value:money(txBalance(t)),
        go:function(){ setView("sales"); openTx(t.id); }});
    }
  });
  state.transactions.filter(function(t){ return t.status==="Quotation"; }).forEach(function(t){
    var age = daysSince(txDocDate(t));
    if(age!=null && age > num(s.staleDays)){
      items.push({sev:"warn", area:"sales", title:"Quotation for "+t.clientName+" has gone quiet",
        detail:t.refNo+" · sent "+age+" days ago", value:money(txTotal(t)),
        go:function(){ setView("sales"); openTx(t.id); }});
    }
  });
  allStockRows().forEach(function(r){
    if(isLow(r.kind, r.item)){
      var inc = incomingFor(r.kind, r.item.id);
      items.push({sev: inc>0 ? "info" : "warn", area:"inventory",
        title:r.label+" is down to "+availableOf(r.kind,r.item),
        detail: inc>0 ? inc+" on the way" : "Reorder point is "+num(r.item.reorderThreshold),
        value:"", go:function(){ setView("inventory"); editStock(r.kind, r.item); }});
    }
  });
  state.orders.filter(function(o){ return o.status==="Ordered"; }).forEach(function(o){
    var late = o.expectedDate && daysSince(o.expectedDate) > 0;
    items.push({sev: late ? "warn" : "info", area:"inventory",
      title:(late?"Late from ":"On order from ")+(o.supplierName||"supplier"),
      detail:o.refNo+" · "+poUnits(o)+" units"+(o.expectedDate ? " · due "+fmtDate(o.expectedDate) : ""),
      value:money(poTotal(o)), go:function(){ setView("inventory"); state.tab.inventory="orders"; editOrder(o); }});
  });
  var mk = thisMonth().replace("-","").slice(2);
  state.employees.filter(function(e){ return e.active!==false; }).forEach(function(e){
    var paid = state.payroll.some(function(p){ return p.employeeId===e.id && p.month===mk; });
    if(!paid && new Date().getDate() >= 25){
      items.push({sev:"info", area:"team", title:"Salary due — "+e.name, detail:monthLabel(thisMonth()),
        value:money(e.monthlySalary), go:function(){ setView("team"); }});
    }
  });
  var noCost = allStockRows().filter(function(r){ return itemCost(r.item)<=0; });
  if(noCost.length){
    items.push({sev:"info", area:"inventory", title:noCost.length+" item"+(noCost.length>1?"s have":" has")+" no cost recorded",
      detail:"Margin stays blank until you add what you pay for them", value:"",
      go:function(){ setView("inventory"); }});
  }
  var order={bad:0, warn:1, info:2};
  return items.sort(function(a,b){ return order[a.sev]-order[b.sev]; });
}

function renderToday(){
  var mk=thisMonth(), pl=plForMonth(mk);
  $("today-figs").innerHTML =
    figure("Collected in "+monthShort(mk), money0(pl.collected)) +
    figure("Outstanding from clients", money0(outstandingTotal())) +
    figure("Stock at cost", money0(stockValue())) +
    figure("Net this month", money0(pl.net));

  var q=buildQueue();
  $("queue").innerHTML = q.length ? q.slice(0,14).map(function(it,i){
    return '<button class="q-item" type="button" data-q="'+i+'">'+
      '<span class="q-sev '+it.sev+'"></span>'+
      '<span class="q-main"><span class="t">'+esc(it.title)+'</span><span class="d">'+esc(it.detail)+'</span></span>'+
      '<span class="q-val">'+esc(it.value||"")+'</span></button>';
  }).join("") : '<div class="empty-block">Nothing needs you right now. Every invoice is paid, stock is above its reorder points and no orders are outstanding.</div>';
  $("queue").querySelectorAll("[data-q]").forEach(function(b){
    b.addEventListener("click", function(){ q[Number(b.dataset.q)].go(); });
  });

  $("month-summary").innerHTML =
    '<div style="display:flex; flex-direction:column; gap:11px">' +
    [["Sales invoiced", money(pl.sales)],
     ["Cost of goods", money(-pl.cogs)],
     ["Gross margin", money(pl.gross) + (pl.sales>0 ? '  <span class="faint tiny">'+pct(pl.gross/pl.sales,0)+'</span>' : "")],
     ["Expenses", money(-pl.expenses)],
     ["Salaries", money(-pl.payroll)]].map(function(r){
      return '<div style="display:flex; justify-content:space-between; align-items:baseline; font-size:13px">'+
        '<span class="muted">'+r[0]+'</span><span class="mono">'+r[1]+'</span></div>';
    }).join("") +
    '<div style="display:flex; justify-content:space-between; align-items:baseline; padding-top:11px; border-top:1px solid var(--line); font-weight:600">'+
      '<span>Net result</span><span class="mono" style="font-size:16px">'+money(pl.net)+'</span></div>' +
    '</div>';

  var acts=[];
  state.transactions.slice(0,10).forEach(function(t){
    acts.push({date:txRecognisedDate(t)||txDocDate(t), html:'<td>'+stagePill(t.status)+'</td><td>'+esc(t.clientName||"")+
      '<div class="tiny faint mono">'+esc(t.refNo)+'</div></td><td class="num">'+money(txTotal(t))+'</td>', go:function(){ setView("sales"); openTx(t.id); }});
  });
  state.expenses.slice(0,6).forEach(function(e){
    acts.push({date:e.date, html:'<td><span class="pill neutral">Expense</span></td><td>'+esc(e.description||e.category||"")+
      '<div class="tiny faint">'+esc(e.vendor||"")+'</div></td><td class="num">'+money(-num(e.amount))+'</td>', go:function(){ setView("money"); }});
  });
  acts = sortBy(acts, function(a){ return a.date||""; }, true).slice(0,7);
  $("today-activity").innerHTML = acts.length ? acts.map(function(a,i){
    return '<tr class="clickable" data-a="'+i+'">'+a.html+'</tr>';
  }).join("") : emptyRow(3,"Nothing has happened yet.");
  $("today-activity").querySelectorAll("[data-a]").forEach(function(r){
    r.addEventListener("click", function(){ acts[Number(r.dataset.a)].go(); });
  });
}

/* ============================================================
   16. SALES
   ============================================================ */
function salesRows(){
  var f=state.filters.sales, rows=state.transactions;
  if(f==="open") return rows.filter(function(t){ return isLive(t) && t.status!=="Delivered"; });
  if(f==="unpaid") return rows.filter(function(t){ return isLive(t) && txBalance(t)>0.004; });
  if(f==="all") return rows;
  return rows.filter(function(t){ return t.status===f; });
}
function renderSales(){
  var live=state.transactions.filter(isLive);
  var pipeline=live.filter(function(t){ return t.status==="Quotation" || t.status==="Agreement"; });
  var mk=thisMonth();
  var billedThis=live.filter(function(t){ return isBilled(t) && monthKey(txRecognisedDate(t))===mk; });
  var withCost=live.filter(txHasCost);
  var marginPct = sum(withCost,txSubtotal)>0 ? sum(withCost,txMargin)/sum(withCost,txSubtotal) : 0;

  $("sales-figs").innerHTML =
    figure("In the pipeline", money0(sum(pipeline,txTotal))) +
    figure("Invoiced in "+monthShort(mk), money0(sum(billedThis,txTotal))) +
    figure("Outstanding", money0(outstandingTotal())) +
    figure("Average margin", withCost.length ? pct(marginPct,0) : "—");

  var rows=salesRows();
  $("sales-count").textContent = rows.length + (rows.length===1?" deal":" deals");
  $("sales-body").innerHTML = rows.length ? rows.map(function(t){
    var bal=txBalance(t), age=txAge(t), overdue = bal>0.004 && isBilled(t) && age!=null && age>num(state.settings.overdueDays);
    var m = txHasCost(t) ? pct(txMargin(t)/(txSubtotal(t)||1),0) : '<span class="faint">—</span>';
    return '<tr class="clickable" data-tx="'+t.id+'">'+
      '<td class="mono">'+esc(t.refNo)+'<div class="tiny faint">'+fmtDate(txDocDate(t))+'</div></td>'+
      '<td class="strong">'+esc(t.clientName||"—")+'<div class="tiny faint">'+esc(t.region||"")+' · '+esc(t.clientType||"")+'</div></td>'+
      '<td>'+stagePill(t.status)+'</td>'+
      '<td class="num">'+money(txTotal(t))+'</td>'+
      '<td class="num">'+balanceCell(t)+'</td>'+
      '<td>'+(isLive(t) && bal>0.004 && age!=null ? '<span class="pill '+(overdue?"bad":"neutral")+'">'+age+'d</span>' : '<span class="faint tiny">—</span>')+'</td>'+
      '<td class="num">'+m+'</td>'+
    '</tr>';
  }).join("") : emptyRow(7,"No deals in this view.");
  $("sales-body").querySelectorAll("[data-tx]").forEach(function(r){
    r.addEventListener("click", function(){ openTx(r.dataset.tx); });
  });
}

function balanceCell(t){
  var due=refundDue(t), bal=txBalance(t);
  if(due>0.004) return '<span class="pill warn">refund '+money(due)+'</span>';
  if(!isLive(t)) return '<span class="faint">—</span>';
  return bal>0.004 ? money(bal) : '<span class="faint">settled</span>';
}

/* ---------- Transaction drawer ---------- */
function openTx(id){
  var t=byId(state.transactions,id); if(!t) return;
  var pays=normalizedPayments(t);
  var live=isLive(t), due=refundDue(t), owed=live ? Math.max(0, txBalance(t)) : 0;
  var next={Quotation:["Agreement","Cancelled"], Agreement:["Invoiced","Cancelled"], Invoiced:["Delivered","Cancelled"], Delivered:[], Cancelled:[]}[t.status]||[];
  var lines=(t.lineItems||[]).map(function(li){
    var unitCost = li.costSnapshot!=null ? num(li.costSnapshot) : lineCost(li);
    var lineMargin = num(li.qty)*(num(li.unitPrice)-unitCost);
    return '<tr><td>'+esc(li.name)+'</td><td class="num">'+num(li.qty)+'</td><td class="num">'+money(li.unitPrice)+'</td>'+
      '<td class="num">'+(unitCost>0 ? money(lineMargin) : '<span class="faint">—</span>')+'</td>'+
      '<td class="num">'+money(num(li.qty)*num(li.unitPrice))+'</td></tr>';
  }).join("");

  var html =
    '<div class="grid g3">'+
      '<div class="kv"><span class="k">Stage</span><span class="v">'+stagePill(t.status)+'</span></div>'+
      '<div class="kv"><span class="k">Payment</span><span class="v">'+payPill(t)+'</span></div>'+
      '<div class="kv"><span class="k">Programming</span><span class="v">'+esc(t.serviceType==="With Programming"?"Included":"Supply only")+'</span></div>'+
      '<div class="kv"><span class="k">Client</span><span class="v">'+esc(t.clientName||"")+'</span></div>'+
      '<div class="kv"><span class="k">Region</span><span class="v">'+esc(t.region||"")+'</span></div>'+
      '<div class="kv"><span class="k">Dated</span><span class="v">'+fmtDate(txDocDate(t))+'</span></div>'+
    '</div>'+
    '<div class="panel"><div class="table-wrap"><table>'+
      '<thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Margin</th><th class="num">Total</th></tr></thead>'+
      '<tbody>'+(lines||emptyRow(5,"No items"))+'</tbody></table></div></div>'+
    '<div class="totals">'+
      '<div class="r"><span class="l">Subtotal</span><span class="mono">'+money(txSubtotal(t))+'</span></div>'+
      (num(t.vatPct)>0 ? '<div class="r"><span class="l">VAT '+num(t.vatPct)+'%</span><span class="mono">'+money(txVat(t))+'</span></div>' : '')+
      '<div class="r"><span class="l">Paid</span><span class="mono">'+money(txPaid(t))+'</span></div>'+
      (txHasCost(t) ? '<div class="r"><span class="l">Margin</span><span class="mono">'+money(txMargin(t))+' · '+pct(txMargin(t)/(txSubtotal(t)||1),0)+'</span></div>' : '')+
      (due>0.004 ? '<div class="r grand"><span class="l">Refund due to client</span><span class="v">'+money(due)+'</span></div>'
        : (live ? '<div class="r grand"><span class="l">Balance</span><span class="v">'+money(Math.max(0,txBalance(t)))+'</span></div>' : ''))+
    '</div>'+
    '<div class="section"><p class="eyebrow">Payments</p><div class="panel"><div class="table-wrap"><table><tbody>'+
      (pays.length ? pays.map(function(p){
        return '<tr><td>'+fmtDate(p.date)+'</td><td>'+esc(p.type||"Payment")+'</td><td>'+esc(p.method||"")+'</td><td class="num">'+money(p.amount)+'</td>'+
          (isOwner() && p.id ? '<td style="width:1%"><button class="btn quiet sm" type="button" data-delpay="'+p.id+'" aria-label="Delete payment">×</button></td>' : '')+'</tr>';
      }).join("") : emptyRow(4,"Nothing received yet."))+
    '</tbody></table></div></div></div>'+
    (due>0.004 || owed>0.004 ?
    '<div class="grid g3">'+
      '<div class="field"><label for="tx-amt">'+(due>0.004 ? "Refund to client" : "Log a payment")+'</label><input id="tx-amt" type="number" min="0" step="0.01" value="'+(due>0.004 ? due : owed).toFixed(2)+'" class="mono"></div>'+
      '<div class="field"><label for="tx-meth">Method</label><select id="tx-meth"><option>Cash</option><option>Bank Transfer</option><option>Cheque</option></select></div>'+
      '<div class="field"><label>&nbsp;</label><button class="btn" type="button" id="tx-pay">'+(due>0.004 ? "Record refund" : "Record")+'</button></div>'+
    '</div>' : '')+
    '<div style="display:flex; gap:8px; flex-wrap:wrap; padding-top:4px">'+
      (t.status==="Quotation" ? '<button class="btn sm" type="button" id="tx-edit">Edit quotation</button>' : '')+
      next.map(function(a){ return '<button class="btn sm '+(a==="Cancelled"?"danger":"primary")+'" data-adv="'+a+'" type="button">'+(a==="Cancelled"?"Cancel deal":"Move to "+a)+'</button>'; }).join("")+
      '<button class="btn sm" type="button" data-doc="Quotation">Quotation</button>'+
      (t.agreementDate||isBilled(t) ? '<button class="btn sm" type="button" data-doc="Agreement">Agreement</button>' : '')+
      (isBilled(t) ? '<button class="btn sm" type="button" data-doc="Invoice">Invoice</button>' : '')+
      (t.status==="Delivered" ? '<button class="btn sm" type="button" data-doc="Delivery Note">Delivery note</button>' : '')+
      (txPaid(t)>0 ? '<button class="btn sm" type="button" data-doc="Receipt">Receipt</button>' : '')+
    '</div>'+
    (t.notes ? '<p class="tiny muted">'+esc(t.notes)+'</p>' : '');

  openDrawer(t.refNo + " · " + (t.clientName||""), html);
  $("drawer-body").querySelectorAll("[data-adv]").forEach(function(b){
    b.addEventListener("click", function(){ advance(t, b.dataset.adv); });
  });
  $("drawer-body").querySelectorAll("[data-doc]").forEach(function(b){
    b.addEventListener("click", function(){ openDoc(t, b.dataset.doc); });
  });
  if($("tx-pay")) $("tx-pay").addEventListener("click", function(){
    var amt=valNum("tx-amt");
    if(amt<=0){ toast("Enter an amount first", true); return; }
    if(due>0.004){
      if(amt>due+0.004){ toast("Only "+money(due)+" is owed back to the client", true); return; }
      send("POST", "transactions/"+t.id+"/refunds", {amount:amt, method:val("tx-meth"), date:todayISO()},
        function(){ closeDrawer(); }, "Refund recorded");
      return;
    }
    if(amt>owed+0.004){ toast("That is more than the "+money(owed)+" still owed", true); return; }
    send("POST", "transactions/"+t.id+"/payments", {amount:amt, method:val("tx-meth"), date:todayISO()},
      function(){ closeDrawer(); }, "Payment recorded");
  });
  $("drawer-body").querySelectorAll("[data-delpay]").forEach(function(b){
    b.addEventListener("click", function(){
      if(!window.confirm("Delete this payment? Use this only for a payment recorded by mistake.")) return;
      send("DELETE", "payments/"+b.dataset.delpay, null, function(){ openTx(t.id); }, "Payment deleted");
    });
  });
  if($("tx-edit")) $("tx-edit").addEventListener("click", function(){ closeDrawer(); openComposer(t); });
}
function advance(t, next){
  if(next==="Cancelled" && !window.confirm("Cancel "+t.refNo+"? The deal stays on record as cancelled."+
    (txPaid(t)>0.004 ? "\n\nThe client has paid "+money(txPaid(t))+". It stays in the cash ledger until you record the refund from this deal." : ""))) return;
  /* Moving to Delivered takes the goods out of stock on the server. */
  send("POST", "transactions/"+t.id+"/advance", {status:next},
    function(){ closeDrawer(); }, t.refNo+" is now "+next.toLowerCase());
}

/* ============================================================
   17. OFFER COMPOSER
   ============================================================ */
/* With a quotation, the composer edits it; without, it starts a new offer. */
function openComposer(tx){
  var editing = tx && tx.id ? tx : null;
  state.offer={editId: editing ? editing.id : null, ref: editing ? editing.refNo : "",
    lines: editing ? (editing.lineItems||[]).map(function(li){
      return {kind:li.kind, productId:li.productId||"", baseId:li.baseId||"", coverId:li.coverId||"", qty:num(li.qty), unitPrice:num(li.unitPrice), touched:true};
    }) : [{kind:"product", productId:"", baseId:"", coverId:"", qty:1, unitPrice:0, touched:false}]};
  $("of-title").textContent = editing ? "Edit quotation "+editing.refNo : "New price offer";
  $("of-save").textContent = editing ? "Save changes" : "Save quotation";
  $("of-paid-wrap").hidden = $("of-method-wrap").hidden = !!editing;
  $("of-date").value = editing ? txDocDate(editing) : todayISO();
  $("of-paid").value=0;
  $("of-notes").value = editing ? (editing.notes||"") : "";
  $("of-due").value = editing ? (editing.dueDate||"") : "";
  $("composer").hidden=false;
  renderComposer();
  if(editing){
    $("of-client").value=editing.clientId||"";
    $("of-region").value=editing.region||"West Bank";
    var ty=document.querySelector('input[name="oftype"][value="'+(editing.typeCode==="P"?"Partner":"Direct")+'"]'); if(ty) ty.checked=true;
    var sv=document.querySelector('input[name="ofservice"][value="'+editing.serviceType+'"]'); if(sv) sv.checked=true;
    renderComposer();
  }
}
function closeComposer(){ $("composer").hidden=true; }
$("of-cancel").addEventListener("click", closeComposer);
$("of-add").addEventListener("click", function(){
  state.offer.lines.push({kind:"product", productId:"", baseId:"", coverId:"", qty:1, unitPrice:0, touched:false});
  renderComposer();
});
["of-client","of-region","of-date"].forEach(function(id){ $(id).addEventListener("change", function(){
  if(id==="of-client"){
    var c=clientById($("of-client").value);
    if(c && c.region) $("of-region").value=c.region;
  }
  renderComposer();
}); });
$("of-type").addEventListener("change", renderComposer);
$("of-service").addEventListener("change", renderComposer);
$("of-paid").addEventListener("input", renderComposer);

function offerCtx(){
  var c=clientById($("of-client").value);
  var typeEl=document.querySelector('input[name="oftype"]:checked');
  var svcEl=document.querySelector('input[name="ofservice"]:checked');
  return {
    client:c, region:$("of-region").value, date:$("of-date").value||todayISO(),
    type: typeEl?typeEl.value:"Direct", service: svcEl?svcEl.value:"With Programming",
    clientType: c?c.type:"End User", discount: c?num(c.discountPct):0
  };
}
function renderComposer(){
  var ctx=offerCtx();
  var sel=$("of-client"), keep=sel.value;
  sel.innerHTML='<option value="">Choose a client</option>'+state.clients.map(function(c){
    return '<option value="'+c.id+'">'+esc(c.name)+' · '+esc(c.type)+'</option>';
  }).join("");
  if(keep) sel.value=keep;

  var ym=yymmOf(ctx.date);
  /* An edited quotation keeps its month and counter; only the region/type letters can change. */
  $("of-ref").textContent = state.offer.editId
    ? state.offer.ref.slice(0,4) + regionCode(ctx.region) + typeCode(ctx.type) + state.offer.ref.slice(6)
    : buildRef(ym, regionCode(ctx.region), typeCode(ctx.type), nextSeq(ym));

  var groups={};
  state.bases.forEach(function(b){ var k=b.line||"Other"; (groups[k]=groups[k]||[]).push(b); });

  $("of-lines").innerHTML = state.offer.lines.map(function(ln,i){
    var std=lineStandard(ln,ctx), suggested=std*(1-ctx.discount);
    if(!ln.touched) ln.unitPrice=Math.round(suggested*100)/100;
    var cost=lineCost(ln), lineTotal=num(ln.qty)*num(ln.unitPrice);
    var off=num(ln.unitPrice)-suggested;
    var marginTxt = cost>0 ? pct((num(ln.unitPrice)-cost)/(num(ln.unitPrice)||1),0) : "—";
    var itemVal = ln.kind==="combo" ? (ln.baseId?"b:"+ln.baseId:"") : (ln.productId?"p:"+ln.productId:"");
    var covers = ln.kind==="combo" && ln.baseId ? state.covers.filter(function(c){ var b=baseById(ln.baseId); return b && c.line===b.line; }) : [];
    return '<div class="li" data-i="'+i+'">'+
      '<div><div class="lbl">Item</div>'+
        '<select data-f="item">'+
          '<option value="">Choose…</option>'+
          (state.products.length ? '<optgroup label="Products">'+state.products.map(function(p){
            return '<option value="p:'+p.id+'"'+(itemVal==="p:"+p.id?" selected":"")+'>'+esc(p.name)+'</option>'; }).join("")+'</optgroup>' : '')+
          Object.keys(groups).sort().map(function(k){
            return '<optgroup label="'+esc(k)+' line — base + cover">'+groups[k].map(function(b){
              return '<option value="b:'+b.id+'"'+(itemVal==="b:"+b.id?" selected":"")+'>'+esc(b.name)+'</option>'; }).join("")+'</optgroup>';
          }).join("")+
        '</select>'+
        (ln.kind==="combo" ? '<select data-f="cover"><option value="">Choose colour and finish…</option>'+covers.map(function(c){
          return '<option value="'+c.id+'"'+(c.id===ln.coverId?" selected":"")+'>'+esc(c.name)+'</option>'; }).join("")+'</select>' : '')+
      '</div>'+
      '<div><div class="lbl">Qty</div><input data-f="qty" type="number" min="1" step="1" value="'+num(ln.qty)+'"></div>'+
      '<div><div class="lbl">Book price</div><div class="fixed">'+money(suggested)+'</div></div>'+
      '<div><div class="lbl">You charge</div><input data-f="price" type="number" step="0.01" value="'+num(ln.unitPrice).toFixed(2)+'"></div>'+
      '<div><div class="lbl">Line · margin</div><div class="fixed">'+money(lineTotal)+
        '<div class="tiny '+(Math.abs(off)>num(state.settings.varianceFlag)?"":"faint")+'" style="'+(Math.abs(off)>num(state.settings.varianceFlag)?"color:var(--warn)":"")+'">'+
          marginTxt+(Math.abs(off)>num(state.settings.varianceFlag) ? " · "+(off>0?"+":"")+money0(off)+" off book" : "")+'</div></div></div>'+
      '<div><div class="lbl">&nbsp;</div><button class="btn quiet sm" data-f="remove" type="button" aria-label="Remove line">×</button></div>'+
    '</div>';
  }).join("") || '<p class="tiny muted">No items yet — add the first line.</p>';

  $("of-lines").querySelectorAll(".li").forEach(function(row){
    var i=Number(row.dataset.i);
    row.querySelectorAll("[data-f]").forEach(function(inp){
      var f=inp.dataset.f;
      if(f==="remove"){ inp.addEventListener("click", function(){ state.offer.lines.splice(i,1); renderComposer(); }); return; }
      inp.addEventListener("input", function(){
        var L=state.offer.lines[i];
        if(f==="item"){
          var v=inp.value;
          if(v.indexOf("p:")===0){ L.kind="product"; L.productId=v.slice(2); L.baseId=""; L.coverId=""; }
          else if(v.indexOf("b:")===0){ L.kind="combo"; L.baseId=v.slice(2); L.productId=""; L.coverId=""; }
          else { L.kind="product"; L.productId=""; L.baseId=""; L.coverId=""; }
          L.touched=false;
        } else if(f==="cover"){ L.coverId=inp.value; L.touched=false; }
        else if(f==="price"){ L.touched=true; L.unitPrice=num(inp.value); }
        else if(f==="qty"){ L.qty=num(inp.value); }
        renderComposer();
      });
    });
  });

  var done=state.offer.lines.filter(lineReady);
  var subtotal=sum(done,function(l){ return num(l.qty)*num(l.unitPrice); });
  var cogs=sum(done,function(l){ return num(l.qty)*lineCost(l); });
  var vat=subtotal*(num(state.settings.vatPct)/100);
  var paid=state.offer.editId ? 0 : valNum("of-paid");
  $("of-totals").innerHTML =
    '<div class="r"><span class="l">Subtotal</span><span class="mono">'+money(subtotal)+'</span></div>'+
    (ctx.discount>0 ? '<div class="r"><span class="l">Client discount applied</span><span class="mono">'+pct(ctx.discount)+'</span></div>' : '')+
    (cogs>0 ? '<div class="r"><span class="l">Margin on this offer</span><span class="mono">'+money(subtotal-cogs)+' · '+pct((subtotal-cogs)/(subtotal||1),0)+'</span></div>' : '')+
    (vat>0 ? '<div class="r"><span class="l">VAT '+num(state.settings.vatPct)+'%</span><span class="mono">'+money(vat)+'</span></div>' : '')+
    '<div class="r grand"><span class="l">Total</span><span class="v">'+money(subtotal+vat)+'</span></div>'+
    (state.offer.editId ? '' : '<div class="r"><span class="l">Balance after payment now</span><span class="mono">'+money(subtotal+vat-paid)+'</span></div>');
}
$("of-save").addEventListener("click", function(){
  var ctx=offerCtx();
  if(!ctx.client){ toast("Choose a client first", true); return; }
  var done=state.offer.lines.filter(function(l){ return lineReady(l) && num(l.qty)>0; });
  if(!done.length){ toast("Add at least one item", true); return; }
  var editId=state.offer.editId;
  var paid=editId ? 0 : valNum("of-paid");
  var total=sum(done,function(l){ return num(l.qty)*num(l.unitPrice); })*(1+num(state.settings.vatPct)/100);
  if(paid>total+0.004){ toast("Paid now is more than the offer total of "+money(total), true); return; }
  var data={
    clientId:ctx.client.id, region:ctx.region, dealType:ctx.type, serviceType:ctx.service,
    date:ctx.date, dueDate:val("of-due") || null, notes:val("of-notes"),
    paid:paid, method:val("of-method"),
    lines:done.map(function(l){
      var base={kind:l.kind, qty:num(l.qty), standardPrice:lineStandard(l,ctx), unitPrice:num(l.unitPrice)};
      if(l.kind==="combo"){ base.baseId=l.baseId; base.coverId=l.coverId; } else { base.productId=l.productId; }
      return base;
    })
  };
  var btn=$("of-save"); btn.disabled=true;
  /* The server hands out the reference number, so two people saving at once never collide. */
  api(editId ? "PUT" : "POST", "transactions"+(editId ? "/"+editId : ""), data).then(function(res){
    return reload().then(function(){ toast((editId ? "Updated " : "Saved as ")+res.refNo); closeComposer(); setView("sales"); });
  }).catch(function(e){ toast(e.message || "Could not save", true); })
    .then(function(){ btn.disabled=false; });
});

/* ============================================================
   18. DOCUMENTS
   ============================================================ */
function openDoc(t, kind){
  var s=state.settings;
  var refMap={"Quotation":t.refNo, "Agreement":agreementRef(t.refNo), "Invoice":invoiceRef(t.refNo),
              "Delivery Note":invoiceRef(t.refNo), "Receipt":invoiceRef(t.refNo)};
  var dateMap={"Quotation":txDocDate(t), "Agreement":t.agreementDate, "Invoice":t.invoiceDate,
               "Delivery Note":t.deliveredDate, "Receipt":todayISO()};
  var client=clientById(t.clientId)||{};
  var showMoney = kind!=="Delivery Note";
  var terms = kind==="Quotation" ? s.termsQuotation : (kind==="Agreement" ? s.termsAgreement : s.termsInvoice);
  terms = String(terms||"").replace("{validity}", num(s.validityDays));

  var rows=(t.lineItems||[]).map(function(li){
    return '<tr><td>'+esc(li.name)+'</td><td class="num">'+num(li.qty)+'</td>'+
      (showMoney ? '<td class="num">'+money(li.unitPrice)+'</td><td class="num">'+money(num(li.qty)*num(li.unitPrice))+'</td>' : '')+
      '</tr>';
  }).join("");

  var pays=normalizedPayments(t);
  var totals = showMoney ?
    '<div class="d-tot">'+
      '<div class="r"><span>Subtotal</span><span>'+money(txSubtotal(t))+'</span></div>'+
      (num(t.vatPct)>0 ? '<div class="r"><span>VAT '+num(t.vatPct)+'%</span><span>'+money(txVat(t))+'</span></div>' : '')+
      '<div class="r g"><span>'+(kind==="Receipt"?"Invoice total":"Total")+'</span><span>'+money(txTotal(t))+'</span></div>'+
      (kind!=="Quotation" ? '<div class="r"><span>Paid to date</span><span>'+money(txPaid(t))+'</span></div>'+
        '<div class="r"><span>Balance due</span><span>'+money(txBalance(t))+'</span></div>' : '')+
    '</div>' : '';

  $("doc").innerHTML =
    '<div class="d-top">'+
      '<div class="d-mark"><b>'+esc(s.name||"Nestify")+'</b><span>'+esc(s.tagline||"")+'</span></div>'+
      '<div class="d-kind"><div class="k">'+esc(kind)+'</div><div class="r">'+esc(refMap[kind])+'</div>'+
        '<div class="dt">'+fmtDate(dateMap[kind]||todayISO())+'</div></div>'+
    '</div>'+
    '<div class="d-meta">'+
      '<div><div class="k">Prepared for</div><div class="v">'+esc(t.clientName||"")+(client.phone?'<br>'+esc(client.phone):"")+'</div></div>'+
      '<div><div class="k">Region</div><div class="v">'+esc(t.region||"")+'</div></div>'+
      '<div><div class="k">Scope</div><div class="v">'+esc(t.serviceType==="With Programming"?"Supply and programming":"Supply only")+'</div></div>'+
      '<div><div class="k">'+(kind==="Quotation"?"Valid until":"Reference")+'</div><div class="v">'+
        (kind==="Quotation" ? fmtDate(addDays(txDocDate(t), num(s.validityDays))) : esc(t.refNo))+'</div></div>'+
    '</div>'+
    '<table><thead><tr><th>Item</th><th class="num">Qty</th>'+(showMoney?'<th class="num">Unit</th><th class="num">Amount</th>':'')+'</tr></thead>'+
      '<tbody>'+rows+'</tbody></table>'+
    totals+
    (kind==="Receipt" && pays.length ?
      '<table style="margin-top:22px"><thead><tr><th>Received on</th><th>Method</th><th class="num">Amount</th></tr></thead><tbody>'+
      pays.map(function(p){ return '<tr><td>'+fmtDate(p.date)+'</td><td>'+esc(p.method||"")+'</td><td class="num">'+money(p.amount)+'</td></tr>'; }).join("")+
      '</tbody></table>' : '')+
    (terms ? '<div class="d-note">'+esc(terms)+'</div>' : '')+
    (kind==="Agreement" || kind==="Delivery Note" ?
      '<div class="d-sign"><div>Client signature</div><div>For '+esc(s.name||"Nestify")+'</div></div>' : '')+
    '<div class="d-foot"><span>'+[s.phone,s.email,s.website].filter(Boolean).map(esc).join("  ·  ")+'</span><span>'+esc(s.address||"")+'</span></div>';

  $("doc-title").textContent = kind + " · " + refMap[kind];
  $("doc-overlay").hidden=false;
}
function addDays(iso, n){
  var d=parseISO(iso)||new Date();
  d.setDate(d.getDate()+n);
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
}
$("doc-close").addEventListener("click", function(){ $("doc-overlay").hidden=true; });
$("doc-print").addEventListener("click", function(){ window.print(); });

/* ============================================================
   19. INVENTORY
   ============================================================ */
function stockPill(kind, item){
  var avail=availableOf(kind,item), inc=incomingFor(kind,item.id);
  if(avail<=0) return '<span class="pill bad">Out</span>';
  if(isLow(kind,item)) return inc>0 ? '<span class="pill info">Restocking</span>' : '<span class="pill warn">Reorder</span>';
  return '<span class="pill good">Healthy</span>';
}
function renderInventory(){
  var units = sum(state.products,function(p){ return num(p.stockOnHand); })
            + sum(state.bases,function(b){ return num(b.stockOnHand); })
            + sum(state.covers,function(c){ return num(c.stockOnHand); });
  var lowCount = allStockRows().filter(function(r){ return isLow(r.kind,r.item); }).length;
  $("inv-figs").innerHTML =
    figure("Stock at cost", money0(stockValue())) +
    figure("Units on hand", String(units)) +
    figure("Below reorder point", String(lowCount));

  $("inv-products").innerHTML = state.products.length ? state.products.map(function(p){
    return '<tr class="clickable" data-edit="product:'+p.id+'">'+
      '<td class="strong">'+esc(p.name)+'</td><td class="tiny muted">'+esc(p.category||"")+'</td>'+
      '<td class="num">'+(itemCost(p)>0?money(itemCost(p)):'<span class="faint">—</span>')+'</td>'+
      '<td class="num">'+num(p.stockOnHand)+'</td><td class="num">'+reservedFor("product",p.id)+'</td>'+
      '<td class="num">'+(incomingFor("product",p.id)||'<span class="faint">—</span>')+'</td>'+
      '<td class="num strong">'+availableOf("product",p)+'</td><td>'+stockPill("product",p)+'</td></tr>';
  }).join("") : emptyRow(8,"No products yet.");

  $("inv-bases").innerHTML = state.bases.length ? state.bases.map(function(b){
    return '<tr class="clickable" data-edit="base:'+b.id+'">'+
      '<td class="strong">'+esc(b.name)+'</td><td class="tiny muted">'+esc(b.line||"")+'</td>'+
      '<td class="num">'+(itemCost(b)>0?money(itemCost(b)):'<span class="faint">—</span>')+'</td>'+
      '<td class="num">'+num(b.stockOnHand)+'</td><td class="num">'+reservedFor("base",b.id)+'</td>'+
      '<td class="num">'+(incomingFor("base",b.id)||'<span class="faint">—</span>')+'</td>'+
      '<td class="num strong">'+availableOf("base",b)+'</td><td>'+stockPill("base",b)+'</td></tr>';
  }).join("") : emptyRow(8,"No bases yet.");

  $("inv-covers").innerHTML = state.covers.length ? state.covers.map(function(c){
    return '<tr class="clickable" data-edit="cover:'+c.id+'">'+
      '<td class="strong">'+esc(c.name)+'</td><td class="tiny muted">'+esc(c.line||"")+'</td>'+
      '<td class="tiny muted">'+esc(c.finish||"")+'</td>'+
      '<td class="num">'+money(c.priceAddOn)+'</td>'+
      '<td class="num">'+(itemCost(c)>0?money(itemCost(c)):'<span class="faint">—</span>')+'</td>'+
      '<td class="num">'+num(c.stockOnHand)+'</td><td class="num">'+reservedFor("cover",c.id)+'</td>'+
      '<td class="num strong">'+availableOf("cover",c)+'</td><td>'+stockPill("cover",c)+'</td></tr>';
  }).join("") : emptyRow(9,"No covers yet.");

  document.querySelectorAll("#inv-pane-stock [data-edit]").forEach(function(r){
    r.addEventListener("click", function(){
      var p=r.dataset.edit.split(":");
      var list = p[0]==="product" ? state.products : (p[0]==="base" ? state.bases : state.covers);
      editStock(p[0], byId(list, p[1]));
    });
  });
  renderOrders(); renderSuppliers();
}
function wireAddButtons(){
  document.querySelectorAll("[data-add]").forEach(function(b){
    b.addEventListener("click", function(){
      var k=b.dataset.add;
      if(k==="product"||k==="base"||k==="cover") editStock(k,null);
      if(k==="supplier") editSupplier(null);
      if(k==="client") editClient(null);
      if(k==="expense") editExpense(null);
      if(k==="employee") editEmployee(null);
    });
  });
}

function editStock(kind, item){
  var isNew=!item;
  var d=item||{name:"", line:"", category:"Accessory", color:"", finish:"Glossy", priceAddOn:0,
    dealerPriceWB:0, endUserPriceWB:0, dealerPrice48:0, endUserPrice48:0, programmingFee:0,
    cost:0, stockOnHand:0, reorderThreshold:5, notes:""};
  var titleMap={product:"product", base:"base", cover:"cover"};
  var groups=[];
  if(kind==="cover"){
    groups.push({fields:[
      {id:"f-name", label:"Cover name", value:d.name, placeholder:"Champagne Matte"},
      {id:"f-line", label:"Line it belongs to", value:d.line, placeholder:"Q"}]});
    groups.push({fields:[
      {id:"f-color", label:"Colour", value:d.color},
      {id:"f-finish", label:"Finish", type:"select", options:["Glossy","Matte"], value:d.finish},
      {id:"f-addon", label:"Price added over the base", type:"number", step:"0.01", value:num(d.priceAddOn)}]});
  } else {
    groups.push({fields:[
      {id:"f-name", label:kind==="base"?"Base name":"Product name", value:d.name,
       placeholder: kind==="base" ? "1-gang Zigbee switch" : "Smart door lock"},
      kind==="base"
        ? {id:"f-line", label:"Line", value:d.line, placeholder:"Q"}
        : {id:"f-category", label:"Category", type:"select", options:["Door Lock","Switch","KNX Component","DNAKE","Accessory","Other"], value:d.category}]});
    groups.push({heading:"Price book — West Bank"});
    groups.push({fields:[
      {id:"f-dwb", label:"Dealer", type:"number", step:"0.01", value:num(d.dealerPriceWB)},
      {id:"f-ewb", label:"End user", type:"number", step:"0.01", value:num(d.endUserPriceWB)}]});
    groups.push({heading:"Price book — 48 Region"});
    groups.push({fields:[
      {id:"f-d48", label:"Dealer", type:"number", step:"0.01", value:num(d.dealerPrice48)},
      {id:"f-e48", label:"End user", type:"number", step:"0.01", value:num(d.endUserPrice48)}]});
    groups.push({fields:[{id:"f-prog", label:"Programming fee added when included", type:"number", step:"0.01", value:num(d.programmingFee)}]});
  }
  groups.push({heading:"Stock"});
  groups.push({fields:[
    {id:"f-cost", label:"What it costs you", type:"number", step:"0.01", value:itemCost(d)},
    {id:"f-stock", label:"On hand", type:"number", step:"1", value:num(d.stockOnHand)},
    {id:"f-reorder", label:"Reorder at", type:"number", step:"1", value:num(d.reorderThreshold)}]});
  groups.push({note:"Cost drives every margin figure in the system. Leave it at zero and margins stay blank."});

  openForm((isNew?"Add ":"Edit ")+titleMap[kind], groups, function(){
    if(!val("f-name")){ toast("Give it a name first", true); return false; }
    var data={
      name:val("f-name"),
      cost:valNum("f-cost"), baseCost:valNum("f-cost"),
      stockOnHand:valNum("f-stock"), reorderThreshold:valNum("f-reorder")
    };
    if(kind==="cover"){
      data.line=val("f-line"); data.color=val("f-color"); data.finish=val("f-finish"); data.priceAddOn=valNum("f-addon");
    } else {
      if(kind==="base") data.line=val("f-line"); else data.category=val("f-category");
      data.dealerPriceWB=valNum("f-dwb"); data.endUserPriceWB=valNum("f-ewb");
      data.dealerPrice48=valNum("f-d48"); data.endUserPrice48=valNum("f-e48");
      data.programmingFee=valNum("f-prog");
    }
    var col = kind==="product" ? "products" : (kind==="base" ? "bases" : "covers");
    save(col, isNew?null:item.id, data, function(){ toast("Saved"); });
  }, isNew ? null : function(){
    remove(kind==="product" ? "products" : (kind==="base" ? "bases" : "covers"), item.id, item.name);
  });
}

/* ---------- Purchase orders ---------- */
function poStagePill(s){
  var m={Draft:"neutral", Ordered:"info", Received:"good", Cancelled:"bad"};
  return '<span class="pill '+(m[s]||"neutral")+'">'+esc(s)+'</span>';
}
function renderOrders(){
  var rows=sortBy(state.orders, function(o){ return o.orderedDate||""; }, true);
  $("po-body").innerHTML = rows.length ? rows.map(function(o){
    var late = o.status==="Ordered" && o.expectedDate && daysSince(o.expectedDate)>0;
    return '<tr class="clickable" data-po="'+o.id+'">'+
      '<td class="mono">'+esc(o.refNo||"")+'</td>'+
      '<td class="strong">'+esc(o.supplierName||"—")+'</td>'+
      '<td>'+poStagePill(o.status)+(late?' <span class="pill bad">late</span>':'')+'</td>'+
      '<td>'+fmtDate(o.orderedDate)+'</td><td>'+(o.expectedDate?fmtDate(o.expectedDate):'<span class="faint">—</span>')+'</td>'+
      '<td class="num">'+poUnits(o)+'</td><td class="num">'+money(poTotal(o))+'</td></tr>';
  }).join("") : emptyRow(7,"No purchase orders yet. Create one when you order stock from a supplier.");
  $("po-body").querySelectorAll("[data-po]").forEach(function(r){
    r.addEventListener("click", function(){ editOrder(byId(state.orders, r.dataset.po)); });
  });
}
var poNew=$("po-new"); if(poNew) poNew.addEventListener("click", function(){ editOrder(null); });

var poDraft=null;
function stockOptions(sel){
  var opts='<option value="">Choose an item…</option>';
  if(state.products.length) opts+='<optgroup label="Products">'+state.products.map(function(p){
    return '<option value="product:'+p.id+'"'+(sel==="product:"+p.id?" selected":"")+'>'+esc(p.name)+'</option>'; }).join("")+'</optgroup>';
  if(state.bases.length) opts+='<optgroup label="Bases">'+state.bases.map(function(b){
    return '<option value="base:'+b.id+'"'+(sel==="base:"+b.id?" selected":"")+'>'+esc(b.name)+'</option>'; }).join("")+'</optgroup>';
  if(state.covers.length) opts+='<optgroup label="Covers">'+state.covers.map(function(c){
    return '<option value="cover:'+c.id+'"'+(sel==="cover:"+c.id?" selected":"")+'>'+esc(c.name)+'</option>'; }).join("")+'</optgroup>';
  return opts;
}
function editOrder(o){
  poDraft = o ? JSON.parse(JSON.stringify(o)) : {refNo:nextPoRef(), supplierId:"", supplierName:"", status:"Draft",
    lines:[], orderedDate:todayISO(), expectedDate:"", receivedDate:null, shipping:0, notes:""};
  if(!poDraft.lines || !poDraft.lines.length) poDraft.lines=[{kind:"product", itemId:"", name:"", qty:1, unitCost:0}];
  poDraft._id = o ? o.id : null;
  renderPoForm();
  $("form-overlay").hidden=false;
  formSave=savePo;
  setFormDelete(o && o.status!=="Received" ? function(){ remove("purchase_orders", o.id, "purchase order "+o.refNo); } : null);
}
function renderPoForm(){
  var received = poDraft.status==="Received";
  $("form-title").textContent = (poDraft._id ? "Purchase order " : "New purchase order ") + poDraft.refNo;
  $("form-body").innerHTML =
    '<div class="grid g3">'+
      '<div class="field"><label for="po-sup">Supplier</label><select id="po-sup"'+(received?" disabled":"")+'>'+
        '<option value="">Choose…</option>'+state.suppliers.map(function(s){
          return '<option value="'+s.id+'"'+(s.id===poDraft.supplierId?" selected":"")+'>'+esc(s.name)+'</option>'; }).join("")+
      '</select></div>'+
      '<div class="field"><label for="po-ordered">Ordered on</label><input id="po-ordered" type="date" class="mono" value="'+esc(poDraft.orderedDate||"")+'"'+(received?" disabled":"")+'></div>'+
      '<div class="field"><label for="po-expected">Expected</label><input id="po-expected" type="date" class="mono" value="'+esc(poDraft.expectedDate||"")+'"'+(received?" disabled":"")+'></div>'+
    '</div>'+
    '<div class="panel"><div class="panel-head"><h3>Items ordered</h3>'+
      (received?'<span class="tiny faint">Received — stock already added</span>':'<button class="btn sm" type="button" id="po-add">Add line</button>')+'</div>'+
      '<div class="panel-pad" id="po-lines"></div></div>'+
    '<div class="grid g3">'+
      '<div class="field"><label for="po-ship">Shipping and customs</label><input id="po-ship" type="number" step="0.01" class="mono" value="'+num(poDraft.shipping)+'"'+(received?" disabled":"")+'></div>'+
      '<div class="field"><label>Order total</label><div class="mono" id="po-total" style="padding-top:8px; font-size:16px">'+money(poTotal(poDraft))+'</div></div>'+
      '<div class="field"><label for="po-notes">Notes</label><input id="po-notes" type="text" value="'+esc(poDraft.notes||"")+'"'+(received?" disabled":"")+'></div>'+
    '</div>'+
    (poDraft._id && poDraft.status!=="Received" ?
      '<div style="display:flex; gap:8px; flex-wrap:wrap; border-top:1px solid var(--line); padding-top:14px">'+
        (poDraft.status==="Draft" ? '<button class="btn sm" type="button" id="po-order">Mark as ordered</button>' : '')+
        '<button class="btn sm primary" type="button" id="po-receive">Receive into stock</button>'+
        '<span class="tiny muted" style="align-self:center">Receiving adds every line to stock and books the cost as an expense.</span>'+
      '</div>' : '')+
    (received ? '<p class="tiny muted">Received '+fmtDate(poDraft.receivedDate)+'. Stock and costs are already recorded.</p>' : '');

  var wrap=$("po-lines");
  wrap.innerHTML = poDraft.lines.map(function(l,i){
    return '<div class="li" data-i="'+i+'" style="grid-template-columns:minmax(0,2.4fr) 70px 110px 110px 30px">'+
      '<div><div class="lbl">Item</div><select data-f="item"'+(received?" disabled":"")+'>'+stockOptions(l.itemId?l.kind+":"+l.itemId:"")+'</select></div>'+
      '<div><div class="lbl">Qty</div><input data-f="qty" type="number" min="1" step="1" value="'+num(l.qty)+'"'+(received?" disabled":"")+'></div>'+
      '<div><div class="lbl">Unit cost</div><input data-f="cost" type="number" step="0.01" value="'+num(l.unitCost)+'"'+(received?" disabled":"")+'></div>'+
      '<div><div class="lbl">Line</div><div class="fixed">'+money(num(l.qty)*num(l.unitCost))+'</div></div>'+
      '<div><div class="lbl">&nbsp;</div>'+(received?'':'<button class="btn quiet sm" data-f="del" type="button" aria-label="Remove">×</button>')+'</div>'+
    '</div>';
  }).join("");

  wrap.querySelectorAll(".li").forEach(function(row){
    var i=Number(row.dataset.i);
    row.querySelectorAll("[data-f]").forEach(function(inp){
      var f=inp.dataset.f;
      if(f==="del"){ inp.addEventListener("click", function(){ poDraft.lines.splice(i,1); if(!poDraft.lines.length) poDraft.lines.push({kind:"product",itemId:"",qty:1,unitCost:0}); syncPo(); renderPoForm(); }); return; }
      inp.addEventListener("input", function(){
        var L=poDraft.lines[i];
        if(f==="item"){
          var parts=inp.value.split(":");
          L.kind=parts[0]||"product"; L.itemId=parts[1]||"";
          var list = L.kind==="product"?state.products:(L.kind==="base"?state.bases:state.covers);
          var it=byId(list, L.itemId);
          L.name = it ? it.name : "";
          if(it && !num(L.unitCost)) L.unitCost = itemCost(it);
        }
        if(f==="qty") L.qty=num(inp.value);
        if(f==="cost") L.unitCost=num(inp.value);
        syncPo(); renderPoForm();
      });
    });
  });
  var addBtn=$("po-add"); if(addBtn) addBtn.addEventListener("click", function(){
    syncPo(); poDraft.lines.push({kind:"product", itemId:"", name:"", qty:1, unitCost:0}); renderPoForm();
  });
  var ordBtn=$("po-order"); if(ordBtn) ordBtn.addEventListener("click", function(){
    syncPo(); poDraft.status="Ordered"; savePo(); closeForm();
  });
  var recBtn=$("po-receive"); if(recBtn) recBtn.addEventListener("click", receiveOrder);
}
function syncPo(){
  if($("po-sup")){
    poDraft.supplierId=val("po-sup");
    var s=supplierById(poDraft.supplierId);
    poDraft.supplierName = s ? s.name : "";
    poDraft.orderedDate=val("po-ordered"); poDraft.expectedDate=val("po-expected");
    poDraft.shipping=valNum("po-ship"); poDraft.notes=val("po-notes");
  }
}
function savePo(){
  syncPo();
  var lines=poDraft.lines.filter(function(l){ return l.itemId && num(l.qty)>0; });
  if(!lines.length){ toast("Add at least one item", true); return false; }
  var data={refNo:poDraft.refNo, supplierId:poDraft.supplierId, supplierName:poDraft.supplierName,
    status:poDraft.status||"Draft", lines:lines, orderedDate:poDraft.orderedDate, expectedDate:poDraft.expectedDate||null,
    receivedDate:poDraft.receivedDate||null, shipping:num(poDraft.shipping), notes:poDraft.notes||""};
  save("purchase_orders", poDraft._id, data, function(){ toast("Purchase order saved"); });
}
function receiveOrder(){
  syncPo();
  if(!poDraft._id){ toast("Save the order first", true); return; }
  var lines=poDraft.lines.filter(function(l){ return l.itemId && num(l.qty)>0; });
  if(!lines.length){ toast("Add at least one item", true); return; }
  /* Stock, item cost and the expense are booked together on the server. */
  send("POST", "purchase_orders/"+poDraft._id+"/receive", {
    supplierId:poDraft.supplierId, status:poDraft.status==="Draft" ? "Ordered" : poDraft.status, lines:lines,
    orderedDate:poDraft.orderedDate, expectedDate:poDraft.expectedDate||null, shipping:num(poDraft.shipping), notes:poDraft.notes||""
  }, function(){ closeForm(); }, "Stock received and cost recorded");
}

/* ---------- Suppliers ---------- */
function renderSuppliers(){
  $("sup-body").innerHTML = state.suppliers.length ? state.suppliers.map(function(s){
    var st=supplierStats(s);
    return '<tr class="clickable" data-sup="'+s.id+'">'+
      '<td class="strong">'+esc(s.name)+'</td><td>'+esc(s.contact||"")+'</td><td class="mono tiny">'+esc(s.phone||"")+'</td>'+
      '<td class="num">'+st.orders+'</td><td class="num">'+money(st.spent)+'</td></tr>';
  }).join("") : emptyRow(5,"No suppliers yet.");
  $("sup-body").querySelectorAll("[data-sup]").forEach(function(r){
    r.addEventListener("click", function(){ editSupplier(byId(state.suppliers, r.dataset.sup)); });
  });
}
function editSupplier(s){
  var isNew=!s; var d=s||{name:"", contact:"", phone:"", email:"", country:"", notes:""};
  openForm((isNew?"Add":"Edit")+" supplier", [
    {fields:[{id:"su-name", label:"Supplier", value:d.name}, {id:"su-contact", label:"Contact person", value:d.contact}]},
    {fields:[{id:"su-phone", label:"Phone", value:d.phone}, {id:"su-email", label:"Email", value:d.email}]},
    {fields:[{id:"su-country", label:"Country", value:d.country}]},
    {fields:[{id:"su-notes", label:"Notes", type:"textarea", value:d.notes}]}
  ], function(){
    if(!val("su-name")){ toast("Name is required", true); return false; }
    save("suppliers", isNew?null:s.id, {name:val("su-name"), contact:val("su-contact"), phone:val("su-phone"),
      email:val("su-email"), country:val("su-country"), notes:val("su-notes")}, function(){ toast("Supplier saved"); });
  }, isNew ? null : function(){ remove("suppliers", s.id, s.name); });
}

/* ============================================================
   20. CONTACTS
   ============================================================ */
function renderContacts(){
  var dealers=state.clients.filter(function(c){ return c.type==="Dealer"; });
  var owing=state.clients.map(function(c){ return clientStats(c).outstanding; }).filter(function(v){ return v>0.004; });
  $("contacts-figs").innerHTML =
    figure("Contacts", String(state.clients.length)) +
    figure("Dealers", String(dealers.length)) +
    figure("Owing you money", owing.length+" · "+money0(sum(owing,function(v){ return v; })), true);

  var f=state.filters.contacts;
  var rows=state.clients.filter(function(c){
    if(f==="all") return true;
    if(f==="owing") return clientStats(c).outstanding>0.004;
    return c.type===f;
  });
  rows=sortBy(rows, function(c){ return clientStats(c).outstanding; }, true);

  $("contacts-body").innerHTML = rows.length ? rows.map(function(c){
    var st=clientStats(c);
    return '<tr class="clickable" data-c="'+c.id+'">'+
      '<td class="strong">'+esc(c.name)+(c.phone?'<div class="tiny faint mono">'+esc(c.phone)+'</div>':'')+'</td>'+
      '<td><span class="pill '+(c.type==="Dealer"?"accent":(c.type==="Partner"?"info":"neutral"))+'">'+esc(c.type||"")+'</span></td>'+
      '<td class="tiny muted">'+esc(c.region||"")+'</td>'+
      '<td class="num">'+(num(c.discountPct)>0?pct(c.discountPct,0):'<span class="faint">—</span>')+'</td>'+
      '<td class="num">'+st.deals+'</td><td class="num">'+money0(st.billed)+'</td>'+
      '<td class="num '+(st.outstanding>0.004?"strong":"")+'">'+(st.outstanding>0.004?money(st.outstanding):'<span class="faint">—</span>')+'</td>'+
      '<td class="tiny muted">'+(st.last?fmtDate(txRecognisedDate(st.last)):"—")+'</td></tr>';
  }).join("") : emptyRow(8,"Nobody here yet.");
  $("contacts-body").querySelectorAll("[data-c]").forEach(function(r){
    r.addEventListener("click", function(){ openContact(r.dataset.c); });
  });
}
function openContact(id){
  var c=clientById(id); if(!c) return;
  var st=clientStats(c), rows=sortBy(txForClient(id), function(t){ return txRecognisedDate(t)||""; }, true);
  var html=
    '<div class="figures three" style="border-radius:var(--radius)">'+
      figure("Billed", money0(st.billed))+figure("Paid", money0(st.paid))+figure("Outstanding", money0(st.outstanding))+
    '</div>'+
    '<div class="grid g3">'+
      '<div class="kv"><span class="k">Type</span><span class="v">'+esc(c.type||"")+'</span></div>'+
      '<div class="kv"><span class="k">Region</span><span class="v">'+esc(c.region||"")+'</span></div>'+
      '<div class="kv"><span class="k">Standing discount</span><span class="v">'+pct(c.discountPct||0,1)+'</span></div>'+
      '<div class="kv"><span class="k">Phone</span><span class="v">'+esc(c.phone||"—")+'</span></div>'+
      '<div class="kv"><span class="k">Deals</span><span class="v">'+st.deals+'</span></div>'+
      '<div class="kv"><span class="k">Last activity</span><span class="v">'+(st.last?fmtDate(txRecognisedDate(st.last)):"—")+'</span></div>'+
    '</div>'+
    (c.notes?'<p class="tiny muted">'+esc(c.notes)+'</p>':'')+
    '<div class="section"><p class="eyebrow">Statement</p><div class="panel"><div class="table-wrap"><table>'+
      '<thead><tr><th>Reference</th><th>Stage</th><th>Date</th><th class="num">Total</th><th class="num">Balance</th></tr></thead><tbody>'+
      (rows.length ? rows.map(function(t){
        return '<tr class="clickable" data-t="'+t.id+'"><td class="mono">'+esc(t.refNo)+'</td><td>'+stagePill(t.status)+'</td>'+
          '<td class="tiny muted">'+fmtDate(txRecognisedDate(t))+'</td><td class="num">'+money(txTotal(t))+'</td>'+
          '<td class="num">'+(txBalance(t)>0.004?money(txBalance(t)):'<span class="faint">—</span>')+'</td></tr>';
      }).join("") : emptyRow(5,"No deals with this contact yet."))+
    '</tbody></table></div></div></div>'+
    '<div style="display:flex; gap:8px"><button class="btn sm" type="button" id="c-edit">Edit contact</button>'+
      '<button class="btn sm primary" type="button" id="c-offer">New offer for '+esc(c.name)+'</button></div>';
  openDrawer(c.name, html);
  $("drawer-body").querySelectorAll("[data-t]").forEach(function(r){
    r.addEventListener("click", function(){ closeDrawer(); setView("sales"); openTx(r.dataset.t); });
  });
  $("c-edit").addEventListener("click", function(){ closeDrawer(); editClient(c); });
  $("c-offer").addEventListener("click", function(){
    closeDrawer(); openComposer();
    $("of-client").value=c.id; if(c.region) $("of-region").value=c.region; renderComposer();
  });
}
function editClient(c){
  var isNew=!c; var d=c||{name:"", type:"End User", region:"West Bank", discountPct:0, phone:"", email:"", notes:""};
  openForm((isNew?"Add":"Edit")+" contact", [
    {fields:[{id:"c-name", label:"Name", value:d.name},
             {id:"c-type", label:"Type", type:"select", options:["End User","Dealer","Partner"], value:d.type},
             {id:"c-region", label:"Region", type:"select", options:["West Bank","48 Region"], value:d.region}]},
    {fields:[{id:"c-disc", label:"Standing discount (%)", type:"number", step:"0.1", value:(num(d.discountPct)*100)},
             {id:"c-phone", label:"Phone", value:d.phone},
             {id:"c-email", label:"Email", value:d.email}]},
    {fields:[{id:"c-notes", label:"Notes", type:"textarea", value:d.notes}]},
    {note:"Type and region decide which price column the offer builder uses."}
  ], function(){
    if(!val("c-name")){ toast("Name is required", true); return false; }
    save("clients", isNew?null:c.id, {name:val("c-name"), type:val("c-type"), region:val("c-region"),
      discountPct:valNum("c-disc")/100, phone:val("c-phone"), email:val("c-email"), notes:val("c-notes")},
      function(){ toast("Contact saved"); });
  }, isNew ? null : function(){ remove("clients", c.id, c.name); });
}

/* ============================================================
   21. MONEY
   ============================================================ */
function renderMoney(){
  var mk=thisMonth(), pl=plForMonth(mk);
  var ytd=monthKeys(12).map(plForMonth);
  $("money-figs").innerHTML =
    figure("Collected in "+monthShort(mk), money0(pl.collected)) +
    figure("Spent in "+monthShort(mk), money0(pl.expenses+pl.payroll)) +
    figure("Net this month", money0(pl.net)) +
    figure("Net last 12 months", money0(sum(ytd,function(m){ return m.net; })));
  if(state.tab.money==="pl"){ renderNetChart(); renderCostSplit(); renderPL(); }
  if(state.tab.money==="expenses") renderExpenses();
  if(state.tab.money==="ledger") renderLedger();
}
function niceCeil(v){
  if(v<=0) return 0;
  var mag=Math.pow(10, Math.floor(Math.log(v)/Math.LN10));
  var n=v/mag;
  return (n<=1?1:n<=2?2:n<=5?5:10)*mag;
}
function renderNetChart(){
  var keys=monthKeys(6), data=keys.map(plForMonth);
  var active=data.some(function(d){ return d.sales||d.expenses||d.payroll; });
  if(!active){
    $("net-chart").innerHTML='<div class="empty-block">Once you invoice a deal or log an expense, the months appear here.</div>';
    $("net-legend").innerHTML=""; return;
  }
  var W=470, H=208, padL=52, padR=12, padT=22, padB=32;
  var iW=W-padL-padR, iH=H-padT-padB;
  var vals=data.map(function(d){ return d.net; });
  var dmax=niceCeil(Math.max(0, Math.max.apply(null,vals)));
  var dmin=-niceCeil(Math.max(0, -Math.min.apply(null,vals)));
  if(dmax===0 && dmin===0) dmax=100;
  var span=(dmax-dmin)||1;
  var y=function(v){ return padT + iH*(dmax-v)/span; };
  var colW=iW/data.length, barW=Math.min(38, colW*0.46);
  var zeroY=y(0);

  var parts=[];
  parts.push('<line class="grid-line" x1="'+padL+'" y1="'+y(dmax)+'" x2="'+(W-padR)+'" y2="'+y(dmax)+'"/>');
  parts.push('<text x="'+(padL-8)+'" y="'+(y(dmax)+3)+'" text-anchor="end">'+money0(dmax)+'</text>');
  if(dmin<0){
    parts.push('<line class="grid-line" x1="'+padL+'" y1="'+y(dmin)+'" x2="'+(W-padR)+'" y2="'+y(dmin)+'"/>');
    parts.push('<text x="'+(padL-8)+'" y="'+(y(dmin)+3)+'" text-anchor="end">'+money0(dmin)+'</text>');
  }
  parts.push('<line class="zero-line" x1="'+padL+'" y1="'+zeroY+'" x2="'+(W-padR)+'" y2="'+zeroY+'"/>');
  parts.push('<text x="'+(padL-8)+'" y="'+(zeroY+3)+'" text-anchor="end">0</text>');

  data.forEach(function(d,i){
    var quiet = !d.sales && !d.cogs && !d.expenses && !d.payroll;
    var cx=padL+colW*i+colW/2, up=d.net>=0;
    var top=up?y(d.net):zeroY, h=Math.max(1.5, Math.abs(y(d.net)-zeroY));
    var r=Math.min(4, barW/2, h);
    var x=cx-barW/2;
    var path = up
      ? 'M'+x+' '+(top+h)+' V'+(top+r)+' Q'+x+' '+top+' '+(x+r)+' '+top+' H'+(x+barW-r)+' Q'+(x+barW)+' '+top+' '+(x+barW)+' '+(top+r)+' V'+(top+h)+' Z'
      : 'M'+x+' '+top+' V'+(top+h-r)+' Q'+x+' '+(top+h)+' '+(x+r)+' '+(top+h)+' H'+(x+barW-r)+' Q'+(x+barW)+' '+(top+h)+' '+(x+barW)+' '+(top+h-r)+' V'+top+' Z';
    var fill = up ? 'var(--good)' : 'var(--bad)';
    var labelY = up ? top-7 : top+h+13;
    parts.push('<g class="col" data-i="'+i+'">'+
      '<rect class="hit" x="'+(padL+colW*i)+'" y="'+padT+'" width="'+colW+'" height="'+iH+'"/>'+
      (quiet ? '' : '<path class="bar" d="'+path+'" fill="'+fill+'"/>')+
      (quiet ? '' : '<text class="val" x="'+cx+'" y="'+labelY+'" text-anchor="middle">'+money0(d.net)+'</text>')+
      '<text x="'+cx+'" y="'+(H-10)+'" text-anchor="middle">'+monthShort(d.key)+'</text>'+
    '</g>');
  });

  $("net-chart").innerHTML='<svg class="chart" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Net result for the last six months">'+parts.join("")+'</svg>';
  $("net-legend").innerHTML =
    '<span><i style="background:var(--good)"></i>Month in profit</span>'+
    '<span><i style="background:var(--bad)"></i>Month at a loss</span>'+
    '<span class="faint">Bars show sales less cost of goods, expenses and salaries.</span>';

  $("net-chart").querySelectorAll("g.col").forEach(function(g){
    var d=data[Number(g.dataset.i)];
    g.addEventListener("mousemove", function(e){
      showTip('<b>'+monthLabel(d.key)+'</b><br>Sales <b>'+money0(d.sales)+'</b><br>Cost of goods <b>'+money0(-d.cogs)+
        '</b><br>Expenses <b>'+money0(-d.expenses)+'</b><br>Salaries <b>'+money0(-d.payroll)+
        '</b><br>Net <b>'+money0(d.net)+'</b>', e.clientX, e.clientY);
    });
    g.addEventListener("mouseleave", hideTip);
  });
}
function renderCostSplit(){
  var months=monthKeys(12), set={};
  months.forEach(function(m){ set[m]=true; });
  var cogs=sum(state.transactions.filter(function(t){ return isLive(t)&&isBilled(t)&&set[monthKey(txRecognisedDate(t))]; }), txCOGS);
  var pay=sum(state.payroll.filter(function(p){ return set[payrollMonthKey(p)]; }), function(p){ return p.amount; });
  var byCat={};
  operatingExpenses(state.expenses).filter(function(e){ return set[monthKey(e.date)]; }).forEach(function(e){
    byCat[e.category||"Other"]=(byCat[e.category||"Other"]||0)+num(e.amount);
  });
  var rows=[{k:"Cost of goods sold", v:cogs},{k:"Salaries", v:pay}].concat(
    Object.keys(byCat).map(function(k){ return {k:k, v:byCat[k]}; }));
  rows=sortBy(rows.filter(function(r){ return r.v>0; }), function(r){ return r.v; }, true);
  var top=Math.max.apply(null, rows.map(function(r){ return r.v; }).concat([1]));
  $("cost-split").innerHTML = rows.length ? rows.map(function(r){
    return '<tr><td style="width:62%"><div>'+esc(r.k)+'</div>'+
      '<div style="height:3px; background:var(--surface-3); border-radius:2px; margin-top:6px">'+
        '<div style="height:3px; width:'+Math.max(2,(r.v/top)*100)+'%; background:var(--accent); border-radius:2px"></div></div></td>'+
      '<td class="num">'+money0(r.v)+'</td></tr>';
  }).join("") : emptyRow(2,"No costs recorded in the last twelve months.");
}
function renderPL(){
  var rows=monthKeys(12).map(plForMonth).reverse().filter(function(m){
    return m.sales||m.cogs||m.expenses||m.payroll||m.collected;
  });
  $("pl-body").innerHTML = rows.length ? rows.map(function(m){
    return '<tr><td class="strong">'+monthLabel(m.key)+'<div class="tiny faint">'+m.deals+' invoiced</div></td>'+
      '<td class="num">'+money0(m.sales)+'</td><td class="num">'+(m.cogs?money0(-m.cogs):'<span class="faint">—</span>')+'</td>'+
      '<td class="num">'+money0(m.gross)+(m.sales>0?'<div class="tiny faint">'+pct(m.gross/m.sales,0)+'</div>':'')+'</td>'+
      '<td class="num">'+(m.expenses?money0(-m.expenses):'<span class="faint">—</span>')+'</td>'+
      '<td class="num">'+(m.payroll?money0(-m.payroll):'<span class="faint">—</span>')+'</td>'+
      '<td class="num strong" style="color:'+(m.net<0?"var(--bad)":"inherit")+'">'+money0(m.net)+'</td>'+
      '<td class="num">'+money0(m.collected)+'</td></tr>';
  }).join("") : emptyRow(8,"No activity to report yet.");
}
function renderExpenses(){
  var rows=sortBy(state.expenses, function(e){ return e.date||""; }, true);
  $("exp-body").innerHTML = rows.length ? rows.map(function(e){
    return '<tr class="clickable" data-e="'+e.id+'"><td>'+fmtDate(e.date)+'</td>'+
      '<td><span class="pill neutral">'+esc(e.category||"Other")+'</span></td>'+
      '<td>'+esc(e.description||"")+(e.poRef?'<div class="tiny faint mono">'+esc(e.poRef)+'</div>':'')+'</td>'+
      '<td>'+esc(e.vendor||"")+'</td><td class="tiny muted">'+esc(e.paymentMethod||"")+'</td>'+
      '<td class="num">'+money(e.amount)+'</td></tr>';
  }).join("") : emptyRow(6,"Nothing logged yet.");
  $("exp-body").querySelectorAll("[data-e]").forEach(function(r){
    r.addEventListener("click", function(){ editExpense(byId(state.expenses, r.dataset.e)); });
  });
}
var EXPENSE_CATEGORIES=["Inventory Purchase","Rent","Utilities","Transport","Marketing","Tools & Equipment","Shipping","Fees","Other"];
function editExpense(e){
  var isNew=!e;
  var d=e||{date:todayISO(), category:"Other", description:"", vendor:"", amount:0, paymentMethod:"Cash", linkedProductId:"", qtyPurchased:0, notes:""};
  openForm((isNew?"Add":"Edit")+" expense", [
    {fields:[{id:"e-date", label:"Date", type:"date", value:d.date},
             {id:"e-cat", label:"Category", type:"select", options:EXPENSE_CATEGORIES, value:d.category},
             {id:"e-amount", label:"Amount", type:"number", step:"0.01", value:num(d.amount)}]},
    {fields:[{id:"e-desc", label:"What was it for", value:d.description},
             {id:"e-vendor", label:"Paid to", value:d.vendor},
             {id:"e-method", label:"Method", type:"select", options:["Cash","Bank Transfer","Cheque"], value:d.paymentMethod}]},
    {heading:"Restock (optional)"},
    {fields:[{id:"e-prod", label:"Product this refills", type:"select",
              options:[{value:"", label:"— none —"}].concat(state.products.map(function(p){ return {value:p.id, label:p.name}; })), value:d.linkedProductId},
             {id:"e-qty", label:"Units bought", type:"number", step:"1", value:num(d.qtyPurchased)}]},
    {note:"For a real supplier order with several items, use a purchase order instead — it handles the stock and the cost together."}
  ], function(){
    if(!val("e-desc")){ toast("Say what the expense was for", true); return false; }
    var data={date:val("e-date")||todayISO(), category:val("e-cat"), description:val("e-desc"), vendor:val("e-vendor"),
      amount:valNum("e-amount"), paymentMethod:val("e-method"), linkedProductId:val("e-prod"), qtyPurchased:valNum("e-qty"),
      poRef:(e&&e.poRef)||"", poId:(e&&e.poId)||"", notes:(e&&e.notes)||""};
    /* A linked product is restocked (or corrected) on the server. */
    save("expenses", isNew?null:e.id, data, function(){ toast("Expense saved"); });
  }, (isNew || e.poId) ? null : function(){ remove("expenses", e.id, "this expense"); });
}
function renderLedger(){
  var f=state.filters.ledger;
  var rows=ledgerRows().filter(function(r){ return f==="all" || r.dir===f; }).slice(0,180);
  $("ledger-body").innerHTML = rows.length ? rows.map(function(r){
    return '<tr><td>'+fmtDate(r.date)+'</td><td>'+esc(r.label)+'</td>'+
      '<td class="mono tiny">'+esc(r.ref||"")+'</td><td class="tiny muted">'+esc(r.method||"")+'</td>'+
      '<td class="num">'+(r.dir==="in"?money(r.amount):'')+'</td>'+
      '<td class="num">'+(r.dir==="out"?money(r.amount):'')+'</td></tr>';
  }).join("") : emptyRow(6,"No movements recorded yet.");
}

/* ============================================================
   22. TEAM
   ============================================================ */
function renderTeam(){
  var mk=thisMonth().replace("-","").slice(2);
  var active=state.employees.filter(function(e){ return e.active!==false; });
  var paidThis=state.payroll.filter(function(p){ return p.month===mk; });
  $("payroll-title").textContent="Payroll · "+monthLabel(thisMonth());
  $("team-figs").innerHTML =
    figure("People on payroll", String(active.length)) +
    figure("Monthly cost", money0(sum(active,function(e){ return e.monthlySalary; }))) +
    figure("Paid this month", money0(sum(paidThis,function(p){ return p.amount; })));

  $("payroll-body").innerHTML = state.employees.length ? state.employees.map(function(e){
    var rec=paidThis.filter(function(p){ return p.employeeId===e.id; })[0];
    return '<tr><td class="strong">'+esc(e.name)+'</td><td class="tiny muted">'+esc(e.role||"")+'</td>'+
      '<td class="num">'+money(e.monthlySalary)+'</td>'+
      '<td>'+(rec?'<span class="pill good">Paid '+fmtDate(rec.paidDate)+'</span>':(e.active===false?'<span class="pill neutral">Inactive</span>':'<span class="pill warn">Due</span>'))+'</td>'+
      '<td style="text-align:right">'+
        (rec||e.active===false ? '<button class="btn quiet sm" data-emp="'+e.id+'">Edit</button>'
          : '<button class="btn sm primary" data-pay="'+e.id+'">Mark paid</button> <button class="btn quiet sm" data-emp="'+e.id+'">Edit</button>')+
      '</td></tr>';
  }).join("") : emptyRow(5,"Nobody added yet. If you are staff rather than the owner, this page stays empty by design.");
  $("payroll-body").querySelectorAll("[data-pay]").forEach(function(b){
    b.addEventListener("click", function(){ payEmployee(b.dataset.pay); });
  });
  $("payroll-body").querySelectorAll("[data-emp]").forEach(function(b){
    b.addEventListener("click", function(){ editEmployee(byId(state.employees, b.dataset.emp)); });
  });

  var hist=sortBy(state.payroll, function(p){ return p.paidDate||p.month||""; }, true).slice(0,12);
  $("payhist-body").innerHTML = hist.length ? hist.map(function(p){
    return '<tr><td class="mono">'+esc(p.month||"")+'</td><td>'+esc(p.employeeName||"")+'</td>'+
      '<td class="tiny muted">'+fmtDate(p.paidDate)+'</td><td class="num">'+money(p.amount)+'</td></tr>';
  }).join("") : emptyRow(4,"No salary payments recorded.");
}
function payEmployee(id){
  var e=byId(state.employees,id); if(!e) return;
  var mk=thisMonth().replace("-","").slice(2);
  save("payroll_payments", null, {employeeId:e.id, method:"Cash"}, function(){ toast(e.name+" marked paid"); });
}
function editEmployee(e){
  var isNew=!e; var d=e||{name:"", role:"", monthlySalary:0, active:true, notes:""};
  openForm((isNew?"Add":"Edit")+" person", [
    {fields:[{id:"emp-name", label:"Name", value:d.name}, {id:"emp-role", label:"Role", value:d.role}]},
    {fields:[{id:"emp-salary", label:"Monthly salary", type:"number", step:"0.01", value:num(d.monthlySalary)},
             {id:"emp-active", label:"Status", type:"select", options:["Active","Inactive"], value:(d.active===false?"Inactive":"Active")}]},
    {fields:[{id:"emp-notes", label:"Notes", type:"textarea", value:d.notes}]}
  ], function(){
    if(!val("emp-name")){ toast("Name is required", true); return false; }
    save("employees", isNew?null:e.id, {name:val("emp-name"), role:val("emp-role"), monthlySalary:valNum("emp-salary"),
      active:val("emp-active")==="Active", notes:val("emp-notes")}, function(){ toast("Saved"); });
  }, isNew ? null : function(){ remove("employees", e.id, e.name); });
}

/* ============================================================
   23. SETTINGS
   ============================================================ */
var settingsDirty=false;
function renderSettings(){
  if(settingsDirty) return;
  var s=state.settings;
  var map={"s-name":s.name,"s-tagline":s.tagline,"s-phone":s.phone,"s-email":s.email,"s-website":s.website,
    "s-address":s.address,"s-vat":num(s.vatPct),"s-validity":num(s.validityDays),
    "s-terms-q":s.termsQuotation,"s-terms-a":s.termsAgreement,"s-terms-i":s.termsInvoice,
    "s-overdue":num(s.overdueDays),"s-stale":num(s.staleDays),"s-variance":num(s.varianceFlag)};
  Object.keys(map).forEach(function(id){ var n=$(id); if(n) n.value = map[id]==null?"":map[id]; });
}
["s-name","s-tagline","s-phone","s-email","s-website","s-address","s-vat","s-validity",
 "s-terms-q","s-terms-a","s-terms-i","s-overdue","s-stale","s-variance"].forEach(function(id){
  var n=$(id); if(n) n.addEventListener("input", function(){ settingsDirty=true; $("s-saved").textContent=""; });
});
$("s-save").addEventListener("click", function(){
  var data={
    name:val("s-name")||"Nestify", tagline:val("s-tagline"), phone:val("s-phone"), email:val("s-email"),
    website:val("s-website"), address:val("s-address"), vatPct:valNum("s-vat"), validityDays:valNum("s-validity")||14,
    termsQuotation:val("s-terms-q"), termsAgreement:val("s-terms-a"), termsInvoice:val("s-terms-i"),
    overdueDays:valNum("s-overdue")||14, staleDays:valNum("s-stale")||21, varianceFlag:valNum("s-variance")||15
  };
  api("PUT", "settings", data).then(function(saved){
    settingsDirty=false; state.settings=Object.assign({}, DEFAULTS, saved);
    $("s-saved").textContent="Saved"; applyBrand(); render(); toast("Company settings saved");
  }).catch(function(e){ toast(e.message || "Could not save settings", true); });
});

/* ---------- Accounts (owner) and own password ---------- */
function renderAccounts(){
  $("accounts-section").hidden = !isOwner();
  if(!isOwner()) return;
  $("acc-body").innerHTML = state.users.length ? state.users.map(function(u){
    return '<tr class="clickable" data-u="'+u.id+'"><td class="strong">'+esc(u.name)+'</td><td class="mono tiny">'+esc(u.email)+'</td>'+
      '<td><span class="pill '+(u.role==="owner"?"accent":"neutral")+'">'+(u.role==="owner"?"Owner":"Staff")+'</span></td></tr>';
  }).join("") : emptyRow(3,"No accounts.");
  $("acc-body").querySelectorAll("[data-u]").forEach(function(r){
    r.addEventListener("click", function(){ editAccount(byId(state.users, r.dataset.u)); });
  });
}
function editAccount(u){
  var isNew=!u; var d=u||{name:"", email:"", role:"staff"};
  openForm((isNew?"Add":"Edit")+" account", [
    {fields:[{id:"u-name", label:"Name", value:d.name}, {id:"u-email", label:"Email", type:"email", value:d.email}]},
    {fields:[{id:"u-role", label:"Role", type:"select", options:[{value:"staff", label:"Staff"},{value:"owner", label:"Owner"}], value:d.role},
             {id:"u-pass", label:isNew?"Password":"New password (leave empty to keep)", type:"password", value:""}]},
    {note:"Staff can run sales, stock, contacts and expenses. Only owners see payroll and change company settings."}
  ], function(){
    if(!val("u-name") || !val("u-email")){ toast("Name and email are required", true); return false; }
    if(isNew && val("u-pass").length<8){ toast("Password needs at least 8 characters", true); return false; }
    var data={name:val("u-name"), email:val("u-email"), role:val("u-role")};
    if(val("u-pass")) data.password=$("u-pass").value;
    save("users", isNew?null:u.id, data, function(){ toast("Account saved"); });
  }, (isNew || (state.user && u.id===state.user.id)) ? null : function(){ remove("users", u.id, "the account for "+u.name); });
}
$("acc-add").addEventListener("click", function(){ editAccount(null); });
$("pw-save").addEventListener("click", function(){
  var cur=$("pw-current").value, next=$("pw-new").value;
  if(next.length<8){ toast("New password needs at least 8 characters", true); return; }
  api("POST", "account/password", {current:cur, password:next}).then(function(){
    $("pw-current").value=""; $("pw-new").value=""; toast("Password changed");
  }).catch(function(e){ toast(e.message, true); });
});

/* ============================================================
   24. BOOT
   ============================================================ */
setSync(false, "Connecting");
wireAddButtons();
applyBrand();
setView("today");
startDb();
})();
