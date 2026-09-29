"""Genera l'SVG del pallone del bottone "Modalita' asta".

Un pallone classico a 32 pannelli (12 pentagoni neri, 20 esagoni bianchi) e'
un icosaedro troncato gonfiato su una sfera. Qui lo si costruisce davvero:
vertici dell'icosaedro troncato, facce dal guscio convesso, lati suddivisi e
riportati sulla sfera (cosi' le cuciture sono curve), proiezione ortografica
del solo emisfero visibile e ombreggiatura per faccia, piu' un velo sferico e
un riflesso per il volume.

    python scripts/pallone.py > /tmp/pallone.svg

Stampa l'SVG su una riga, pronto da incollare nella costante PALLONE di
web/tool.html.
"""

from __future__ import annotations

import itertools

import numpy as np
from scipy.spatial import ConvexHull

PHI = (1 + 5 ** 0.5) / 2
R, C = 47.0, 50.0                  # raggio e centro nel viewBox 0 0 100 100
SUDDIVISIONI = 5                   # punti per lato: piu' alti = cuciture piu' tonde
LUCE = np.array([-0.45, -0.55, 0.70])
LUCE = LUCE / np.linalg.norm(LUCE)


def vertici() -> np.ndarray:
    base = [(0, 1, 3 * PHI), (1, 2 + PHI, 2 * PHI), (PHI, 2, 2 * PHI + 1)]
    pari = [(0, 1, 2), (1, 2, 0), (2, 0, 1)]         # permutazioni cicliche (pari)
    out = set()
    for b in base:
        for s in itertools.product((1, -1), repeat=3):
            v = [b[i] * s[i] for i in range(3)]
            for p in pari:
                out.add(tuple(round(v[i], 9) for i in p))
    v = np.array(sorted(out))
    assert len(v) == 60, len(v)
    return v / np.linalg.norm(v[0])


def facce(v: np.ndarray) -> list[list[int]]:
    """Facce poligonali: triangoli del guscio convesso raggruppati per piano."""
    hull = ConvexHull(v)
    gruppi: dict[tuple, set] = {}
    for simp, eq in zip(hull.simplices, hull.equations):
        gruppi.setdefault(tuple(np.round(eq, 5)), set()).update(simp)
    out = []
    for eq, idx in gruppi.items():
        idx = list(idx)
        n = np.array(eq[:3])
        c = v[idx].mean(axis=0)
        a = v[idx[0]] - c
        a /= np.linalg.norm(a)
        b = np.cross(n, a)
        ang = [np.arctan2((v[i] - c) @ b, (v[i] - c) @ a) for i in idx]
        out.append([i for _, i in sorted(zip(ang, idx))])
    assert sorted(len(f) for f in out) == [5] * 12 + [6] * 20
    return out


def _rot(asse: str, g: float) -> np.ndarray:
    g = np.radians(g)
    c, s = np.cos(g), np.sin(g)
    return {"x": np.array([[1, 0, 0], [0, c, -s], [0, s, c]]),
            "y": np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]]),
            "z": np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])}[asse]


def ruota(v: np.ndarray, verso: np.ndarray, tilt=(-14.0, 11.0, 8.0)) -> np.ndarray:
    """Porta `verso` (il centro di un pentagono) davanti all'osservatore, poi inclina un po'."""
    a = verso / np.linalg.norm(verso)
    z = np.array([0.0, 0.0, 1.0])
    k = np.cross(a, z)
    s, c = np.linalg.norm(k), a @ z
    if s < 1e-9:
        m = np.eye(3)
    else:
        k /= s
        K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
        m = np.eye(3) + s * K + (1 - c) * K @ K          # Rodrigues
    m = _rot("z", tilt[2]) @ _rot("y", tilt[1]) @ _rot("x", tilt[0]) @ m
    return v @ m.T


def sfera_poligono(pts: np.ndarray) -> np.ndarray:
    """Lati suddivisi e proiettati sulla sfera: il pannello diventa curvo."""
    out = []
    for a, b in zip(pts, np.roll(pts, -1, axis=0)):
        for t in np.linspace(0, 1, SUDDIVISIONI, endpoint=False):
            p = a + (b - a) * t
            out.append(p / np.linalg.norm(p))
    return np.array(out)


def taglia_emisfero(pts: np.ndarray) -> np.ndarray:
    """Sutherland-Hodgman sul piano z = 0; i tratti nuovi stanno sul bordo del disco."""
    out = []
    n = len(pts)
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        if a[2] >= 0:
            out.append(a)
        if (a[2] >= 0) != (b[2] >= 0):
            t = a[2] / (a[2] - b[2])
            p = a + (b - a) * t
            p[2] = 0
            out.append(p / np.linalg.norm(p))
    if len(out) < 3:
        return np.empty((0, 3))
    # i tratti lungo il bordo diventano archi: suddivisi e riportati sul cerchio
    arc = []
    for a, b in zip(out, out[1:] + out[:1]):
        arc.append(a)
        if abs(a[2]) < 1e-9 and abs(b[2]) < 1e-9:
            for t in np.linspace(0, 1, 8)[1:-1]:
                p = a + (b - a) * t
                p[2] = 0
                arc.append(p / np.linalg.norm(p))
    return np.array(arc)


def path(pts: np.ndarray) -> str:
    xy = [(C + R * p[0], C + R * p[1]) for p in pts]
    return "M" + "L".join(f"{x:.1f} {y:.1f}" for x, y in xy) + "Z"


def colore(nero: bool, luce: float) -> str:
    if nero:
        g = 22 + 38 * luce
        return f"rgb({g:.0f},{g + 3:.0f},{g + 6:.0f})"
    g = 170 + 85 * luce
    return f"rgb({g:.0f},{g:.0f},{min(255, g + 2):.0f})"


def svg() -> str:
    v0 = vertici()
    ff = facce(v0)
    penta = next(f for f in ff if len(f) == 5)
    v = ruota(v0, v0[penta].mean(axis=0))
    pannelli = []
    for f in ff:
        poly = taglia_emisfero(sfera_poligono(v[f]))
        if not len(poly):
            continue
        n = v[f].mean(axis=0)
        n /= np.linalg.norm(n)
        luce = max(0.0, float(n @ LUCE)) ** 0.8
        pannelli.append((n[2], len(f) == 5, luce, path(poly)))
    pannelli.sort()                                    # prima i pannelli verso il bordo
    corpo = "".join(
        f'<path d="{d}" fill="{colore(nero, l)}"/>' for _, nero, l, d in pannelli)
    return (
        '<svg viewBox="0 0 100 100" aria-hidden="true"><defs>'
        '<radialGradient id="pl-volume" cx="38%" cy="34%" r="68%">'
        '<stop offset="0.55" stop-color="#000" stop-opacity="0"/>'
        '<stop offset="0.9" stop-color="#000" stop-opacity="0.28"/>'
        '<stop offset="1" stop-color="#000" stop-opacity="0.5"/></radialGradient>'
        '<radialGradient id="pl-riflesso" cx="34%" cy="28%" r="30%">'
        '<stop offset="0" stop-color="#fff" stop-opacity="0.6"/>'
        '<stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>'
        f'<g stroke="#5b625e" stroke-width="0.9" stroke-linejoin="round">{corpo}</g>'
        f'<circle cx="{C}" cy="{C}" r="{R}" fill="url(#pl-volume)"/>'
        f'<ellipse cx="36" cy="30" rx="17" ry="12" fill="url(#pl-riflesso)" transform="rotate(-30 36 30)"/>'
        f'<circle cx="{C}" cy="{C}" r="{R}" fill="none" stroke="#2b302d" stroke-width="1.4"/>'
        '</svg>')


if __name__ == "__main__":
    print(svg())
