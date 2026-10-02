// FantaOracle — Infortuni e propensione, tag di salute dei giocatori.
"use strict";

// --- infortuni ------------------------------------------------------------------
// g.inf: chi e' fermo adesso (t tipo, m motivo, g giornata e d data di rientro, s giornate che
// salta, fs stagione finita). g.fr: propensione dallo storico (l livello, n stop, mu muscolari,
// gg giorni e pp partite perse a stagione, e gli ultimi stop). Senza g.fr non c'e' storico.
const MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
const dataBreve = (iso) => { if (!iso) return ""; const [, m, d] = iso.split("-"); return `${+d} ${MESI[+m - 1]}`; };
// Fuori = salta almeno una delle giornate da giocare. "In dubbio per la prossima" non e' fuori:
// e' un dubbio, e va trattato come tale.
const fuori = (g) => !!g.inf && (g.inf.t === "infortunato" || g.inf.t === "squalificato") && (g.inf.s > 0 || g.inf.fs);
const fragile = (g) => !!g.fr && g.fr.l === "alta";
const aRischio = (g) => !!g.fr && g.fr.l === "media";

function rientro(i) {
  if (i.fs) return "stagione finita";
  if (i.g) return `rientro ${i.g}a${i.d ? " · " + dataBreve(i.d) : ""}`;
  if (i.d) return `rientro ~${dataBreve(i.d)}`;
  return "rientro non indicato";
}

function titoloInf(g) {
  const i = g.inf, parti = [i.t === "acciaccato" ? "Acciaccato (solo Transfermarkt)" : i.t[0].toUpperCase() + i.t.slice(1)];
  if (i.t === "infortunato" || i.t === "squalificato") parti.push(rientro(i));
  if (i.s > 0) parti.push(`salta ${i.s} ${i.s === 1 ? "giornata" : "giornate"}`);
  return parti.join(" · ") + (i.m ? ". " + i.m : "");
}

function titoloFr(g) {
  const f = g.fr;
  return `${f.l === "alta" ? "Fragile" : "Delicato"}: ${f.n} stop dalla 23/24` +
    (f.mu ? `, ${f.mu} muscolari` : "") + (f.gr ? `, ${f.gr} gravi` : "") +
    `; ~${fmt(f.gg, 0)} giorni e ~${fmt(f.pp, 0)} partite perse a stagione`;
}

// I segni dentro le etichette, nel colore del testo (currentColor) e alti quanto lui: una croce
// rossa per i fragili, un cerotto per i delicati, un mirino per i rigoristi.
const SEGNO = {
  croce: '<svg class="segno" viewBox="0 0 12 12" aria-hidden="true"><path d="M4.4 1h3.2v3.4H11v3.2H7.6V11H4.4V7.6H1V4.4h3.4z"/></svg>',
  cerotto: '<svg class="segno" viewBox="0 0 12 12" aria-hidden="true"><g transform="rotate(-40 6 6)"><rect x="0.6" y="3.6" width="10.8" height="4.8" rx="2.4"/>' +
    '<rect x="4" y="3.6" width="4" height="4.8" fill="rgb(0 0 0 / 0.22)"/><circle cx="5.2" cy="5.2" r=".45" fill="rgb(0 0 0 / 0.35)"/><circle cx="6.8" cy="6.8" r=".45" fill="rgb(0 0 0 / 0.35)"/></g></svg>',
  mirino: '<svg class="segno mirino" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.6">' +
    '<circle cx="12" cy="12" r="7.6"/><path d="M12 1.5v5M12 17.5v5M1.5 12h5M17.5 12h5"/></g><circle cx="12" cy="12" r="2.1" fill="currentColor"/></svg>',
};
function tagSalute(g, senzaDubbio = false) {
  let t = "";
  if (g.inf && !(senzaDubbio && !fuori(g) && g.inf.t !== "diffidato")) {
    const i = g.inf;
    const out = fuori(g);
    // Bollini da tabellone: chi e' fuori ha la chiave (OUT, SQ) e accanto quando rientra
    const testo = i.t === "diffidato" ? "DIFF" : !out ? "? DUBBIO"
      : i.t === "squalificato" ? `<i>SQ</i>${i.fs ? "STAGIONE" : i.s ? `${i.s} G` : ""}`
      : `<i>OUT</i>${i.fs ? "STAGIONE" : i.g ? `${i.g}ª` : ""}`;
    const cls = out ? "out" : i.t === "diffidato" ? "diff" : "dubbio";
    t += `<span class="tag ${cls}" title="${esc(titoloInf(g))}">${testo}</span>`;
  }
  if (fragile(g)) t += `<span class="tag fragile" title="${esc(titoloFr(g))}">${SEGNO.croce}FRAGILE</span>`;
  else if (aRischio(g)) t += `<span class="tag rischio" title="${esc(titoloFr(g))}">${SEGNO.cerotto}DELICATO</span>`;
  return t;
}

function filtroSalute(g, f) {
  if (!f) return true;
  if (f === "disponibili") return !fuori(g);
  if (f === "sani") return !fuori(g) && !fragile(g) && !aRischio(g);
  if (f === "fuori") return fuori(g);
  if (f === "fragili") return fragile(g) || aRischio(g);
  return true;
}

// I colori sociali, per le strisce dell'etichetta TIFO: vale per qualsiasi squadra messa nel
// tifo in config/league.yaml, non solo Roma e Lazio.
const COLORI_SQ = {
  atalanta: ["#1e71b8", "#111111"], bologna: ["#a21c26", "#1a2f48"], cagliari: ["#a01d32", "#1b2a4a"],
  como: ["#1d3c8f", "#ffffff"], fiorentina: ["#5b2a86", "#ffffff"], frosinone: ["#0047bb", "#ffd200"],
  genoa: ["#a81e2d", "#002147"], inter: ["#0068a8", "#111111"], juventus: ["#111111", "#ffffff"],
  lazio: ["#5fbfe9", "#ffffff"], lecce: ["#d71920", "#ffd400"], milan: ["#d50a0a", "#111111"],
  monza: ["#e30613", "#ffffff"], napoli: ["#129bd4", "#ffffff"], parma: ["#1b4ea2", "#ffd200"],
  roma: ["#8e1f2f", "#f0b323"], sassuolo: ["#00a752", "#111111"], torino: ["#7f1d0b", "#ffffff"],
  udinese: ["#111111", "#ffffff"], venezia: ["#f47920", "#00843d"],
};
// Contrasto (WCAG) fra la scritta bianca e un colore: sotto 1,7 la striscia e' troppo chiara
// (bianco, giallo) e l'etichetta prende il velo scuro; le altre restano coi colori pieni.
function contrastoBianco(hex) {
  const lin = (i) => { const c = parseInt(hex.slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 1.05 / (0.2126 * lin(1) + 0.7152 * lin(3) + 0.0722 * lin(5) + 0.05);
}
function tag(g, senzaDubbio = false) {
  let t = "";
  if ((g.qrig || 0) >= 0.4) t += `<span class="tag rig" title="Rigorista: calcia la maggior parte dei rigori della squadra">${SEGNO.mirino}RIG</span>`;
  if ((g.tifo || 1) > 1) {
    const [c1, c2] = COLORI_SQ[g.sq] || ["#8a6a12", "#f2c200"];
    const velo = Math.min(contrastoBianco(c1), contrastoBianco(c2)) < 1.7 ? " velo" : "";
    t += `<span class="tag tifo${velo}" style="--t1:${c1};--t2:${c2}" title="Prezzo atteso maggiorato: ${esc(nomeSq(g.sq))} ha molti tifosi in lega">TIFO</span>`;
  }
  return t + tagSalute(g, senzaDubbio);
}

// Come sta adesso, in un riquadro: verde se disponibile, rosso se salta giornate, giallo se e'
// in dubbio. Con `largo` occupa due colonne e porta anche il motivo dello stop.
function riquadroAdesso(g, largo) {
  const i = g.inf;
  if (!i) return box({ v: "Disponibile", l: "adesso", ic: "ok", tono: "ok", cls: "parola" });
  const out = fuori(g), fermo = i.t === "infortunato" || i.t === "squalificato";
  const v = i.fs ? "Stagione finita" : i.t === "squalificato" ? "Squalificato" : i.t === "diffidato" ? "Diffidato"
    : i.t === "acciaccato" ? "Acciaccato" : out ? "Fuori" : "In dubbio";
  const righe = [fermo && !i.fs ? rientro(i) : "", i.s > 0 ? `salta ${i.s} ${i.s === 1 ? "giornata" : "giornate"}` : "", largo ? i.m || "" : ""].filter(Boolean);
  return box({ v, l: "adesso", ic: out ? "no" : "allerta", tono: out ? "ko" : "med", cls: "parola" + (largo ? " largo" : ""),
    sub: righe.map(esc).join("<br>"), title: largo ? "" : titoloInf(g) });
}

// Sezione della scheda: come sta adesso, poi la propensione che viene dallo storico. L'elenco
// degli stop resta chiuso: lo apre il riquadro che li conta.
function sezioneInfortuni(g) {
  const fonti = META.infortuni || {}, i = g.inf, f = g.fr;
  const riquadri = [];
  let nota = "", elenco = "";
  riquadri.push(riquadroAdesso(g, true));
  if (i) {
    const fermo = i.t === "infortunato" || i.t === "squalificato";
    if (fermo && i.s > 0 && g.pgs != null) nota = `Da sano farebbe ${fmt(g.pgs, 2)} punti a giornata: le giornate che salta sono già tolte dai punti attesi e dal valore.`;
    if (i.t === "acciaccato") nota = "Segnalato solo da Transfermarkt, senza data di rientro: di solito è un acciacco di pochi giorni, i punti attesi non lo scontano.";
  }
  const origine = `Indisponibili: SosFanta ${dataIt(fonti.sosfanta)}, Transfermarkt ${dataIt(fonti.transfermarkt)}. Storico Transfermarkt; malattie e stop sotto i 10 giorni senza partite perse non contano.`;
  if (!f) {
    riquadri.push(box({ v: "Senza storico", l: "propensione agli infortuni", ic: "polso", cls: "parola largo",
      sub: `Transfermarkt non lo ha nella rosa di ${esc(nomeSq(g.sq))}` }));
  } else {
    const [nome, tono] = f.l === "alta" ? ["Fragile", "ko"] : f.l === "media" ? ["Delicato", "med"] : ["Bassa", "ok"];
    riquadri.push(box({ v: nome, l: "propensione agli infortuni", ic: "polso", tono, cls: "parola",
      title: "È un avviso: lo storico delle presenze è già nella probabilità di voto" }));
    if (!f.n) riquadri.push(box({ v: "0", l: "stop dalla 23/24", ic: "croce" }));
    else {
      riquadri.push(box({ v: f.n, l: "stop dalla 23/24", ic: "croce", apre: "pan-inf", title: "Apri l'elenco degli stop",
        sub: [f.mu ? `${f.mu} muscolari` : "", f.gr ? `${f.gr} gravi` : ""].filter(Boolean).join(", ") }));
      riquadri.push(box({ v: fmt(f.gg, 0), l: "giorni fuori a stagione", ic: "orologio" }));
      riquadri.push(box({ v: fmt(f.pp, 0), l: "partite perse a stagione", ic: "no" }));
      elenco = pannello("pan-inf", `<div class="scorri"><table class="inf-st">
          <thead><tr><th class="l">Stag.</th><th class="l">Infortunio</th><th>Giorni</th><th>Partite</th></tr></thead>
          <tbody>${f.e.map(([st, t, c, gg, pp]) => `<tr><td class="l">${st}</td><td class="l ${c === "grave" ? "neg" : c === "muscolare" ? "musc" : ""}">${esc(t)}</td><td>${gg ?? "–"}</td><td>${pp}</td></tr>`).join("")}</tbody>
        </table></div>
        ${f.n > f.e.length ? `<p class="lbl">e altri ${f.n - f.e.length} stop.</p>` : ""}
        <p class="lbl">${origine} La propensione è un avviso: lo storico delle presenze è già nella probabilità di voto.</p>`);
    }
  }
  return sezione("inf", "croce", "Infortuni", `<span title="${esc(origine)}">aggiornati al ${dataIt(fonti.sosfanta).slice(0, 5)}</span>`,
    `<div class="boxes">${riquadri.join("")}</div>${nota ? `<p class="nota">${nota}</p>` : ""}${elenco}`);
}
