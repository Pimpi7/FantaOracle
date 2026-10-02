// Legge dal tool pubblicato il grafico "Andamento del mercato" di un'asta e lo salva in CSV.
//
// Apre la pagina, carica l'asta esportata (il testo di "Esporta l'asta") nella memoria del browser
// come farebbe Importa, apre il pannello "Prezzi pagati rispetto al previsto" e passa il mirino su
// ogni colonna dei due grafici: quello che compare nel riquadro (crediti, giocatore, squadra, media
// degli ultimi acquisti, scarto dal previsto) diventa una riga. Salva anche l'immagine del riquadro
// e i numeri dei riquadri in alto.
//
//   node src/tools/scraping_grafico_asta.js <asta.json> <cartella di uscita> [url]
//
// Serve Playwright (npm i -g playwright; PW=$(npm root -g)/playwright se non e' nel percorso di Node).
// Scrive grafico.csv, grafico.png e grafico_riquadri.json nella cartella di uscita.
"use strict";
const fs = require("fs"), path = require("path");
const { chromium } = require(process.env.PW || "playwright");

(async () => {
  const [fileAsta, uscita, url = "https://pimpi7.github.io/FantaOracle/"] = process.argv.slice(2);
  if (!fileAsta || !uscita) { console.error("uso: node scraping_grafico_asta.js <asta.json> <cartella di uscita> [url]"); process.exit(2); }
  const asta = JSON.parse(fs.readFileSync(fileAsta, "utf8")).asta;
  fs.mkdirSync(uscita, { recursive: true });

  const browser = await chromium.launch({ proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined });
  const pagina = await (await browser.newContext({ viewport: { width: 1440, height: 1600 }, deviceScaleFactor: 2, colorScheme: "light", locale: "it-IT" })).newPage();
  const errori = [];
  pagina.on("pageerror", (e) => errori.push(e.message));
  await pagina.goto(url, { waitUntil: "load" });
  await pagina.waitForFunction(() => document.querySelectorAll("#rows tr").length > 20);
  // come Importa: l'asta nella memoria del browser, poi si ricarica e il tool riparte in asta
  await pagina.evaluate((a) => {
    const stato = JSON.parse(localStorage.getItem("fantaoracle:v1") || "{}");
    localStorage.setItem("fantaoracle:v1", JSON.stringify({ ...stato, asta: { ...a, attiva: true } }));
  }, asta);
  await pagina.reload({ waitUntil: "load" });
  await pagina.waitForFunction(() => document.querySelectorAll("#rows tr").length > 20 && document.querySelector("#mercato svg.merc.gen"));
  await pagina.evaluate(() => document.fonts.ready);
  await pagina.click(".merc-apri");
  await pagina.waitForTimeout(600);

  const riquadri = await pagina.evaluate(() => ({
    dati: `Serie A ${META.stagione}, dati alla ${META.giornata}ª giornata`,
    generale: [...document.querySelectorAll("#mercato .merc-box.gen .box")].map((x) => x.textContent.replace(/\s+/g, " ").trim()),
    previsto: [...document.querySelectorAll("#merc-previsto .merc-box .box")].map((x) => x.textContent.replace(/\s+/g, " ").trim()),
    acquisti: S.asta.log.length,
  }));

  // il mirino su ogni colonna: le coordinate sono quelle con cui il grafico e' disegnato
  const leggi = async (selettore, indiceRiquadro) => {
    const svg = await pagina.$(selettore), bb = await svg.boundingBox();
    const W = +(await svg.getAttribute("width")), N = riquadri.acquisti, passo = (W - 40 - 46) / Math.max(N, 20), scala = bb.width / W;
    const righe = [];
    for (let i = 0; i < N; i++) {
      await pagina.mouse.move(bb.x + (40 + passo * (i + 0.5)) * scala, bb.y + bb.height / 2);
      righe.push(await pagina.evaluate((k) => [...document.querySelectorAll(".merc-tip")[k].children].map((x) => x.textContent), indiceRiquadro));
    }
    await pagina.mouse.move(2, 2);
    return righe;
  };
  const sopra = await leggi("#mercato svg.merc.gen", 0), sotto = await leggi("#mercato svg.merc.prev", 1);

  const num = (s) => +String(s).replace(/\./g, "").replace(",", ".");
  const righe = sopra.map((s, i) => {
    const chi = /^(\d+)° acquisto: (.+) \(([PDCA])\) a (.*)$/.exec(s[1]);
    const prev = /^(\d+) credit[oi], (?:come previsto|(\d+) (più|meno) del previsto \((\d+)\))$/.exec(sotto[i][0]);
    if (!chi || !prev || +chi[1] !== i + 1 || sotto[i][1] !== s[1]) throw new Error(`riga ${i + 1} non letta: ${JSON.stringify([s, sotto[i]])}`);
    const crediti = num(/^(\d+)/.exec(s[0])[1]);
    if (crediti !== +prev[1]) throw new Error(`riga ${i + 1}: i due grafici danno prezzi diversi`);
    return { n: i + 1, giocatore: chi[2], ruolo: chi[3], fantasquadra: chi[4], crediti,
      previsto: prev[4] ? +prev[4] : crediti,
      media6_crediti: num(/: ([\d.,]+) crediti/.exec(s[2])[1]), media6_pct_previsto: num(/: (\d+)%/.exec(sotto[i][2])[1]) };
  });
  const csv = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const colonne = ["n", "giocatore", "ruolo", "fantasquadra", "crediti", "previsto", "media6_crediti", "media6_pct_previsto"];
  fs.writeFileSync(path.join(uscita, "grafico.csv"), [colonne.join(","), ...righe.map((r) => colonne.map((c) => csv(r[c])).join(","))].join("\n") + "\n");
  fs.writeFileSync(path.join(uscita, "grafico_riquadri.json"), JSON.stringify({ url, letto: new Date().toISOString(), ...riquadri }, null, 1) + "\n");

  // l'immagine del riquadro, con il pallino della media fermo
  await pagina.addStyleTag({ content: ".merc .alone { animation: none !important; }" });
  await (await pagina.$("#mercato")).screenshot({ path: path.join(uscita, "grafico.png") });
  await browser.close();
  console.log(`${righe.length} acquisti letti dal grafico di ${url}`);
  if (errori.length) { console.error(errori.join("\n")); process.exit(1); }
})().catch((e) => { console.error(e.message); process.exit(1); });
