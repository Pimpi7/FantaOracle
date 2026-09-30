"""Ingestion da Understat tramite la sua API JSON.

Da quando FBref ha perso i dati avanzati (febbraio 2026), Understat e' la fonte
gratuita di xG e xA per la Serie A. La pagina del campionato non incorpora piu' i
dati nell'HTML: li carica da `/getLeagueData/<lega>/<anno>`, che restituisce

  - players: aggregati stagionali per giocatore (minuti, xG, npxG, xA, tiri...)
  - teams:   storico partita per partita di ogni squadra (xG fatti e subiti)
  - dates:   calendario completo, partite giocate e da giocare

L'anno e' quello di inizio stagione: 2025 = 2025/26.

Nota utile per i rigori: Understat assegna circa 0,76 xG a ogni rigore, quindi
(xG - npxG) / 0,76 stima i rigori calciati da un giocatore senza bisogno di
dati sui singoli tiri.
"""

from __future__ import annotations

import json

import pandas as pd

from ..store import write_snapshot
from .http import get

BASE = "https://understat.com"
ANNO_CORRENTE = 2026
XG_RIGORE = 0.76


def scarica_lega(anno: int, lega: str = "Serie_A") -> dict:
    ttl = 12 if anno == ANNO_CORRENTE else None
    raw = get(f"{BASE}/getLeagueData/{lega}/{anno}", ttl_ore=ttl,
              headers={"X-Requested-With": "XMLHttpRequest"})
    return json.loads(raw)


def _giocatori(d: dict, anno: int) -> pd.DataFrame:
    df = pd.DataFrame(d["players"])
    num = ["games", "time", "goals", "xG", "assists", "xA", "shots", "key_passes",
           "yellow_cards", "red_cards", "npg", "npxG", "xGChain", "xGBuildup"]
    for c in num:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df["anno"] = anno
    df["rigori_stimati"] = ((df["xG"] - df["npxG"]) / XG_RIGORE).round(1)
    df["gol_rigore"] = df["goals"] - df["npg"]
    return df.rename(columns={"id": "us_id"})


def _partite_squadre(d: dict, anno: int) -> pd.DataFrame:
    righe = []
    for t in d["teams"].values():
        for h in t["history"]:
            righe.append({
                "anno": anno, "us_team_id": t["id"], "squadra": t["title"],
                "casa": h["h_a"] == "h", "data": h["date"],
                "xg": float(h["xG"]), "xga": float(h["xGA"]),
                "npxg": float(h["npxG"]), "npxga": float(h["npxGA"]),
                "gol": int(h["scored"]), "subiti": int(h["missed"]),
            })
    df = pd.DataFrame(righe)
    df["data"] = pd.to_datetime(df["data"])
    return df


def _calendario(d: dict, anno: int) -> pd.DataFrame:
    righe = []
    for m in d["dates"]:
        righe.append({
            "anno": anno, "us_match_id": m["id"], "giocata": bool(m["isResult"]),
            "data": m["datetime"], "casa": m["h"]["title"],
            "trasferta": m["a"]["title"],
            "gol_casa": m["goals"]["h"], "gol_trasferta": m["goals"]["a"],
            "xg_casa": m["xG"]["h"], "xg_trasferta": m["xG"]["a"],
        })
    df = pd.DataFrame(righe)
    df["data"] = pd.to_datetime(df["data"])
    for c in ["gol_casa", "gol_trasferta", "xg_casa", "xg_trasferta"]:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    return df


def ingest(anni: list[int] | None = None) -> dict[str, pd.DataFrame]:
    anni = anni or [2023, 2024, 2025, 2026]
    g, p, c = [], [], []
    for a in anni:
        d = scarica_lega(a)
        g.append(_giocatori(d, a))
        p.append(_partite_squadre(d, a))
        c.append(_calendario(d, a))

    out = {
        "giocatori": pd.concat(g, ignore_index=True),
        "partite_squadre": pd.concat(p, ignore_index=True),
        "calendario": pd.concat(c, ignore_index=True),
    }
    for nome, df in out.items():
        write_snapshot(df, "understat", nome, overwrite=True, meta={"anni": anni})
        print(f"  understat/{nome}: {len(df)} righe")
    return out
