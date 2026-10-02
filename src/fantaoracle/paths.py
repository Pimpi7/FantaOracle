"""Percorsi del progetto. Tutto risolto rispetto alla radice del repo."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONFIG_DIR = ROOT / "config"
DATA_DIR = ROOT / "data"

RAW = DATA_DIR / "raw"      # snapshot grezzi, append-only, mai sovrascritti
REF = DATA_DIR / "ref"      # tabelle di riferimento curate a mano (id, alias)
PROC = DATA_DIR / "proc"    # dataset puliti e uniti, rigenerabili
PROJ = DATA_DIR / "proj"    # output del motore: simulazioni e proiezioni

for _d in (RAW, REF, PROC, PROJ):
    _d.mkdir(parents=True, exist_ok=True)
