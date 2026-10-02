// FantaOracle — Il giro delle chiamate.
"use strict";

// --- il giro delle chiamate -----------------------------------------------------------------
// Si chiama a giro: le squadre sono nell'ordine in cui siedono (in senso orario), verso 1 le
// scorre in quell'ordine, -1 al contrario, 0 spegne il giro. Chi ha gia' riempito il ruolo in
// corso salta il turno. Dopo ogni acquisto tocca alla squadra dopo chi ha chiamato.
const puoChiamare = (t) => (MERC.fase ? t.liberi[MERC.fase] > 0 : t.liberiTot > 0);
function passo(da, verso) {
  const st = MERC.st, n = st.length;
  for (let k = 1; k <= n; k++) { const i = (((da + verso * k) % n) + n) % n; if (puoChiamare(st[i])) return i; }
  return null;
}
function chiChiama() {
  const g = S.asta.giro;
  if (!g || !g.verso || !MERC) return null;
  const n = MERC.st.length, i = ((g.turno % n) + n) % n;
  return puoChiamare(MERC.st[i]) ? i : passo(i, g.verso);
}
function muoviGiro(cosa) {
  const g = S.asta.giro;
  if (cosa === "verso") g.verso = g.verso === 1 ? -1 : 1;
  else if (cosa === "spegni") g.verso = 0;
  else if (cosa === "accendi") g.verso = 1;
  else {
    const chi = chiChiama(), a = chi == null ? null : passo(chi, g.verso * +cosa);
    if (a != null) g.turno = a;
  }
  salva(); renderAsta();
}

function renderGiro() {
  const el = $("#giro"), g = S.asta.giro, st = MERC.st, fase = MERC.fase;
  const totR = fase ? META.n_squadre * META.slot[fase] : 0;
  const faseHtml = !perRuolo() ? `<span class="giro-fase"><b>Chiamata libera</b></span>`
    : fase ? `<span class="giro-fase"><span class="role ${fase}">${fase}</span><b>${NOMI_RUOLO[fase]}</b><small>${totR - MERC.aperti[fase]}/${totR}</small></span>`
      : `<span class="giro-fase"><b>Rose complete</b></span>`;
  const chi = chiChiama();
  if (chi == null) {
    el.className = "giro";
    el.innerHTML = `${faseHtml}${g.verso ? "" : `<span class="giro-ctl"><button type="button" class="btn small" data-giro="accendi">Segui il giro delle chiamate</button></span>`}`;
    return;
  }
  const poi = passo(chi, g.verso), mio = chi === S.asta.io;
  el.className = "giro" + (mio ? " mio" : "");
  el.innerHTML = `${faseHtml}
    <span class="giro-chi">${mio ? "<b>Tocca a te chiamare</b>" : `Chiama <b>${esc(st[chi].nome)}</b>`}${poi != null && poi !== chi ? `<small>poi ${poi === S.asta.io ? "tu" : esc(st[poi].nome)}</small>` : ""}</span>
    <span class="giro-ctl">
      <button type="button" class="ic" data-giro="-1" title="Torna alla squadra prima" aria-label="Squadra prima">‹</button>
      <button type="button" class="ic" data-giro="1" title="Passa alla squadra dopo" aria-label="Squadra dopo">›</button>
      <button type="button" class="btn small" data-giro="verso" title="Inverti il verso del giro">${g.verso === 1 ? "↻ orario" : "↺ antiorario"}</button>
    </span>`;
}
