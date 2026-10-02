// Regressione del supporto all'asta, senza browser: carica i moduli del tool in un contesto con
// il minimo di DOM finto e gioca aste intere in cui "io" parto da un piano completo con il
// budget per ruolo manuale, pago piu' del previsto e a volte prendo giocatori fuori piano.
//
// Cosa non deve mai succedere, a nessun acquisto:
//   - l'ottimizzatore che resta senza risposta (errore, o meno suggeriti degli slot liberi);
//   - una rosa suggerita che costa piu' dei crediti rimasti;
//   - "fin dove spingerti" oltre l'offerta massima, o un numero quando non si puo' calcolare.
// E deve succedere che i crediti per ruolo si spostino quando un ruolo costa piu' del piano.
//
// Uso: node tests/web/asta_regressione.js   (esce con 1 e stampa i problemi se qualcosa non va)
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");

const WEB = path.join(__dirname, "..", "..", "src", "web");
const finto = () => new Proxy(function () {}, { get: (t, k) => (k === "innerHTML" || k === "textContent" || k === "value" ? "" : finto()), set: () => true, apply: () => finto() });
const ctx = vm.createContext({
  console, Math, JSON, Date, Map, Set, Float64Array, Array, Object, Number, String, Infinity, NaN, parseInt, parseFloat, isNaN,
  setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0,
  document: { querySelector: () => finto(), querySelectorAll: () => [], addEventListener: () => {}, getElementById: () => finto(), documentElement: finto(), activeElement: null },
  localStorage: { getItem: () => null, setItem: () => {} },
  innerWidth: 1440, matchMedia: () => ({ matches: false }), addEventListener: () => {},
});
ctx.window = ctx;
for (const f of ["stato", "ottimizzatore", "calendario", "lega", "asta-stato", "chiamata", "consigli"])
  vm.runInContext(fs.readFileSync(path.join(WEB, "scripts", f + ".js"), "utf8"), ctx, { filename: f + ".js" });
ctx.DATI = JSON.parse(fs.readFileSync(path.join(WEB, "data.json"), "utf8"));

const esito = vm.runInContext(`(() => {
  DATA = DATI; META = DATA.meta; BY_ID = new Map(DATA.giocatori.map((g) => [g.id, g]));
  for (const g of DATA.giocatori) { g.pa0 = g.pa; g.val0 = g.val; g.aff0 = g.aff; }
  preparaGiornate();
  LEGA0 = { n: META.n_squadre, cr: META.crediti };
  applicaLega();
  const problemi = [], riepiloghi = [];
  const ricalcola = () => { if (inAsta()) sincronizzaAsta(); else { INFL = 1; FATT = { P: 1, D: 1, C: 1, A: 1 }; MERC = null; } SUGG = ottimizza(); };

  function asta(seme, caro, tavolo, modo) {
    const seme0 = seme;
    const caso = () => (seme = (seme * 1103515245 + 12345) % 2147483648) / 2147483648;
    S.asta = null; S.piani.A = {}; S.piano = "A"; S.budgetRuolo = null; S.modo = modo; S.presi = {};
    ricalcola();
    if (SUGG.errore) { problemi.push("piano di partenza: " + SUGG.errore); return; }
    const piano = Object.fromEntries(SUGG.lista.map((c) => [c.g.id, c.p]));
    const alloc = { P: 0, D: 0, C: 0, A: 0 }; for (const c of SUGG.lista) alloc[c.g.r] += c.p;
    S.budgetRuolo = { ...alloc };                      // come il bottone "Manuale": tetti = divisione del piano
    S.asta = { attiva: true, io: 0, inizio: "", squadre: Array.from({ length: META.n_squadre }, (_, i) => ({ nome: "Sq" + i, rosa: {} })), log: [],
      obiettivi: Object.keys(piano).map(Number), obiettiviPrezzi: { ...piano }, presiPiano: {}, chiamato: null, scelta: null, aperta: null,
      modo: "ruolo", giro: { verso: 1, turno: 0 } };
    ricalcola();
    const dove = (n) => "seme " + seme0 + " " + modo + ", acquisto " + n + ": ";
    let n = 0, spostati = false, tettiProvati = 0;
    while (MERC.fase && n < 500) {
      n++;
      const fase = MERC.fase, st = MERC.st, me = st[0];
      const liberi = DATA.giocatori.filter((g) => g.r === fase && !OWNER.has(g.id)).sort((a, b) => b.pa - a.pa);
      const g = liberi[Math.floor(caso() * Math.min(3, liberi.length))];
      const rivali = st.filter((t) => t.i !== 0 && t.liberi[fase] > 0 && t.maxOff >= 1);
      const mio = (g.id in piano || SUGG.ids.has(g.id) || caso() < 0.08) && me.liberi[fase] > 0 && me.maxOff >= 1;
      // ogni tanto, prima di comprare, si controlla il tetto del giocatore chiamato
      if (me.liberi[fase] > 0 && tettiProvati < 6 && caso() < 0.05) {
        tettiProvati++;
        const v = calcolaSpinta(g.id);
        if (v.max != null && v.max > me.maxOff) problemi.push(dove(n) + "tetto " + v.max + " oltre l'offerta massima " + me.maxOff + " per " + g.nome);
        if (v.max == null && !SUGG.errore) problemi.push(dove(n) + "tetto non calcolabile per " + g.nome + ": " + v.motivo);
      }
      let t, prezzo;
      if ((mio && caso() < 0.8) || !rivali.length) { t = me; prezzo = Math.round(g.pa * caro * (0.9 + 0.3 * caso())); }
      else {
        t = rivali[Math.floor(caso() * rivali.length)];
        const ultimo = !MERC.futuri.length, spinta = ultimo ? Math.max(1, t.crediti / Math.max(1, t.liberi[fase]) / 30) : 1;
        prezzo = Math.round(g.pa * tavolo * (0.8 + 0.4 * caso()) * (ultimo ? Math.min(2, spinta) : 1));
      }
      prezzo = Math.max(1, Math.min(t.maxOff, prezzo));
      S.asta.squadre[t.i].rosa[g.id] = prezzo; S.asta.log.push({ id: g.id, t: t.i, p: prezzo, ora: "" });
      ricalcola();
      const io = MERC.st[0];
      if (SUGG.errore) problemi.push(dove(n) + "ottimizzatore fermo con " + io.crediti + " crediti e " + io.liberiTot + " slot: " + SUGG.errore);
      else {
        if (SUGG.lista.length !== io.liberiTot) problemi.push(dove(n) + SUGG.lista.length + " suggeriti per " + io.liberiTot + " slot liberi");
        if (SUGG.costo > io.crediti) problemi.push(dove(n) + "i suggeriti costano " + SUGG.costo + " ma restano " + io.crediti + " crediti");
        const perRuoloSugg = { P: 0, D: 0, C: 0, A: 0 }; for (const c of SUGG.lista) perRuoloSugg[c.g.r]++;
        for (const r of RUOLI) if (perRuoloSugg[r] !== Math.max(0, io.liberi[r])) problemi.push(dove(n) + "ruolo " + r + ": " + perRuoloSugg[r] + " suggeriti per " + io.liberi[r] + " slot");
      }
      // i crediti per ruolo seguono l'asta: un ruolo puo' andare oltre il tetto del piano
      const tot = { P: 0, D: 0, C: 0, A: 0 };
      for (const [id, pz] of Object.entries(mia())) tot[BY_ID.get(+id).r] += +pz;
      if (RUOLI.some((r) => tot[r] > alloc[r])) spostati = true;
    }
    const fine = MERC.st[0];
    if (fine.liberiTot !== 0) problemi.push("seme " + seme0 + ": asta finita con " + fine.liberiTot + " slot liberi");
    riepiloghi.push({ seme: seme0, modo, acquisti: S.asta.log.length, oltreIlPiano: spostati, creditiRimasti: fine.crediti });
    if (caro > 1.2 && !spostati) problemi.push("seme " + seme0 + ": pagando caro nessun ruolo ha superato il budget del piano (i tetti manuali vincolano ancora?)");
  }

  asta(12345, 1.3, 1.0, "omogenea");     // pago il 30% in piu'
  asta(777, 1.5, 0.75, "omogenea");      // pago molto di piu' e il tavolo spende poco: i prezzi attesi dei ruoli dopo salgono
  asta(5, 1.3, 1.4, "top");              // il tavolo spende tanto, strategia "top + 1 credito"

  // Senza una rosa di confronto il tetto non e' un numero: qui i crediti non bastano nemmeno
  // per un credito a slot, quindi l'ottimizzatore non ha una rosa da proporre.
  {
    const D = DATA.giocatori.filter((g) => g.r === "D").sort((a, b) => b.pa - a.pa);
    S.budgetRuolo = null; S.modo = "omogenea"; S.presi = {};
    S.asta = { attiva: true, io: 0, inizio: "", squadre: Array.from({ length: META.n_squadre }, (_, i) => ({ nome: "Sq" + i, rosa: {} })), log: [],
      obiettivi: [], obiettiviPrezzi: {}, presiPiano: {}, chiamato: null, scelta: null, aperta: null, modo: "libero", giro: { verso: 0, turno: 0 } };
    S.asta.squadre[0].rosa[D[0].id] = META.crediti - 5;
    ricalcola();
    const v = calcolaSpinta(D[40].id);
    if (!SUGG.errore) problemi.push("con 5 crediti per 24 slot l'ottimizzatore dovrebbe dire che il budget non basta");
    if (v.max != null) problemi.push("senza una rosa di confronto il tetto deve essere 'non calcolabile', non " + v.max);
  }

  // Fuori dall'asta il budget manuale vincola ancora (e' li' che serve): con un tetto
  // impossibile l'ottimizzatore lo dice.
  S.asta = null; S.piani.A = {}; S.budgetRuolo = { P: 1, D: 1, C: 1, A: 1 }; S.modo = "omogenea";
  ricalcola();
  if (!SUGG.errore) problemi.push("fuori dall'asta il budget per ruolo manuale non vincola piu'");
  S.budgetRuolo = null;
  return { problemi, riepiloghi };
})()`, ctx);

console.log(JSON.stringify(esito.riepiloghi));
if (esito.problemi.length) {
  console.error(esito.problemi.slice(0, 20).join("\n"));
  console.error(`${esito.problemi.length} problemi`);
  process.exit(1);
}
console.log("ok");
