// FantaOracle — Rendering del listone.
"use strict";

function renderListone() {
  const l = filtrati();
  const { pos, tot } = posizioni();
  const m = mia();
  $("#count").textContent = `${l.length} giocatori`;
  applicaNeutro();
  $("#hide-strat").checked = !!S.nascondiStrategia;
  $("#hide").closest("label").hidden = neutroPreAsta();   // gli esclusi sono una scelta mia: il filtro (e il loro numero) li tradirebbe
  $("#hide-strat-lbl").textContent = "Nascondi la mia strategia";
  const nEscl = Object.keys(S.presi).length;
  $("#hide-lbl").textContent = inAsta() ? `Nascondi i presi (${nEscl})` : nEscl ? `Nascondi gli esclusi (${nEscl})` : "Nascondi gli esclusi";
  const neutro = strategiaNascosta();
  const out = [];
  for (const g of l) {
    const cls = neutro ? "" : m[g.id] != null ? "mine" : S.presi[g.id] ? "taken" : suggerito(g) ? "sugg" : "";
    const own = inAsta() && OWNER.has(g.id) ? `<span class="tag own">${esc(S.asta.squadre[OWNER.get(g.id)].nome)}</span>` : "";
    const obj = !neutro && inAsta() && S.asta.obiettivi.includes(g.id) && !OWNER.has(g.id) ? '<span class="tag obj" title="Era nel piano da cui sei partito">OBIETTIVO</span>' : "";
    const azioni = inAsta()
      ? (OWNER.has(g.id) ? "" : `<button class="btn small" data-chiama="${g.id}" title="Apri nel pannello dell'asta">Chiama</button>`)
      : neutro ? `<button class="ic" data-prezzo="${g.id}" title="Metti nella mia rosa" aria-label="Mia rosa">+</button>`
      : `<button class="ic ${m[g.id] != null ? "on" : ""}" data-add="${g.id}" title="${m[g.id] != null ? "Togli dalla mia rosa" : "Metti nella mia rosa"}" aria-label="Mia rosa">${m[g.id] != null ? "✓" : "+"}</button>
        ${S.presi[g.id] ? `<button class="ic on" data-taken="${g.id}" title="Rimetti fra i disponibili" aria-label="Rimetti fra i disponibili">✕</button>` : ""}`;
    const aff = g.aff ?? 0;
    out.push(`<tr class="${cls}" data-id="${g.id}">
      <td class="rank" title="${pos.get(g.id)}° su ${tot}">${pos.get(g.id)}</td>
      <td class="l"><span class="role ${g.r}">${g.r}</span></td>
      <td class="f">${dotFascia(g, true)}</td>
      <td class="l nm"><button data-open="${g.id}">${esc(g.nome)}</button>${tag(g, true)}${obj}${own}</td>
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
  $("#rows").innerHTML = out.join("") || `<tr><td colspan="13" class="l loading">Nessun giocatore con questi filtri${strategiaNascosta() ? " (la tua strategia e' nascosta)" : ""}.</td></tr>`;
  document.querySelectorAll("th[data-k]").forEach((th) => {
    th.classList.toggle("sorted", th.dataset.k === S.sort.k);
    th.classList.toggle("asc", th.dataset.k === S.sort.k && S.sort.dir === 1);
  });
}
