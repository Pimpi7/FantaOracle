// FantaOracle — La formazione tipo sul campo.
"use strict";

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
