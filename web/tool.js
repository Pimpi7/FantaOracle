// FantaOracle — logica del tool: dati, ottimizzatore, listone, rosa, modalita' asta.
// Legge data.json dalla stessa cartella; non ha dipendenze esterne.

"use strict";
// --- stato e persistenza ------------------------------------------------------
const RUOLI = ["P", "D", "C", "A"];
const NOMI_RUOLO = { P: "Portieri", D: "Difensori", C: "Centrocampisti", A: "Attaccanti" };
// Peso di ciascun posto nella gerarchia del ruolo: i titolari contano pieno, le
// riserve in proporzione a quanto giocheranno. Il difensore 5 conta di piu'
// della 5a riserva di altri ruoli perche' il modificatore vuole la difesa a 4.
const PESI = { P: [1, 0.10, 0.03], D: [1, 1, 1, 1, 0.45, 0.25, 0.12, 0.06],
               C: [1, 1, 1, 0.75, 0.40, 0.20, 0.10, 0.05], A: [1, 1, 0.55, 0.30, 0.12, 0.05] };
const KEY = "fantaoracle:v1";

let DATA = null, BY_ID = new Map(), META = null;
const S = {
  piano: "A",
  piani: { A: {}, B: {}, C: {} },   // id -> prezzo, per piano
  presi: {},                         // id -> true: esclusi dai suggerimenti (non li voglio o li do per persi)
  margine: 0.10, esenzioneP: true, tetto: 3, modo: "omogenea",
  budgetRuolo: null,                 // null = automatico, altrimenti {P, D, C, A}
  f: { q: "", r: "", sq: "", pmax: null, hide: false, salute: "" },
  sort: { k: "pg", dir: -1 },
  aperte: {},                        // alternative aperte per slot suggerito
  asta: null,                        // asta in corso o sospesa
  archivio: [],                      // aste concluse, con le rose finali
  nSq: null, cred: null,             // lega personalizzata (null = quella dei dati)
};
let SUGG = { ids: new Set(), lista: [], forza: 0, costo: 0, errore: null, alt: {} };

function salva() {
  try { localStorage.setItem(KEY, JSON.stringify({ piano: S.piano, piani: S.piani, presi: S.presi,
    margine: S.margine, esenzioneP: S.esenzioneP, tetto: S.tetto, modo: S.modo, budgetRuolo: S.budgetRuolo, nSq: S.nSq, cred: S.cred, asta: S.asta, archivio: S.archivio, campoChiuso: !!S.campoChiuso })); } catch (e) { /* storage non disponibile */ }
}
function carica() {
  try {
    const x = JSON.parse(localStorage.getItem(KEY) || "null");
    if (x) Object.assign(S, { piano: x.piano || "A", piani: Object.assign({ A: {}, B: {}, C: {} }, x.piani || {}),
      presi: x.presi || {}, margine: x.margine ?? 0.10, esenzioneP: x.esenzioneP ?? true, tetto: x.tetto ?? 3, modo: x.modo || "omogenea", budgetRuolo: x.budgetRuolo || null, nSq: x.nSq || null, cred: x.cred || null, asta: x.asta || null, archivio: x.archivio || [], campoChiuso: !!x.campoChiuso });
  } catch (e) { /* storage non disponibile */ }
}
// In asta "la mia rosa" e' la rosa reale, non piu' un piano.
const inAsta = () => !!(S.asta && S.asta.attiva);
const mia = () => (inAsta() ? S.asta.squadre[S.asta.io].rosa : S.piani[S.piano]);

// --- utilita' -------------------------------------------------------------------
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (x, d = 1) => (x == null || Number.isNaN(x) ? "–" : Number(x).toLocaleString("it-IT", { minimumFractionDigits: d, maximumFractionDigits: d }));
const pct = (x) => (x == null ? "–" : Math.round(x * 100) + "%");
const segno = (x) => (x > 0 ? "+" : "") + fmt(x, 0);
const nomeSq = (s) => (DATA.squadre.find((x) => x.slug === s) || { nome: s }).nome;
// INFL segue l'asta: se il tavolo spende piu' (o meno) del previsto, i prezzi
// attesi dei giocatori rimasti si riscalano sui crediti che restano davvero.
let INFL = 1;
// In asta i crediti si colorano da verde (pieni) a rosso (finiti), in proporzione.
function cr(val, max) {
  if (!inAsta()) return String(val);
  const f = Math.max(0, Math.min(1, max > 0 ? val / max : 0));
  return `<span class="cr" style="color:hsl(${Math.round(f * 128)} var(--cs) var(--cl))">${val}</span>`;
}
const prezzoAtteso = (g) => Math.max(1, Math.round(g.pa * INFL * (1 + S.margine)));

// --- ottimizzatore ----------------------------------------------------------------
// Portieri e attaccanti hanno i punti attesi partita per partita (g.v, allineati a
// META.giornate_cal): per loro la gerarchia si rifa' ogni giornata, perche' ogni turno
// schieri chi ha la partita migliore. E' cosi' che l'alternanza della griglia entra
// nella rosa: due portieri con calendari complementari valgono piu' della somma dei
// loro Pt/g pesati. Con un calendario piatto il conto torna identico a quello di stagione.
let NG = 0;                                   // giornate con i punti partita per partita
const PER_GIORNATA = { P: false, D: false, C: false, A: false };
let SCR = new Float64Array(16);

// Forza di un ruolo: somma pesata dei punti a giornata, ordinati dal migliore.
function forzaRuolo(gs, r) {
  const w = PESI[r], n = gs.length;
  if (!PER_GIORNATA[r]) {
    const s = gs.map((g) => g.pg).sort((a, b) => b - a);
    let t = 0;
    for (let i = 0; i < s.length; i++) t += (w[i] || 0) * s[i];
    return t;
  }
  if (!n) return 0;
  if (SCR.length < n) SCR = new Float64Array(n);
  const m = Math.min(n, w.length);
  let t = 0;
  for (let k = 0; k < NG; k++) {
    // ordinamento per inserzione, dal migliore: i giocatori di un ruolo sono al massimo 6
    for (let i = 0; i < n; i++) {
      const x = gs[i].v[k];
      let j = i - 1;
      while (j >= 0 && SCR[j] < x) { SCR[j + 1] = SCR[j]; j--; }
      SCR[j + 1] = x;
    }
    for (let i = 0; i < m; i++) t += w[i] * SCR[i];
  }
  return t / NG;
}

// Per valutare in fretta "quanto rende aggiungere g a questo reparto": il reparto si ordina
// una volta per giornata, poi ogni candidato costa una ricerca della sua posizione.
// Inserendo x al posto j la forza cresce di w[j]*x + somma_{i>=j} (w[i+1]-w[i]) * s[i].
function reparto(gs, r) {
  const base = forzaRuolo(gs, r);
  if (!PER_GIORNATA[r]) return { r, gs, base };
  const w = PESI[r], n = gs.length, B = new Float64Array(NG * n), C = new Float64Array(NG * (n + 1));
  for (let k = 0; k < NG; k++) {
    const o = k * n;
    for (let i = 0; i < n; i++) {
      const x = gs[i].v[k];
      let j = i - 1;
      while (j >= 0 && B[o + j] < x) { B[o + j + 1] = B[o + j]; j--; }
      B[o + j + 1] = x;
    }
    const q = k * (n + 1);
    for (let i = n - 1; i >= 0; i--) C[q + i] = ((w[i + 1] || 0) - (w[i] || 0)) * B[o + i] + C[q + i + 1];
  }
  return { r, gs, base, n, B, C };
}
function guadagno(rep, g) {
  if (!rep.B) { rep.gs.push(g); const d = forzaRuolo(rep.gs, rep.r) - rep.base; rep.gs.pop(); return d; }
  const w = PESI[rep.r], n = rep.n, B = rep.B, C = rep.C;
  let t = 0;
  for (let k = 0; k < NG; k++) {
    const x = g.v[k], o = k * n;
    let j = 0;
    while (j < n && B[o + j] >= x) j++;
    t += (w[j] || 0) * x + C[k * (n + 1) + j];
  }
  return t / NG;
}

function contaSquadre(ids) {
  const c = {};
  for (const id of ids) {
    const g = BY_ID.get(+id);
    if (!g || (S.esenzioneP && g.r === "P")) continue;
    c[g.sq] = (c[g.sq] || 0) + 1;
  }
  return c;
}

// Completa la rosa rispettando budget, slot per ruolo, 1 credito minimo per
// slot e tetto per squadra. Greedy su guadagno - lambda * prezzo per piu'
// valori di lambda, poi ricerca locale per scambi migliorativi.
function ottimizzaCon(extra) {
  const F = { ...mia(), ...extra };
  const cred = META.crediti, slot = META.slot;
  const scelti = Object.entries(F).map(([id, p]) => ({ g: BY_ID.get(+id), p: +p })).filter((x) => x.g);
  const speso = scelti.reduce((a, x) => a + x.p, 0);
  const B = cred - speso;
  const liberi = {}, base = {};
  for (const r of RUOLI) { base[r] = scelti.filter((x) => x.g.r === r).map((x) => x.g); liberi[r] = slot[r] - base[r].length; }
  const nLiberi = RUOLI.reduce((a, r) => a + Math.max(0, liberi[r]), 0);
  const esclusi = new Set([...Object.keys(F).map(Number), ...Object.keys(S.presi).map(Number)]);
  const cand = DATA.giocatori.filter((g) => !esclusi.has(g.id)).map((g) => ({ g, p: prezzoAtteso(g) }));
  const sq0 = contaSquadre(Object.keys(F));
  // Budget per ruolo (modalita' manuale): tetto di spesa per ciascun ruolo,
  // compresi i giocatori gia' scelti.
  const limR = {};
  for (const r of RUOLI) {
    const spesi = Object.entries(F).filter(([id]) => BY_ID.get(+id)?.r === r).reduce((a, [, pz]) => a + +pz, 0);
    limR[r] = S.budgetRuolo ? (+S.budgetRuolo[r] || 0) - spesi : Infinity;
  }
  const ok = (sq, g) => (S.esenzioneP && g.r === "P") || (sq[g.sq] || 0) < S.tetto;

  const errore = RUOLI.filter((r) => liberi[r] < 0).map((r) => `troppi ${NOMI_RUOLO[r].toLowerCase()} (${base[r].length}/${slot[r]})`);
  if (errore.length) return { ids: new Set(), lista: [], forza: 0, costo: 0, errore: "Rosa non valida: " + errore.join(", "), alt: {} };
  if (B < nLiberi) return { ids: new Set(), lista: [], forza: 0, costo: 0, errore: `Budget insufficiente: restano ${B} crediti per ${nLiberi} slot.`, alt: {} };
  const corti = RUOLI.filter((r) => liberi[r] > 0 && limR[r] < liberi[r]);
  if (corti.length) return { ids: new Set(), lista: [], forza: 0, costo: 0, alt: {},
    errore: "Budget per ruolo insufficiente: " + corti.map((r) => `${NOMI_RUOLO[r].toLowerCase()} ha ${Math.max(0, limR[r])} crediti per ${liberi[r]} slot`).join(", ") + "." };

  const forzaTot = (pts) => RUOLI.reduce((a, r) => a + forzaRuolo(pts[r], r), 0);

  function greedy(lambda) {
    const pts = {}; for (const r of RUOLI) pts[r] = base[r].slice();
    const f = {}, rep = {};
    for (const r of RUOLI) { rep[r] = reparto(pts[r], r); f[r] = rep[r].base; }
    const lib = { ...liberi }, sq = { ...sq0 }, usati = new Set(), lista = [];
    const costoR = { P: 0, D: 0, C: 0, A: 0 };
    let costo = 0;
    for (let k = 0; k < nLiberi; k++) {
      const disp = B - costo - (nLiberi - k - 1);
      let best = null, bestNet = -Infinity, bestGain = 0;
      for (const c of cand) {
        const g = c.g;
        if (lib[g.r] <= 0 || usati.has(g.id) || c.p > disp || !ok(sq, g)) continue;
        if (c.p > limR[g.r] - costoR[g.r] - (lib[g.r] - 1)) continue;
        const gain = guadagno(rep[g.r], g);
        const net = gain - lambda * c.p;
        if (net > bestNet) { bestNet = net; best = c; bestGain = gain; }
      }
      if (!best) return null;
      const g = best.g;
      usati.add(g.id); lista.push(best); pts[g.r].push(g); f[g.r] += bestGain;
      rep[g.r] = reparto(pts[g.r], g.r);
      lib[g.r]--; costo += best.p; costoR[g.r] += best.p;
      if (!(S.esenzioneP && g.r === "P")) sq[g.sq] = (sq[g.sq] || 0) + 1;
    }
    return { lista, costo, costoR, pts, forza: forzaTot(pts) };
  }

  let best = null;
  for (const lambda of [0, 0.002, 0.005, 0.01, 0.015, 0.02, 0.03, 0.04, 0.06, 0.08, 0.11, 0.15, 0.2, 0.3]) {
    const s = greedy(lambda);
    if (s && (!best || s.forza > best.forza)) best = s;
  }
  if (!best) return { ids: new Set(), lista: [], forza: 0, costo: 0, errore: "Nessuna rosa possibile con questi vincoli.", alt: {} };

  // Ricerca locale: scambio di un suggerito con un non scelto dello stesso ruolo.
  const inRosa = new Set(best.lista.map((c) => c.g.id));
  for (let it = 0; it < 80; it++) {
    const sq = contaSquadre([...Object.keys(F), ...best.lista.map((c) => c.g.id)]);
    let mig = null, migD = 1e-6;
    for (let i = 0; i < best.lista.length; i++) {
      const s = best.lista[i], r = s.g.r;
      const senza = best.pts[r].slice(); senza.splice(senza.indexOf(s.g), 1);
      const rs = reparto(senza, r), f0 = forzaRuolo(best.pts[r], r) - rs.base;
      for (const c of cand) {
        if (c.g.r !== r || inRosa.has(c.g.id)) continue;
        if (best.costo - s.p + c.p > B || best.costoR[r] - s.p + c.p > limR[r]) continue;
        if (c.g.sq !== s.g.sq && !(S.esenzioneP && r === "P") && (sq[c.g.sq] || 0) >= S.tetto) continue;
        const d = guadagno(rs, c.g) - f0;
        if (d > migD) { migD = d; mig = { i, c }; }
      }
    }
    if (!mig) break;
    const s = best.lista[mig.i], r = s.g.r;
    best.pts[r].splice(best.pts[r].indexOf(s.g), 1); best.pts[r].push(mig.c.g);
    inRosa.delete(s.g.id); inRosa.add(mig.c.g.id);
    best.costo += mig.c.p - s.p; best.costoR[r] += mig.c.p - s.p; best.lista[mig.i] = mig.c; best.forza += migD;
  }

  // Alternative per ogni suggerito: scambi possibili ordinati per forza risultante.
  const alt = {};
  const sqTot = contaSquadre([...Object.keys(F), ...best.lista.map((c) => c.g.id)]);
  for (const s of best.lista) {
    const r = s.g.r;
    const senza = best.pts[r].slice(); senza.splice(senza.indexOf(s.g), 1);
    const rs = reparto(senza, r), f0 = forzaRuolo(best.pts[r], r) - rs.base;
    const opz = [];
    for (const c of cand) {
      if (c.g.r !== r || inRosa.has(c.g.id)) continue;
      if (best.costo - s.p + c.p > B || best.costoR[r] - s.p + c.p > limR[r]) continue;
      if (c.g.sq !== s.g.sq && !(S.esenzioneP && r === "P") && (sqTot[c.g.sq] || 0) >= S.tetto) continue;
      opz.push({ c, d: guadagno(rs, c.g) - f0 });
    }
    opz.sort((a, b) => b.d - a.d);
    alt[s.g.id] = opz.slice(0, 5);
  }

  return { ids: inRosa, lista: best.lista, forza: best.forza, costo: best.costo, errore: null, alt };
}

// --- calendario e alternanza (la griglia di FantaLab) ----------------------------------------
// Ogni avversario e' facile, medio o difficile, separatamente per chi lo affronta da
// portiere e da attaccante (DATA.fantalab). Un abbinamento e' buono se ogni giornata
// almeno uno dei tuoi ha una partita comoda: lo si misura in fasce, come FantaLab, e in
// punti, schierando ogni turno chi ne fa di piu'.
const FASCIA_CL = { facile: "fl-f", media: "fl-m", difficile: "fl-d" };
const PESO_FASCIA = { facile: 0, media: 50, difficile: 100 };
let CAL = {};                                   // squadra -> per giornata { gi, avv, casa } o null
let SCHEDA = { id: null, abb: null };           // scheda aperta e compagno mostrato nella griglia

function preparaGiornate() {
  const gc = META.giornate_cal || [];
  NG = gc.length;
  const pos = new Map(gc.map((gi, i) => [gi, i]));
  CAL = {};
  for (const [sq, partite] of Object.entries(DATA.calendario || {})) {
    const riga = Array(NG).fill(null);
    for (const [gi, avv, casa] of partite) if (pos.has(gi)) riga[pos.get(gi)] = { gi, avv, casa: !!casa };
    CAL[sq] = riga;
  }
  for (const r of ["P", "A"]) PER_GIORNATA[r] = NG > 0 && DATA.giocatori.some((g) => g.r === r && g.pgg);
  for (const g of DATA.giocatori) {
    if (!PER_GIORNATA[g.r]) continue;
    // una giornata senza partita (gia' giocata) non porta punti
    g.v = g.pgg ? Float64Array.from(g.pgg, (x) => x ?? 0) : new Float64Array(NG).fill(g.pg);
  }
}

const sigla = (sq) => sq.slice(0, 3).toUpperCase();
const fasciaFL = (avv, r) => DATA.fantalab?.[r]?.[avv] || null;

// Un gruppo di giocatori dello stesso ruolo che si alternano in un posto: ogni giornata gioca
// chi ha piu' punti attesi. pg e' la media del migliore di giornata; le fasce contano la
// migliore fra le partite del gruppo, e il voto e' quello che stampa FantaLab (100 meno la
// media dei pesi: facile 0, media 50, difficile 100).
function abbinamento(gs, r) {
  const conta = { facile: 0, media: 0, difficile: 0 };
  let tot = 0, n = 0;
  for (let k = 0; k < NG; k++) {
    let best = 0, fb = null;
    for (const g of gs) {
      if (g.v[k] > best) best = g.v[k];
      const c = CAL[g.sq]?.[k], f = c && fasciaFL(c.avv, r);
      if (f && (fb === null || PESO_FASCIA[f] < PESO_FASCIA[fb])) fb = f;
    }
    tot += best;
    if (fb) { conta[fb]++; n++; }
  }
  const peso = conta.media * 50 + conta.difficile * 100;
  return { pg: NG ? tot / NG : 0, ...conta, partite: n, voto: n ? Math.round(100 - peso / n) : 0 };
}

// I compagni di alternanza di un portiere o di un attaccante, dal piu' utile: quanti punti a
// giornata aggiunge ciascuno rispetto a schierare sempre lui (a pari punti, il voto FantaLab
// piu' alto). Fuori chi e' della stessa squadra (stesso calendario), chi e' escluso o gia'
// preso da altri, e le riserve: chi prende voto meno di una volta su tre non si alterna con
// nessuno. Quelli gia' nella tua rosa restano comunque.
const PRESENZE_MIN = 0.35;
function compagni(g) {
  const solo = abbinamento([g], g.r).pg, m = mia();
  return DATA.giocatori
    .filter((q) => q.r === g.r && q.v && q.id !== g.id && q.sq !== g.sq &&
      (m[q.id] != null || (!S.presi[q.id] && (q.pv ?? 0) >= PRESENZE_MIN)))
    .map((q) => {
      const a = abbinamento([g, q], g.r), mio = m[q.id] != null;
      return { q, a, d: a.pg - solo, p: mio ? +m[q.id] : prezzoAtteso(q), mio };
    })
    // al centesimo, come si leggono: sotto, decide il calendario
    .sort((x, y) => Math.round(y.d * 100) - Math.round(x.d * 100) || y.a.voto - x.a.voto || y.d - x.d);
}

// La griglia: una riga per giocatore, una casella per giornata con l'avversario, colorata
// con la sua fascia. Con due giocatori si sbiadisce chi resta in panchina quella giornata.
function griglia(g, q) {
  const righe = q ? [g, q] : [g], gc = META.giornate_cal;
  // su schermo largo le giornate vanno su due righe, cosi' la stagione si vede tutta senza scorrere
  const perRiga = NG > 20 && innerWidth >= 640 ? Math.ceil(NG / 2) : NG;
  let h = "";
  for (let da = 0; da < NG; da += perRiga) {
    const a = Math.min(NG, da + perRiga), vuote = "<span></span>".repeat(perRiga - (a - da));
    h += `<div class="griglia${perRiga < NG ? " piena" : ""}" style="--n:${perRiga}"><span class="nome"></span>`;
    for (let k = da; k < a; k++) h += `<span class="gi">${gc[k]}</span>`;
    h += vuote;
    for (const x of righe) {
      h += `<span class="nome" title="${esc(x.nome)}">${esc(x.nome)}</span>`;
      const y = q ? (x === g ? q : g) : null;
      for (let k = da; k < a; k++) {
        const c = CAL[x.sq]?.[k];
        if (!c) { h += `<span class="c vuota" title="Partita già giocata"></span>`; continue; }
        const f = fasciaFL(c.avv, g.r);
        const gioca = !y || x.v[k] > y.v[k] || (x.v[k] === y.v[k] && x === g);
        // infortunato o squalificato in quella giornata: i suoi punti sono gia' zero
        const out = fuori(x) && (x.inf.fs || (x.inf.g != null && c.gi < x.inf.g));
        const t = `${c.gi}ª giornata: ${nomeSq(c.avv)} ${c.casa ? "in casa" : "fuori"} · ${f || "fascia ignota"} · `
          + (out ? `${x.inf.t === "squalificato" ? "squalificato" : "infortunato"}${x.inf.m ? ` (${x.inf.m})` : ""}` : `${fmt(x.v[k], 2)} pt attesi`);
        h += `<span class="c ${f ? FASCIA_CL[f] : ""}${gioca && !out ? "" : " off"}${out ? " out" : ""}" title="${esc(t)}">${c.casa ? sigla(c.avv) : sigla(c.avv).toLowerCase()}</span>`;
      }
      h += vuote;
    }
    h += "</div>";
  }
  return h;
}

// Sezione della scheda di portieri e attaccanti: com'e' il calendario da solo, i compagni con
// cui alternarlo (un riquadro ciascuno: toccarlo mette la coppia nella griglia) e la griglia.
// La tabella completa dei compagni resta chiusa finche' non la si apre.
function sezioneAlternanza(g) {
  if (!PER_GIORNATA[g.r] || !g.v) return "";
  const lista = compagni(g);
  const miei = lista.filter((c) => c.mio), altri = lista.filter((c) => !c.mio);
  const top = altri.slice(0, 5);
  const soglia = Math.max(2, Math.round(META.crediti / 100));
  const low = altri.filter((c) => c.p <= soglia && !top.includes(c)).slice(0, 3);
  const fissato = BY_ID.get(SCHEDA.abb);
  const scelto = (fissato && fissato.r === g.r && fissato.sq !== g.sq && fissato.v ? fissato : null)
    || (miei[0] || top[0])?.q || null;
  const io = abbinamento([g], g.r);
  const gc = META.giornate_cal;
  const chi = g.r === "P" ? "portiere" : "attaccante";

  const solo = [
    box({ v: io.facile, l: "partite facili", ic: "ok", tono: "ok" }),
    box({ v: io.media, l: "medie", ic: "pari", tono: "med" }),
    box({ v: io.difficile, l: "difficili", ic: "no", tono: "ko" }),
    box({ v: io.voto, l: "voto FantaLab da solo", ic: "bersaglio", sub: "su 100",
      title: "Il voto che la griglia di FantaLab dà a questo calendario: 100 vuol dire ogni giornata contro una squadra facile" }),
  ];
  if (g.r === "A" && g.cal) {
    const d = (g.cal - 1) * 100;
    solo.push(box({ v: `${d < 0 ? "−" : "+"}${fmt(Math.abs(d), 0)}%`, l: "gol attesi dal calendario", ic: "pallone", tono: d < 0 ? "meno" : "piu",
      sub: "rispetto a uno medio" }));
  }

  // I compagni in evidenza: chi hai gia' in rosa, i tre migliori, due da pochi crediti.
  const carte = [...miei.slice(0, 2).map((c) => [c, "In rosa"]), ...top.slice(0, 3).map((c) => [c, ""]), ...low.slice(0, 2).map((c) => [c, "Low cost"])];
  const carta = ([c, nota]) => `<button type="button" class="comp" data-abb="${c.q.id}" aria-pressed="${c.q === scelto}" title="Metti ${esc(c.q.nome)} nella griglia accanto a ${esc(g.nome)}">
      <span class="comp-n">${esc(c.q.nome)}<small>${esc(nomeSq(c.q.sq))}</small></span>
      <b>+${fmt(c.d, 2)}<small>pt/g</small></b>
      <span class="comp-d"><span><i class="c fl-f"></i>${c.a.facile}/${c.a.partite}</span><span>voto ${c.a.voto}</span><span>${c.p} cr</span></span>
      ${nota ? `<span class="comp-t">${nota}</span>` : ""}</button>`;
  const riga = (c) => `<tr data-riga="${c.q.id}" class="${c.q === scelto ? "sel" : ""}">
      <td class="l nm"><button data-open="${c.q.id}">${esc(c.q.nome)}</button>${c.mio ? '<span class="tag own">IN ROSA</span>' : ""}</td>
      <td class="l sq hide-s">${esc(nomeSq(c.q.sq))}</td>
      <td>${c.a.facile}/${c.a.partite}</td>
      <td class="hide-s">${c.a.voto}</td>
      <td class="big">+${fmt(c.d, 2)}</td>
      <td>${c.p}</td>
      <td><button class="btn small" data-abb="${c.q.id}" aria-pressed="${c.q === scelto}">Griglia</button></td></tr>`;
  const gruppo = (titolo, l) => (l.length ? `<tr class="gruppo"><td class="l" colspan="7">${titolo}</td></tr>${l.map(riga).join("")}` : "");
  const tabella = lista.length ? pannello("pan-comp", `<div class="scorri"><table class="compagni">
      <thead><tr><th class="l">Da alternare con</th><th class="l hide-s">Squadra</th><th title="Giornate in cui almeno uno dei due ha una partita facile">Facili</th><th class="hide-s" title="Voto FantaLab dell'abbinamento, 0-100">Voto</th><th title="Punti a giornata in più schierando ogni turno chi ha la partita migliore">+Pt/g</th><th title="Prezzo atteso, o pagato se è già tuo">Cr</th><th></th></tr></thead>
      <tbody>${gruppo("Già nella tua rosa", miei)}${gruppo("I migliori", top)}${gruppo(`Low cost, fino a ${soglia} crediti`, low)}</tbody>
    </table></div>
    <p class="lbl">+Pt/g: quanto rende in più la coppia se ogni giornata schieri il ${chi} con la partita migliore, rispetto a ${esc(g.nome)} sempre in campo. Il costruttore della rosa fa lo stesso conto su tutto il reparto. Il nome apre la scheda del compagno.</p>`) : "";

  return sezione("abb", "calendario", "Griglia abbinamenti",
    `${gc[0]}ª–${gc[gc.length - 1]}ª giornata${DATA.fantalab?.letto_il ? `, fasce FantaLab del ${dataIt(DATA.fantalab.letto_il).slice(0, 5)}` : ""}`,
    `<div class="boxes">${solo.join("")}</div>
    ${carte.length ? `<div class="sez-sub">${ico("persone")}Da alternare con</div>
    <div class="comps">${carte.map(carta).join("")}
      <button type="button" class="comp apre" data-espandi="pan-comp" aria-expanded="false" aria-controls="pan-comp">
        <span class="comp-n">Tutti i compagni</span><span class="comp-d">migliori, low cost e già in rosa, in tabella</span><span class="box-chev">${ico("giu")}</span></button>
    </div>${tabella}` : `<p class="lbl">Nessun compagno disponibile con cui alternarlo.</p>`}
    <div class="griglia-box" id="griglia-abb">${griglia(g, scelto)}</div>
    <p class="leg"><span><i class="c fl-f"></i>facile</span><span><i class="c fl-m"></i>media</span><span><i class="c fl-d"></i>difficile</span>
      <span><b>ABC</b> in casa, <b>abc</b> fuori</span><span><i class="c fl-f off"></i>gioca l'altro</span><span><i class="c out"></i>infortunato o squalificato</span></p>`);
}

// Sotto portieri e attaccanti della rosa: quanto copre il reparto, giornata per giornata.
function notaReparto(r, gs) {
  if (!PER_GIORNATA[r] || gs.length < 2 || gs.some((g) => !g.v)) return "";
  if (r === "P") {
    const a = abbinamento(gs, "P");
    const primo = gs.reduce((x, y) => (y.pg > x.pg ? y : x));
    return `<p class="nota reparto">Alternanza: in <b>${a.facile}/${a.partite}</b> giornate almeno un portiere affronta una squadra facile (voto FantaLab ${a.voto}). Schierando ogni turno chi ha la partita migliore fai <b>${fmt(a.pg, 2)}</b> pt/g, ${fmt(a.pg - primo.pg, 2)} in piu' che con ${esc(primo.nome)} sempre in campo.</p>`;
  }
  // Attaccanti: quanti hanno una partita facile ogni giornata.
  let facili = 0, dueOPiu = 0;
  for (let k = 0; k < NG; k++) {
    const n = gs.filter((g) => { const c = CAL[g.sq]?.[k]; return c && fasciaFL(c.avv, "A") === "facile"; }).length;
    facili += n; if (n >= 2) dueOPiu++;
  }
  return `<p class="nota reparto">Alternanza: in media <b>${fmt(facili / NG, 1)}</b> attaccanti su ${gs.length} con una partita facile a giornata; almeno due in <b>${dueOPiu}/${NG}</b> giornate. Il costruttore conta i punti giornata per giornata, quindi premia chi si copre a vicenda.</p>`;
}

function mostraAbbinamento(id) {
  const g = BY_ID.get(SCHEDA.id), q = BY_ID.get(id);
  if (!g || !q) return;
  SCHEDA.abb = id;
  const box = document.getElementById("griglia-abb");
  if (box) box.innerHTML = griglia(g, q);
  document.querySelectorAll("table.compagni tr[data-riga]").forEach((tr) => tr.classList.toggle("sel", +tr.dataset.riga === id));
  document.querySelectorAll(".dialog [data-abb]").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.abb === id)));
}

// Quanti slot per ruolo riempire a 1 credito nella modalita' "top + 1 credito":
// terzo portiere, ultimi tre difensori, ultimi tre centrocampisti, ultimi due
// attaccanti. Con i crediti risparmiati il resto della rosa punta sui migliori.
const QUOTA_UNO = { P: 1, D: 3, C: 3, A: 2 };

function ottimizza() {
  if (S.modo !== "top") return ottimizzaCon({});

  // Chi hai gia' preso a 1 credito conta nella quota del suo ruolo.
  const m = mia(), slot = META.slot;
  const esclusi = new Set([...Object.keys(m).map(Number), ...Object.keys(S.presi).map(Number)]);
  const sq = contaSquadre(Object.keys(m));
  const pre = [];
  for (const r of RUOLI) {
    const miei = Object.entries(m).filter(([id]) => BY_ID.get(+id)?.r === r);
    const giaUno = miei.filter(([, pz]) => +pz <= 1).length;
    let k = Math.min(QUOTA_UNO[r] - giaUno, slot[r] - miei.length);
    // I migliori che dovrebbero andare via al prezzo minimo.
    const cand = DATA.giocatori.filter((g) => g.r === r && !esclusi.has(g.id) && prezzoAtteso(g) === 1)
      .sort((x, y) => y.pg - x.pg);
    for (const g of cand) {
      if (k <= 0) break;
      if (!(S.esenzioneP && r === "P") && (sq[g.sq] || 0) >= S.tetto) continue;
      pre.push({ g, p: 1, uno: true }); k--;
      if (!(S.esenzioneP && r === "P")) sq[g.sq] = (sq[g.sq] || 0) + 1;
    }
  }

  const res = ottimizzaCon(Object.fromEntries(pre.map((c) => [c.g.id, 1])));
  if (res.errore) return res;

  // Alternative per gli slot da 1 credito: altri giocatori da 1 credito.
  const ids = new Set([...res.ids, ...pre.map((c) => c.g.id)]);
  const sqTot = contaSquadre([...Object.keys(m), ...ids]);
  for (const c of pre) {
    res.alt[c.g.id] = DATA.giocatori
      .filter((g) => g.r === c.g.r && !esclusi.has(g.id) && !ids.has(g.id) && prezzoAtteso(g) === 1 &&
        (g.sq === c.g.sq || (S.esenzioneP && g.r === "P") || (sqTot[g.sq] || 0) < S.tetto))
      .sort((x, y) => y.pg - x.pg).slice(0, 5)
      .map((g) => ({ c: { g, p: 1 }, d: 0 }));
  }
  return { ...res, ids, lista: [...pre, ...res.lista], costo: res.costo + pre.length };
}

// --- rendering del listone -----------------------------------------------------------
function confronta(a, b) {
  const k = S.sort.k, d = S.sort.dir, x = a[k], y = b[k];
  // Fascia: l'indice 0 e' la migliore, e chi non ha fascia sta sempre in fondo,
  // qualunque sia il verso dell'ordinamento.
  if (k === "fa") return x == null || y == null ? (x == null) - (y == null) : d * (x - y);
  if (typeof x === "string") return d * x.localeCompare(y);
  return d * ((x ?? -1e9) - (y ?? -1e9));
}

// Posizione di ogni giocatore nell'ordinamento corrente. Si calcola su tutto il
// listone del ruolo selezionato, ignorando ricerca, squadra, prezzo e presi:
// cercando un nome si vede dove sta davvero, non "1 di 1". A parita' di valore
// la posizione e' la stessa (1, 2, 2, 4).
function posizioni() {
  const l = DATA.giocatori.filter((g) => !S.f.r || g.r === S.f.r).sort(confronta);
  const pos = new Map();
  let prec = null, rango = 0;
  l.forEach((g, i) => {
    if (prec === null || confronta(prec, g) !== 0) rango = i + 1;
    pos.set(g.id, rango); prec = g;
  });
  return { pos, tot: l.length };
}

function filtrati() {
  const q = S.f.q.trim().toLowerCase();
  let l = DATA.giocatori.filter((g) =>
    (!S.f.r || g.r === S.f.r) && (!S.f.sq || g.sq === S.f.sq) &&
    (!q || g.nome.toLowerCase().includes(q)) &&
    (!S.f.pmax || prezzoAtteso(g) <= S.f.pmax) &&
    (!S.f.hide || !S.presi[g.id]) && filtroSalute(g, S.f.salute));
  l.sort(confronta);
  return l;
}

// Fascia della guida all'asta di SOS Fanta, in una pill col suo colore: [tonalita', quanta
// saturazione (1 = piena), colore del testo se la pill e' piena]. Dall'oro dei top ai verdi e
// azzurri delle fasce alte, ai blu spenti di chi costa poco; viola per i jolly, rosa per le
// scommesse, arancio e rosso per i rischi. Una fascia nuova di SOS Fanta resta grigia.
const FASCIA_COL = {
  "Super top": "#f5b700", "Top": "#e07b00", "Semitop": "#84cc16", "Sotto ai semitop": "#16a34a",
  "Fascia alta": "#0d9488", "Fascia media": "#2563eb", "Sopra ai low cost": "#6366f1",
  "Low cost 1ª fascia": "#8fa0b8", "Low cost 2ª fascia": "#64748b", "Leghe numerose": "#b9c2cf",
  "Jolly 1ª fascia": "#a855f7", "Jolly 2ª fascia": "#d946ef", "Jolly 3ª fascia": "#ec4899", "Jolly 4ª fascia": "#fb7185",
  "Possibili sorprese": "#06b6d4", "Scommesse": "#a16207", "A rischio": "#c2410c", "Da evitare": "#dc2626",
};
const coloreFascia = (nome) => FASCIA_COL[nome] || "#8a8f98";
// Il pallino della fascia. Nel listone senza fascia resta un punto spento (la colonna non si sfalsa);
// altrove (scheda, rosa) senza fascia non si mostra niente. Gli abbinamenti stimati hanno il pallino vuoto.
function dotFascia(g, vuoto = false) {
  if (g.fa == null) return vuoto ? '<span class="fd no" tabindex="0" role="img" aria-label="Fascia non indicata" data-fa=""></span>' : "";
  const nome = META.fasce[g.fa];
  return `<span class="fd${g.fi ? " est" : ""}" style="--c:${coloreFascia(nome)}" tabindex="0" role="img" aria-label="Fascia: ${esc(nome)}${g.fi ? " (stimata)" : ""}" data-fa="${g.fa}"${g.fi ? ' data-fi="1"' : ""}></span>`;
}
// Legenda al passaggio del mouse (o al tocco, o con la tastiera): tutte le fasce con la sua evidenziata.
const LEG = document.createElement("div");
LEG.id = "legenda-fasce"; LEG.hidden = true; LEG.setAttribute("role", "tooltip");
document.body.appendChild(LEG);
function mostraLegenda(el) {
  const i = el.dataset.fa === "" ? null : +el.dataset.fa, stimata = el.dataset.fi === "1";
  LEG.innerHTML = `<b>Fascia · guida SOS Fanta</b>` + META.fasce.map((n, k) =>
    `<div class="${k === i ? "on" : ""}"><i style="--c:${coloreFascia(n)}"></i>${esc(n)}</div>`).join("")
    + (i == null ? "<small>La guida non classifica questo giocatore.</small>"
      : stimata ? "<small>Fascia stimata da noi: SOS Fanta lo segna fra gli infortunati, quindi la ricaviamo confrontandolo con i giocatori dello stesso ruolo per prezzo e punti attesi.</small>" : "");
  LEG.hidden = false;
  const r = el.getBoundingClientRect(), w = LEG.offsetWidth, h = LEG.offsetHeight;
  LEG.style.left = Math.max(8, Math.min(r.right + 10, innerWidth - w - 8)) + "px";
  LEG.style.top = Math.max(8, Math.min(r.top - 28, innerHeight - h - 8)) + "px";
}
const nascondiLegenda = () => { LEG.hidden = true; };
const alDot = (e) => e.target.closest && e.target.closest(".fd");
document.addEventListener("mouseover", (e) => { const d = alDot(e); if (d) mostraLegenda(d); });
document.addEventListener("mouseout", (e) => { if (alDot(e)) nascondiLegenda(); });
document.addEventListener("focusin", (e) => { const d = alDot(e); if (d) mostraLegenda(d); });
document.addEventListener("focusout", (e) => { if (alDot(e)) nascondiLegenda(); });
document.addEventListener("click", (e) => { const d = alDot(e); if (d) mostraLegenda(d); else nascondiLegenda(); });
document.addEventListener("scroll", nascondiLegenda, true);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") nascondiLegenda(); });

// --- infortuni ------------------------------------------------------------------
// g.inf: chi e' fermo adesso (t tipo, m motivo, g giornata e d data di rientro, s giornate che
// salta, fs stagione finita). g.fr: propensione dallo storico (l livello, n stop, mu muscolari,
// gg giorni e pp partite perse a stagione, e gli ultimi stop). Senza g.fr non c'e' storico.
const MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
const dataBreve = (iso) => { if (!iso) return ""; const [, m, d] = iso.split("-"); return `${+d} ${MESI[+m - 1]}`; };
// Fuori = salta almeno una delle giornate da giocare. "In dubbio per la prossima" non e' fuori:
// e' un dubbio, e va trattato come tale.
const fuori = (g) => !!g.inf && (g.inf.t === "infortunato" || g.inf.t === "squalificato") && (g.inf.s > 0 || g.inf.fs);
const fragile = (g) => !!g.fr && g.fr.l === "alta";
const aRischio = (g) => !!g.fr && g.fr.l === "media";

function rientro(i) {
  if (i.fs) return "stagione finita";
  if (i.g) return `rientro ${i.g}a${i.d ? " · " + dataBreve(i.d) : ""}`;
  if (i.d) return `rientro ~${dataBreve(i.d)}`;
  return "rientro non indicato";
}

function titoloInf(g) {
  const i = g.inf, parti = [i.t === "acciaccato" ? "Acciaccato (solo Transfermarkt)" : i.t[0].toUpperCase() + i.t.slice(1)];
  if (i.t === "infortunato" || i.t === "squalificato") parti.push(rientro(i));
  if (i.s > 0) parti.push(`salta ${i.s} ${i.s === 1 ? "giornata" : "giornate"}`);
  return parti.join(" · ") + (i.m ? ". " + i.m : "");
}

function titoloFr(g) {
  const f = g.fr;
  return `${f.l === "alta" ? "Fragile" : "Delicato"}: ${f.n} stop dalla 23/24` +
    (f.mu ? `, ${f.mu} muscolari` : "") + (f.gr ? `, ${f.gr} gravi` : "") +
    `; ~${fmt(f.gg, 0)} giorni e ~${fmt(f.pp, 0)} partite perse a stagione`;
}

function tagSalute(g) {
  let t = "";
  if (g.inf) {
    const i = g.inf;
    const out = fuori(g);
    const testo = i.t === "diffidato" ? "DIFFIDATO" : !out ? "IN DUBBIO"
      : i.t === "squalificato" ? "SQUALIFICATO" : i.fs ? "OUT STAGIONE" : i.g ? `OUT → ${i.g}a` : "OUT";
    const cls = out ? "out" : "dubbio";
    t += `<span class="tag ${cls}" title="${esc(titoloInf(g))}">${testo}</span>`;
  }
  if (fragile(g)) t += `<span class="tag fragile" title="${esc(titoloFr(g))}">FRAGILE</span>`;
  else if (aRischio(g)) t += `<span class="tag rischio" title="${esc(titoloFr(g))}">DELICATO</span>`;
  return t;
}

function filtroSalute(g, f) {
  if (!f) return true;
  if (f === "disponibili") return !fuori(g);
  if (f === "sani") return !fuori(g) && !fragile(g) && !aRischio(g);
  if (f === "fuori") return fuori(g);
  if (f === "fragili") return fragile(g) || aRischio(g);
  return true;
}

function tag(g) {
  let t = "";
  if ((g.qrig || 0) >= 0.4) t += '<span class="tag rig" title="Rigorista: calcia la maggior parte dei rigori della squadra">RIG</span>';
  if ((g.tifo || 1) > 1) t += '<span class="tag tifo" title="Prezzo atteso maggiorato: squadra con molti tifosi in lega">TIFO</span>';
  return t + tagSalute(g);
}

// Sezione della scheda: come sta adesso, poi la propensione che viene dallo storico. L'elenco
// degli stop resta chiuso: lo apre il riquadro che li conta.
function sezioneInfortuni(g) {
  const fonti = META.infortuni || {}, i = g.inf, f = g.fr;
  const riquadri = [];
  let nota = "", elenco = "";
  if (!i) riquadri.push(box({ v: "Disponibile", l: "adesso", ic: "ok", tono: "ok", cls: "parola" }));
  else {
    const out = fuori(g), fermo = i.t === "infortunato" || i.t === "squalificato";
    const v = i.fs ? "Stagione finita" : i.t === "squalificato" ? "Squalificato" : i.t === "diffidato" ? "Diffidato"
      : i.t === "acciaccato" ? "Acciaccato" : out ? "Fuori" : "In dubbio";
    const righe = [fermo && !i.fs ? rientro(i) : "", i.s > 0 ? `salta ${i.s} ${i.s === 1 ? "giornata" : "giornate"}` : "", i.m || ""].filter(Boolean);
    riquadri.push(box({ v, l: "adesso", ic: out ? "no" : "allerta", tono: out ? "ko" : "med", cls: "parola largo", sub: righe.map(esc).join("<br>") }));
    if (fermo && i.s > 0 && g.pgs != null) nota = `Da sano farebbe ${fmt(g.pgs, 2)} punti a giornata: le giornate che salta sono già tolte dai punti attesi e dal valore.`;
    if (i.t === "acciaccato") nota = "Segnalato solo da Transfermarkt, senza data di rientro: di solito è un acciacco di pochi giorni, i punti attesi non lo scontano.";
  }
  const origine = `Indisponibili: SosFanta ${dataIt(fonti.sosfanta)}, Transfermarkt ${dataIt(fonti.transfermarkt)}. Storico Transfermarkt; malattie e stop sotto i 10 giorni senza partite perse non contano.`;
  if (!f) {
    riquadri.push(box({ v: "Senza storico", l: "propensione agli infortuni", ic: "polso", cls: "parola largo",
      sub: `Transfermarkt non lo ha nella rosa di ${esc(nomeSq(g.sq))}` }));
  } else {
    const [nome, tono] = f.l === "alta" ? ["Fragile", "ko"] : f.l === "media" ? ["Delicato", "med"] : ["Bassa", "ok"];
    riquadri.push(box({ v: nome, l: "propensione agli infortuni", ic: "polso", tono, cls: "parola",
      title: "È un avviso: lo storico delle presenze è già nella probabilità di voto" }));
    if (!f.n) riquadri.push(box({ v: "0", l: "stop dalla 23/24", ic: "croce" }));
    else {
      riquadri.push(box({ v: f.n, l: "stop dalla 23/24", ic: "croce", apre: "pan-inf", title: "Apri l'elenco degli stop",
        sub: [f.mu ? `${f.mu} muscolari` : "", f.gr ? `${f.gr} gravi` : ""].filter(Boolean).join(", ") }));
      riquadri.push(box({ v: fmt(f.gg, 0), l: "giorni fuori a stagione", ic: "orologio" }));
      riquadri.push(box({ v: fmt(f.pp, 0), l: "partite perse a stagione", ic: "no" }));
      elenco = pannello("pan-inf", `<div class="scorri"><table class="inf-st">
          <thead><tr><th class="l">Stag.</th><th class="l">Infortunio</th><th>Giorni</th><th>Partite</th></tr></thead>
          <tbody>${f.e.map(([st, t, c, gg, pp]) => `<tr><td class="l">${st}</td><td class="l ${c === "grave" ? "neg" : c === "muscolare" ? "musc" : ""}">${esc(t)}</td><td>${gg ?? "–"}</td><td>${pp}</td></tr>`).join("")}</tbody>
        </table></div>
        ${f.n > f.e.length ? `<p class="lbl">e altri ${f.n - f.e.length} stop.</p>` : ""}
        <p class="lbl">${origine} La propensione è un avviso: lo storico delle presenze è già nella probabilità di voto.</p>`);
    }
  }
  return sezione("inf", "croce", "Infortuni", `<span title="${esc(origine)}">aggiornati al ${dataIt(fonti.sosfanta).slice(0, 5)}</span>`,
    `<div class="boxes">${riquadri.join("")}</div>${nota ? `<p class="nota">${nota}</p>` : ""}${elenco}`);
}

function renderListone() {
  const l = filtrati();
  const { pos, tot } = posizioni();
  const m = mia();
  $("#count").textContent = `${l.length} giocatori`;
  const nEscl = Object.keys(S.presi).length;
  $("#hide-lbl").textContent = inAsta() ? `Nascondi i presi (${nEscl})` : nEscl ? `Nascondi gli esclusi (${nEscl})` : "Nascondi gli esclusi";
  const out = [];
  for (const g of l) {
    const cls = m[g.id] != null ? "mine" : S.presi[g.id] ? "taken" : SUGG.ids.has(g.id) ? "sugg" : "";
    const own = inAsta() && OWNER.has(g.id) ? `<span class="tag own">${esc(S.asta.squadre[OWNER.get(g.id)].nome)}</span>` : "";
    const obj = inAsta() && S.asta.obiettivi.includes(g.id) && !OWNER.has(g.id) ? '<span class="tag obj" title="Era nel piano da cui sei partito">OBIETTIVO</span>' : "";
    const azioni = inAsta()
      ? (OWNER.has(g.id) ? "" : `<button class="btn small" data-chiama="${g.id}" title="Apri nel pannello dell'asta">Chiama</button>`)
      : `<button class="ic ${m[g.id] != null ? "on" : ""}" data-add="${g.id}" title="${m[g.id] != null ? "Togli dalla mia rosa" : "Metti nella mia rosa"}" aria-label="Mia rosa">${m[g.id] != null ? "✓" : "+"}</button>
        <button class="ic ${S.presi[g.id] ? "on" : ""}" data-taken="${g.id}" title="${S.presi[g.id] ? "Rimetti fra i disponibili" : "Escludi dai suggerimenti (non lo voglio, o lo do per perso)"}" aria-label="Escludi">✕</button>`;
    const aff = g.aff ?? 0;
    out.push(`<tr class="${cls}" data-id="${g.id}">
      <td class="rank" title="${pos.get(g.id)}° su ${tot}">${pos.get(g.id)}</td>
      <td class="l"><span class="role ${g.r}">${g.r}</span></td>
      <td class="f">${dotFascia(g, true)}</td>
      <td class="l nm"><button data-open="${g.id}">${esc(g.nome)}</button>${tag(g)}${obj}${own}</td>
      <td class="l sq hide-s">${esc(nomeSq(g.sq))}</td>
      <td class="big">${fmt(g.pg, 2)}</td>
      <td class="hide-s">${fmt(g.fm, 2)}</td>
      <td class="hide-s">${pct(g.pv)}</td>
      <td class="hide-s">${fmt(g.qa, 0)}</td>
      <td>${fmt(g.val, 0)}</td>
      <td class="big">${prezzoAtteso(g)}</td>
      <td class="${aff > 0 ? "pos" : aff < 0 ? "neg" : ""}">${segno(aff)}</td>
      <td class="act">${azioni}</td></tr>`);
  }
  $("#rows").innerHTML = out.join("") || '<tr><td colspan="13" class="l loading">Nessun giocatore con questi filtri.</td></tr>';
  document.querySelectorAll("th[data-k]").forEach((th) => {
    th.classList.toggle("sorted", th.dataset.k === S.sort.k);
    th.classList.toggle("asc", th.dataset.k === S.sort.k && S.sort.dir === 1);
  });
}

// --- rendering della rosa ------------------------------------------------------------
function renderBudget() {
  const m = mia(), speso = Object.values(m).reduce((a, p) => a + +p, 0);
  const n = Object.keys(m).length, tot = RUOLI.reduce((a, r) => a + META.slot[r], 0);
  const resto = META.crediti - speso, max = resto - Math.max(0, tot - n - 1);
  const a = inAsta();
  let liberi = "";
  if (a) {
    const k = { P: 0, D: 0, C: 0, A: 0 };
    for (const id of Object.keys(m)) { const g = BY_ID.get(+id); if (g) k[g.r]++; }
    liberi = `<div class="stat"><b class="lib-r">${RUOLI.map((r) => `<span style="color:var(--r-${r.toLowerCase()})" title="${NOMI_RUOLO[r]} da prendere">${META.slot[r] - k[r]}</span>`).join("")}</b><small><span class="solo-desk">Slot liberi </span>P·D·C·A</small></div>`;
  }
  $("#budget").innerHTML = `
    <div class="stat"><b>${cr(resto, META.crediti)}</b><small>${a ? '<span class="solo-desk">I tuoi </span>crediti' : "Crediti liberi"}</small></div>
    <div class="stat${max < 1 ? " warn" : ""}"><b>${cr(Math.max(0, max), META.crediti - tot + 1)}</b><small>${a ? '<span class="solo-desk">La tua </span>offerta max' : "Offerta massima"}</small></div>
    <div class="stat"><b>${n}/${tot}</b><small>${a ? '<span class="solo-desk">La tua </span>rosa' : "Giocatori"}</small></div>${liberi}`;
}

function renderRosa() {
  const m = mia();
  const scelti = Object.entries(m).map(([id, p]) => ({ g: BY_ID.get(+id), p: +p })).filter((x) => x.g);
  const speso = scelti.reduce((a, x) => a + x.p, 0);
  const tutti = [...scelti.map((x) => ({ ...x, s: false })), ...SUGG.lista.map((c) => ({ g: c.g, p: c.p, s: true }))];

  // barra del budget per ruolo: pieno = scelti, tratteggiato = suggeriti
  const segs = [];
  for (const r of RUOLI) {
    const a = tutti.filter((x) => x.g.r === r && !x.s).reduce((s, x) => s + x.p, 0);
    const b = tutti.filter((x) => x.g.r === r && x.s).reduce((s, x) => s + x.p, 0);
    if (a) segs.push(`<i class="${r}" style="width:${(a / META.crediti) * 100}%"></i>`);
    if (b) segs.push(`<i class="${r} s" style="width:${(b / META.crediti) * 100}%"></i>`);
  }
  const spesaR = (r) => tutti.filter((x) => x.g.r === r).reduce((s, x) => s + x.p, 0);
  const tot = speso + SUGG.costo;
  // L'etichetta mostra tutti i giocatori della squadra; il colore segue il
  // conteggio che vale per il tetto (senza portieri se il blocco e' libero).
  const nTot = {};
  for (const x of tutti) nTot[x.g.sq] = (nTot[x.g.sq] || 0) + 1;
  const sq = contaSquadre(tutti.map((x) => x.g.id));
  const chips = Object.entries(nTot).sort((a, b) => b[1] - a[1]).map(([s, n]) => {
    const c = sq[s] || 0, np = n - c;
    return `<span class="chip ${c > S.tetto ? "over" : c === S.tetto ? "full" : ""}" title="${np ? `${np} portier${np > 1 ? "i" : "e"}, fuori dal tetto` : ""}">${esc(nomeSq(s))} ${n}${np && S.esenzioneP ? ` <small>(${np}P)</small>` : ""}</span>`;
  }).join("");

  let h = `<div class="card">
    <div class="row" style="justify-content:space-between">
      <h2>La mia rosa</h2>
      ${inAsta() ? `<span class="live"><span class="dot"></span>Rosa reale</span>` : `<div class="seg" id="piani" role="group" aria-label="Piano">${["A", "B", "C"].map((p) =>
        `<button data-piano="${p}" aria-pressed="${S.piano === p}">Piano ${p}</button>`).join("")}</div>`}
    </div>
    <div class="row" style="margin-top:10px"><div class="bar" style="flex:1">${segs.join("")}</div></div>
    <div class="legend">${RUOLI.map((r) => `<span>${NOMI_RUOLO[r]} <b>${spesaR(r)}</b>${S.budgetRuolo ? ` / ${S.budgetRuolo[r]}` : ""}</span>`).join("")}
      <span>Totale <b>${tot}</b> / ${META.crediti}</span>
      <span>Forza attesa <b>${fmt(SUGG.forza + 0, 1)}</b> pt/g</span></div>
    ${SUGG.errore ? `<p class="alert">${esc(SUGG.errore)}</p>` : ""}
    <div class="row lega" style="margin-top:10px">
      <span class="lbl">Lega</span>
      <label class="bud"><span class="lbl">Squadre</span><input id="nsq" type="number" min="${LEGA_LIM.n[0]}" max="${LEGA_LIM.n[1]}" value="${META.n_squadre}" ${inAsta() ? "disabled" : ""} aria-label="Numero di squadre"></label>
      <label class="bud"><span class="lbl">Crediti</span><input id="cred" type="number" min="${LEGA_LIM.cr[0]}" max="${LEGA_LIM.cr[1]}" step="10" value="${META.crediti}" ${inAsta() ? "disabled" : ""} aria-label="Crediti a squadra"></label>
      ${legaCambiata() && !inAsta() ? `<button class="btn small" id="lega-reset" title="Torna a ${LEGA0.n} squadre e ${LEGA0.cr} crediti">Ripristina</button>` : ""}
    </div>
    ${legaCambiata() ? `<p class="nota" style="margin-top:8px">Valori e prezzi ricalcolati per ${META.n_squadre} squadre e ${META.crediti} crediti. Le proiezioni in punti non dipendono dalla lega.</p>` : ""}
    <div class="row" style="margin-top:10px">
      <span class="lbl">Strategia</span>
      <div class="seg mini" id="modo" role="group" aria-label="Strategia">
        <button data-modo="omogenea" aria-pressed="${S.modo !== "top"}" title="Budget distribuito dove rende di piu', su tutta la rosa">Omogenea</button>
        <button data-modo="top" aria-pressed="${S.modo === "top"}" title="Ultimi slot a 1 credito (1 P, 3 D, 3 C, 2 A) e il resto sui migliori">Top + 1 cr</button>
      </div>
    </div>
    <div class="row" style="margin-top:10px">
      <span class="lbl">Budget per ruolo</span>
      <div class="seg mini" role="group" aria-label="Budget per ruolo">
        <button data-bud="auto" aria-pressed="${!S.budgetRuolo}" title="L'algoritmo divide i crediti fra i ruoli">Automatico</button>
        <button data-bud="man" aria-pressed="${!!S.budgetRuolo}" title="Decidi tu quanti crediti per ruolo">Manuale</button>
      </div>
    </div>
    ${S.budgetRuolo ? `<div class="row budgets" style="margin-top:8px">${RUOLI.map((r) => `
      <label class="bud"><span class="role ${r}">${r}</span><input id="bud-${r}" type="number" min="0" max="${META.crediti}" value="${S.budgetRuolo[r]}" aria-label="Crediti ${NOMI_RUOLO[r].toLowerCase()}"></label>`).join("")}
      <span class="lbl ${RUOLI.reduce((a, r) => a + (+S.budgetRuolo[r] || 0), 0) > META.crediti ? "alert" : ""}">Somma ${RUOLI.reduce((a, r) => a + (+S.budgetRuolo[r] || 0), 0)} / ${META.crediti}</span></div>` : ""}
    <div class="row" style="margin-top:10px">
      <label class="lbl" for="margine">Margine sui prezzi</label>
      <select id="margine" class="pill">${[0, 0.1, 0.2, 0.3].map((x) => `<option value="${x}" ${x === S.margine ? "selected" : ""}>+${x * 100}%</option>`).join("")}</select>
      <label class="lbl" for="tetto">Max per squadra</label>
      <select id="tetto" class="pill">${[2, 3, 4, 5].map((x) => `<option ${x === S.tetto ? "selected" : ""}>${x}</option>`).join("")}</select>
      <label class="check"><input id="esenzione" type="checkbox" ${S.esenzioneP ? "checked" : ""}> Blocco portieri libero</label>
    </div>
    ${chips ? `<div class="squadre-box"><span class="lbl">Giocatori per squadra</span><div class="squadre">${chips}</div></div>` : ""}
    <div class="row azioni">
      ${inAsta() ? "" : `<button class="btn small" id="svuota">Svuota il piano</button>
      <button class="btn small" id="esporta">Esporta</button>
      <button class="btn small" id="importa">Importa</button>`}
    </div>
  </div>`;

  h += campo(tutti);

  for (const r of RUOLI) {
    const miei = scelti.filter((x) => x.g.r === r).sort((a, b) => b.g.pg - a.g.pg);
    const sug = SUGG.lista.filter((c) => c.g.r === r).sort((a, b) => b.g.pg - a.g.pg);
    const vuoti = Math.max(0, META.slot[r] - miei.length - sug.length);
    h += `<div class="card"><div class="ruolo-h"><span class="role ${r}">${r}</span><h3>${NOMI_RUOLO[r]}</h3>
      <span class="lbl">${miei.length} scelti · ${sug.length} suggeriti · ${spesaR(r)}${S.budgetRuolo ? ` / ${S.budgetRuolo[r]}` : ""} crediti</span></div>`;
    for (const x of miei) {
      h += `<div class="slot"><span class="role ${r}">${r}</span>
        <span class="who">${dotFascia(x.g)}<b>${esc(x.g.nome)}</b><small>${esc(nomeSq(x.g.sq))}</small></span>
        <span class="num"><b>${fmt(x.g.pg, 2)}</b> pt/g</span>
        <span class="num"><b>${x.p}</b> cr</span>
        <button class="ic" data-add="${x.g.id}" title="Togli dalla rosa" aria-label="Togli">−</button></div>`;
    }
    for (const c of sug) {
      const aperta = S.aperte[c.g.id];
      h += `<div class="slot sugg"><span class="role ${r}">${r}</span>
        <span class="who">${dotFascia(c.g)}<button class="ic" style="width:auto;padding:0 6px;border:0;background:none;color:inherit" data-open="${c.g.id}"><b>${esc(c.g.nome)}</b></button>${tagSalute(c.g)}<small>${esc(nomeSq(c.g.sq))}</small>${c.uno ? '<span class="tag uno" title="Slot riservato a un giocatore da 1 credito">1 CR</span>' : ""}</span>
        <span class="num"><b>${fmt(c.g.pg, 2)}</b> pt/g</span>
        <span class="num"><b>${c.p}</b> cr</span>
        <span class="row" style="gap:4px;flex-wrap:nowrap">
          <button class="btn small" data-prendi="${c.g.id}" title="Mettilo nella mia rosa a questo prezzo">Scegli</button>
          <button class="btn small" data-alt="${c.g.id}" aria-expanded="${!!aperta}">${aperta ? "Chiudi" : "Altri"}</button>
        </span>
        ${aperta ? `<div class="alts">${(SUGG.alt[c.g.id] || []).map((a) => `<div>
            <span class="n">${dotFascia(a.c.g)}<b>${esc(a.c.g.nome)}</b> <small style="text-transform:capitalize">${esc(nomeSq(a.c.g.sq))}</small></span>
            <span>${fmt(a.c.g.pg, 2)} pt/g</span><span><b>${a.c.p}</b> cr</span>
            <button class="btn small" data-prendi="${a.c.g.id}">Scegli</button></div>`).join("") || "<span class='lbl'>Nessuna alternativa nel budget.</span>"}</div>` : ""}
      </div>`;
    }
    for (let i = 0; i < vuoti; i++) h += `<div class="slot"><span class="role ${r}">${r}</span><span class="empty">slot libero</span></div>`;
    h += notaReparto(r, [...miei, ...sug].map((x) => x.g)) + `</div>`;
  }

  h += `<div class="card"><details class="help"><summary>Come leggere i numeri</summary>
    <p><b>Pt/g</b> sono i punti attesi a giornata: probabilita' di prendere voto per fantavoto atteso, sulle ${META.giornate_residue} giornate che restano. Per portieri e difensori include la quota del modificatore difesa.</p>
    <p><b>Valore</b> e' quanto vale il giocatore per noi in crediti, rispetto a chi potresti prendere al suo posto. <b>Prezzo</b> e' quanto costera' presumibilmente nella nostra asta, tarato sui ${META.crediti * META.n_squadre} crediti della lega e maggiorato per Roma e Lazio. <b>Affare</b> e' la differenza.</p>
    <p>I suggerimenti evidenziati completano la rosa massimizzando la forza dell'undici schierabile: i titolari pesano pieno, le riserve in base a quanto giocheranno. Usano il prezzo atteso piu' il margine scelto, e rispettano il tetto per squadra.</p>
    <p><b>Alternanza.</b> Per portieri e attaccanti i punti sono stimati partita per partita, con la difficolta' dell'avversario: il rating del modello mescolato alla fascia della griglia FantaLab (facile, media, difficile). Il costruttore rifa' la gerarchia ogni giornata, schierando chi ha la partita migliore: due portieri con calendari che si coprono valgono piu' dei loro Pt/g presi da soli. Nella scheda di ogni portiere e attaccante trovi la sua griglia e i compagni con cui si alterna meglio.</p>
    <p><b>Strategia.</b> Omogenea distribuisce i crediti dove rendono di piu' su tutta la rosa. Top + 1 credito riserva gli ultimi slot a giocatori da 1 credito (terzo portiere, ultimi tre difensori, ultimi tre centrocampisti, ultimi due attaccanti), scegliendo i migliori fra quelli che dovrebbero costare il minimo, e concentra il resto del budget sui titolari piu' forti.</p>
    <p><b>Budget per ruolo.</b> In automatico l'algoritmo divide i crediti fra i ruoli. In manuale fissi tu quanti crediti dare a portieri, difensori, centrocampisti e attaccanti (giocatori gia' scelti compresi) e il tool trova la rosa migliore dentro quei limiti.</p>
    <p>Sulle due stagioni passate il punteggio ordina i giocatori meglio della fantamedia e dei punti delle prime giornate, ma di poco. Le stelle offensive costano molto piu' di quanto il modello le valuta: e' un'indicazione, non una regola. Se vuoi una stella, sceglila e lascia che il tool ricostruisca il resto.</p>
  </details></div>`;
  $("#rosa").innerHTML = h;
}

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
  if (inAsta()) sincronizzaAsta(); else INFL = 1;
  SUGG = ottimizza();
  renderBudget(); renderListone(); renderRosa(); renderControlloAsta();
  if (inAsta()) renderAsta();
  salva();
}


// --- la formazione tipo sul campo ---------------------------------------------------------
// Gli 11 migliori della rosa (scelti + suggeriti) nel modulo che rende di piu'.
// Con la difesa a 4 o 5 si aggiunge la stima del modificatore.
const MODULI = ["3-4-3", "3-5-2", "4-3-3", "4-4-2", "4-5-1", "5-3-2", "5-4-1"];
function formazioneTipo(tutti) {
  // un giocatore gia' scelto non va contato (ne' cerchiato) anche come suggerito
  const visti = new Set(), unici = [];
  for (const x of [...tutti.filter((x) => !x.s), ...tutti.filter((x) => x.s)])
    if (!visti.has(x.g.id)) { visti.add(x.g.id); unici.push(x); }
  const per = {};
  for (const r of RUOLI) per[r] = unici.filter((x) => x.g.r === r).sort((a, b) => b.g.pg - a.g.pg);
  let best = null;
  for (const m of MODULI) {
    const [d, c, a] = m.split("-").map(Number);
    if (per.P.length < 1 || per.D.length < d || per.C.length < c || per.A.length < a) continue;
    const xi = { P: per.P.slice(0, 1), D: per.D.slice(0, d), C: per.C.slice(0, c), A: per.A.slice(0, a) };
    const tot = RUOLI.reduce((s, r) => s + xi[r].reduce((q, x) => q + x.g.pg, 0), 0) + (d >= 4 ? 1.5 : 0);
    if (!best || tot > best.tot) best = { m, xi, tot };
  }
  return best;
}

function campo(tutti) {
  const f = formazioneTipo(tutti);
  if (!f) return "";
  const W = 600, H = 340, cx = { P: 64, D: 190, C: 345, A: 500 };
  const short = (n) => (n.length > 13 ? n.slice(0, 12) + "." : n);
  const pallini = RUOLI.map((r) => {
    const l = f.xi[r], n = l.length;
    return l.map((x, i) => {
      const y = n === 1 ? H / 2 - 8 : 34 + (i * (H - 96)) / (n - 1);
      const col = { P: "var(--r-p)", D: "var(--r-d)", C: "var(--r-c)", A: "var(--r-a)" }[r];
      return `<g>
        ${x.s ? `<circle cx="${cx[r]}" cy="${y}" r="22" fill="none" stroke="var(--mark)" stroke-width="3.5"/>` : ""}
        <circle cx="${cx[r]}" cy="${y}" r="18" fill="${col}" stroke="#ffffff" stroke-width="2.5"/>
        <text x="${cx[r]}" y="${y + 5}" text-anchor="middle" font-size="13" font-weight="700" fill="#ffffff">${fmt(x.g.pg, 1)}</text>
        <text x="${cx[r]}" y="${y + 38}" text-anchor="middle" font-size="15" font-weight="700" fill="#ffffff" stroke="rgb(0 0 0 / 0.55)" stroke-width="3.5" paint-order="stroke">${esc(short(x.g.nome))}</text>
      </g>`;
    }).join("");
  }).join("");
  const strisce = Array.from({ length: 8 }, (_, i) => `<rect x="${i * 75}" y="0" width="37.5" height="${H}" fill="rgb(255 255 255 / 0.05)"/>`).join("");
  return `<details class="card campo-card" id="campo" ${S.campoChiuso ? "" : "open"}>
    <summary class="ruolo-h"><h3>Formazione tipo ${f.m}</h3><span class="lbl">${fmt(f.tot - (+f.m[0] >= 4 ? 1.5 : 0), 1)} pt/g attesi dagli 11 · cerchiati i suggeriti</span></summary>
    <div class="campo-box"><svg class="campo" viewBox="0 0 ${W} ${H}" role="img" aria-label="Formazione tipo ${f.m}">
      <rect width="${W}" height="${H}" fill="var(--grass-1)"/>${strisce}
      <g fill="none" stroke="rgb(255 255 255 / 0.55)" stroke-width="2">
        <rect x="8" y="8" width="${W - 16}" height="${H - 16}"/>
        <line x1="${W / 2}" y1="8" x2="${W / 2}" y2="${H - 8}"/>
        <circle cx="${W / 2}" cy="${H / 2}" r="42"/>
        <rect x="8" y="${H / 2 - 70}" width="70" height="140"/><rect x="8" y="${H / 2 - 32}" width="24" height="64"/>
        <rect x="${W - 78}" y="${H / 2 - 70}" width="70" height="140"/><rect x="${W - 32}" y="${H / 2 - 32}" width="24" height="64"/>
      </g>
      ${pallini}
    </svg></div>
  </details>`;
}
// --- scheda giocatore e dialoghi ----------------------------------------------------------
function chiudi() { $("#overlay").hidden = true; $("#overlay").innerHTML = ""; }
function apri(html, cls = "") { const o = $("#overlay"); o.innerHTML = `<div class="dialog ${cls}" role="dialog" aria-modal="true">${html}</div>`; o.hidden = false; const f = o.querySelector("input, button"); if (f) f.focus(); }

// Icone della scheda: tratto unico su 24x24, nel colore del testo.
const ICONE = {
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5v.2"/>',
  croce: '<path d="M9.5 3.5h5v6h6v5h-6v6h-5v-6h-6v-5h6z"/>',
  barre: '<path d="M5 20v-7M12 20V5M19 20V9"/>',
  calendario: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  sale: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  ok: '<circle cx="12" cy="12" r="9"/><path d="M8 12.4l2.7 2.7L16 9.6"/>',
  pari: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
  no: '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
  allerta: '<path d="M12 4l9 16H3z"/><path d="M12 10v4.5M12 17.3v.2"/>',
  orologio: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
  gemma: '<path d="M6.5 4h11L22 9.5 12 20.5 2 9.5z"/><path d="M2 9.5h20M9 4L7.5 9.5 12 20.5l4.5-11L15 4"/>',
  cartellino: '<path d="M20.5 13.5l-7 7a1.8 1.8 0 01-2.6 0L3 12.6V3.5h9.1l8.4 8.4a1.2 1.2 0 010 1.6z"/><path d="M7.6 8h.2"/>',
  stella: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z"/>',
  pallone: '<circle cx="12" cy="12" r="9"/><path d="M12 8.2l3.4 2.5-1.3 4H9.9l-1.3-4z"/><path d="M12 3v5.2M20.6 9.4l-5.2 1.3M17.2 19.3l-3.1-4.6M6.8 19.3l3.1-4.6M3.4 9.4l5.2 1.3"/>',
  assist: '<circle cx="5.5" cy="17.5" r="2.2"/><path d="M9 15.5C11.5 11 15 9 20 8.5"/><path d="M16.5 5l4 3.4-3.2 4"/>',
  rigore: '<path d="M3 13V5h18v8"/><path d="M12 18.4v.2" stroke-width="3.6"/>',
  cartello: '<rect x="7.5" y="3.5" width="9.5" height="15" rx="1.6" transform="rotate(10 12 11)"/>',
  porta: '<path d="M3 20V6h18v14"/><path d="M8.5 13l2.5 2.5 4.5-5"/>',
  rete: '<path d="M3 20V6h18v14"/><circle cx="12" cy="14" r="2.8"/>',
  scudo: '<path d="M12 3l8 3v6c0 4.6-3.2 7.8-8 9-4.8-1.2-8-4.4-8-9V6z"/>',
  taratura: '<path d="M4 7h9M19 7h1M4 17h1M11 17h9"/><circle cx="16" cy="7" r="2.2"/><circle cx="8" cy="17" r="2.2"/>',
  polso: '<path d="M3 12h4l2.5-6 4 12 2.5-6h5"/>',
  persone: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 5a3.2 3.2 0 010 6M18 14.4c1.8.9 3 2.9 3 5.6"/>',
  bersaglio: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12v.2" stroke-width="3"/>',
  giu: '<path d="M6 9l6 6 6-6"/>',
  uguale: '<path d="M5 9h14M5 15h14"/>',
};
const ico = (n) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICONE[n] || ""}</svg>`;

// Un riquadro: il valore in grande, sotto l'etichetta con la sua icona e un'eventuale riga di
// dettaglio. `tono` colora tutto il riquadro (ok, med, ko), solo il valore (piu, meno, zero)
// o lo mette in evidenza (eroe, tot). Con `apre` il riquadro e' un bottone che apre il
// pannello con quell'id: e' cosi' che tabelle ed elenchi restano chiusi finche' non servono.
function box({ v, l, ic = "", sub = "", tono = "", cls = "", title = "", apre = "" }) {
  const c = ["box", tono, cls, apre ? "apre" : ""].filter(Boolean).join(" ");
  const t = title ? ` title="${esc(title)}"` : "";
  const dentro = `<b>${v}</b><span class="box-l">${ic ? ico(ic) : ""}<span>${l}</span></span>${sub ? `<span class="box-s">${sub}</span>` : ""}`;
  return apre
    ? `<button type="button" class="${c}" data-espandi="${apre}" aria-expanded="false" aria-controls="${apre}"${t}>${dentro}<span class="box-chev">${ico("giu")}</span></button>`
    : `<div class="${c}"${t}>${dentro}</div>`;
}
const barra = (p, tono = "") => `<i class="barra ${tono}" style="--p:${Math.round(Math.max(0, Math.min(1, p || 0)) * 100)}%"></i>`;
const pannello = (id, html) => `<div class="pannello" id="${id}"><div><div class="pan-in">${html}</div></div></div>`;
const sezione = (id, icona, titolo, riepilogo, corpo) => `<section class="sez" aria-labelledby="sez-${id}">
    <header class="sez-h"><span class="sez-ic">${ico(icona)}</span><h4 id="sez-${id}">${titolo}</h4>${riepilogo ? `<span class="sez-r">${riepilogo}</span>` : ""}</header>
    ${corpo}</section>`;
const conSegno = (x) => (x < 0 ? "−" : "+") + fmt(Math.abs(x), 2);
const dataIt = (iso) => (iso ? iso.split("-").reverse().join("/") : "–");
const tonoQuota = (x) => (x >= 0.75 ? "ok" : x >= 0.5 ? "med" : "ko");

function espandi(btn) {
  const p = document.getElementById(btn.dataset.espandi); if (!p) return;
  const aperto = p.classList.toggle("aperto");
  btn.setAttribute("aria-expanded", String(aperto));
  // una volta aperto, il pannello deve stare tutto in vista
  if (aperto) setTimeout(() => p.scrollIntoView({ block: "nearest",
    behavior: matchMedia("(prefers-reduced-motion: no-preference)").matches ? "smooth" : "auto" }), 240);
}

// Informazioni: i numeri che decidono, poi come si arriva al fantavoto. I pezzi mostrati
// sommano al fantavoto: quello che manca e' la taratura misurata sul backtest.
function sezioneInfo(g) {
  const por = g.r === "P", r2 = (x) => Math.round((x || 0) * 100) / 100;
  const delRuolo = DATA.giocatori.filter((x) => x.r === g.r);
  const pos = 1 + delRuolo.filter((x) => x.pg > g.pg).length;
  const prezzo = prezzoAtteso(g), diff = Math.round(g.val ?? 0) - prezzo;
  const affare = `<span class="esito ${diff > 0 ? "ok" : diff < 0 ? "ko" : ""}" title="Valore meno prezzo atteso">affare ${segno(diff)}</span>`;
  const daSano = g.pgs != null && Math.abs(g.pgs - g.pg) >= 0.005 ? `da sano ${fmt(g.pgs, 2)}` : "";
  const numeri = [
    box({ v: fmt(g.pg, 2), l: "punti a giornata", ic: "sale", tono: "eroe", sub: daSano,
      title: "Probabilità di voto per fantavoto atteso, sulle giornate che restano" }),
    box({ v: pct(g.pv), l: "prob. di voto", ic: "ok", sub: barra(g.pv, tonoQuota(g.pv)) }),
    box({ v: pct(g.pt), l: "da titolare", ic: "orologio", sub: `${fmt(g.min, 0)}' a presenza` }),
    box({ v: fmt(g.val, 0), l: "valore in crediti", ic: "gemma" }),
    box({ v: prezzo, l: "prezzo atteso", ic: "cartellino", sub: affare }),
  ];
  const pezzi = por ? [
    { l: "voto atteso", x: g.va, ic: "stella", base: true },
    { l: "porta inviolata", x: g.cs, ic: "porta", title: "Un punto per la probabilità di non subire gol" },
    { l: "gol subiti", x: -(g.gs || 0), ic: "rete", title: "Gol subiti attesi a partita" },
  ] : [
    { l: "voto atteso", x: g.va, ic: "stella", base: true },
    { l: "gol", x: (g.gol || 0) * 3, ic: "pallone", sub: `${fmt(g.gol, 2)} × 3` },
    { l: "assist", x: g.ass, ic: "assist" },
    { l: "rigori", x: (g.rig || 0) * 1.68, ic: "rigore", sub: `tira il ${pct(g.qrig)}`, title: "La quota dei rigori della squadra che calcia lui" },
    { l: "malus", x: -(g.ma || 0), ic: "cartello", sub: "cartellini", title: "Ammonizioni, espulsioni e autogol attesi" },
  ];
  const resto = r2(g.fm) - pezzi.reduce((a, p) => a + r2(p.x), 0);
  if (Math.abs(resto) >= 0.005) pezzi.push({ l: por ? "taratura e altro" : "taratura", x: resto, ic: "taratura",
    title: "Lo scarto fra fantavoto previsto e reale misurato sulle stagioni passate" + (por ? ", più rigori parati e cartellini" : "") });
  const somma = pezzi.map((p) => box({ v: p.base ? fmt(p.x, 2) : conSegno(r2(p.x)), l: p.l, ic: p.ic, sub: p.sub || "", title: p.title || "",
    tono: p.base ? "" : Math.abs(r2(p.x)) < 0.005 ? "zero" : p.x < 0 ? "meno" : "piu" }));
  somma.push(box({ v: fmt(g.fm, 2), l: "fantavoto quando gioca", ic: "uguale", tono: "tot" }));
  if (g.qm) somma.push(box({ v: conSegno(g.qm), l: "mod. difesa", ic: "scudo", tono: g.qm < 0 ? "meno" : "piu",
    title: "La sua quota del modificatore difesa: si aggiunge al fantavoto nei punti a giornata" }));
  return sezione("info", "info", "Informazioni", `${pos}° su ${delRuolo.length} ${NOMI_RUOLO[g.r].toLowerCase()} per punti`,
    `<div class="boxes">${numeri.join("")}</div>
    <div class="sez-sub">Come nasce il fantavoto</div>
    <div class="boxes somma">${somma.join("")}</div>`);
}

// Fantavoti di questa stagione: una colonna per giornata giocata (verde sopra il 6,5, rossa
// sotto il 5,5, vuota se non ha giocato) e i numeri dell'anno. Le stagioni passate stanno
// nel pannello che si apre dal riquadro delle presenze.
function sezioneFantavoti(g) {
  const giocate = META.giornata || 0, H = 64;
  const cur = g.st.find((s) => s[0] === META.stagione);
  const voti = new Map(g.ul);
  // la scala arriva al fantavoto piu' alto (almeno 8), cosi' anche i portieri riempiono il grafico
  const tetto = Math.max(8, ...g.ul.map(([, fv]) => fv ?? 0));
  let colonne = "";
  for (let gi = 1; gi <= giocate; gi++) {
    const c = voti.has(gi), fv = voti.get(gi);
    const cls = !c ? "nd" : fv == null ? "sv" : fv >= 6.5 ? "ok" : fv < 5.5 ? "ko" : "";
    const h = fv == null ? 0 : Math.round(Math.max(0.06, fv / tetto) * H);
    colonne += `<span class="col ${cls}" title="${gi}ª giornata: ${!c ? "non ha giocato" : fv == null ? "senza voto" : "fantavoto " + fmt(fv, 1)}">`
      + `<i style="height:${h}px"><em>${!c ? "–" : fv == null ? "sv" : fmt(fv, 1)}</em></i><small>${gi}</small></span>`;
  }
  const n = cur ? cur[2] : 0;
  const numeri = [box({ v: `${n}/${giocate}`, l: "presenze con voto", ic: "ok", sub: barra(giocate ? n / giocate : 0, tonoQuota(giocate ? n / giocate : 0)),
    apre: g.st.length ? "pan-st" : "", title: g.st.length ? "Apri le stagioni precedenti" : "" })];
  if (cur) {
    numeri.push(box({ v: fmt(cur[3], 2), l: "media voto", ic: "stella" }), box({ v: fmt(cur[4], 2), l: "fantamedia", ic: "sale" }));
    if (g.r !== "P") numeri.push(box({ v: cur[5], l: "gol", ic: "pallone" }), box({ v: cur[6], l: "assist", ic: "assist" }));
  }
  const stagioni = g.st.length ? pannello("pan-st", `<div class="scorri"><table>
      <thead><tr><th class="l">Stagione</th><th class="l">Squadra</th><th>Pres.</th><th>Media</th><th>FM</th><th>Gol</th><th>Ass.</th></tr></thead>
      <tbody>${g.st.slice().reverse().map((s) => `<tr><td class="l">${s[0]}</td><td class="l sq">${esc(nomeSq(s[1]))}</td><td>${s[2]}</td><td>${fmt(s[3], 2)}</td><td>${fmt(s[4], 2)}</td><td>${s[5]}</td><td>${s[6]}</td></tr>`).join("")}</tbody>
    </table></div>`) : `<p class="lbl">Nessuna presenza in Serie A negli ultimi tre anni.</p>`;
  const grafico = giocate && g.ul.length ? `<div class="box grafico"><span class="box-l">${ico("barre")}<span>fantavoto per giornata, la linea è il 6</span></span>
      <div class="fv" style="--sei:${Math.round(6 / tetto * H)}px">${colonne}</div></div>` : "";
  return sezione("fv", "barre", "Fantavoti di questa stagione", `${giocate} ${giocate === 1 ? "giornata giocata" : "giornate giocate"}`,
    `<div class="fv-riga${giocate > 12 || !grafico ? " lunga" : ""}${giocate > 24 ? " fitta" : ""}">${grafico}<div class="boxes">${numeri.join("")}</div></div>${stagioni}`);
}

function scheda(id) {
  const g = BY_ID.get(id); if (!g) return;
  if (SCHEDA.id !== id) SCHEDA = { id, abb: null };
  const azioni = inAsta()
    ? (OWNER.has(g.id) ? `<span class="lbl">Preso da ${esc(S.asta.squadre[OWNER.get(g.id)].nome)} a ${S.asta.squadre[OWNER.get(g.id)].rosa[g.id]} crediti</span>` : `<button class="btn primary" data-chiama="${g.id}">Chiama all'asta</button>`)
    : `<button class="btn" data-taken="${g.id}">${S.presi[g.id] ? "Rimetti fra i disponibili" : "Escludi"}</button>
      <button class="btn primary" data-add="${g.id}">${mia()[g.id] != null ? "Togli dalla mia rosa" : "Metti nella mia rosa"}</button>`;
  apri(`
    <header class="sch-top">
      <div class="sch-chi">
        <h3><span class="role ${g.r}">${g.r}</span>${dotFascia(g)}<span class="sch-nome">${esc(g.nome)}</span>${tag(g)}</h3>
        <div class="sch-meta"><span class="mt sq"><b>${esc(nomeSq(g.sq))}</b></span><span class="mt">Quotazione <b>${fmt(g.qa, 0)}</b>, iniziale ${fmt(g.qi, 0)}</span><span class="mt">FVM <b>${fmt(g.fvm, 0)}</b></span>${g.fa == null ? "" : `<span class="mt" title="${g.fi ? "Fascia stimata da noi: SOS Fanta lo segna fra gli infortunati" : "Fascia secondo la guida all'asta di SOS Fanta"}">Fascia <b>${esc(META.fasce[g.fa])}</b>${g.fi ? ", stimata" : ""}</span>`}</div>
      </div>
      <button class="ic" data-close aria-label="Chiudi">✕</button>
    </header>
    <div class="sch-corpo">${sezioneInfo(g)}${sezioneInfortuni(g)}${sezioneFantavoti(g)}${sezioneAlternanza(g)}</div>
    <footer class="sch-azioni">${azioni}</footer>`, `scheda r-${g.r}`);
}

function chiediPrezzo(id) {
  const g = BY_ID.get(id);
  apri(`<h3>${esc(g.nome)}</h3><div class="sub">${esc(nomeSq(g.sq))} · prezzo atteso ${prezzoAtteso(g)} · valore ${fmt(g.val, 0)}</div>
    <form id="fprezzo" class="row" style="margin-top:14px">
      <label class="lbl" for="prezzo">Prezzo</label>
      <input id="prezzo" type="number" min="1" max="${META.crediti}" value="${prezzoAtteso(g)}" required>
      <span class="lbl">crediti</span>
    </form>
    <div class="actions"><button class="btn" data-close>Annulla</button><button class="btn primary" id="okprezzo">Metti nella mia rosa</button></div>`);
  const conferma = () => { const p = Math.max(1, Math.round(+$("#prezzo").value || 1)); mia()[id] = p; delete S.presi[id]; chiudi(); aggiorna(); };
  $("#okprezzo").onclick = conferma;
  $("#fprezzo").onsubmit = (e) => { e.preventDefault(); conferma(); };
  $("#prezzo").select();
}

function esporta() {
  const txt = JSON.stringify({ piano: S.piano, rosa: mia(), presi: S.presi }, null, 0);
  apri(`<h3>Esporta il piano ${S.piano}</h3><p class="lbl">Copia il testo e conservalo: con Importa lo ricarichi qui o su un altro dispositivo.</p>
    <textarea id="txt" readonly>${esc(txt)}</textarea>
    <div class="actions"><button class="btn" data-close>Chiudi</button><button class="btn primary" id="copia">Copia</button></div>`);
  $("#copia").onclick = async () => {
    try { await navigator.clipboard.writeText(txt); $("#copia").textContent = "Copiato"; }
    catch (e) { $("#txt").select(); $("#copia").textContent = "Selezionato: premi Ctrl+C"; }
  };
}

function importa() {
  apri(`<h3>Importa un piano</h3><p class="lbl">Incolla il testo esportato. Sostituisce il piano ${S.piano}.</p>
    <textarea id="txt" placeholder='{"rosa":{...}}'></textarea>
    <p class="alert" id="errimp" hidden></p>
    <div class="actions"><button class="btn" data-close>Annulla</button><button class="btn primary" id="okimp">Importa</button></div>`);
  $("#okimp").onclick = () => {
    try {
      const x = JSON.parse($("#txt").value);
      if (!x.rosa || typeof x.rosa !== "object") throw new Error("manca la rosa");
      S.piani[S.piano] = Object.fromEntries(Object.entries(x.rosa).filter(([id]) => BY_ID.has(+id)));
      if (x.presi) S.presi = x.presi;
      chiudi(); aggiorna();
    } catch (e) { const el = $("#errimp"); el.textContent = "Testo non valido: incolla esattamente quello copiato da Esporta."; el.hidden = false; }
  };
}

// --- asta live --------------------------------------------------------------------------
// Segnaposto finche' non li conosciamo: nomi dei partecipanti e tipo di asta.
// Oggi ogni ruolo si puo' chiamare in qualsiasi momento (chiamata libera).
const NOMI_DEFAULT = ["La mia squadra", ...Array.from({ length: 19 }, (_, i) => `Squadra ${i + 2}`)];
const TITOLARI_8 = { P: 8, D: 32, C: 28, A: 20 };      // titolari tipici del ruolo in una lega da 8 squadre
const TITOLARI_LEGA = () => Object.fromEntries(RUOLI.map((r) => [r, Math.round(TITOLARI_8[r] * META.n_squadre / 8)]));
let OWNER = new Map();                                  // id giocatore -> indice squadra
let SOGLIA = {};                                        // pt/g dell'ultimo titolare della lega per ruolo
let SPINTA = { chiave: null, val: null };

const MAXOFF0 = () => META.crediti - (RUOLI.reduce((a, r) => a + META.slot[r], 0) - 1);

function statoSquadre() {
  const slot = META.slot;
  return S.asta.squadre.map((t, i) => {
    const n = { P: 0, D: 0, C: 0, A: 0 };
    let spesa = 0;
    for (const [id, pz] of Object.entries(t.rosa)) { const g = BY_ID.get(+id); if (g) { n[g.r]++; spesa += +pz; } }
    const liberi = {}; let liberiTot = 0;
    for (const r of RUOLI) { liberi[r] = slot[r] - n[r]; liberiTot += Math.max(0, liberi[r]); }
    const crediti = META.crediti - spesa;
    return { i, nome: t.nome, spesa, crediti, liberi, liberiTot, n,
             maxOff: liberiTot > 0 ? crediti - (liberiTot - 1) : 0 };
  });
}

function sincronizzaAsta() {
  OWNER = new Map();
  S.asta.squadre.forEach((t, i) => Object.keys(t.rosa).forEach((id) => OWNER.set(+id, i)));
  // "Presi da altri" non si segna piu' a mano: sono le rose degli avversari.
  S.presi = {};
  for (const [id, i] of OWNER) if (i !== S.asta.io) S.presi[id] = true;
  // Inflazione: crediti spendibili rimasti contro quello che il mercato avrebbe
  // chiesto per i giocatori che servono ancora a riempire le rose.
  const st = statoSquadre();
  const disp = st.reduce((a, t) => a + Math.max(0, t.crediti - t.liberiTot), 0);
  let dom = 0;
  for (const r of RUOLI) {
    const n = st.reduce((a, t) => a + Math.max(0, t.liberi[r]), 0);
    const liberi = DATA.giocatori.filter((g) => g.r === r && !OWNER.has(g.id)).sort((a, b) => b.pa - a.pa).slice(0, n);
    dom += liberi.reduce((a, g) => a + Math.max(0, g.pa - 1), 0);
  }
  INFL = dom > 0 ? Math.min(2.5, Math.max(0.4, disp / dom)) : 1;
}

function vista(v) {
  $("#main").dataset.view = v;
  // Su computer "Listone e rosa" copre entrambe le viste.
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected",
    b.dataset.view === v || (v === "rosa" && b.dataset.view === "listone" && innerWidth > 900)));
}

// da quanto dura l'asta: dall'avvio, o dal primo acquisto per le aste salvate prima di questo campo
function durata() {
  const t0 = S.asta?.inizio || S.asta?.log?.[0]?.ora;
  if (!t0) return "";
  const min = Math.max(0, Math.floor((Date.now() - Date.parse(t0)) / 60000));
  return min < 60 ? `da ${min}'` : `da ${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}'`;
}
setInterval(() => { const el = document.getElementById("asta-da"); if (el && inAsta()) el.textContent = durata(); }, 30000);

// Il tabellone: a che punto e' la lega, l'ultimo colpo, e chi puo' ancora fare paura.
function renderTabellone() {
  const st = statoSquadre(), nSq = st.length;
  const ass = { P: 0, D: 0, C: 0, A: 0 };
  for (const id of OWNER.keys()) { const g = BY_ID.get(id); if (g) ass[g.r]++; }
  const totSlot = RUOLI.reduce((a, r) => a + META.slot[r] * nSq, 0), nAss = OWNER.size;
  const barra = RUOLI.map((r) => {
    const cap = META.slot[r] * nSq;
    return `<span style="flex:${cap}" title="${NOMI_RUOLO[r]}: ${ass[r]} su ${cap}"><i style="--c:var(--r-${r.toLowerCase()});width:${(100 * ass[r] / cap).toFixed(1)}%"></i></span>`;
  }).join("");
  const u = S.asta.log[S.asta.log.length - 1], gu = u && BY_ID.get(u.id);
  const ultimo = gu
    ? `<div class="tb tb-ultimo"><b><span class="role ${gu.r}">${gu.r}</span>${esc(gu.nome)} <em>${u.p}</em></b><small>Ultimo · ${esc(S.asta.squadre[u.t].nome)}</small></div>`
    : `<div class="tb tb-ultimo"><b><em>Nessuno</em></b><small>Ultimo acquisto</small></div>`;
  const rivali = st.filter((t) => t.i !== S.asta.io && t.liberiTot > 0).sort((a, b) => b.maxOff - a.maxOff);
  const riv = rivali[0]
    ? `<div class="tb"><b>${esc(rivali[0].nome)} <span>${cr(rivali[0].maxOff, META.crediti - totSlot / nSq + 1)}</span></b><small>Rivale più ricco<span class="solo-desk"> · offerta max</span></small></div>`
    : "";
  $("#tabellone").innerHTML = `
    <div class="tb"><b><span>${nAss}<span class="den">/${totSlot}</span></span><span class="tb-bar">${barra}</span></b><small>Assegnati · P ${ass.P} D ${ass.D} C ${ass.C} A ${ass.A}</small></div>
    ${ultimo}${riv}`;
}

function renderControlloAsta() {
  const root = document.documentElement;
  if (inAsta()) {
    root.setAttribute("data-asta", "on");
    $("#tab-asta").hidden = false;
    $("#asta-ctl").innerHTML = `<span class="live"><span class="dot"></span>Live <span class="da" id="asta-da">${durata()}</span>
      <button id="asta-chiudi" title="Sospendi o chiudi l'asta">Esci</button></span>`;
    renderTabellone();
  } else {
    root.removeAttribute("data-asta");
    $("#tabellone").innerHTML = "";
    $("#tab-asta").hidden = true;
    if ($("#main").dataset.view === "asta") vista("listone");
    $("#asta-ctl").innerHTML = `<button class="asta-btn pulse" id="asta-avvia">${S.asta ? "Riprendi l'asta" : "Modalità asta"}<span class="ombra"></span><span class="pallone">${PALLONE}</span></button>`;
  }
}

function renderAsta() {
  const st = statoSquadre(), me = st[S.asta.io];

  // --- occasioni di fine ruolo ---
  const occ = [];
  for (const g of DATA.giocatori) {
    if (OWNER.has(g.id) || me.liberi[g.r] <= 0 || g.pg < SOGLIA[g.r]) continue;
    const rivali = st.filter((t) => t.i !== S.asta.io && t.liberi[g.r] > 0);
    const maxRivali = rivali.reduce((a, t) => Math.max(a, t.maxOff), 0);
    const pa = prezzoAtteso(g);
    const reale = rivali.length ? Math.min(pa, maxRivali + 1) : 1;
    if (reale > me.maxOff || reale > pa * 0.75) continue;
    occ.push({ g, pa, reale, n: rivali.filter((t) => t.maxOff >= 2).length, maxRivali });
  }
  occ.sort((a, b) => b.g.pg - a.g.pg);
  const libLega = RUOLI.map((r) => `${r} ${st.reduce((a, t) => a + Math.max(0, t.liberi[r]), 0)}`).join(" · ");
  $("#occasioni").className = "card" + (occ.length ? " hot" : "");
  $("#occasioni").innerHTML = `<h2>Occasioni di fine ruolo</h2>
    <div class="lbl" style="margin:-4px 0 8px">Slot ancora liberi in lega: ${libLega} · mercato ${INFL >= 1 ? "+" : ""}${Math.round((INFL - 1) * 100)}% sui prezzi attesi</div>
    ${occ.length ? occ.slice(0, 6).map((o) => `<div class="occ">
        <span class="role ${o.g.r}">${o.g.r}</span>
        <span class="who"><b>${esc(o.g.nome)}</b><small>${esc(nomeSq(o.g.sq))}</small></span>
        <span class="num"><b>${fmt(o.g.pg, 2)}</b> pt/g · <s>${o.pa}</s> <b>${o.reale}</b> cr<br>${o.n ? `${o.n} rivali, al massimo ${cr(o.maxRivali, MAXOFF0())}` : "nessun rivale"}</span>
        <button class="btn small" data-occ="${o.g.id}">Chiama</button></div>`).join("")
      : `<p class="lbl">Nessuna per ora. Compaiono quando in un ruolo restano titolari buoni e gli avversari non hanno piu' slot o crediti per contenderteli: li vedrai qui con il prezzo realistico.</p>`}`;

  // --- squadre ---
  $("#squadre").innerHTML = `<h2>Squadre</h2><div style="overflow-x:auto"><table class="sq">
    <thead><tr><th class="l">Squadra</th><th>Crediti</th><th title="Offerta massima possibile adesso">Max</th><th class="l" title="Slot liberi per ruolo">Liberi ${RUOLI.map((r) => `<span class="lr ${r}">${r}</span>`).join("·")}</th><th></th></tr></thead>
    <tbody>${st.map((t) => `<tr class="${t.i === S.asta.io ? "io" : ""}">
      <td class="l">${esc(t.nome)}</td><td>${cr(t.crediti, META.crediti)}</td><td>${cr(t.maxOff, MAXOFF0())}</td>
      <td class="l lib">${RUOLI.map((r) => `<span class="lr ${r}${t.liberi[r] <= 0 ? " zero" : ""}" title="${NOMI_RUOLO[r]} liberi">${t.liberi[r]}</span>`).join(" · ")}</td>
      <td><button class="btn small" data-vedi="${t.i}">${S.asta.aperta === t.i ? "Chiudi" : "Rosa"}</button></td></tr>
      ${S.asta.aperta === t.i ? `<tr><td colspan="5" class="l" style="white-space:normal">${RUOLI.map((r) => {
        const l = Object.entries(S.asta.squadre[t.i].rosa).map(([id, pz]) => ({ g: BY_ID.get(+id), pz })).filter((x) => x.g && x.g.r === r);
        return l.length ? `<div><span class="role ${r}">${r}</span> ${l.map((x) => `${esc(x.g.nome)} <b>${x.pz}</b>`).join(", ")}</div>` : "";
      }).join("") || "<span class='lbl'>Nessun acquisto.</span>"}</td></tr>` : ""}`).join("")}</tbody></table></div>
    <div class="row" style="margin-top:10px"><button class="btn small" id="esporta-asta">Esporta l'asta</button><button class="btn small" id="importa-asta">Importa</button></div>`;

  // --- ultimi acquisti ---
  const log = S.asta.log.slice(-8).reverse();
  $("#log").innerHTML = `<h2>Ultimi acquisti</h2><div class="log">${log.map((x) => {
    const g = BY_ID.get(x.id); return g ? `<div><span><span class="role ${g.r}">${g.r}</span> ${esc(g.nome)}</span><span>${esc(S.asta.squadre[x.t].nome)} · <b>${x.p}</b></span></div>` : "";
  }).join("") || "<p class='lbl'>Ancora nessuno.</p>"}</div>
    ${S.asta.log.length ? `<div class="row" style="margin-top:8px"><button class="btn small" id="annulla-ultimo">Annulla l'ultimo</button></div>` : ""}`;

  renderChiamato();
}

function chiama(id) {
  if (OWNER.has(id)) return;
  S.asta.chiamato = id;
  S.asta.scelta = null;
  $("#risultati").hidden = true;
  $("#cerca-asta").value = "";
  vista("asta");
  renderChiamato();
  setTimeout(() => { const i = $("#prezzo-asta"); if (i) i.select(); }, 0);
}

// Fin dove conviene spingersi: il prezzo massimo a cui la rosa migliore CON lui
// resta forte almeno quanto la rosa migliore SENZA di lui. Si trova per
// bisezione rifacendo l'ottimizzazione a ogni prezzo provato.
function calcolaSpinta(id) {
  const g = BY_ID.get(id), me = statoSquadre()[S.asta.io];
  if (me.liberi[g.r] <= 0) return { max: 0, motivo: `hai gia' tutti i ${NOMI_RUOLO[g.r].toLowerCase()}` };
  const presi = S.presi;
  S.presi = { ...presi, [id]: true };
  const senza = ottimizza();
  S.presi = presi;
  const f0 = senza.errore ? -Infinity : senza.forza;
  const rosa = mia(), provate = new Map();
  const forzaA = (x) => {
    if (!provate.has(x)) { rosa[id] = x; const s = ottimizza(); delete rosa[id]; provate.set(x, s.errore ? -Infinity : s.forza); }
    // L'ottimizzatore e' un'euristica: a prezzi vicini puo' trovare rose un po' diverse. Ma una
    // rosa trovata pagandolo di piu' resta valida pagandolo di meno, quindi la forza "con lui"
    // a un prezzo e' almeno la migliore trovata a un prezzo uguale o piu' alto.
    let f = -Infinity;
    for (const [y, v] of provate) if (y >= x && v > f) f = v;
    return f;
  };
  forzaA(Math.min(prezzoAtteso(g), me.maxOff));
  if (forzaA(1) < f0 - 1e-9) return { max: 0, motivo: "anche a 1 credito la rosa migliore senza di lui e' piu' forte" };
  let lo = 1, hi = me.maxOff, best = 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (forzaA(mid) >= f0 - 1e-9) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return { max: best, motivo: best >= me.maxOff ? "e' la tua offerta massima: oltre non puoi" : "oltre, la rosa migliore senza di lui e' piu' forte" };
}

function renderChiamato() {
  const box = $("#chiamato");
  const id = S.asta.chiamato;
  if (!id || OWNER.has(id)) {
    box.innerHTML = `<p class="lbl" style="margin-top:10px">Scrivi il nome del giocatore chiamato: vedrai quanto vale per te, fin dove spingerti e chi puo' ancora contendertelo. Poi registri chi l'ha preso e a quanto.</p>`;
    return;
  }
  const g = BY_ID.get(id), st = statoSquadre(), me = st[S.asta.io];
  const chiave = `${id}|${S.asta.log.length}|${S.margine}|${S.modo}|${S.tetto}|${JSON.stringify(S.budgetRuolo)}`;
  const pa = prezzoAtteso(g);
  const rivali = st.filter((t) => t.i !== S.asta.io).map((t) => ({ t, ok: t.liberi[g.r] > 0 && t.maxOff >= 1 }));
  const scelta = S.asta.scelta;
  box.innerHTML = `<div class="chiamato">
    <div class="row" style="justify-content:space-between;align-items:flex-end">
      <div><h3><span class="role ${g.r}" style="vertical-align:5px">${g.r}</span> ${dotFascia(g)}${esc(g.nome)}${tag(g)}${S.asta.obiettivi.includes(id) ? '<span class="tag obj">OBIETTIVO</span>' : ""}</h3>
        <div class="sub lbl" style="text-transform:capitalize">${esc(nomeSq(g.sq))}</div></div>
      <button class="btn small" data-open="${id}">Scheda</button>
    </div>
    <div class="kv" style="margin:0">
      <div><b>${fmt(g.pg, 2)}</b><small>punti a giornata</small></div>
      <div><b>${fmt(g.val, 0)}</b><small>valore</small></div>
      <div><b>${pa}</b><small>prezzo atteso ora</small></div>
      <div><b>${cr(me.maxOff, MAXOFF0())}</b><small>la tua offerta massima</small></div>
    </div>
    <div class="spinta" id="spinta">${SPINTA.chiave === chiave
      ? `<span>Spingiti fino a</span><b>${SPINTA.val.max}</b><span>crediti</span><span class="lbl">${SPINTA.val.motivo}</span>`
      : `<span class="lbl">Calcolo fin dove spingerti…</span>`}</div>
    <div><div class="lbl" style="margin-bottom:6px">Chi puo' ancora prenderlo, e al massimo a quanto</div>
      <div class="conc">${rivali.map(({ t, ok }) => `<span class="${ok ? "" : "no"}" title="${ok ? "" : t.liberi[g.r] <= 0 ? "ruolo pieno" : "crediti finiti"}">${esc(t.nome)} ${ok ? cr(t.maxOff, MAXOFF0()) : "–"}</span>`).join("")}</div></div>
    <div><div class="lbl" style="margin-bottom:6px">Chi l'ha preso</div>
      <div class="chi">${st.map((t) => `<button data-squadra="${t.i}" aria-pressed="${scelta === t.i}" ${t.liberi[g.r] <= 0 ? "disabled" : ""}>${esc(t.nome)}</button>`).join("")}</div></div>
    <form class="registra" id="fasta">
      <label class="lbl" for="prezzo-asta">a</label>
      <input id="prezzo-asta" type="number" min="1" max="${META.crediti}" value="${pa}">
      <span class="lbl">crediti</span>
      <button type="button" class="btn live-go" id="registra">Aggiudicato</button>
      <span class="alert" id="err-asta" hidden></span>
    </form>
  </div>`;
  $("#fasta").onsubmit = (e) => { e.preventDefault(); registraDaForm(); };
  if (SPINTA.chiave !== chiave) {
    setTimeout(() => {
      if (S.asta.chiamato !== id) return;
      SPINTA = { chiave, val: calcolaSpinta(id) };
      const el = $("#spinta");
      if (el) el.innerHTML = `<span>Spingiti fino a</span><b>${SPINTA.val.max}</b><span>crediti</span><span class="lbl">${SPINTA.val.motivo}</span>`;
    }, 30);
  }
}

function registraDaForm() {
  const err = (m) => { const e = $("#err-asta"); e.textContent = m; e.hidden = false; };
  const id = S.asta.chiamato, t = S.asta.scelta;
  if (!id) return;
  if (t == null) return err("Scegli chi l'ha preso.");
  const prezzo = Math.round(+$("#prezzo-asta").value || 0);
  const g = BY_ID.get(id), s = statoSquadre()[t];
  if (prezzo < 1) return err("Il prezzo minimo e' 1 credito.");
  if (s.liberi[g.r] <= 0) return err(`${s.nome} ha gia' tutti i ${NOMI_RUOLO[g.r].toLowerCase()}.`);
  if (prezzo > s.maxOff) return err(`${s.nome} puo' offrire al massimo ${s.maxOff} crediti.`);
  S.asta.squadre[t].rosa[id] = prezzo;
  S.asta.log.push({ id, t, p: prezzo, ora: new Date().toISOString() });
  S.asta.chiamato = null; S.asta.scelta = null;
  aggiorna();
  $("#cerca-asta").focus();
}

function rimuoviAcquisto(id) {
  for (const t of S.asta.squadre) delete t.rosa[id];
  S.asta.log = S.asta.log.filter((x) => x.id !== id);
}

function annullaUltimo() {
  const x = S.asta.log.pop();
  if (x) delete S.asta.squadre[x.t].rosa[x.id];
  aggiorna();
}

// --- il calcio d'inizio: il pallone rotola sul bottone, viene verso di te e apre il setup ---
// generato da scripts/pallone.py: icosaedro troncato gonfiato su una sfera, 12 pentagoni e 20 esagoni
const PALLONE = `<svg viewBox="0 0 100 100" aria-hidden="true"><defs><radialGradient id="pl-volume" cx="38%" cy="34%" r="68%"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="0.9" stop-color="#000" stop-opacity="0.28"/><stop offset="1" stop-color="#000" stop-opacity="0.5"/></radialGradient><radialGradient id="pl-riflesso" cx="34%" cy="28%" r="30%"><stop offset="0" stop-color="#fff" stop-opacity="0.6"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><g stroke="#5b625e" stroke-width="0.9" stroke-linejoin="round"><path d="M96.8 54.5L96.9 52.9L97.0 49.3L97.0 47.9L97.0 48.8L97.0 49.8L97.0 50.7L97.0 51.7L96.9 52.6L96.9 53.6Z" fill="rgb(170,170,172)"/><path d="M7.2 30.5L7.2 30.6L6.5 32.6L5.2 36.1L4.2 39.7L3.5 43.3L3.2 45.5L3.5 43.3L3.8 41.1L4.3 38.9L4.9 36.8L5.6 34.6L6.4 32.6Z" fill="rgb(39,42,45)"/><path d="M53.3 3.1L53.2 3.1L52.3 3.2L48.5 3.3L44.7 3.6L40.9 4.2L37.2 5.2L33.7 6.4L32.0 6.7L30.7 7.2L33.7 5.9L36.8 4.9L40.1 4.1L43.4 3.5L46.8 3.1L50.1 3.0Z" fill="rgb(44,47,50)"/><path d="M3.0 52.1L3.1 53.5L3.6 56.3L4.3 59.2L5.4 61.9L6.7 64.5L7.8 67.9L9.1 71.4L10.8 74.7L12.7 77.8L14.8 80.6L15.2 81.5L15.5 81.9L12.6 78.5L10.0 74.6L7.6 70.4L5.8 65.8L4.4 61.2L3.5 56.6Z" fill="rgb(181,181,183)"/><path d="M69.3 92.8L69.6 92.7L71.0 91.8L72.3 90.7L73.5 89.3L76.5 87.1L79.5 84.7L82.3 82.0L84.8 79.2L87.1 76.2L88.9 74.7L90.5 73.1L91.8 71.3L92.8 69.5L90.7 73.5L88.1 77.6L84.9 81.5L81.3 85.0L77.4 88.2L73.4 90.8Z" fill="rgb(170,170,172)"/><path d="M84.5 18.1L84.1 17.8L83.3 17.3L82.1 17.0L80.8 16.9L77.9 14.9L74.7 13.0L71.4 11.3L67.9 10.0L64.4 8.9L62.1 7.2L59.7 5.8L57.3 4.6L54.8 3.8L52.3 3.2L53.2 3.1L53.3 3.1L58.0 3.7L63.0 4.8L67.9 6.5L72.7 8.8L77.1 11.6L81.1 14.8Z" fill="rgb(202,202,204)"/><path d="M15.5 81.9L15.2 81.5L14.8 80.6L16.8 82.2L19.0 83.6L21.5 84.7L24.1 85.6L26.9 86.3L29.9 88.4L33.1 90.3L36.5 91.9L39.9 93.3L43.4 94.3L44.2 95.4L45.0 96.2L45.9 96.7L46.7 96.9L42.0 96.3L37.0 95.2L32.1 93.5L27.3 91.2L22.9 88.4L18.9 85.2Z" fill="rgb(170,170,172)"/><path d="M30.7 7.2L32.0 6.7L33.7 6.4L32.1 7.6L30.7 9.1L29.4 10.9L28.2 12.9L27.2 15.1L24.1 17.3L21.2 19.8L18.4 22.5L15.8 25.3L13.6 28.3L11.6 28.9L9.9 29.6L8.5 30.5L7.3 31.5L6.5 32.6L7.2 30.6L7.2 30.5L9.3 26.5L11.9 22.4L15.1 18.5L18.7 15.0L22.6 11.8L26.6 9.2Z" fill="rgb(240,240,242)"/><path d="M97.0 47.9L97.0 49.3L96.7 48.8L96.1 48.3L95.2 47.8L94.1 47.3L92.6 46.9L91.5 43.5L90.2 40.2L88.5 36.9L86.6 33.7L84.5 30.7L84.3 27.7L83.7 24.7L83.0 21.9L82.0 19.3L80.8 16.9L82.1 17.0L83.3 17.3L84.1 17.8L84.5 18.1L87.4 21.5L90.0 25.4L92.4 29.6L94.2 34.2L95.6 38.8L96.5 43.4Z" fill="rgb(170,170,172)"/><path d="M46.7 96.9L45.9 96.7L45.0 96.2L44.2 95.4L43.4 94.3L46.5 94.0L49.7 93.3L53.0 92.4L56.2 91.2L59.3 89.7L62.3 90.2L65.2 90.3L68.1 90.2L70.9 89.9L73.5 89.3L72.3 90.7L71.0 91.8L69.6 92.7L69.3 92.8L66.3 94.1L63.2 95.1L59.9 95.9L56.6 96.5L53.2 96.9L49.9 97.0Z" fill="rgb(22,25,28)"/><path d="M92.8 69.5L91.8 71.3L90.5 73.1L88.9 74.7L87.1 76.2L87.4 73.9L87.6 71.5L87.5 68.9L87.1 66.2L86.5 63.5L88.2 60.3L89.7 57.0L91.0 53.6L91.9 50.2L92.6 46.9L94.1 47.3L95.2 47.8L96.1 48.3L96.7 48.8L97.0 49.3L96.9 52.9L96.8 54.5L96.5 56.7L96.2 58.9L95.7 61.1L95.1 63.2L94.4 65.4L93.6 67.4Z" fill="rgb(22,25,28)"/><path d="M6.7 64.5L5.4 61.9L4.3 59.2L3.6 56.3L3.1 53.5L3.0 52.1L3.0 51.2L3.0 50.2L3.0 49.3L3.0 48.3L3.1 47.4L3.1 46.4L3.2 45.5L3.5 43.3L4.2 39.7L5.2 36.1L6.5 32.6L7.3 31.5L8.5 30.5L9.9 29.6L11.6 28.9L13.6 28.3L13.8 30.8L14.4 33.4L15.1 36.2L16.1 39.1L17.3 42.0L16.1 45.6L15.2 49.2L14.5 52.9L14.1 56.6L13.8 60.1L11.9 61.1L10.2 62.1L8.8 63.0L7.6 63.8Z" fill="rgb(235,235,237)"/><path d="M26.3 73.6L26.1 76.5L26.1 79.3L26.2 81.8L26.5 84.2L26.9 86.3L24.1 85.6L21.5 84.7L19.0 83.6L16.8 82.2L14.8 80.6L12.7 77.8L10.8 74.7L9.1 71.4L7.8 67.9L6.7 64.5L7.6 63.8L8.8 63.0L10.2 62.1L11.9 61.1L13.8 60.1L15.9 63.0L18.2 65.8L20.7 68.6L23.5 71.2Z" fill="rgb(38,41,44)"/><path d="M27.2 15.1L28.2 12.9L29.4 10.9L30.7 9.1L32.1 7.6L33.7 6.4L37.2 5.2L40.9 4.2L44.7 3.6L48.5 3.3L52.3 3.2L54.8 3.8L57.3 4.6L59.7 5.8L62.1 7.2L64.4 8.9L63.3 10.1L62.0 11.6L60.7 13.4L59.3 15.5L57.9 17.7L54.2 17.9L50.5 18.3L46.7 18.9L42.9 19.8L39.3 20.8L36.7 19.3L34.1 17.9L31.7 16.7L29.3 15.8Z" fill="rgb(245,245,247)"/><path d="M80.8 16.9L82.0 19.3L83.0 21.9L83.7 24.7L84.3 27.7L84.5 30.7L82.1 30.5L79.5 30.5L76.6 30.6L73.5 30.8L70.4 31.1L68.1 28.2L65.7 25.3L63.1 22.5L60.5 20.0L57.9 17.7L59.3 15.5L60.7 13.4L62.0 11.6L63.3 10.1L64.4 8.9L67.9 10.0L71.4 11.3L74.7 13.0L77.9 14.9Z" fill="rgb(45,48,51)"/><path d="M59.3 89.7L59.3 87.7L59.2 85.3L59.1 82.8L58.9 80.0L58.7 77.0L61.6 74.7L64.4 72.2L67.2 69.6L69.8 66.8L72.3 63.9L75.5 64.0L78.5 64.0L81.4 63.9L84.1 63.7L86.5 63.5L87.1 66.2L87.5 68.9L87.6 71.5L87.4 73.9L87.1 76.2L84.8 79.2L82.3 82.0L79.5 84.7L76.5 87.1L73.5 89.3L70.9 89.9L68.1 90.2L65.2 90.3L62.3 90.2Z" fill="rgb(170,170,172)"/><path d="M26.3 73.6L29.2 73.0L32.3 72.2L35.6 71.2L38.9 70.2L42.2 69.0L45.4 70.9L48.8 72.7L52.1 74.3L55.5 75.8L58.7 77.0L58.9 80.0L59.1 82.8L59.2 85.3L59.3 87.7L59.3 89.7L56.2 91.2L53.0 92.4L49.7 93.3L46.5 94.0L43.4 94.3L39.9 93.3L36.5 91.9L33.1 90.3L29.9 88.4L26.9 86.3L26.5 84.2L26.2 81.8L26.1 79.3L26.1 76.5Z" fill="rgb(187,187,189)"/><path d="M17.3 42.0L16.1 39.1L15.1 36.2L14.4 33.4L13.8 30.8L13.6 28.3L15.8 25.3L18.4 22.5L21.2 19.8L24.1 17.3L27.2 15.1L29.3 15.8L31.7 16.7L34.1 17.9L36.7 19.3L39.3 20.8L37.9 23.8L36.6 27.0L35.3 30.4L34.2 33.9L33.2 37.4L29.7 38.2L26.3 39.0L23.1 40.0L20.1 41.0Z" fill="rgb(60,63,66)"/><path d="M84.5 30.7L86.6 33.7L88.5 36.9L90.2 40.2L91.5 43.5L92.6 46.9L91.9 50.2L91.0 53.6L89.7 57.0L88.2 60.3L86.5 63.5L84.1 63.7L81.4 63.9L78.5 64.0L75.5 64.0L72.3 63.9L71.0 60.8L69.4 57.6L67.8 54.3L66.1 51.0L64.2 47.7L65.7 44.4L67.0 40.9L68.3 37.5L69.4 34.3L70.4 31.1L73.5 30.8L76.6 30.6L79.5 30.5L82.1 30.5Z" fill="rgb(199,199,201)"/><path d="M13.8 60.1L14.1 56.6L14.5 52.9L15.2 49.2L16.1 45.6L17.3 42.0L20.1 41.0L23.1 40.0L26.3 39.0L29.7 38.2L33.2 37.4L35.5 40.0L37.9 42.6L40.5 45.4L43.0 48.2L45.6 50.9L44.9 54.6L44.1 58.3L43.4 62.0L42.8 65.6L42.2 69.0L38.9 70.2L35.6 71.2L32.3 72.2L29.2 73.0L26.3 73.6L23.5 71.2L20.7 68.6L18.2 65.8L15.9 63.0Z" fill="rgb(238,238,240)"/><path d="M39.3 20.8L42.9 19.8L46.7 18.9L50.5 18.3L54.2 17.9L57.9 17.7L60.5 20.0L63.1 22.5L65.7 25.3L68.1 28.2L70.4 31.1L69.4 34.3L68.3 37.5L67.0 40.9L65.7 44.4L64.2 47.7L60.6 48.4L56.9 49.0L53.1 49.6L49.3 50.3L45.6 50.9L43.0 48.2L40.5 45.4L37.9 42.6L35.5 40.0L33.2 37.4L34.2 33.9L35.3 30.4L36.6 27.0L37.9 23.8Z" fill="rgb(244,244,246)"/><path d="M45.6 50.9L49.3 50.3L53.1 49.6L56.9 49.0L60.6 48.4L64.2 47.7L66.1 51.0L67.8 54.3L69.4 57.6L71.0 60.8L72.3 63.9L69.8 66.8L67.2 69.6L64.4 72.2L61.6 74.7L58.7 77.0L55.5 75.8L52.1 74.3L48.8 72.7L45.4 70.9L42.2 69.0L42.8 65.6L43.4 62.0L44.1 58.3L44.9 54.6Z" fill="rgb(42,45,48)"/></g><circle cx="50.0" cy="50.0" r="47.0" fill="url(#pl-volume)"/><ellipse cx="36" cy="30" rx="17" ry="12" fill="url(#pl-riflesso)" transform="rotate(-30 36 30)"/><circle cx="50.0" cy="50.0" r="47.0" fill="none" stroke="#2b302d" stroke-width="1.4"/></svg>`;
let inVolo = false;
function calcioDInizio(btn) {
  const orig = btn.querySelector(".pallone");
  if (inVolo) return;
  if (!orig || !window.matchMedia("(prefers-reduced-motion: no-preference)").matches || !Element.prototype.animate) return dialogoAvvio();
  inVolo = true;
  btn.classList.remove("pulse");                                 // misura il pallone fermo, non a meta' palleggio
  const b = orig.getBoundingClientRect(), k = btn.getBoundingClientRect();
  const volo = document.createElement("div");
  volo.className = "pallone-volo";
  volo.innerHTML = PALLONE;
  Object.assign(volo.style, { left: b.left + "px", top: b.top + "px", width: b.width + "px", height: b.height + "px" });
  document.body.appendChild(volo);
  orig.style.opacity = "0";           // non visibility: i gradienti del pallone devono restare attivi
  btn.querySelector(".ombra").style.opacity = "0";

  // Traiettoria simulata, non disegnata a mano:
  // 1) rotola verso sinistra lungo la linea del bottone, accelerando da fermo; la rotazione e' la
  //    distanza fratto la circonferenza, quindi non striscia;
  // 2) arrivato alla curva sinistra cade dal bottone: moto parabolico, con la velocita' orizzontale
  //    che aveva e la gravita';
  // 3) tocca terra (a circa 2/3 dello schermo), si schiaccia per un istante e rimbalza verso la
  //    telecamera: sale frenato dalla gravita' e si avvicina, quindi in prospettiva si ingrandisce e
  //    converge al centro dello schermo, dove arriva al culmine del rimbalzo.
  const d = b.width, r = d / 2, H = k.height;
  const x0 = b.left + r, y0 = b.top + r;                          // centro del pallone a riposo
  const L = x0 - (k.left + H / 2);                                // corsa sul bottone (verso sinistra)
  const Tr = 0.5, a = 2 * L / (Tr * Tr), v = a * Tr;              // accelerazione costante da fermo
  const g = 3400;                                                 // px/s^2
  const yF = Math.max(y0 + 160, innerHeight * 0.66);              // quota del centro al rimbalzo
  const Tf = Math.sqrt(2 * (yF - y0) / g);
  const vx = Math.min(v, Math.max(0, (x0 - L - r - 8) / Tf));     // non esce dal bordo sinistro
  const xF = x0 - L - vx * Tf;
  const Ts = 0.06, Tc = 0.72;                                     // schiacciamento e rimbalzo
  const T = Tr + Tf + Ts + Tc;
  const Cx = innerWidth / 2, Cy = innerHeight / 2;
  const smax = Math.max(innerWidth, innerHeight) / d * 1.6;
  const gz = 2 * (yF - Cy) / (Tc * Tc);                           // gravita' "nel mondo" del rimbalzo
  const deg = (dist) => (dist / (Math.PI * d)) * 360;
  const frames = [];
  const push = (t, x, y, rot, sx = 1, sy = 1, op = 1) => frames.push({
    offset: Math.min(1, t / T), opacity: op,
    transform: `translate(${(x - x0).toFixed(1)}px,${(y - y0).toFixed(1)}px) scale(${sx.toFixed(3)},${sy.toFixed(3)}) rotate(${rot.toFixed(1)}deg)`,
  });
  const dt = 1 / 60;
  for (let t = 0; t < Tr; t += dt) { const s = 0.5 * a * t * t; push(t, x0 - s, y0, -deg(s)); }
  const rotE = -deg(L);
  for (let t = 0; t < Tf; t += dt) push(Tr + t, x0 - L - vx * t, y0 + 0.5 * g * t * t, rotE - deg(vx * t + 0.5 * g * t * t * 0.15));
  const rotF = rotE - deg(vx * Tf + 0.5 * g * Tf * Tf * 0.15);
  push(Tr + Tf, xF, yF, rotF);
  push(Tr + Tf + Ts * 0.5, xF, yF + r * 0.14, rotF - 6, 1.18, 0.78);   // schiacciato a terra
  const t0 = Tr + Tf + Ts;
  // passi da 1/60 s piu' l'istante finale esatto: se l'ultimo fotogramma non cade a offset 1 il browser
  // ne aggiunge uno con la trasformazione di partenza e il pallone tornerebbe indietro all'ultimo
  const passi = [];
  for (let t = 0; t < Tc; t += dt) passi.push(t);
  passi.push(Tc);
  for (const t of passi) {
    const u = Math.min(1, t / Tc);
    const s = 1 / (1 - (1 - 1 / smax) * u);                       // avvicinamento costante: prospettiva
    // (1 - u)^2: moltiplicato per la scala prospettica da' uno spostamento sullo schermo che converge
    // al centro in modo regolare, invece di restare fermo e scattare al centro solo alla fine
    const X = (xF - Cx) * (1 - u) * (1 - u);
    const Y = (yF - Cy) - gz * Tc * t + 0.5 * gz * t * t;         // culmine esattamente al centro
    const op = u < 0.86 ? 1 : Math.max(0, 1 - (u - 0.86) / 0.14);
    push(t0 + t, Cx + X * s, Cy + Y * s, rotF - 10 - 260 * u, s, s, op);
  }
  const anim = volo.animate(frames, { duration: T * 1000, fill: "forwards" });
  // il setup si apre mentre il pallone arriva addosso, prima che sparisca del tutto
  setTimeout(() => dialogoAvvio(), (T - 0.2) * 1000);
  anim.finished.finally(() => {
    volo.remove();
    orig.style.opacity = "";
    btn.querySelector(".ombra").style.opacity = "";
    btn.classList.add("pulse");
    inVolo = false;
  });
}

function dialogoAvvio() {
  const nomi = S.asta ? S.asta.squadre.map((t) => t.nome) : NOMI_DEFAULT.slice(0, META.n_squadre);
  apri(`<h3>Modalità asta</h3>
    <p class="lbl">Da qui in poi la tua rosa e' quella reale: registri ogni acquisto, tuo e degli altri, e il tool ricalcola suggerimenti, prezzi e occasioni.</p>
    <div class="nomi">${nomi.map((n, i) => `<label>${i === 0 ? "La tua squadra" : "Avversario " + i}<input id="nome-${i}" value="${esc(n)}" maxlength="24"></label>`).join("")}</div>
    ${S.asta ? "" : `<div class="row"><span class="lbl">Obiettivi dal piano</span><div class="seg mini">${["A", "B", "C"].map((p) =>
      `<button type="button" data-obj="${p}" aria-pressed="${S.piano === p}">Piano ${p} (${Object.keys(S.piani[p]).length})</button>`).join("")}</div></div>
    <p class="lbl">I giocatori del piano scelto restano segnati come OBIETTIVO nel listone. Non sono acquisti: le rose partono vuote.</p>`}
    <p class="nota">Da definire: tipo di asta e ordine dei ruoli. Per ora ogni ruolo si puo' chiamare in qualsiasi momento.</p>
    <div class="actions">
      <button class="btn" data-close>Annulla</button>
      ${S.asta ? `<button class="btn" id="asta-nuova">Nuova asta da zero</button>` : ""}
      <button class="btn live-go" id="asta-ok">${S.asta ? "Riprendi l'asta" : "Avvia l'asta"}</button>
    </div>`);
  let piano = S.piano;
  document.querySelectorAll("[data-obj]").forEach((b) => b.onclick = () => {
    piano = b.dataset.obj;
    document.querySelectorAll("[data-obj]").forEach((x) => x.setAttribute("aria-pressed", x === b));
  });
  const leggiNomi = () => nomi.map((n, i) => ($(`#nome-${i}`).value.trim() || n));
  const parti = (nuova) => {
    const n = leggiNomi();
    if (!S.asta || nuova) {
      S.asta = { attiva: true, io: 0, inizio: new Date().toISOString(), squadre: n.map((nome) => ({ nome, rosa: {} })), log: [],
                 obiettivi: Object.keys(S.piani[piano]).map(Number), presiPiano: S.presi,
                 chiamato: null, scelta: null, aperta: null };
    } else {
      S.asta.attiva = true;
      S.asta.squadre.forEach((t, i) => { t.nome = n[i]; });
    }
    chiudi();
    vista("asta");
    aggiorna();
    const top = document.querySelector(".top");
    top.classList.remove("entra"); void top.offsetWidth; top.classList.add("entra");
    $("#cerca-asta").focus();
  };
  $("#asta-ok").onclick = () => parti(false);
  if ($("#asta-nuova")) $("#asta-nuova").onclick = () => parti(true);
}

function dialogoChiusura() {
  const n = S.asta.log.length;
  apri(`<h3>Uscire dall'asta?</h3>
    <p class="lbl"><b>Sospendi</b> se l'asta continua piu' tardi: tutto resta com'e' e dal pulsante in alto la riprendi da dove eri.</p>
    <p class="lbl"><b>Chiudi</b> se l'asta e' finita: le rose finali (${n} acquisti) vengono archiviate in questo browser e saranno la base del tool formazione. Il pulsante torna a "Modalita' asta" per una nuova asta.</p>
    <div class="actions">
      <button class="btn" data-close>Resta in asta</button>
      <button class="btn" id="asta-sospendi">Sospendi</button>
      <button class="btn primary" id="asta-stop">Chiudi l'asta</button>
    </div>`);
  const esci = () => { S.presi = S.asta.presiPiano || {}; OWNER = new Map(); };
  $("#asta-sospendi").onclick = () => { S.asta.attiva = false; esci(); chiudi(); aggiorna(); };
  $("#asta-stop").onclick = () => {
    const chiusa = { ...S.asta, attiva: false, conclusa: new Date().toISOString() };
    S.archivio = [...(S.archivio || []), chiusa];
    esci();
    S.asta = null;
    aggiorna();
    // Subito il testo da conservare: il browser e' l'unico posto dove vive.
    const txt = JSON.stringify({ asta: chiusa });
    apri(`<h3>Asta chiusa</h3>
      <p class="lbl">Le rose finali sono archiviate in questo browser. Copia il testo qui sotto e conservalo: e' la copia di sicurezza, e con Importa la ricarichi su un altro dispositivo.</p>
      <textarea id="txt" readonly>${esc(txt)}</textarea>
      <div class="actions"><button class="btn" data-close>Fatto</button><button class="btn primary" id="copia">Copia</button></div>`);
    $("#copia").onclick = async () => {
      try { await navigator.clipboard.writeText(txt); $("#copia").textContent = "Copiato"; }
      catch (e) { $("#txt").select(); $("#copia").textContent = "Selezionato: premi Ctrl+C"; }
    };
  };
}

function esportaAsta() {
  const txt = JSON.stringify({ asta: S.asta });
  apri(`<h3>Esporta l'asta</h3><p class="lbl">Tutto lo stato dell'asta: squadre, acquisti, obiettivi. Con Importa lo ricarichi qui o su un altro dispositivo.</p>
    <textarea id="txt" readonly>${esc(txt)}</textarea>
    <div class="actions"><button class="btn" data-close>Chiudi</button><button class="btn primary" id="copia">Copia</button></div>`);
  $("#copia").onclick = async () => {
    try { await navigator.clipboard.writeText(txt); $("#copia").textContent = "Copiato"; }
    catch (e) { $("#txt").select(); $("#copia").textContent = "Selezionato: premi Ctrl+C"; }
  };
}

function importaAsta() {
  apri(`<h3>Importa un'asta</h3><p class="lbl">Incolla il testo esportato. Sostituisce l'asta in corso.</p>
    <textarea id="txt"></textarea><p class="alert" id="errimp" hidden></p>
    <div class="actions"><button class="btn" data-close>Annulla</button><button class="btn primary" id="okimp">Importa</button></div>`);
  $("#okimp").onclick = () => {
    try {
      const x = JSON.parse($("#txt").value).asta;
      if (!x || !Array.isArray(x.squadre) || !Array.isArray(x.log)) throw new Error();
      S.asta = { ...x, attiva: true };
      chiudi(); vista("asta"); aggiorna();
    } catch (e) { const el = $("#errimp"); el.textContent = "Testo non valido: incolla esattamente quello copiato da Esporta l'asta."; el.hidden = false; }
  };
}

function risultatiRicerca() {
  const q = $("#cerca-asta").value.trim().toLowerCase();
  const box = $("#risultati");
  if (!q) { box.hidden = true; return []; }
  const l = DATA.giocatori.filter((g) => !OWNER.has(g.id) && g.nome.toLowerCase().includes(q))
    .sort((a, b) => (a.nome.toLowerCase().startsWith(q) ? 0 : 1) - (b.nome.toLowerCase().startsWith(q) ? 0 : 1) || b.pg - a.pg).slice(0, 7);
  box.innerHTML = l.map((g, i) => `<button class="${i === 0 ? "sel" : ""}" data-chiama="${g.id}"><span class="role ${g.r}">${g.r}</span>
    <span><b>${esc(g.nome)}</b>${tagSalute(g)} <small class="lbl" style="text-transform:capitalize">${esc(nomeSq(g.sq))}</small></span><span class="lbl">${fmt(g.pg, 2)} pt/g · ${prezzoAtteso(g)} cr</span></button>`).join("")
    || `<div class="lbl" style="padding:8px 10px">Nessun giocatore libero con questo nome.</div>`;
  box.hidden = false;
  return l;
}

// --- eventi -----------------------------------------------------------------------------
// apertura e chiusura della formazione tipo a tendina: il campo scorre verso l'alto dietro al
// titolo (solo transform, niente ridimensionamento dell'SVG) mentre il riquadro si accorcia.
document.addEventListener("click", (e) => {
  const s = e.target.closest("#campo > summary");
  if (!s || !Element.prototype.animate || !matchMedia("(prefers-reduced-motion: no-preference)").matches) return;
  e.preventDefault();
  const det = s.parentElement, box = det.querySelector(".campo-box"), campo = det.querySelector(".campo");
  if (det.dataset.anim) return;
  det.dataset.anim = "1";
  const apri = !det.open;
  det.classList.toggle("chiude", !apri);
  if (apri) det.open = true;
  const h = campo.getBoundingClientRect().height;
  const opz = { duration: 280, easing: apri ? "cubic-bezier(.2,.7,.3,1)" : "cubic-bezier(.5,0,.8,.4)" };
  const su = [{ transform: "translateY(0)" }, { transform: `translateY(${-h}px)` }];
  const alto = [{ height: h + "px" }, { height: "0px" }];
  box.classList.add("scorre");
  const a = box.animate(apri ? alto.slice().reverse() : alto, opz);
  campo.animate(apri ? su.slice().reverse() : su, opz);
  a.finished.then(() => {
    if (!apri) det.open = false;
    det.classList.remove("chiude");
    box.classList.remove("scorre");
    delete det.dataset.anim;
  });
});
// formazione tipo aperta o chiusa: la scelta resta fra un ricalcolo e l'altro
document.addEventListener("toggle", (e) => {
  if (e.target.id === "campo") { S.campoChiuso = !e.target.open; salva(); }
}, true);
document.addEventListener("click", (e) => {
  const t = e.target.closest("button, [data-close]");
  if (e.target.id === "overlay") return chiudi();
  if (!t) return;
  const d = t.dataset;
  if (d.close !== undefined) return chiudi();
  if (d.espandi) return espandi(t);
  if (d.open) return scheda(+d.open);
  if (d.abb) return mostraAbbinamento(+d.abb);
  if (d.chiama) { chiudi(); return chiama(+d.chiama); }
  if (d.squadra !== undefined) { S.asta.scelta = +d.squadra; return renderChiamato(); }
  if (d.occ) { chiudi(); return chiama(+d.occ); }
  if (t.id === "asta-avvia") return calcioDInizio(t);
  if (t.id === "asta-chiudi") return dialogoChiusura();
  if (t.id === "registra") return registraDaForm();
  if (t.id === "annulla-ultimo") return annullaUltimo();
  if (t.id === "esporta-asta") return esportaAsta();
  if (t.id === "importa-asta") return importaAsta();
  if (d.vedi !== undefined) { S.asta.aperta = S.asta.aperta === +d.vedi ? null : +d.vedi; return renderAsta(); }
  if (inAsta() && d.add) {
    const id = +d.add;
    const g = BY_ID.get(id);
    return apri(`<h3>Annullare l'acquisto?</h3><p class="lbl">${esc(g.nome)} torna libero e i crediti tornano disponibili.</p>
      <div class="actions"><button class="btn" data-close>No</button><button class="btn primary" data-annulla="${id}">Annulla l'acquisto</button></div>`);
  }
  if (d.annulla) { rimuoviAcquisto(+d.annulla); chiudi(); return aggiorna(); }
  if (inAsta() && d.prendi) return chiama(+d.prendi);
  if (d.add) {
    const id = +d.add;
    if (mia()[id] != null) { delete mia()[id]; chiudi(); return aggiorna(); }
    return chiediPrezzo(id);
  }
  if (d.taken) {
    const id = +d.taken;
    if (S.presi[id]) delete S.presi[id]; else { S.presi[id] = true; delete mia()[id]; }
    chiudi(); return aggiorna();
  }
  if (d.prendi) { const id = +d.prendi; const g = BY_ID.get(id); mia()[id] = prezzoAtteso(g); S.aperte = {}; return aggiorna(); }
  if (d.alt) { const id = +d.alt; S.aperte[id] = !S.aperte[id]; return renderRosa(); }
  if (d.piano) { S.piano = d.piano; S.aperte = {}; return aggiorna(); }
  if (d.modo) { S.modo = d.modo; S.aperte = {}; return aggiorna(); }
  if (d.bud) {
    if (d.bud === "auto") S.budgetRuolo = null;
    else if (!S.budgetRuolo) {
      // Si parte dalla divisione attuale: scelti + suggeriti per ruolo.
      const b = { P: 0, D: 0, C: 0, A: 0 };
      for (const [id, pz] of Object.entries(mia())) { const g = BY_ID.get(+id); if (g) b[g.r] += +pz; }
      for (const c of SUGG.lista) b[c.g.r] += c.p;
      S.budgetRuolo = b;
    }
    S.aperte = {}; return aggiorna();
  }
  if (d.r !== undefined && t.parentElement.id === "ruoli") {
    S.f.r = d.r; document.querySelectorAll("#ruoli button").forEach((b) => b.setAttribute("aria-pressed", b === t));
    return renderListone();
  }
  if (d.view) return vista(d.view);
  if (t.id === "lega-reset") { S.nSq = S.cred = S.budgetRuolo = null; S.aperte = {}; applicaLega(); return aggiorna(); }
  if (t.id === "svuota") { S.piani[S.piano] = {}; return aggiorna(); }
  if (t.id === "esporta") return esporta();
  if (t.id === "importa") return importa();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#overlay").hidden) chiudi(); });
document.addEventListener("change", (e) => {
  const id = e.target.id;
  if (id === "margine") { S.margine = +e.target.value; aggiorna(); }
  if (id === "nsq") cambiaLega("nSq", e.target.value);
  if (id === "cred") cambiaLega("cred", e.target.value);
  if (id.startsWith("bud-") && S.budgetRuolo) { S.budgetRuolo[id.slice(4)] = Math.max(0, Math.round(+e.target.value || 0)); S.aperte = {}; aggiorna(); }
  if (id === "tetto") { S.tetto = +e.target.value; aggiorna(); }
  if (id === "esenzione") { S.esenzioneP = e.target.checked; aggiorna(); }
  if (id === "sq") { S.f.sq = e.target.value; renderListone(); }
  if (id === "hide") { S.f.hide = e.target.checked; renderListone(); }
  if (id === "salute") { S.f.salute = e.target.value; renderListone(); }
});
$("#q").addEventListener("input", (e) => { S.f.q = e.target.value; renderListone(); });
$("#cerca-asta").addEventListener("input", risultatiRicerca);
$("#cerca-asta").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); const l = risultatiRicerca(); if (l.length) chiama(l[0].id); }
  if (e.key === "Escape") { $("#risultati").hidden = true; }
});
$("#pmax").addEventListener("input", (e) => { S.f.pmax = +e.target.value || null; renderListone(); });
document.querySelector("thead").addEventListener("click", (e) => {
  const th = e.target.closest("th[data-k]"); if (!th) return;
  const k = th.dataset.k;
  S.sort = { k, dir: S.sort.k === k ? -S.sort.dir : (k === "nome" || k === "sq" || k === "fa" ? 1 : -1) };
  renderListone();
});

// --- titolo: anelli di cifre binarie che girano intorno alla sfera della O ------------------------
// Ogni cifra sta su un anello circolare visto di sbieco (un'ellisse inclinata). Sulla meta' davanti
// e' disegnata sopra la sfera, su quella dietro sotto; verso i lati si accorcia e verso il fondo
// si rimpicciolisce e sbiadisce, come farebbe un anello vero. Le cifre sono "Fanta" e "Oracle" in ASCII.
function anelliSfera() {
  const svg = document.getElementById("o-sfera");
  if (!svg) return;
  const NS = "http://www.w3.org/2000/svg", dietro = svg.querySelector(".dietro"), davanti = svg.querySelector(".davanti");
  const bin = (t) => [...t].map((c) => c.charCodeAt(0).toString(2).padStart(8, "0")).join("");
  const ANELLI = [
    { rx: 68, ry: 17, tilt: -17, cifre: bin("Fanta"), giro: 18, cls: "b1" },
    { rx: 61, ry: 27, tilt: 24, cifre: bin("Oracle"), giro: -26, cls: "b2" },
  ];
  const punti = [];
  for (const a of ANELLI) {
    [...a.cifre].forEach((ch, i) => {
      const els = [dietro, davanti].map((g) => {
        const t = document.createElementNS(NS, "text");
        t.setAttribute("class", a.cls); t.textContent = ch; t.setAttribute("opacity", "0");
        g.appendChild(t); return t;
      });
      punti.push({ a, f: i / a.cifre.length, els, lato: -1 });
    });
  }
  const disegna = (sec) => {
    for (const p of punti) {
      const { a } = p, th = 2 * Math.PI * (p.f + sec / a.giro), s = Math.sin(th), c = Math.cos(th);
      const k = (a.tilt * Math.PI) / 180, x0 = a.rx * c, y0 = a.ry * s;
      const x = x0 * Math.cos(k) - y0 * Math.sin(k), y = x0 * Math.sin(k) + y0 * Math.cos(k);
      const ang = (Math.atan2(-a.ry * c, a.rx * s) * 180) / Math.PI + a.tilt;
      const scorcio = Math.max(0.25, Math.hypot(s, (a.ry / a.rx) * c));   // piu' stretta ai lati
      const prof = (s + 1) / 2, sc = 0.72 + 0.38 * prof;                   // 0 in fondo, 1 davanti
      const lato = s >= 0 ? 1 : 0, el = p.els[lato];
      if (lato !== p.lato) { p.els[1 - lato].setAttribute("opacity", "0"); p.lato = lato; }
      el.setAttribute("transform", `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${ang.toFixed(1)}) scale(${(sc * scorcio).toFixed(3)} ${sc.toFixed(3)})`);
      el.setAttribute("opacity", (0.2 + 0.8 * prof).toFixed(2));
    }
  };
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return disegna(0);
  let ultimo = -1e9;
  const giro = (ms) => { if (ms - ultimo > 33) { disegna(ms / 1000); ultimo = ms; } requestAnimationFrame(giro); };
  requestAnimationFrame(giro);
}
anelliSfera();

// --- avvio ------------------------------------------------------------------------------
fetch("data.json").then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }).then((d) => {
  DATA = d; META = d.meta; BY_ID = new Map(d.giocatori.map((g) => [g.id, g]));
  carica();
  for (const g of d.giocatori) { g.pa0 = g.pa; g.val0 = g.val; g.aff0 = g.aff; }
  preparaGiornate();
  LEGA0 = { n: META.n_squadre, cr: META.crediti };
  applicaLega();
  if (inAsta()) vista("asta");
  $("#sq").innerHTML += d.squadre.map((s) => `<option value="${s.slug}">${esc(s.nome)}</option>`).join("");
  aggiorna();
}).catch((err) => {
  $("#meta").textContent = "Impossibile caricare data.json: " + err.message + ". Rigenera i dati con `make export`.";
  $("#rows").innerHTML = '<tr><td colspan="13" class="l loading">Dati non disponibili.</td></tr>';
});
