// FantaOracle — Asta live: stato delle squadre e sincronizzazione.
"use strict";

// --- asta live --------------------------------------------------------------------------
// Segnaposto finche' non li conosciamo: nomi dei partecipanti e tipo di asta.
// Oggi ogni ruolo si puo' chiamare in qualsiasi momento (chiamata libera).
const NOMI_DEFAULT = ["La mia squadra", ...Array.from({ length: 19 }, (_, i) => `Squadra ${i + 2}`)];
const TITOLARI_8 = { P: 8, D: 32, C: 28, A: 20 };      // titolari tipici del ruolo in una lega da 8 squadre
const TITOLARI_LEGA = () => Object.fromEntries(RUOLI.map((r) => [r, Math.round(TITOLARI_8[r] * META.n_squadre / 8)]));
let OWNER = new Map();                                  // id giocatore -> indice squadra
let SOGLIA = {};                                        // pt/g dell'ultimo titolare della lega per ruolo
let SPINTA = { chiave: null, val: null };

const MAXOFF0 = () => META.crediti - (RUOLI.reduce((a, r) => a + META.slot[r], 0) - 1);

function statoSquadre() {
  const slot = META.slot;
  return S.asta.squadre.map((t, i) => {
    const n = { P: 0, D: 0, C: 0, A: 0 };
    let spesa = 0;
    for (const [id, pz] of Object.entries(t.rosa)) { const g = BY_ID.get(+id); if (g) { n[g.r]++; spesa += +pz; } }
    const liberi = {}; let liberiTot = 0;
    for (const r of RUOLI) { liberi[r] = slot[r] - n[r]; liberiTot += Math.max(0, liberi[r]); }
    const crediti = META.crediti - spesa;
    return { i, nome: t.nome, spesa, crediti, liberi, liberiTot, n,
             maxOff: liberiTot > 0 ? crediti - (liberiTot - 1) : 0 };
  });
}

function sincronizzaAsta() {
  OWNER = new Map();
  S.asta.squadre.forEach((t, i) => Object.keys(t.rosa).forEach((id) => OWNER.set(+id, i)));
  // "Presi da altri" non si segna piu' a mano: sono le rose degli avversari.
  S.presi = {};
  for (const [id, i] of OWNER) if (i !== S.asta.io) S.presi[id] = true;
  if (!S.asta.modo) S.asta.modo = "ruolo";
  if (!S.asta.giro) S.asta.giro = { verso: 1, turno: 0 };

  const st = statoSquadre();
  // Crediti spendibili oltre il minimo di 1 per slot, e per ogni ruolo gli slot ancora aperti
  // in lega con i giocatori liberi piu' cari che li riempiranno (la domanda, ai prezzi di partenza).
  const disp = st.reduce((a, t) => a + Math.max(0, t.crediti - t.liberiTot), 0);
  const aperti = {}, resti = {}, dom = {};
  for (const r of RUOLI) {
    aperti[r] = st.reduce((a, t) => a + Math.max(0, t.liberi[r]), 0);
    resti[r] = DATA.giocatori.filter((g) => g.r === r && !OWNER.has(g.id)).map((g) => g.pa).sort((a, b) => b - a).slice(0, aperti[r]);
    dom[r] = resti[r].reduce((a, pa) => a + Math.max(0, pa - 1), 0);
  }
  const domTot = RUOLI.reduce((a, r) => a + dom[r], 0);
  INFL = domTot > 0 ? limita(disp / domTot) : 1;

  // Termometro di ogni ruolo: quanto si e' pagato rispetto al previsto.
  const term = Object.fromEntries(RUOLI.map((r) => [r, { pagato: 0, previsto: 0, n: 0 }]));
  for (const x of S.asta.log) {
    const g = BY_ID.get(x.id); if (!g) continue;
    const t = term[g.r]; t.pagato += x.p; t.previsto += g.pa; t.n++;
  }

  // Titolari: per ogni ruolo i giocatori buoni ancora liberi (da titolare per i nostri punti, o
  // in fascia alta per SOS Fanta) e quanti posti da titolare restano da riempire, squadra per squadra.
  const quadro = {};
  for (const r of RUOLI) {
    const buoni = DATA.giocatori.filter((g) => g.r === r && !OWNER.has(g.id) && buono(g)).sort(perFascia);
    const perSquadra = TITOLARI_LEGA()[r] / st.length;
    const bisogno = st.map((t) => {
      const ha = Object.keys(S.asta.squadre[t.i].rosa).filter((id) => { const g = BY_ID.get(+id); return g && g.r === r && buono(g); }).length;
      return Math.max(0, Math.min(t.liberi[r], perSquadra - ha));
    });
    const mio = bisogno[S.asta.io], altri = bisogno.reduce((a, x) => a + x, 0) - mio;
    // La fascia dell'ultimo titolare di ogni squadra: un giocatore libero di fascia piu' alta le
    // farebbe comodo anche se i titolari li ha gia' (99 = non ha ancora tutti i titolari, o senza fascia).
    const nTit = Math.ceil(perSquadra);
    const peggiore = st.map((t) => {
      const suoi = Object.keys(S.asta.squadre[t.i].rosa).map((id) => BY_ID.get(+id)).filter((g) => g && g.r === r).sort(perFascia);
      return suoi.length < nTit ? 99 : suoi[nTit - 1].fa ?? 99;
    });
    quadro[r] = { buoni, bisogno, peggiore, perSquadra, mio, altri, posti: Math.round(mio + altri) };
  }

  // Asta per ruolo: il ruolo in corso e' il primo con slot ancora aperti. I suoi prezzi seguono
  // il termometro del ruolo (con il mercato generale come punto di partenza, che pesa quanto il
  // 15% della spesa attesa del ruolo). Quello che il tavolo spende qui manca ai ruoli dopo: i
  // loro prezzi si riscalano sui crediti che restano. Nell'ultimo ruolo i crediti avanzati non
  // servono piu' a niente, quindi il conto dei crediti rimasti pesa quanto il termometro.
  // Un tavolo che paga caro resta caro finche' i rivali cercano titolari: quando i buoni rimasti
  // sono piu' dei posti che i rivali devono ancora riempire, il rincaro si spegne in proporzione.
  const fase = perRuolo() ? ORDINE_RUOLI.find((r) => aperti[r] > 0) || null : null;
  const oltreMinimo = (r, f) => resti[r].reduce((a, pa) => a + Math.max(0, pa * f - 1), 0);
  FATT = Object.fromEntries(RUOLI.map((r) => [r, INFL]));
  let futuri = [];
  if (fase) {
    futuri = ORDINE_RUOLI.slice(ORDINE_RUOLI.indexOf(fase) + 1).filter((r) => aperti[r] > 0);
    const t = term[fase], k = PESO_PARTENZA * SPESA_RUOLO[fase];
    const q = quadro[fase], contesa = Math.min(1, q.altri / Math.max(1, q.buoni.length));
    const smorza = (f) => (f > 1 ? 1 + (f - 1) * contesa : f);
    const visto = (t.pagato + k * INFL) / (t.previsto + k);
    if (futuri.length) {
      FATT[fase] = smorza(limita(visto));
      const domFut = futuri.reduce((a, r) => a + dom[r], 0);
      const dopo = domFut > 0 ? limita((disp - oltreMinimo(fase, FATT[fase])) / domFut) : 1;
      for (const r of futuri) FATT[r] = dopo;
    } else FATT[fase] = smorza(limita(Math.sqrt(visto * INFL)));
  }

  // Budget di ruolo: quanto puo' mettere una squadra su un giocatore del ruolo in corso senza
  // intaccare i crediti che le servono, in media, per riempire i ruoli dopo (e tenendo 1 credito
  // per ogni altro slot del ruolo). Nell'ultimo ruolo coincide con l'offerta massima.
  const medio = {};
  for (const r of RUOLI) medio[r] = aperti[r] ? resti[r].reduce((a, pa) => a + Math.max(1, pa * FATT[r]), 0) / aperti[r] : 0;
  const comodo = st.map((t) => {
    if (!fase) return t.maxOff;
    if (t.liberi[fase] <= 0 || t.maxOff < 1) return 0;
    const riserva = futuri.reduce((a, r) => a + Math.max(0, t.liberi[r]) * medio[r], 0);
    return Math.max(1, Math.min(t.maxOff, Math.round(t.crediti - riserva - (t.liberi[fase] - 1))));
  });
  MERC = { st, fase, futuri, aperti, resti, dom, disp, term, comodo, medio, quadro };
}

// Perche' un giocatore e' un'occasione: chi lo vuole e fin dove puo' arrivare.
function perche(o) {
  const budget = conBudgetDiRuolo(o.g.r) ? "budget di ruolo" : "offerta massima";
  if (o.come === "coda") return !o.prima || o.maxRivali >= o.ricco
    ? { corto: `i rivali arrivano a ${o.maxRivali}`, lungo: `È l'ultimo ruolo, chi ha uno slot offre quello che gli resta: il più ricco arriva a ${o.maxRivali}, lo batti con un credito in più` }
    : { corto: `dopo i più ricchi: rivali fino a ${o.maxRivali}`, lungo: `È l'ultimo ruolo: ai rivali che hanno ancora crediti ${o.ricchi === 1 ? "resta 1 slot" : `restano ${o.ricchi} slot`}, e punteranno sui più cari fra i liberi. Per prezzo è al posto ${o.prima + 1} fra i liberi: quando hanno comprato restano offerte fino a ${o.maxRivali}, lo prendi con un credito in più. Chiamato prima può salire fino a ${o.ricco}` };
  if (o.come === "solo") return { corto: "nessun rivale ha posto", lungo: "Nessun rivale ha più uno slot nel ruolo: è tuo al minimo" };
  if (o.come === "rivali") return { corto: `${o.n === 1 ? "lo vuole 1 rivale" : `lo vogliono in ${o.n}`}, fino a ${o.maxRivali}`,
    lungo: `${o.n === 1 ? "Lo vuole ancora 1 rivale" : `Lo vogliono ancora ${o.n} rivali`}${perRuolo() ? " (cercano un titolare, o hanno titolari di fascia più bassa)" : ""}: il più ricco arriva a ${o.maxRivali} di ${budget}, lo batti con un credito in più` };
  if (o.come === "secco") return o.riserva
    ? { corto: "da riserva: chi lo vuole è a secco", lungo: `I rivali che lo vorrebbero da titolare non hanno più ${budget} per rilanciare: gli altri lo prenderebbero solo come riserva, al prezzo di una riserva` }
    : { corto: "chi lo vuole ha finito i crediti", lungo: `I rivali che lo vorrebbero non hanno più ${budget} per rilanciare` };
  if (o.senzaPosto) return { corto: "ai rivali non restano slot: da riserva", lungo: "I liberi più cari di lui sono più degli slot che restano ai rivali nel ruolo: prima ne hanno altri da prendere. Va via al prezzo di una riserva" };
  return { corto: "ai rivali non serve: da riserva", lungo: "Nessun rivale lo vuole da titolare: hanno già i loro, di fascia pari o più alta. Lo prenderebbero solo come riserva, al prezzo di una riserva" };
}

// Le fasce ancora libere nel ruolo: quanti giocatori restano in ogni fascia, dalla piu' alta
// fino alla fascia media. E' il colpo d'occhio su cosa c'e' ancora di buono per la guida.
function fasceLibere(r) {
  const fino = indiceFascia("Fascia media", 7), conta = new Map();
  for (const g of DATA.giocatori) if (g.r === r && !OWNER.has(g.id) && g.fa != null && g.fa <= fino) conta.set(g.fa, (conta.get(g.fa) || 0) + 1);
  if (!conta.size) return `<p class="fasce-libere"><span class="lbl">Nessun ${{ P: "portiere", D: "difensore", C: "centrocampista", A: "attaccante" }[r]} libero dalla fascia media in su.</span></p>`;
  return `<p class="fasce-libere"><span class="lbl">Ancora liberi</span>${[...conta].sort((a, b) => a[0] - b[0]).map(([fa, n]) =>
    `<span><span class="fd" style="--c:${coloreFascia(META.fasce[fa])}" data-fa="${fa}" role="img" aria-label="Fascia"></span>${esc(META.fasce[fa])} <b>${n}</b></span>`).join("")}</p>`;
}

// Quanto puo' offrire una squadra per un giocatore del ruolo r: il budget di ruolo se e' il
// ruolo in corso di un'asta per ruolo, altrimenti l'offerta massima.
const budgetSquadra = (t, r) => (t.liberi[r] <= 0 ? 0 : MERC && MERC.fase === r ? MERC.comodo[t.i] : t.maxOff);
const conBudgetDiRuolo = (r) => !!MERC && MERC.fase === r && MERC.futuri.length > 0;
