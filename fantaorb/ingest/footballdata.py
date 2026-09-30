"""Ingestion da football-data.co.uk (Serie A, file I1.csv).

Poche centinaia di kB per stagione che contengono risultati e quote dei
bookmaker. Le quote sono la migliore stima gratuita della forza di una squadra
partita per partita, e da li' arrivano i gol attesi che alimentano la
simulazione dei clean sheet.

Qui dentro si fa solo raccolta e rinomina delle colonne. La conversione in
probabilita' e i gol attesi stanno nel motore (Fase 4): l'ingestion non deve
contenere modello, altrimenti cambiare modello significa riscaricare i dati.
"""

from __future__ import annotations

import io
import time

import pandas as pd
import requests

from ..store import write_snapshot

BASE_URL = "https://football-data.co.uk/mmz4281/{stagione}/I1.csv"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36"

# Stagioni nel formato del sito: 2526 = 2025/26.
STAGIONI_DEFAULT = ["2324", "2425", "2526", "2627"]

RINOMINA = {
    "Date": "data",
    "Time": "ora",
    "HomeTeam": "casa",
    "AwayTeam": "trasferta",
    "FTHG": "gol_casa",
    "FTAG": "gol_trasferta",
    "FTR": "esito",
    "HS": "tiri_casa",
    "AS": "tiri_trasferta",
    "HST": "tiri_porta_casa",
    "AST": "tiri_porta_trasferta",
    "HY": "gialli_casa",
    "AY": "gialli_trasferta",
    "HR": "rossi_casa",
    "AR": "rossi_trasferta",
    # Quote medie di chiusura: piu' stabili di quelle di un singolo bookmaker.
    "AvgCH": "quota_1",
    "AvgCD": "quota_x",
    "AvgCA": "quota_2",
    "AvgC>2.5": "quota_over25",
    "AvgC<2.5": "quota_under25",
    # Fallback sulle quote di apertura quando le closing mancano.
    "AvgH": "quota_1_open",
    "AvgD": "quota_x_open",
    "AvgA": "quota_2_open",
}


def scarica_stagione(stagione: str, tentativi: int = 4, pausa: float = 5.0) -> pd.DataFrame:
    """Scarica una stagione con backoff.

    Il sito risponde 503 con `retry-after` quando e' sotto carico: non e' un
    blocco, e riprovare funziona. Meglio esplicitarlo che lasciare che il job
    fallisca in silenzio la domenica mattina.
    """
    url = BASE_URL.format(stagione=stagione)
    ultimo_errore = None

    for tentativo in range(1, tentativi + 1):
        try:
            r = requests.get(url, headers={"User-Agent": UA}, timeout=45)
            if r.status_code == 200:
                df = pd.read_csv(io.BytesIO(r.content), encoding="latin-1")
                return _normalizza(df, stagione)
            ultimo_errore = f"HTTP {r.status_code}"
            attesa = float(r.headers.get("retry-after", pausa * tentativo))
        except requests.RequestException as e:
            ultimo_errore = str(e)
            attesa = pausa * tentativo

        if tentativo < tentativi:
            time.sleep(min(attesa, 60))

    raise RuntimeError(
        f"football-data non raggiungibile per la stagione {stagione} "
        f"dopo {tentativi} tentativi (ultimo errore: {ultimo_errore}). "
        f"Il sito va spesso in 503 temporaneo: riprovare fra qualche minuto."
    )


def _normalizza(df: pd.DataFrame, stagione: str) -> pd.DataFrame:
    df = df.dropna(how="all", axis=0).dropna(how="all", axis=1)
    presenti = {k: v for k, v in RINOMINA.items() if k in df.columns}
    out = df[list(presenti)].rename(columns=presenti).copy()

    out["stagione"] = f"20{stagione[:2]}-{stagione[2:]}"
    out["data"] = pd.to_datetime(out["data"], dayfirst=True, errors="coerce")

    # Le closing odds mancano nelle partite non ancora giocate: si ripiega
    # sulle quote di apertura, marcando la sostituzione.
    for chiusura, apertura in [("quota_1", "quota_1_open"),
                               ("quota_x", "quota_x_open"),
                               ("quota_2", "quota_2_open")]:
        if chiusura in out.columns and apertura in out.columns:
            out[chiusura] = out[chiusura].fillna(out[apertura])

    out = out.drop(columns=["quota_1_open", "quota_x_open", "quota_2_open"],
                   errors="ignore")
    return out.dropna(subset=["casa", "trasferta"]).reset_index(drop=True)


def ingest(stagioni: list[str] | None = None) -> pd.DataFrame:
    stagioni = stagioni or STAGIONI_DEFAULT
    frames, falliti = [], []

    for s in stagioni:
        try:
            frames.append(scarica_stagione(s))
        except RuntimeError as e:
            falliti.append(f"{s}: {e}")

    if not frames:
        raise RuntimeError("Nessuna stagione scaricata.\n" + "\n".join(falliti))

    df = pd.concat(frames, ignore_index=True)
    write_snapshot(df, fonte="footballdata", dataset="serie_a",
                   meta={"stagioni": stagioni, "falliti": falliti})

    if falliti:
        print("  attenzione, stagioni non scaricate:")
        for f in falliti:
            print(f"    {f}")

    return df
