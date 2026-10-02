// FantaOracle — Ordinamento, filtri del listone e legenda delle fasce.
"use strict";

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
