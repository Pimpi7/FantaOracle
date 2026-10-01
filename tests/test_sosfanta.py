"""Fasce della guida all'asta di SOS Fanta: lettura della pagina e abbinamento."""

import pandas as pd
import pytest

from fantaoracle.db import abbina_fasce
from fantaoracle.ingest.sosfanta import ORDINE_FASCE, ordina_fasce, parse_pagina

PAGINA = """
<html><body>
<h2 class="my-4 article-page-subtitle">
    ATTACCANTI
</h2>
<p><strong>⚽️ <a href="https://example.org">TUTTI I RIGORISTI</a></strong></p>
<p>
<strong>SUPER TOP</strong> - Malen, Martinez L.
</p>
<p>Donyell Malen ha stravolto l'ultimo fantacalcio, in sole 18 partite 14 gol.</p>
<p><strong>Lautaro</strong> e' il capocannoniere, e' <strong>molto</strong> forte.</p>
<p>
<strong>JOLLY 1ª FASCIA</strong> - Soulè, Castro S. (rigorista), Boga*
</p>
<p><strong>DA EVITARE</strong> – Milik, Lisman</p>
<p><strong>VUOTA</strong> - </p>
</body></html>
"""


def test_parse_legge_solo_le_righe_di_fascia():
    df = parse_pagina(PAGINA)
    assert set(df["ruolo"]) == {"A"}
    assert list(df["fascia"].unique()) == ["SUPER TOP", "JOLLY 1ª FASCIA", "DA EVITARE"]
    assert list(df["ordine"].unique()) == [0, 1, 2]


def test_parse_nomi_e_posizioni():
    df = parse_pagina(PAGINA)
    jolly = df[df["fascia"] == "JOLLY 1ª FASCIA"]
    # note fra parentesi e asterischi non fanno parte del nome
    assert list(jolly["nome"]) == ["Soulè", "Castro S.", "Boga"]
    assert list(jolly["posizione"]) == [1, 2, 3]
    # il trattino lungo vale come il trattino
    assert list(df[df["fascia"] == "DA EVITARE"]["nome"]) == ["Milik", "Lisman"]


def test_parse_rifiuta_una_scheda_senza_ruolo():
    with pytest.raises(ValueError):
        parse_pagina("<html><body><p><strong>TOP</strong> - Rossi</p></body></html>")


def test_ordine_delle_fasce():
    assert ordina_fasce(["DA EVITARE", "TOP", "SUPER TOP", "TOP"]) == ["SUPER TOP", "TOP", "DA EVITARE"]
    # un'etichetta che SOS Fanta introduce domani non rompe nulla: va in fondo
    assert ordina_fasce(["NUOVA", "TOP"]) == ["TOP", "NUOVA"]
    assert ordina_fasce(ORDINE_FASCE) == ORDINE_FASCE


def test_abbinamento_dentro_il_ruolo():
    cand = pd.DataFrame({
        "fc_id": [1, 2, 3, 4],
        "nome": ["Thuram", "Thuram K.", "Martinez L.", "Martinez Jo."],
        "squadra": ["inter", "juventus", "inter", "inter"],
        "ruolo": ["A", "C", "A", "P"],
    })
    fasce = pd.DataFrame({
        "ruolo": ["A", "A", "C", "P"],
        "fascia": ["TOP", "SUPER TOP", "A RISCHIO", "TOP"],
        "ordine": [1, 0, 2, 1],
        "posizione": [1, 1, 1, 1],
        "nome": ["Thuram", "Martinez L.", "Thuram K.", "Martinez Jo."],
    })
    out, rep = abbina_fasce(fasce, cand)
    assert dict(zip(out["fc_id"], out["fascia"])) == {
        1: "TOP", 3: "SUPER TOP", 2: "A RISCHIO", 4: "TOP"}
    assert rep["abbinati"] == 4 and not rep["non_risolti"] and not rep["ambigui"]


def test_nome_assente_dal_listone_resta_non_risolto():
    cand = pd.DataFrame({"fc_id": [1], "nome": ["Rossi M."], "squadra": ["roma"], "ruolo": ["C"]})
    fasce = pd.DataFrame({"ruolo": ["C", "C"], "fascia": ["TOP", "DA EVITARE"], "ordine": [0, 1],
                          "posizione": [1, 1], "nome": ["Rossi M.", "Zzyzx Q."]})
    out, rep = abbina_fasce(fasce, cand)
    assert list(out["fc_id"]) == [1]
    assert rep["non_risolti"] == ["C:Zzyzx Q."]
