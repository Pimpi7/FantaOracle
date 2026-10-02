// FantaOracle — Scheda giocatore e dialoghi.
"use strict";

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
  martello: '<path d="M13 4l7 7-3 3-7-7z"/><path d="M11.5 11.5L4 19M13 20.5h8"/>',
  cerca: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
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
    : neutroPreAsta() ? `<button class="btn primary" data-prezzo="${g.id}">Metti nella mia rosa</button>`
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
  const conferma = () => {
    const p = Math.max(1, Math.round(+$("#prezzo").value || 1));
    // a listone neutro non so se e' gia' mio: lasciando il prezzo proposto non tocco quello che avevo dato
    if (strategiaNascosta() && mia()[id] != null && p === prezzoAtteso(g)) { chiudi(); return aggiorna(); }
    mia()[id] = p; delete S.presi[id]; chiudi(); aggiorna();
  };
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
