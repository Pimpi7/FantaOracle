"""Stima della fascia di SOS Fanta per chi la guida non colloca.

La guida mette alcuni giocatori fra gli "Infortunati": e' uno stato, non un
livello, e non dice quanto valgono da sani. Per mostrarli accanto agli altri si
stima la fascia che avrebbero, confrontandoli con i giocatori dello stesso
ruolo che SOS Fanta ha invece classificato.

Il confronto e' un k-nearest-neighbors su tre numeri:

  - il FVM del listone e la quotazione iniziale (entrambi in scala logaritmica):
    le fasce di SOS Fanta seguono soprattutto il prezzo, e la quotazione di
    inizio stagione non risente di un infortunio arrivato dopo;
  - i punti attesi a giornata del modello: separano chi rende da chi no a
    parita' di prezzo.

Si stima solo sulla scala di qualita' (da Super top a Leghe numerose). Le altre
categorie della guida (jolly, scommesse, possibili sorprese, a rischio, da
evitare) sono giudizi su rischio e convenienza e non si inferiscono.

Quanto e' affidabile: provando a nascondere la fascia a ciascun giocatore gia'
classificato e a ricostruirla (leave-one-out, 253 giocatori), la fascia esatta
esce nel 39% dei casi, entro un gradino nell'81%, con un errore medio di 0,86
gradini; indovinare sempre la fascia mediana del ruolo sbaglia in media di 2,2.
Con solo FVM e punti attesi, o aggiungendo la quotazione attuale, i numeri sono
gli stessi entro il rumore. E' una stima, e il tool la segnala come tale.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

# Dalla fascia piu' alta alla piu' bassa.
SCALA = [
    "SUPER TOP", "TOP", "SEMITOP", "SOTTO AI SEMITOP", "FASCIA ALTA", "FASCIA MEDIA",
    "SOPRA AI LOW COST", "LOW COST 1ª FASCIA", "LOW COST 2ª FASCIA", "LEGHE NUMEROSE",
]
K = 7                 # vicini consultati
MIN_RIFERIMENTI = 5   # sotto questa soglia il ruolo non ha abbastanza confronti
EPS = 0.15            # evita pesi enormi per un vicino quasi identico


def _caratteristiche(df: pd.DataFrame) -> np.ndarray:
    return np.column_stack([np.log1p(df["fvm"].astype(float)), np.log1p(df["qi"].astype(float)),
                            df["pg"].astype(float)])


def stima_fasce(df: pd.DataFrame, da_stimare: str, k: int = K) -> dict[int, str]:
    """Una fascia stimata per ogni giocatore la cui fascia e' `da_stimare`.

    `df` ha le colonne fc_id, ruolo, fascia (etichetta di SOS Fanta, vuota se la
    guida non lo cita), fvm, qi (quotazione iniziale) e pg. Restituisce
    {fc_id: fascia}; chi non ha dati sufficienti, o sta in un ruolo con pochi
    confronti, non compare.
    """
    posizione = {f: i for i, f in enumerate(SCALA)}
    ok = df["fvm"].notna() & df["qi"].notna() & df["pg"].notna()
    out: dict[int, str] = {}

    for ruolo, gruppo in df[ok].groupby("ruolo"):
        rif = gruppo[gruppo["fascia"].isin(posizione)]
        bersagli = gruppo[gruppo["fascia"] == da_stimare]
        if bersagli.empty or len(rif) < MIN_RIFERIMENTI:
            continue

        X = _caratteristiche(rif)
        media, scarto = X.mean(axis=0), X.std(axis=0) + 1e-9
        Z = (X - media) / scarto
        pos = rif["fascia"].map(posizione).to_numpy()
        n = min(k, len(rif))

        for fc_id, riga in zip(bersagli["fc_id"], _caratteristiche(bersagli)):
            dist = np.sqrt((((riga - media) / scarto - Z) ** 2).sum(axis=1))
            vicini = np.argsort(dist)[:n]
            pesi = 1.0 / (dist[vicini] + EPS)
            # Mediana pesata delle posizioni: la scala e' ordinale, la media di
            # "Top" e "Fascia media" non e' una fascia.
            ordine = np.argsort(pos[vicini])
            cumulato = np.cumsum(pesi[ordine])
            scelta = pos[vicini][ordine][np.searchsorted(cumulato, cumulato[-1] / 2)]
            out[int(fc_id)] = SCALA[int(scelta)]
    return out
