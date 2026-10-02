// FantaOracle — Asta: "Cosa fare adesso". Crediti per ruolo e giocatori da puntare, rifatti a ogni acquisto.
"use strict";

// --- i tetti ("fin dove spingerti") -------------------------------------------------------
// Ogni tetto costa una decina di ottimizzazioni: si calcolano uno alla volta, in sottofondo, e
// valgono finche' lo stato dell'asta non cambia. Li usa anche il riquadro del giocatore chiamato:
// se il chiamato era fra i consigliati, il suo tetto e' gia' pronto.
let TETTI = { chiave: null, val: new Map(), coda: [], timer: null };
let ULTIMO_TASTO = 0;
document.addEventListener("keydown", () => { ULTIMO_TASTO = Date.now(); }, true);

function chiaveStato() {
  const u = S.asta.log[S.asta.log.length - 1];
  return [S.asta.log.length, u ? `${u.id}.${u.t}.${u.p}` : "", JSON.stringify(mia()), S.margine, S.modo, S.tetto, S.esenzioneP, S.asta.io, META.crediti, META.n_squadre].join("|");
}
function tetti() {
  const k = chiaveStato();
  if (TETTI.chiave !== k) { clearTimeout(TETTI.timer); TETTI = { chiave: k, val: new Map(), coda: [], timer: null }; }
  return TETTI;
}
function testoTetto(v) {
  if (!v) return `<span class="lbl">tetto …</span>`;
  if (v.max == null) return `<span class="lbl" title="${esc(v.motivo)}">tetto non calcolabile</span>`;
  if (!v.max) return `<span title="${esc(v.motivo)}">ora non conviene</span>`;
  return `<span title="Fin dove spingerti: ${esc(v.motivo)}">tetto <b>${v.max}</b></span>`;
}
function avanzaTetti() {
  const T = tetti();
  clearTimeout(T.timer);
  T.timer = setTimeout(() => {
    if (!inAsta() || TETTI !== T || T.chiave !== chiaveStato()) return;
    // chi sta scrivendo nella ricerca non deve sentire il calcolo: si aspetta che si fermi
    if (Date.now() - ULTIMO_TASTO < 1200) return avanzaTetti();
    const id = T.coda.find((x) => !T.val.has(x) && !OWNER.has(x));
    if (id == null) return;
    T.val.set(id, calcolaSpinta(id));
    const el = document.querySelector(`#adesso [data-tetto="${id}"]`);
    if (el) el.innerHTML = testoTetto(T.val.get(id));
    avanzaTetti();
  }, 200);
}

// --- il riquadro ------------------------------------------------------------------------------
// Sopra, i crediti ruolo per ruolo come sono adesso: quanto hai gia' speso e quanto la rosa
// migliore che si puo' ancora fare ne mette in ogni ruolo, accanto a quanto ne aveva il piano.
// Sotto, i giocatori da puntare nel ruolo in corso (o nel prossimo in cui hai posto), con il
// prezzo atteso di adesso, il tetto e chi prendere se sfumano.
function renderConsigli() {
  const el = $("#adesso");
  if (!el) return;
  const me = MERC.st[S.asta.io], rosa = mia();
  const zero = () => ({ P: 0, D: 0, C: 0, A: 0 });
  const speso = zero(), daSpendere = zero();
  for (const [id, pz] of Object.entries(rosa)) { const g = BY_ID.get(+id); if (g) speso[g.r] += +pz; }
  for (const c of SUGG.lista) daSpendere[c.g.r] += c.p;
  const prezziPiano = S.asta.obiettiviPrezzi || {};
  let piano = null;
  if ((S.asta.obiettivi || []).length) {
    piano = zero();
    for (const id of S.asta.obiettivi) { const g = BY_ID.get(+id); if (g) piano[g.r] += +(prezziPiano[id] ?? prezzoPiano(g)); }
  }

  if (me.liberiTot <= 0) {
    el.innerHTML = `<h2>Cosa fare adesso</h2><p class="lbl">La tua rosa è completa: hai speso ${me.spesa} crediti su ${META.crediti}.</p>`;
    return;
  }

  // il ruolo a fuoco: quello in corso se hai ancora posto, altrimenti il prossimo in cui ne hai
  const fase = MERC.fase;
  const fuoco = !perRuolo() ? null
    : fase && me.liberi[fase] > 0 ? fase
    : ORDINE_RUOLI.slice(fase ? ORDINE_RUOLI.indexOf(fase) + 1 : 0).find((r) => me.liberi[r] > 0) || null;

  const riquadro = (r) => {
    const lib = me.liberi[r], tot = speso[r] + daSpendere[r];
    const conf = piano ? `<span class="box-s" title="Crediti che il piano di partenza dava al ruolo, e quanti gliene vanno adesso fra spesi e da spendere">piano ${piano[r]} → ora <b>${tot}</b></span>` : `<span class="box-s">in tutto ${tot}</span>`;
    if (lib <= 0) return `<div class="box ruolo fatto" title="${NOMI_RUOLO[r]}: ruolo completo">
      <b>${speso[r]}</b><span class="box-l"><span class="role ${r}">${r}</span><span>spesi, completo</span></span>${conf}</div>`;
    return `<div class="box ruolo${r === fuoco ? " in-corso" : ""}" title="${NOMI_RUOLO[r]}: quanto mette in questo ruolo la rosa migliore che puoi ancora fare">
      <b>${daSpendere[r]}</b><span class="box-l"><span class="role ${r}">${r}</span><span>da spendere, ${lib} slot</span></span>
      <span class="box-s">già spesi ${speso[r]}</span>${conf}</div>`;
  };

  const avanzo = me.crediti - SUGG.costo;
  const testa = `${me.crediti} crediti per ${me.liberiTot} slot${avanzo > 0 && !SUGG.errore ? `, ${avanzo} di margine` : ""}`;

  let lista = SUGG.lista.filter((c) => !fuoco || c.g.r === fuoco).sort((a, b) => b.p - a.p || b.g.pg - a.g.pg);
  if (!fuoco) lista = lista.slice(0, 8);
  const T = tetti();
  const obiettivi = new Set((S.asta.obiettivi || []).map(Number));
  const riga = (c) => {
    const g = c.g, alt = (SUGG.alt[g.id] || [])[0];
    return `<div class="occ cons">
      <span class="role ${g.r}">${g.r}</span>
      <span class="who"><span class="occ-n">${dotFascia(g)}<button class="ic nome" data-open="${g.id}" title="Apri la scheda"><b>${esc(g.nome)}</b></button><small>${esc(nomeSq(g.sq))}</small>${obiettivi.has(g.id) ? '<span class="tag piano" title="Era nel piano da cui sei partito">PIANO</span>' : ""}${c.uno ? '<span class="tag uno" title="Slot riservato a un giocatore da 1 credito">1 CR</span>' : ""}</span>
        <span class="occ-f">${alt ? `se sfuma: ${esc(alt.c.g.nome)}, ${alt.c.p} cr` : "nessuna alternativa nel budget"}</span></span>
      <span class="num"><b>${fmt(g.pg, 2)}</b> pt/g · atteso <b>${c.p}</b> cr<br><span data-tetto="${g.id}">${testoTetto(T.val.get(g.id))}</span></span>
      <button class="btn small" data-chiama="${g.id}">Chiama</button></div>`;
  };

  let titolo = "Da puntare";
  let nota = "";
  if (fuoco) {
    titolo = `${NOMI_RUOLO[fuoco]} da puntare`;
    if (fase && fuoco !== fase) nota = `<p class="lbl">Hai già tutti i ${NOMI_RUOLO[fase].toLowerCase()}: il prossimo ruolo in cui hai posto è ${NOMI_RUOLO[fuoco].toLowerCase()}.</p>`;
  }
  el.innerHTML = `<h2>Cosa fare adesso</h2>
    <p class="lbl cons-testa">Ricalcolato a ogni acquisto, tuo o degli altri: ${testa}.</p>
    ${SUGG.errore ? `<p class="alert">${esc(SUGG.errore)}</p>` : ""}
    ${SUGG.nota ? `<p class="nota">${esc(SUGG.nota)}</p>` : ""}
    <div class="boxes ruoli-ora">${RUOLI.map(riquadro).join("")}</div>
    <h3 class="cons-t">${titolo}<span class="lbl">prezzo atteso di adesso e fin dove spingerti</span></h3>
    ${nota}
    ${lista.length ? lista.map(riga).join("") : `<p class="lbl">Nessun suggerimento${SUGG.errore ? "" : " per questo ruolo"}.</p>`}`;
  T.coda = lista.map((c) => c.g.id);
  avanzaTetti();
}
