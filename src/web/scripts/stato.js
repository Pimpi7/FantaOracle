// FantaOracle — Stato dell'applicazione, persistenza e utilita' di base.
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
// Il mercato segue l'asta. INFL e' il conto generale: crediti che restano davvero contro quelli
// che servirebbero, ai prezzi di partenza, per riempire le rose. FATT e' il fattore di ogni ruolo
// (in un'asta per ruolo il ruolo in corso segue il suo termometro, i ruoli dopo i crediti che
// avanzano); MERC e' il quadro completo, calcolato in sincronizzaAsta. Fuori dall'asta vale tutto 1.
let INFL = 1, FATT = { P: 1, D: 1, C: 1, A: 1 }, MERC = null;
let SPESA_RUOLO = { P: 0, D: 0, C: 0, A: 0 };      // spesa attesa della lega per ruolo, ai prezzi di partenza
const ORDINE_RUOLI = ["P", "D", "C", "A"];         // l'ordine delle fasi nell'asta per ruolo
const PESO_PARTENZA = 0.15;                        // quanto pesa il punto di partenza sul termometro di un ruolo
const FINESTRA = 6;                                // acquisti nella media mobile del grafico
const limita = (x) => Math.min(2.5, Math.max(0.4, x));
const perRuolo = () => !!S.asta && S.asta.modo !== "libero";
// Un giocatore e' "buono" in due modi: per i nostri punti e' da titolare nella lega, oppure la
// guida di SOS Fanta lo mette in fascia alta o piu' su. Le due liste coincidono solo in parte,
// e servono entrambe: la prima dice quanto rende, la seconda quanto lo vorranno gli altri.
// Fra i buoni, l'ordine e' per fascia (dalla piu' alta; chi non ne ha una va in fondo), poi per punti.
const indiceFascia = (nome, ripiego) => { const i = (META.fasce || []).indexOf(nome); return i < 0 ? ripiego : i; };
const inFasciaAlta = (g) => g.fa != null && g.fa <= indiceFascia("Fascia alta", 4);
const buono = (g) => g.pg >= SOGLIA[g.r] || inFasciaAlta(g);
const perFascia = (a, b) => ((a.fa ?? 99) - (b.fa ?? 99)) || b.pg - a.pg;
// In asta i crediti si colorano da verde (pieni) a rosso (finiti), in proporzione.
function cr(val, max) {
  if (!inAsta()) return String(val);
  const f = Math.max(0, Math.min(1, max > 0 ? val / max : 0));
  return `<span class="cr" style="color:hsl(${Math.round(f * 128)} var(--cs) var(--cl))">${val}</span>`;
}
const prezzoAtteso = (g) => Math.max(1, Math.round(g.pa * (FATT[g.r] ?? 1) * (1 + S.margine)));
