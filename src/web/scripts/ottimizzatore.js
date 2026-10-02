// FantaOracle — Ottimizzatore della rosa.
"use strict";

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
