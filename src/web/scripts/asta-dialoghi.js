// FantaOracle — Avvio e chiusura dell'asta, esportazione e importazione.
"use strict";

// Un'asta sospesa riparte da dove era, senza ripassare dal setup: squadre, giro e obiettivi ci
// sono gia', e verso e turno si correggono dal riquadro del giocatore chiamato. Per un'asta nuova
// si chiude quella in corso (Esci, Chiudi l'asta) e il pulsante torna a "Modalita' asta".
function avvioAsta() {
  if (!S.asta) return dialogoAvvio();
  S.asta.attiva = true;
  entraInAsta();
}

function entraInAsta() {
  vista("asta");
  aggiorna();
  const top = document.querySelector(".top");
  top.classList.remove("entra"); void top.offsetWidth; top.classList.add("entra");
  $("#cerca-asta").focus();
}

function dialogoAvvio() {
  const nomi = NOMI_DEFAULT.slice(0, META.n_squadre);
  apri(`<h3>Modalità asta</h3>
    <p class="lbl">Da qui in poi la tua rosa è quella reale: registri ogni acquisto, tuo e degli altri, e il tool ricalcola suggerimenti, prezzi e occasioni.</p>
    <p class="lbl">Scrivi le squadre nell'ordine in cui siete seduti, in senso orario partendo da te: il giro delle chiamate segue quest'ordine.</p>
    <div class="nomi">${nomi.map((n, i) => `<label>${i === 0 ? "La tua squadra" : "Avversario " + i}<input id="nome-${i}" value="${esc(n)}" maxlength="24"></label>`).join("")}</div>
    <div class="row"><span class="lbl">Obiettivi dal piano</span><div class="seg mini">${["A", "B", "C"].map((p) =>
      `<button type="button" data-obj="${p}" aria-pressed="${S.piano === p}">Piano ${p} (${Object.keys(S.piani[p]).length})</button>`).join("")}</div></div>
    <p class="lbl">I giocatori del piano scelto restano segnati come OBIETTIVO nel listone. Non sono acquisti: le rose partono vuote.</p>
    <div class="row"><span class="lbl">Chiamata</span><div class="seg mini" role="group" aria-label="Tipo di chiamata">
      <button type="button" data-modo-asta="ruolo" aria-pressed="true" title="Prima tutti i portieri, poi difensori, centrocampisti e attaccanti">Per ruolo: P, D, C, A</button>
      <button type="button" data-modo-asta="libero" aria-pressed="false" title="Ogni ruolo si può chiamare in qualsiasi momento">Libera</button></div></div>
    <div class="row"><span class="lbl">Giro</span><div class="seg mini" role="group" aria-label="Verso del giro">
      <button type="button" data-verso="1" aria-pressed="true">Orario</button>
      <button type="button" data-verso="-1" aria-pressed="false">Antiorario</button>
      <button type="button" data-verso="0" aria-pressed="false" title="Il tool non segue chi deve chiamare">Senza giro</button></div>
      <label class="lbl" for="av-primo">comincia</label>
      <select id="av-primo" class="pill">${nomi.map((_, i) => `<option value="${i}">${i === 0 ? "Tu" : "Avversario " + i}</option>`).join("")}</select></div>
    <p class="lbl">Verso e turno si correggono anche dopo, dal riquadro del giocatore chiamato. Chi ha già riempito il ruolo in corso salta il turno.</p>
    <div class="actions">
      <button class="btn" data-close>Annulla</button>
      <button class="btn live-go" id="asta-ok">Avvia l'asta</button>
    </div>`);
  let piano = S.piano, modo = "ruolo", verso = 1;
  const gruppo = (attr, scelto) => document.querySelectorAll(`.dialog [${attr}]`).forEach((b) => b.onclick = () => {
    scelto(b);
    document.querySelectorAll(`.dialog [${attr}]`).forEach((x) => x.setAttribute("aria-pressed", x === b));
  });
  gruppo("data-obj", (b) => { piano = b.dataset.obj; });
  gruppo("data-modo-asta", (b) => { modo = b.dataset.modoAsta; });
  gruppo("data-verso", (b) => { verso = +b.dataset.verso; });
  const leggiNomi = () => nomi.map((n, i) => ($(`#nome-${i}`).value.trim() || n));
  $("#asta-ok").onclick = () => {
    const n = leggiNomi(), primo = +$("#av-primo").value;
    S.asta = { attiva: true, io: 0, inizio: new Date().toISOString(), squadre: n.map((nome) => ({ nome, rosa: {} })), log: [],
               obiettivi: Object.keys(S.piani[piano]).map(Number), presiPiano: S.presi,
               chiamato: null, scelta: null, aperta: null, modo, giro: { verso, turno: primo } };
    chiudi();
    entraInAsta();
  };
}

function dialogoChiusura() {
  const n = S.asta.log.length;
  apri(`<h3>Uscire dall'asta?</h3>
    <p class="lbl"><b>Sospendi</b> se l'asta continua piu' tardi: tutto resta com'e' e dal pulsante in alto la riprendi da dove eri.</p>
    <p class="lbl"><b>Chiudi</b> se l'asta e' finita: le rose finali (${n} acquisti) vengono archiviate in questo browser e saranno la base del tool formazione. Il pulsante torna a "Modalita' asta" per una nuova asta.</p>
    <div class="actions">
      <button class="btn" data-close>Resta in asta</button>
      <button class="btn" id="asta-sospendi">Sospendi</button>
      <button class="btn primary" id="asta-stop">Chiudi l'asta</button>
    </div>`);
  const esci = () => { S.presi = S.asta.presiPiano || {}; OWNER = new Map(); };
  $("#asta-sospendi").onclick = () => { S.asta.attiva = false; esci(); chiudi(); aggiorna(); };
  $("#asta-stop").onclick = () => {
    const chiusa = { ...S.asta, attiva: false, conclusa: new Date().toISOString() };
    S.archivio = [...(S.archivio || []), chiusa];
    esci();
    S.asta = null;
    aggiorna();
    // Subito il testo da conservare: il browser e' l'unico posto dove vive.
    const txt = JSON.stringify({ asta: chiusa });
    apri(`<h3>Asta chiusa</h3>
      <p class="lbl">Le rose finali sono archiviate in questo browser. Copia il testo qui sotto e conservalo: e' la copia di sicurezza, e con Importa la ricarichi su un altro dispositivo.</p>
      <textarea id="txt" readonly>${esc(txt)}</textarea>
      <div class="actions"><button class="btn" data-close>Fatto</button><button class="btn primary" id="copia">Copia</button></div>`);
    $("#copia").onclick = async () => {
      try { await navigator.clipboard.writeText(txt); $("#copia").textContent = "Copiato"; }
      catch (e) { $("#txt").select(); $("#copia").textContent = "Selezionato: premi Ctrl+C"; }
    };
  };
}

function esportaAsta() {
  const txt = JSON.stringify({ asta: S.asta });
  apri(`<h3>Esporta l'asta</h3><p class="lbl">Tutto lo stato dell'asta: squadre, acquisti, obiettivi. Con Importa lo ricarichi qui o su un altro dispositivo.</p>
    <textarea id="txt" readonly>${esc(txt)}</textarea>
    <div class="actions"><button class="btn" data-close>Chiudi</button><button class="btn primary" id="copia">Copia</button></div>`);
  $("#copia").onclick = async () => {
    try { await navigator.clipboard.writeText(txt); $("#copia").textContent = "Copiato"; }
    catch (e) { $("#txt").select(); $("#copia").textContent = "Selezionato: premi Ctrl+C"; }
  };
}

function importaAsta() {
  apri(`<h3>Importa un'asta</h3><p class="lbl">Incolla il testo esportato. Sostituisce l'asta in corso.</p>
    <textarea id="txt"></textarea><p class="alert" id="errimp" hidden></p>
    <div class="actions"><button class="btn" data-close>Annulla</button><button class="btn primary" id="okimp">Importa</button></div>`);
  $("#okimp").onclick = () => {
    try {
      const x = JSON.parse($("#txt").value).asta;
      if (!x || !Array.isArray(x.squadre) || !Array.isArray(x.log)) throw new Error();
      S.asta = { ...x, attiva: true };
      chiudi(); vista("asta"); aggiorna();
    } catch (e) { const el = $("#errimp"); el.textContent = "Testo non valido: incolla esattamente quello copiato da Esporta l'asta."; el.hidden = false; }
  };
}
