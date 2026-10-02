// FantaOracle — Il giocatore chiamato e la registrazione degli acquisti.
"use strict";

function chiama(id) {
  if (OWNER.has(id)) return;
  S.asta.chiamato = id;
  S.asta.scelta = null;
  $("#cerca-asta").value = "";
  chiudiRicerca();
  vista("asta");
  renderChiamato();
  // tutto il riquadro in vista, fino al bottone Aggiudicato, e il prezzo pronto da scrivere
  setTimeout(() => { $("#chiamata").scrollIntoView({ block: "nearest" }); const i = $("#prezzo-asta"); if (i) i.select(); }, 0);
}

// Fin dove conviene spingersi: il prezzo massimo a cui la rosa migliore CON lui
// resta forte almeno quanto la rosa migliore SENZA di lui. Si trova per
// bisezione rifacendo l'ottimizzazione a ogni prezzo provato.
function calcolaSpinta(id) {
  const g = BY_ID.get(id), me = statoSquadre()[S.asta.io];
  if (me.liberi[g.r] <= 0) return { max: 0, motivo: `hai già tutti i ${NOMI_RUOLO[g.r].toLowerCase()}` };
  const presi = S.presi;
  S.presi = { ...presi, [id]: true };
  const senza = ottimizza();
  S.presi = presi;
  const f0 = senza.errore ? -Infinity : senza.forza;
  const rosa = mia(), provate = new Map();
  const forzaA = (x) => {
    if (!provate.has(x)) { rosa[id] = x; const s = ottimizza(); delete rosa[id]; provate.set(x, s.errore ? -Infinity : s.forza); }
    // L'ottimizzatore e' un'euristica: a prezzi vicini puo' trovare rose un po' diverse. Ma una
    // rosa trovata pagandolo di piu' resta valida pagandolo di meno, quindi la forza "con lui"
    // a un prezzo e' almeno la migliore trovata a un prezzo uguale o piu' alto.
    let f = -Infinity;
    for (const [y, v] of provate) if (y >= x && v > f) f = v;
    return f;
  };
  forzaA(Math.min(prezzoAtteso(g), me.maxOff));
  if (forzaA(1) < f0 - 1e-9) return { max: 0, motivo: "anche a 1 credito, senza di lui la rosa è più forte" };
  let lo = 1, hi = me.maxOff, best = 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (forzaA(mid) >= f0 - 1e-9) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return { max: best, motivo: best >= me.maxOff ? "è la tua offerta massima" : "oltre, senza di lui la rosa è più forte" };
}

// Il riquadro "fin dove spingerti": il numero dell'asta. Giallo quando c'e' un limite a cui
// arrivare, rosso quando conviene lasciarlo; sotto, perche' e se quel limite copre il prezzo atteso.
function spintaDentro(val, pa, tetto) {
  const testo = (icona, etichetta, riga) => `<span class="sp-t"><span class="box-l">${ico(icona)}<span>${etichetta}</span></span>${riga ? `<span class="box-s">${riga}</span>` : ""}</span>`;
  if (!val) return `<b>…</b>${testo("martello", "calcolo fin dove spingerti", "")}`;
  if (!val.max) return `<b>Lascialo</b>${testo("no", "non conviene", esc(val.motivo))}`;
  return `<b>${val.max}</b>${testo("martello", "crediti: spingiti fino a qui", `<span class="esito">${
    val.max >= tetto ? "è tutto quello che puoi offrire" : val.max >= pa ? "copre il prezzo atteso" : "sotto il prezzo atteso: può andare oltre"}</span>`)}`;
}
const spintaClasse = (val) => `box spinta${val && !val.max ? " ko" : ""}`;

// Il giocatore chiamato: la scheda in versione da asta, con gli stessi riquadri. In alto quello
// che serve nei secondi della chiamata (fin dove spingerti, quanto vale, come sta), sotto le
// squadre: ogni riquadro dice quanto puo' ancora offrire e, toccandolo, segna chi l'ha preso.
function renderChiamato() {
  const box0 = $("#chiamato");
  const id = S.asta.chiamato;
  if (!id || OWNER.has(id)) {
    box0.innerHTML = `<p class="vuoto">${ico("cerca")}<span>Scrivi il nome del giocatore chiamato: vedi fin dove spingerti, quanto vale, come sta e chi può ancora contendertelo. Poi tocchi la squadra che l'ha preso e registri il prezzo.</span></p>`;
    return;
  }
  const g = BY_ID.get(id), st = statoSquadre(), me = st[S.asta.io];
  const chiave = `${id}|${S.asta.log.length}|${S.margine}|${S.modo}|${S.tetto}|${JSON.stringify(S.budgetRuolo)}`;
  const pa = prezzoAtteso(g), diff = Math.round(g.val ?? 0) - pa;
  const pronta = SPINTA.chiave === chiave ? SPINTA.val : null;
  const liberi = DATA.giocatori.filter((x) => x.r === g.r && !OWNER.has(x.id));
  const pos = 1 + liberi.filter((x) => x.pg > g.pg).length;

  const valore = [
    `<div class="${spintaClasse(pronta)}" id="spinta" title="${pronta ? esc(pronta.motivo) : ""}">${spintaDentro(pronta, pa, me.maxOff)}</div>`,
    box({ v: fmt(g.pg, 2), l: "punti a giornata", ic: "sale",
      sub: g.pgs != null && Math.abs(g.pgs - g.pg) >= 0.005 ? `da sano ${fmt(g.pgs, 2)}` : "" }),
    box({ v: fmt(g.val, 0), l: "valore in crediti", ic: "gemma" }),
    box({ v: pa, l: "prezzo atteso ora", ic: "cartellino",
      sub: `<span class="esito ${diff > 0 ? "ok" : diff < 0 ? "ko" : ""}" title="Valore meno prezzo atteso">affare ${segno(diff)}</span>` }),
    me.liberi[g.r] > 0
      ? box({ v: cr(me.maxOff, MAXOFF0()), l: "la tua offerta massima", ic: "persone" })
      : box({ v: "Pieno", l: `hai già tutti i ${NOMI_RUOLO[g.r].toLowerCase()}`, ic: "no", tono: "ko", cls: "parola" }),
  ];

  const f = g.fr;
  const [prop, tonoProp] = !f ? ["Senza storico", ""] : f.l === "alta" ? ["Fragile", "ko"] : f.l === "media" ? ["Delicato", "med"] : ["Bassa", "ok"];
  const stato = [
    riquadroAdesso(g, false),
    box({ v: prop, l: f ? "propensione agli infortuni" : "infortuni", ic: "polso", tono: tonoProp, cls: "parola",
      title: !f ? "Transfermarkt non lo ha nella rosa: storico infortuni non disponibile" : f.n ? titoloFr(g) : "Nessuno stop rilevante dalla 23/24" }),
    box({ v: pct(g.pv), l: "prob. di voto", ic: "ok", sub: barra(g.pv, tonoQuota(g.pv)) }),
    box({ v: pct(g.pt), l: "da titolare", ic: "orologio", sub: `${fmt(g.min, 0)}' a presenza` }),
  ];
  if (PER_GIORNATA[g.r] && g.v) {
    const io = abbinamento([g], g.r);
    stato.push(box({ v: `${io.facile}/${io.partite}`, l: "partite facili", ic: "calendario",
      title: `${io.facile} facili, ${io.media} medie, ${io.difficile} difficili: voto FantaLab ${io.voto}`,
      sub: `<span class="tris"><i class="f" style="flex:${io.facile}"></i><i class="m" style="flex:${io.media}"></i><i class="d" style="flex:${io.difficile}"></i></span>` }));
    const mio = compagni(g).find((c) => c.mio);
    if (mio) stato.push(box({ v: `+${fmt(mio.d, 2)}`, l: `pt/g alternandolo a ${esc(mio.q.nome)}`, ic: "persone", tono: "piu",
      title: `Il compagno migliore fra quelli che hai già in rosa: in ${mio.a.facile} giornate su ${mio.a.partite} almeno uno dei due ha una partita facile` }));
  }

  const diRuolo = conBudgetDiRuolo(g.r);
  const rivali = st.filter((t) => t.i !== S.asta.io && t.liberi[g.r] > 0 && t.maxOff >= 1);
  const ricco = rivali.reduce((a, t) => (!a || budgetSquadra(t, g.r) > budgetSquadra(a, g.r) ? t : a), null);
  const tettoRivali = Math.max(1, ...rivali.map((t) => budgetSquadra(t, g.r)));
  const squadra = (t) => {
    const pieno = t.liberi[g.r] <= 0, senza = !pieno && t.maxOff < 1, sonoIo = t.i === S.asta.io;
    return `<button type="button" class="box sq${sonoIo ? " io" : ""}" data-squadra="${t.i}" aria-pressed="${S.asta.scelta === t.i}" ${pieno ? "disabled" : ""}
        title="${pieno ? "Ha già tutti i " + NOMI_RUOLO[g.r].toLowerCase() : senza ? "Crediti finiti" : `Segna che l'ha preso ${esc(t.nome)}` + (diRuolo && !sonoIo ? `. Oltre ${budgetSquadra(t, g.r)} intacca i crediti per i ruoli dopo; al massimo può offrire ${t.maxOff}` : "")}">
      <span class="sq-n">${esc(t.nome)}</span>
      <b>${pieno || senza ? "–" : sonoIo || !diRuolo ? cr(t.maxOff, MAXOFF0()) : cr(budgetSquadra(t, g.r), tettoRivali)}</b>
      <span class="box-l"><span>${pieno ? "ruolo pieno" : senza ? "crediti finiti" : sonoIo ? "la tua offerta" : diRuolo ? "budget ruolo" : "offerta max"}</span></span></button>`;
  };

  box0.innerHTML = `<div class="chiamato r-${g.r}">
    <header class="ch-top">
      <div class="sch-chi">
        <h3><span class="role ${g.r}">${g.r}</span>${dotFascia(g)}<span class="sch-nome">${esc(g.nome)}</span>${tag(g)}${S.asta.obiettivi.includes(id) ? '<span class="tag obj">OBIETTIVO</span>' : ""}</h3>
        <div class="sch-meta"><span class="mt sq"><b>${esc(nomeSq(g.sq))}</b></span><span class="mt">Quotazione <b>${fmt(g.qa, 0)}</b></span><span class="mt">FVM <b>${fmt(g.fvm, 0)}</b></span>${g.fa == null ? "" : `<span class="mt">Fascia <b>${esc(META.fasce[g.fa])}</b>${g.fi ? ", stimata" : ""}</span>`}</div>
      </div>
      <button class="btn small" data-open="${id}" title="Apri la scheda completa">${ico("info")}Scheda</button>
    </header>
    ${sezione("ch-val", "martello", "Quanto vale", `${pos}° fra ${liberi.length === 1 ? "i liberi" : `i ${liberi.length} ${NOMI_RUOLO[g.r].toLowerCase()} liberi`}`,
      `<div class="boxes valore">${valore.join("")}</div>
      <div class="boxes stato">${stato.join("")}</div>`)}
    ${sezione("ch-chi", "persone", "Chi lo prende", rivali.length
        ? `${rivali.length} ${rivali.length === 1 ? "rivale può" : "rivali possono"} ancora offrire, ${diRuolo ? "ha più budget di ruolo" : "il più ricco è"} ${esc(ricco.nome)}`
        : "nessun rivale può più offrire",
      `<div class="boxes squadre-asta" role="group" aria-label="Chi l'ha preso">${st.map(squadra).join("")}</div>
      <form class="registra" id="fasta">
        <label for="prezzo-asta">Preso a</label>
        <input id="prezzo-asta" type="number" inputmode="numeric" min="1" max="${META.crediti}" value="${pa}">
        <span class="lbl">crediti</span>
        <button type="button" class="btn live-go" id="registra">${ico("martello")}Aggiudicato</button>
        <span class="alert" id="err-asta" role="alert" hidden></span>
      </form>`)}
  </div>`;
  $("#fasta").onsubmit = (e) => { e.preventDefault(); registraDaForm(); };
  if (!pronta) {
    setTimeout(() => {
      if (S.asta.chiamato !== id) return;
      SPINTA = { chiave, val: calcolaSpinta(id) };
      const el = $("#spinta");
      if (el) { el.className = spintaClasse(SPINTA.val); el.title = SPINTA.val.motivo; el.innerHTML = spintaDentro(SPINTA.val, pa, me.maxOff); }
    }, 30);
  }
}

// Chi l'ha preso: si segna sul riquadro della squadra, senza ridisegnare il pannello (il prezzo
// gia' scritto resta dov'e').
function scegliSquadra(i) {
  S.asta.scelta = i;
  document.querySelectorAll("#chiamato [data-squadra]").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.squadra === i)));
  const e = $("#err-asta"); if (e) e.hidden = true;
}

function registraDaForm() {
  const err = (m) => { const e = $("#err-asta"); e.textContent = m; e.hidden = false; };
  const id = S.asta.chiamato, t = S.asta.scelta;
  if (!id) return;
  if (t == null) return err("Tocca la squadra che l'ha preso.");
  const prezzo = Math.round(+$("#prezzo-asta").value || 0);
  const g = BY_ID.get(id), s = statoSquadre()[t];
  if (prezzo < 1) return err("Il prezzo minimo è 1 credito.");
  if (s.liberi[g.r] <= 0) return err(`${s.nome} ha già tutti i ${NOMI_RUOLO[g.r].toLowerCase()}.`);
  if (prezzo > s.maxOff) return err(`${s.nome} può offrire al massimo ${s.maxOff} crediti.`);
  const chiamava = chiChiama(), giro = S.asta.giro;
  S.asta.squadre[t].rosa[id] = prezzo;
  S.asta.log.push({ id, t, p: prezzo, ora: new Date().toISOString(), tu: giro.turno });
  if (chiamava != null) { const n = S.asta.squadre.length; giro.turno = (((chiamava + giro.verso) % n) + n) % n; }
  S.asta.chiamato = null; S.asta.scelta = null;
  aggiorna();
  $("#cerca-asta").focus();
}

function rimuoviAcquisto(id) {
  for (const t of S.asta.squadre) delete t.rosa[id];
  S.asta.log = S.asta.log.filter((x) => x.id !== id);
}

function annullaUltimo() {
  const x = S.asta.log.pop();
  if (x) delete S.asta.squadre[x.t].rosa[x.id];
  if (x && x.tu != null && S.asta.giro) S.asta.giro.turno = x.tu;
  aggiorna();
}
