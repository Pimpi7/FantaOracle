// FantaOracle — Il calcio d'inizio: animazione del bottone Modalita' asta.
"use strict";

// --- il calcio d'inizio: il pallone rotola sul bottone, viene verso di te e apre il setup ---
// generato da scripts/pallone.py: icosaedro troncato gonfiato su una sfera, 12 pentagoni e 20 esagoni
const PALLONE = `<svg viewBox="0 0 100 100" aria-hidden="true"><defs><radialGradient id="pl-volume" cx="38%" cy="34%" r="68%"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="0.9" stop-color="#000" stop-opacity="0.28"/><stop offset="1" stop-color="#000" stop-opacity="0.5"/></radialGradient><radialGradient id="pl-riflesso" cx="34%" cy="28%" r="30%"><stop offset="0" stop-color="#fff" stop-opacity="0.6"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><g stroke="#5b625e" stroke-width="0.9" stroke-linejoin="round"><path d="M96.8 54.5L96.9 52.9L97.0 49.3L97.0 47.9L97.0 48.8L97.0 49.8L97.0 50.7L97.0 51.7L96.9 52.6L96.9 53.6Z" fill="rgb(170,170,172)"/><path d="M7.2 30.5L7.2 30.6L6.5 32.6L5.2 36.1L4.2 39.7L3.5 43.3L3.2 45.5L3.5 43.3L3.8 41.1L4.3 38.9L4.9 36.8L5.6 34.6L6.4 32.6Z" fill="rgb(39,42,45)"/><path d="M53.3 3.1L53.2 3.1L52.3 3.2L48.5 3.3L44.7 3.6L40.9 4.2L37.2 5.2L33.7 6.4L32.0 6.7L30.7 7.2L33.7 5.9L36.8 4.9L40.1 4.1L43.4 3.5L46.8 3.1L50.1 3.0Z" fill="rgb(44,47,50)"/><path d="M3.0 52.1L3.1 53.5L3.6 56.3L4.3 59.2L5.4 61.9L6.7 64.5L7.8 67.9L9.1 71.4L10.8 74.7L12.7 77.8L14.8 80.6L15.2 81.5L15.5 81.9L12.6 78.5L10.0 74.6L7.6 70.4L5.8 65.8L4.4 61.2L3.5 56.6Z" fill="rgb(181,181,183)"/><path d="M69.3 92.8L69.6 92.7L71.0 91.8L72.3 90.7L73.5 89.3L76.5 87.1L79.5 84.7L82.3 82.0L84.8 79.2L87.1 76.2L88.9 74.7L90.5 73.1L91.8 71.3L92.8 69.5L90.7 73.5L88.1 77.6L84.9 81.5L81.3 85.0L77.4 88.2L73.4 90.8Z" fill="rgb(170,170,172)"/><path d="M84.5 18.1L84.1 17.8L83.3 17.3L82.1 17.0L80.8 16.9L77.9 14.9L74.7 13.0L71.4 11.3L67.9 10.0L64.4 8.9L62.1 7.2L59.7 5.8L57.3 4.6L54.8 3.8L52.3 3.2L53.2 3.1L53.3 3.1L58.0 3.7L63.0 4.8L67.9 6.5L72.7 8.8L77.1 11.6L81.1 14.8Z" fill="rgb(202,202,204)"/><path d="M15.5 81.9L15.2 81.5L14.8 80.6L16.8 82.2L19.0 83.6L21.5 84.7L24.1 85.6L26.9 86.3L29.9 88.4L33.1 90.3L36.5 91.9L39.9 93.3L43.4 94.3L44.2 95.4L45.0 96.2L45.9 96.7L46.7 96.9L42.0 96.3L37.0 95.2L32.1 93.5L27.3 91.2L22.9 88.4L18.9 85.2Z" fill="rgb(170,170,172)"/><path d="M30.7 7.2L32.0 6.7L33.7 6.4L32.1 7.6L30.7 9.1L29.4 10.9L28.2 12.9L27.2 15.1L24.1 17.3L21.2 19.8L18.4 22.5L15.8 25.3L13.6 28.3L11.6 28.9L9.9 29.6L8.5 30.5L7.3 31.5L6.5 32.6L7.2 30.6L7.2 30.5L9.3 26.5L11.9 22.4L15.1 18.5L18.7 15.0L22.6 11.8L26.6 9.2Z" fill="rgb(240,240,242)"/><path d="M97.0 47.9L97.0 49.3L96.7 48.8L96.1 48.3L95.2 47.8L94.1 47.3L92.6 46.9L91.5 43.5L90.2 40.2L88.5 36.9L86.6 33.7L84.5 30.7L84.3 27.7L83.7 24.7L83.0 21.9L82.0 19.3L80.8 16.9L82.1 17.0L83.3 17.3L84.1 17.8L84.5 18.1L87.4 21.5L90.0 25.4L92.4 29.6L94.2 34.2L95.6 38.8L96.5 43.4Z" fill="rgb(170,170,172)"/><path d="M46.7 96.9L45.9 96.7L45.0 96.2L44.2 95.4L43.4 94.3L46.5 94.0L49.7 93.3L53.0 92.4L56.2 91.2L59.3 89.7L62.3 90.2L65.2 90.3L68.1 90.2L70.9 89.9L73.5 89.3L72.3 90.7L71.0 91.8L69.6 92.7L69.3 92.8L66.3 94.1L63.2 95.1L59.9 95.9L56.6 96.5L53.2 96.9L49.9 97.0Z" fill="rgb(22,25,28)"/><path d="M92.8 69.5L91.8 71.3L90.5 73.1L88.9 74.7L87.1 76.2L87.4 73.9L87.6 71.5L87.5 68.9L87.1 66.2L86.5 63.5L88.2 60.3L89.7 57.0L91.0 53.6L91.9 50.2L92.6 46.9L94.1 47.3L95.2 47.8L96.1 48.3L96.7 48.8L97.0 49.3L96.9 52.9L96.8 54.5L96.5 56.7L96.2 58.9L95.7 61.1L95.1 63.2L94.4 65.4L93.6 67.4Z" fill="rgb(22,25,28)"/><path d="M6.7 64.5L5.4 61.9L4.3 59.2L3.6 56.3L3.1 53.5L3.0 52.1L3.0 51.2L3.0 50.2L3.0 49.3L3.0 48.3L3.1 47.4L3.1 46.4L3.2 45.5L3.5 43.3L4.2 39.7L5.2 36.1L6.5 32.6L7.3 31.5L8.5 30.5L9.9 29.6L11.6 28.9L13.6 28.3L13.8 30.8L14.4 33.4L15.1 36.2L16.1 39.1L17.3 42.0L16.1 45.6L15.2 49.2L14.5 52.9L14.1 56.6L13.8 60.1L11.9 61.1L10.2 62.1L8.8 63.0L7.6 63.8Z" fill="rgb(235,235,237)"/><path d="M26.3 73.6L26.1 76.5L26.1 79.3L26.2 81.8L26.5 84.2L26.9 86.3L24.1 85.6L21.5 84.7L19.0 83.6L16.8 82.2L14.8 80.6L12.7 77.8L10.8 74.7L9.1 71.4L7.8 67.9L6.7 64.5L7.6 63.8L8.8 63.0L10.2 62.1L11.9 61.1L13.8 60.1L15.9 63.0L18.2 65.8L20.7 68.6L23.5 71.2Z" fill="rgb(38,41,44)"/><path d="M27.2 15.1L28.2 12.9L29.4 10.9L30.7 9.1L32.1 7.6L33.7 6.4L37.2 5.2L40.9 4.2L44.7 3.6L48.5 3.3L52.3 3.2L54.8 3.8L57.3 4.6L59.7 5.8L62.1 7.2L64.4 8.9L63.3 10.1L62.0 11.6L60.7 13.4L59.3 15.5L57.9 17.7L54.2 17.9L50.5 18.3L46.7 18.9L42.9 19.8L39.3 20.8L36.7 19.3L34.1 17.9L31.7 16.7L29.3 15.8Z" fill="rgb(245,245,247)"/><path d="M80.8 16.9L82.0 19.3L83.0 21.9L83.7 24.7L84.3 27.7L84.5 30.7L82.1 30.5L79.5 30.5L76.6 30.6L73.5 30.8L70.4 31.1L68.1 28.2L65.7 25.3L63.1 22.5L60.5 20.0L57.9 17.7L59.3 15.5L60.7 13.4L62.0 11.6L63.3 10.1L64.4 8.9L67.9 10.0L71.4 11.3L74.7 13.0L77.9 14.9Z" fill="rgb(45,48,51)"/><path d="M59.3 89.7L59.3 87.7L59.2 85.3L59.1 82.8L58.9 80.0L58.7 77.0L61.6 74.7L64.4 72.2L67.2 69.6L69.8 66.8L72.3 63.9L75.5 64.0L78.5 64.0L81.4 63.9L84.1 63.7L86.5 63.5L87.1 66.2L87.5 68.9L87.6 71.5L87.4 73.9L87.1 76.2L84.8 79.2L82.3 82.0L79.5 84.7L76.5 87.1L73.5 89.3L70.9 89.9L68.1 90.2L65.2 90.3L62.3 90.2Z" fill="rgb(170,170,172)"/><path d="M26.3 73.6L29.2 73.0L32.3 72.2L35.6 71.2L38.9 70.2L42.2 69.0L45.4 70.9L48.8 72.7L52.1 74.3L55.5 75.8L58.7 77.0L58.9 80.0L59.1 82.8L59.2 85.3L59.3 87.7L59.3 89.7L56.2 91.2L53.0 92.4L49.7 93.3L46.5 94.0L43.4 94.3L39.9 93.3L36.5 91.9L33.1 90.3L29.9 88.4L26.9 86.3L26.5 84.2L26.2 81.8L26.1 79.3L26.1 76.5Z" fill="rgb(187,187,189)"/><path d="M17.3 42.0L16.1 39.1L15.1 36.2L14.4 33.4L13.8 30.8L13.6 28.3L15.8 25.3L18.4 22.5L21.2 19.8L24.1 17.3L27.2 15.1L29.3 15.8L31.7 16.7L34.1 17.9L36.7 19.3L39.3 20.8L37.9 23.8L36.6 27.0L35.3 30.4L34.2 33.9L33.2 37.4L29.7 38.2L26.3 39.0L23.1 40.0L20.1 41.0Z" fill="rgb(60,63,66)"/><path d="M84.5 30.7L86.6 33.7L88.5 36.9L90.2 40.2L91.5 43.5L92.6 46.9L91.9 50.2L91.0 53.6L89.7 57.0L88.2 60.3L86.5 63.5L84.1 63.7L81.4 63.9L78.5 64.0L75.5 64.0L72.3 63.9L71.0 60.8L69.4 57.6L67.8 54.3L66.1 51.0L64.2 47.7L65.7 44.4L67.0 40.9L68.3 37.5L69.4 34.3L70.4 31.1L73.5 30.8L76.6 30.6L79.5 30.5L82.1 30.5Z" fill="rgb(199,199,201)"/><path d="M13.8 60.1L14.1 56.6L14.5 52.9L15.2 49.2L16.1 45.6L17.3 42.0L20.1 41.0L23.1 40.0L26.3 39.0L29.7 38.2L33.2 37.4L35.5 40.0L37.9 42.6L40.5 45.4L43.0 48.2L45.6 50.9L44.9 54.6L44.1 58.3L43.4 62.0L42.8 65.6L42.2 69.0L38.9 70.2L35.6 71.2L32.3 72.2L29.2 73.0L26.3 73.6L23.5 71.2L20.7 68.6L18.2 65.8L15.9 63.0Z" fill="rgb(238,238,240)"/><path d="M39.3 20.8L42.9 19.8L46.7 18.9L50.5 18.3L54.2 17.9L57.9 17.7L60.5 20.0L63.1 22.5L65.7 25.3L68.1 28.2L70.4 31.1L69.4 34.3L68.3 37.5L67.0 40.9L65.7 44.4L64.2 47.7L60.6 48.4L56.9 49.0L53.1 49.6L49.3 50.3L45.6 50.9L43.0 48.2L40.5 45.4L37.9 42.6L35.5 40.0L33.2 37.4L34.2 33.9L35.3 30.4L36.6 27.0L37.9 23.8Z" fill="rgb(244,244,246)"/><path d="M45.6 50.9L49.3 50.3L53.1 49.6L56.9 49.0L60.6 48.4L64.2 47.7L66.1 51.0L67.8 54.3L69.4 57.6L71.0 60.8L72.3 63.9L69.8 66.8L67.2 69.6L64.4 72.2L61.6 74.7L58.7 77.0L55.5 75.8L52.1 74.3L48.8 72.7L45.4 70.9L42.2 69.0L42.8 65.6L43.4 62.0L44.1 58.3L44.9 54.6Z" fill="rgb(42,45,48)"/></g><circle cx="50.0" cy="50.0" r="47.0" fill="url(#pl-volume)"/><ellipse cx="36" cy="30" rx="17" ry="12" fill="url(#pl-riflesso)" transform="rotate(-30 36 30)"/><circle cx="50.0" cy="50.0" r="47.0" fill="none" stroke="#2b302d" stroke-width="1.4"/></svg>`;
let inVolo = false;
function calcioDInizio(btn) {
  const orig = btn.querySelector(".pallone");
  if (inVolo) return;
  if (!orig || !window.matchMedia("(prefers-reduced-motion: no-preference)").matches || !Element.prototype.animate) return avvioAsta();
  inVolo = true;
  btn.classList.remove("pulse");                                 // misura il pallone fermo, non a meta' palleggio
  const b = orig.getBoundingClientRect(), k = btn.getBoundingClientRect();
  const volo = document.createElement("div");
  volo.className = "pallone-volo";
  volo.innerHTML = PALLONE;
  Object.assign(volo.style, { left: b.left + "px", top: b.top + "px", width: b.width + "px", height: b.height + "px" });
  document.body.appendChild(volo);
  orig.style.opacity = "0";           // non visibility: i gradienti del pallone devono restare attivi
  btn.querySelector(".ombra").style.opacity = "0";

  // Traiettoria simulata, non disegnata a mano:
  // 1) rotola verso sinistra lungo la linea del bottone, accelerando da fermo; la rotazione e' la
  //    distanza fratto la circonferenza, quindi non striscia;
  // 2) arrivato alla curva sinistra cade dal bottone: moto parabolico, con la velocita' orizzontale
  //    che aveva e la gravita';
  // 3) tocca terra (a circa 2/3 dello schermo), si schiaccia per un istante e rimbalza verso la
  //    telecamera: sale frenato dalla gravita' e si avvicina, quindi in prospettiva si ingrandisce e
  //    converge al centro dello schermo, dove arriva al culmine del rimbalzo.
  const d = b.width, r = d / 2, H = k.height;
  const x0 = b.left + r, y0 = b.top + r;                          // centro del pallone a riposo
  const L = x0 - (k.left + H / 2);                                // corsa sul bottone (verso sinistra)
  const Tr = 0.5, a = 2 * L / (Tr * Tr), v = a * Tr;              // accelerazione costante da fermo
  const g = 3400;                                                 // px/s^2
  const yF = Math.max(y0 + 160, innerHeight * 0.66);              // quota del centro al rimbalzo
  const Tf = Math.sqrt(2 * (yF - y0) / g);
  const vx = Math.min(v, Math.max(0, (x0 - L - r - 8) / Tf));     // non esce dal bordo sinistro
  const xF = x0 - L - vx * Tf;
  const Ts = 0.06, Tc = 0.72;                                     // schiacciamento e rimbalzo
  const SFUMA = 0.86;                                             // da qui il pallone svanisce
  const T = Tr + Tf + Ts + Tc;
  const Cx = innerWidth / 2, Cy = innerHeight / 2;
  const smax = Math.max(innerWidth, innerHeight) / d * 1.6;
  const gz = 2 * (yF - Cy) / (Tc * Tc);                           // gravita' "nel mondo" del rimbalzo
  const deg = (dist) => (dist / (Math.PI * d)) * 360;
  const frames = [];
  const push = (t, x, y, rot, sx = 1, sy = 1, op = 1) => frames.push({
    offset: Math.min(1, t / T), opacity: op,
    transform: `translate(${(x - x0).toFixed(1)}px,${(y - y0).toFixed(1)}px) scale(${sx.toFixed(3)},${sy.toFixed(3)}) rotate(${rot.toFixed(1)}deg)`,
  });
  const dt = 1 / 60;
  for (let t = 0; t < Tr; t += dt) { const s = 0.5 * a * t * t; push(t, x0 - s, y0, -deg(s)); }
  const rotE = -deg(L);
  for (let t = 0; t < Tf; t += dt) push(Tr + t, x0 - L - vx * t, y0 + 0.5 * g * t * t, rotE - deg(vx * t + 0.5 * g * t * t * 0.15));
  const rotF = rotE - deg(vx * Tf + 0.5 * g * Tf * Tf * 0.15);
  push(Tr + Tf, xF, yF, rotF);
  push(Tr + Tf + Ts * 0.5, xF, yF + r * 0.14, rotF - 6, 1.18, 0.78);   // schiacciato a terra
  const t0 = Tr + Tf + Ts;
  // passi da 1/60 s piu' l'istante finale esatto: se l'ultimo fotogramma non cade a offset 1 il browser
  // ne aggiunge uno con la trasformazione di partenza e il pallone tornerebbe indietro all'ultimo
  const passi = [];
  for (let t = 0; t < Tc; t += dt) passi.push(t);
  passi.push(Tc);
  for (const t of passi) {
    const u = Math.min(1, t / Tc);
    const s = 1 / (1 - (1 - 1 / smax) * u);                       // avvicinamento costante: prospettiva
    // (1 - u)^2: moltiplicato per la scala prospettica da' uno spostamento sullo schermo che converge
    // al centro in modo regolare, invece di restare fermo e scattare al centro solo alla fine
    const X = (xF - Cx) * (1 - u) * (1 - u);
    const Y = (yF - Cy) - gz * Tc * t + 0.5 * gz * t * t;         // culmine esattamente al centro
    const op = u < SFUMA ? 1 : Math.max(0, 1 - (u - SFUMA) / (1 - SFUMA));
    push(t0 + t, Cx + X * s, Cy + Y * s, rotF - 10 - 260 * u, s, s, op);
  }
  const anim = volo.animate(frames, { duration: T * 1000, fill: "forwards" });
  // il setup (o l'asta sospesa) si apre quando il pallone, arrivato addosso, e' a meta' della
  // dissolvenza: prima lo coprirebbe ancora pieno, dopo resterebbe un istante di schermo vuoto.
  // Si guarda l'animazione fotogramma per fotogramma invece di un timer: su una pagina carica il
  // pallone parte in ritardo o perde fotogrammi, e un timer aprirebbe il setup fuori tempo.
  const apriA = (t0 + Tc * (1 + SFUMA) / 2) * 1000;
  const aspetta = () => (anim.currentTime >= apriA || anim.playState === "finished" ? avvioAsta() : requestAnimationFrame(aspetta));
  requestAnimationFrame(aspetta);
  anim.finished.finally(() => {
    volo.remove();
    orig.style.opacity = "";
    btn.querySelector(".ombra").style.opacity = "";
    btn.classList.add("pulse");
    inVolo = false;
  });
}
