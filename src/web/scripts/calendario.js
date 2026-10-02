// FantaOracle — Calendario e alternanza (la griglia di FantaLab).
"use strict";

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
