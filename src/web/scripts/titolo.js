// FantaOracle — Titolo: anelli di cifre binarie intorno alla sfera della O.
"use strict";

// --- titolo: anelli di cifre binarie che girano intorno alla sfera della O ------------------------
// Ogni cifra sta su un anello circolare visto di sbieco (un'ellisse inclinata). Sulla meta' davanti
// e' disegnata sopra la sfera, su quella dietro sotto; verso i lati si accorcia e verso il fondo
// si rimpicciolisce e sbiadisce, come farebbe un anello vero. Le cifre sono "Fanta" e "Oracle" in ASCII.
function anelliSfera() {
  const svg = document.getElementById("o-sfera");
  if (!svg) return;
  const NS = "http://www.w3.org/2000/svg", dietro = svg.querySelector(".dietro"), davanti = svg.querySelector(".davanti");
  const bin = (t) => [...t].map((c) => c.charCodeAt(0).toString(2).padStart(8, "0")).join("");
  const ANELLI = [
    { rx: 68, ry: 17, tilt: -17, cifre: bin("Fanta"), giro: 18, cls: "b1" },
    { rx: 61, ry: 27, tilt: 24, cifre: bin("Oracle"), giro: -26, cls: "b2" },
  ];
  const punti = [];
  for (const a of ANELLI) {
    [...a.cifre].forEach((ch, i) => {
      const els = [dietro, davanti].map((g) => {
        const t = document.createElementNS(NS, "text");
        t.setAttribute("class", a.cls); t.textContent = ch; t.setAttribute("opacity", "0");
        g.appendChild(t); return t;
      });
      punti.push({ a, f: i / a.cifre.length, els, lato: -1 });
    });
  }
  const disegna = (sec) => {
    for (const p of punti) {
      const { a } = p, th = 2 * Math.PI * (p.f + sec / a.giro), s = Math.sin(th), c = Math.cos(th);
      const k = (a.tilt * Math.PI) / 180, x0 = a.rx * c, y0 = a.ry * s;
      const x = x0 * Math.cos(k) - y0 * Math.sin(k), y = x0 * Math.sin(k) + y0 * Math.cos(k);
      const ang = (Math.atan2(-a.ry * c, a.rx * s) * 180) / Math.PI + a.tilt;
      const scorcio = Math.max(0.25, Math.hypot(s, (a.ry / a.rx) * c));   // piu' stretta ai lati
      const prof = (s + 1) / 2, sc = 0.72 + 0.38 * prof;                   // 0 in fondo, 1 davanti
      const lato = s >= 0 ? 1 : 0, el = p.els[lato];
      if (lato !== p.lato) { p.els[1 - lato].setAttribute("opacity", "0"); p.lato = lato; }
      el.setAttribute("transform", `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${ang.toFixed(1)}) scale(${(sc * scorcio).toFixed(3)} ${sc.toFixed(3)})`);
      el.setAttribute("opacity", (0.2 + 0.8 * prof).toFixed(2));
    }
  };
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return disegna(0);
  let ultimo = -1e9;
  const giro = (ms) => { if (ms - ultimo > 33) { disegna(ms / 1000); ultimo = ms; } requestAnimationFrame(giro); };
  requestAnimationFrame(giro);
}
