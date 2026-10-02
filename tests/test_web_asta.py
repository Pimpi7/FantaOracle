"""Il supporto all'asta del tool web deve reggere quando l'asta non va come il piano.

Il test vero e' in tests/web/asta_regressione.js: gioca aste intere con il codice del tool
(pagando piu' del previsto, con il budget per ruolo manuale attivo) e controlla che i
suggerimenti non spariscano mai e che i crediti per ruolo seguano l'asta. Serve Node;
dove non c'e' il test si salta.
"""
import shutil
import subprocess
from pathlib import Path

import pytest

RADICE = Path(__file__).resolve().parents[1]


@pytest.mark.skipif(shutil.which("node") is None, reason="serve Node per eseguire i moduli del tool web")
def test_asta_fuori_piano_non_resta_senza_suggerimenti():
    esito = subprocess.run(
        ["node", str(RADICE / "tests" / "web" / "asta_regressione.js")],
        capture_output=True, text=True, timeout=600,
    )
    assert esito.returncode == 0, esito.stdout + esito.stderr
