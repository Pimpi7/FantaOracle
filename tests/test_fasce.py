"""Stima della fascia per chi SOS Fanta mette fra gli infortunati."""

import numpy as np
import pandas as pd

from fantaoracle.model.fasce import SCALA, stima_fasce

# Per ogni livello: (FVM, quotazione iniziale, punti attesi). I valori scendono
# con la fascia, come nel listone vero.
LIVELLI = {
    "TOP": (60, 24, 5.0),
    "FASCIA ALTA": (30, 14, 4.2),
    "LOW COST 1ª FASCIA": (12, 6, 3.4),
    "LEGHE NUMEROSE": (4, 2, 2.0),
}


def _rosa(ruolo="D", per_livello=6, **extra):
    righe, i = [], 0
    rng = np.random.default_rng(1)
    for fascia, (fvm, qi, pg) in LIVELLI.items():
        for _ in range(per_livello):
            i += 1
            righe.append({"fc_id": i, "ruolo": ruolo, "fascia": fascia,
                          "fvm": fvm * rng.uniform(0.9, 1.1), "qi": qi * rng.uniform(0.9, 1.1),
                          "pg": pg + rng.uniform(-0.2, 0.2)})
    righe += [{"fc_id": 1000 + n, "ruolo": ruolo, "fascia": "INFORTUNATI",
               "fvm": v, "qi": q, "pg": p} for n, (v, q, p) in enumerate(extra.get("inf", []))]
    return pd.DataFrame(righe)


def test_il_giocatore_prende_la_fascia_dei_piu_simili():
    df = _rosa(inf=[(31, 14, 4.1), (11, 6, 3.3), (60, 25, 5.1)])
    out = stima_fasce(df, "INFORTUNATI")
    assert out == {1000: "FASCIA ALTA", 1001: "LOW COST 1ª FASCIA", 1002: "TOP"}


def test_si_stima_solo_sulla_scala_di_qualita():
    # Un "jolly" identico al bersaglio non puo' diventare la sua fascia: i jolly
    # sono giudizi sulla convenienza, non livelli.
    df = _rosa(inf=[(31, 14, 4.1)])
    jolly = pd.DataFrame([{"fc_id": 5000 + n, "ruolo": "D", "fascia": "JOLLY 1ª FASCIA",
                           "fvm": 31, "qi": 14, "pg": 4.1} for n in range(10)])
    out = stima_fasce(pd.concat([df, jolly], ignore_index=True), "INFORTUNATI")
    assert out[1000] == "FASCIA ALTA"
    assert set(out.values()) <= set(SCALA)


def test_il_confronto_resta_dentro_il_ruolo():
    difensori = _rosa("D", inf=[(31, 14, 4.1)])
    portieri = _rosa("P")
    portieri["fc_id"] += 10_000
    portieri["fvm"] *= 5      # stessi livelli ma su un'altra scala di prezzo
    out = stima_fasce(pd.concat([difensori, portieri], ignore_index=True), "INFORTUNATI")
    assert out == {1000: "FASCIA ALTA"}


def test_senza_abbastanza_confronti_non_si_stima():
    df = _rosa(per_livello=1, inf=[(31, 14, 4.1)])      # 4 riferimenti soltanto
    assert stima_fasce(df, "INFORTUNATI") == {}


def test_dati_mancanti_non_rompono_nulla():
    df = _rosa(inf=[(31, 14, 4.1), (31, 14, 4.1)])
    df.loc[df["fc_id"] == 1001, "qi"] = np.nan
    out = stima_fasce(df, "INFORTUNATI")
    assert list(out) == [1000]
