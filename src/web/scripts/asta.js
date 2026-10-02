// FantaOracle — Viste, tabellone e pannello dell'asta.
"use strict";

function vista(v) {
  $("#main").dataset.view = v;
  // Su computer "Listone e rosa" copre entrambe le viste.
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected",
    b.dataset.view === v || (v === "rosa" && b.dataset.view === "listone" && innerWidth > 900)));
  if (v === "asta" && inAsta() && MERC) renderMercato();
}

// da quanto dura l'asta: dall'avvio, o dal primo acquisto per le aste salvate prima di questo campo
function durata() {
  const t0 = S.asta?.inizio || S.asta?.log?.[0]?.ora;
  if (!t0) return "";
  const min = Math.max(0, Math.floor((Date.now() - Date.parse(t0)) / 60000));
  return min < 60 ? `da ${min}'` : `da ${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}'`;
}
setInterval(() => { const el = document.getElementById("asta-da"); if (el && inAsta()) el.textContent = durata(); }, 30000);

// Il tabellone: a che punto e' la lega, l'ultimo colpo, e chi puo' ancora fare paura.
function renderTabellone() {
  const st = statoSquadre(), nSq = st.length;
  const ass = { P: 0, D: 0, C: 0, A: 0 };
  for (const id of OWNER.keys()) { const g = BY_ID.get(id); if (g) ass[g.r]++; }
  const totSlot = RUOLI.reduce((a, r) => a + META.slot[r] * nSq, 0), nAss = OWNER.size;
  const barra = RUOLI.map((r) => {
    const cap = META.slot[r] * nSq;
    return `<span style="flex:${cap}" title="${NOMI_RUOLO[r]}: ${ass[r]} su ${cap}"><i style="--c:var(--r-${r.toLowerCase()});width:${(100 * ass[r] / cap).toFixed(1)}%"></i></span>`;
  }).join("");
  const u = S.asta.log[S.asta.log.length - 1], gu = u && BY_ID.get(u.id);
  const ultimo = gu
    ? `<div class="tb tb-ultimo"><b><span class="role ${gu.r}">${gu.r}</span>${esc(gu.nome)} <em>${u.p}</em></b><small>Ultimo · ${esc(S.asta.squadre[u.t].nome)}</small></div>`
    : `<div class="tb tb-ultimo"><b><em>Nessuno</em></b><small>Ultimo acquisto</small></div>`;
  const rivali = st.filter((t) => t.i !== S.asta.io && t.liberiTot > 0).sort((a, b) => b.maxOff - a.maxOff);
  const riv = rivali[0]
    ? `<div class="tb"><b>${esc(rivali[0].nome)} <span>${cr(rivali[0].maxOff, META.crediti - totSlot / nSq + 1)}</span></b><small>Rivale più ricco<span class="solo-desk"> · offerta max</span></small></div>`
    : "";
  $("#tabellone").innerHTML = `
    <div class="tb"><b><span>${nAss}<span class="den">/${totSlot}</span></span><span class="tb-bar">${barra}</span></b><small>Assegnati · P ${ass.P} D ${ass.D} C ${ass.C} A ${ass.A}</small></div>
    ${ultimo}${riv}`;
}

function renderControlloAsta() {
  const root = document.documentElement;
  if (inAsta()) {
    root.setAttribute("data-asta", "on");
    $("#tab-asta").hidden = false;
    $("#asta-ctl").innerHTML = `<span class="live"><span class="dot"></span>Live <span class="da" id="asta-da">${durata()}</span>
      <button id="asta-chiudi" title="Sospendi o chiudi l'asta">Esci</button></span>`;
    renderTabellone();
  } else {
    root.removeAttribute("data-asta");
    $("#tabellone").innerHTML = "";
    $("#tab-asta").hidden = true;
    if ($("#main").dataset.view === "asta") vista("listone");
    $("#asta-ctl").innerHTML = `<button class="asta-btn pulse" id="asta-avvia">${S.asta ? "Riprendi l'asta" : "Modalità asta"}<span class="ombra"></span><span class="pallone">${PALLONE}</span></button>`;
  }
}

function renderAsta() {
  const st = statoSquadre(), me = st[S.asta.io];

  // --- occasioni di fine ruolo ---
  // Nell'asta per ruolo si guardano solo i giocatori del ruolo in corso. Un giocatore buono (per
  // fascia o per punti) lo vuole chi cerca ancora un titolare e chi, pur avendo i suoi titolari,
  // ci guadagnerebbe una fascia. E' un'occasione quando chi lo vuole ha finito il budget di ruolo
  // (lo porti via con un credito in piu' del piu' ricco), oppure quando non lo vuole nessuno da
  // titolare: allora va via al prezzo di una riserva. Nell'ultimo ruolo contano invece gli slot
  // dei rivali che hanno ancora crediti. Si propongono dalla fascia piu' alta.
  const fase = MERC.fase, chi = chiChiama();
  const occ = [], resto = [];
  for (const r of perRuolo() ? (fase ? [fase] : []) : RUOLI) {
    const { buoni, bisogno, peggiore, perSquadra, altri, posti } = MERC.quadro[r];
    const tuttiRivali = st.filter((t) => t.i !== S.asta.io);
    if (me.liberi[r] <= 0) continue;
    const rivali = tuttiRivali.filter((t) => t.liberi[r] > 0);
    // il prezzo di una riserva: la mediana di quelli che riempiranno gli slot oltre i titolari
    const riserve = MERC.resti[r].slice(posti).sort((a, b) => a - b);
    const daRiserva = riserve.length ? Math.max(1, Math.round(riserve[riserve.length >> 1])) : 1;
    // A fine ruolo (ai rivali manca al piu' un quarto dei titolari) i buoni in piu' di quelli che
    // i rivali cercano restano fuori dai loro titolari: sono gli ultimi nell'ordine delle fasce.
    const titRivali = perSquadra * tuttiRivali.length, perMe = buoni.length - Math.round(altri);
    const fineRuolo = perRuolo() && perMe > 0 && altri <= Math.max(1, 0.25 * titRivali);
    const piuRicco = (l) => l.reduce((a, t) => Math.max(a, budgetSquadra(t, r)), 0);
    // Gli slot che restano ai rivali nel ruolo: per chi viene dopo, nella fila dei liberi per
    // prezzo, non c'e' posto nemmeno volendo.
    const slotRivali = rivali.reduce((a, t) => a + t.liberi[r], 0);
    // Nell'ultimo ruolo i crediti rimasti non servono ad altro: ogni rivale con uno slot offre
    // quello che ha, ma puo' comprare solo tanti giocatori quanti slot gli restano. Le offerte dei
    // rivali, slot per slot (chi ha due slot divide il budget, ma 1 credito lo offre sempre),
    // dalla piu' alta: sul piu' caro dei liberi pesa la prima, sul secondo la seconda, e cosi' via.
    const ultimo = perRuolo() && !MERC.futuri.length;
    const offerte = !ultimo ? [] : rivali.flatMap((t) => Array.from({ length: t.liberi[r] }, (_, j) => Math.max(1, budgetSquadra(t, r) / (j + 1)))).sort((a, b) => b - a);
    // In lista entrano i buoni e, con loro, chi e' almeno in fascia media: fuori dai buoni non
    // lo cerca chi vuole un titolare, ma solo chi ci guadagnerebbe una fascia.
    const finoA = indiceFascia("Fascia media", 7);
    const candidati = DATA.giocatori.filter((g) => g.r === r && !OWNER.has(g.id) && (buono(g) || (g.fa != null && g.fa <= finoA))).sort(perFascia);
    // I rivali riempiono gli slot partendo da chi vale di piu' sul mercato: il posto in fila di
    // un giocatore e' il suo posto fra i liberi del ruolo per prezzo atteso.
    const fila = new Map(DATA.giocatori.filter((g) => g.r === r && !OWNER.has(g.id)).sort((a, b) => b.pa - a.pa || b.pg - a.pg).map((g, i) => [g.id, i]));
    candidati.forEach((g) => {
      const pa = prezzoAtteso(g), iB = buoni.indexOf(g), k = fila.get(g.id), senzaPosto = perRuolo() && k >= slotRivali;
      const inPiu = iB < 0 || (fineRuolo && iB >= buoni.length - perMe);
      if (ultimo) {
        // finche' un rivale ha uno slot, un credito lo puo' sempre offrire
        const fino = Math.floor(offerte[k] ?? (rivali.length ? 1 : 0)), reale = Math.max(1, Math.min(pa, fino + 1));
        if (reale > me.maxOff || reale > pa * 0.75) return;
        occ.push({ g, pa, reale, maxRivali: fino, prima: k, ricco: Math.floor(offerte[0] ?? 0), ricchi: offerte.filter((x) => x >= 2).length, come: rivali.length ? "coda" : "solo" });
        return;
      }
      // In un'asta libera lo vogliono tutti quelli con uno slot. Per ruolo: chi cerca un titolare
      // (finche' i buoni non sono in piu') e chi ha titolari di fascia piu' bassa della sua.
      const vogliono = senzaPosto ? [] : !perRuolo() ? rivali
        : rivali.filter((t) => (!inPiu && bisogno[t.i] > 0) || (g.fa != null && g.fa < peggiore[t.i]));
      const altriRivali = rivali.filter((t) => !vogliono.includes(t));
      const daTitolare = vogliono.length ? piuRicco(vogliono) + 1 : 0;
      const comeRiserva = altriRivali.length ? Math.min(daRiserva, piuRicco(altriRivali) + 1) : 0;
      const reale = Math.min(pa, Math.max(1, daTitolare, comeRiserva));
      if (reale > me.maxOff || reale > pa * 0.75) return;
      const n = vogliono.filter((t) => budgetSquadra(t, r) >= 2).length;
      occ.push({ g, pa, reale, n, maxRivali: daTitolare - 1, riserva: comeRiserva > daTitolare, senzaPosto,
        come: !rivali.length ? "solo" : !vogliono.length ? "riserva" : n && daTitolare >= comeRiserva ? "rivali" : "secco" });
    });
    // Quando in lega restano pochi slot (in media non piu' di tre a squadra) le occasioni sono rare: nessun
    // buono costa il 25% in meno. Si mostrano comunque i migliori ancora liberi, a prezzo pieno, con fin
    // dove arriva il rivale piu' ricco.
    if (MERC.aperti[r] <= SLOT_RESTO * META.n_squadre) {
      resto.push({ r, aperti: MERC.aperti[r], fino: rivali.length ? Math.floor(piuRicco(rivali)) : null,
        lista: DATA.giocatori.filter((g) => g.r === r && !OWNER.has(g.id) && g.pg > 0).sort((a, b) => b.pg - a.pg).slice(0, 6 + NMIGLIORI) });
    }
  }
  occ.sort((a, b) => perFascia(a.g, b.g));
  const mostrate = new Set(occ.slice(0, 6).map((o) => o.g.id));
  let testa;
  if (!perRuolo()) {
    const libLega = RUOLI.map((r) => `${r} ${MERC.aperti[r]}`).join(" · ");
    testa = `<div class="lbl" style="margin:-4px 0 8px">Slot ancora liberi in lega: ${libLega} · mercato ${INFL >= 1 ? "+" : ""}${Math.round((INFL - 1) * 100)}% sui prezzi attesi</div>`;
  } else if (!fase) testa = `<p class="lbl">Tutte le rose sono complete.</p>`;
  else {
    const qf = MERC.quadro[fase], q = { buoni: qf.buoni.length, posti: qf.posti, mio: Math.ceil(qf.mio), avanzo: qf.buoni.length - qf.posti };
    const tot = META.n_squadre * META.slot[fase], fatti = tot - MERC.aperti[fase], f = FATT[fase];
    const deiRuolo = { P: "dei portieri", D: "dei difensori", C: "dei centrocampisti", A: "degli attaccanti" }[fase];
    const esito = q.avanzo > 0 ? box({ v: q.avanzo === 1 ? "Ne avanza 1" : `Ne avanzano ${q.avanzo}`, l: "più buoni che posti da titolare", ic: "ok", tono: "ok", cls: "parola", title: "Gli ultimi buoni andranno via a poco: conviene aspettare" })
      : q.avanzo < 0 ? box({ v: q.avanzo === -1 ? "Ne manca 1" : `Ne mancano ${-q.avanzo}`, l: "più posti da titolare che buoni", ic: "allerta", tono: "ko", cls: "parola", title: "I buoni non bastano per tutti: i prezzi salgono, non aspettare l'ultimo" })
        : box({ v: "In pari", l: "tanti buoni quanti posti da titolare", ic: "pari", tono: "med", cls: "parola" });
    testa = `<div class="boxes fase-box">
      ${box({ v: NOMI_RUOLO[fase], l: `${fatti} su ${tot} assegnati`, ic: "martello", cls: "parola", sub: barra(fatti / tot) })}
      ${box({ v: q.buoni, l: "buoni ancora liberi", ic: "stella", title: `${NOMI_RUOLO[fase]} liberi in fascia alta o più su per SOS Fanta, oppure da titolare per i nostri punti (almeno ${fmt(SOGLIA[fase], 2)} a giornata)` })}
      ${box({ v: q.posti, l: "posti da titolare da riempire", ic: "persone", sub: q.mio ? `${q.mio} ${q.mio === 1 ? "è tuo" : "sono tuoi"}` : "i tuoi li hai" })}
      ${esito}
      ${box({ v: pct(f), l: `prezzi ${deiRuolo} sul previsto`, ic: "polso", tono: f >= 1.1 ? "meno" : f <= 0.9 ? "piu" : "",
        title: MERC.futuri.length ? `Nei ruoli dopo i prezzi sono al ${pct(FATT[MERC.futuri[0]])} del previsto: quello che si spende adesso manca dopo` : "Ultimo ruolo: i crediti che restano si spendono qui" })}
    </div>${fasceLibere(fase)}`;
  }
  // La riga di un giocatore, uguale per le occasioni e per i migliori rimasti; `num` e' il suo blocco di numeri.
  const rigaOcc = (g, num) => `<div class="occ">
        <span class="role ${g.r}">${g.r}</span>
        <span class="who"><span class="occ-n">${dotFascia(g)}<button class="nome-occ" data-open="${g.id}" title="Apri la scheda"><b>${esc(g.nome)}</b></button><small>${esc(nomeSq(g.sq))}</small></span>
          <span class="occ-f">${g.fa == null ? "senza fascia" : esc(META.fasce[g.fa]) + (g.fi ? ", stimata" : "")}${!inFasciaAlta(g) && g.pg >= SOGLIA[g.r] ? ", da titolare per i nostri punti" : ""}</span></span>
        <span class="num">${num}</span>
        <button class="btn small" data-occ="${g.id}">Chiama</button></div>`;
  const migliori = resto.map(({ r, aperti, fino, lista }) => {
    const l = lista.filter((g) => !mostrate.has(g.id)).slice(0, NMIGLIORI);
    if (!l.length) return "";
    return `<div class="occ-sub"><b>${NOMI_RUOLO[r]}: i migliori rimasti</b> · ${aperti === 1 ? "resta 1 slot" : `restano ${aperti} slot`} in lega${fino >= 1 ? `, il rivale più ricco arriva a ${fino} cr` : ""}</div>
      <div class="occ-resto">${l.map((g) => rigaOcc(g, `<b>${fmt(g.pg, 2)}</b> pt/g · <b>${prezzoAtteso(g)}</b> cr<br><span>prezzo atteso</span>`)).join("")}</div>`;
  }).join("");
  $("#occasioni").className = "card" + (occ.length ? " hot" : "");
  $("#occasioni").innerHTML = `<h2>Occasioni di fine ruolo</h2>${testa}
    ${occ.length ? occ.slice(0, 6).map((o) => rigaOcc(o.g, `<b>${fmt(o.g.pg, 2)}</b> pt/g · <s>${o.pa}</s> <b>${o.reale}</b> cr<br><span title="${esc(perche(o).lungo)}">${perche(o).corto}</span>`)).join("")
      : perRuolo() && !fase ? "" : `<p class="lbl">Nessuna per ora. Compaiono quando un giocatore buono può costare molto meno del previsto: chi lo vuole ha finito il budget${perRuolo() ? ", oppure nessun rivale lo vuole più da titolare" : ""}. Li vedrai qui dalla fascia più alta, con il prezzo realistico.</p>`}${migliori}`;

  // --- squadre ---
  // Il budget di ruolo dei rivali e' una stima (crediti meno la spesa media dei ruoli dopo). Per
  // te c'e' di meglio: quanto mette nel ruolo in corso la rosa migliore che puoi ancora fare.
  const mioRuolo = fase && me.liberi[fase] > 0 && !SUGG.errore
    ? Math.max(1, Math.min(me.maxOff, SUGG.lista.filter((c) => c.g.r === fase).reduce((a, c) => a + c.p, 0) - (me.liberi[fase] - 1)))
    : MERC.comodo[S.asta.io];
  $("#squadre").innerHTML = `<h2>Squadre</h2><div style="overflow-x:auto"><table class="sq">
    <thead><tr><th class="l">Squadra</th><th>Crediti</th><th title="Offerta massima possibile adesso">Max</th>${fase && conBudgetDiRuolo(fase) ? `<th title="Budget di ruolo: quanto può mettere su un giocatore del ruolo in corso senza intaccare i crediti per i ruoli dopo">Ruolo</th>` : ""}<th class="l" title="Slot liberi per ruolo">Liberi ${RUOLI.map((r) => `<span class="lr ${r}">${r}</span>`).join("·")}</th><th></th></tr></thead>
    <tbody>${st.map((t) => `<tr class="${t.i === S.asta.io ? "io" : ""}">
      <td class="l">${esc(t.nome)}${chi === t.i ? '<span class="tag turno" title="Tocca a questa squadra chiamare">CHIAMA</span>' : ""}</td><td>${cr(t.crediti, META.crediti)}</td><td>${cr(t.maxOff, MAXOFF0())}</td>${fase && conBudgetDiRuolo(fase) ? `<td${t.i === S.asta.io ? ' title="Per te vale il tuo piano di adesso: quello che la rosa migliore mette ancora in questo ruolo, tenendo 1 credito per gli altri slot del ruolo"' : ""}>${t.liberi[fase] > 0 ? (t.i === S.asta.io ? mioRuolo : MERC.comodo[t.i]) : "–"}</td>` : ""}
      <td class="l lib">${RUOLI.map((r) => `<span class="lr ${r}${t.liberi[r] <= 0 ? " zero" : ""}" title="${NOMI_RUOLO[r]} liberi">${t.liberi[r]}</span>`).join(" · ")}</td>
      <td><button class="btn small" data-vedi="${t.i}">${S.asta.aperta === t.i ? "Chiudi" : "Rosa"}</button></td></tr>
      ${S.asta.aperta === t.i ? `<tr><td colspan="6" class="l" style="white-space:normal">${RUOLI.map((r) => {
        const l = Object.entries(S.asta.squadre[t.i].rosa).map(([id, pz]) => ({ g: BY_ID.get(+id), pz })).filter((x) => x.g && x.g.r === r);
        return l.length ? `<div><span class="role ${r}">${r}</span> ${l.map((x) => `${esc(x.g.nome)} <b>${x.pz}</b>`).join(", ")}</div>` : "";
      }).join("") || "<span class='lbl'>Nessun acquisto.</span>"}</td></tr>` : ""}`).join("")}</tbody></table></div>
    <div class="row" style="margin-top:10px"><button class="btn small" id="esporta-asta">Esporta l'asta</button><button class="btn small" id="importa-asta">Importa</button></div>`;

  // --- ultimi acquisti ---
  const log = S.asta.log.slice(-8).reverse();
  $("#log").innerHTML = `<h2>Ultimi acquisti</h2><div class="log">${log.map((x) => {
    const g = BY_ID.get(x.id); if (!g) return "";
    const d = x.p - g.pa;
    return `<div><span><span class="role ${g.r}">${g.r}</span> ${esc(g.nome)}</span><span>${esc(S.asta.squadre[x.t].nome)} · <b>${x.p}</b><span class="scarto ${d > 0 ? "caro" : d < 0 ? "sconto" : ""}" title="Prezzo previsto prima dell'asta: ${g.pa}">${d > 0 ? "+" + d : d < 0 ? "−" + -d : "="}</span></span></div>`;
  }).join("") || "<p class='lbl'>Ancora nessuno.</p>"}</div>
    ${S.asta.log.length ? `<div class="row" style="margin-top:8px"><button class="btn small" id="annulla-ultimo">Annulla l'ultimo</button></div>` : ""}`;

  renderGiro();
  renderConsigli();
  renderMercato();
  renderChiamato();
}
