"""Client HTTP condiviso: user agent da browser, retry con backoff, cache su disco.

La cache serve a due cose. La prima e' non martellare i siti: rilanciare il
parsing dopo una correzione non deve riscaricare 120 pagine. La seconda e' la
riproducibilita': la pagina grezza scaricata oggi resta, e se domani il parser
cambia si puo' riparsare lo stesso contenuto.

Le pagine di stagioni concluse non cambiano piu' e vengono tenute per sempre.
Quelle della stagione in corso scadono dopo `ttl_ore`.
"""

from __future__ import annotations

import gzip
import hashlib
import time
from pathlib import Path

import requests

from ..paths import DATA_DIR

CACHE = DATA_DIR / "cache"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0 Safari/537.36")

_session = requests.Session()
_session.headers.update({"User-Agent": UA, "Accept-Language": "it-IT,it;q=0.9"})


def _percorso(url: str) -> Path:
    h = hashlib.sha1(url.encode()).hexdigest()[:20]
    return CACHE / h[:2] / f"{h}.gz"


def get(url: str, ttl_ore: float | None = None, tentativi: int = 4,
        headers: dict | None = None) -> bytes:
    """Scarica `url`, usando la cache se valida.

    ttl_ore=None: la cache non scade mai (pagine di stagioni chiuse).
    """
    fp = _percorso(url)
    if fp.exists():
        eta_ore = (time.time() - fp.stat().st_mtime) / 3600
        if ttl_ore is None or eta_ore < ttl_ore:
            return gzip.decompress(fp.read_bytes())

    ultimo = None
    for t in range(1, tentativi + 1):
        try:
            r = _session.get(url, timeout=40, headers=headers or {})
            if r.status_code == 200:
                fp.parent.mkdir(parents=True, exist_ok=True)
                fp.write_bytes(gzip.compress(r.content))
                return r.content
            ultimo = f"HTTP {r.status_code}"
            if r.status_code in (401, 403, 404):
                break                      # riprovare non cambia nulla
            attesa = float(r.headers.get("retry-after", 3 * t))
        except requests.RequestException as e:
            ultimo = str(e)
            attesa = 3 * t
        if t < tentativi:
            time.sleep(min(attesa, 30))

    raise RuntimeError(f"{url}: {ultimo}")
