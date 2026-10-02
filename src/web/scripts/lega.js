// FantaOracle — Lega personalizzata e aggiornamento generale.
"use strict";

// --- lega personalizzata ----------------------------------------------------------------------
// Valore e prezzo atteso dipendono dalla lega (quante squadre, quanti crediti), quindi si ricalcolano
// qui con lo stesso metodo di fantaoracle/model/valuation.py. Le proiezioni in punti no: non cambiano.
// Con la lega dei dati (LEGA0) si usano direttamente i numeri esportati dalla pipeline.
let LEGA0 = { n: 8, cr: 500 };
const LEGA_LIM = { n: [4, 16], cr: [100, 2000] };
const TIT_RUOLO = { P: 1, D: 4, C: 3.5, A: 2.5 };       // titolari tipici per squadra
const PESO_ROTAZIONE = 0.25, PREZZO_MIN = 1;
const nSlot = () => RUOLI.reduce((a, r) => a + META.slot[r], 0);
const legaCambiata = () => META.n_squadre !== LEGA0.n || META.crediti !== LEGA0.cr;
const arrotonda = (x) => { const f = Math.floor(x), d = x - f; return d > 0.5 ? f + 1 : d < 0.5 ? f : (f % 2 ? f + 1 : f); };  // meta' al pari, come numpy/python

function valutaLega(n, cred) {
  const out = new Map();
  const quote = Object.fromEntries(RUOLI.map((r) => [r, n * META.slot[r]]));
  const discrezionali = n * cred - RUOLI.reduce((a, r) => a + quote[r], 0) * PREZZO_MIN;
  // valore: VORP a due livelli (pieno sopra i titolari, ridotto fino all'ultimo comprato)
  let somma = 0; const vorp = new Map();
  for (const r of RUOLI) {
    const gr = DATA.giocatori.filter((g) => g.r === r), ord = gr.map((g) => g.ps).sort((a, b) => b - a);
    const linea = (k) => ord[Math.min(arrotonda(k), ord.length - 1)];
    const lt = linea(n * TIT_RUOLO[r]), lr = linea(quote[r]);
    for (const g of gr) {
      const v = Math.max(g.ps - lt, 0) + PESO_ROTAZIONE * Math.max(Math.min(g.ps, lt) - lr, 0);
      vorp.set(g.id, v); somma += v;
    }
  }
  // prezzo atteso: FVM (stimato dalla quotazione dove manca), maggiorazione tifo, scala che fa sommare ai crediti
  const base = new Map();
  for (const r of RUOLI) {
    const gr = DATA.giocatori.filter((g) => g.r === r);
    const ok = gr.filter((g) => g.fvm > 0 && g.qa > 0);
    let a = 0, b = 0;
    if (ok.length > 5) {
      const x = ok.map((g) => Math.log(g.qa)), y = ok.map((g) => Math.log(g.fvm));
      const mx = x.reduce((s, v) => s + v, 0) / x.length, my = y.reduce((s, v) => s + v, 0) / y.length;
      const sxx = x.reduce((s, v) => s + (v - mx) ** 2, 0);
      a = sxx ? x.reduce((s, v, i) => s + (v - mx) * (y[i] - my), 0) / sxx : 0; b = my - a * mx;
    }
    for (const g of gr) {
      base.set(g.id, g.fvm > 0 ? g.fvm : ok.length > 5 && g.qa > 0 ? Math.exp(a * Math.log(g.qa) + b) : 1);
    }
  }
  const grezzo = new Map(DATA.giocatori.map((g) => [g.id, base.get(g.id) * (g.tifo ?? 1)]));
  const comprati = [];
  for (const r of RUOLI) {
    comprati.push(...DATA.giocatori.filter((g) => g.r === r).sort((p, q) => grezzo.get(q.id) - grezzo.get(p.id)).slice(0, quote[r]));
  }
  let lo = 1e-4, hi = 10;
  for (let i = 0; i < 60; i++) {
    const m = (lo + hi) / 2, tot = comprati.reduce((t, g) => t + Math.max(PREZZO_MIN, grezzo.get(g.id) * m), 0);
    if (tot < n * cred) lo = m; else hi = m;
  }
  const scala = (lo + hi) / 2;
  for (const g of DATA.giocatori) {
    const val = PREZZO_MIN + (somma ? vorp.get(g.id) / somma * discrezionali : 0);
    const pa = Math.max(PREZZO_MIN, Math.round(grezzo.get(g.id) * scala));
    out.set(g.id, { val, pa, aff: val - pa });
  }
  return out;
}
function applicaLega() {
  META.n_squadre = S.nSq ?? LEGA0.n;
  META.crediti = S.cred ?? LEGA0.cr;
  const nuova = legaCambiata() ? valutaLega(META.n_squadre, META.crediti) : null;
  for (const g of DATA.giocatori) {
    const v = nuova && nuova.get(g.id);
    g.pa = v ? v.pa : g.pa0; g.val = v ? v.val : g.val0; g.aff = v ? v.aff : g.aff0;
  }
  const T = TITOLARI_LEGA();
  for (const r of RUOLI) {
    const l = DATA.giocatori.filter((g) => g.r === r).map((g) => g.pg).sort((a, b) => b - a);
    SOGLIA[r] = l[Math.min(T[r], l.length) - 1] ?? 0;
    SPESA_RUOLO[r] = DATA.giocatori.filter((g) => g.r === r).map((g) => g.pa).sort((a, b) => b - a)
      .slice(0, META.n_squadre * META.slot[r]).reduce((a, x) => a + x, 0);
  }
  $("#meta").innerHTML = [[`Serie A ${META.stagione}`, `Dati alla ${META.giornata}ª giornata`],
    [`${META.giornate_residue} giornate da comprare`, `${META.n_squadre} squadre · ${META.crediti} crediti`]]
    .map((riga) => `<div class="riga">${riga.map((t) => `<span>${t}</span>`).join("")}</div>`).join("");
}
function cambiaLega(chiave, v) {
  const lim = LEGA_LIM[chiave === "nSq" ? "n" : "cr"];
  const x = Math.min(lim[1], Math.max(lim[0], Math.round(+v) || lim[0]));
  S[chiave] = x === (chiave === "nSq" ? LEGA0.n : LEGA0.cr) ? null : x;
  if (chiave === "cred") S.budgetRuolo = null;          // il budget per ruolo era in altri crediti
  S.aperte = {};
  applicaLega();
  aggiorna();
}

function aggiorna() {
  if (inAsta()) sincronizzaAsta(); else { INFL = 1; FATT = { P: 1, D: 1, C: 1, A: 1 }; MERC = null; }
  SUGG = ottimizza();
  renderBudget(); renderListone(); renderRosa(); renderControlloAsta();
  if (inAsta()) renderAsta();
  salva();
}
