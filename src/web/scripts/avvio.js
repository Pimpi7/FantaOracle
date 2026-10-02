// FantaOracle — Avvio: caricamento di data.json e primo rendering.
"use strict";

anelliSfera();

// --- avvio ------------------------------------------------------------------------------
fetch("data.json").then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }).then((d) => {
  DATA = d; META = d.meta; BY_ID = new Map(d.giocatori.map((g) => [g.id, g]));
  carica();
  for (const g of d.giocatori) { g.pa0 = g.pa; g.val0 = g.val; g.aff0 = g.aff; }
  preparaGiornate();
  LEGA0 = { n: META.n_squadre, cr: META.crediti };
  applicaLega();
  if (inAsta()) vista("asta");
  $("#sq").innerHTML += d.squadre.map((s) => `<option value="${s.slug}">${esc(s.nome)}</option>`).join("");
  aggiorna();
}).catch((err) => {
  $("#meta").textContent = "Impossibile caricare data.json: " + err.message + ". Rigenera i dati con `make export`.";
  $("#rows").innerHTML = '<tr><td colspan="13" class="l loading">Dati non disponibili.</td></tr>';
});
