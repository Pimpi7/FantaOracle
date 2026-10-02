// FantaOracle — Gestione degli eventi.
"use strict";

// --- eventi -----------------------------------------------------------------------------
// apertura e chiusura della formazione tipo a tendina: il campo scorre verso l'alto dietro al
// titolo (solo transform, niente ridimensionamento dell'SVG) mentre il riquadro si accorcia.
document.addEventListener("click", (e) => {
  const s = e.target.closest("#campo > summary");
  if (!s || !Element.prototype.animate || !matchMedia("(prefers-reduced-motion: no-preference)").matches) return;
  e.preventDefault();
  const det = s.parentElement, box = det.querySelector(".campo-box"), campo = det.querySelector(".campo");
  if (det.dataset.anim) return;
  det.dataset.anim = "1";
  const apri = !det.open;
  det.classList.toggle("chiude", !apri);
  if (apri) det.open = true;
  const h = campo.getBoundingClientRect().height;
  const opz = { duration: 280, easing: apri ? "cubic-bezier(.2,.7,.3,1)" : "cubic-bezier(.5,0,.8,.4)" };
  const su = [{ transform: "translateY(0)" }, { transform: `translateY(${-h}px)` }];
  const alto = [{ height: h + "px" }, { height: "0px" }];
  box.classList.add("scorre");
  const a = box.animate(apri ? alto.slice().reverse() : alto, opz);
  campo.animate(apri ? su.slice().reverse() : su, opz);
  a.finished.then(() => {
    if (!apri) det.open = false;
    det.classList.remove("chiude");
    box.classList.remove("scorre");
    delete det.dataset.anim;
  });
});
// formazione tipo aperta o chiusa: la scelta resta fra un ricalcolo e l'altro
document.addEventListener("toggle", (e) => {
  if (e.target.id === "campo") { S.campoChiuso = !e.target.open; salva(); }
}, true);
document.addEventListener("click", (e) => {
  const t = e.target.closest("button, [data-close]");
  if (e.target.id === "overlay") return chiudi();
  if (!t) return;
  const d = t.dataset;
  if (d.close !== undefined) return chiudi();
  if (d.espandi) return espandi(t);
  if (d.open) return scheda(+d.open);
  if (d.abb) return mostraAbbinamento(+d.abb);
  if (d.chiama) { chiudi(); return chiama(+d.chiama); }
  if (d.squadra !== undefined) return scegliSquadra(+d.squadra);
  if (d.giro) return muoviGiro(d.giro);
  if (d.occ) { chiudi(); return chiama(+d.occ); }
  if (t.id === "asta-avvia") return calcioDInizio(t);
  if (t.id === "asta-chiudi") return dialogoChiusura();
  if (t.id === "registra") return registraDaForm();
  if (t.id === "annulla-ultimo") return annullaUltimo();
  if (t.id === "esporta-asta") return esportaAsta();
  if (t.id === "importa-asta") return importaAsta();
  if (d.vedi !== undefined) { S.asta.aperta = S.asta.aperta === +d.vedi ? null : +d.vedi; return renderAsta(); }
  if (inAsta() && d.add) {
    const id = +d.add;
    const g = BY_ID.get(id);
    return apri(`<h3>Annullare l'acquisto?</h3><p class="lbl">${esc(g.nome)} torna libero e i crediti tornano disponibili.</p>
      <div class="actions"><button class="btn" data-close>No</button><button class="btn primary" data-annulla="${id}">Annulla l'acquisto</button></div>`);
  }
  if (d.annulla) { rimuoviAcquisto(+d.annulla); chiudi(); return aggiorna(); }
  if (inAsta() && d.prendi) return chiama(+d.prendi);
  if (d.add) {
    const id = +d.add;
    if (mia()[id] != null) { delete mia()[id]; chiudi(); return aggiorna(); }
    return chiediPrezzo(id);
  }
  if (d.taken) {
    const id = +d.taken;
    if (S.presi[id]) delete S.presi[id]; else { S.presi[id] = true; delete mia()[id]; }
    chiudi(); return aggiorna();
  }
  if (d.prendi) { const id = +d.prendi; const g = BY_ID.get(id); mia()[id] = prezzoAtteso(g); S.aperte = {}; return aggiorna(); }
  if (d.alt) { const id = +d.alt; S.aperte[id] = !S.aperte[id]; return renderRosa(); }
  if (d.piano) { S.piano = d.piano; S.aperte = {}; return aggiorna(); }
  if (d.modo) { S.modo = d.modo; S.aperte = {}; return aggiorna(); }
  if (d.bud) {
    if (d.bud === "auto") S.budgetRuolo = null;
    else if (!S.budgetRuolo) {
      // Si parte dalla divisione attuale: scelti + suggeriti per ruolo.
      const b = { P: 0, D: 0, C: 0, A: 0 };
      for (const [id, pz] of Object.entries(mia())) { const g = BY_ID.get(+id); if (g) b[g.r] += +pz; }
      for (const c of SUGG.lista) b[c.g.r] += c.p;
      S.budgetRuolo = b;
    }
    S.aperte = {}; return aggiorna();
  }
  if (d.r !== undefined && t.parentElement.id === "ruoli") {
    S.f.r = d.r; document.querySelectorAll("#ruoli button").forEach((b) => b.setAttribute("aria-pressed", b === t));
    return renderListone();
  }
  if (d.view) return vista(d.view);
  if (d.rosaTg !== undefined) return rosaChiusa(!S.rosaChiusa, true);
  if (t.id === "lega-reset") { S.nSq = S.cred = S.budgetRuolo = null; S.aperte = {}; applicaLega(); return aggiorna(); }
  if (t.id === "svuota") { S.piani[S.piano] = {}; return aggiorna(); }
  if (t.id === "esporta") return esporta();
  if (t.id === "importa") return importa();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#overlay").hidden) chiudi(); });
document.addEventListener("change", (e) => {
  const id = e.target.id;
  if (id === "margine") { S.margine = +e.target.value; aggiorna(); }
  if (id === "nsq") cambiaLega("nSq", e.target.value);
  if (id === "cred") cambiaLega("cred", e.target.value);
  if (id.startsWith("bud-") && S.budgetRuolo) { S.budgetRuolo[id.slice(4)] = Math.max(0, Math.round(+e.target.value || 0)); S.aperte = {}; aggiorna(); }
  if (id === "tetto") { S.tetto = +e.target.value; aggiorna(); }
  if (id === "esenzione") { S.esenzioneP = e.target.checked; aggiorna(); }
  if (id === "sq") { S.f.sq = e.target.value; renderListone(); }
  if (id === "hide") { S.f.hide = e.target.checked; renderListone(); }
  if (id === "hide-strat") { S.nascondiStrategia = e.target.checked; salva(); renderListone(); }
  if (id === "salute") { S.f.salute = e.target.value; renderListone(); }
});
$("#q").addEventListener("input", (e) => { S.f.q = e.target.value; renderListone(); });
$("#cerca-asta").addEventListener("input", risultatiRicerca);
$("#cerca-asta").addEventListener("keydown", (e) => {
  const aperta = !$("#risultati").hidden && RIC.lista.length > 0;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (!aperta) return void risultatiRicerca();          // la freccia riapre l'elenco
    const n = RIC.lista.length;
    RIC.i = (RIC.i + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
    segnaRisultato();
  } else if (e.key === "Enter") {
    e.preventDefault();
    const l = aperta ? RIC.lista : risultatiRicerca();
    if (l.length) chiama(l[aperta ? RIC.i : 0].id);
  } else if (e.key === "Escape") chiudiRicerca();
});
// il mouse e la tastiera evidenziano lo stesso risultato; cliccare un risultato non toglie
// il fuoco al campo, uscire dal campo chiude l'elenco e tornarci lo riapre
$("#risultati").addEventListener("mousemove", (e) => {
  const b = e.target.closest("[role=option]");
  if (b && +b.dataset.i !== RIC.i) { RIC.i = +b.dataset.i; segnaRisultato(); }
});
$("#risultati").addEventListener("mousedown", (e) => e.preventDefault());
$("#cerca-asta").addEventListener("blur", chiudiRicerca);
$("#cerca-asta").addEventListener("focus", () => { if ($("#cerca-asta").value.trim()) risultatiRicerca(); });
$("#pmax").addEventListener("input", (e) => { S.f.pmax = +e.target.value || null; renderListone(); });
document.querySelector("thead").addEventListener("click", (e) => {
  const th = e.target.closest("th[data-k]"); if (!th) return;
  const k = th.dataset.k;
  S.sort = { k, dir: S.sort.k === k ? -S.sort.dir : (k === "nome" || k === "sq" || k === "fa" ? 1 : -1) };
  renderListone();
});

// il grafico del mercato e' disegnato in pixel veri: se cambia la larghezza si ridisegna
let ridisegna = 0;
addEventListener("resize", () => { clearTimeout(ridisegna); ridisegna = setTimeout(() => { if (inAsta() && MERC) renderMercato(); }, 150); });
