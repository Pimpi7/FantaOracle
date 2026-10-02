// FantaOracle — L'andamento del mercato.
"use strict";

// --- l'andamento del mercato --------------------------------------------------------------------
// Ogni acquisto contro il suo prezzo previsto prima dell'asta: sopra la riga del 100% si e'
// pagato di piu', sotto di meno. La linea e' la media degli ultimi acquisti, pesata sui crediti
// (un giocatore da 1 credito preso a 3 non sposta niente). La scala e' logaritmica: la meta' e
// il doppio del previsto stanno alla stessa distanza dalla riga.
function serieMercato() {
  const acq = S.asta.log.map((x) => ({ x, g: BY_ID.get(x.id) })).filter((a) => a.g)
    .map(({ x, g }) => ({ g, t: x.t, p: x.p, e: g.pa, r: x.p / Math.max(1, g.pa) }));
  acq.forEach((a, i) => {
    let p = 0, e = 0, n = 0;
    for (let k = Math.max(0, i - FINESTRA + 1); k <= i; k++) { p += acq[k].p; e += acq[k].e; n++; }
    a.m = p / Math.max(1, e);      // ultimi acquisti: pagato sul previsto
    a.c = p / n;                   // ultimi acquisti: crediti a giocatore
  });
  return acq;
}
const tonoMercato = (m) => (m >= 1.1 ? ["si spende tanto", "caldo"] : m <= 0.9 ? ["si spende poco", "freddo"] : ["nella norma", ""]);
const intero = (x) => Math.round(x).toLocaleString("it-IT");

// Il mirino dei grafici del mercato: passaggio del mouse, tocco e frecce trovano l'acquisto,
// il riquadro dice chi e a quanto. `righe(i)` da' le righe del riquadro: [classe, testo].
function mirinoGrafico(svg, tip, { N, cx, sx, passoX, su, alto, W }, righe) {
  const mirino = svg.querySelector(".mirino");
  let sel = -1;
  const mostra = (i) => {
    sel = Math.max(0, Math.min(N - 1, i));
    mirino.setAttribute("d", `M${cx(sel).toFixed(1)} ${su}V${su + alto}`); mirino.removeAttribute("hidden");
    tip.textContent = "";
    for (const [classe, testo] of righe(sel)) { const e = document.createElement("div"); if (classe) e.className = classe; e.textContent = testo; tip.appendChild(e); }
    tip.hidden = false;
    const tw = tip.offsetWidth, x = cx(sel);
    tip.style.left = Math.max(0, Math.min(W - tw, x > W / 2 ? x - tw - 10 : x + 10)) + "px";
  };
  const nascondi = () => { mirino.setAttribute("hidden", ""); tip.hidden = true; sel = -1; };
  svg.addEventListener("pointermove", (e) => { const r = svg.getBoundingClientRect(); mostra(Math.floor((e.clientX - r.left - sx) / passoX)); });
  svg.addEventListener("pointerleave", nascondi);
  svg.addEventListener("blur", nascondi);
  svg.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); mostra(sel < 0 ? N - 1 : sel + (e.key === "ArrowRight" ? 1 : -1)); }
    else if (e.key === "Escape") nascondi();
  });
}

// Andamento del mercato. Sopra, l'andamento generale: quanti crediti sono usciti dal tavolo e
// quanto si paga a giocatore, acquisto per acquisto. Sotto, chiuso finche' non serve, il
// confronto con il previsto (i prezzi attesi lo seguono gia' da soli).
function renderMercato() {
  const box0 = $("#mercato");
  const acq = serieMercato(), N = acq.length, fase = MERC.fase;
  const eraAperto = !!box0.querySelector("#merc-previsto.aperto");

  // --- andamento generale: i riquadri ---
  const totCr = META.crediti * META.n_squadre, totSlot = RUOLI.reduce((a, r) => a + META.slot[r], 0) * META.n_squadre;
  const spesi = MERC.st.reduce((a, t) => a + t.spesa, 0), ass = OWNER.size, liberi = totSlot - ass, restano = totCr - spesi;
  const generale = [
    box({ v: pct(spesi / totCr), l: "dei crediti già spesi", ic: "gemma", cls: "ora",
      sub: `${barra(spesi / totCr)}${intero(spesi)} su ${intero(totCr)} · assegnato il ${pct(ass / totSlot)} dei giocatori` }),
    box({ v: ass ? fmt(spesi / ass, 1) : "–", l: "crediti a giocatore, finora", title: "Quanto è costato in media ogni giocatore assegnato fin qui" }),
    box({ v: N ? fmt(acq[N - 1].c, 1) : "–", l: N ? `crediti a giocatore, ultimi ${Math.min(N, FINESTRA)}` : "crediti a giocatore, ultimi acquisti", cls: "adesso",
      title: "È dove arriva la linea blu del grafico" }),
    box({ v: intero(restano), l: `crediti ancora da spendere`, sub: liberi ? `${fmt(restano / liberi, 1)} a slot · ${liberi} slot liberi` : "rose complete" }),
  ];
  let h = `<h2>Andamento del mercato</h2><div class="boxes merc-box gen">${generale.join("")}</div>`;
  if (!N) {
    box0.innerHTML = h + `<p class="lbl">Il grafico parte dal primo acquisto: una colonna per acquisto, alta quanto i crediti pagati.</p>`;
    return;
  }

  // geometria, in pixel veri: i grafici si ridisegnano alla larghezza del riquadro
  const W = Math.max(260, Math.floor((box0.clientWidth || 544) - 26)), sx = 40, dx = 46, su = 10, giu = 30;     // a destra il posto per l'etichetta della media
  const larg = W - sx - dx;
  const passoX = larg / Math.max(N, 20), bw = Math.max(1.5, Math.min(14, passoX - 2));
  const cx = (i) => sx + passoX * (i + 0.5);
  // le fasi sotto l'asse: un tratto per ogni ruolo, con la sua lettera
  const fasi = (base) => {
    let f = "";
    for (let i = 0; i < N;) {
      let j = i; while (j + 1 < N && acq[j + 1].g.r === acq[i].g.r) j++;
      const x1 = sx + passoX * i + 1, x2 = sx + passoX * (j + 1) - 1;
      f += `<path class="fase ${acq[i].g.r}" d="M${x1.toFixed(1)} ${base + 8}H${x2.toFixed(1)}"/><text class="t-fase" x="${((x1 + x2) / 2).toFixed(1)}" y="${base + 22}">${acq[i].g.r}</text>`;
      i = j + 1;
    }
    return f;
  };
  // il bagliore della media: un filtro per grafico
  const bagliore = (id, alto) => `<defs><filter id="${id}" filterUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${alto}"><feGaussianBlur stdDeviation="3" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;
  // una colonna con la testa arrotondata, dalla riga di base fino a yv (sopra o sotto)
  const colonna = (classe, i, base, yv) => {
    const x = cx(i) - bw / 2, alto = Math.abs(yv - base), q = Math.min(4, bw / 2, alto), s = yv < base ? 1 : -1;
    return `<path class="${classe}" d="M${x.toFixed(1)} ${base}V${(yv + s * q).toFixed(1)}Q${x.toFixed(1)} ${yv.toFixed(1)} ${(x + q).toFixed(1)} ${yv.toFixed(1)}H${(x + bw - q).toFixed(1)}Q${(x + bw).toFixed(1)} ${yv.toFixed(1)} ${(x + bw).toFixed(1)} ${(yv + s * q).toFixed(1)}V${base}Z"/>`;
  };

  // --- andamento generale: il grafico. Una colonna per acquisto, alta quanto i crediti pagati
  // (scala lineare da zero), e la media degli ultimi acquisti.
  // La cima della scala segue la media e i prezzi tipici, non il colpo piu' caro: una colonna
  // che la supera si ferma in cima e porta scritto il suo prezzo.
  const suG = 18, altoG = 104, HG = suG + altoG + giu, baseG = suG + altoG;
  const ordinati = acq.map((a) => a.p).sort((a, b) => a - b), tipico = ordinati[Math.floor(0.9 * (N - 1))];
  const serve = Math.max(tipico, 1.1 * acq.reduce((a, x) => Math.max(a, x.c), 1));
  const cima = [4, 10, 20, 30, 40, 60, 80, 100, 150, 200, 300, 400, 500, 1000].find((t) => t >= serve) || Math.ceil(serve);
  const yG = (c) => baseG - (Math.min(c, cima) / cima) * altoG;
  const colonneG = acq.map((a, i) => colonna(a.p > cima ? "pagato oltre" : "pagato", i, baseG, Math.min(yG(a.p), baseG - 2))).join("");
  // i prezzi sopra la cima: prima i piu' alti, e mai due etichette una sull'altra
  const scritte = [];
  acq.map((a, i) => ({ p: a.p, x: cx(i) })).filter((a) => a.p > cima).sort((a, b) => b.p - a.p)
    .forEach((a) => { if (scritte.every((b) => Math.abs(b.x - a.x) >= 26)) scritte.push(a); });
  const oltre = scritte.map((a) => `<text class="t-oltre" x="${a.x.toFixed(1)}" y="${suG - 5}">${a.p}</text>`).join("");
  const lineaG = acq.map((a, i) => `${i ? "L" : "M"}${cx(i).toFixed(1)} ${yG(a.c).toFixed(1)}`).join("");
  const fineG = { x: cx(N - 1), y: yG(acq[N - 1].c) };
  h += `<div class="merc-leg"><span><i class="k pagato"></i>crediti pagati per ogni acquisto</span><span><i class="k linea"></i>media degli ultimi ${FINESTRA}</span></div>
    <div class="merc-graf"><svg class="merc gen${inAsta() ? " in-asta" : ""}" width="${W}" height="${HG}" viewBox="0 0 ${W} ${HG}" role="img" tabindex="0"
        aria-label="Andamento generale: ${N} acquisti, ${intero(spesi)} crediti spesi su ${intero(totCr)}; gli ultimi a ${fmt(acq[N - 1].c, 1)} crediti a giocatore. Frecce sinistra e destra per scorrere gli acquisti.">
      ${[0, cima / 2, cima].map((t) => `<path class="${t ? "griglia" : "base"}" d="M${sx} ${yG(t).toFixed(1)}H${W - dx}"/><text class="t-asse" x="${sx - 6}" y="${(yG(t) + 3.5).toFixed(1)}">${t}</text>`).join("")}
      ${colonneG}${oltre}${fasi(baseG)}
      ${bagliore("merc-glow-g", HG)}
      <path class="media" d="${lineaG}" filter="url(#merc-glow-g)"/><path class="media-luce" d="${lineaG}"/>
      <circle class="alone" cx="${fineG.x.toFixed(1)}" cy="${fineG.y.toFixed(1)}" r="8"/>
      <circle class="punto" cx="${fineG.x.toFixed(1)}" cy="${fineG.y.toFixed(1)}" r="5" filter="url(#merc-glow-g)"/>
      <text class="t-fine" x="${(fineG.x + 9).toFixed(1)}" y="${(fineG.y + 4).toFixed(1)}">${fmt(acq[N - 1].c, 0)} cr</text>
      <path class="mirino" d="M0 ${suG}V${baseG}" hidden/>
    </svg><div class="merc-tip" hidden></div></div>`;

  // --- rispetto al previsto: chiuso finche' non serve ---
  const ultimo = acq[N - 1].m, [parola, tono] = tonoMercato(ultimo);
  const riquadri = [box({ v: pct(ultimo), l: parola, ic: "polso", cls: "ora " + tono, sub: `ultimi ${Math.min(N, FINESTRA)} acquisti sul previsto` })];
  for (const r of RUOLI) {
    const t = MERC.term[r], tot = META.n_squadre * META.slot[r];
    riquadri.push(`<div class="box ruolo${r === fase ? " in-corso" : ""}${t.n ? "" : " zero"}" title="${NOMI_RUOLO[r]}: ${t.n ? `pagati ${t.pagato} crediti contro ${t.previsto} previsti` : "ancora nessun acquisto"}">
      <b>${t.n ? pct(t.pagato / Math.max(1, t.previsto)) : "–"}</b>
      <span class="box-l"><span class="role ${r}">${r}</span><span>${t.n}/${tot}${r === fase ? " in corso" : ""}</span></span></div>`);
  }
  const altoP = 124, H = su + altoP + giu, y0 = su + altoP / 2;
  const estremo = acq.some((a) => Math.abs(Math.log2(a.m)) > 1) ? Math.log2(3) : 1;      // 50-200%, o 33-300% se serve
  const y = (r) => y0 - (Math.max(-estremo, Math.min(estremo, Math.log2(Math.max(0.01, r)))) / estremo) * (altoP / 2);
  const tacche = (estremo > 1 ? [1 / 3, 0.5, 1, 2, 3] : [0.5, 1, 2]);
  const colonne = acq.map((a, i) => {
    const yv = y(a.r), piccolo = Math.max(a.p, a.e) <= 3;
    if (Math.abs(yv - y0) < 1.5) return `<rect class="pari" x="${(cx(i) - bw / 2).toFixed(1)}" y="${(y0 - 1).toFixed(1)}" width="${bw.toFixed(1)}" height="2"/>`;
    return colonna(`pagato${piccolo ? " piccolo" : ""}`, i, y0, yv);
  }).join("");
  const linea = acq.map((a, i) => `${i ? "L" : "M"}${cx(i).toFixed(1)} ${y(a.m).toFixed(1)}`).join("");
  const fine = { x: cx(N - 1), y: y(ultimo) };
  h += `<button type="button" class="merc-apri" data-espandi="merc-previsto" aria-expanded="${eraAperto}" aria-controls="merc-previsto"
        title="I prezzi attesi seguono già il tavolo da soli: qui vedi di quanto si sta pagando sopra o sotto il previsto">
      <span class="ma-t">${ico("polso")}Prezzi pagati rispetto al previsto</span><span class="ma-v ${tono}"><b>${pct(ultimo)}</b> ${parola}</span><span class="box-chev">${ico("giu")}</span></button>
    <div class="pannello${eraAperto ? " aperto" : ""}" id="merc-previsto"><div><div class="merc-in">
      <div class="boxes merc-box">${riquadri.join("")}</div>
      <div class="merc-leg"><span><i class="k pagato"></i>sopra la riga: pagato più del previsto; sotto: meno</span><span><i class="k linea"></i>media degli ultimi ${FINESTRA}</span></div>
      <div class="merc-graf"><svg class="merc prev${inAsta() ? " in-asta" : ""}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" tabindex="0"
          aria-label="Prezzi rispetto al previsto: ${N} acquisti, gli ultimi al ${pct(ultimo)} del prezzo previsto. Frecce sinistra e destra per scorrere gli acquisti.">
        ${tacche.map((t) => `<path class="${t === 1 ? "base" : "griglia"}" d="M${sx} ${y(t).toFixed(1)}H${W - dx}"/><text class="t-asse" x="${sx - 6}" y="${(y(t) + 3.5).toFixed(1)}">${Math.round(t * 100)}%</text>`).join("")}
        ${colonne}${fasi(su + altoP)}
        ${bagliore("merc-glow-p", H)}
        <path class="media" d="${linea}" filter="url(#merc-glow-p)"/><path class="media-luce" d="${linea}"/>
        <circle class="alone" cx="${fine.x.toFixed(1)}" cy="${fine.y.toFixed(1)}" r="8"/>
        <circle class="punto" cx="${fine.x.toFixed(1)}" cy="${fine.y.toFixed(1)}" r="5" filter="url(#merc-glow-p)"/>
        <text class="t-fine" x="${(fine.x + 9).toFixed(1)}" y="${(fine.y + 4).toFixed(1)}">${pct(ultimo)}</text>
        <path class="mirino" d="M0 ${su}V${su + altoP}" hidden/>
      </svg><div class="merc-tip" hidden></div></div>
    </div></div></div>`;
  box0.innerHTML = h;

  const chi = (i) => `${i + 1}° acquisto: ${acq[i].g.nome} (${acq[i].g.r}) a ${S.asta.squadre[acq[i].t]?.nome ?? ""}`;
  const [gGen, gPrev] = box0.querySelectorAll(".merc-graf");
  mirinoGrafico(gGen.querySelector("svg"), gGen.querySelector(".merc-tip"), { N, cx, sx, passoX, su: suG, alto: altoG, W }, (i) => [
    ["tip-v", `${acq[i].p} ${acq[i].p === 1 ? "credito" : "crediti"}`], ["", chi(i)],
    ["tip-m", `media degli ultimi ${Math.min(i + 1, FINESTRA)}: ${fmt(acq[i].c, 1)} crediti a giocatore`]]);
  mirinoGrafico(gPrev.querySelector("svg"), gPrev.querySelector(".merc-tip"), { N, cx, sx, passoX, su, alto: altoP, W }, (i) => {
    const a = acq[i], d = a.p - a.e;
    return [["tip-v", `${a.p} crediti, ${d === 0 ? "come previsto" : `${Math.abs(d)} ${d > 0 ? "più" : "meno"} del previsto (${a.e})`}`], ["", chi(i)],
      ["tip-m", `media degli ultimi ${Math.min(i + 1, FINESTRA)}: ${pct(a.m)} del previsto`]];
  });
}
