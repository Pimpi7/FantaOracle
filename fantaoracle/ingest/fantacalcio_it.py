"""Voti per giornata e listone da Fantacalcio.it (pagine pubbliche, senza login).

Voti: una pagina per giornata, `/voti-fantacalcio-serie-a/<stagione>/<giornata>`,
con una tabella per squadra. Ogni giocatore ha tre coppie voto/fantavoto, una per
redazione, nell'ordine: Fantacalcio, Statistico, Italia. Prendiamo solo la prima,
perche' e' la fonte voti della lega: i voti di redazioni diverse non sono
confrontabili.

Codifiche della pagina:
  - voto 55: senza voto (entrato troppo tardi per essere giudicato)
  - classe `yellow-card` / `red-card` sul voto: cartellino
  - icona "Subentrato" / "Sostituito" accanto al nome: minuti parziali
  - l'ID nell'URL del giocatore e' stabile fra stagioni: e' la nostra chiave

Listone: `/quotazioni-fantacalcio`, con quotazione iniziale, attuale e FVM (su
scala 1000 crediti) per Classic e Mantra.
"""

from __future__ import annotations

import datetime as dt
import re
from concurrent.futures import ThreadPoolExecutor

import pandas as pd
from bs4 import BeautifulSoup

from ..store import write_snapshot
from .http import get

BASE = "https://www.fantacalcio.it"
STAGIONE_CORRENTE = "2026-27"
VOTO_SV = 55.0

_ID = re.compile(r"/serie-a/squadre/([^/]+)/([^/]+)/(\d+)")


def _num(v: str | None) -> float | None:
    if v is None:
        return None
    v = v.strip().replace(",", ".")
    try:
        return float(v)
    except ValueError:
        return None


def _parse_giocatore_link(a) -> dict:
    m = _ID.search(a.get("href", ""))
    return {
        "fc_id": int(m.group(3)) if m else None,
        "squadra_slug": m.group(1) if m else None,
        "slug": m.group(2) if m else None,
        "nome": a.get_text(strip=True),
    }


# --- voti --------------------------------------------------------------------

BONUS_TITOLI = {
    "Gol segnati": "gol",
    "Gol subiti": "gol_subiti",
    "Autoreti": "autogol",
    "Rigori segnati": "rigori_segnati",
    "Rigori sbagliati": "rigori_sbagliati",
    "Rigori parati": "rigori_parati",
    "Assist": "assist",
}


def parse_voti(html: bytes | str, stagione: str, giornata: int) -> pd.DataFrame:
    s = BeautifulSoup(html, "lxml")
    righe = []

    for tab in s.select("table"):
        stemma = tab.select_one('thead img[alt^="Stemma"]')
        if stemma is None:
            continue                                  # tabella classifica
        squadra = stemma["alt"].replace("Stemma", "").strip()

        for tr in tab.select("tbody tr"):
            a = tr.select_one("a.player-name")
            if a is None:
                continue
            r = _parse_giocatore_link(a)
            ruolo = tr.select_one("span.role")
            r["ruolo"] = (ruolo.get("data-value") or "").upper() if ruolo else None
            icone = {i.get("title") for i in tr.select("img.player-icon")}
            r["subentrato"] = "Subentrato" in icone
            r["sostituito"] = "Sostituito" in icone

            pill = tr.select_one("div.pill")           # prima = redazione Fantacalcio
            voto = pill.select_one("span.player-grade") if pill else None
            fv = pill.select_one("span.player-fanta-grade") if pill else None
            v = _num(voto.get("data-value")) if voto else None
            classi = set(voto.get("class", [])) if voto else set()
            r["sv"] = v is None or v >= VOTO_SV
            r["voto"] = None if r["sv"] else v
            r["fantavoto"] = None if r["sv"] else _num(fv.get("data-value") if fv else None)
            r["ammonizione"] = int("yellow-card" in classi)
            r["espulsione"] = int("red-card" in classi)

            for b in tr.select("span.player-bonus"):
                chiave = BONUS_TITOLI.get(b.get("title", ""))
                if chiave:
                    r[chiave] = int(_num(b.get("data-value")) or 0)

            r.update({"stagione": stagione, "giornata": giornata,
                      "squadra": squadra, "fonte_voti": "fantacalcio_it"})
            righe.append(r)

    df = pd.DataFrame(righe)
    for c in BONUS_TITOLI.values():
        if c not in df.columns:
            df[c] = 0
    return df


def scarica_giornata(stagione: str, giornata: int) -> pd.DataFrame:
    url = f"{BASE}/voti-fantacalcio-serie-a/{stagione}/{giornata}"
    ttl = 12 if stagione == STAGIONE_CORRENTE else None
    return parse_voti(get(url, ttl_ore=ttl), stagione, giornata)


def ingest_voti(stagioni: dict[str, int], thread: int = 4) -> pd.DataFrame:
    """`stagioni`: {"2025-26": 38, "2026-27": 5} = ultima giornata da scaricare."""
    lavori = [(s, g) for s, n in stagioni.items() for g in range(1, n + 1)]
    frames, errori = [], []

    def job(sg):
        try:
            return scarica_giornata(*sg)
        except Exception as e:                        # noqa: BLE001
            errori.append(f"{sg}: {e}")
            return None

    with ThreadPoolExecutor(thread) as ex:
        for f in ex.map(job, lavori):
            if f is not None and len(f):
                frames.append(f)

    df = pd.concat(frames, ignore_index=True)
    write_snapshot(df, "fantacalcio_it", "voti", overwrite=True,
                   meta={"stagioni": stagioni, "errori": errori})
    print(f"  voti: {len(df)} righe, {df.groupby(['stagione','giornata']).ngroups} "
          f"giornate, errori {len(errori)}")
    for e in errori[:5]:
        print("   ", e)
    return df


# --- listone -----------------------------------------------------------------

def parse_listone(html: bytes | str) -> pd.DataFrame:
    s = BeautifulSoup(html, "lxml")
    righe = []
    for tr in s.select("tr.player-row"):
        a = tr.select_one("a.player-name")
        if a is None:
            continue
        r = _parse_giocatore_link(a)
        r["ruolo"] = (tr.get("data-filter-role-classic") or "").upper()
        r["ruolo_mantra"] = tr.get("data-filter-role-mantra")
        r["pct_giocate"] = _num(tr.get("data-filter-playeds"))
        cella = lambda k: tr.select_one(f'td[data-col-key="{k}"]')   # noqa: E731
        r["squadra_sigla"] = cella("sq").get_text(strip=True) if cella("sq") else None
        r["qi"] = _num(cella("c_qi").get_text()) if cella("c_qi") else None
        r["qa"] = _num(cella("c_qa").get_text()) if cella("c_qa") else None
        r["fvm1000"] = _num(cella("c_fvm").get_text()) if cella("c_fvm") else None
        righe.append(r)
    return pd.DataFrame(righe)


def ingest_listone() -> pd.DataFrame:
    df = parse_listone(get(f"{BASE}/quotazioni-fantacalcio", ttl_ore=6))
    write_snapshot(df, "fantacalcio_it", "listone", asof=dt.date.today(),
                   overwrite=True)
    print(f"  listone: {len(df)} giocatori {df['ruolo'].value_counts().to_dict()}")
    return df
