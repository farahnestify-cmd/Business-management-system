(function(){
"use strict";

/* ============================================================
   1. STATE
   ============================================================ */
var DEFAULTS = {
  name:"nestify", tagline:"Smart Home Systems", phone:"", email:"", website:"", address:"",
  vatPct:0, validityDays:14, overdueDays:14, staleDays:21, varianceFlag:15,
  termsQuotation:"All prices in USD. This quotation is valid for {validity} days from the date above. A down payment confirms the order and reserves the stock listed.",
  termsAgreement:"This agreement confirms the scope and prices listed above. The balance falls due on delivery unless a date is stated. Nestify remains the owner of the goods until payment is received in full.",
  termsInvoice:"Payment due on receipt. Please quote the reference number above with your transfer."
};

var state = {
  view:"today", tab:{inventory:"stock", money:"pl"},
  filters:{sales:"open", contacts:"all", ledger:"all"},
  clients:[], products:[], bases:[], covers:[], transactions:[], expenses:[], deliveries:[], trash:[], services:[], sets:[], tiers:[], currencies:[], coverTypes:[],
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
/* The books are in US dollars. A deal written in another currency is shown in it
   while CUR names that currency (see withCur); totals across deals are converted back. */
var CUR=null;
function curSym(code){
  if(!code || code==="USD") return "$";
  var c=(state.currencies||[]).filter(function(x){ return x.code===code; })[0];
  return c && c.symbol ? c.symbol : code+" ";
}
function money(v, dp, code){
  var n=num(v); var d=dp==null?2:dp;
  return (n<0?"−":"") + curSym(code||CUR) + Math.abs(n).toLocaleString("en-US",{minimumFractionDigits:d, maximumFractionDigits:d});
}
function usd(v, dp){ return money(v, dp, "USD"); }
function withCur(code, fn){ var prev=CUR; CUR=code||null; try{ return fn(); } finally{ CUR=prev; } }
function money0(v){ return money(v,0); }
function txCur(tx){ return (tx && tx.currency) || "USD"; }
function txRate(tx){ return (tx && num(tx.fxRate)) || 1; }
function inCur(tx, v, dp){ return money(v, dp, txCur(tx)); }
/* A deal's figure in dollars, at the rate it was written at. */
function toBase(tx, v){ return num(v)/txRate(tx); }
function baseOf(fn){ return function(tx){ return toBase(tx, fn(tx)); }; }
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
    var b=baseById(line.baseId), c=coverById(line.coverId), ct=coverTypeOf(line);
    if(!b) return 0;
    /* The base plus its cover type's add-on for this client's price column (a cover belongs to the
       type named by its line). Only a cover whose line is no type falls back to its own add-on. */
    var add = ct ? num(ctx.clientType==="Dealer" ? ct.addOnDealer : ct.addOnEndUser) : (c ? num(c.priceAddOn) : 0);
    return standardUnitPrice(b, ctx.clientType, ctx.region, ctx.service) + add;
  }
  return standardUnitPrice(productById(line.productId), ctx.clientType, ctx.region, ctx.service);
}
function lineCost(line){
  if(line.kind==="service") return 0; /* labour: no stock, no cost of goods */
  if(line.kind==="combo"){
    var cv=coverById(line.coverId);
    if(cv) return itemCost(baseById(line.baseId)) + itemCost(cv);
    /* Colour not chosen yet: the average cost of that type's covers. */
    var same=state.covers.filter(function(x){ return x.line===line.coverType; });
    return itemCost(baseById(line.baseId)) + (same.length ? sum(same, itemCost)/same.length : 0);
  }
  return itemCost(productById(line.productId));
}
function lineName(line){
  if(line.kind==="service") return line.name || "Service";
  if(line.kind==="combo"){
    /* The client sees the base's name; type and colour are for the team. */
    var b=baseById(line.baseId);
    return b ? b.name : "";
  }
  var p=productById(line.productId);
  return p ? p.name : "";
}
function lineReady(line){
  if(line.kind==="service") return !!(line.name||"").trim();
  return line.kind==="combo" ? !!(line.baseId && (line.coverType || line.coverId)) : !!line.productId;
}
function coverTypeByCode(code){ return code ? (state.coverTypes||[]).filter(function(t){ return t.code===code; })[0] || null : null; }
function coverTypeOf(line){ var c=coverById(line.coverId); return coverTypeByCode(line.coverType || (c && c.line)); }
/* A base sold with a cover type, whose colours are still to be chosen. */
function needsColour(li){ return li.kind==="combo" && !li.coverId; }
/* For the team only: "Q · Black Glossy" or "Q · colours to choose". */
function comboDetail(li){
  if(li.kind!=="combo") return "";
  var c=coverById(li.coverId), type=li.coverType || (c && c.line) || "";
  return [type, c ? c.name : "colours to choose"].filter(Boolean).join(" · ");
}

/* ============================================================
   5. TRANSACTION MATHS
   ============================================================ */
function txSubtotal(tx){ return sum(tx.lineItems||[], function(li){ return num(li.qty)*num(li.unitPrice); }); }
/* The discount on the total applies to goods; labour keeps its rate. */
function txDiscount(tx){
  return sum((tx.lineItems||[]).filter(function(li){ return li.kind!=="service"; }), function(li){ return num(li.qty)*num(li.unitPrice); }) * num(tx.discountPct);
}
function txNet(tx){ return txSubtotal(tx) - txDiscount(tx); }
function txVat(tx){ return txNet(tx) * (num(tx.vatPct)/100); }
function txTotal(tx){ return txNet(tx) + txVat(tx); }
/* What one unit of a line really sells for, after the discount on the total. */
function netUnit(tx, li){ return num(li.unitPrice) * (li.kind==="service" ? 1 : 1-num(tx.discountPct)); }
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
function txSubtotalBase(tx){ return toBase(tx, txNet(tx)); }
/* Cost of goods is in dollars, so the margin is too. */
function txMargin(tx){ return txSubtotalBase(tx) - txCOGS(tx); }
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
    if(needsColour(li)){ later.push({name:li.name+" (choose the cover colours)", qty:left, li:li}); return; }
    var keys = li.kind==="combo" ? [onShelf("base",li.baseId), onShelf("cover",li.coverId)] : [onShelf("product",li.productId)];
    var take=Math.min.apply(null, [left].concat(keys.map(function(k){ return shelf[k]; })));
    keys.forEach(function(k){ shelf[k]-=take; });
    if(take>0) now.push({name:li.name+(li.kind==="combo" && coverById(li.coverId) ? " · "+coverById(li.coverId).name : ""), qty:take, li:li});
    if(left-take>0) later.push({name:li.name, qty:left-take, li:li});
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
    billed: sum(rows, baseOf(txTotal)),
    paid: sum(rows, baseOf(txPaid)),
    outstanding: sum(rows, function(t){ return Math.max(0, toBase(t, txBalance(t))); }),
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
      var a=num(p.amount), base=toBase(t,a);
      rows.push({date:p.date, dir:a<0?"out":"in", kind:a<0?"Refund":"Client payment", label:(p.type||"Payment")+" — "+(t.clientName||""), ref:t.refNo, method:p.method||"", amount:Math.abs(base),
        orig: txCur(t)!=="USD" ? inCur(t, Math.abs(a)) : ""});
    });
  });
  state.expenses.forEach(function(e){
    rows.push({date:e.date, dir:"out", kind:"Expense", label:(e.description||e.category||"Expense")+(e.vendor?" — "+e.vendor:""), ref:e.poRef||e.category||"", method:e.paymentMethod||"", amount:num(e.amount)});
  });
  state.payroll.forEach(function(p){
    rows.push({date:p.paidDate||(p.month?p.month+"-01":""), dir:"out", kind:"Salary", label:"Salary — "+(p.employeeName||""), ref:p.month||"", method:p.method||"", amount:num(p.amount)});
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
    normalizedPayments(t).forEach(function(p){ if(monthKey(p.date)===key) total+=toBase(t, p.amount); });
  });
  return total;
}
function plForMonth(key){
  var billed = state.transactions.filter(function(t){ return isLive(t) && isBilled(t) && monthKey(txRecognisedDate(t))===key; });
  var sales = sum(billed, baseOf(txTotal));
  var cogs = sum(billed, txCOGS);
  var exp = sum(operatingExpenses(state.expenses).filter(function(e){ return monthKey(e.date)===key; }), function(e){ return e.amount; });
  var pay = sum(state.payroll.filter(function(p){ return payrollMonthKey(p)===key; }), function(p){ return p.amount; });
  return { key:key, sales:sales, cogs:cogs, gross:sales-cogs, expenses:exp, payroll:pay,
           net:sales-cogs-exp-pay, collected:collectedInMonth(key), deals:billed.length };
}
function outstandingTotal(){
  return sum(state.transactions.filter(isLive), function(t){ return Math.max(0, toBase(t, txBalance(t))); });
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
    ["clients","products","bases","covers","transactions","expenses","employees","payroll","suppliers","orders","users","deliveries","trash","services","sets","tiers","currencies","coverTypes"].forEach(function(k){
      state[k] = d[k] || [];
    });
    state.user = d.user;
    applyRole();
    autoDownloadBackup(d.autoBackup);
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
  reports:{title:"Monthly report", action:null},
  settings:{title:"Company settings", action:null}
};
function setView(name){
  if(state.user && !isOwner() && (name==="money" || name==="team" || name==="reports")) name="today";
  state.view = name;
  document.querySelectorAll(".view").forEach(function(v){ v.hidden = (v.id !== "view-"+name); });
  document.querySelectorAll(".nav-btn").forEach(function(b){ b.setAttribute("aria-current", String(b.dataset.view===name)); });
  var cfg = VIEWS[name] || VIEWS.today;
  $("view-title").textContent = cfg.title;
  var pa = $("primary-action");
  if(cfg.action){ pa.hidden=false; pa.textContent=cfg.action.label; pa.onclick=cfg.action.fn; } else { pa.hidden=true; }
  if(name==="inventory") syncInventoryAction();
  if(name==="settings") $("view-title").textContent = isManager() ? "Company settings" : "My account";
  if(name==="settings") backupsLoaded=false; /* the list is fetched fresh each time the page is opened */
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
    if(g.html) return g.html;
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

/* Windows close only from their own Close / Cancel buttons (or Esc): a click outside
   them does nothing, so a stray click never loses what was typed. The search palette
   is not a form, so it still closes on an outside click. */
$("palette").addEventListener("click", function(e){ if(e.target===$("palette")) closePalette(); });
document.addEventListener("keydown", function(e){
  if(e.key==="Escape"){
    if(!$("palette").hidden) return closePalette();
    if(!$("doc-overlay").hidden) return ($("doc-overlay").hidden=true);
    if(!$("form-overlay").hidden) return closeForm();
    if(!$("drawer-overlay").hidden) return closeDrawer();
    /* Esc only leaves an empty offer; one with something in it waits for Save or Discard. */
    if(!$("composer").hidden){
      if(!offerHasContent()) return closeComposer();
      return toast("Your offer is still here — Save it when it is ready, or Discard to leave it");
    }
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
  $("brand-mark").textContent = s.name || "nestify";
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
  if(state.view==="reports") renderReports();
  renderBell();
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
      items.push({sev:"bad", area:"sales", title:t.clientName+" owes "+inCur(t,txBalance(t)),
        detail:"Invoice "+invoiceRef(t.refNo)+" · "+age+" days old", value:inCur(t,txBalance(t)),
        go:function(){ setView("sales"); openTx(t.id); }});
    }
  });
  state.transactions.filter(isLive).forEach(function(t){
    (t.milestones||[]).forEach(function(m){
      if(m.paid || !m.dueDate) return;
      var late=daysSince(m.dueDate);
      if(late==null || late<=0) return;
      items.push({sev:"bad", area:"sales", title:t.clientName+" — "+m.label+" is overdue",
        detail:t.refNo+" · due "+fmtDate(m.dueDate)+" · "+late+" day"+(late>1?"s":"")+" late", value:inCur(t,m.amount),
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
        detail:"Signed "+age+" days ago · "+inCur(t,txBalance(t))+" outstanding", value:inCur(t,txBalance(t)),
        go:function(){ setView("sales"); openTx(t.id); }});
    }
  });
  state.transactions.filter(function(t){ return t.status==="Quotation" && !isSuperseded(t); }).forEach(function(t){
    var age = daysSince(txDocDate(t));
    if(age!=null && age > num(s.staleDays)){
      items.push({sev:"warn", area:"sales", title:"Quotation for "+t.clientName+" has gone quiet",
        detail:t.refNo+" · sent "+age+" days ago", value:inCur(t,txTotal(t)),
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
  state.transactions.filter(function(t){ return (t.status==="Agreement" || t.status==="Invoiced") && (t.lineItems||[]).some(needsColour); }).forEach(function(t){
    var n=sum((t.lineItems||[]).filter(needsColour), function(li){ return num(li.qty); });
    items.push({sev:"warn", area:"sales", title:"Choose the cover colours for "+t.clientName,
      detail:t.refNo+" · "+n+" base"+(n>1?"s":"")+" waiting for their colours", value:"", go:function(){ setView("sales"); openTx(t.id); }});
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
    figure("In the pipeline", money0(sum(live.filter(function(t){ return (t.status==="Quotation" || t.status==="Agreement") && !isSuperseded(t); }), baseOf(txTotal)))) +
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
      '<div class="tiny faint mono">'+esc(t.refNo)+'</div></td><td class="num">'+inCur(t,txTotal(t))+'</td>', go:function(){ setView("sales"); openTx(t.id); }});
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
/* Search and filters on top of the stage buttons. */
var salesF={q:"", client:"", ctype:"", region:"", seller:"", month:""};
function salesFilterOn(){ return Object.keys(salesF).some(function(k){ return !!salesF[k]; }); }
function salesFiltered(rows){
  var f=salesF;
  return rows.filter(function(t){
    if(f.client && t.clientId!==f.client) return false;
    if(f.ctype && t.clientType!==f.ctype) return false;
    if(f.region && t.region!==f.region) return false;
    if(f.seller && (t.soldBy||"").trim()!==f.seller) return false;
    if(f.month && monthKey(txDocDate(t))!==f.month) return false;
    return matchesQ(f.q, [t.refNo, t.rootRef, t.clientName, t.site, t.soldBy, t.notes, t.tableTitle, t.status, t.createdByName]
      .concat((t.lineItems||[]).map(function(li){ return li.name; })));
  });
}
function fillSalesFilters(){
  var opt=function(sel, label, list){
    var el=document.querySelector('[data-sf="'+sel+'"]'); if(!el) return;
    el.innerHTML='<option value="">'+esc(label)+'</option>'+list.map(function(o){ return '<option value="'+esc(o.v)+'">'+esc(o.l)+'</option>'; }).join("");
    el.value=salesF[sel];
  };
  var clients={}, sellers={}, months={};
  state.transactions.forEach(function(t){
    if(t.clientId) clients[t.clientId]=t.clientName||"—";
    if((t.soldBy||"").trim()) sellers[t.soldBy.trim()]=1;
    var m=monthKey(txDocDate(t)); if(m) months[m]=1;
  });
  opt("client", "All clients", sortBy(Object.keys(clients).map(function(id){ return {v:id, l:clients[id]}; }), function(o){ return o.l.toLowerCase(); }));
  opt("seller", "Anyone selling", Object.keys(sellers).sort().map(function(n){ return {v:n, l:n}; }));
  opt("month", "Any month", Object.keys(months).sort().reverse().map(function(m){ return {v:m, l:monthLabel(m)}; }));
  $("sf-clear").hidden=!salesFilterOn();
}
document.querySelectorAll("[data-sf]").forEach(function(inp){
  inp.addEventListener("input", function(){ salesF[inp.dataset.sf]=inp.value; renderSales(); });
});
$("sf-clear").addEventListener("click", function(){
  Object.keys(salesF).forEach(function(k){ salesF[k]=""; });
  document.querySelector('[data-sf="q"]').value="";
  document.querySelector('[data-sf="ctype"]').value=""; document.querySelector('[data-sf="region"]').value="";
  renderSales();
});
function renderSales(){
  fillSalesFilters();
  var live=state.transactions.filter(isLive);
  /* A superseded version is still listed, but it is not a second job. */
  var pipeline=live.filter(function(t){ return (t.status==="Quotation" || t.status==="Agreement") && !isSuperseded(t); });
  var mk=thisMonth();
  var billedThis=live.filter(function(t){ return isBilled(t) && monthKey(txRecognisedDate(t))===mk; });
  var withCost=live.filter(txHasCost);
  var marginPct = sum(withCost,txSubtotalBase)>0 ? sum(withCost,txMargin)/sum(withCost,txSubtotalBase) : 0;

  $("sales-figs").innerHTML =
    figure("In the pipeline", money0(sum(pipeline,baseOf(txTotal)))) +
    figure("Invoiced in "+monthShort(mk), money0(sum(billedThis,baseOf(txTotal)))) +
    figure("Outstanding", money0(outstandingTotal())) +
    (costsVisible() ? figure("Average margin", withCost.length ? pct(marginPct,0) : "—") : figure("Deals this month", String(live.filter(function(t){ return monthKey(txDocDate(t))===mk; }).length)));

  var stageRows=salesRows(), rows=salesFiltered(stageRows);
  $("sales-count").textContent = rows.length + (rows.length===1?" deal":" deals") +
    (salesFilterOn() && rows.length!==stageRows.length ? " of "+stageRows.length : "") +
    (state.filters.sales==="mine" ? " sold by you or written from your account" : "") +
    (state.filters.sales==="fromsales" ? " written by the sales team (staff accounts)" : "");
  $("sales-body").innerHTML = rows.length ? rows.map(function(t){
    var bal=txBalance(t), age=txAge(t), overdue = bal>0.004 && isBilled(t) && age!=null && age>num(state.settings.overdueDays);
    var m = txHasCost(t) ? pct(txMargin(t)/(txSubtotalBase(t)||1),0) : '<span class="faint">—</span>';
    return '<tr class="clickable" data-tx="'+t.id+'">'+
      '<td class="mono">'+esc(t.refNo)+(versionLabel(t) || isSuperseded(t) ? ' <span class="pill '+(isSuperseded(t)?"neutral":"info")+'">'+(versionLabel(t)||"V1")+'</span>' : '')+
        '<div class="tiny faint">'+fmtDate(txDocDate(t))+(isSuperseded(t) ? ' · superseded' : '')+'</div></td>'+
      '<td class="strong">'+esc(t.clientName||"—")+'<div class="tiny faint">'+esc(t.region||"")+' · '+esc(t.clientType||"")+
        (t.soldBy ? ' · '+esc(t.soldBy) : '')+'</div>'+(t.site ? '<div class="tiny muted">'+esc(t.site)+'</div>' : '')+'</td>'+
      '<td>'+dealStage(t)+'</td>'+
      '<td class="num">'+inCur(t,txTotal(t))+'</td>'+
      '<td class="num">'+balanceCell(t)+'</td>'+
      '<td>'+(isLive(t) && bal>0.004 && age!=null ? '<span class="pill '+(overdue?"bad":"neutral")+'">'+age+'d</span>' : '<span class="faint tiny">—</span>')+'</td>'+
      '<td class="num c-cost">'+m+'</td>'+
    '</tr>';
  }).join("") : emptyRow(7, salesFilterOn() ? "No deals match the search — clear the filters to see them all." : "No deals in this view.");
  $("sales-body").querySelectorAll("[data-tx]").forEach(function(r){
    r.addEventListener("click", function(){ openTx(r.dataset.tx); });
  });
}

function balanceCell(t){ return withCur(txCur(t), function(){ return balanceCellIn(t); }); }
function balanceCellIn(t){
  var due=refundDue(t), bal=txBalance(t);
  if(due>0.004) return '<span class="pill warn">refund '+money(due)+'</span>';
  if(!isLive(t)) return '<span class="faint">—</span>';
  return bal>0.004 ? money(bal) : '<span class="faint">settled</span>';
}

/* ---------- Transaction drawer ---------- */
function openTx(id){
  var tx=byId(state.transactions, id);
  return withCur(txCur(tx), function(){ return openTxIn(id); });
}
function openTxIn(id){
  var t=byId(state.transactions,id); if(!t) return;
  var pays=normalizedPayments(t);
  var live=isLive(t), due=refundDue(t), owed=live ? Math.max(0, txBalance(t)) : 0;
  var plan=t.status==="Invoiced" ? deliveryPlan(t) : {now:[], later:[]};
  var showDelivered=t.status==="Invoiced" || t.status==="Delivered";
  var next={Quotation:["Agreement","Cancelled"], Agreement:["Invoiced","Cancelled"], Invoiced:["Delivered","Cancelled"], Delivered:[], Cancelled:[]}[t.status]||[];
  var lines=(t.lineItems||[]).map(function(li){
    var unitCost = li.costSnapshot!=null ? num(li.costSnapshot) : lineCost(li);
    var lineMargin = num(li.qty)*(toBase(t,netUnit(t,li))-unitCost);
    var left=lineLeft(li);
    return '<tr><td>'+esc(li.name)+(li.kind==="service" ? '<div class="tiny faint">labour · no stock</div>' : '')+
      (li.kind==="combo" ? '<div class="tiny '+(needsColour(li)?'" style="color:var(--warn)':'faint"')+'>'+esc(comboDetail(li))+'</div>' : '')+'</td><td class="num">'+num(li.qty)+(li.unit ? ' <span class="tiny faint">'+esc(li.unit)+'</span>' : '')+'</td>'+
      (showDelivered ? '<td class="num">'+(li.kind==="service" ? '<span class="faint">—</span>' : (left>0 ? '<span style="color:var(--warn)">'+num(li.deliveredQty)+'</span>' : num(li.deliveredQty)))+'</td>' : '')+
      '<td class="num">'+money(li.unitPrice)+'</td>'+
      '<td class="num c-cost">'+(unitCost>0 ? usd(lineMargin) : '<span class="faint">—</span>')+'</td>'+
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
      (txDiscount(t)>0.004 ? '<div class="r"><span class="l">Discount '+r2(num(t.discountPct)*100)+'%</span><span class="mono">−'+money(txDiscount(t))+'</span></div>'+
        '<div class="r"><span class="l">After discount</span><span class="mono">'+money(txNet(t))+'</span></div>' : '')+
      (num(t.vatPct)>0 ? '<div class="r"><span class="l">VAT '+num(t.vatPct)+'%</span><span class="mono">'+money(txVat(t))+'</span></div>' : '')+
      '<div class="r"><span class="l">Paid</span><span class="mono">'+money(txPaid(t))+'</span></div>'+
      (txHasCost(t) ? '<div class="r c-cost"><span class="l">Margin</span><span class="mono">'+usd(txMargin(t))+' · '+pct(txMargin(t)/(txSubtotalBase(t)||1),0)+'</span></div>' : '')+
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
      '<button class="btn sm" type="button" data-doc="Quotation">Quotation'+(t.originalLines ? ' (original)' : '')+'</button>'+
      (t.originalLines ? '<button class="btn sm" type="button" data-doc="Updated Quotation">Updated quotation</button>' : '')+
      (t.agreementDate||isBilled(t) ? '<button class="btn sm" type="button" data-doc="Agreement">Agreement</button>' : '')+
      (isBilled(t) ? '<button class="btn sm" type="button" data-doc="Invoice">Invoice</button>' : '')+
      (deliveredSome(t) || deliveryLog(t).length ? '<button class="btn sm" type="button" data-doc="Delivery Note">Delivery note</button>' : '')+
      (txPaid(t)>0 ? '<button class="btn sm" type="button" data-doc="Receipt">Receipt</button>' : '')+
    '</div>'+
    deliveryLogHtml(t, false)+
    ((t.status==="Agreement" || t.status==="Invoiced") && (t.lineItems||[]).some(needsColour) ?
      '<div class="panel" style="padding:12px 14px; display:flex; gap:12px; align-items:center; justify-content:space-between">'+
        '<div class="tiny">The client agreed: choose the cover colours and how many of each, so the covers are reserved and can be delivered.</div>'+
        '<button class="btn sm primary" type="button" id="tx-colours" style="white-space:nowrap">Choose cover colours</button></div>' : '')+
    (isBilled(t) ? '<div style="display:flex; gap:8px; flex-wrap:wrap">'+
      (deliveredSome(t) ? '<button class="btn sm" type="button" id="tx-return">Return items</button>' : '')+
      '<button class="btn sm" type="button" id="tx-extra">Deliver extra items</button></div>' : '')+
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
      if(amt>due+0.004){ toast("Only "+inCur(t,due)+" is owed back to the client", true); return; }
      send("POST", "transactions/"+t.id+"/refunds", {amount:amt, method:val("tx-meth"), date:todayISO()},
        function(){ closeDrawer(); }, "Refund recorded");
      return;
    }
    if(amt>owed+0.004){ toast("That is more than the "+inCur(t,owed)+" still owed", true); return; }
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
  if($("tx-return")) $("tx-return").addEventListener("click", function(){ returnItemForm(t); });
  if($("tx-colours")) $("tx-colours").addEventListener("click", function(){ coloursForm(t); });
  if($("tx-extra")) $("tx-extra").addEventListener("click", function(){ extraItemForm(t); });
  if($("tx-revise")) $("tx-revise").addEventListener("click", function(){ closeDrawer(); openComposer(t, "revise"); });
  $("drawer-body").querySelectorAll("[data-ver]").forEach(function(a){
    a.addEventListener("click", function(e){ e.preventDefault(); openTx(a.dataset.ver); });
  });
  $("drawer-body").querySelectorAll("[data-ms]").forEach(function(b){
    b.addEventListener("click", function(){
      var m=byId(t.milestones||[], b.dataset.ms); if(!m) return;
      /* The method chosen in the payment box below applies to the stage too. */
      send("POST", "transactions/"+t.id+"/milestones/"+m.id+"/pay", {method:$("tx-meth") ? val("tx-meth") : "Bank Transfer", date:todayISO()},
        function(){ openTx(t.id); }, inCur(t,m.amount)+" recorded for "+m.label);
    });
  });
}
function advance(t, next){
  if(next==="Cancelled" && !window.confirm("Cancel "+t.refNo+"? The deal stays on record as cancelled."+
    (txPaid(t)>0.004 ? "\n\nThe client has paid "+inCur(t,txPaid(t))+". It stays in the cash ledger until you record the refund from this deal." : ""))) return;
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
function blankLine(){ return {kind:"product", productId:"", baseId:"", coverId:"", coverType:"", serviceId:"", name:"", unit:"", qty:1, unitPrice:0, touched:false}; }
function linesFrom(t){
  return (t.lineItems||[]).map(function(li){
    return {kind:li.kind, productId:li.productId||"", baseId:li.baseId||"", coverId:li.coverId||"", coverType:li.coverType||"", serviceId:li.serviceId||"",
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
    currency: src ? txCur(src) : "USD", fxRate: src ? txRate(src) : 1,
    lines: src ? linesFrom(src) : [blankLine()]};
  fillCurrencySelect();
  $("of-title").textContent = mode==="edit" ? "Edit quotation "+src.refNo
    : (mode==="revise" ? "Revise "+src.refNo+" for the client — saves as "+state.offer.reviseOf.root+"-V"+nextVersion : "New price offer");
  $("of-save").textContent = mode==="edit" ? "Save changes" : (mode==="revise" ? "Save as V"+nextVersion : "Save quotation");
  $("of-paid-wrap").hidden = $("of-method-wrap").hidden = !!src;
  $("of-date").value = mode==="edit" ? txDocDate(src) : todayISO();
  $("of-paid").value=0;
  $("of-notes").value = src ? (src.notes||"") : "";
  $("of-site").value = src ? (src.site||"") : "";
  $("of-table-title").value = src ? (src.tableTitle||"") : "";
  setDiscount(src && num(src.discountPct)>0 ? "custom" : "none", src ? num(src.discountPct) : 0);
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
        paidStages:state.offer.paidStages||[], ref:state.offer.ref||"", currency:state.offer.currency||"USD", fxRate:state.offer.fxRate||1},
      fields:{client:val("of-client"), region:val("of-region"), date:val("of-date"), site:val("of-site"), tableTitle:val("of-table-title"), disc:val("of-disc"), discPick:val("of-disc-pick"), seller:val("of-seller"),
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
    lines:o.lines||[blankLine()], milestones:o.milestones||[], paidStages: asRevision ? (o.paidStages||[]) : [],
    currency:o.currency||"USD", fxRate:num(o.fxRate)||1};
  fillCurrencySelect();
  $("of-client").value=f.client||""; $("of-region").value=f.region||"West Bank"; $("of-date").value=f.date||todayISO();
  $("of-site").value=f.site||""; $("of-table-title").value=f.tableTitle||""; setDiscount(f.discPick||"custom", num(f.disc)/100); $("of-seller").value=f.seller||""; $("of-paid").value=f.paid||0; $("of-method").value=f.method||"Cash";
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

/* ---------- After delivery: returns and extra items ---------- */
function deliveryLog(t){
  return sortBy(state.deliveries.filter(function(d){ return d.transactionId===t.id; }), function(d){ return (d.date||"")+String(d.id).padStart(10,"0"); });
}
/* Every movement on the deal, oldest first: what went out, what came back, what went out again. */
function deliveryLogHtml(t, printed){
  var log=deliveryLog(t); if(!log.length) return "";
  var rows=log.map(function(d){
    var back=d.type==="return";
    return '<tr><td>'+fmtDate(d.date)+'</td><td>'+(printed ? (back?"Returned":"Delivered") : '<span class="pill '+(back?"warn":"good")+'">'+(back?"Returned":"Delivered")+'</span>')+'</td>'+
      '<td>'+esc(d.name)+(d.note ? '<div class="tiny faint">'+esc(d.note)+'</div>' : '')+'</td>'+
      '<td class="'+(printed?"c":"num")+'">'+num(d.qty)+'</td>'+(printed ? '' : '<td class="tiny muted">'+esc(d.by||"")+'</td>')+'</tr>';
  }).join("");
  if(printed) return '<table class="d-items" style="margin-top:22px"><thead><tr class="d-ttl"><th colspan="4">Delivery log</th></tr>'+
    '<tr><th>Date</th><th>Movement</th><th>Item</th><th class="c">Qty</th></tr></thead><tbody>'+rows+'</tbody></table>';
  return '<div class="section"><p class="eyebrow">Delivery log</p><div class="panel"><div class="table-wrap"><table>'+
    '<thead><tr><th>Date</th><th>Movement</th><th>Item</th><th class="num">Qty</th><th>By</th></tr></thead><tbody>'+rows+'</tbody></table></div></div></div>';
}
/* After agreement: each base line sold by cover type gets its colours and how many of each. */
function coloursForm(t){
  var lines=(t.lineItems||[]).filter(function(li){ return needsColour(li) && !num(li.deliveredQty); });
  if(!lines.length){ toast("Every line already has its colours", true); return; }
  var picks={};
  lines.forEach(function(li){ picks[li.id]=[{coverId:"", qty:num(li.qty)}]; });
  function sumLine(id){
    var li=byId(lines, id), total=sum(picks[id], function(r){ return num(r.qty); }), el=$("cl-box").querySelector('[data-sum="'+id+'"]');
    if(el){ el.textContent=total+" of "+num(li.qty)+" chosen"; el.style.color = total===num(li.qty) ? "var(--good)" : "var(--warn)"; }
  }
  function coversFor(li){ return state.covers.filter(function(c){ return !li.coverType || !c.line || c.line===li.coverType; }); }
  function draw(){
    $("cl-box").innerHTML = lines.map(function(li){
      var rows=picks[li.id], total=sum(rows, function(r){ return num(r.qty); }), ok=total===num(li.qty);
      return '<div class="panel" style="padding:12px 14px; margin-bottom:10px">'+
        '<div style="display:flex; justify-content:space-between; gap:10px; margin-bottom:8px"><div class="strong">'+esc(li.name)+
          ' <span class="tiny faint">· '+esc(li.coverType||"")+' · '+num(li.qty)+' in all</span></div>'+
          '<div class="tiny" data-sum="'+li.id+'" style="color:'+(ok?"var(--good)":"var(--warn)")+'">'+total+' of '+num(li.qty)+' chosen</div></div>'+
        rows.map(function(r, k){
          var cv=coverById(r.coverId);
          return '<div class="mrow mrow-c" data-l="'+li.id+'" data-k="'+k+'">'+
            '<select data-f="coverId"><option value="">Colour…</option>'+coversFor(li).map(function(c){
              return '<option value="'+c.id+'"'+(c.id===r.coverId?" selected":"")+'>'+esc(c.name)+' · '+availableOf("cover",c)+' available</option>'; }).join("")+'</select>'+
            '<input data-f="qty" type="number" min="1" step="1" class="mono" value="'+num(r.qty)+'">'+
            '<button class="btn quiet sm" type="button" data-f="rm"'+(rows.length===1?" disabled":"")+' aria-label="Remove colour">×</button></div>'+
            (cv && num(r.qty)>availableOf("cover",cv) ? '<div class="tiny" style="color:var(--warn); margin:-2px 0 6px">only '+availableOf("cover",cv)+' '+esc(cv.name)+' available — the rest waits for stock</div>' : '');
        }).join("")+
        '<button class="btn sm" type="button" data-add="'+li.id+'" style="margin-top:6px">Add another colour</button></div>';
    }).join("");
    $("cl-box").querySelectorAll(".mrow[data-l]").forEach(function(row){
      var r=picks[row.dataset.l][Number(row.dataset.k)];
      row.querySelectorAll("[data-f]").forEach(function(inp){
        var f=inp.dataset.f;
        if(f==="rm"){ inp.addEventListener("click", function(){ picks[row.dataset.l].splice(Number(row.dataset.k),1); draw(); }); return; }
        /* Typing a quantity only updates the count, so the box keeps its focus. */
        if(f==="qty"){ inp.addEventListener("input", function(){ r.qty=num(inp.value); sumLine(row.dataset.l); }); return; }
        inp.addEventListener("change", function(){ r[f]=inp.value; draw(); });
      });
    });
    $("cl-box").querySelectorAll("[data-add]").forEach(function(b){
      b.addEventListener("click", function(){
        var li=byId(lines, b.dataset.add), rows=picks[li.id];
        var left=num(li.qty)-sum(rows, function(r){ return num(r.qty); });
        rows.push({coverId:"", qty:Math.max(1,left)}); draw();
      });
    });
  }
  openForm("Cover colours — "+t.refNo, [
    {html:'<div id="cl-box"></div>'},
    {note:"Each colour becomes its own line at the same price; the client's papers still print one row per base. The covers are reserved now and taken from stock at delivery."}
  ], function(){
    var out=[];
    for(var i=0;i<lines.length;i++){
      var li=lines[i], rows=picks[li.id];
      if(rows.some(function(r){ return !r.coverId; })){ toast("Choose a colour on every row of "+li.name, true); return false; }
      if(rows.some(function(r){ return num(r.qty)<1 || num(r.qty)!==Math.round(num(r.qty)); })){ toast("Enter how many of each colour for "+li.name, true); return false; }
      var total=sum(rows, function(r){ return num(r.qty); });
      if(total!==num(li.qty)){ toast("The colours for "+li.name+" add up to "+total+", not "+num(li.qty), true); return false; }
      out.push({lineId:Number(li.id), covers:rows.map(function(r){ return {coverId:Number(r.coverId), qty:num(r.qty)}; })});
    }
    send("POST", "transactions/"+t.id+"/colours", {lines:out}, function(){ closeForm(); openTx(t.id); }, "Cover colours saved");
    return false;
  });
  draw();
}

/* Both forms below hold several rows; each row is redrawn from its little state array. */
function rowsBox(id, addLabel){
  return '<div id="'+id+'" class="mrows"></div><button class="btn sm" type="button" id="'+id+'-add" style="margin-top:8px">'+addLabel+'</button>';
}
function returnItemForm(t){
  var lines=(t.lineItems||[]).filter(function(li){ return li.kind!=="service" && num(li.deliveredQty)>0; });
  if(!lines.length){ toast("Nothing has gone out on this deal yet", true); return; }
  var rows=[{lineId:lines[0].id, qty:1, outcome:"replace"}];
  function draw(){
    $("r-rows").innerHTML = '<div class="mrow mrow-r mrow-head"><span>Item</span><span>Qty back</span><span>What happens now</span><span></span></div>'+
      rows.map(function(r, i){
        return '<div class="mrow mrow-r" data-i="'+i+'">'+
          '<select data-f="lineId">'+lines.map(function(li){
            return '<option value="'+li.id+'"'+(li.id===r.lineId?" selected":"")+'>'+esc(li.name)+' · '+num(li.deliveredQty)+' delivered</option>'; }).join("")+'</select>'+
          '<input data-f="qty" type="number" min="1" step="1" class="mono" value="'+r.qty+'">'+
          '<select data-f="outcome"><option value="replace"'+(r.outcome==="replace"?" selected":"")+'>Replace — deliver again</option>'+
            '<option value="remove"'+(r.outcome==="remove"?" selected":"")+'>Not kept — off the invoice</option></select>'+
          '<button class="btn quiet sm" type="button" data-f="rm" aria-label="Remove row"'+(rows.length===1?" disabled":"")+'>×</button></div>';
      }).join("");
    $("r-rows").querySelectorAll(".mrow[data-i]").forEach(function(row){
      var r=rows[Number(row.dataset.i)];
      row.querySelectorAll("[data-f]").forEach(function(inp){
        var f=inp.dataset.f;
        if(f==="rm") inp.addEventListener("click", function(){ rows.splice(Number(row.dataset.i),1); draw(); });
        else inp.addEventListener("input", function(){ r[f] = f==="qty" ? num(inp.value) : inp.value; });
      });
    });
  }
  openForm("Return items — "+t.refNo, [
    {html: rowsBox("r-rows", "Add another item")},
    {fields:[{id:"r-note", label:"Why (shows in the log)", placeholder:"Faulty unit, wrong colour…"}]},
    {note:"Everything listed goes back into stock in one go. A replacement waits on the To deliver list until you press Deliver; an item the client does not keep comes off the invoice, and if they already paid more, the deal shows the refund due."}
  ], function(){
    var used={};
    for(var i=0;i<rows.length;i++){
      var r=rows[i], li=byId(lines, r.lineId);
      if(!li){ toast("Choose the item on row "+(i+1), true); return false; }
      if(r.qty<1 || r.qty!==Math.round(r.qty)){ toast("Enter how many came back on row "+(i+1), true); return false; }
      used[li.id]=(used[li.id]||0)+r.qty;
      if(used[li.id]>num(li.deliveredQty)){ toast("Only "+num(li.deliveredQty)+" of "+li.name+" went out", true); return false; }
    }
    send("POST", "transactions/"+t.id+"/returns", {note:val("r-note"),
      items:rows.map(function(r){ return {lineId:Number(r.lineId), qty:r.qty, outcome:r.outcome}; })},
      function(){ closeForm(); openTx(t.id); }, rows.length>1 ? rows.length+" returns recorded" : "Return recorded");
    return false;
  });
  draw();
  $("r-rows-add").addEventListener("click", function(){
    var taken={}; rows.forEach(function(r){ taken[r.lineId]=1; });
    var next=lines.filter(function(li){ return !taken[li.id]; })[0] || lines[0];
    rows.push({lineId:next.id, qty:1, outcome:"replace"}); draw();
  });
}
function extraItemForm(t){
  var c=clientById(t.clientId), tier=c ? tierById(c.tierId) : null;
  var ctx={clientType: tier ? (tier.basis==="Dealer" ? "Dealer" : "End User") : t.clientType, region:t.region, service:t.serviceType};
  var rows=[{item:"", cover:"", qty:1, price:0}];
  /* The price starts at the client's book price and can be changed (0 for a free item). */
  function suggest(r){
    var line = r.item.indexOf("p:")===0 ? {kind:"product", productId:r.item.slice(2)}
      : (r.item.indexOf("b:")===0 ? {kind:"combo", baseId:r.item.slice(2), coverId:r.cover} : null);
    /* An item already on the deal starts at that row's price, so it is added to the same row. */
    var same = line && (t.lineItems||[]).filter(function(li){
      return li.kind===line.kind && (line.kind==="product" ? li.productId===line.productId : (li.baseId===line.baseId && li.coverId===line.coverId));
    })[0];
    r.onDeal = !!same;
    r.price = same ? num(same.unitPrice) : (line ? r2(lineStandard(line, ctx)*txRate(t)) : 0);
  }
  function draw(){
    $("x-rows").innerHTML = '<div class="mrow mrow-x mrow-head"><span>Item</span><span>Cover (for a base)</span><span>Qty</span><span>Unit price ('+esc(txCur(t))+')</span><span></span></div>'+
      rows.map(function(r, i){
        var isBase=r.item.indexOf("b:")===0, b=isBase ? baseById(r.item.slice(2)) : null;
        var covers=isBase ? state.covers.filter(function(cv){ return !b || !b.line || !cv.line || cv.line===b.line; }) : [];
        return '<div class="mrow mrow-x" data-i="'+i+'">'+
          '<select data-f="item"><option value="">Choose…</option>'+
            (state.products.length ? '<optgroup label="Products">'+state.products.map(function(p){
              return '<option value="p:'+p.id+'"'+(r.item==="p:"+p.id?" selected":"")+'>'+esc(p.name)+'</option>'; }).join("")+'</optgroup>' : '')+
            (state.bases.length ? '<optgroup label="Bases — choose a cover">'+state.bases.map(function(bb){
              return '<option value="b:'+bb.id+'"'+(r.item==="b:"+bb.id?" selected":"")+'>'+esc(bb.name)+'</option>'; }).join("")+'</optgroup>' : '')+
          '</select>'+
          (isBase ? '<select data-f="cover"><option value="">Choose…</option>'+covers.map(function(cv){
              return '<option value="'+cv.id+'"'+(r.cover===cv.id?" selected":"")+'>'+esc(cv.name)+'</option>'; }).join("")+'</select>'
            : '<span class="tiny faint" style="align-self:center">—</span>')+
          '<input data-f="qty" type="number" min="1" step="1" class="mono" value="'+r.qty+'">'+
          '<input data-f="price" type="number" min="0" step="0.01" class="mono" value="'+r.price+'" title="'+(r.onDeal ? "Already on this deal: at this price it joins the same row" : "")+'">'+
          '<button class="btn quiet sm" type="button" data-f="rm" aria-label="Remove row"'+(rows.length===1?" disabled":"")+'>×</button></div>';
      }).join("");
    $("x-rows").querySelectorAll(".mrow[data-i]").forEach(function(row){
      var r=rows[Number(row.dataset.i)];
      row.querySelectorAll("[data-f]").forEach(function(inp){
        var f=inp.dataset.f;
        if(f==="rm"){ inp.addEventListener("click", function(){ rows.splice(Number(row.dataset.i),1); draw(); }); return; }
        if(f==="item" || f==="cover"){
          inp.addEventListener("change", function(){ r[f]=inp.value; if(f==="item") r.cover=""; suggest(r); draw(); });
          return;
        }
        inp.addEventListener("input", function(){ r[f]=num(inp.value); });
      });
    });
  }
  openForm("Deliver extra items — "+t.refNo, [
    {html: rowsBox("x-rows", "Add another item")},
    {fields:[{id:"x-note", label:"Note (shows in the log)", placeholder:"Added on site, swapped model…"}]},
    {note:"Each item is handed over from stock now. One already on the deal at the same price is added to its row; anything else becomes a new line (put 0 as the price for anything given free). What is not in stock waits on the To deliver list."+
      (num(t.discountPct)>0 ? " The deal's "+r2(num(t.discountPct)*100)+"% discount applies to them too." : "")}
  ], function(){
    var items=[];
    for(var i=0;i<rows.length;i++){
      var r=rows[i], n=" on row "+(i+1);
      if(!r.item){ toast("Choose the item"+n, true); return false; }
      if(r.qty<1 || r.qty!==Math.round(r.qty)){ toast("Enter how many"+n, true); return false; }
      if(r.price<0){ toast("The price cannot be below zero"+n, true); return false; }
      var it={qty:r.qty, unitPrice:r.price};
      if(r.item.indexOf("p:")===0){ it.kind="product"; it.productId=Number(r.item.slice(2)); }
      else {
        if(!r.cover){ toast("Choose the cover for the base"+n, true); return false; }
        it.kind="combo"; it.baseId=Number(r.item.slice(2)); it.coverId=Number(r.cover);
      }
      items.push(it);
    }
    send("POST", "transactions/"+t.id+"/extra", {note:val("x-note"), items:items}, function(res){
      closeForm(); openTx(t.id);
      toast(res && res.waiting ? res.delivered+" delivered now, "+res.waiting+" waiting for stock" : "Delivered and added to the deal");
    });
    return false;
  });
  draw();
  $("x-rows-add").addEventListener("click", function(){ rows.push({item:"", cover:"", qty:1, price:0}); draw(); });
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
    return {kind:l.kind||"product", productId:l.productId||"", baseId:l.baseId||"", coverId:l.coverId||"", coverType:l.coverType||"", serviceId:l.serviceId||"",
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
      return {kind:l.kind, productId:l.productId||null, baseId:l.baseId||null, coverId:l.coverId||null, coverType:l.coverType||null, serviceId:l.serviceId||null,
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
    applyClientDiscount();
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
    tier: c?tierById(c.tierId):null,
    currency: (state.offer && state.offer.currency) || "USD", rate: (state.offer && num(state.offer.fxRate)) || 1
  };
  /* A tier decides the price column; its discount stacks with the contact's own extra discount. */
  if(ctx.tier) ctx.clientType = ctx.tier.basis==="Dealer" ? "Dealer" : "End User";
  /* Lines are priced from the book; the discount is taken off the total and printed under it. */
  ctx.discount = Math.min(0.95, Math.max(0, valNum("of-disc")/100));
  return ctx;
}
/* ---------- Quoting in another currency ---------- */
function currencyByCode(code){ return (state.currencies||[]).filter(function(c){ return c.code===code; })[0] || null; }
function offerLockedCurrency(){
  /* Money already taken on this deal was taken in its currency, so the currency stays. */
  var o=state.offer||{}, id=o.editId || (o.reviseOf && o.reviseOf.id);
  var t=id ? byId(state.transactions, id) : null;
  return t && txPaid(t)>0.004 ? txCur(t) : null;
}
function fillCurrencySelect(){
  var cur=state.offer.currency||"USD", locked=offerLockedCurrency();
  var list=(state.currencies||[]).filter(function(c){ return c.active || c.code===cur; });
  $("of-cur").innerHTML='<option value="USD">USD · $</option>'+list.map(function(c){
    return '<option value="'+esc(c.code)+'">'+esc(c.code)+(c.symbol?' · '+esc(c.symbol):'')+'</option>'; }).join("");
  $("of-cur").value=cur; $("of-cur").disabled=!!locked;
  var other=cur!=="USD";
  $("of-rate").hidden=!other; $("of-rate").value=other ? num(state.offer.fxRate) : 1;
  $("of-rate-note").hidden=!other && !locked;
  $("of-rate-note").textContent = locked ? "Payments were taken in "+locked+", so it stays in "+locked+"."
    : (other ? num(state.offer.fxRate)+" "+cur+" = $1 on this offer" : "");
}
/* Prices already typed in follow the new currency or rate, so nothing changes in real terms. */
function setOfferCurrency(code, rate){
  var o=state.offer, ratio=rate/(num(o.fxRate)||1);
  if(Math.abs(ratio-1)>1e-9){
    o.lines.forEach(function(l){ if(l.touched) l.unitPrice=Math.round(num(l.unitPrice)*ratio*100)/100; });
    (o.milestones||[]).forEach(function(m){ m.amount=Math.round(num(m.amount)*ratio*100)/100; });
  }
  o.currency=code; o.fxRate=rate;
  fillCurrencySelect(); renderComposer(); renderMilestones(); scheduleDraftSave();
}
$("of-cur").addEventListener("change", function(){
  var code=$("of-cur").value, c=currencyByCode(code);
  setOfferCurrency(code, code==="USD" ? 1 : (c ? num(c.rate) : 1));
});
$("of-rate").addEventListener("change", function(){
  var r=num($("of-rate").value);
  if(r<=0){ toast("The rate must be more than zero", true); fillCurrencySelect(); return; }
  setOfferCurrency(state.offer.currency, r);
});
/* What the price book says for a line, in the offer's currency. */
function offerStandard(l, ctx){
  var std=lineStandard(l, ctx);
  return (l.kind==="service" && !l.serviceId) ? std : std*ctx.rate;
}
function renderComposer(){ return withCur(state.offer.currency, renderComposerIn); }
function renderComposerIn(){
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
    var std=offerStandard(ln,ctx), suggested = std;
    if(!ln.touched) ln.unitPrice=Math.round(suggested*100)/100;
    var cost=lineCost(ln), lineTotal=num(ln.qty)*num(ln.unitPrice);
    var off=num(ln.unitPrice)-suggested;
    var unitBase=num(ln.unitPrice)*(ln.kind==="service" ? 1 : 1-ctx.discount)/ctx.rate;
    var marginTxt = costsVisible() ? (cost>0 ? pct((unitBase-cost)/(unitBase||1),0) : "—") : "";
    var flagged = Math.abs(off)/ctx.rate > num(state.settings.varianceFlag);
    var itemVal = ln.kind==="service" ? (ln.serviceId ? "s:"+ln.serviceId : "s:custom")
      : (ln.kind==="combo" ? (ln.baseId?"b:"+ln.baseId:"") : (ln.productId?"p:"+ln.productId:""));
    var activeServices=(state.services||[]).filter(function(sv){ return sv.active!==false; });
    var avail = null;
    if(ln.kind==="combo"){ var bb=baseById(ln.baseId), cc=coverById(ln.coverId);
      if(bb) avail=availableOf("base",bb); if(cc) avail=Math.min(avail==null?Infinity:avail, availableOf("cover",cc)); }
    else if(ln.kind!=="service"){ var pp=productById(ln.productId); if(pp) avail=availableOf("product",pp); }
    var types=state.coverTypes||[];
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
        /* A base is offered with a cover type only (Q, S…); the colours come after the client agrees. */
        (ln.kind==="combo" ? '<select data-f="ctype"><option value="">Cover type…</option>'+types.map(function(ct){
            return '<option value="'+esc(ct.code)+'"'+(ct.code===(ln.coverType || (coverById(ln.coverId)||{}).line)?" selected":"")+'>'+esc(ct.code)+(ct.name && ct.name!==ct.code ? ' — '+esc(ct.name) : '')+'</option>'; }).join("")+'</select>'+
          '<div class="tiny faint" style="margin-top:4px">'+(coverById(ln.coverId) ? 'colour: '+esc(coverById(ln.coverId).name) : 'not shown to the client · colours after approval')+'</div>' : '')+
      '</div>'+
      '<div><div class="lbl">'+(ln.kind==="service" ? "Units" : "Qty")+'</div><input data-f="qty" type="number" min="0" step="1" value="'+num(ln.qty)+'">'+
        (num(ln.qty)===0 && lineReady(ln) ? '<div class="tiny faint" style="margin-top:4px">optional</div>' : '')+
        (avail!=null && num(ln.qty)>avail ? '<div class="tiny" style="color:var(--warn); margin-top:4px">'+(avail>0 ? 'only '+avail+' available' : 'none available')+'</div>' : '')+'</div>'+
      '<div><div class="lbl">Book price</div><div class="fixed">'+money(suggested)+'</div></div>'+
      '<div><div class="lbl">You charge</div><input data-f="price" type="number" step="0.01" value="'+num(ln.unitPrice).toFixed(2)+'"></div>'+
      '<div><div class="lbl">'+(costsVisible() ? "Line · margin" : "Line")+'</div><div class="fixed">'+money(lineTotal)+
        '<div class="tiny '+(flagged?"":"faint")+'" style="'+(flagged?"color:var(--warn)":"")+'">'+
          marginTxt+(flagged ? (marginTxt?" · ":"")+(off>0?"+":"")+money0(off)+" off book" : "")+'</div></div></div>'+
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
          else if(v.indexOf("b:")===0){
            L.kind="combo"; L.baseId=v.slice(2); L.productId=""; L.coverId="";
            /* Start from the base's own line when it is a type, otherwise the only type there is. */
            var bb2=baseById(L.baseId), ts=state.coverTypes||[];
            L.coverType = (bb2 && coverTypeByCode(bb2.line)) ? bb2.line : (ts.length===1 ? ts[0].code : "");
          }
          else if(v.indexOf("s:")===0){
            /* A service is charged at its rate, not discounted like the price book. */
            L.kind="service"; L.productId=""; L.baseId=""; L.coverId="";
            var sv = v==="s:custom" ? null : serviceById(v.slice(2));
            L.serviceId = sv ? sv.id : ""; L.name = sv ? sv.name : ""; L.unit = sv ? sv.unit : "";
            L.unitPrice = sv ? Math.round(num(sv.rate)*(num(state.offer.fxRate)||1)*100)/100 : 0; L.touched=true;
          }
          else { L.kind="product"; L.productId=""; L.baseId=""; L.coverId=""; }
        } else if(f==="ctype"){ L.coverType=inp.value; L.coverId=""; L.touched=false; }
        else if(f==="price"){ L.touched=true; L.unitPrice=num(inp.value); }
        else if(f==="qty"){ L.qty=num(inp.value); }
        renderComposer();
      });
    });
  });

  var done=state.offer.lines.filter(lineReady);
  var gross=sum(done,function(l){ return num(l.qty)*num(l.unitPrice); });
  var disc=offerDiscountAmount(done, ctx.discount);
  var subtotal=gross-disc;
  var cogs=sum(done,function(l){ return num(l.qty)*lineCost(l); });
  var vat=subtotal*(num(state.settings.vatPct)/100);
  var paid=state.offer.editId ? 0 : valNum("of-paid");
  $("of-totals").innerHTML =
    '<div class="r"><span class="l">Subtotal</span><span class="mono">'+money(gross)+'</span></div>'+
    (disc>0 ? '<div class="r"><span class="l">Discount '+r2(ctx.discount*100)+'%</span><span class="mono">−'+money(disc)+'</span></div>'+
      '<div class="r"><span class="l">After discount</span><span class="mono">'+money(subtotal)+'</span></div>' : '')+
    (cogs>0 ? '<div class="r c-cost"><span class="l">Margin on this offer</span><span class="mono">'+usd(subtotal/ctx.rate-cogs)+' · '+pct((subtotal/ctx.rate-cogs)/((subtotal/ctx.rate)||1),0)+'</span></div>' : '')+
    (vat>0 ? '<div class="r"><span class="l">VAT '+num(state.settings.vatPct)+'%</span><span class="mono">'+money(vat)+'</span></div>' : '')+
    '<div class="r grand"><span class="l">Total</span><span class="v">'+money(subtotal+vat)+'</span></div>'+
    (state.offer.editId ? '' : '<div class="r"><span class="l">Balance after payment now</span><span class="mono">'+money(subtotal+vat-paid)+'</span></div>');
  refreshMilestoneSum();
}
/* ---------- Payment schedule on the offer ---------- */
function offerDiscountAmount(lines, pctOff){
  return sum(lines.filter(function(l){ return l.kind!=="service"; }), function(l){ return num(l.qty)*num(l.unitPrice); }) * pctOff;
}
function offerTotal(){
  var done=state.offer.lines.filter(lineReady), d=Math.min(0.95, Math.max(0, valNum("of-disc")/100));
  return (sum(done,function(l){ return num(l.qty)*num(l.unitPrice); }) - offerDiscountAmount(done, d))*(1+num(state.settings.vatPct)/100);
}
/* Choosing a client brings in their tier and extra discount; it can still be changed by hand. */
function applyClientDiscount(){
  var c=clientById($("of-client").value);
  setDiscount(c && effectiveDiscount(c)>0 ? "client" : "none");
}
/* The discount picker: none, the client's own, any active price tier, or a figure typed in. */
function discountChoices(){
  var c=clientById($("of-client").value), mine=c ? effectiveDiscount(c) : 0, t=c ? tierById(c.tierId) : null;
  var out=[{key:"none", label:"No discount", pct:0}];
  if(mine>0) out.push({key:"client", label:"This client's discount"+(t ? " · "+t.name+(num(c.discountPct)>0?" + extra":"") : ""), pct:mine});
  (state.tiers||[]).filter(function(x){ return x.active && num(x.discountPct)>0; }).forEach(function(x){
    out.push({key:"t:"+x.id, label:x.name+(x.code?" ("+x.code+")":""), pct:num(x.discountPct)});
  });
  out.push({key:"custom", label:"Custom — type the %", pct:null});
  return out;
}
function setDiscount(key, pctValue){
  var list=discountChoices(), hit=list.filter(function(o){ return o.key===key; })[0] || list[list.length-1];
  $("of-disc-pick").innerHTML=list.map(function(o){
    return '<option value="'+esc(o.key)+'">'+esc(o.label)+(o.pct!=null ? ' — '+r2(o.pct*100)+'%' : '')+'</option>'; }).join("");
  $("of-disc-pick").value=hit.key;
  var p = hit.pct!=null ? hit.pct : num(pctValue);
  $("of-disc").value = r2(p*100);
  $("of-disc").readOnly = hit.key!=="custom";
  $("of-disc-note").textContent = hit.key==="custom" ? "" : (p>0 ? "comes off the goods, not the labour" : "");
}
$("of-disc-pick").addEventListener("change", function(){
  setDiscount($("of-disc-pick").value, valNum("of-disc")/100);
  if($("of-disc-pick").value==="custom") $("of-disc").focus();
  renderComposer(); refreshMilestoneSum(); scheduleDraftSave();
});
$("of-disc").addEventListener("input", function(){ renderComposer(); refreshMilestoneSum(); });
function renderMilestones(){ return withCur(state.offer.currency, renderMilestonesIn); }
function renderMilestonesIn(){
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
function refreshMilestoneSum(){ return withCur(state.offer.currency, refreshMilestoneSumIn); }
function refreshMilestoneSumIn(){
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
  var total=offerTotal();
  if(paid>total+0.004){ toast("Paid now is more than the offer total of "+money(total,2,ctx.currency), true); return; }
  var data={
    clientId:ctx.client.id, region:ctx.region, dealType:ctx.type, serviceType:ctx.service,
    date:ctx.date, dueDate:val("of-due") || null, notes:val("of-notes"),
    site:val("of-site"), tableTitle:val("of-table-title"), soldBy:val("of-seller"),
    paid:paid, method:val("of-method"), setId:state.offer.setId||null,
    currency:ctx.currency, fxRate:ctx.rate, discountPct:ctx.discount,
    milestones:(state.offer.milestones||[]).filter(function(m){ return num(m.amount)>0; })
      .map(function(m){ return {label:m.label, amount:num(m.amount), dueDate:m.dueDate||null}; }),
    lines:done.map(function(l){
      var base={kind:l.kind, qty:num(l.qty), standardPrice:Math.round(offerStandard(l,ctx)*100)/100, unitPrice:num(l.unitPrice)};
      if(l.kind==="service"){ base.serviceId=l.serviceId||null; base.name=(l.name||"").trim(); base.unit=l.unit||""; }
      else if(l.kind==="combo"){ base.baseId=l.baseId; base.coverId=l.coverId||null; base.coverType=l.coverType || (coverById(l.coverId)||{}).line || null; } else { base.productId=l.productId; }
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
  return '<div class="d-bar">'+(s.logo ? '<img class="d-logo" src="'+esc(s.logo)+'" alt="'+esc(s.name||"")+'">' : '<span class="d-word">'+esc(s.name||"nestify")+'</span>')+
    '<span class="d-bar-r">'+esc(s.tagline||"")+'</span></div>';
}
function docFootBar(s, page, of){
  return '<div class="d-footbar"><span>'+[s.address,s.email,s.phone].filter(Boolean).map(esc).join("  |  ")+'</span><span>Page '+page+' of '+of+'</span></div>';
}
/* Document wording written for dollars ("All prices in USD") follows the deal's currency. */
function curWording(t, text){
  var cur=txCur(t); if(cur==="USD") return text;
  var c=currencyByCode(cur), name=c ? c.name : cur;
  return text.replace(/\bUSD\b/g, cur).replace(/\bUS dollars\b/gi, name);
}
/* "Quotation" always prints the offer as the client agreed it; once returns or extra items have
   changed the deal, "Updated Quotation" prints the lines as they are now (reference with -R). */
function openDoc(t, kind){
  var updated = kind==="Updated Quotation";
  var src = kind==="Quotation" && t.originalLines ? Object.assign({}, t, {lineItems:t.originalLines}) : t;
  var r = withCur(txCur(t), function(){ return openDocIn(src, updated ? "Quotation" : kind, updated); });
  docState.t=t; docState.kind=kind;
  return r;
}
/* Whole amounts print without cents ($90), others with them ($90.50). */
function docMoney(v){ var n=num(v); return money(n, Math.abs(n-Math.round(n))<0.005 ? 0 : 2); }
/* A line's picture: the product's, or for a base + cover the cover's (its colour), else the base's. */
function lineImage(li){ return lineImages(li)[0] || ""; }
/* A base sold with a cover type shows that type's pictures of the base (up to four, side by side). */
function lineImages(li){
  if(li.kind==="service") return [];
  if(li.kind==="combo"){
    var c=coverById(li.coverId), b=baseById(li.baseId), type=li.coverType || (c && c.line);
    var set = b && b.typeImages && type ? (b.typeImages[type]||[]) : [];
    if(set.length) return set;
    var one=(c&&c.image) || (b&&b.image); return one ? [one] : [];
  }
  var p=productById(li.productId); return p && p.image ? [p.image] : [];
}
function openDocIn(t, kind, updated){
  docState.t=t; docState.kind=kind;
  var s=state.settings;
  var refMap={"Quotation":t.refNo, "Agreement":agreementRef(t.refNo), "Invoice":invoiceRef(t.refNo),
              "Delivery Note":invoiceRef(t.refNo), "Receipt":invoiceRef(t.refNo)};
  var dateMap={"Quotation":txDocDate(t), "Agreement":t.agreementDate, "Invoice":t.invoiceDate,
               "Delivery Note":t.deliveredDate||todayISO(), "Receipt":todayISO()};
  if(updated){ refMap.Quotation=t.refNo+"-R"; dateMap.Quotation=todayISO(); }
  var client=clientById(t.clientId)||{};
  var showMoney = kind!=="Delivery Note";
  var terms = kind==="Quotation" ? s.termsQuotation : (kind==="Agreement" ? s.termsAgreement : s.termsInvoice);
  terms = curWording(t, String(terms||"").replace("{validity}", num(s.validityDays)));

  var isNote = kind==="Delivery Note";
  /* After the quotation, a line taken off the deal (nothing left, nothing with the client) is not printed. */
  var lines=(t.lineItems||[]).filter(function(li){
    if(isNote && li.kind==="service") return false;
    /* On the updated quotation a row at 0 is one taken off the deal, unless it was an option on the original. */
    if(updated && num(li.qty)===0){
      var was=(t.originalLines||[]).filter(function(o){ return o.id===li.id; })[0];
      return !!was && num(was.qty)===0;
    }
    return kind==="Quotation" || num(li.qty)>0 || num(li.deliveredQty)>0;
  });
  /* The same item at the same price prints as one row, however many times it was added. */
  var merged=[], seen={};
  lines.forEach(function(li){
    /* Colours split a base line for the warehouse; the client's papers print it as one row. */
    var key = li.kind==="service" ? null : [li.kind, li.productId||"", li.baseId||"", isNote ? (li.coverId||"") : (li.coverType || (coverById(li.coverId)||{}).line || li.coverId || ""), r2(li.unitPrice)].join("|");
    if(key && seen[key]){ seen[key].qty=num(seen[key].qty)+num(li.qty); seen[key].deliveredQty=num(seen[key].deliveredQty)+num(li.deliveredQty); return; }
    var copy=Object.assign({}, li); merged.push(copy); if(key) seen[key]=copy;
  });
  lines=merged;
  /* The Image column only appears when at least one line has a picture. */
  var withPics = lines.some(function(li){ return !!lineImage(li); });
  var code=txCur(t);
  var cols = isNote ? 5+(withPics?1:0) : 5+(withPics?1:0);
  var title = t.tableTitle ? '<tr class="d-ttl"><th colspan="'+cols+'">'+esc(t.tableTitle)+'</th></tr>' : '';
  var head = '<tr><th class="c">Item</th><th>Description</th>'+(withPics?'<th class="c">Image</th>':'')+
    (isNote ? '<th class="c">Ordered</th><th class="c">Delivered</th><th class="c">Still to come</th>'
      : '<th class="c">Quantity</th><th class="c">Unit Price ('+esc(code)+')</th><th class="c">Amount ('+esc(code)+')</th>')+'</tr>';
  var rows=lines.map(function(li, i){
    var pic = withPics ? '<td class="c pic">'+lineImages(li).map(function(u){ return '<img src="'+esc(u)+'" alt="">'; }).join("")+'</td>' : '';
    /* The warehouse needs the colour on the delivery note; the client's papers show the base's name. */
    var shown = li.name + (isNote && li.kind==="combo" && coverById(li.coverId) ? " · "+coverById(li.coverId).name : "");
    var start = '<td class="c">'+(i+1)+'</td><td>'+esc(shown)+'</td>'+pic;
    if(isNote) return '<tr>'+start+'<td class="c">'+num(li.qty)+'</td><td class="c">'+num(li.deliveredQty)+'</td><td class="c">'+(lineLeft(li)||"—")+'</td></tr>';
    if(num(li.qty)===0) return '<tr class="opt">'+start+'<td class="c">optional</td><td class="c">'+docMoney(li.unitPrice)+'</td><td class="c">—</td></tr>';
    return '<tr>'+start+'<td class="c">'+num(li.qty)+(li.unit ? ' '+esc(li.unit) : '')+'</td>'+
      '<td class="c">'+docMoney(li.unitPrice)+'</td><td class="c">'+docMoney(num(li.qty)*num(li.unitPrice))+'</td></tr>';
  }).join("");

  var pays=normalizedPayments(t);
  var vat=num(t.vatPct)>0, disc=txDiscount(t)>0.004;
  var totRow=function(label, value, strong){ return '<tr'+(strong?' class="g"':'')+'><td>'+label+'</td><td class="c">'+value+'</td></tr>'; };
  var totals = showMoney ?
    '<table class="d-tot2"><tbody>'+
      totRow("Total Qtys", sum(lines.filter(function(li){ return li.kind!=="service"; }), function(li){ return li.qty; }))+
      /* Total Price is the lines as listed; a discount is shown under it with what is left to pay. */
      totRow("Total Price ("+esc(code)+") (Excl. VAT)", docMoney(txSubtotal(t)), !disc && !vat)+
      (disc ? totRow("Total price discount "+r2(num(t.discountPct)*100)+" %", docMoney(txNet(t)), !vat) : '')+
      (vat ? totRow("VAT "+num(t.vatPct)+"%", docMoney(txVat(t)))+
          totRow((kind==="Receipt"?"Invoice total":"Total Price")+" ("+esc(code)+") (Incl. VAT)", docMoney(txTotal(t)), true) : '')+
      (kind!=="Quotation" ? totRow("Paid to date", docMoney(txPaid(t)))+totRow("Balance due", docMoney(txBalance(t)), true) : '')+
    '</tbody></table>' : '';

  var sheet =
    '<div class="d-top">'+
      '<div class="d-mark">'+(s.logo ? '<img class="d-logo-big" src="'+esc(s.logo)+'" alt="'+esc(s.name||"")+'">' : '<b>'+esc(s.name||"nestify")+'</b>')+
        '<span>'+esc(s.tagline||"")+'</span></div>'+
      '<div class="d-kind"><div class="k">'+esc(updated ? "Updated quotation" : kind)+'</div><div class="r">'+esc(refMap[kind])+'</div>'+
        '<div class="dt">'+fmtDate(dateMap[kind]||todayISO())+'</div></div>'+
    '</div>'+
    '<div class="d-meta">'+
      '<div><div class="k">Prepared for</div><div class="v">'+esc(clientAddress(t))+(client.phone?'<br>'+esc(client.phone):"")+'</div></div>'+
      '<div><div class="k">'+(t.site ? "Site" : "Region")+'</div><div class="v">'+esc(t.site||t.region||"")+'</div></div>'+
      '<div><div class="k">Scope</div><div class="v">'+esc(t.serviceType==="With Programming"?"Supply and programming":"Supply only")+'</div></div>'+
      '<div><div class="k">'+(kind==="Quotation"?"Valid until":"Reference")+'</div><div class="v">'+
        (kind==="Quotation" ? fmtDate(addDays(txDocDate(t), num(s.validityDays))) : esc(t.refNo))+'</div></div>'+
    '</div>'+
    '<table class="d-items"><thead>'+title+head+'</thead><tbody>'+rows+'</tbody></table>'+
    (isNote ? deliveryLogHtml(t, true) : '')+
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
      '<div class="d-sign"><div>Client signature</div><div>For '+esc(s.name||"nestify")+'</div></div>' : '')+
    '<div class="d-foot"><span>'+[s.phone,s.email,s.website].filter(Boolean).map(esc).join("  ·  ")+'</span><span>'+esc(s.address||"")+'</span></div>';

  /* Full quotation: cover, opening page, the offer, back page. Every other document is one sheet. */
  var brand = docState.style==="brand" && kind==="Quotation";
  if(!brand){
    $("doc").innerHTML = docPage(sheet);
  } else {
    var bullets=curWording(t, String(s.offerNotes||"")).split("\n").map(function(x){ return x.trim(); }).filter(Boolean);
    var logoOrName = function(dark){ return s.logo ? '<img src="'+esc(dark ? s.logo : (whiteLogo.url||s.logo))+'" alt="'+esc(s.name||"")+'">'
      : '<div class="d-cover-word"'+(dark?' style="color:#161A16"':'')+'>'+esc(s.name||"nestify")+'</div>'; };
    /* A white cover: who it is for at the top, the logo in the middle, the welcome line at the foot. */
    var cover =
      '<div class="d-cover">'+
        '<div class="d-cover-top"><div><div>Subject: Price Offer</div><div>To: '+esc(clientAddress(t))+'</div>'+
          (t.site ? '<div>Project: '+esc(t.site)+'</div>' : '')+'<div>Date Issued: '+fmtDate(dateMap[kind]||todayISO())+'</div></div>'+
          '<div class="r">Offer No.: '+esc(refMap[kind])+'</div></div>'+
        '<div class="d-cover-mid">'+logoOrName(true)+'<div class="d-cover-tag">Price Offer</div></div>'+
        '<div class="d-cover-foot">'+esc(s.coverNote||"")+'</div>'+
      '</div>';
    var notes = docBrandBar(s)+'<div class="d-body d-opening">'+
        (s.introText ? '<p class="d-intro">'+esc(s.introText)+'</p>' : '')+
        (bullets.length ? '<ul class="d-bullets">'+bullets.map(function(b){ return '<li>'+esc(b)+'</li>'; }).join("")+'</ul>' : '')+
        /* The company's own picture, or the smart-home protocols picture that ships with the app. */
        '<div class="d-opening-pic"><img src="'+esc(s.hero || (BASE+"/assets/img/opening.png"))+'" alt=""></div>'+
      '</div>'+docFootBar(s, 2, 4);
    var back = '<div class="d-back">'+logoOrName(true)+'<div class="d-back-tag">'+esc(s.tagline||"")+'</div></div>';
    $("doc").innerHTML = docPage(cover, "d-page-full") + docPage(notes, "d-page-bar") +
      docPage(docBrandBar(s)+'<div class="d-body">'+sheet+'</div>'+docFootBar(s, 3, 4), "d-page-bar") + docPage(back, "d-page-full");
  }

  $("doc-title").textContent = (updated ? "Updated quotation" : kind) + " · " + refMap[kind];
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
/* The browser names a printed PDF after the page title, so the title takes the file name while printing. */
$("doc-print").addEventListener("click", function(){
  var keep=document.title; document.title=docBaseName();
  window.print();
  setTimeout(function(){ document.title=keep; }, 1000);
});

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
/* "Mr. Ahmad Luhaidi -NEST-2611WD04": how the client is addressed, then the document's number. */
function docBaseName(){
  var t=docState.t, kind=docState.kind;
  if(!t) return "Document";
  var ref={"Quotation":t.refNo, "Updated Quotation":t.refNo+"-R", "Agreement":agreementRef(t.refNo), "Invoice":invoiceRef(t.refNo),
           "Delivery Note":invoiceRef(t.refNo), "Receipt":invoiceRef(t.refNo)}[kind] || t.refNo;
  var name=clientAddress(t)+" -NEST-"+ref+(kind && kind!=="Quotation" && kind!=="Updated Quotation" ? " "+kind : "");
  /* Arabic names stay; only characters a file name cannot hold are dropped. */
  return name.replace(/[\\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "Document";
}
function docFileName(){ return docBaseName()+".pdf"; }
function clientAddress(t){
  var c=clientById(t.clientId)||{};
  return ((c.salutation ? c.salutation+" " : "")+(t.clientName||c.name||"")).trim();
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
function renderCoverTypes(){
  var all=state.coverTypes||[], rows=all.filter(function(ct){ return matchesQ(invF.ctypes.q,[ct.code,ct.name]); });
  filterCount("ctypes", rows.length, all.length);
  $("inv-ctypes").innerHTML = rows.length ? rows.map(function(ct){
    var n=state.covers.filter(function(c){ return c.line===ct.code; }).length;
    return '<tr class="'+(isManager()?"clickable":"")+'" data-ct="'+ct.id+'"><td class="mono strong">'+esc(ct.code)+'</td><td>'+esc(ct.name||"")+'</td>'+
      '<td class="num">+'+usd(ct.addOnEndUser)+'</td><td class="num">+'+usd(ct.addOnDealer)+'</td><td class="num">'+n+'</td></tr>';
  }).join("") : emptyRow(5, all.length ? "Nothing matches the search." : "No cover types yet — add Q, S… to offer a base by type.");
  if(isManager()) $("inv-ctypes").querySelectorAll("[data-ct]").forEach(function(r){
    r.addEventListener("click", function(){ editCoverType(byId(state.coverTypes, r.dataset.ct)); });
  });
}
function editCoverType(ct){
  var isNew=!ct, d=ct||{code:"", name:"", addOnEndUser:0, addOnDealer:0};
  openForm((isNew?"Add":"Edit")+" cover type", [
    {fields:[{id:"ct-code", label:"Type (as on the covers' line)", value:d.code, placeholder:"Q"},
             {id:"ct-name", label:"Name (for the team)", value:d.name, placeholder:"Curved tempered glass"}]},
    {fields:[{id:"ct-eu", label:"Added to the base for an end user ($)", type:"number", step:"0.01", min:0, value:num(d.addOnEndUser)},
             {id:"ct-dl", label:"Added to the base for a dealer ($)", type:"number", step:"0.01", min:0, value:num(d.addOnDealer)}]},
    {note:"Covers belong to a type through their Line (a cover on line Q is a Q cover). The client never sees the type: the offer shows the base's name and its price."}
  ], function(){
    var code=val("ct-code").toUpperCase();
    if(!code){ toast("Give the type a short code, like Q", true); return false; }
    save("cover_types", isNew?null:ct.id, {code:code, name:val("ct-name"), addOnEndUser:valNum("ct-eu"), addOnDealer:valNum("ct-dl")},
      function(){ toast("Cover type saved"); });
  }, isNew ? null : function(){ remove("cover_types", ct.id, ct.code); });
}
/* ---------- Search and filters on the stock tables ---------- */
var invF={products:{q:"",g:"",s:""}, bases:{q:"",g:"",s:""}, covers:{q:"",g:"",s:""}, ctypes:{q:"",g:"",s:""}};
function matchesQ(q, parts){
  q=String(q||"").trim().toLowerCase(); if(!q) return true;
  var hay=parts.filter(Boolean).join(" ").toLowerCase();
  return q.split(/\s+/).every(function(w){ return hay.indexOf(w)>=0; });
}
function stockMatch(s, kind, item){
  if(s==="low") return isLow(kind, item);
  if(s==="out") return availableOf(kind, item)<=0;
  return true;
}
/* Fills a group filter with the values in use, keeping the current choice. */
function fillGroup(key, allLabel, values){
  var sel=document.querySelector('select[data-ff="'+key+'"][data-k="g"]'); if(!sel) return;
  var vals=values.filter(function(v, i){ return v && values.indexOf(v)===i; }).sort();
  if(invF[key].g && vals.indexOf(invF[key].g)<0) vals.push(invF[key].g);
  sel.innerHTML='<option value="">'+esc(allLabel)+'</option>'+vals.map(function(v){ return '<option value="'+esc(v)+'">'+esc(v)+'</option>'; }).join("");
  sel.value=invF[key].g;
}
function filterCount(key, shown, total){
  var el=document.querySelector('[data-fcount="'+key+'"]');
  if(el) el.textContent = shown===total ? "" : shown+" of "+total;
}
document.querySelectorAll("[data-ff]").forEach(function(inp){
  inp.addEventListener("input", function(){ invF[inp.dataset.ff][inp.dataset.k]=inp.value; renderInventory(); });
});
function renderInventory(){
  renderCoverTypes();
  fillGroup("products", "All categories", state.products.map(function(p){ return p.category; }));
  fillGroup("bases", "All lines", state.bases.map(function(b){ return b.line; }));
  fillGroup("covers", "All types", state.covers.map(function(c){ return c.line; }));
  var fP=invF.products, fB=invF.bases, fC=invF.covers;
  var products=state.products.filter(function(p){ return matchesQ(fP.q,[p.name,p.category]) && (!fP.g || p.category===fP.g) && stockMatch(fP.s,"product",p); });
  var bases=state.bases.filter(function(b){ return matchesQ(fB.q,[b.name,b.line]) && (!fB.g || b.line===fB.g) && stockMatch(fB.s,"base",b); });
  var covers=state.covers.filter(function(c){ return matchesQ(fC.q,[c.name,c.line,c.color,c.finish]) && (!fC.g || c.line===fC.g) && stockMatch(fC.s,"cover",c); });
  filterCount("products", products.length, state.products.length);
  filterCount("bases", bases.length, state.bases.length);
  filterCount("covers", covers.length, state.covers.length);
  var units = sum(state.products,function(p){ return num(p.stockOnHand); })
            + sum(state.bases,function(b){ return num(b.stockOnHand); })
            + sum(state.covers,function(c){ return num(c.stockOnHand); });
  var lowCount = allStockRows().filter(function(r){ return isLow(r.kind,r.item); }).length;
  $("inv-figs").innerHTML =
    figure("Stock at cost", money0(stockValue())) +
    figure("Units on hand", String(units)) +
    figure("Below reorder point", String(lowCount));

  $("inv-products").innerHTML = products.length ? products.map(function(p){
    return '<tr class="clickable" data-edit="product:'+p.id+'">'+
      '<td class="strong">'+esc(p.name)+'</td><td class="tiny muted">'+esc(p.category||"")+'</td>'+
      '<td class="num c-cost">'+(itemCost(p)>0?money(itemCost(p)):'<span class="faint">—</span>')+'</td>'+
      '<td class="num">'+num(p.stockOnHand)+'</td><td class="num">'+reservedFor("product",p.id)+'</td>'+
      '<td class="num">'+(incomingFor("product",p.id)||'<span class="faint">—</span>')+'</td>'+
      '<td class="num strong">'+availCell("product",p)+'</td><td>'+stockPill("product",p)+'</td></tr>';
  }).join("") : emptyRow(8, state.products.length ? "Nothing matches the search." : "No products yet.");

  $("inv-bases").innerHTML = bases.length ? bases.map(function(b){
    return '<tr class="clickable" data-edit="base:'+b.id+'">'+
      '<td class="strong">'+esc(b.name)+'</td><td class="tiny muted">'+esc(b.line||"")+'</td>'+
      '<td class="num c-cost">'+(itemCost(b)>0?money(itemCost(b)):'<span class="faint">—</span>')+'</td>'+
      '<td class="num">'+num(b.stockOnHand)+'</td><td class="num">'+reservedFor("base",b.id)+'</td>'+
      '<td class="num">'+(incomingFor("base",b.id)||'<span class="faint">—</span>')+'</td>'+
      '<td class="num strong">'+availCell("base",b)+'</td><td>'+stockPill("base",b)+'</td></tr>';
  }).join("") : emptyRow(8, state.bases.length ? "Nothing matches the search." : "No bases yet.");

  $("inv-covers").innerHTML = covers.length ? covers.map(function(c){
    return '<tr class="clickable" data-edit="cover:'+c.id+'">'+
      '<td class="strong">'+esc(c.name)+'</td><td class="tiny muted">'+esc(c.line||"")+'</td>'+
      '<td class="tiny muted">'+esc(c.finish||"")+'</td>'+
      '<td class="num c-cost">'+(itemCost(c)>0?money(itemCost(c)):'<span class="faint">—</span>')+'</td>'+
      '<td class="num">'+num(c.stockOnHand)+'</td><td class="num">'+reservedFor("cover",c.id)+'</td>'+
      '<td class="num strong">'+availCell("cover",c)+'</td><td>'+stockPill("cover",c)+'</td></tr>';
  }).join("") : emptyRow(8, state.covers.length ? "Nothing matches the search." : "No covers yet.");

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
      if(k==="ctype") editCoverType(null);
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
    var back=d.type==="return";
    rows.push({date:d.date, what:(back ? "Returned by " : "Delivered to ")+(t.clientName||"—")+(d.note ? " — "+d.note : ""), ref:t.refNo||"",
      qty:back ? num(d.qty) : -num(d.qty), by:d.by, go:t.id ? function(){ openTx(t.id); } : null});
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
      /* The cover's type ties it to its price and to the colours offered for that type. */
      (state.coverTypes||[]).length
        ? {id:"f-line", label:"Cover type", type:"select", value:d.line || ((state.coverTypes||[])[0]||{}).code,
           options:(state.coverTypes||[]).map(function(ct){ return {value:ct.code, label:ct.code+(ct.name && ct.name!==ct.code ? " — "+ct.name : "")}; })
             .concat(d.line && !coverTypeByCode(d.line) ? [{value:d.line, label:d.line+" (not in the type list)"}] : [])}
        : {id:"f-line", label:"Cover type", value:d.line, placeholder:"Q"}]});
    groups.push({fields:[
      {id:"f-color", label:"Colour", value:d.color},
      {id:"f-finish", label:"Finish", type:"select", options:["Glossy","Matte"], value:d.finish}]});
    groups.push({note:"The price a cover adds comes from its type (Inventory → Cover types), taken when Q or S is chosen in the offer."});
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
  groups.push({heading:"Picture — printed in the Image column of offers"});
  groups.push({html:'<div class="brand-box" id="f-pic-box"></div><input type="file" id="f-pic-file" accept="image/png,image/jpeg,image/webp" hidden>'});
  var picture; /* undefined: keep what is stored; "": remove it; a data URL: the new one */
  function drawPicture(){
    var src = picture!==undefined ? picture : (d.image||"");
    $("f-pic-box").innerHTML = (src ? '<img src="'+esc(src)+'" alt="">' : '<span class="tiny faint">No picture</span>')+
      '<button class="btn sm" type="button" id="f-pic-pick">'+(src?"Change":"Choose a picture")+'</button>'+
      (src ? '<button class="btn quiet sm" type="button" id="f-pic-rm">Remove</button>' : '');
    $("f-pic-pick").addEventListener("click", function(){ $("f-pic-file").value=""; $("f-pic-file").click(); });
    if($("f-pic-rm")) $("f-pic-rm").addEventListener("click", function(){ picture=""; drawPicture(); });
  }

  /* A base keeps up to four pictures for each cover type; they print side by side in the offer. */
  var typePics=null;
  if(kind==="base" && (state.coverTypes||[]).length){
    typePics={};
    (state.coverTypes||[]).forEach(function(ct){ typePics[ct.code]=((d.typeImages||{})[ct.code]||[]).slice(); });
    groups.push({heading:"This base's pictures in the offer — one set for each cover type (up to 4 each)"});
    groups.push({html:'<div id="f-tpics"></div><input type="file" id="f-tpic-file" accept="image/png,image/jpeg,image/webp" multiple hidden>'});
  }
  var picsChanged=false, picFor=null;
  function drawTypePics(){
    if(!typePics) return;
    $("f-tpics").innerHTML=Object.keys(typePics).map(function(code){
      var list=typePics[code];
      return '<div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:8px"><span class="mono strong" style="width:34px">'+esc(code)+'</span>'+
        list.map(function(u, i){ return '<span class="brand-box" style="min-height:0"><img src="'+esc(u)+'" alt="" style="max-height:38px"><button class="btn quiet sm" type="button" data-tp-rm="'+esc(code)+'" data-i="'+i+'" aria-label="Remove">×</button></span>'; }).join("")+
        (list.length<4 ? '<button class="btn sm" type="button" data-tp-add="'+esc(code)+'">Add picture</button>' : '')+'</div>';
    }).join("");
    $("f-tpics").querySelectorAll("[data-tp-add]").forEach(function(b){
      b.addEventListener("click", function(){ picFor=b.dataset.tpAdd; $("f-tpic-file").value=""; $("f-tpic-file").click(); });
    });
    $("f-tpics").querySelectorAll("[data-tp-rm]").forEach(function(b){
      b.addEventListener("click", function(){ typePics[b.dataset.tpRm].splice(Number(b.dataset.i),1); picsChanged=true; drawTypePics(); });
    });
  }
  /* Pictures already saved are addresses; saving the list again needs the pictures themselves. */
  function picsAsData(){
    var jobs=[], out={};
    Object.keys(typePics).forEach(function(code){
      out[code]=[];
      typePics[code].forEach(function(u, i){
        if(String(u).indexOf("data:")===0){ out[code][i]=u; return; }
        jobs.push(fetch(u, {credentials:"same-origin"}).then(function(r){ return r.blob(); }).then(function(b){
          return new Promise(function(ok){ var fr=new FileReader(); fr.onload=function(){ out[code][i]=fr.result; ok(); }; fr.readAsDataURL(b); });
        }));
      });
    });
    return Promise.all(jobs).then(function(){ return out; });
  }

  openForm((isNew?"Add ":"Edit ")+titleMap[kind], groups, function(){
    if(!val("f-name")){ toast("Give it a name first", true); return false; }
    if(kind==="cover" && !val("f-line")){ toast("Choose the cover's type (Q, S…)", true); return false; }
    var data={
      name:val("f-name"),
      cost:costsVisible() ? valNum("f-cost") : undefined,
      stockOnHand:valNum("f-stock"), reorderThreshold:valNum("f-reorder")
    };
    if(kind==="cover"){
      data.line=val("f-line"); data.color=val("f-color"); data.finish=val("f-finish");
    } else {
      if(kind==="base") data.line=val("f-line"); else data.category=val("f-category");
      data.dealerPriceWB=valNum("f-dwb"); data.endUserPriceWB=valNum("f-ewb");
      data.dealerPrice48=valNum("f-d48"); data.endUserPrice48=valNum("f-e48");
      data.programmingFee=valNum("f-prog");
    }
    if(picture!==undefined) data.imageData = picture || null;
    var col = kind==="product" ? "products" : (kind==="base" ? "bases" : "covers");
    if(typePics && picsChanged){
      picsAsData().then(function(pics){ data.typeImages=pics; save(col, isNew?null:item.id, data, function(){ closeForm(); toast("Saved"); }); })
        .catch(function(){ toast("Could not read the pictures — try again", true); });
      return false;
    }
    save(col, isNew?null:item.id, data, function(){ toast("Saved"); });
  }, isNew ? null : function(){
    remove(kind==="product" ? "products" : (kind==="base" ? "bases" : "covers"), item.id, item.name);
  });
  drawPicture();
  if(typePics){
    drawTypePics();
    $("f-tpic-file").addEventListener("change", function(){
      var files=[].slice.call(this.files||[]), code=picFor; if(!files.length || !code) return;
      files=files.slice(0, 4-typePics[code].length);
      Promise.all(files.map(function(f){ return shrinkPicture(f, 400); })).then(function(urls){
        typePics[code]=typePics[code].concat(urls); picsChanged=true; drawTypePics();
      }).catch(function(){ toast("Could not read that picture", true); });
    });
  }
  $("f-pic-file").addEventListener("change", function(){
    var f=this.files && this.files[0]; if(!f) return;
    shrinkPicture(f, 400).then(function(url){ picture=url; drawPicture(); })
      .catch(function(){ toast("Could not read that picture", true); });
  });
}

/* Pictures are scaled down in the browser before they are saved, so offers stay light. */
function shrinkPicture(file, max){
  return new Promise(function(ok, fail){
    var r=new FileReader();
    r.onerror=fail;
    r.onload=function(){
      var img=new Image();
      img.onerror=fail;
      img.onload=function(){
        var k=Math.min(1, max/Math.max(img.width, img.height));
        var c=document.createElement("canvas");
        c.width=Math.max(1, Math.round(img.width*k)); c.height=Math.max(1, Math.round(img.height*k));
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        ok(c.toDataURL("image/png"));
      };
      img.src=r.result;
    };
    r.readAsDataURL(file);
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
    var plan=deliveryPlan(t);
    (t.lineItems||[]).forEach(function(li){
      var left=lineLeft(li); if(!left) return;
      var r=sum(plan.now.filter(function(x){ return x.li===li; }), function(x){ return x.qty; });
      rows.push({t:t, li:li, left:left, ready:r});
    });
  });
  return rows;
}
function renderToDeliver(){
  var rows=toDeliverRows();
  $("deliver-body").innerHTML = rows.length ? rows.map(function(r){
    var st = needsColour(r.li) ? '<span class="pill warn">Choose colours</span>' : r.ready>=r.left ? '<span class="pill good">Ready</span>'
      : (r.ready>0 ? '<span class="pill warn">'+r.ready+' ready</span>' : '<span class="pill bad">Waiting for stock</span>');
    return '<tr class="clickable" data-dt="'+r.t.id+'"><td class="mono">'+esc(r.t.refNo)+'<div class="tiny faint">'+fmtDate(r.t.invoiceDate)+'</div></td>'+
      '<td class="strong">'+esc(r.t.clientName||"")+'</td><td>'+esc(r.li.name)+(r.li.kind==="combo" ? '<div class="tiny faint">'+esc(comboDetail(r.li))+'</div>' : '')+'</td>'+
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
  }), baseOf(txTotal));
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
/* Search and filters on top of the Everyone / Dealers / … buttons. */
var contactF={q:"", region:"", tier:"", title:""};
function contactFilterOn(){ return Object.keys(contactF).some(function(k){ return !!contactF[k]; }); }
document.querySelectorAll("[data-cf]").forEach(function(inp){
  inp.addEventListener("input", function(){ contactF[inp.dataset.cf]=inp.value; renderContacts(); });
});
$("cf-clear").addEventListener("click", function(){
  Object.keys(contactF).forEach(function(k){ contactF[k]=""; });
  document.querySelectorAll("[data-cf]").forEach(function(inp){ inp.value=""; });
  renderContacts();
});
function renderContacts(){
  renderTiers();
  var tierSel=document.querySelector('[data-cf="tier"]');
  tierSel.innerHTML='<option value="">All price tiers</option><option value="none">No tier</option>'+(state.tiers||[]).map(function(t){
    return '<option value="'+t.id+'">'+esc(t.name)+'</option>'; }).join("");
  tierSel.value=contactF.tier;
  $("cf-clear").hidden=!contactFilterOn();
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
  var before=rows.length, cf=contactF;
  rows=rows.filter(function(c){
    if(cf.region && c.region!==cf.region) return false;
    if(cf.tier==="none" ? !!c.tierId : (cf.tier && c.tierId!==cf.tier)) return false;
    if(cf.title==="none" ? !!c.salutation : (cf.title && c.salutation!==cf.title)) return false;
    return matchesQ(cf.q, [c.name, c.salutation, c.phone, c.email, c.notes, c.region, c.type, tierLabel(c)]);
  });
  $("cf-count").textContent = contactFilterOn() ? rows.length+" of "+before : "";
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
  }).join("") : emptyRow(8, contactFilterOn() ? "Nobody matches the search." : "Nobody here yet.");
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
          '<td class="tiny muted">'+fmtDate(txRecognisedDate(t))+'</td><td class="num">'+inCur(t,txTotal(t))+'</td>'+
          '<td class="num">'+(txBalance(t)>0.004?inCur(t,txBalance(t)):'<span class="faint">—</span>')+'</td></tr>';
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
    $("of-client").value=c.id; if(c.region) $("of-region").value=c.region; applyClientDiscount(); renderComposer();
  });
}
function editClient(c){
  var isNew=!c; var d=c||{name:"", salutation:"", type:"End User", region:"West Bank", discountPct:0, phone:"", email:"", notes:"", tierId:""};
  var tiers=[{value:"",label:"None — priced by type"}].concat((state.tiers||[]).filter(function(t){ return t.active || t.id===d.tierId; })
    .map(function(t){ return {value:t.id, label:t.name+" · "+(t.basis==="Dealer"?"dealer":"end-user")+" prices"+(num(t.discountPct)>0?" − "+pct(t.discountPct,1):"")}; }));
  openForm((isNew?"Add":"Edit")+" contact", [
    {fields:[{id:"c-sal", label:"Title", type:"select", value:d.salutation||"",
              options:[{value:"",label:"— (a company)"},{value:"Mr.",label:"Mr."},{value:"Mrs.",label:"Mrs."},{value:"Ms.",label:"Ms."}]},
             {id:"c-name", label:"Name", value:d.name}]},
    {fields:[
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
    save("clients", isNew?null:c.id, {name:val("c-name"), salutation:val("c-sal")||null, type:val("c-type"), region:val("c-region"),
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
/* Search and filters on the Expenses and Cash ledger tabs. */
var moneyF={exp:{q:"",cat:"",method:"",month:""}, led:{q:"",kind:"",method:"",month:""}};
document.querySelectorAll("[data-mf]").forEach(function(inp){
  inp.addEventListener("input", function(){ moneyF[inp.dataset.mf][inp.dataset.k]=inp.value; renderMoney(); });
});
function fillMoneySelect(key, k, label, values, labeller){
  var el=document.querySelector('[data-mf="'+key+'"][data-k="'+k+'"]'); if(!el) return;
  var vals=values.filter(function(v, i){ return v && values.indexOf(v)===i; });
  el.innerHTML='<option value="">'+esc(label)+'</option>'+vals.map(function(v){ return '<option value="'+esc(v)+'">'+esc(labeller ? labeller(v) : v)+'</option>'; }).join("");
  el.value=moneyF[key][k];
}
function moneyCount(key, shown, total, extra){
  var on=Object.keys(moneyF[key]).some(function(k){ return !!moneyF[key][k]; });
  var el=document.querySelector('[data-mcount="'+key+'"]'); if(el) el.textContent = on ? shown+" of "+total+(extra?" · "+extra:"") : "";
}
function renderExpenses(){
  var f=moneyF.exp, all=state.expenses;
  fillMoneySelect("exp", "cat", "All categories", all.map(function(e){ return e.category; }).sort());
  fillMoneySelect("exp", "month", "Any month", all.map(function(e){ return monthKey(e.date); }).sort().reverse(), monthLabel);
  var rows=sortBy(all.filter(function(e){
    return (!f.cat || e.category===f.cat) && (!f.method || e.paymentMethod===f.method) && (!f.month || monthKey(e.date)===f.month) &&
      matchesQ(f.q, [e.description, e.vendor, e.notes, e.category, e.poRef]);
  }), function(e){ return e.date||""; }, true);
  moneyCount("exp", rows.length, all.length, money(sum(rows, function(e){ return e.amount; })));
  $("exp-body").innerHTML = rows.length ? rows.map(function(e){
    return '<tr class="clickable" data-e="'+e.id+'"><td>'+fmtDate(e.date)+'</td>'+
      '<td><span class="pill neutral">'+esc(e.category||"Other")+'</span></td>'+
      '<td>'+esc(e.description||"")+(e.poRef?'<div class="tiny faint mono">'+esc(e.poRef)+'</div>':'')+'</td>'+
      '<td>'+esc(e.vendor||"")+'</td><td class="tiny muted">'+esc(e.paymentMethod||"")+'</td>'+
      '<td class="num">'+money(e.amount)+'</td></tr>';
  }).join("") : emptyRow(6, all.length ? "Nothing matches the search." : "Nothing logged yet.");
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
  var mf=moneyF.led, every=ledgerRows();
  fillMoneySelect("led", "month", "Any month", every.map(function(r){ return monthKey(r.date); }), monthLabel);
  var picked=every.filter(function(r){
    return (f==="all" || r.dir===f) && (!mf.kind || r.kind===mf.kind) && (!mf.method || r.method===mf.method) &&
      (!mf.month || monthKey(r.date)===mf.month) && matchesQ(mf.q, [r.label, r.ref, r.method, r.kind, r.orig]);
  });
  var inSum=sum(picked.filter(function(r){ return r.dir==="in"; }), function(r){ return r.amount; });
  var outSum=sum(picked.filter(function(r){ return r.dir==="out"; }), function(r){ return r.amount; });
  moneyCount("led", picked.length, every.length, "in "+usd(inSum)+" · out "+usd(outSum));
  /* A search reaches the whole history; the plain list shows the latest movements. */
  var rows=Object.keys(mf).some(function(k){ return !!mf[k]; }) ? picked : picked.slice(0,180);
  $("ledger-body").innerHTML = rows.length ? rows.map(function(r){
    return '<tr><td>'+fmtDate(r.date)+'</td><td>'+esc(r.label)+(r.orig?' <span class="tiny faint">('+esc(r.orig)+')</span>':'')+'</td>'+
      '<td class="mono tiny">'+esc(r.ref||"")+'</td><td class="tiny muted">'+esc(r.method||"")+'</td>'+
      '<td class="num">'+(r.dir==="in"?money(r.amount):'')+'</td>'+
      '<td class="num">'+(r.dir==="out"?money(r.amount):'')+'</td></tr>';
  }).join("") : emptyRow(6, every.length ? "Nothing matches the search." : "No movements recorded yet.");
}

/* ============================================================
   22. TEAM
   ============================================================ */
/* Search and filters on the Team page. */
var teamF={emp:{q:"",role:"",status:""}, hist:{q:"",month:"",method:""}};
document.querySelectorAll("[data-tf]").forEach(function(inp){
  inp.addEventListener("input", function(){ teamF[inp.dataset.tf][inp.dataset.k]=inp.value; renderTeam(); });
});
function teamOn(key){ return Object.keys(teamF[key]).some(function(k){ return !!teamF[key][k]; }); }
function teamSelect(key, k, label, values, labeller){
  var el=document.querySelector('[data-tf="'+key+'"][data-k="'+k+'"]'); if(!el) return;
  var vals=values.filter(function(v, i){ return v && values.indexOf(v)===i; });
  el.innerHTML='<option value="">'+esc(label)+'</option>'+vals.map(function(v){ return '<option value="'+esc(v)+'">'+esc(labeller ? labeller(v) : v)+'</option>'; }).join("");
  el.value=teamF[key][k];
}
function renderTeam(){
  var mk=thisMonth().replace("-","").slice(2);
  var active=state.employees.filter(function(e){ return e.active!==false; });
  var paidThis=state.payroll.filter(function(p){ return p.month===mk; });
  $("payroll-title").textContent="Payroll · "+monthLabel(thisMonth());
  $("team-figs").innerHTML =
    figure("People on payroll", String(active.length)) +
    figure("Monthly cost", money0(sum(active,function(e){ return e.monthlySalary; }))) +
    figure("Paid this month", money0(sum(paidThis,function(p){ return p.amount; })));

  var ef=teamF.emp;
  teamSelect("emp", "role", "All roles", state.employees.map(function(e){ return e.role; }).sort());
  var people=state.employees.filter(function(e){
    var paid=paidThis.some(function(p){ return p.employeeId===e.id; }), inactive=e.active===false;
    if(ef.role && e.role!==ef.role) return false;
    if(ef.status==="due" && (paid || inactive)) return false;
    if(ef.status==="paid" && !paid) return false;
    if(ef.status==="inactive" && !inactive) return false;
    return matchesQ(ef.q, [e.name, e.role, e.notes]);
  });
  var tc=document.querySelector('[data-tcount="emp"]');
  if(tc) tc.textContent = teamOn("emp") ? people.length+" of "+state.employees.length+" · "+money(sum(people,function(e){ return e.monthlySalary; }))+" a month" : "";
  $("payroll-body").innerHTML = people.length ? people.map(function(e){
    var rec=paidThis.filter(function(p){ return p.employeeId===e.id; })[0];
    return '<tr><td class="strong">'+esc(e.name)+'</td><td class="tiny muted">'+esc(e.role||"")+'</td>'+
      '<td class="num">'+money(e.monthlySalary)+'</td>'+
      '<td>'+(rec?'<span class="pill good">Paid '+fmtDate(rec.paidDate)+'</span>':(e.active===false?'<span class="pill neutral">Inactive</span>':'<span class="pill warn">Due</span>'))+'</td>'+
      '<td style="text-align:right">'+
        (rec||e.active===false ? '<button class="btn quiet sm" data-emp="'+e.id+'">Edit</button>'
          : '<button class="btn sm primary" data-pay="'+e.id+'">Mark paid</button> <button class="btn quiet sm" data-emp="'+e.id+'">Edit</button>')+
      '</td></tr>';
  }).join("") : emptyRow(5, state.employees.length ? "Nobody matches the search." : "Nobody added yet. If you are staff rather than the owner, this page stays empty by design.");
  $("payroll-body").querySelectorAll("[data-pay]").forEach(function(b){
    b.addEventListener("click", function(){ payEmployee(b.dataset.pay); });
  });
  $("payroll-body").querySelectorAll("[data-emp]").forEach(function(b){
    b.addEventListener("click", function(){ editEmployee(byId(state.employees, b.dataset.emp)); });
  });

  var hf=teamF.hist;
  teamSelect("hist", "month", "Any month", sortBy(state.payroll, function(p){ return payrollMonthKey(p); }, true).map(payrollMonthKey), monthLabel);
  var matched=sortBy(state.payroll.filter(function(p){
    return (!hf.month || payrollMonthKey(p)===hf.month) && (!hf.method || p.method===hf.method) && matchesQ(hf.q, [p.employeeName]);
  }), function(p){ return p.paidDate||p.month||""; }, true);
  var hc=document.querySelector('[data-tcount="hist"]');
  if(hc) hc.textContent = teamOn("hist") ? matched.length+" payments · "+money(sum(matched,function(p){ return p.amount; })) : "";
  /* Unfiltered, the latest twelve; a search reaches the whole history. */
  var hist = teamOn("hist") ? matched : matched.slice(0,12);
  $("payhist-body").innerHTML = hist.length ? hist.map(function(p){
    return '<tr><td class="mono">'+esc(p.month||"")+'</td><td>'+esc(p.employeeName||"")+'</td>'+
      '<td class="tiny muted">'+fmtDate(p.paidDate)+'</td><td class="num">'+money(p.amount)+'</td></tr>';
  }).join("") : emptyRow(4, state.payroll.length ? "No payment matches the search." : "No salary payments recorded.");
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
  [["logo","s-logo-box","Logo"],["hero","s-hero-box","Picture"]].forEach(function(x){
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
function renderCurrencies(){
  var rows=state.currencies||[];
  $("cur-body").innerHTML = rows.length ? rows.map(function(c){
    var n=state.transactions.filter(function(t){ return txCur(t)===c.code; }).length;
    return '<tr class="clickable" data-cur="'+c.id+'"><td class="mono strong">'+esc(c.code)+(c.active?'':' <span class="pill neutral">hidden</span>')+'</td>'+
      '<td>'+esc(c.name)+'</td><td>'+esc(c.symbol||"—")+'</td><td class="num mono">'+num(c.rate)+'</td><td class="num">'+n+'</td></tr>';
  }).join("") : emptyRow(5,"Only US dollars so far.");
  $("cur-body").querySelectorAll("[data-cur]").forEach(function(r){
    r.addEventListener("click", function(){ editCurrency(byId(state.currencies, r.dataset.cur)); });
  });
}
function editCurrency(c){
  var isNew=!c; var d=c||{code:"", name:"", symbol:"", rate:1, active:true};
  openForm((isNew?"Add":"Edit")+" currency", [
    {fields:[{id:"cu-code", label:"Code", value:d.code, placeholder:"ILS"},
             {id:"cu-name", label:"Name", value:d.name, placeholder:"Israeli shekel"},
             {id:"cu-symbol", label:"Symbol", value:d.symbol, placeholder:"₪"}]},
    {fields:[{id:"cu-rate", label:"Units per $1 today", type:"number", step:"0.0001", min:0, value:num(d.rate)},
             {id:"cu-active", label:"Show on new offers", type:"select", options:[{value:"1",label:"Yes"},{value:"0",label:"No"}], value:d.active?"1":"0"}]},
    {note:"Changing the rate only affects offers written from now on. Each saved deal keeps the rate it was written at."}
  ], function(){
    var code=val("cu-code").toUpperCase();
    if(!/^[A-Z]{3}$/.test(code)){ toast("The code is three letters, like ILS or JOD", true); return false; }
    if(code==="USD"){ toast("US dollars are the base currency and are always there", true); return false; }
    if(!val("cu-name")){ toast("Name is required", true); return false; }
    if(valNum("cu-rate")<=0){ toast("The rate must be more than zero", true); return false; }
    save("currencies", isNew?null:c.id, {code:code, name:val("cu-name"), symbol:val("cu-symbol"), rate:valNum("cu-rate"), active:val("cu-active")==="1"},
      function(){ toast("Currency saved"); });
  }, isNew ? null : function(){ remove("currencies", c.id, c.code); });
}
$("cur-add").addEventListener("click", function(){ editCurrency(null); });
function renderSettings(){
  renderBrandImages();
  if(isManager()) renderCurrencies();
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
    name:val("s-name")||"nestify", tagline:val("s-tagline"), phone:val("s-phone"), email:val("s-email"),
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
var backupsLoaded=false;
function renderData(){
  $("data-section").hidden = $("trash-section").hidden = !isOwner();
  if(!isOwner()) return;
  if(!backupsLoaded){ backupsLoaded=true; loadBackups(); }
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
/* ---------- Backups ---------- */
function downloadBackupFile(name){
  var a=document.createElement("a"); a.href=BASE+"/api/backups/"+encodeURIComponent(name); a.download=name;
  document.body.appendChild(a); a.click(); a.remove();
}
$("data-backup").addEventListener("click", function(){
  var btn=this; btn.disabled=true;
  api("POST", "backups").then(function(res){ downloadBackupFile(res.name); toast("Backed up — the file is downloading"); loadBackups(); })
    .catch(function(e){ toast(e.message||"Could not make the backup", true); }).then(function(){ btn.disabled=false; });
});
function abKey(){ return "nestify.backup."+(state.user ? state.user.id : "anon"); }
function abDownloadOn(){ try{ return localStorage.getItem(abKey()+".auto")!=="0"; }catch(e){ return true; } }
function loadBackups(){
  if(!isOwner()) return;
  api("GET", "backups").then(function(r){
    $("ab-days").value=String(r.days);
    $("ab-download").checked=abDownloadOn(); $("ab-download").disabled=!r.days;
    var last=r.list.filter(function(b){ return b.kind==="auto"; })[0];
    $("ab-status").textContent = !r.days ? "Automatic backups are off." :
      (last ? "Last automatic backup: "+fmtDate(last.createdAt.slice(0,10))+". Next one when the system is opened on or after "+fmtDate(r.nextDue)+"." :
              "The first automatic backup is made the next time the system is opened.");
    var kindName={auto:"Automatic", manual:"Back up now", "before-restore":"Before a restore"};
    $("ab-list").innerHTML = r.list.length ? r.list.slice(0,15).map(function(b){
      return '<tr><td>'+esc(kindName[b.kind]||b.kind)+'<div class="tiny faint mono">'+esc(b.name)+'</div></td><td class="tiny muted">'+fmtDate(b.createdAt.slice(0,10))+' '+esc(b.createdAt.slice(11,16))+'</td>'+
        '<td class="num tiny">'+(b.size>1048576 ? (b.size/1048576).toFixed(1)+" MB" : Math.max(1,Math.round(b.size/1024))+" KB")+'</td>'+
        '<td style="text-align:right"><button class="btn sm" type="button" data-bk="'+esc(b.name)+'">Download</button></td></tr>';
    }).join("") : emptyRow(4,"No copies on the server yet.");
    $("ab-list").querySelectorAll("[data-bk]").forEach(function(b){ b.addEventListener("click", function(){ downloadBackupFile(b.dataset.bk); }); });
  }).catch(function(){});
}
$("ab-days").addEventListener("change", function(){
  api("PUT", "backups/settings", {days:Number($("ab-days").value)}).then(function(){
    toast(Number($("ab-days").value) ? "Automatic backup saved" : "Automatic backups are off"); loadBackups();
  }).catch(function(e){ toast(e.message||"Could not save", true); });
});
$("ab-download").addEventListener("change", function(){
  try{ localStorage.setItem(abKey()+".auto", $("ab-download").checked ? "1" : "0"); }catch(e){}
  toast($("ab-download").checked ? "New automatic backups will download to this computer" : "Automatic backups stay on the server only");
});
/* A new automatic copy downloads by itself, once, on each computer that wants it. */
function autoDownloadBackup(info){
  if(!isOwner() || !info || !info.name || !abDownloadOn()) return;
  var seen=null; try{ seen=localStorage.getItem(abKey()+".last"); }catch(e){}
  if(seen===info.name) return;
  try{ localStorage.setItem(abKey()+".last", info.name); }catch(e){}
  downloadBackupFile(info.name);
  toast("Automatic backup downloaded — "+info.name);
}
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

/* ============================================================
   NOTIFICATIONS: stock that ran low or out, payments that fell due
   ============================================================ */
function alertsNow(){
  var out=[], today=todayISO();
  allStockRows().forEach(function(r){
    if(!isLow(r.kind, r.item)) return;
    var a=availableOf(r.kind, r.item), gone=a<=0;
    out.push({key:"stock:"+r.kind+":"+r.item.id+":"+(gone?"out":"low"), sev:gone?"bad":"warn",
      title: gone ? r.label+" has run out" : r.label+" is down to "+a,
      detail: (gone && a<0 ? (-a)+" more promised than in stock · " : "")+"Reorder point is "+num(r.item.reorderThreshold)+
        (incomingFor(r.kind, r.item.id)>0 ? " · "+incomingFor(r.kind, r.item.id)+" on the way" : ""),
      go:function(){ setView("inventory"); openStockItem(r.kind, r.item); }});
  });
  /* Money is for the owner and admins. */
  if(isManager()) state.transactions.forEach(function(t){
    if(!isLive(t) || t.status==="Quotation" || isSuperseded(t)) return;
    var ms=t.milestones||[];
    var push=function(key, due, label, amount){
      var late=daysSince(due);
      out.push({key:key, sev: late>0 ? "bad" : "warn",
        title:(late>0 ? "Payment overdue: " : "Payment due today: ")+(t.clientName||"")+" — "+label,
        detail:t.refNo+" · "+inCur(t, amount)+(late>0 ? " · "+late+" day"+(late>1?"s":"")+" late" : " · due "+fmtDate(due)),
        go:function(){ setView("sales"); openTx(t.id); }});
    };
    ms.forEach(function(m){ if(!m.paid && m.dueDate && m.dueDate<=today) push("pay:"+t.id+":"+m.id, m.dueDate, m.label||"payment stage", m.amount); });
    if(!ms.length && t.dueDate && t.dueDate<=today && txBalance(t)>0.004) push("due:"+t.id+":"+t.dueDate, t.dueDate, "balance", txBalance(t));
  });
  return sortBy(out, function(a){ return (a.sev==="bad"?"0":"1")+a.title; });
}
function renderBell(){
  if(!state.ready) return;
  var list=alertsNow();
  $("bell-count").hidden=!list.length; $("bell-count").textContent=list.length>99 ? "99+" : String(list.length);
  desktopAlerts(list);
}
function desktopKey(){ return "nestify.alerts."+(state.user ? state.user.id : "anon"); }
function desktopOn(){ try{ return window.Notification && Notification.permission==="granted" && localStorage.getItem(desktopKey()+".on")==="1"; }catch(e){ return false; } }
/* Each alert pops up on the desktop once. One that clears and comes back later pops up again. */
function desktopAlerts(list){
  if(!desktopOn()) return;
  var seen=null; try{ seen=JSON.parse(localStorage.getItem(desktopKey())||"null"); }catch(e){}
  var now={}; list.forEach(function(a){ now[a.key]=1; });
  var fresh=seen ? list.filter(function(a){ return !seen[a.key]; }) : [];
  if(!seen && list.length) show("nestify — "+list.length+" thing"+(list.length>1?"s":"")+" need your attention", list.slice(0,3).map(function(a){ return a.title; }).join("\n"), null);
  fresh.slice(0,5).forEach(function(a){ show(a.title, a.detail, a.go, a.key); });
  if(fresh.length>5) show("nestify — "+(fresh.length-5)+" more alerts", "Open the bell to see them all", null);
  try{ localStorage.setItem(desktopKey(), JSON.stringify(now)); }catch(e){}
  function show(title, body, go, tag){
    try{
      var n=new Notification(title, {body:body, tag:tag||undefined, icon:(state.settings && state.settings.logo) || undefined});
      n.onclick=function(){ window.focus(); if(go) go(); else openAlerts(); n.close(); };
    }catch(e){}
  }
}
function openAlerts(){
  var list=alertsNow();
  var supported=!!window.Notification, on=desktopOn(), blocked=supported && Notification.permission==="denied";
  var html=
    '<div class="panel" style="padding:12px 14px; display:flex; gap:12px; align-items:center; justify-content:space-between">'+
      '<div class="tiny">'+(!supported ? "This browser cannot show desktop notifications." :
        (blocked ? "Desktop notifications are blocked for this site. Allow them from the lock icon next to the address, then come back here." :
        (on ? "Desktop notifications are on: each new alert pops up on this computer while the system is open in a tab." :
              "Turn on desktop notifications to get a pop-up for each new alert while the system is open in a tab.")))+'</div>'+
      (supported && !blocked ? '<button class="btn sm'+(on?"":" primary")+'" type="button" id="al-toggle" style="white-space:nowrap">'+(on?"Turn off":"Turn on")+'</button>' : '')+
    '</div>'+
    '<div class="panel"><div class="table-wrap"><table><tbody>'+
      (list.length ? list.map(function(a, i){
        return '<tr class="clickable" data-al="'+i+'"><td style="width:1%"><span class="pill '+a.sev+'">'+(a.key.indexOf("stock")===0?"Stock":"Payment")+'</span></td>'+
          '<td><div class="strong">'+esc(a.title)+'</div><div class="tiny muted">'+esc(a.detail)+'</div></td></tr>';
      }).join("") : emptyRow(2, "All clear — nothing needs you right now."))+
    '</tbody></table></div></div>';
  openDrawer("Notifications"+(list.length ? " · "+list.length : ""), html);
  $("drawer-body").querySelectorAll("[data-al]").forEach(function(r){
    r.addEventListener("click", function(){ closeDrawer(); list[Number(r.dataset.al)].go(); });
  });
  if($("al-toggle")) $("al-toggle").addEventListener("click", function(){
    if(on){ try{ localStorage.setItem(desktopKey()+".on","0"); }catch(e){} openAlerts(); return; }
    Notification.requestPermission().then(function(p){
      if(p==="granted"){
        try{ localStorage.setItem(desktopKey()+".on","1"); localStorage.removeItem(desktopKey()); }catch(e){}
        toast("Desktop notifications are on"); renderBell();
      } else toast("The browser did not allow notifications", true);
      openAlerts();
    });
  });
}
$("bell").addEventListener("click", openAlerts);

/* ============================================================
   MONTHLY REPORT
   ============================================================ */
state.repMonth = thisMonth();
/* Everything for one month, in US dollars: cash in and out, approved offers, what is owed, stock moves. */
function monthReport(mk){
  var inRows=[], outRows=[];
  state.transactions.forEach(function(t){
    normalizedPayments(t).forEach(function(p){
      if(monthKey(p.date)!==mk) return;
      var a=toBase(t, p.amount);
      if(a>=0) inRows.push({date:p.date, who:t.clientName||"", clientId:t.clientId, ref:t.refNo, how:p.method||"", amount:a, orig:txCur(t)!=="USD" ? inCur(t,p.amount) : ""});
      else outRows.push({date:p.date, what:"Refund — "+(t.clientName||""), clientId:t.clientId, ref:t.refNo, kind:"Refund", amount:-a});
    });
  });
  state.expenses.forEach(function(e){
    if(monthKey(e.date)===mk) outRows.push({date:e.date, what:(e.description||e.category||"Expense")+(e.vendor?" — "+e.vendor:""), kind:e.category||"Expense", amount:num(e.amount)});
  });
  state.payroll.forEach(function(p){
    var d=p.paidDate || (payrollMonthKey(p)+"-01");
    if(monthKey(d)===mk) outRows.push({date:d, what:"Salary — "+(p.employeeName||""), kind:"Salary", amount:num(p.amount)});
  });
  var approved=state.transactions.filter(function(t){ return t.status!=="Cancelled" && monthKey(t.agreementDate)===mk; });
  /* What falls due in the month: each payment stage with its date, or the balance of a deal without stages. */
  var due=[], today=todayISO();
  state.transactions.forEach(function(t){
    if(!isLive(t) || t.status==="Quotation" || isSuperseded(t)) return;
    var ms=t.milestones||[];
    ms.forEach(function(m){
      if(monthKey(m.dueDate)!==mk) return;
      due.push({date:m.dueDate, t:t, what:m.label||"Payment stage", amount:toBase(t,m.amount), orig:inCur(t,m.amount),
        status: m.paid ? "Received" : (m.dueDate<today ? "Overdue" : "Due")});
    });
    if(!ms.length && monthKey(t.dueDate)===mk){
      var bal=txBalance(t);
      due.push({date:t.dueDate, t:t, what:"Balance of the deal", amount:toBase(t,Math.max(0,bal)), orig:inCur(t,Math.max(0,bal)),
        status: bal<=0.004 ? "Received" : (t.dueDate<today ? "Overdue" : "Due")});
    }
  });
  due=sortBy(due, function(d){ return d.date; });
  var owed=state.transactions.filter(function(t){ return isLive(t) && txBalance(t)>0.004 && t.status!=="Quotation"; });

  var stock=[];
  allStockRows().forEach(function(r){
    var it=r.item, rec=0, back=0, out=0;
    state.deliveries.forEach(function(d){
      if(monthKey(d.date)!==mk || !lineUses(d, r.kind, it.id)) return;
      if(d.type==="return") back+=num(d.qty); else out+=num(d.qty);
    });
    state.orders.forEach(function(o){
      if(o.status!=="Received" || monthKey(o.receivedDate)!==mk) return;
      (o.lines||[]).forEach(function(l){ if(l.kind===r.kind && l.itemId===it.id) rec+=num(l.qty); });
    });
    if(r.kind==="product") state.expenses.forEach(function(e){
      if(e.linkedProductId===it.id && monthKey(e.date)===mk) rec+=num(e.qtyPurchased);
    });
    stock.push({kind:r.kind, name:it.name, received:rec, returned:back, delivered:out, net:rec+back-out, onHand:num(it.stockOnHand)});
  });
  stock=sortBy(stock, function(s){ return (s.received+s.returned+s.delivered ? "0" : "1")+s.name.toLowerCase(); });

  var cashIn=sum(inRows, function(r){ return r.amount; }), cashOut=sum(outRows, function(r){ return r.amount; });
  return {
    inRows:sortBy(inRows, function(r){ return r.date; }), outRows:sortBy(outRows, function(r){ return r.date; }),
    cashIn:cashIn, cashOut:cashOut, net:cashIn-cashOut,
    approved:sortBy(approved, function(t){ return t.agreementDate; }), approvedTotal:sum(approved, baseOf(txTotal)),
    owed:sortBy(owed, function(t){ return -toBase(t, txBalance(t)); }), owedTotal:sum(owed, function(t){ return toBase(t, txBalance(t)); }),
    stock:stock, pl:plForMonth(mk),
    due:due, dueOpen:sum(due.filter(function(d){ return d.status!=="Received"; }), function(d){ return d.amount; }),
    dueAll:sum(due, function(d){ return d.amount; })
  };
}
/* Search and filters on the report: every table follows them, and so do the figures. */
var repF={q:"", client:"", kind:"", moved:""};
document.querySelectorAll("[data-rf]").forEach(function(inp){
  inp.addEventListener("input", function(){ repF[inp.dataset.rf]=inp.value; renderReports(); });
});
$("rf-clear").addEventListener("click", function(){
  Object.keys(repF).forEach(function(k){ repF[k]=""; });
  document.querySelectorAll("[data-rf]").forEach(function(inp){ inp.value=""; });
  renderReports();
});
function repFilterOn(){ return Object.keys(repF).some(function(k){ return !!repF[k]; }); }
function filteredReport(R){
  var f=repF, byClient=function(id){ return !f.client || id===f.client; };
  var dealQ=function(t, extra){ return matchesQ(f.q, [t.refNo, t.clientName, t.site, t.soldBy].concat(extra||[]).concat((t.lineItems||[]).map(function(li){ return li.name; }))); };
  var out=Object.assign({}, R);
  out.inRows=R.inRows.filter(function(r){ return byClient(r.clientId) && matchesQ(f.q, [r.who, r.ref, r.how]); });
  /* Expenses and salaries belong to no client: a client filter keeps only that client's refunds. */
  out.outRows=R.outRows.filter(function(r){ return (!f.client || r.clientId===f.client) && matchesQ(f.q, [r.what, r.kind, r.ref]); });
  out.approved=R.approved.filter(function(t){ return byClient(t.clientId) && dealQ(t); });
  out.owed=R.owed.filter(function(t){ return byClient(t.clientId) && dealQ(t); });
  out.due=R.due.filter(function(d){ return byClient(d.t.clientId) && dealQ(d.t, [d.what, d.status]); });
  out.stock=R.stock.filter(function(s){
    return (!f.kind || s.kind===f.kind) && (!f.moved || s.received+s.returned+s.delivered>0) && matchesQ(f.q, [s.name, s.kind]);
  });
  out.cashIn=sum(out.inRows, function(r){ return r.amount; }); out.cashOut=sum(out.outRows, function(r){ return r.amount; });
  out.net=out.cashIn-out.cashOut;
  out.approvedTotal=sum(out.approved, baseOf(txTotal));
  out.owedTotal=sum(out.owed, function(t){ return toBase(t, txBalance(t)); });
  out.dueOpen=sum(out.due.filter(function(d){ return d.status!=="Received"; }), function(d){ return d.amount; });
  return out;
}
function renderReports(){
  var cs=document.querySelector('[data-rf="client"]'), clients={};
  state.transactions.forEach(function(t){ if(t.clientId) clients[t.clientId]=t.clientName||"—"; });
  cs.innerHTML='<option value="">All clients</option>'+sortBy(Object.keys(clients), function(id){ return clients[id].toLowerCase(); })
    .map(function(id){ return '<option value="'+id+'">'+esc(clients[id])+'</option>'; }).join("");
  cs.value=repF.client;
  $("rf-clear").hidden=!repFilterOn();
  $("rf-note").textContent = repF.client||repF.q ? "The figures and every table below follow the filters." : "";
  var sel=$("rep-month");
  /* The coming year is there too, to see what falls due ahead. */
  var months=[]; for(var i=12;i>=-23;i--) months.push(addMonths(thisMonth(), i));
  sel.innerHTML=months.map(function(k){ return '<option value="'+k+'"'+(k===state.repMonth?" selected":"")+'>'+esc(monthLabel(k))+'</option>'; }).join("");
  var R=filteredReport(monthReport(state.repMonth));
  $("rep-figs").innerHTML =
    figure("Received", usd(R.cashIn,0)) +
    figure("Paid out", usd(R.cashOut,0)) +
    figure("Net cash (in − out)", usd(R.net,0)) +
    figure("Approved offers · "+R.approved.length, usd(R.approvedTotal,0)) +
    figure("Still to collect", usd(R.owedTotal,0));
  $("rep-in-sum").textContent=R.inRows.length+" payments · "+usd(R.cashIn);
  $("rep-out-sum").textContent=R.outRows.length+" payments · "+usd(R.cashOut);
  $("rep-in").innerHTML = R.inRows.length ? R.inRows.map(function(r){
    return '<tr><td>'+fmtDate(r.date)+'</td><td>'+esc(r.who)+'<div class="tiny faint">'+esc(r.how)+(r.orig?' · '+esc(r.orig):'')+'</div></td><td class="mono tiny">'+esc(r.ref)+'</td><td class="num">'+usd(r.amount)+'</td></tr>';
  }).join("") : emptyRow(4,repFilterOn() ? "Nothing matches the filters." : "Nothing received this month.");
  $("rep-out").innerHTML = R.outRows.length ? R.outRows.map(function(r){
    return '<tr><td>'+fmtDate(r.date)+'</td><td>'+esc(r.what)+'</td><td class="tiny muted">'+esc(r.kind)+'</td><td class="num">'+usd(r.amount)+'</td></tr>';
  }).join("") : emptyRow(4,repFilterOn() ? "Nothing matches the filters." : "Nothing paid out this month.");
  var open=R.due.filter(function(d){ return d.status!=="Received"; }).length;
  $("rep-due-sum").textContent=R.due.length+" due · "+open+" not paid yet · "+usd(R.dueOpen)+" to collect";
  $("rep-due").innerHTML = R.due.length ? R.due.map(function(d){
    var pill={Received:"good", Due:"info", Overdue:"bad"}[d.status];
    return '<tr class="clickable" data-t="'+d.t.id+'"><td>'+fmtDate(d.date)+'</td><td>'+esc(d.t.clientName||"")+'</td><td class="mono tiny">'+esc(d.t.refNo)+'</td>'+
      '<td>'+esc(d.what)+'</td><td><span class="pill '+pill+'">'+d.status+'</span></td>'+
      '<td class="num'+(d.status==="Received"?" faint":" strong")+'">'+d.orig+(txCur(d.t)!=="USD" ? '<div class="tiny faint">'+usd(d.amount)+'</div>' : '')+'</td></tr>';
  }).join("") : emptyRow(6,repFilterOn() ? "Nothing matches the filters." : "Nothing falls due this month.");
  $("rep-approved-sum").textContent=R.approved.length+" offers · "+usd(R.approvedTotal);
  $("rep-approved").innerHTML = R.approved.length ? R.approved.map(function(t){
    return '<tr class="clickable" data-t="'+t.id+'"><td class="mono">'+esc(t.refNo)+'</td><td>'+esc(t.clientName||"")+'</td><td>'+fmtDate(t.agreementDate)+'</td><td>'+dealStage(t)+'</td>'+
      '<td class="num">'+inCur(t,txTotal(t))+'</td><td class="num">'+(txBalance(t)>0.004?inCur(t,txBalance(t)):'<span class="faint">—</span>')+'</td></tr>';
  }).join("") : emptyRow(6,repFilterOn() ? "Nothing matches the filters." : "No offer was approved this month.");
  $("rep-owed-sum").textContent=R.owed.length+" deals · "+usd(R.owedTotal);
  $("rep-owed").innerHTML = R.owed.length ? R.owed.map(function(t){
    return '<tr class="clickable" data-t="'+t.id+'"><td class="mono">'+esc(t.refNo)+'</td><td>'+esc(t.clientName||"")+'</td><td>'+dealStage(t)+'</td>'+
      '<td class="num">'+inCur(t,txTotal(t))+'</td><td class="num">'+inCur(t,txPaid(t))+'</td><td class="num strong">'+inCur(t,txBalance(t))+'</td></tr>';
  }).join("") : emptyRow(6,repFilterOn() ? "Nothing matches the filters." : "Nobody owes anything.");
  $("rep-stock").innerHTML = R.stock.length ? R.stock.map(function(s){
    var z=function(v){ return v ? String(v) : '<span class="faint">—</span>'; };
    return '<tr><td class="strong">'+esc(s.name)+'</td><td class="tiny muted">'+esc(s.kind)+'</td><td class="num">'+z(s.received)+'</td><td class="num">'+z(s.returned)+'</td>'+
      '<td class="num">'+z(s.delivered)+'</td><td class="num">'+(s.net ? (s.net>0?"+":"−")+Math.abs(s.net) : '<span class="faint">—</span>')+'</td><td class="num strong">'+s.onHand+'</td></tr>';
  }).join("") : emptyRow(7,repFilterOn() ? "Nothing matches the filters." : "No stock items yet.");
  $("view-reports").querySelectorAll("[data-t]").forEach(function(r){
    r.addEventListener("click", function(){ setView("sales"); openTx(r.dataset.t); });
  });
}
$("rep-month").addEventListener("change", function(){ state.repMonth=$("rep-month").value; renderReports(); });
$("rep-xlsx").addEventListener("click", function(){
  var btn=this, mk=state.repMonth, R=filteredReport(monthReport(mk)); btn.disabled=true;
  loadSheetLib().then(function(X){
    var wb=X.utils.book_new();
    var sheets=[
      ["Summary", [
        {"Line":"Received from clients ($)", "Value":r2(R.cashIn)},
        {"Line":"Paid out ($)", "Value":r2(R.cashOut)},
        {"Line":"Net cash, in − out ($)", "Value":r2(R.net)},
        {"Line":"Due this month, not paid yet ($)", "Value":r2(R.dueOpen)},
        {"Line":"Approved offers (count)", "Value":R.approved.length},
        {"Line":"Approved offers ($)", "Value":r2(R.approvedTotal)},
        {"Line":"Still to collect today ($)", "Value":r2(R.owedTotal)},
        {"Line":"Sales invoiced ($)", "Value":r2(R.pl.sales)},
        {"Line":"Profit after costs, expenses and salaries ($)", "Value":r2(R.pl.net)}]],
      ["Received", R.inRows.map(function(r){ return {"Date":r.date, "From":r.who, "Reference":r.ref, "Method":r.how, "Amount ($)":r2(r.amount), "Original":r.orig}; })],
      ["Paid out", R.outRows.map(function(r){ return {"Date":r.date, "What":r.what, "Kind":r.kind, "Amount ($)":r2(r.amount)}; })],
      ["Due this month", R.due.map(function(d){ return {"Due on":d.date, "Client":d.t.clientName, "Reference":d.t.refNo, "For":d.what,
        "Status":d.status, "Currency":txCur(d.t), "Amount":r2(d.amount*txRate(d.t)), "Amount ($)":r2(d.amount)}; })],
      ["Approved offers", R.approved.map(function(t){ return {"Reference":t.refNo, "Client":t.clientName, "Approved on":t.agreementDate, "Stage":t.status,
        "Currency":txCur(t), "Total":r2(txTotal(t)), "Total ($)":r2(toBase(t,txTotal(t))), "Still owed":r2(Math.max(0,txBalance(t)))}; })],
      ["Still to collect", R.owed.map(function(t){ return {"Reference":t.refNo, "Client":t.clientName, "Stage":t.status, "Currency":txCur(t),
        "Total":r2(txTotal(t)), "Paid":r2(txPaid(t)), "Owed":r2(txBalance(t)), "Owed ($)":r2(toBase(t,txBalance(t)))}; })],
      ["Stock", R.stock.map(function(s){ return {"Item":s.name, "Kind":s.kind, "Received":s.received, "Returned":s.returned, "Delivered":s.delivered, "Net change":s.net, "On hand now":s.onHand}; })]
    ];
    sheets.forEach(function(sh){
      X.utils.book_append_sheet(wb, sh[1].length ? X.utils.json_to_sheet(sh[1]) : X.utils.aoa_to_sheet([["Nothing this month"]]), sh[0]);
    });
    X.writeFile(wb, "nestify-report-"+mk+".xlsx");
  }).catch(function(e){ toast(e.message, true); }).then(function(){ btn.disabled=false; });
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
      "Region":t.region, "Site":t.site||"", "Sold by":t.soldBy||"", "Stage":t.status, "Currency":txCur(t), "Rate per $1":txRate(t), "Subtotal":r2(txSubtotal(t)), "Discount %":r2(num(t.discountPct)*100), "Discount":r2(txDiscount(t)), "VAT":r2(txVat(t)), "Total":r2(txTotal(t)),
      "Paid":r2(txPaid(t)), "Balance":r2(txBalance(t)), "Total ($)":r2(toBase(t,txTotal(t))), "Cost of goods ($)":r2(txCOGS(t)), "Margin ($)":r2(txMargin(t)), "Invoiced on":t.invoiceDate||"", "Delivered on":t.deliveredDate||""}; })],
    ["Deal lines", [].concat.apply([], state.transactions.map(function(t){ return (t.lineItems||[]).map(function(li){
      return {"Reference":t.refNo, "Client":t.clientName, "Stage":t.status, "Item":li.name, "Qty":num(li.qty), "Delivered":num(li.deliveredQty),
        "Unit price":r2(li.unitPrice), "Line total":r2(num(li.qty)*num(li.unitPrice)), "Unit cost":r2(li.costSnapshot)}; }); }))],
    ["Payments", [].concat.apply([], state.transactions.map(function(t){ return normalizedPayments(t).map(function(p){
      return {"Date":p.date, "Reference":t.refNo, "Client":t.clientName, "Type":p.type, "Method":p.method, "Currency":txCur(t), "Amount":r2(p.amount), "Amount ($)":r2(toBase(t,p.amount))}; }); }))],
    ["Payment schedule", [].concat.apply([], state.transactions.map(function(t){ return (t.milestones||[]).map(function(m){
      return {"Reference":t.refNo, "Client":t.clientName, "Stage":m.label, "Due":m.dueDate||"", "Amount":r2(m.amount), "Paid":m.paid ? (m.paidDate||"yes") : ""}; }); }))],
    ["Contacts", state.clients.map(function(c){ var st=clientStats(c);
      return {"Name":c.name, "Type":c.type, "Region":c.region, "Tier":tierLabel(c), "Extra discount %":r2(num(c.discountPct)*100), "Phone":c.phone, "Email":c.email,
        "Deals":st.deals, "Billed":r2(st.billed), "Paid":r2(st.paid), "Outstanding":r2(st.outstanding)}; })],
    ["Stock", stockRows],
    ["Deliveries", state.deliveries.map(function(d){ var t=byId(state.transactions,d.transactionId)||{};
      return {"Date":d.date, "Reference":t.refNo||"", "Client":t.clientName||"", "Movement":d.type==="return" ? "Returned" : "Delivered",
        "Item":d.name, "Qty":num(d.qty), "Note":d.note||"", "By":d.by||""}; })],
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
