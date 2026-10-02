// FantaOracle — Budget e rendering della rosa.
"use strict";

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
