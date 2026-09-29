"""Store degli snapshot grezzi.

Regola unica e non negoziabile: **non si sovrascrive mai**. Ogni raccolta finisce
in una partizione datata. Il costo e' qualche decina di MB; il beneficio e' poter
rispondere, a dicembre, alla domanda "che cosa sapevamo il 12 ottobre?".

Da questo dipendono due cose che senza storico non si possono fare:
  - il backtest onesto (niente lookahead: si legge solo cio' che esisteva allora)
  - la pesatura empirica delle fonti di probabili formazioni

Layout:
    data/raw/<fonte>/<dataset>/asof=<YYYY-MM-DD>/part.parquet
"""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

import pandas as pd

from .paths import RAW


def _partition(fonte: str, dataset: str, asof: dt.date) -> Path:
    return RAW / fonte / dataset / f"asof={asof.isoformat()}"


def write_snapshot(
    df: pd.DataFrame,
    fonte: str,
    dataset: str,
    asof: dt.date | None = None,
    meta: dict | None = None,
    overwrite: bool = False,
) -> Path:
    """Scrive uno snapshot datato.

    Se la partizione di oggi esiste gia', non la tocca a meno di overwrite=True:
    rilanciare l'ingestion due volte nello stesso giorno non deve corrompere
    nulla ne' duplicare righe.
    """
    asof = asof or dt.date.today()
    part = _partition(fonte, dataset, asof)
    target = part / "part.parquet"

    if target.exists() and not overwrite:
        return target

    part.mkdir(parents=True, exist_ok=True)
    df.to_parquet(target, index=False)

    manifest = {
        "fonte": fonte,
        "dataset": dataset,
        "asof": asof.isoformat(),
        "scaricato_il": dt.datetime.now().isoformat(timespec="seconds"),
        "righe": int(len(df)),
        "colonne": list(df.columns),
        **(meta or {}),
    }
    (part / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    return target


def list_snapshots(fonte: str, dataset: str) -> list[dt.date]:
    base = RAW / fonte / dataset
    if not base.exists():
        return []
    dates = []
    for p in base.glob("asof=*"):
        try:
            dates.append(dt.date.fromisoformat(p.name.split("=", 1)[1]))
        except ValueError:
            continue
    return sorted(dates)


def read_snapshot(
    fonte: str, dataset: str, asof: dt.date | None = None
) -> pd.DataFrame:
    """Legge uno snapshot. Senza `asof` legge il piu' recente.

    Con `asof` legge il piu' recente **non successivo** a quella data: e' il
    comportamento che serve al backtest per non barare.
    """
    disponibili = list_snapshots(fonte, dataset)
    if not disponibili:
        raise FileNotFoundError(
            f"Nessuno snapshot per {fonte}/{dataset}. Lanciare prima l'ingestion."
        )

    if asof is None:
        scelto = disponibili[-1]
    else:
        validi = [d for d in disponibili if d <= asof]
        if not validi:
            raise FileNotFoundError(
                f"Nessuno snapshot di {fonte}/{dataset} al {asof} o prima. "
                f"Il piu' vecchio disponibile e' {disponibili[0]}."
            )
        scelto = validi[-1]

    df = pd.read_parquet(_partition(fonte, dataset, scelto) / "part.parquet")
    df.attrs["asof"] = scelto.isoformat()
    return df


def read_all_snapshots(fonte: str, dataset: str) -> pd.DataFrame:
    """Concatena tutti gli snapshot con una colonna `asof`.

    Serve alle serie temporali: probabili formazioni, quotazioni che si muovono,
    valori di mercato.
    """
    frames = []
    for d in list_snapshots(fonte, dataset):
        f = pd.read_parquet(_partition(fonte, dataset, d) / "part.parquet")
        f["asof"] = d
        frames.append(f)
    if not frames:
        raise FileNotFoundError(f"Nessuno snapshot per {fonte}/{dataset}.")
    return pd.concat(frames, ignore_index=True)
