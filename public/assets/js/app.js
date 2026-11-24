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
  clients:[], products:[], bases:[], covers:[], transactions:[], expenses:[], deliveries:[], trash:[], services:[], sets:[], tiers:[],
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

function toast(msg, bad, undoToken){
  var t=$("toast"); t.className = bad?"bad":""; t.innerHTML="";
  var span=document.createElement("span"); span.textContent=msg; t.appendChild(span);
  /* An action that can be taken back carries an Undo button for a while. */
  if(undoToken){
    var b=document.createElement("button"); b.type="button"; b.textContent="Undo";
    b.addEventListener("click", function(){
      t.hidden=true; clearTimeout(t._h);
      api("POST", "undo/"+undoToken).then(function(res){ return reload().then(function(){ closeDrawer(); toast(res.message||"Undone"); }); })
        .catch(function(e){ toast(e.message, true); });
    });
    t.appendChild(b);
  }
  t.hidden=false;
  clearTimeout(t._h); t._h=setTimeout(function(){ t.hidden=true; }, undoToken ? 14000 : 3000);
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
  var dealer = clientType==="Dealer";  /* a tier priced from the dealer column passes "Dealer" */
  var base = region==="West Bank"
    ? (dealer ? item.dealerPriceWB : item.endUserPriceWB)
    : (dealer ? item.dealerPrice48 : item.endUserPrice48);
  return num(base) + (service==="With Programming" ? num(item.programmingFee) : 0);
}
function itemCost(item){ return item ? num(item.cost!=null ? item.cost : item.baseCost) : 0; }

function serviceById(id){ return byId(state.services||[], id); }
function lineStandard(line, ctx){
  if(line.kind==="service"){ var sv=serviceById(line.serviceId); return sv ? num(sv.rate) : num(line.unitPrice); }
  if(line.kind==="combo"){
    var b=baseById(line.baseId), c=coverById(line.coverId);
    if(!b) return 0;
    return standardUnitPrice(b, ctx.clientType, ctx.region, ctx.service) + (c ? num(c.priceAddOn) : 0);
  }
  return standardUnitPrice(productById(line.productId), ctx.clientType, ctx.region, ctx.service);
}
function lineCost(line){
  if(line.kind==="service") return 0; /* labour: no stock, no cost of goods */
  if(line.kind==="combo") return itemCost(baseById(line.baseId)) + itemCost(coverById(line.coverId));
  return itemCost(productById(line.productId));
}
function lineName(line){
  if(line.kind==="service") return line.name || "Service";
  if(line.kind==="combo"){
    var b=baseById(line.baseId), c=coverById(line.coverId);
    if(!b) return "";
    return b.name + (c ? " · " + c.name : "");
  }
  var p=productById(line.productId);
  return p ? p.name : "";
}
function lineReady(line){
  if(line.kind==="service") return !!(line.name||"").trim();
  return line.kind==="combo" ? !!(line.baseId && line.coverId) : !!line.productId;
}

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
/* Versions: a revised quotation keeps its reference and gains -V2, -V3… */
function rootRefOf(t){ return t.rootRef || t.refNo; }
function versionsOf(t){
  var r=rootRefOf(t);
  return sortBy(state.transactions.filter(function(x){ return rootRefOf(x)===r; }), function(x){ return num(x.version)||1; });
}
function isSuperseded(t){
  var v=num(t.version)||1;
  return versionsOf(t).some(function(x){ return (num(x.version)||1)>v; });
}
function versionLabel(t){ return (num(t.version)||1)>1 ? "V"+num(t.version) : ""; }
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
      var left=lineLeft(li);
      if(kind==="product" && li.kind!=="combo" && li.productId===id) total+=left;
      if(kind==="base" && li.kind==="combo" && li.baseId===id) total+=left;
      if(kind==="cover" && li.kind==="combo" && li.coverId===id) total+=left;
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
function lineLeft(li){ return li.kind==="service" ? 0 : Math.max(0, num(li.qty)-num(li.deliveredQty)); }
function deliveredSome(t){ return (t.lineItems||[]).some(function(li){ return num(li.deliveredQty)>0; }); }
/* What a delivery would hand over now and what would still wait for stock.
   Same rule as the server: each line takes what the shelf has, a base + cover
   pair as many as the scarcer half allows. */
function deliveryPlan(t){
  var shelf={}, now=[], later=[];
  function onShelf(kind, id){
    var k=kind+":"+id;
    if(!(k in shelf)){ var it=byId(kind==="product"?state.products:(kind==="base"?state.bases:state.covers), id); shelf[k]=it ? Math.max(0,num(it.stockOnHand)) : 0; }
    return k;
  }
  (t.lineItems||[]).forEach(function(li){
    var left=lineLeft(li); if(!left) return;
    var keys = li.kind==="combo" ? [onShelf("base",li.baseId), onShelf("cover",li.coverId)] : [onShelf("product",li.productId)];
    var take=Math.min.apply(null, [left].concat(keys.map(function(k){ return shelf[k]; })));
    keys.forEach(function(k){ shelf[k]-=take; });
    if(take>0) now.push({name:li.name, qty:take});
    if(left-take>0) later.push({name:li.name, qty:left-take});
  });
  return {now:now, later:later};
}
function listQty(rows){ return rows.map(function(r){ return r.qty+" × "+r.name; }).join(", "); }
function availCell(kind, item){
  var a=availableOf(kind,item);
  return a<0 ? '<span style="color:var(--bad)">'+a+'</span>' : String(a);
}
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
    ["clients","products","bases","covers","transactions","expenses","employees","payroll","suppliers","orders","users","deliveries","trash","services","sets","tiers"].forEach(function(k){
      state[k] = d[k] || [];
    });
    state.user = d.user;
    applyRole();
    state.settings = Object.assign({}, DEFAULTS, d.settings || {});
    prepareWhiteLogo();
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
    return reload().then(function(){ if(okMsg) toast(okMsg, false, res && res.undo); if(done) done(res); });
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
  if(!window.confirm("Delete " + (what || "this record") + "? The owner can restore it from Recently deleted.")) return;
  send("DELETE", collection + "/" + id, null, function(){ closeForm(); if(done) done(); },
    "Deleted");
}
function isOwner(){ return !!(state.user && state.user.role==="owner"); }
function isManager(){ return !!(state.user && (state.user.role==="owner" || state.user.role==="admin")); }
function isSalesRole(){ return !!(state.user && state.user.role==="staff"); }
function costsVisible(){ return isOwner(); }
var ROLE_LABEL={owner:"Owner", admin:"Admin", staff:"Sales"};
function allowed(need){ return !need || (need==="owner" ? isOwner() : (need==="manager" ? isManager() : true)); }
/* Show each part of the page only to the roles that may use it; the server refuses the rest anyway. */
function applyRole(){
  if(!state.user) return;
  document.documentElement.setAttribute("data-role", state.user.role);
  document.querySelectorAll("[data-need]").forEach(function(el){ el.hidden = !allowed(el.dataset.need); });
  $("settings-link").textContent = isManager() ? "Company settings" : "My account";
  if(!isOwner() && (state.tab.inventory==="orders" || state.tab.inventory==="suppliers")){
    state.tab.inventory="stock";
    ["stock","orders","suppliers","deliver","services","sets"].forEach(function(k){ $("inv-pane-"+k).hidden = k!=="stock"; });
    $("inv-tabs").querySelectorAll("button").forEach(function(b){ b.setAttribute("aria-pressed", String(b.dataset.t==="stock")); });
  }
  if(!isOwner() && (state.view==="money" || state.view==="team")) setView("today");
}

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
  if(state.user && !isOwner() && (name==="money" || name==="team")) name="today";
  state.view = name;
  document.querySelectorAll(".view").forEach(function(v){ v.hidden = (v.id !== "view-"+name); });
  document.querySelectorAll(".nav-btn").forEach(function(b){ b.setAttribute("aria-current", String(b.dataset.view===name)); });
  var cfg = VIEWS[name] || VIEWS.today;
  $("view-title").textContent = cfg.title;
  var pa = $("primary-action");
  if(cfg.action){ pa.hidden=false; pa.textContent=cfg.action.label; pa.onclick=cfg.action.fn; } else { pa.hidden=true; }
  if(name==="inventory") syncInventoryAction();
  if(name==="settings") $("view-title").textContent = isManager() ? "Company settings" : "My account";
  window.scrollTo(0,0);
  render();
}
function syncInventoryAction(){
  var pa=$("primary-action");
  if(state.tab.inventory==="orders"){ pa.textContent="New purchase order"; pa.onclick=function(){ editOrder(null); }; }
  else if(state.tab.inventory==="suppliers"){ pa.textContent="Add supplier"; pa.onclick=function(){ editSupplier(null); }; }
  else if(state.tab.inventory==="services"){ pa.textContent="Add service"; pa.onclick=function(){ editService(null); }; }
  else if(state.tab.inventory==="sets"){ pa.textContent="New offer"; pa.onclick=function(){ openComposer(); }; }
  else { pa.textContent="Add product"; pa.onclick=function(){ editStock("product", null); }; }
  /* The catalogue is kept by owners and admins. */
  if(state.user && !isManager() && state.tab.inventory!=="sets") pa.hidden=true;
  else if(state.view==="inventory") pa.hidden=false;
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
  $("inv-pane-deliver").hidden = v!=="deliver";
  $("inv-pane-services").hidden = v!=="services";
  $("inv-pane-sets").hidden = v!=="sets";
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
    var fields=g.fields.filter(Boolean); /* a field can be left out for a role */
    var cols = fields.length>=3 ? "g3" : (fields.length===2 ? "g2" : "");
    return '<div class="grid '+cols+'">' + fields.map(fieldHtml).join("") + '</div>';
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

[["drawer-overlay",closeDrawer],["form-overlay",closeForm],["composer",composerBackdrop],
 ["doc-overlay",function(){ $("doc-overlay").hidden=true; }],["palette",closePalette]].forEach(function(p){
  $(p[0]).addEventListener("click", function(e){ if(e.target===$(p[0])) p[1](); });
});
document.addEventListener("keydown", function(e){
  if(e.key==="Escape"){
    if(!$("palette").hidden) return closePalette();
    if(!$("doc-overlay").hidden) return ($("doc-overlay").hidden=true);
    if(!$("form-overlay").hidden) return closeForm();
    if(!$("drawer-overlay").hidden) return closeDrawer();
    if(!$("composer").hidden) return composerBackdrop();
  }
  if((e.metaKey||e.ctrlKey) && e.key.toLowerCase()==="k"){ e.preventDefault(); openPalette(); }
});

/* ============================================================
   12. SEARCH / COMMAND PALETTE
   ============================================================ */
function searchIndex(){
  var out=[];
  state.transactions.forEach(function(t){
    out.push({label:t.clientName||"—", meta:t.refNo+(t.site ? " · "+t.site : "")+(t.soldBy ? " · "+t.soldBy : ""), type:t.status, go:function(){ setView("sales"); openTx(t.id); }});
  });
  state.clients.forEach(function(c){
    out.push({label:c.name, meta:c.type+" · "+c.region, type:"Contact", go:function(){ setView("contacts"); openContact(c.id); }});
  });
  allStockRows().forEach(function(r){
    out.push({label:r.label, meta:money(itemCost(r.item))+" cost", type:"Stock", go:function(){ setView("inventory"); openStockItem(r.kind, r.item); }});
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
  if(state.user) $("who").textContent = state.user.name + " · " + (ROLE_LABEL[state.user.role]||state.user.role);
}

/* ============================================================
   14. RENDER DISPATCH
   ============================================================ */
function figure(name, value, small){
  return '<div class="figure"><div class="v'+(small?" small":"")+'">'+value+'</div><div class="n">'+esc(name)+'</div></div>';
}
function dealStage(t){
  return t.status==="Invoiced" && deliveredSome(t) ? '<span class="pill info">Part delivered</span>' : stagePill(t.status);
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
  if(state.view==="settings"){ renderSettings(); renderAccounts(); renderData(); }
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
  state.transactions.filter(isLive).forEach(function(t){
    (t.milestones||[]).forEach(function(m){
      if(m.paid || !m.dueDate) return;
      var late=daysSince(m.dueDate);
      if(late==null || late<=0) return;
      items.push({sev:"bad", area:"sales", title:t.clientName+" — "+m.label+" is overdue",
        detail:t.refNo+" · due "+fmtDate(m.dueDate)+" · "+late+" day"+(late>1?"s":"")+" late", value:money(m.amount),
        go:function(){ setView("sales"); openTx(t.id); }});
    });
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
  state.transactions.filter(function(t){ return t.status==="Quotation" && !isSuperseded(t); }).forEach(function(t){
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
        value:"", go:function(){ setView("inventory"); openStockItem(r.kind, r.item); }});
    }
  });
  state.transactions.filter(function(t){ return t.status==="Invoiced" && deliveredSome(t); }).forEach(function(t){
    var plan=deliveryPlan(t);
    if(!plan.now.length) return;
    items.push({sev:"warn", area:"inventory", title:"Stock is in — deliver the rest to "+t.clientName,
      detail:t.refNo+" · "+listQty(plan.now), value:"", go:function(){ setView("sales"); openTx(t.id); }});
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
  var noCost = costsVisible() ? allStockRows().filter(function(r){ return itemCost(r.item)<=0; }) : [];
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
  var live=state.transactions.filter(isLive);
  $("today-figs").innerHTML = costsVisible() ?
    figure("Collected in "+monthShort(mk), money0(pl.collected)) +
    figure("Outstanding from clients", money0(outstandingTotal())) +
    figure("Stock at cost", money0(stockValue())) +
    figure("Net this month", money0(pl.net)) :
    figure("Collected in "+monthShort(mk), money0(pl.collected)) +
    figure("Outstanding from clients", money0(outstandingTotal())) +
    figure("In the pipeline", money0(sum(live.filter(function(t){ return (t.status==="Quotation" || t.status==="Agreement") && !isSuperseded(t); }), txTotal))) +
    figure("Invoiced in "+monthShort(mk), money0(pl.sales));

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

  /* The month's profit and loss is built from cost prices: the owner's view only. */
  $("month-summary").closest(".panel").hidden = !costsVisible();
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
    acts.push({date:txRecognisedDate(t)||txDocDate(t), html:'<td>'+dealStage(t)+'</td><td>'+esc(t.clientName||"")+
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
function myName(){ return state.user ? String(state.user.name||"").trim().toLowerCase() : ""; }
function salesRows(){
  var f=state.filters.sales, rows=state.transactions;
  if(f==="mine"){
    /* Sold by me, or written from my account. */
    var me=myName();
    return rows.filter(function(t){ return isLive(t) && ((me && (t.soldBy||"").trim().toLowerCase()===me) || (state.user && t.createdBy===state.user.id)); });
  }
  if(f==="fromsales") return rows.filter(function(t){ return isLive(t) && t.fromSales; });
  if(f==="open") return rows.filter(function(t){ return isLive(t) && t.status!=="Delivered"; });
  if(f==="unpaid") return rows.filter(function(t){ return isLive(t) && txBalance(t)>0.004; });
  if(f==="all") return rows;
  return rows.filter(function(t){ return t.status===f; });
}
function renderSales(){
  var live=state.transactions.filter(isLive);
  /* A superseded version is still listed, but it is not a second job. */
  var pipeline=live.filter(function(t){ return (t.status==="Quotation" || t.status==="Agreement") && !isSuperseded(t); });
  var mk=thisMonth();
  var billedThis=live.filter(function(t){ return isBilled(t) && monthKey(txRecognisedDate(t))===mk; });
  var withCost=live.filter(txHasCost);
  var marginPct = sum(withCost,txSubtotal)>0 ? sum(withCost,txMargin)/sum(withCost,txSubtotal) : 0;

  $("sales-figs").innerHTML =
    figure("In the pipeline", money0(sum(pipeline,txTotal))) +
    figure("Invoiced in "+monthShort(mk), money0(sum(billedThis,txTotal))) +
    figure("Outstanding", money0(outstandingTotal())) +
    (costsVisible() ? figure("Average margin", withCost.length ? pct(marginPct,0) : "—") : figure("Deals this month", String(live.filter(function(t){ return monthKey(txDocDate(t))===mk; }).length)));

  var rows=salesRows();
  $("sales-count").textContent = rows.length + (rows.length===1?" deal":" deals") +
    (state.filters.sales==="mine" ? " sold by you or written from your account" : "") +
    (state.filters.sales==="fromsales" ? " written by the sales team (staff accounts)" : "");
  $("sales-body").innerHTML = rows.length ? rows.map(function(t){
    var bal=txBalance(t), age=txAge(t), overdue = bal>0.004 && isBilled(t) && age!=null && age>num(state.settings.overdueDays);
    var m = txHasCost(t) ? pct(txMargin(t)/(txSubtotal(t)||1),0) : '<span class="faint">—</span>';
    return '<tr class="clickable" data-tx="'+t.id+'">'+
      '<td class="mono">'+esc(t.refNo)+(versionLabel(t) || isSuperseded(t) ? ' <span class="pill '+(isSuperseded(t)?"neutral":"info")+'">'+(versionLabel(t)||"V1")+'</span>' : '')+
        '<div class="tiny faint">'+fmtDate(txDocDate(t))+(isSuperseded(t) ? ' · superseded' : '')+'</div></td>'+
      '<td class="strong">'+esc(t.clientName||"—")+'<div class="tiny faint">'+esc(t.region||"")+' · '+esc(t.clientType||"")+
        (t.soldBy ? ' · '+esc(t.soldBy) : '')+'</div>'+(t.site ? '<div class="tiny muted">'+esc(t.site)+'</div>' : '')+'</td>'+
      '<td>'+dealStage(t)+'</td>'+
      '<td class="num">'+money(txTotal(t))+'</td>'+
      '<td class="num">'+balanceCell(t)+'</td>'+
      '<td>'+(isLive(t) && bal>0.004 && age!=null ? '<span class="pill '+(overdue?"bad":"neutral")+'">'+age+'d</span>' : '<span class="faint tiny">—</span>')+'</td>'+
      '<td class="num c-cost">'+m+'</td>'+
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
  var plan=t.status==="Invoiced" ? deliveryPlan(t) : {now:[], later:[]};
  var showDelivered=t.status==="Invoiced" || t.status==="Delivered";
  var next={Quotation:["Agreement","Cancelled"], Agreement:["Invoiced","Cancelled"], Invoiced:["Delivered","Cancelled"], Delivered:[], Cancelled:[]}[t.status]||[];
  var lines=(t.lineItems||[]).map(function(li){
    var unitCost = li.costSnapshot!=null ? num(li.costSnapshot) : lineCost(li);
    var lineMargin = num(li.qty)*(num(li.unitPrice)-unitCost);
    var left=lineLeft(li);
    return '<tr><td>'+esc(li.name)+(li.kind==="service" ? '<div class="tiny faint">labour · no stock</div>' : '')+'</td><td class="num">'+num(li.qty)+(li.unit ? ' <span class="tiny faint">'+esc(li.unit)+'</span>' : '')+'</td>'+
      (showDelivered ? '<td class="num">'+(li.kind==="service" ? '<span class="faint">—</span>' : (left>0 ? '<span style="color:var(--warn)">'+num(li.deliveredQty)+'</span>' : num(li.deliveredQty)))+'</td>' : '')+
      '<td class="num">'+money(li.unitPrice)+'</td>'+
      '<td class="num c-cost">'+(unitCost>0 ? money(lineMargin) : '<span class="faint">—</span>')+'</td>'+
      '<td class="num">'+money(num(li.qty)*num(li.unitPrice))+'</td></tr>';
  }).join("");

  var html =
    '<div class="grid g3">'+
      '<div class="kv"><span class="k">Stage</span><span class="v">'+dealStage(t)+'</span></div>'+
      '<div class="kv"><span class="k">Payment</span><span class="v">'+payPill(t)+'</span></div>'+
      '<div class="kv"><span class="k">Programming</span><span class="v">'+esc(t.serviceType==="With Programming"?"Included":"Supply only")+'</span></div>'+
      '<div class="kv"><span class="k">Client</span><span class="v">'+esc(t.clientName||"")+'</span></div>'+
      '<div class="kv"><span class="k">Region</span><span class="v">'+esc(t.region||"")+'</span></div>'+
      (t.site ? '<div class="kv"><span class="k">Site</span><span class="v">'+esc(t.site)+'</span></div>' : '')+
      (t.soldBy ? '<div class="kv"><span class="k">Sold by</span><span class="v">'+esc(t.soldBy)+'</span></div>' : '')+
      (t.createdByName && t.createdByName!==t.soldBy ? '<div class="kv"><span class="k">Written by</span><span class="v">'+esc(t.createdByName)+'</span></div>' : '')+
      '<div class="kv"><span class="k">Dated</span><span class="v">'+fmtDate(txDocDate(t))+'</span></div>'+
    '</div>'+
    '<div class="panel"><div class="table-wrap"><table>'+
      '<thead><tr><th>Item</th><th class="num">Qty</th>'+(showDelivered?'<th class="num">Delivered</th>':'')+'<th class="num">Price</th><th class="num c-cost">Margin</th><th class="num">Total</th></tr></thead>'+
      '<tbody>'+(lines||emptyRow(5,"No items"))+'</tbody></table></div></div>'+
    '<div class="totals">'+
      '<div class="r"><span class="l">Subtotal</span><span class="mono">'+money(txSubtotal(t))+'</span></div>'+
      (num(t.vatPct)>0 ? '<div class="r"><span class="l">VAT '+num(t.vatPct)+'%</span><span class="mono">'+money(txVat(t))+'</span></div>' : '')+
      '<div class="r"><span class="l">Paid</span><span class="mono">'+money(txPaid(t))+'</span></div>'+
      (txHasCost(t) ? '<div class="r c-cost"><span class="l">Margin</span><span class="mono">'+money(txMargin(t))+' · '+pct(txMargin(t)/(txSubtotal(t)||1),0)+'</span></div>' : '')+
      (due>0.004 ? '<div class="r grand"><span class="l">Refund due to client</span><span class="v">'+money(due)+'</span></div>'
        : (live ? '<div class="r grand"><span class="l">Balance</span><span class="v">'+money(Math.max(0,txBalance(t)))+'</span></div>' : ''))+
    '</div>'+
    ((t.milestones||[]).length ? '<div class="section"><p class="eyebrow">Payment schedule</p><div class="panel"><div class="table-wrap"><table><tbody>'+
      t.milestones.map(function(m){
        var overdue = live && !m.paid && m.dueDate && daysSince(m.dueDate)>0;
        return '<tr><td>'+esc(m.label)+'</td><td class="tiny muted">'+(m.dueDate ? fmtDate(m.dueDate) : "no date")+'</td>'+
          '<td>'+(m.paid ? '<span class="pill good">Paid '+fmtDate(m.paidDate)+'</span>' : (overdue ? '<span class="pill bad">Overdue</span>' : '<span class="pill neutral">Due</span>'))+'</td>'+
          '<td class="num">'+money(m.amount)+'</td>'+
          '<td style="text-align:right">'+(!m.paid && live ? '<button class="btn sm" type="button" data-ms="'+m.id+'">Record</button>' : '')+'</td></tr>';
      }).join("")+'</tbody></table></div></div></div>' : '')+
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
      (t.status==="Quotation" ? '<button class="btn sm" type="button" id="tx-revise">Revise for the client</button>' : '')+
      (t.status==="Quotation" ? '<button class="btn quiet sm" type="button" id="tx-edit">Edit</button>' : '')+
      next.filter(function(a){ return !(a==="Cancelled" && deliveredSome(t)); }).map(function(a){
        var label = a==="Cancelled" ? "Cancel deal" : (a!=="Delivered" ? "Move to "+a : (plan.later.length ? "Deliver what is in stock" : "Deliver"));
        var blocked = a==="Delivered" && !plan.now.length;
        return '<button class="btn sm '+(a==="Cancelled"?"danger":"primary")+'" data-adv="'+a+'" type="button"'+(blocked?' data-blocked="1"':'')+'>'+label+'</button>'; }).join("")+
      '<button class="btn sm" type="button" data-doc="Quotation">Quotation</button>'+
      (t.agreementDate||isBilled(t) ? '<button class="btn sm" type="button" data-doc="Agreement">Agreement</button>' : '')+
      (isBilled(t) ? '<button class="btn sm" type="button" data-doc="Invoice">Invoice</button>' : '')+
      (deliveredSome(t) ? '<button class="btn sm" type="button" data-doc="Delivery Note">Delivery note</button>' : '')+
      (txPaid(t)>0 ? '<button class="btn sm" type="button" data-doc="Receipt">Receipt</button>' : '')+
    '</div>'+
    (plan.later.length ?
      '<p class="tiny" style="color:var(--warn)">'+(plan.now.length ? 'Delivering now: '+esc(listQty(plan.now))+'.<br>' : 'Nothing in stock to deliver yet.<br>')+
      'Still to come: '+esc(listQty(plan.later))+'. It stays on the To deliver list until the stock arrives.</p>' : '')+
    (t.notes ? '<p class="tiny muted">'+esc(t.notes)+'</p>' : '')+
    (versionsOf(t).length>1 ? '<p class="tiny muted">Versions: '+versionsOf(t).map(function(x){
      return x.id===t.id ? '<b>'+esc(x.refNo)+'</b>' : '<a href="#" data-ver="'+x.id+'">'+esc(x.refNo)+'</a>'+(x.status==="Cancelled" ? ' (cancelled)' : '');
    }).join(" · ")+(isSuperseded(t) ? ' — a newer version exists' : '')+'</p>' : '');

  openDrawer(t.refNo + " · " + (t.clientName||""), html);
  $("drawer-body").querySelectorAll("[data-adv]").forEach(function(b){
    b.addEventListener("click", function(){
      if(b.dataset.blocked){ toast("Nothing to deliver yet: none of the remaining items are in stock", true); return; }
      advance(t, b.dataset.adv);
    });
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
  if($("tx-edit")) $("tx-edit").addEventListener("click", function(){ closeDrawer(); openComposer(t, "edit"); });
  if($("tx-revise")) $("tx-revise").addEventListener("click", function(){ closeDrawer(); openComposer(t, "revise"); });
  $("drawer-body").querySelectorAll("[data-ver]").forEach(function(a){
    a.addEventListener("click", function(e){ e.preventDefault(); openTx(a.dataset.ver); });
  });
  $("drawer-body").querySelectorAll("[data-ms]").forEach(function(b){
    b.addEventListener("click", function(){
      var m=byId(t.milestones||[], b.dataset.ms); if(!m) return;
      /* The method chosen in the payment box below applies to the stage too. */
      send("POST", "transactions/"+t.id+"/milestones/"+m.id+"/pay", {method:$("tx-meth") ? val("tx-meth") : "Bank Transfer", date:todayISO()},
        function(){ openTx(t.id); }, money(m.amount)+" recorded for "+m.label);
    });
  });
}
function advance(t, next){
  if(next==="Cancelled" && !window.confirm("Cancel "+t.refNo+"? The deal stays on record as cancelled."+
    (txPaid(t)>0.004 ? "\n\nThe client has paid "+money(txPaid(t))+". It stays in the cash ledger until you record the refund from this deal." : ""))) return;
  if(next==="Delivered"){
    /* Hands over what is on the shelf; anything short waits on the To deliver list. */
    send("POST", "transactions/"+t.id+"/deliver", {}, function(res){
      closeDrawer();
      toast(res && res.complete ? t.refNo+" is fully delivered" : t.refNo+" part delivered — still to come: "+listQty((res&&res.waiting)||[]), false, res && res.undo);
    });
    return;
  }
  if(next==="Agreement"){
    var others=versionsOf(t).filter(function(x){ return x.id!==t.id && x.status==="Quotation"; });
    if(others.length && !window.confirm("Confirm "+t.refNo+"?\n\nOnly one version can become the deal, so "+
      others.map(function(x){ return x.refNo; }).join(", ")+(others.length===1 ? " will be cancelled." : " will be cancelled."))) return;
  }
  send("POST", "transactions/"+t.id+"/advance", {status:next}, function(res){
    closeDrawer();
    var n=res && res.closedVersions;
    toast(t.refNo+" is now "+next.toLowerCase()+(n ? " — "+n+(n===1 ? " other version" : " other versions")+" cancelled" : ""), false, res && res.undo);
  });
}

/* ============================================================
   17. OFFER COMPOSER
   ============================================================ */
/* With a quotation, the composer edits it; without, it starts a new offer. */
function blankLine(){ return {kind:"product", productId:"", baseId:"", coverId:"", serviceId:"", name:"", unit:"", qty:1, unitPrice:0, touched:false}; }
function linesFrom(t){
  return (t.lineItems||[]).map(function(li){
    return {kind:li.kind, productId:li.productId||"", baseId:li.baseId||"", coverId:li.coverId||"", serviceId:li.serviceId||"",
      name:li.kind==="service" ? li.name : "", unit:li.unit||"", qty:num(li.qty), unitPrice:num(li.unitPrice), touched:true};
  });
}
/* mode: "new", "edit" (fix the quotation itself) or "revise" (save a new version for the client). */
function openComposer(tx, mode){
  var src = tx && tx.id ? tx : null;
  mode = src ? (mode || "edit") : "new";
  if(mode==="revise") src = versionsOf(src).slice(-1)[0] || src;
  var nextVersion = mode==="revise" ? Math.max.apply(null, versionsOf(src).map(function(x){ return num(x.version)||1; }))+1 : 0;
  state.offer={mode:mode, editId: mode==="edit" ? src.id : null, ref: src ? src.refNo : "", setId: src ? (src.setId||"") : "",
    reviseOf: mode==="revise" ? {id:src.id, root:rootRefOf(src), version:nextVersion} : null,
    paidStages: src ? (src.milestones||[]).filter(function(m){ return m.paid; }) : [],
    milestones: src ? (src.milestones||[]).filter(function(m){ return !m.paid; }).map(function(m){ return {label:m.label, amount:num(m.amount), dueDate:m.dueDate||""}; }) : [],
    lines: src ? linesFrom(src) : [blankLine()]};
  $("of-title").textContent = mode==="edit" ? "Edit quotation "+src.refNo
    : (mode==="revise" ? "Revise "+src.refNo+" for the client — saves as "+state.offer.reviseOf.root+"-V"+nextVersion : "New price offer");
  $("of-save").textContent = mode==="edit" ? "Save changes" : (mode==="revise" ? "Save as V"+nextVersion : "Save quotation");
  $("of-paid-wrap").hidden = $("of-method-wrap").hidden = !!src;
  $("of-date").value = mode==="edit" ? txDocDate(src) : todayISO();
  $("of-paid").value=0;
  $("of-notes").value = src ? (src.notes||"") : "";
  $("of-site").value = src ? (src.site||"") : "";
  /* New offers are stamped with whoever writes them; anyone can be named instead. */
  $("of-seller").value = src ? (src.soldBy||"") : (state.user ? state.user.name : "");
  var names={};
  state.transactions.forEach(function(t){ if(t.soldBy) names[t.soldBy]=1; });
  (state.users||[]).forEach(function(u){ names[u.name]=1; });
  if(state.user) names[state.user.name]=1;
  $("seller-list").innerHTML = Object.keys(names).sort().map(function(n){ return '<option value="'+esc(n)+'">'; }).join("");
  $("of-due").value = src ? (src.dueDate||"") : "";
  $("composer").hidden=false;
  renderComposer();
  renderMilestones();
  if(src){
    $("of-client").value=src.clientId||"";
    $("of-region").value=src.region||"West Bank";
    setRadio("oftype", src.typeCode==="P" ? "Partner" : "Direct");
    setRadio("ofservice", src.serviceType||"With Programming");
    renderComposer();
  }
  if(mode==="revise") toast("Revising "+src.refNo+" — it will be saved as V"+nextVersion+"; the earlier version stays");
  /* A new offer left unsaved last time can be picked up again. */
  if(mode==="new"){
    var kept=readDraft();
    if(kept && window.confirm("You have an offer that was never saved (from "+fmtDate(String(kept.savedAt).slice(0,10))+").\n\nOK to carry on with it, Cancel to start this one fresh.")) restoreDraft(kept);
    else if(kept) clearDraft();
  }
}
function setRadio(name, value){
  document.querySelectorAll('input[name="'+name+'"]').forEach(function(r){ r.checked = r.value===value; });
}
function radioVal(name){ var el=document.querySelector('input[name="'+name+'"]:checked'); return el ? el.value : ""; }

/* ---------- Not losing a half-written offer ----------
   Whatever is on screen is kept as a draft in this browser, so a closed tab or a stray
   click can be picked up again. It is a safety net, never a second copy: saving clears it. */
function draftKey(){ return "nestify.offer.draft."+(state.user ? state.user.id : "anon"); }
function offerHasContent(){
  var o=state.offer||{};
  if((o.lines||[]).some(function(l){ return l.productId || l.baseId || l.serviceId || (l.name||"").trim(); })) return true;
  if((o.milestones||[]).length) return true;
  return !!(val("of-client") || val("of-site") || val("of-notes") || valNum("of-paid")>0);
}
function saveDraft(){
  if($("composer").hidden || !state.offer || state.offer.mode==="edit") return;
  try{
    if(!offerHasContent()){ window.localStorage.removeItem(draftKey()); return; }
    window.localStorage.setItem(draftKey(), JSON.stringify({savedAt:new Date().toISOString(),
      offer:{mode:state.offer.mode, reviseOf:state.offer.reviseOf, setId:state.offer.setId||"", lines:state.offer.lines, milestones:state.offer.milestones||[],
        paidStages:state.offer.paidStages||[], ref:state.offer.ref||""},
      fields:{client:val("of-client"), region:val("of-region"), date:val("of-date"), site:val("of-site"), seller:val("of-seller"),
        paid:val("of-paid"), method:val("of-method"), due:val("of-due"), notes:val("of-notes"), type:radioVal("oftype"), service:radioVal("ofservice")}}));
  }catch(e){}
}
var draftTimer=null;
function scheduleDraftSave(){ clearTimeout(draftTimer); draftTimer=setTimeout(saveDraft, 400); }
function clearDraft(){ try{ window.localStorage.removeItem(draftKey()); }catch(e){} }
function readDraft(){
  try{ var d=JSON.parse(window.localStorage.getItem(draftKey())||"null"); return d && d.offer && (d.offer.lines||[]).length ? d : null; }catch(e){ return null; }
}
function restoreDraft(d){
  var o=d.offer, f=d.fields||{};
  /* A draft revision only comes back while its quotation can still be revised. */
  var rv=o.reviseOf && byId(state.transactions, o.reviseOf.id);
  var asRevision = !!(rv && rv.status==="Quotation");
  state.offer={mode: asRevision ? "revise" : "new", editId:null, reviseOf: asRevision ? o.reviseOf : null, setId:o.setId||"", ref:o.ref||"",
    lines:o.lines||[blankLine()], milestones:o.milestones||[], paidStages: asRevision ? (o.paidStages||[]) : []};
  $("of-client").value=f.client||""; $("of-region").value=f.region||"West Bank"; $("of-date").value=f.date||todayISO();
  $("of-site").value=f.site||""; $("of-seller").value=f.seller||""; $("of-paid").value=f.paid||0; $("of-method").value=f.method||"Cash";
  $("of-due").value=f.due||""; $("of-notes").value=f.notes||"";
  setRadio("oftype", f.type||"Direct"); setRadio("ofservice", f.service||"With Programming");
  $("of-paid-wrap").hidden = $("of-method-wrap").hidden = asRevision;
  $("of-title").textContent = asRevision ? "Revise "+state.offer.ref+" for the client — saves as "+o.reviseOf.root+"-V"+o.reviseOf.version : "New price offer";
  $("of-save").textContent = asRevision ? "Save as V"+o.reviseOf.version : "Save quotation";
  renderComposer(); renderMilestones();
  toast("Picked up where you left off");
}
$("composer").addEventListener("input", scheduleDraftSave);
$("composer").addEventListener("change", scheduleDraftSave);
/* Leaving on purpose asks first when something has been written; a stray click does not leave at all. */
function requestCloseComposer(){
  if(offerHasContent() && state.offer.mode!=="edit" && !window.confirm("Discard this offer? What you have written here will be lost.")) return;
  clearDraft(); closeComposer();
}
function composerBackdrop(){
  if(!offerHasContent()){ closeComposer(); return; }
  toast("Your offer is still here — Save it when it is ready, or Discard to leave it");
}

/* ---------- Offer sets ---------- */
function setContents(st){ return (st.lines||[]).map(function(l){ return lineName(l) || l.name || "—"; }); }
function renderSetPicker(){
  var sel=$("of-set"); if(!sel) return;
  var sets=sortBy(state.sets, function(x){ return x.name||""; });
  sel.innerHTML='<option value="">Start from a set…</option>'+sets.map(function(x){
    return '<option value="'+x.id+'">'+esc(x.name)+' · '+(x.lines||[]).length+' rows</option>'; }).join("")+
    (sets.length ? '' : '<option value="" disabled>— none saved yet —</option>');
  sel.value="";
}
/* Applying a set adds its rows at quantity 0, so only the quantities are left to type; it never takes away what is written. */
function applySet(id){
  var st=byId(state.sets, id); if(!st) return;
  var rows=(st.lines||[]).map(function(l){
    var sv=l.kind==="service" && l.serviceId ? serviceById(l.serviceId) : null;
    return {kind:l.kind||"product", productId:l.productId||"", baseId:l.baseId||"", coverId:l.coverId||"", serviceId:l.serviceId||"",
      name:l.kind==="service" ? (l.name || (sv && sv.name) || "") : "", unit:l.unit||(sv && sv.unit)||"", qty:0,
      unitPrice: sv ? num(sv.rate) : 0, touched: l.kind==="service"};
  });
  var kept=state.offer.lines.filter(lineReady);
  state.offer.lines=kept.concat(rows);
  state.offer.setId=st.id;
  renderComposer(); scheduleDraftSave();
  var first=$("of-lines").querySelector('.li[data-i="'+kept.length+'"] [data-f="qty"]'); if(first) first.focus();
  toast(rows.length+" rows added — type the quantities; rows left at 0 print as options");
}
$("of-set").addEventListener("change", function(){ var v=this.value; this.value=""; if(v) applySet(v); });
$("of-set-save").addEventListener("click", function(){
  var rows=state.offer.lines.filter(lineReady);
  if(!rows.length){ toast("Put some rows in the offer first", true); return; }
  openForm("Save these rows as a set", [
    {fields:[{id:"ls-name", label:"Name it", placeholder:"3-bedroom flat — the usual rows", value:""}]},
    {note:rows.length+" rows will be saved: "+rows.map(lineName).join(", ")+". Quantities and prices are not saved — a set is the list, not the order."}
  ], function(){
    if(!val("ls-name")){ toast("Give it a name first", true); return false; }
    save("offer_sets", null, {name:val("ls-name"), lines:rows.map(function(l){
      return {kind:l.kind, productId:l.productId||null, baseId:l.baseId||null, coverId:l.coverId||null, serviceId:l.serviceId||null,
        name:l.kind==="service" ? (l.name||"") : null, unit:l.unit||null};
    })}, function(){ renderSetPicker(); toast("Saved as a set — it is on the list next time"); });
  });
});
$("of-clear-empty").addEventListener("click", function(){
  var before=state.offer.lines.length;
  var kept=state.offer.lines.filter(function(l){ return lineReady(l) && num(l.qty)>0; });
  if(!kept.length) kept=[blankLine()];
  var gone=before-kept.length;
  if(!gone){ toast("Every row has a quantity already"); return; }
  state.offer.lines=kept; renderComposer(); scheduleDraftSave();
  toast(gone+(gone===1 ? " empty row removed" : " empty rows removed"));
});
function renderSets(){
  var used={};
  state.transactions.forEach(function(t){ if(t.setId) used[t.setId]=(used[t.setId]||0)+1; });
  $("sets-body").innerHTML = state.sets.length ? sortBy(state.sets, function(x){ return x.name||""; }).map(function(x){
    var what=setContents(x);
    return '<tr class="clickable" data-set="'+x.id+'"><td class="strong">'+esc(x.name)+'</td><td class="num">'+what.length+'</td>'+
      '<td class="tiny muted">'+esc(what.slice(0,4).join(", ")+(what.length>4 ? " +"+(what.length-4)+" more" : ""))+'</td>'+
      '<td class="num">'+(used[x.id]||'<span class="faint">—</span>')+'</td></tr>';
  }).join("") : emptyRow(4,"No sets yet — write an offer the way you like it, then Save as a set.");
  $("sets-body").querySelectorAll("[data-set]").forEach(function(r){
    r.addEventListener("click", function(){ editSet(byId(state.sets, r.dataset.set)); });
  });
}
function editSet(st){
  openForm("Offer set", [
    {fields:[{id:"ls-name", label:"Name", value:st.name}]},
    {note:"Rows: "+setContents(st).join(", ")+". To change the rows, start an offer from this set, change it, and save it as a new set."}
  ], function(){
    if(!val("ls-name")){ toast("Give it a name first", true); return false; }
    save("offer_sets", st.id, {name:val("ls-name")}, function(){ toast("Set renamed"); });
  }, function(){ remove("offer_sets", st.id, "the set “"+st.name+"”"); });
}
function closeComposer(){ $("composer").hidden=true; }
$("of-cancel").addEventListener("click", requestCloseComposer);
$("of-add").addEventListener("click", function(){
  state.offer.lines.push(blankLine());
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
  var ctx = {
    client:c, region:$("of-region").value, date:$("of-date").value||todayISO(),
    type: typeEl?typeEl.value:"Direct", service: svcEl?svcEl.value:"With Programming",
    clientType: c?c.type:"End User", discount: c?num(c.discountPct):0,
    tier: c?tierById(c.tierId):null
  };
  /* A tier decides the price column; its discount stacks with the contact's own extra discount. */
  if(ctx.tier){
    ctx.clientType = ctx.tier.basis==="Dealer" ? "Dealer" : "End User";
    ctx.discount = 1-(1-num(ctx.tier.discountPct))*(1-ctx.discount);
  }
  return ctx;
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
  $("of-ref").textContent = state.offer.reviseOf ? state.offer.reviseOf.root+"-V"+state.offer.reviseOf.version
    : (state.offer.editId ? (/-V\d+$/.test(state.offer.ref) ? state.offer.ref : state.offer.ref.slice(0,4) + regionCode(ctx.region) + typeCode(ctx.type) + state.offer.ref.slice(6))
    : buildRef(ym, regionCode(ctx.region), typeCode(ctx.type), nextSeq(ym)));
  renderSetPicker();

  var groups={};
  state.bases.forEach(function(b){ var k=b.line||"Other"; (groups[k]=groups[k]||[]).push(b); });

  $("of-lines").innerHTML = state.offer.lines.map(function(ln,i){
    /* The client's standing discount applies to the price book, not to labour rates. */
    var std=lineStandard(ln,ctx), suggested = ln.kind==="service" ? std : std*(1-ctx.discount);
    if(!ln.touched) ln.unitPrice=Math.round(suggested*100)/100;
    var cost=lineCost(ln), lineTotal=num(ln.qty)*num(ln.unitPrice);
    var off=num(ln.unitPrice)-suggested;
    var marginTxt = costsVisible() ? (cost>0 ? pct((num(ln.unitPrice)-cost)/(num(ln.unitPrice)||1),0) : "—") : "";
    var itemVal = ln.kind==="service" ? (ln.serviceId ? "s:"+ln.serviceId : "s:custom")
      : (ln.kind==="combo" ? (ln.baseId?"b:"+ln.baseId:"") : (ln.productId?"p:"+ln.productId:""));
    var activeServices=(state.services||[]).filter(function(sv){ return sv.active!==false; });
    var avail = null;
    if(ln.kind==="combo"){ var bb=baseById(ln.baseId), cc=coverById(ln.coverId);
      if(bb) avail=availableOf("base",bb); if(cc) avail=Math.min(avail==null?Infinity:avail, availableOf("cover",cc)); }
    else if(ln.kind!=="service"){ var pp=productById(ln.productId); if(pp) avail=availableOf("product",pp); }
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
          '<optgroup label="Labour and services">'+activeServices.map(function(sv){
            return '<option value="s:'+sv.id+'"'+(itemVal==="s:"+sv.id?" selected":"")+'>'+esc(sv.name)+(sv.unit?' — per '+esc(sv.unit):'')+'</option>'; }).join("")+
            '<option value="s:custom"'+(itemVal==="s:custom"?" selected":"")+'>Something else — type it in</option></optgroup>'+
        '</select>'+
        (ln.kind==="service" ? '<input data-f="svcname" type="text" style="margin-top:6px" placeholder="What the work is" value="'+esc(ln.name||"")+'">'+
          '<div class="tiny faint" style="margin-top:4px">labour · no stock'+(ln.unit ? ' · per '+esc(ln.unit) : '')+'</div>' : '')+
        (ln.kind==="combo" ? '<select data-f="cover"><option value="">Choose colour and finish…</option>'+covers.map(function(c){
          return '<option value="'+c.id+'"'+(c.id===ln.coverId?" selected":"")+'>'+esc(c.name)+'</option>'; }).join("")+'</select>' : '')+
      '</div>'+
      '<div><div class="lbl">'+(ln.kind==="service" ? "Units" : "Qty")+'</div><input data-f="qty" type="number" min="0" step="1" value="'+num(ln.qty)+'">'+
        (num(ln.qty)===0 && lineReady(ln) ? '<div class="tiny faint" style="margin-top:4px">optional</div>' : '')+
        (avail!=null && num(ln.qty)>avail ? '<div class="tiny" style="color:var(--warn); margin-top:4px">'+(avail>0 ? 'only '+avail+' available' : 'none available')+'</div>' : '')+'</div>'+
      '<div><div class="lbl">Book price</div><div class="fixed">'+money(suggested)+'</div></div>'+
      '<div><div class="lbl">You charge</div><input data-f="price" type="number" step="0.01" value="'+num(ln.unitPrice).toFixed(2)+'"></div>'+
      '<div><div class="lbl">'+(costsVisible() ? "Line · margin" : "Line")+'</div><div class="fixed">'+money(lineTotal)+
        '<div class="tiny '+(Math.abs(off)>num(state.settings.varianceFlag)?"":"faint")+'" style="'+(Math.abs(off)>num(state.settings.varianceFlag)?"color:var(--warn)":"")+'">'+
          marginTxt+(Math.abs(off)>num(state.settings.varianceFlag) ? (marginTxt?" · ":"")+(off>0?"+":"")+money0(off)+" off book" : "")+'</div></div></div>'+
      '<div><div class="lbl">&nbsp;</div><button class="btn quiet sm" data-f="remove" type="button" aria-label="Remove line">×</button></div>'+
    '</div>';
  }).join("") || '<p class="tiny muted">No items yet — add the first line.</p>';

  $("of-lines").querySelectorAll(".li").forEach(function(row){
    var i=Number(row.dataset.i);
    row.querySelectorAll("[data-f]").forEach(function(inp){
      var f=inp.dataset.f;
      if(f==="remove"){ inp.addEventListener("click", function(){ state.offer.lines.splice(i,1); renderComposer(); }); return; }
      /* Typing the name of a service must not redraw the row under the cursor. */
      if(f==="svcname"){ inp.addEventListener("input", function(){ state.offer.lines[i].name=inp.value; }); return; }
      inp.addEventListener("input", function(){
        var L=state.offer.lines[i];
        if(f==="item"){
          var v=inp.value;
          L.serviceId=""; L.touched=false;
          if(v.indexOf("p:")===0){ L.kind="product"; L.productId=v.slice(2); L.baseId=""; L.coverId=""; }
          else if(v.indexOf("b:")===0){ L.kind="combo"; L.baseId=v.slice(2); L.productId=""; L.coverId=""; }
          else if(v.indexOf("s:")===0){
            /* A service is charged at its rate, not discounted like the price book. */
            L.kind="service"; L.productId=""; L.baseId=""; L.coverId="";
            var sv = v==="s:custom" ? null : serviceById(v.slice(2));
            L.serviceId = sv ? sv.id : ""; L.name = sv ? sv.name : ""; L.unit = sv ? sv.unit : "";
            L.unitPrice = sv ? num(sv.rate) : 0; L.touched=true;
          }
          else { L.kind="product"; L.productId=""; L.baseId=""; L.coverId=""; }
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
    (ctx.discount>0 ? '<div class="r"><span class="l">'+(ctx.tier?esc(ctx.tier.name)+' discount applied':'Client discount applied')+'</span><span class="mono">'+pct(ctx.discount)+'</span></div>' : '')+
    (cogs>0 ? '<div class="r c-cost"><span class="l">Margin on this offer</span><span class="mono">'+money(subtotal-cogs)+' · '+pct((subtotal-cogs)/(subtotal||1),0)+'</span></div>' : '')+
    (vat>0 ? '<div class="r"><span class="l">VAT '+num(state.settings.vatPct)+'%</span><span class="mono">'+money(vat)+'</span></div>' : '')+
    '<div class="r grand"><span class="l">Total</span><span class="v">'+money(subtotal+vat)+'</span></div>'+
    (state.offer.editId ? '' : '<div class="r"><span class="l">Balance after payment now</span><span class="mono">'+money(subtotal+vat-paid)+'</span></div>');
  refreshMilestoneSum();
}
/* ---------- Payment schedule on the offer ---------- */
function offerTotal(){
  var done=state.offer.lines.filter(lineReady);
  return sum(done,function(l){ return num(l.qty)*num(l.unitPrice); })*(1+num(state.settings.vatPct)/100);
}
function renderMilestones(){
  var box=$("of-milestones"); if(!box) return;
  var ms=state.offer.milestones||[], locked=state.offer.paidStages||[];
  var lockedHtml = locked.map(function(m){
    return '<div class="li" style="grid-template-columns:minmax(0,2fr) 120px 150px 30px">'+
      '<div><div class="lbl">Stage</div><div class="fixed" style="font-family:inherit">'+esc(m.label)+'</div></div>'+
      '<div><div class="lbl">Amount</div><div class="fixed">'+money(m.amount)+'</div></div>'+
      '<div><div class="lbl">Status</div><div style="padding-top:5px"><span class="pill good">Paid '+fmtDate(m.paidDate)+'</span></div></div><div></div></div>';
  }).join("");
  if(!ms.length && !locked.length){
    box.innerHTML='<p class="tiny muted">No stages — the whole amount is treated as one payment. On a project, set the stages and Today will chase each one as it falls due.</p>';
    return;
  }
  var total=offerTotal(), scheduled=sum(locked,function(m){ return m.amount; })+sum(ms,function(m){ return m.amount; });
  var off=Math.abs(scheduled-total)>0.5;
  box.innerHTML = lockedHtml + ms.map(function(m,i){
    return '<div class="li" data-m="'+i+'" style="grid-template-columns:minmax(0,2fr) 120px 150px 30px">'+
      '<div><div class="lbl">Stage</div><input data-g="label" type="text" value="'+esc(m.label||"")+'" placeholder="Deposit on order"></div>'+
      '<div><div class="lbl">Amount</div><input data-g="amount" type="number" step="0.01" min="0" class="mono" value="'+num(m.amount)+'"></div>'+
      '<div><div class="lbl">Due</div><input data-g="date" type="date" class="mono" value="'+esc(m.dueDate||"")+'"></div>'+
      '<div><div class="lbl">&nbsp;</div><button class="btn quiet sm" data-g="del" type="button" aria-label="Remove stage">×</button></div>'+
    '</div>';
  }).join("") +
  '<p class="tiny" id="of-ms-sum" style="margin-top:10px; color:'+(off?"var(--warn)":"var(--text-3)")+'">'+
    'Scheduled '+money(scheduled)+' of '+money(total)+(off ? ' · '+money(total-scheduled)+' unscheduled' : ' · balanced')+'</p>';

  box.querySelectorAll("[data-m]").forEach(function(row){
    var i=Number(row.dataset.m);
    row.querySelectorAll("[data-g]").forEach(function(inp){
      var g=inp.dataset.g;
      if(g==="del"){ inp.addEventListener("click", function(){ state.offer.milestones.splice(i,1); renderMilestones(); }); return; }
      inp.addEventListener("input", function(){
        var M=state.offer.milestones[i];
        if(g==="label") M.label=inp.value;
        if(g==="amount"){ M.amount=num(inp.value); refreshMilestoneSum(); }
        if(g==="date") M.dueDate=inp.value;
      });
    });
  });
}
/* Update the "scheduled of total" line without redrawing the inputs being typed in. */
function refreshMilestoneSum(){
  var el=$("of-ms-sum"); if(!el) return;
  var total=offerTotal(), scheduled=sum(state.offer.paidStages||[],function(m){ return m.amount; })+sum(state.offer.milestones||[],function(m){ return m.amount; });
  var off=Math.abs(scheduled-total)>0.5;
  el.style.color = off ? "var(--warn)" : "var(--text-3)";
  el.textContent = 'Scheduled '+money(scheduled)+' of '+money(total)+(off ? ' · '+money(total-scheduled)+' unscheduled' : ' · balanced');
}
$("of-ms-standard").addEventListener("click", function(){
  var total=offerTotal()-sum(state.offer.paidStages||[],function(m){ return m.amount; });
  if(total<=0){ toast("Add the items first, then the stages follow the total", true); return; }
  var dep=Math.round(total*0.4*100)/100, mid=Math.round(total*0.5*100)/100;
  state.offer.milestones=[
    {label:"Deposit on order", amount:dep, dueDate:$("of-date").value||todayISO()},
    {label:"On delivery of equipment", amount:mid, dueDate:""},
    {label:"On commissioning and handover", amount:Math.round((total-dep-mid)*100)/100, dueDate:""}
  ];
  renderMilestones();
});
$("of-ms-add").addEventListener("click", function(){
  state.offer.milestones=(state.offer.milestones||[]).concat([{label:"", amount:0, dueDate:""}]);
  renderMilestones();
});

$("of-save").addEventListener("click", function(){
  var ctx=offerCtx();
  if(!ctx.client){ toast("Choose a client first", true); return; }
  /* Rows at 0 stay on purpose: they print as options the client could add. */
  var done=state.offer.lines.filter(lineReady);
  if(!done.some(function(l){ return num(l.qty)>0; })){ toast("Give at least one row a quantity", true); return; }
  var editId=state.offer.editId, rev=state.offer.reviseOf;
  var paid=(editId || rev) ? 0 : valNum("of-paid");
  var total=sum(done,function(l){ return num(l.qty)*num(l.unitPrice); })*(1+num(state.settings.vatPct)/100);
  if(paid>total+0.004){ toast("Paid now is more than the offer total of "+money(total), true); return; }
  var data={
    clientId:ctx.client.id, region:ctx.region, dealType:ctx.type, serviceType:ctx.service,
    date:ctx.date, dueDate:val("of-due") || null, notes:val("of-notes"),
    site:val("of-site"), soldBy:val("of-seller"),
    paid:paid, method:val("of-method"), setId:state.offer.setId||null,
    milestones:(state.offer.milestones||[]).filter(function(m){ return num(m.amount)>0; })
      .map(function(m){ return {label:m.label, amount:num(m.amount), dueDate:m.dueDate||null}; }),
    lines:done.map(function(l){
      var base={kind:l.kind, qty:num(l.qty), standardPrice:lineStandard(l,ctx), unitPrice:num(l.unitPrice)};
      if(l.kind==="service"){ base.serviceId=l.serviceId||null; base.name=(l.name||"").trim(); base.unit=l.unit||""; }
      else if(l.kind==="combo"){ base.baseId=l.baseId; base.coverId=l.coverId; } else { base.productId=l.productId; }
      return base;
    })
  };
  var btn=$("of-save"); btn.disabled=true;
  /* The server hands out the reference number, so two people saving at once never collide. */
  api(editId ? "PUT" : "POST", "transactions"+(editId ? "/"+editId : (rev ? "/"+rev.id+"/revise" : "")), data).then(function(res){
    clearDraft();
    return reload().then(function(){
      toast(editId ? "Updated "+res.refNo : (rev ? "Saved as "+res.refNo+" — the earlier version stays until one is confirmed" : "Saved as "+res.refNo));
      closeComposer(); setView("sales");
    });
  }).catch(function(e){ toast(e.message || "Could not save", true); })
    .then(function(){ btn.disabled=false; });
});

/* ============================================================
   18. DOCUMENTS
   ============================================================ */
var docState={t:null, kind:"Quotation", style:"brand"};
/* The cover is dark, so it carries a white copy of the logo, made once in the browser. */
var whiteLogo={src:"", url:""};
function prepareWhiteLogo(){
  var src=state.settings.logo||"";
  if(src===whiteLogo.src) return;
  whiteLogo={src:src, url:""};
  if(!src) return;
  var img=new Image();
  img.onload=function(){
    if(whiteLogo.src!==src) return;
    var c=document.createElement("canvas"); c.width=img.naturalWidth; c.height=img.naturalHeight;
    var g=c.getContext("2d"); g.drawImage(img,0,0); g.globalCompositeOperation="source-in"; g.fillStyle="#FFFFFF"; g.fillRect(0,0,c.width,c.height);
    whiteLogo.url=c.toDataURL("image/png");
  };
  img.src=src;
}
function docPage(inner, cls){ return '<div class="d-page'+(cls?" "+cls:"")+'">'+inner+'</div>'; }
function docBrandBar(s){
  return '<div class="d-bar">'+(s.logo ? '<img class="d-logo" src="'+esc(s.logo)+'" alt="'+esc(s.name||"")+'">' : '<span class="d-word">'+esc(s.name||"Nestify")+'</span>')+
    '<span class="d-bar-r">'+esc(s.tagline||"")+'</span></div>';
}
function docFootBar(s, page, of){
  return '<div class="d-footbar"><span>'+[s.address,s.email,s.phone].filter(Boolean).map(esc).join("  |  ")+'</span><span>Page '+page+' of '+of+'</span></div>';
}
function openDoc(t, kind){
  docState.t=t; docState.kind=kind;
  var s=state.settings;
  var refMap={"Quotation":t.refNo, "Agreement":agreementRef(t.refNo), "Invoice":invoiceRef(t.refNo),
              "Delivery Note":invoiceRef(t.refNo), "Receipt":invoiceRef(t.refNo)};
  var dateMap={"Quotation":txDocDate(t), "Agreement":t.agreementDate, "Invoice":t.invoiceDate,
               "Delivery Note":t.deliveredDate||todayISO(), "Receipt":todayISO()};
  var client=clientById(t.clientId)||{};
  var showMoney = kind!=="Delivery Note";
  var terms = kind==="Quotation" ? s.termsQuotation : (kind==="Agreement" ? s.termsAgreement : s.termsInvoice);
  terms = String(terms||"").replace("{validity}", num(s.validityDays));

  var isNote = kind==="Delivery Note";
  var rows=(t.lineItems||[]).filter(function(li){ return !(isNote && li.kind==="service"); }).map(function(li){
    if(isNote) return '<tr><td>'+esc(li.name)+'</td><td class="num">'+num(li.qty)+'</td><td class="num">'+num(li.deliveredQty)+'</td><td class="num">'+(lineLeft(li)||"—")+'</td></tr>';
    if(num(li.qty)===0) return '<tr><td>'+esc(li.name)+' <span style="color:#8B928B">· optional</span></td><td class="num">—</td>'+
      (showMoney ? '<td class="num">'+money(li.unitPrice)+'</td><td class="num" style="color:#8B928B">optional</td>' : '')+'</tr>';
    return '<tr><td>'+esc(li.name)+'</td><td class="num">'+num(li.qty)+(li.unit ? ' '+esc(li.unit) : '')+'</td>'+
      (showMoney ? '<td class="num">'+money(li.unitPrice)+'</td><td class="num">'+money(num(li.qty)*num(li.unitPrice))+'</td>' : '')+
      '</tr>';
  }).join("");

  var pays=normalizedPayments(t);
  var totals = showMoney ?
    '<div class="d-tot">'+
      '<div class="r"><span>Total quantity</span><span>'+sum((t.lineItems||[]).filter(function(li){ return li.kind!=="service"; }), function(li){ return li.qty; })+'</span></div>'+
      '<div class="r"><span>Subtotal</span><span>'+money(txSubtotal(t))+'</span></div>'+
      (num(t.vatPct)>0 ? '<div class="r"><span>VAT '+num(t.vatPct)+'%</span><span>'+money(txVat(t))+'</span></div>' : '')+
      '<div class="r g"><span>'+(kind==="Receipt"?"Invoice total":"Total")+'</span><span>'+money(txTotal(t))+'</span></div>'+
      (kind!=="Quotation" ? '<div class="r"><span>Paid to date</span><span>'+money(txPaid(t))+'</span></div>'+
        '<div class="r"><span>Balance due</span><span>'+money(txBalance(t))+'</span></div>' : '')+
    '</div>' : '';

  var sheet =
    '<div class="d-top">'+
      '<div class="d-mark">'+(s.logo ? '<img class="d-logo-big" src="'+esc(s.logo)+'" alt="'+esc(s.name||"")+'">' : '<b>'+esc(s.name||"Nestify")+'</b>')+
        '<span>'+esc(s.tagline||"")+'</span></div>'+
      '<div class="d-kind"><div class="k">'+esc(kind)+'</div><div class="r">'+esc(refMap[kind])+'</div>'+
        '<div class="dt">'+fmtDate(dateMap[kind]||todayISO())+'</div></div>'+
    '</div>'+
    '<div class="d-meta">'+
      '<div><div class="k">Prepared for</div><div class="v">'+esc(t.clientName||"")+(client.phone?'<br>'+esc(client.phone):"")+'</div></div>'+
      '<div><div class="k">'+(t.site ? "Site" : "Region")+'</div><div class="v">'+esc(t.site||t.region||"")+'</div></div>'+
      '<div><div class="k">Scope</div><div class="v">'+esc(t.serviceType==="With Programming"?"Supply and programming":"Supply only")+'</div></div>'+
      '<div><div class="k">'+(kind==="Quotation"?"Valid until":"Reference")+'</div><div class="v">'+
        (kind==="Quotation" ? fmtDate(addDays(txDocDate(t), num(s.validityDays))) : esc(t.refNo))+'</div></div>'+
    '</div>'+
    '<table><thead><tr><th>Item</th>'+(isNote ? '<th class="num">Ordered</th><th class="num">Delivered</th><th class="num">Still to come</th>'
      : '<th class="num">Qty</th>'+(showMoney?'<th class="num">Unit</th><th class="num">Amount</th>':''))+'</tr></thead>'+
      '<tbody>'+rows+'</tbody></table>'+
    totals+
    ((kind==="Agreement" || kind==="Invoice") && (t.milestones||[]).length ?
      '<table style="margin-top:24px"><thead><tr><th>Payment stage</th><th>Due</th><th class="num">Amount</th></tr></thead><tbody>'+
      t.milestones.map(function(m){
        return '<tr><td>'+esc(m.label)+(m.paid ? ' — received' : '')+'</td><td>'+(m.dueDate ? fmtDate(m.dueDate) : "on agreement")+'</td><td class="num">'+money(m.amount)+'</td></tr>';
      }).join("")+'</tbody></table>' : '')+
    (kind==="Receipt" && pays.length ?
      '<table style="margin-top:22px"><thead><tr><th>Received on</th><th>Method</th><th class="num">Amount</th></tr></thead><tbody>'+
      pays.map(function(p){ return '<tr><td>'+fmtDate(p.date)+'</td><td>'+esc(p.method||"")+'</td><td class="num">'+money(p.amount)+'</td></tr>'; }).join("")+
      '</tbody></table>' : '')+
    (terms ? '<div class="d-note">'+esc(terms)+'</div>' : '')+
    (kind==="Agreement" || kind==="Delivery Note" ?
      '<div class="d-sign"><div>Client signature</div><div>For '+esc(s.name||"Nestify")+'</div></div>' : '')+
    '<div class="d-foot"><span>'+[s.phone,s.email,s.website].filter(Boolean).map(esc).join("  ·  ")+'</span><span>'+esc(s.address||"")+'</span></div>';

  /* Full quotation: cover, opening page, the offer, back page. Every other document is one sheet. */
  var brand = docState.style==="brand" && kind==="Quotation";
  if(!brand){
    $("doc").innerHTML = docPage(sheet);
  } else {
    var bullets=String(s.offerNotes||"").split("\n").map(function(x){ return x.trim(); }).filter(Boolean);
    var logoOrName = function(dark){ return s.logo ? '<img src="'+esc(dark ? s.logo : (whiteLogo.url||s.logo))+'" alt="'+esc(s.name||"")+'">'
      : '<div class="d-cover-word"'+(dark?' style="color:#161A16"':'')+'>'+esc(s.name||"Nestify")+'</div>'; };
    var cover =
      '<div class="d-cover"'+(s.hero ? ' style="background-image:linear-gradient(180deg, rgba(12,14,12,.55), rgba(12,14,12,.85)), url(\''+esc(s.hero)+'\')"' : '')+'>'+
        '<div class="d-cover-top"><div><div>Subject: Price offer</div><div>To: '+esc(t.clientName||"")+'</div>'+
          (t.site ? '<div>Site: '+esc(t.site)+'</div>' : '')+'<div>Date issued: '+fmtDate(dateMap[kind]||todayISO())+'</div></div>'+
          '<div class="r">Offer No.: '+esc(refMap[kind])+'</div></div>'+
        '<div class="d-cover-mid">'+logoOrName(false)+'<div class="d-cover-tag">'+esc(s.tagline||"")+'</div></div>'+
        '<div class="d-cover-foot">'+esc(s.coverNote||"")+'</div>'+
      '</div>';
    var notes = docBrandBar(s)+'<div class="d-body">'+
        (s.introText ? '<p class="d-intro">'+esc(s.introText)+'</p>' : '')+
        (bullets.length ? '<ul class="d-bullets">'+bullets.map(function(b){ return '<li>'+esc(b)+'</li>'; }).join("")+'</ul>' : '')+
      '</div>'+docFootBar(s, 2, 4);
    var back = '<div class="d-back">'+logoOrName(true)+'<div class="d-back-tag">'+esc(s.tagline||"")+'</div></div>';
    $("doc").innerHTML = docPage(cover, "d-page-full") + docPage(notes, "d-page-bar") +
      docPage(docBrandBar(s)+'<div class="d-body">'+sheet+'</div>'+docFootBar(s, 3, 4), "d-page-bar") + docPage(back, "d-page-full");
  }

  $("doc-title").textContent = kind + " · " + refMap[kind];
  $("doc-style").hidden = kind!=="Quotation";
  $("doc-style").querySelectorAll("button").forEach(function(b){ b.setAttribute("aria-pressed", String(b.dataset.t===docState.style)); });
  $("doc-overlay").hidden=false;
}
wireSegmented("doc-style", function(v){ docState.style=v; if(docState.t) openDoc(docState.t, docState.kind); });
function addDays(iso, n){
  var d=parseISO(iso)||new Date();
  d.setDate(d.getDate()+n);
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
}
$("doc-close").addEventListener("click", function(){ $("doc-overlay").hidden=true; });
$("doc-print").addEventListener("click", function(){ window.print(); });

/* ---------- Download PDF: the document drawn at A4 width and saved as a file ----------
   html2canvas + jsPDF (both MIT) ship with the app, so this works offline too. */
var pdfLibs=null;
function loadVendor(file){
  return new Promise(function(ok, fail){
    var sc=document.createElement("script");
    sc.src=BASE+"/assets/vendor/"+file;
    sc.onload=function(){ ok(); }; sc.onerror=function(){ fail(new Error("Could not load the PDF tool")); };
    document.head.appendChild(sc);
  });
}
function ensurePdfLibs(){
  if(window.html2canvas && window.jspdf) return Promise.resolve();
  if(!pdfLibs) pdfLibs=loadVendor("html2canvas.min.js").then(function(){ return loadVendor("jspdf.umd.min.js"); })
    .catch(function(e){ pdfLibs=null; throw e; });
  return pdfLibs;
}
function docToPdf(){
  /* Drawn off-screen at A4 width (794px) so the PDF never picks up the panel's
     scrollbar or cropped height; a long document runs onto further pages. */
  var stage=document.createElement("div");
  stage.id="doc"; stage.className="paged"; stage.style.cssText="position:fixed; left:-12000px; top:0; width:794px; background:#FFFFFF";
  stage.innerHTML=$("doc").innerHTML;
  $("doc").id="doc-live";
  document.body.appendChild(stage);
  var cleanup=function(){ if(stage.parentNode) stage.parentNode.removeChild(stage); var live=$("doc-live"); if(live) live.id="doc"; };
  var pages=[].slice.call(stage.querySelectorAll(".d-page"));
  var pdf=new window.jspdf.jsPDF({unit:"pt", format:"a4", orientation:"portrait"});
  var pw=pdf.internal.pageSize.getWidth(), ph=pdf.internal.pageSize.getHeight(), first=true;
  /* Each page of the document becomes a PDF page; only one that really runs long is split. */
  var shoot=function(i){
    if(i>=pages.length) return Promise.resolve(pdf);
    return window.html2canvas(pages[i], {scale:2, backgroundColor:"#FFFFFF", width:794, windowWidth:794, logging:false, useCORS:true}).then(function(canvas){
      if(!first) pdf.addPage(); first=false;
      var img=canvas.toDataURL("image/jpeg", 0.94), ih=canvas.height*pw/canvas.width, y=0;
      pdf.addImage(img, "JPEG", 0, 0, pw, ih);
      for(var left=ih-ph; left>1; left-=ph){ y-=ph; pdf.addPage(); pdf.addImage(img, "JPEG", 0, y, pw, ih); }
      return shoot(i+1);
    });
  };
  return shoot(0).then(function(r){ cleanup(); return r; }, function(e){ cleanup(); throw e; });
}
function docFileName(){
  var t=String($("doc-title").textContent||"Document");
  return (t.replace(/[^A-Za-z0-9 _-]+/g, " ").replace(/\s+/g, " ").trim().replace(/ /g, "-") || "Document")+".pdf";
}
$("doc-pdf").addEventListener("click", function(){
  var btn=this; if(btn.disabled) return;
  var label=btn.textContent; btn.disabled=true; btn.textContent="Preparing…";
  ensurePdfLibs().then(docToPdf).then(function(pdf){ pdf.save(docFileName()); toast("PDF saved"); })
    .catch(function(e){ toast(e.message || "Could not build the PDF — please try again", true); })
    .then(function(){ btn.disabled=false; btn.textContent=label; });
});

/* ============================================================
   19. INVENTORY
   ============================================================ */
function stockPill(kind, item){
  var avail=availableOf(kind,item), inc=incomingFor(kind,item.id);
  if(avail<0) return '<span class="pill bad">Short '+(-avail)+(inc>0 ? ' · '+inc+' coming' : '')+'</span>';
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
      '<td class="num c-cost">'+(itemCost(p)>0?money(itemCost(p)):'<span class="faint">—</span>')+'</td>'+
      '<td class="num">'+num(p.stockOnHand)+'</td><td class="num">'+reservedFor("product",p.id)+'</td>'+
      '<td class="num">'+(incomingFor("product",p.id)||'<span class="faint">—</span>')+'</td>'+
      '<td class="num strong">'+availCell("product",p)+'</td><td>'+stockPill("product",p)+'</td></tr>';
  }).join("") : emptyRow(8,"No products yet.");

  $("inv-bases").innerHTML = state.bases.length ? state.bases.map(function(b){
    return '<tr class="clickable" data-edit="base:'+b.id+'">'+
      '<td class="strong">'+esc(b.name)+'</td><td class="tiny muted">'+esc(b.line||"")+'</td>'+
      '<td class="num c-cost">'+(itemCost(b)>0?money(itemCost(b)):'<span class="faint">—</span>')+'</td>'+
      '<td class="num">'+num(b.stockOnHand)+'</td><td class="num">'+reservedFor("base",b.id)+'</td>'+
      '<td class="num">'+(incomingFor("base",b.id)||'<span class="faint">—</span>')+'</td>'+
      '<td class="num strong">'+availCell("base",b)+'</td><td>'+stockPill("base",b)+'</td></tr>';
  }).join("") : emptyRow(8,"No bases yet.");

  $("inv-covers").innerHTML = state.covers.length ? state.covers.map(function(c){
    return '<tr class="clickable" data-edit="cover:'+c.id+'">'+
      '<td class="strong">'+esc(c.name)+'</td><td class="tiny muted">'+esc(c.line||"")+'</td>'+
      '<td class="tiny muted">'+esc(c.finish||"")+'</td>'+
      '<td class="num">'+money(c.priceAddOn)+'</td>'+
      '<td class="num c-cost">'+(itemCost(c)>0?money(itemCost(c)):'<span class="faint">—</span>')+'</td>'+
      '<td class="num">'+num(c.stockOnHand)+'</td><td class="num">'+reservedFor("cover",c.id)+'</td>'+
      '<td class="num strong">'+availCell("cover",c)+'</td><td>'+stockPill("cover",c)+'</td></tr>';
  }).join("") : emptyRow(9,"No covers yet.");

  document.querySelectorAll("#inv-pane-stock [data-edit]").forEach(function(r){
    r.addEventListener("click", function(){
      var p=r.dataset.edit.split(":");
      var list = p[0]==="product" ? state.products : (p[0]==="base" ? state.bases : state.covers);
      openStockItem(p[0], byId(list, p[1]));
    });
  });
  renderOrders(); renderSuppliers(); renderToDeliver(); renderServices(); renderSets();
}
function wireAddButtons(){
  document.querySelectorAll("[data-add]").forEach(function(b){
    b.addEventListener("click", function(){
      var k=b.dataset.add;
      if(k==="product"||k==="base"||k==="cover") editStock(k,null);
      if(k==="supplier") editSupplier(null);
      if(k==="service") editService(null);
      if(k==="client") editClient(null);
      if(k==="tier") editTier(null);
      if(k==="expense") editExpense(null);
      if(k==="employee") editEmployee(null);
    });
  });
}

/* ---------- Stock item card: who it is reserved for, what is coming, where it went ---------- */
function lineUses(li, kind, id){
  if(kind==="product") return li.kind!=="combo" && li.productId===id;
  if(kind==="base") return li.kind==="combo" && li.baseId===id;
  return li.kind==="combo" && li.coverId===id;
}
function reservationsFor(kind, id){
  var rows=[];
  state.transactions.forEach(function(t){
    if(t.status!=="Agreement" && t.status!=="Invoiced") return;
    var q=sum((t.lineItems||[]).filter(function(li){ return lineUses(li,kind,id); }), lineLeft);
    if(q>0) rows.push({t:t, qty:q});
  });
  return sortBy(rows, function(r){ return r.t.agreementDate||r.t.quotationDate||""; });
}
function stockHistory(kind, id){
  var rows=[];
  state.deliveries.forEach(function(d){
    if(!lineUses(d, kind, id)) return;
    var t=byId(state.transactions, d.transactionId)||{};
    rows.push({date:d.date, what:"Delivered to "+(t.clientName||"—"), ref:t.refNo||"", qty:-num(d.qty), by:d.by, go:t.id ? function(){ openTx(t.id); } : null});
  });
  state.orders.forEach(function(o){
    if(o.status!=="Received") return;
    (o.lines||[]).forEach(function(l){
      if(l.kind===kind && l.itemId===id) rows.push({date:o.receivedDate, what:"Received from "+(o.supplierName||"supplier"), ref:o.refNo, qty:num(l.qty)});
    });
  });
  if(kind==="product") state.expenses.forEach(function(e){
    if(e.linkedProductId===id && num(e.qtyPurchased)>0) rows.push({date:e.date, what:"Restocked — "+(e.description||"expense"), ref:e.vendor||"", qty:num(e.qtyPurchased)});
  });
  return sortBy(rows, function(r){ return r.date||""; }, true);
}
function openStockItem(kind, item){
  if(!item) return;
  var res=reservationsFor(kind, item.id), hist=stockHistory(kind, item.id), go=[];
  var incoming=[];
  state.orders.forEach(function(o){
    if(o.status!=="Ordered") return;
    var q=sum((o.lines||[]).filter(function(l){ return l.kind===kind && l.itemId===item.id; }), function(l){ return l.qty; });
    if(q>0) incoming.push({o:o, qty:q});
  });
  var link=function(fn){ go.push(fn); return ' class="clickable" data-go="'+(go.length-1)+'"'; };
  var html=
    '<div class="figures" style="border-radius:var(--radius)">'+
      figure("On hand", String(num(item.stockOnHand)))+figure("Reserved", String(reservedFor(kind,item.id)))+
      figure("Available", availCell(kind,item))+figure("Incoming", String(incomingFor(kind,item.id)))+
    '</div>'+
    '<div class="section"><p class="eyebrow">Reserved for</p><div class="panel"><div class="table-wrap"><table>'+
      '<thead><tr><th>Deal</th><th>Client</th><th>Stage</th><th class="num">Reserved</th></tr></thead><tbody>'+
      (res.length ? res.map(function(r){
        return '<tr'+link(function(){ openTx(r.t.id); })+'><td class="mono">'+esc(r.t.refNo)+'</td><td class="strong">'+esc(r.t.clientName||"")+'</td>'+
          '<td>'+dealStage(r.t)+'</td><td class="num strong">'+r.qty+'</td></tr>';
      }).join("") : emptyRow(4,"Nothing reserved — no agreement or invoice is waiting for this item."))+
    '</tbody></table></div></div></div>'+
    (incoming.length ? '<div class="section"><p class="eyebrow">On order</p><div class="panel"><div class="table-wrap"><table><tbody>'+
      incoming.map(function(r){
        return '<tr'+link(function(){ closeDrawer(); setView("inventory"); editOrder(r.o); })+'><td class="mono">'+esc(r.o.refNo)+'</td><td>'+esc(r.o.supplierName||"")+'</td>'+
          '<td class="tiny muted">'+(r.o.expectedDate ? "due "+fmtDate(r.o.expectedDate) : "")+'</td><td class="num">+'+r.qty+'</td></tr>';
      }).join("")+'</tbody></table></div></div></div>' : '')+
    '<div class="section"><p class="eyebrow">History</p><div class="panel"><div class="table-wrap"><table>'+
      '<thead><tr><th>Date</th><th>Movement</th><th>Reference</th><th class="num">Qty</th></tr></thead><tbody>'+
      (hist.length ? hist.map(function(r){
        return '<tr'+(r.go ? link(r.go) : '')+'><td>'+fmtDate(r.date)+'</td><td>'+esc(r.what)+(r.by ? '<div class="tiny faint">by '+esc(r.by)+'</div>' : '')+'</td>'+
          '<td class="mono tiny">'+esc(r.ref)+'</td><td class="num strong" style="color:'+(r.qty<0?"var(--bad)":"var(--good)")+'">'+(r.qty>0?"+":"")+r.qty+'</td></tr>';
      }).join("") : emptyRow(4,"No movements recorded yet."))+
    '</tbody></table></div></div></div>'+
    (isManager() ? '<div style="display:flex; gap:8px"><button class="btn sm" type="button" id="si-edit">Edit item</button></div>' : '');
  openDrawer(item.name, html);
  $("drawer-body").querySelectorAll("[data-go]").forEach(function(r){
    r.addEventListener("click", function(){ go[Number(r.dataset.go)](); });
  });
  if($("si-edit")) $("si-edit").addEventListener("click", function(){ closeDrawer(); editStock(kind, item); });
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
    costsVisible() ? {id:"f-cost", label:"What it costs you", type:"number", step:"0.01", value:itemCost(d)} : null,
    {id:"f-stock", label:"On hand", type:"number", step:"1", value:num(d.stockOnHand)},
    {id:"f-reorder", label:"Reorder at", type:"number", step:"1", value:num(d.reorderThreshold)}]});
  if(costsVisible()) groups.push({note:"Cost drives every margin figure in the system. Leave it at zero and margins stay blank."});

  openForm((isNew?"Add ":"Edit ")+titleMap[kind], groups, function(){
    if(!val("f-name")){ toast("Give it a name first", true); return false; }
    var data={
      name:val("f-name"),
      cost:costsVisible() ? valNum("f-cost") : undefined,
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

/* ---------- To deliver: invoiced lines not yet handed over ---------- */
function toDeliverRows(){
  var rows=[];
  state.transactions.filter(function(t){ return t.status==="Invoiced"; }).forEach(function(t){
    var plan=deliveryPlan(t), ready={};
    plan.now.forEach(function(r){ ready[r.name]=(ready[r.name]||0)+r.qty; });
    (t.lineItems||[]).forEach(function(li){
      var left=lineLeft(li); if(!left) return;
      var r=Math.min(left, ready[li.name]||0); if(r) ready[li.name]-=r;
      rows.push({t:t, li:li, left:left, ready:r});
    });
  });
  return rows;
}
function renderToDeliver(){
  var rows=toDeliverRows();
  $("deliver-body").innerHTML = rows.length ? rows.map(function(r){
    var st = r.ready>=r.left ? '<span class="pill good">Ready</span>'
      : (r.ready>0 ? '<span class="pill warn">'+r.ready+' ready</span>' : '<span class="pill bad">Waiting for stock</span>');
    return '<tr class="clickable" data-dt="'+r.t.id+'"><td class="mono">'+esc(r.t.refNo)+'<div class="tiny faint">'+fmtDate(r.t.invoiceDate)+'</div></td>'+
      '<td class="strong">'+esc(r.t.clientName||"")+'</td><td>'+esc(r.li.name)+'</td>'+
      '<td class="num">'+num(r.li.qty)+'</td><td class="num">'+num(r.li.deliveredQty)+'</td><td class="num strong">'+r.left+'</td><td>'+st+'</td></tr>';
  }).join("") : emptyRow(7,"Everything invoiced has been delivered.");
  $("deliver-body").querySelectorAll("[data-dt]").forEach(function(r){
    r.addEventListener("click", function(){ setView("sales"); openTx(r.dataset.dt); });
  });
}

/* ---------- Labour and services ---------- */
function renderServices(){
  var used={};
  state.transactions.forEach(function(t){ (t.lineItems||[]).forEach(function(li){ if(li.serviceId) used[li.serviceId]=(used[li.serviceId]||0)+1; }); });
  $("svc-body").innerHTML = state.services.length ? state.services.map(function(sv){
    return '<tr class="'+(isManager()?"clickable":"")+'" data-svc="'+sv.id+'"><td class="strong">'+esc(sv.name)+'</td><td class="tiny muted">'+esc(sv.unit||"")+'</td>'+
      '<td class="num">'+money(sv.rate)+'</td><td class="num">'+(used[sv.id]||'<span class="faint">—</span>')+'</td>'+
      '<td>'+(sv.active!==false ? '<span class="pill good">Offered</span>' : '<span class="pill neutral">Retired</span>')+'</td></tr>';
  }).join("") : emptyRow(5, isManager() ? "No services yet — add installation, programming, site visits…" : "No services listed yet.");
  if(isManager()) $("svc-body").querySelectorAll("[data-svc]").forEach(function(r){
    r.addEventListener("click", function(){ editService(byId(state.services, r.dataset.svc)); });
  });
}
function editService(sv){
  var isNew=!sv; var d=sv||{name:"", unit:"hour", rate:0, active:true};
  openForm((isNew?"Add":"Edit")+" service", [
    {fields:[{id:"sv-name", label:"Service", value:d.name, placeholder:"Installation"},
             {id:"sv-unit", label:"Charged per", value:d.unit, placeholder:"hour, day, visit, point…"},
             {id:"sv-rate", label:"Rate", type:"number", step:"0.01", value:num(d.rate)}]},
    {fields:[{id:"sv-active", label:"Status", type:"select", options:[{value:"1", label:"Offered on new offers"},{value:"0", label:"Retired"}], value:d.active!==false?"1":"0"}]},
    {note:"Labour lines carry no stock and no cost of goods, so they lift the margin on a project rather than distorting it."}
  ], function(){
    if(!val("sv-name")){ toast("Name the service", true); return false; }
    save("services", isNew?null:sv.id, {name:val("sv-name"), unit:val("sv-unit")||"hour", rate:valNum("sv-rate"), active:val("sv-active")==="1"},
      function(){ toast("Service saved"); });
  }, isNew ? null : function(){ remove("services", sv.id, sv.name); });
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
function tierById(id){ return id ? byId(state.tiers||[], id) : null; }
function tierLabel(c){ var t=tierById(c.tierId); return t ? (t.code||t.name) : ""; }
function effectiveDiscount(c){ var t=tierById(c.tierId); return 1-(1-(t?num(t.discountPct):0))*(1-num(c.discountPct)); }
function tierYearBilled(tierId){
  var yr=todayISO().slice(0,4);
  var ids=state.clients.filter(function(c){ return c.tierId===tierId; }).map(function(c){ return c.id; });
  return sum(state.transactions.filter(function(t){
    return ids.indexOf(t.clientId)>=0 && isLive(t) && isBilled(t) && String(txRecognisedDate(t)||"").slice(0,4)===yr;
  }), txTotal);
}
function renderTiers(){
  var rows=state.tiers||[];
  $("tiers-body").innerHTML = rows.length ? rows.map(function(t){
    var n=state.clients.filter(function(c){ return c.tierId===t.id; }).length, billed=tierYearBilled(t.id);
    var tgt=num(t.targetYear);
    return '<tr class="clickable" data-tier="'+t.id+'"><td class="strong">'+esc(t.name)+(t.code?' <span class="pill neutral">'+esc(t.code)+'</span>':'')+
      (t.active?'':' <span class="pill neutral">inactive</span>')+'</td>'+
      '<td class="tiny muted">'+esc(t.basis==="Dealer"?"Dealer prices":"End-user prices")+'</td>'+
      '<td class="num">'+(num(t.discountPct)>0?pct(t.discountPct,1):'<span class="faint">—</span>')+'</td>'+
      '<td class="num">'+n+'</td><td class="num">'+money0(billed)+'</td>'+
      '<td class="num">'+(tgt>0?money0(tgt)+' <span class="tiny faint">('+Math.round(billed/tgt*100)+'%)</span>':'<span class="faint">—</span>')+'</td></tr>';
  }).join("") : emptyRow(6,"No tiers yet. Without one, a contact is priced by its type.");
  $("tiers-body").querySelectorAll("[data-tier]").forEach(function(r){
    r.addEventListener("click", function(){ if(isManager()) editTier(tierById(r.dataset.tier)); });
  });
}
function editTier(t){
  var isNew=!t; var d=t||{name:"", code:"", basis:"Dealer", discountPct:0, targetYear:0, active:true};
  openForm((isNew?"Add":"Edit")+" price tier", [
    {fields:[{id:"tr-name", label:"Tier name", value:d.name, placeholder:"Dealer Gold"},
             {id:"tr-code", label:"Short code", value:d.code, placeholder:"DG"}]},
    {fields:[{id:"tr-basis", label:"Priced from", type:"select", options:[{value:"End user",label:"End-user prices"},{value:"Dealer",label:"Dealer prices"}], value:d.basis},
             {id:"tr-disc", label:"Channel discount (%)", type:"number", step:"0.1", min:0, value:r2(num(d.discountPct)*100)}]},
    {fields:[{id:"tr-target", label:"Yearly turnover target ($)", type:"number", step:"1", min:0, value:num(d.targetYear)},
             {id:"tr-active", label:"Status", type:"select", options:[{value:"1",label:"Active"},{value:"0",label:"Inactive (hidden on contacts)"}], value:d.active?"1":"0"}]},
    {note:"Contacts in this tier are quoted from the chosen price column, less the channel discount. A contact's own extra discount stacks on top."}
  ], function(){
    if(!val("tr-name")){ toast("Tier name is required", true); return false; }
    var disc=valNum("tr-disc"); if(disc<0||disc>100){ toast("Discount must be between 0 and 100%", true); return false; }
    save("price_tiers", isNew?null:t.id, {name:val("tr-name"), code:val("tr-code"), basis:val("tr-basis"),
      discountPct:disc/100, targetYear:valNum("tr-target"), active:val("tr-active")==="1"},
      function(){ toast("Tier saved"); });
  }, isNew ? null : function(){ remove("price_tiers", t.id, t.name); });
}
function renderContacts(){
  renderTiers();
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
      '<td class="num">'+(tierLabel(c)?'<span class="pill info">'+esc(tierLabel(c))+'</span> ':'')+(effectiveDiscount(c)>0.00001?pct(effectiveDiscount(c),1):'<span class="faint">—</span>')+'</td>'+
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
      '<div class="kv"><span class="k">Price tier</span><span class="v">'+(tierById(c.tierId)?esc(tierById(c.tierId).name)+' · '+(tierById(c.tierId).basis==="Dealer"?"dealer prices":"end-user prices"):"— (priced by type)")+'</span></div>'+
      '<div class="kv"><span class="k">Discount</span><span class="v">'+pct(effectiveDiscount(c),1)+
        (tierById(c.tierId)&&num(c.discountPct)>0?' <span class="tiny faint">('+pct(tierById(c.tierId).discountPct,1)+' tier + '+pct(c.discountPct,1)+' extra)</span>':'')+'</span></div>'+
      '<div class="kv"><span class="k">Phone</span><span class="v">'+esc(c.phone||"—")+'</span></div>'+
      '<div class="kv"><span class="k">Deals</span><span class="v">'+st.deals+'</span></div>'+
      '<div class="kv"><span class="k">Last activity</span><span class="v">'+(st.last?fmtDate(txRecognisedDate(st.last)):"—")+'</span></div>'+
    '</div>'+
    (c.notes?'<p class="tiny muted">'+esc(c.notes)+'</p>':'')+
    '<div class="section"><p class="eyebrow">Statement</p><div class="panel"><div class="table-wrap"><table>'+
      '<thead><tr><th>Reference</th><th>Stage</th><th>Date</th><th class="num">Total</th><th class="num">Balance</th></tr></thead><tbody>'+
      (rows.length ? rows.map(function(t){
        return '<tr class="clickable" data-t="'+t.id+'"><td class="mono">'+esc(t.refNo)+'</td><td>'+dealStage(t)+'</td>'+
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
  var isNew=!c; var d=c||{name:"", type:"End User", region:"West Bank", discountPct:0, phone:"", email:"", notes:"", tierId:""};
  var tiers=[{value:"",label:"None — priced by type"}].concat((state.tiers||[]).filter(function(t){ return t.active || t.id===d.tierId; })
    .map(function(t){ return {value:t.id, label:t.name+" · "+(t.basis==="Dealer"?"dealer":"end-user")+" prices"+(num(t.discountPct)>0?" − "+pct(t.discountPct,1):"")}; }));
  openForm((isNew?"Add":"Edit")+" contact", [
    {fields:[{id:"c-name", label:"Name", value:d.name},
             {id:"c-type", label:"Type", type:"select", options:["End User","Dealer","Partner"], value:d.type},
             {id:"c-region", label:"Region", type:"select", options:["West Bank","48 Region"], value:d.region}]},
    {fields:[{id:"c-tier", label:"Price tier", type:"select", options:tiers, value:d.tierId||""},
             {id:"c-disc", label:"Extra discount on top (%)", type:"number", step:"0.1", value:r2(num(d.discountPct)*100)}]},
    {fields:[{id:"c-phone", label:"Phone", value:d.phone},
             {id:"c-email", label:"Email", value:d.email}]},
    {fields:[{id:"c-notes", label:"Notes", type:"textarea", value:d.notes}]},
    {note:"Region and the tier (or the type, without a tier) decide which price column the offer builder uses."}
  ], function(){
    if(!val("c-name")){ toast("Name is required", true); return false; }
    save("clients", isNew?null:c.id, {name:val("c-name"), type:val("c-type"), region:val("c-region"),
      tierId:val("c-tier")?Number(val("c-tier")):null, discountPct:valNum("c-disc")/100, phone:val("c-phone"), email:val("c-email"), notes:val("c-notes")},
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
  save("payroll_payments", null, {employeeId:e.id, method:"Cash"}, function(res){ toast(e.name+" marked paid", false, res && res.undo); });
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
/* Logo and cover photo: scaled down in the browser before upload so they stay light. */
var brandTarget=null;
function renderBrandImages(){
  [["logo","s-logo-box","Logo"],["hero","s-hero-box","Cover photo"]].forEach(function(x){
    var url=state.settings[x[0]], box=$(x[1]); if(!box) return;
    box.innerHTML=(url ? '<img src="'+esc(url)+'" alt="'+x[2]+'">' : '<span class="tiny faint">None yet</span>')+
      (isOwner() ? '<button class="btn sm" type="button" data-up="'+x[0]+'">'+(url?"Replace":"Upload")+'</button>'+
        (url ? '<button class="btn quiet sm" type="button" data-rm="'+x[0]+'">Remove</button>' : '') : '');
  });
  document.querySelectorAll("[data-up]").forEach(function(b){ b.onclick=function(){ brandTarget=b.dataset.up; $("s-image-file").value=""; $("s-image-file").click(); }; });
  document.querySelectorAll("[data-rm]").forEach(function(b){ b.onclick=function(){
    api("DELETE", "brand/"+b.dataset.rm).then(function(saved){ state.settings=Object.assign({}, state.settings, saved); renderBrandImages(); toast("Removed"); })
      .catch(function(e){ toast(e.message, true); });
  }; });
}
function shrinkImage(file, maxW, keepPng){
  return new Promise(function(ok, fail){
    var r=new FileReader();
    r.onerror=function(){ fail(new Error("Could not read that file")); };
    r.onload=function(){
      var img=new Image();
      img.onerror=function(){ fail(new Error("That file is not an image")); };
      img.onload=function(){
        var w=Math.min(maxW, img.naturalWidth), h=Math.round(img.naturalHeight*w/img.naturalWidth);
        var c=document.createElement("canvas"); c.width=w; c.height=h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        ok(keepPng ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", 0.85));
      };
      img.src=r.result;
    };
    r.readAsDataURL(file);
  });
}
$("s-image-file").addEventListener("change", function(){
  var f=this.files[0], which=brandTarget; if(!f || !which) return;
  /* A logo keeps its transparency; a cover photo becomes a compact JPEG. */
  shrinkImage(f, which==="logo" ? 800 : 1600, which==="logo").then(function(data){
    return api("PUT", "brand/"+which, {data:data});
  }).then(function(saved){ state.settings=Object.assign({}, state.settings, saved); prepareWhiteLogo(); renderBrandImages(); toast(which==="logo" ? "Logo saved" : "Cover photo saved"); })
    .catch(function(e){ toast(e.message, true); });
});
function renderSettings(){
  renderBrandImages();
  if(settingsDirty) return;
  var s=state.settings;
  var map={"s-name":s.name,"s-tagline":s.tagline,"s-phone":s.phone,"s-email":s.email,"s-website":s.website,
    "s-address":s.address,"s-vat":num(s.vatPct),"s-validity":num(s.validityDays),
    "s-terms-q":s.termsQuotation,"s-terms-a":s.termsAgreement,"s-terms-i":s.termsInvoice,
    "s-intro":s.introText,"s-bullets":s.offerNotes,"s-cover-note":s.coverNote,
    "s-overdue":num(s.overdueDays),"s-stale":num(s.staleDays),"s-variance":num(s.varianceFlag)};
  Object.keys(map).forEach(function(id){ var n=$(id); if(n) n.value = map[id]==null?"":map[id]; });
}
["s-name","s-tagline","s-phone","s-email","s-website","s-address","s-vat","s-validity",
 "s-terms-q","s-terms-a","s-terms-i","s-intro","s-bullets","s-cover-note","s-overdue","s-stale","s-variance"].forEach(function(id){
  var n=$(id); if(n) n.addEventListener("input", function(){ settingsDirty=true; $("s-saved").textContent=""; });
});
$("s-save").addEventListener("click", function(){
  var data={
    name:val("s-name")||"Nestify", tagline:val("s-tagline"), phone:val("s-phone"), email:val("s-email"),
    website:val("s-website"), address:val("s-address"), vatPct:valNum("s-vat"), validityDays:valNum("s-validity")||14,
    termsQuotation:val("s-terms-q"), termsAgreement:val("s-terms-a"), termsInvoice:val("s-terms-i"),
    introText:$("s-intro").value.trim(), offerNotes:$("s-bullets").value.trim(), coverNote:val("s-cover-note"),
    overdueDays:valNum("s-overdue")||14, staleDays:valNum("s-stale")||21, varianceFlag:valNum("s-variance")||15
  };
  api("PUT", "settings", data).then(function(saved){
    settingsDirty=false; state.settings=Object.assign({}, DEFAULTS, saved);
    $("s-saved").textContent="Saved"; applyBrand(); render(); toast("Company settings saved");
  }).catch(function(e){ toast(e.message || "Could not save settings", true); });
});

/* ---------- Accounts (owner) and own password ---------- */
/* ---------- Your data: backup, restore, spreadsheet; Recently deleted ---------- */
var KIND_LABEL={client:"Contact", product:"Product", base:"Base", cover:"Cover", supplier:"Supplier", employee:"Person",
  expense:"Expense", purchase_order:"Purchase order", service:"Service", offer_set:"Offer set", payment:"Payment", payroll_payment:"Salary payment", user:"Account"};
function renderData(){
  $("data-section").hidden = $("trash-section").hidden = !isOwner();
  if(!isOwner()) return;
  $("trash-empty").disabled = !state.trash.length;
  $("trash-body").innerHTML = state.trash.length ? state.trash.map(function(r){
    return '<tr><td class="strong">'+esc(r.label)+'</td><td><span class="pill neutral">'+esc(KIND_LABEL[r.kind]||r.kind)+'</span></td>'+
      '<td class="tiny muted">'+fmtDate((r.removed||"").slice(0,10))+(r.by ? ' · '+esc(r.by) : '')+'</td>'+
      '<td style="text-align:right; white-space:nowrap"><button class="btn sm" type="button" data-restore="'+r.id+'">Restore</button> '+
      '<button class="btn quiet sm" type="button" data-forget="'+r.id+'">Delete forever</button></td></tr>';
  }).join("") : emptyRow(4,"Nothing has been deleted.");
  $("trash-body").querySelectorAll("[data-restore]").forEach(function(b){
    b.addEventListener("click", function(){
      api("POST", "deleted/"+b.dataset.restore+"/restore").then(function(res){ return reload().then(function(){ toast(res.message||"Restored"); }); })
        .catch(function(e){ toast(e.message, true); });
    });
  });
  $("trash-body").querySelectorAll("[data-forget]").forEach(function(b){
    b.addEventListener("click", function(){
      if(!window.confirm("Delete this for good? It cannot be brought back after this.")) return;
      api("DELETE", "deleted/"+b.dataset.forget).then(reload).catch(function(e){ toast(e.message, true); });
    });
  });
}
$("trash-empty").addEventListener("click", function(){
  if(!window.confirm("Clear everything in Recently deleted? None of it can be brought back after this.")) return;
  api("DELETE", "deleted").then(function(){ return reload().then(function(){ toast("Recently deleted cleared"); }); }).catch(function(e){ toast(e.message, true); });
});
$("data-backup").addEventListener("click", function(){ window.location.href = BASE + "/api/backup"; });
$("data-restore").addEventListener("click", function(){ $("data-file").value=""; $("data-file").click(); });
$("data-file").addEventListener("change", function(){
  var f=this.files[0]; if(!f) return;
  if(!window.confirm("Restore from “"+f.name+"”?\n\nEverything in the system now will be replaced by what is in this file. Accounts and passwords stay as they are.")) return;
  var fd=new FormData(); fd.append("file", f);
  toast("Restoring…");
  fetch(BASE+"/api/restore", {method:"POST", body:fd, credentials:"same-origin",
    headers:{"Accept":"application/json", "X-CSRF-TOKEN":CSRF, "X-Requested-With":"XMLHttpRequest"}})
    .then(function(r){ return r.json().catch(function(){ return {}; }).then(function(j){ if(!r.ok) throw new Error(j.message||"Could not restore"); return j; }); })
    .then(function(j){ return reload().then(function(){ toast("Restored: "+j.deals+" deals and "+j.contacts+" contacts"+(j.from ? " from "+fmtDate(j.from.slice(0,10)) : "")); }); })
    .catch(function(e){ toast(e.message, true); });
});

/* Spreadsheet: built in the browser from what the page already holds. */
function loadSheetLib(){
  if(window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise(function(ok, fail){
    var sc=document.createElement("script");
    /* Shipped with the app (SheetJS, Apache-2.0) so it works without internet. */
    sc.src=BASE+"/assets/vendor/xlsx.full.min.js";
    sc.onload=function(){ ok(window.XLSX); }; sc.onerror=function(){ fail(new Error("Could not load the spreadsheet tool")); };
    document.head.appendChild(sc);
  });
}
function r2(v){ return Math.round(num(v)*100)/100; }
function workbookSheets(){
  var stockRows=allStockRows().map(function(r){ var it=r.item;
    return {"Kind":r.kind, "Item":it.name, "Category / line":it.category||it.line||"", "Cost":r2(itemCost(it)), "On hand":num(it.stockOnHand),
      "Reserved":reservedFor(r.kind,it.id), "Incoming":incomingFor(r.kind,it.id), "Available":availableOf(r.kind,it), "Reorder at":num(it.reorderThreshold),
      "Dealer WB":r2(it.dealerPriceWB), "End user WB":r2(it.endUserPriceWB), "Dealer 48":r2(it.dealerPrice48), "End user 48":r2(it.endUserPrice48),
      "Programming fee":r2(it.programmingFee), "Cover add-on":r2(it.priceAddOn)}; });
  var sheets=[
    ["Deals", state.transactions.map(function(t){ return {"Reference":t.refNo, "Date":txDocDate(t), "Client":t.clientName, "Client type":t.clientType,
      "Region":t.region, "Site":t.site||"", "Sold by":t.soldBy||"", "Stage":t.status, "Subtotal":r2(txSubtotal(t)), "VAT":r2(txVat(t)), "Total":r2(txTotal(t)),
      "Paid":r2(txPaid(t)), "Balance":r2(txBalance(t)), "Cost of goods":r2(txCOGS(t)), "Margin":r2(txMargin(t)), "Invoiced on":t.invoiceDate||"", "Delivered on":t.deliveredDate||""}; })],
    ["Deal lines", [].concat.apply([], state.transactions.map(function(t){ return (t.lineItems||[]).map(function(li){
      return {"Reference":t.refNo, "Client":t.clientName, "Stage":t.status, "Item":li.name, "Qty":num(li.qty), "Delivered":num(li.deliveredQty),
        "Unit price":r2(li.unitPrice), "Line total":r2(num(li.qty)*num(li.unitPrice)), "Unit cost":r2(li.costSnapshot)}; }); }))],
    ["Payments", [].concat.apply([], state.transactions.map(function(t){ return normalizedPayments(t).map(function(p){
      return {"Date":p.date, "Reference":t.refNo, "Client":t.clientName, "Type":p.type, "Method":p.method, "Amount":r2(p.amount)}; }); }))],
    ["Payment schedule", [].concat.apply([], state.transactions.map(function(t){ return (t.milestones||[]).map(function(m){
      return {"Reference":t.refNo, "Client":t.clientName, "Stage":m.label, "Due":m.dueDate||"", "Amount":r2(m.amount), "Paid":m.paid ? (m.paidDate||"yes") : ""}; }); }))],
    ["Contacts", state.clients.map(function(c){ var st=clientStats(c);
      return {"Name":c.name, "Type":c.type, "Region":c.region, "Tier":tierLabel(c), "Extra discount %":r2(num(c.discountPct)*100), "Phone":c.phone, "Email":c.email,
        "Deals":st.deals, "Billed":r2(st.billed), "Paid":r2(st.paid), "Outstanding":r2(st.outstanding)}; })],
    ["Stock", stockRows],
    ["Deliveries", state.deliveries.map(function(d){ var t=byId(state.transactions,d.transactionId)||{};
      return {"Date":d.date, "Reference":t.refNo||"", "Client":t.clientName||"", "Item":d.name, "Qty":num(d.qty), "By":d.by||""}; })],
    ["Purchase orders", state.orders.map(function(o){ return {"Order":o.refNo, "Supplier":o.supplierName, "Stage":o.status, "Ordered":o.orderedDate||"",
      "Expected":o.expectedDate||"", "Received":o.receivedDate||"", "Units":poUnits(o), "Cost":r2(poTotal(o))}; })],
    ["Suppliers", state.suppliers.map(function(sp){ var st=supplierStats(sp);
      return {"Supplier":sp.name, "Contact":sp.contact, "Phone":sp.phone, "Email":sp.email, "Country":sp.country, "Orders":st.orders, "Spent":r2(st.spent)}; })],
    ["Expenses", state.expenses.map(function(e){ return {"Date":e.date, "Category":e.category, "Description":e.description, "Paid to":e.vendor,
      "Method":e.paymentMethod, "Amount":r2(e.amount), "Purchase order":e.poRef||""}; })],
    ["Cash ledger", ledgerRows().map(function(r){ return {"Date":r.date, "Movement":r.label, "Reference":r.ref, "Method":r.method,
      "In":r.dir==="in" ? r2(r.amount) : "", "Out":r.dir==="out" ? r2(r.amount) : ""}; })],
    ["Profit and loss", monthKeys(12).map(plForMonth).map(function(m){ return {"Month":monthLabel(m.key), "Sales":r2(m.sales), "Cost of goods":r2(m.cogs),
      "Gross margin":r2(m.gross), "Expenses":r2(m.expenses), "Salaries":r2(m.payroll), "Net":r2(m.net), "Collected":r2(m.collected)}; })]
  ];
  if(isOwner()){
    sheets.push(["Payroll", state.payroll.map(function(p){ return {"Month":p.month, "Person":p.employeeName, "Paid on":p.paidDate||"", "Method":p.method, "Amount":r2(p.amount)}; })]);
    sheets.push(["Team", state.employees.map(function(e){ return {"Name":e.name, "Role":e.role, "Monthly salary":r2(e.monthlySalary), "Active":e.active!==false ? "yes" : "no"}; })]);
  }
  return sheets;
}
$("data-xlsx").addEventListener("click", function(){
  var btn=this; btn.disabled=true;
  loadSheetLib().then(function(X){
    var wb=X.utils.book_new();
    workbookSheets().forEach(function(sh){
      var ws = sh[1].length ? X.utils.json_to_sheet(sh[1]) : X.utils.aoa_to_sheet([["Nothing recorded yet"]]);
      X.utils.book_append_sheet(wb, ws, sh[0]);
    });
    X.writeFile(wb, "nestify-"+todayISO()+".xlsx");
  }).catch(function(e){ toast(e.message, true); }).then(function(){ btn.disabled=false; });
});

function renderAccounts(){
  $("accounts-section").hidden = !isOwner();
  if(!isOwner()) return;
  $("acc-body").innerHTML = state.users.length ? state.users.map(function(u){
    return '<tr class="clickable" data-u="'+u.id+'"><td class="strong">'+esc(u.name)+'</td><td class="mono tiny">'+esc(u.email)+'</td>'+
      '<td><span class="pill '+(u.role==="owner"?"accent":(u.role==="admin"?"info":"neutral"))+'">'+esc(ROLE_LABEL[u.role]||u.role)+'</span></td></tr>';
  }).join("") : emptyRow(3,"No accounts.");
  $("acc-body").querySelectorAll("[data-u]").forEach(function(r){
    r.addEventListener("click", function(){ editAccount(byId(state.users, r.dataset.u)); });
  });
}
function editAccount(u){
  var isNew=!u; var d=u||{name:"", email:"", role:"staff"};
  openForm((isNew?"Add":"Edit")+" account", [
    {fields:[{id:"u-name", label:"Name", value:d.name}, {id:"u-email", label:"Email", type:"email", value:d.email}]},
    {fields:[{id:"u-role", label:"Role", type:"select", options:[{value:"staff", label:"Sales"},{value:"admin", label:"Admin"},{value:"owner", label:"Owner"}], value:d.role},
             {id:"u-pass", label:isNew?"Password":"New password (leave empty to keep)", type:"password", value:""}]},
    {note:"Sales: offers, deals, contacts and stock levels. Admin: also the catalogue and company settings. Owner: everything, including cost prices, money, purchasing, payroll and accounts."}
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
