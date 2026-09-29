"""Dai punti attesi ai crediti: valore, prezzo atteso, affare.

Due numeri diversi, da non confondere:

**Valore** — quanto vale un giocatore *per noi*. Si calcola con il VORP: i punti
in piu' rispetto al sostituto. Il punto delicato e' quale sostituto. Si comprano
24 portieri, ma ogni settimana ne giocano 8: misurare il valore rispetto al 25o
portiere gonfierebbe tutti i portieri, perche' dal 9o in poi fanno panchina.
Quindi il VORP ha due livelli:

  - pieno sopra la linea dei titolari (8 squadre x titolari tipici del ruolo:
    1 portiere, 4 difensori, 3,5 centrocampisti, 2,5 attaccanti)
  - ridotto al 25% fra la linea dei titolari e l'ultimo giocatore comprato:
    e' il valore di chi copre rotazioni, infortuni e squalifiche

I crediti discrezionali della lega (4.000 meno 1 per ciascuno dei 200 slot) si
dividono in proporzione al VORP.

**Prezzo atteso** — quanto costera' *nella nostra asta*. Parte dal FVM di
Fantacalcio.it, che e' costruito sui prezzi pagati davvero nelle aste, e viene
riscalato perche' i 200 giocatori che verranno comprati sommino ai 4.000 crediti
della lega. Prima del riscalamento si applica la maggiorazione tifo: cosi' i
crediti in piu' spesi su Roma e Lazio vengono tolti, in proporzione, agli altri.

**Affare** = valore - prezzo atteso.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from ..config import LeagueConfig


def quote_ruolo(cfg: LeagueConfig) -> dict[str, int]:
    n = cfg.get("formato.n_squadre")
    return {r: n * k for r, k in cfg.get("formato.slot").items()}


# Titolari tipici per ruolo in una formazione. Con il modificatore attivo la
# difesa a 4 e' la norma; 3,5 e 2,5 sono la media fra 4-3-3, 4-4-2 e 3-4-3.
TITOLARI = {"P": 1.0, "D": 4.0, "C": 3.5, "A": 2.5}
PESO_ROTAZIONE = 0.25


def _soglia(valori: pd.Series, n: float) -> float:
    ordinati = valori.sort_values(ascending=False).reset_index(drop=True)
    i = int(round(n))
    return float(ordinati.iloc[min(i, len(ordinati) - 1)])


def valore(proiezioni: pd.DataFrame, cfg: LeagueConfig,
           col: str = "punti_stagione") -> pd.DataFrame:
    df = proiezioni.copy()
    quote = quote_ruolo(cfg)
    n_sq = cfg.get("formato.n_squadre")
    df["linea_titolari"] = np.nan
    df["linea_rosa"] = np.nan
    for r, n in quote.items():
        m = df["ruolo"] == r
        df.loc[m, "linea_titolari"] = _soglia(df.loc[m, col], n_sq * TITOLARI[r])
        df.loc[m, "linea_rosa"] = _soglia(df.loc[m, col], n)
    sopra = (df[col] - df["linea_titolari"]).clip(lower=0)
    rotazione = (np.minimum(df[col], df["linea_titolari"]) - df["linea_rosa"]).clip(lower=0)
    df["vorp"] = sopra + PESO_ROTAZIONE * rotazione

    crediti = cfg.crediti_lega
    discrezionali = crediti - sum(quote.values()) * cfg.get("asta.prezzo_minimo")
    df["valore"] = cfg.get("asta.prezzo_minimo") + df["vorp"] / df["vorp"].sum() * discrezionali
    return df


def prezzo_atteso(df: pd.DataFrame, cfg: LeagueConfig) -> pd.DataFrame:
    """Prezzo atteso nella nostra asta, da FVM, tifo e budget della lega."""
    df = df.copy()
    quote = quote_ruolo(cfg)

    # FVM mancante (nuovi arrivi): stima dalla quotazione attuale, per ruolo.
    base = df["fvm1000"].astype(float)
    for r in quote:
        m = (df["ruolo"] == r) & base.notna() & (base > 0) & df["qa"].notna()
        if m.sum() > 5:
            coef = np.polyfit(np.log(df.loc[m, "qa"]), np.log(base[m]), 1)
            buco = (df["ruolo"] == r) & (base.isna() | (base <= 0)) & df["qa"].notna()
            base[buco] = np.exp(np.polyval(coef, np.log(df.loc[buco, "qa"])))
    base = base.fillna(1.0)

    tifo = cfg.get("mercato.tifo", default={}) or {}
    df["fattore_tifo"] = df["squadra"].map(lambda s: 1.0 + tifo.get(s, 0.0))
    grezzo = base * df["fattore_tifo"]

    # Il mercato compra per ruolo: i primi N per FVM di ogni ruolo sono quelli
    # che si prenderanno i crediti. Si cerca la scala che fa sommare a 4.000.
    comprati = pd.Series(False, index=df.index)
    for r, n in quote.items():
        idx = grezzo[df["ruolo"] == r].sort_values(ascending=False).index[:n]
        comprati[idx] = True

    minimo = cfg.get("asta.prezzo_minimo")
    target = cfg.crediti_lega
    lo, hi = 1e-4, 10.0
    for _ in range(60):
        s = (lo + hi) / 2
        tot = np.maximum(minimo, grezzo[comprati] * s).sum()
        lo, hi = (s, hi) if tot < target else (lo, s)
    scala = (lo + hi) / 2

    df["prezzo_atteso"] = np.maximum(minimo, np.round(grezzo * scala, 0))
    df["nel_mercato"] = comprati
    df["affare"] = df["valore"] - df["prezzo_atteso"]
    df.attrs["scala_fvm"] = scala
    return df
