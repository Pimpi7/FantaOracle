// FantaOracle — Ricerca del giocatore chiamato.
"use strict";

// La ricerca del giocatore chiamato: i liberi che corrispondono, prima quelli il cui nome
// comincia cosi'. Con le frecce su e giu' si scorre l'elenco, Invio chiama quello evidenziato.
let RIC = { lista: [], i: 0 };
const fuoriFase = (g) => (MERC && MERC.fase && g.r !== MERC.fase ? 1 : 0);
function risultatiRicerca() {
  const inp = $("#cerca-asta"), q = inp.value.trim().toLowerCase(), box = $("#risultati");
  if (!q) { chiudiRicerca(); return []; }
  const l = DATA.giocatori.filter((g) => !OWNER.has(g.id) && g.nome.toLowerCase().includes(q))
    .sort((a, b) => (fuoriFase(a) - fuoriFase(b)) || (a.nome.toLowerCase().startsWith(q) ? 0 : 1) - (b.nome.toLowerCase().startsWith(q) ? 0 : 1) || b.pg - a.pg).slice(0, 8);
  RIC = { lista: l, i: 0 };
  box.innerHTML = l.length
    ? l.map((g, i) => `<button type="button" role="option" id="ris-${i}" data-i="${i}" data-chiama="${g.id}" tabindex="-1"${fuoriFase(g) ? ` class="fuori" title="Non è il ruolo in corso"` : ""}><span class="role ${g.r}">${g.r}</span>
        <span class="ris-n">${dotFascia(g, true)}<b>${esc(g.nome)}</b>${tagSalute(g)}<small>${esc(nomeSq(g.sq))}</small></span>
        <span class="ris-v"><b>${fmt(g.pg, 2)}</b> pt/g</span><span class="ris-v"><b>${prezzoAtteso(g)}</b> cr</span></button>`).join("")
      + `<div class="ris-aiuto" aria-hidden="true"><kbd>↑</kbd><kbd>↓</kbd> per scorrere <kbd>Invio</kbd> per chiamarlo <kbd>Esc</kbd> per chiudere</div>`
    : `<div class="lbl ris-vuoto">Nessun giocatore libero con questo nome.</div>`;
  box.hidden = false;
  inp.setAttribute("aria-expanded", "true");
  segnaRisultato();
  return l;
}
function segnaRisultato() {
  const inp = $("#cerca-asta");
  $("#risultati").querySelectorAll("[role=option]").forEach((b, k) => {
    const on = k === RIC.i;
    b.classList.toggle("sel", on); b.setAttribute("aria-selected", String(on));
    if (on) { inp.setAttribute("aria-activedescendant", b.id); b.scrollIntoView({ block: "nearest" }); }
  });
}
function chiudiRicerca() {
  const inp = $("#cerca-asta");
  $("#risultati").hidden = true;
  RIC = { lista: [], i: 0 };
  inp.setAttribute("aria-expanded", "false"); inp.removeAttribute("aria-activedescendant");
}
