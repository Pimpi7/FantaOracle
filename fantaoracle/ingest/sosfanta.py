"""Ingestion delle fasce della Guida all'Asta di SOS Fanta.

La guida e' un articolo a schede, una per ruolo (portieri, difensori,
centrocampisti, attaccanti), piu' una quinta con le formazioni di Serie A che
qui non serve. In ogni scheda i giocatori sono divisi in fasce, scritte come
righe di questo tipo:

    <p><strong>SUPER TOP</strong> - Malen, Martinez L.</p>

I nomi usano la stessa grafia del listone di Fantacalcio.it ("Martinez L.",
"Sanchez Ro."), quindi l'abbinamento ai giocatori e' quasi sempre esatto. Le
fasce non sono le stesse in ogni ruolo (i portieri non hanno "Sotto ai semitop")
e vengono aggiornate dalla redazione: per questo si salva ogni volta uno
snapshot datato, come per le altre fonti.

Le fasce sono una classificazione editoriale, non un dato statistico: servono a
mostrare come la pensa SOS Fanta accanto alle nostre stime, non entrano nel
modello.
"""

from __future__ import annotations

import re

import pandas as pd
from bs4 import BeautifulSoup

from ..store import write_snapshot
from .http import get

# L'anno e' parte dell'indirizzo: a ogni nuova stagione va aggiornato.
BASE = ("https://www.sosfanta.com/guida-asta-fantacalcio/"
        "guida-asta-fantacalcio-2026-2027-tutti-consigli-fasce-chi-prendere/")
PAGINE = ["", "2/", "3/", "4/"]      # la 5a e' "Le squadre di serie A"
RUOLI = {"PORTIERI": "P", "DIFENSORI": "D", "CENTROCAMPISTI": "C", "ATTACCANTI": "A"}

# Ordine delle fasce come le presenta SOS Fanta, dalla migliore alla peggiore
# (e poi le categorie "di servizio": infortunati, a rischio, da evitare).
# Un'etichetta nuova non rompe nulla: si accoda in fondo, nell'ordine di arrivo.
ORDINE_FASCE = [
    "SUPER TOP", "TOP", "SEMITOP", "SOTTO AI SEMITOP", "FASCIA ALTA",
    "JOLLY 1ª FASCIA", "POSSIBILI SORPRESE", "FASCIA MEDIA", "INFORTUNATI",
    "SCOMMESSE", "SOPRA AI LOW COST", "JOLLY 2ª FASCIA", "LOW COST 1ª FASCIA",
    "LOW COST 2ª FASCIA", "LEGHE NUMEROSE", "JOLLY 3ª FASCIA", "JOLLY 4ª FASCIA",
    "A RISCHIO", "DA EVITARE",
]

_TRATTINI = "-–—"
_NOTE = re.compile(r"\s*[\(\[].*?[\)\]]")      # "(rigorista)" e simili dopo un nome
_SPAZI = re.compile(r"\s+")


def ordina_fasce(etichette) -> list[str]:
    """Le etichette presenti, nell'ordine di SOS Fanta; le sconosciute in fondo."""
    uniche = list(dict.fromkeys(etichette))
    noti = [e for e in ORDINE_FASCE if e in uniche]
    return noti + [e for e in uniche if e not in ORDINE_FASCE]


def _etichetta(testo: str) -> str:
    return _SPAZI.sub(" ", testo).strip().upper()


def parse_pagina(html: bytes | str) -> pd.DataFrame:
    """Una scheda della guida -> una riga per giocatore.

    Colonne: ruolo, fascia (etichetta in maiuscolo), ordine (posizione della
    fascia nella scheda), posizione (posizione del nome dentro la fascia: la
    redazione li scrive dal piu' al meno consigliato), nome.
    """
    soup = BeautifulSoup(html, "lxml")
    titolo = soup.select_one("h2.article-page-subtitle")
    ruolo = RUOLI.get(_etichetta(titolo.get_text())) if titolo else None
    if ruolo is None:
        raise ValueError("scheda senza un ruolo riconoscibile "
                         f"({titolo.get_text().strip() if titolo else 'titolo assente'})")

    righe, ordine = [], 0
    for p in soup.find_all("p"):
        forte = p.find("strong")
        if forte is None:
            continue
        fascia = _etichetta(forte.get_text())
        testo = _SPAZI.sub(" ", p.get_text(" ")).strip()
        # Una riga di fascia comincia con l'etichetta in maiuscolo e prosegue
        # con "- nomi". Il resto dell'articolo (descrizioni, link) no.
        if not fascia or fascia != fascia.upper() or not any(c.isalpha() for c in fascia):
            continue
        if not testo.upper().startswith(fascia):
            continue
        resto = testo[len(fascia):].lstrip()
        if not resto or resto[0] not in _TRATTINI:
            continue
        nomi = [_NOTE.sub("", n).strip(" *") for n in resto.lstrip(_TRATTINI + " ").split(",")]
        nomi = [n for n in nomi if n]
        if not nomi:
            continue
        for pos, nome in enumerate(nomi, start=1):
            righe.append({"ruolo": ruolo, "fascia": fascia, "ordine": ordine,
                          "posizione": pos, "nome": nome})
        ordine += 1

    return pd.DataFrame(righe, columns=["ruolo", "fascia", "ordine", "posizione", "nome"])


def scarica_fasce() -> pd.DataFrame:
    frames = []
    for pagina in PAGINE:
        df = parse_pagina(get(BASE + pagina, ttl_ore=12))
        # Meno di cinque fasce in una scheda vuol dire che la pagina e' cambiata
        # e il parser non la legge piu': meglio fermarsi che salvare mezza guida.
        if df["fascia"].nunique() < 5:
            raise RuntimeError(f"{BASE + pagina}: solo {df['fascia'].nunique()} fasce "
                               "riconosciute, la struttura della pagina e' cambiata?")
        frames.append(df)
    out = pd.concat(frames, ignore_index=True)
    if out["ruolo"].nunique() != 4:
        raise RuntimeError(f"ruoli trovati: {sorted(out['ruolo'].unique())}, attesi 4")
    return out


def ingest() -> pd.DataFrame:
    df = scarica_fasce()
    write_snapshot(df, "sosfanta", "fasce", overwrite=True)
    per_ruolo = df.groupby("ruolo")["nome"].count().to_dict()
    print(f"  fasce: {len(df)} giocatori in {df['fascia'].nunique()} fasce {per_ruolo}")
    return df
