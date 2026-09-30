"""Test del modulo quote.

Il test che conta davvero e' `test_over_under_stabilizza_il_totale`: documenta
il motivo per cui il mercato Over/Under non e' un extra ma un ingrediente
necessario, e fallisce se qualcuno lo rimuove dalla pipeline.
"""

import numpy as np
import pandas as pd
import pytest

from fantaoracle.model.odds import (
    _esiti,
    _multiplicativo,
    _shin,
    aggiungi_attese,
    clean_sheet,
    distribuzione_gol_subiti,
    inverti_poisson,
    margine,
    matrice_risultati,
    probabilita_implicite,
)


class TestMargine:
    def test_probabilita_sommano_a_uno(self):
        for metodo in ("shin", "multiplicativo"):
            p = probabilita_implicite(1.38, 5.10, 8.50, metodo=metodo)
            assert sum(p) == pytest.approx(1.0, abs=1e-9)

    def test_shin_corregge_verso_il_favorito(self):
        """Il bias favourite-longshot va corretto in questa direzione.

        Il multiplicativo lascia troppa probabilita' sugli esiti improbabili;
        Shin la sposta verso il favorito. Se questo test si inverte, il metodo
        e' implementato al contrario.
        """
        quote = np.array([1.38, 5.10, 8.50])
        m = _multiplicativo(quote)
        s = _shin(quote)
        assert s[0] > m[0]      # favorito: piu' probabilita'
        assert s[2] < m[2]      # sfavorito: meno

    def test_margine_positivo(self):
        assert margine(1.38, 5.10, 8.50) > 0

    def test_quote_invalide_danno_nan(self):
        assert np.isnan(probabilita_implicite(0.5, 3.0, 3.0)[0])
        assert np.isnan(probabilita_implicite(np.nan, 3.0, 3.0)[0])


class TestInversione:
    @pytest.mark.parametrize("lam", [(1.8, 0.9), (1.2, 1.2), (2.5, 0.6), (0.8, 1.6)])
    def test_round_trip(self, lam):
        """Da lambda a probabilita' e ritorno: deve chiudere esattamente."""
        p = _esiti(*lam, rho=-0.13)
        stimati = inverti_poisson(*p, rho=-0.13)
        assert stimati == pytest.approx(lam, abs=1e-6)

    def test_simmetria(self):
        p = probabilita_implicite(2.90, 3.30, 2.90)
        lam_c, lam_t = inverti_poisson(*p)
        assert lam_c == pytest.approx(lam_t, abs=1e-6)

    def test_favorito_segna_di_piu(self):
        p = probabilita_implicite(1.38, 5.10, 8.50)
        lam_c, lam_t = inverti_poisson(*p)
        assert lam_c > lam_t

    def test_over_under_stabilizza_il_totale(self):
        """Il motivo per cui l'Over/Under e' necessario e non opzionale.

        Con il solo 1X2 il totale gol dipende fortemente da rho, che e' un
        parametro che non osserviamo. Con l'Over/Under l'oscillazione quasi
        sparisce, perche' il totale viene ancorato dal mercato invece che dedotto
        dalla probabilita' di pareggio.
        """
        p = probabilita_implicite(2.10, 3.40, 3.60)
        p_over = float(_shin(np.array([2.05, 1.75]))[0])

        solo_1x2 = [sum(inverti_poisson(*p, rho=r)) for r in (0.0, -0.08, -0.13, -0.18)]
        con_over = [sum(inverti_poisson(*p, rho=r, p_over25=p_over))
                    for r in (0.0, -0.08, -0.13, -0.18)]

        spread_1x2 = max(solo_1x2) - min(solo_1x2)
        spread_over = max(con_over) - min(con_over)

        assert spread_1x2 > 0.5          # oltre mezzo gol di incertezza
        assert spread_over < 0.05        # praticamente stabile
        assert spread_over < spread_1x2 / 10


class TestMatriceRisultati:
    def test_somma_a_uno(self):
        for rho in (0.0, -0.13):
            assert matrice_risultati(1.4, 1.2, rho).sum() == pytest.approx(1.0, abs=1e-9)

    def test_dixon_coles_alza_i_risultati_bassi(self):
        m0 = matrice_risultati(1.4, 1.2, rho=0.0)
        md = matrice_risultati(1.4, 1.2, rho=-0.13)
        assert md[0, 0] > m0[0, 0]
        assert md[1, 1] > m0[1, 1]

    def test_dixon_coles_preserva_le_marginali(self):
        """Proprieta' costitutiva della correzione, e fonte di equivoci.

        Dixon-Coles ridistribuisce fra risultati esatti ma lascia intatte le
        distribuzioni dei gol di ciascuna squadra. Quindi a lambda dati NON
        cambia il clean sheet. Chi si aspetta il contrario sta sbagliando
        modello mentale.
        """
        m0 = matrice_risultati(1.4, 1.2, rho=0.0)
        md = matrice_risultati(1.4, 1.2, rho=-0.13)
        assert md.sum(axis=0) == pytest.approx(m0.sum(axis=0), abs=1e-6)
        assert md.sum(axis=1) == pytest.approx(m0.sum(axis=1), abs=1e-6)


class TestDerivate:
    def test_clean_sheet_e_poisson_zero(self):
        for lam in (0.6, 1.0, 1.5, 2.2):
            assert clean_sheet(lam) == pytest.approx(np.exp(-lam), abs=1e-12)

    def test_clean_sheet_decresce_nei_gol_attesi(self):
        valori = [clean_sheet(l) for l in (0.5, 1.0, 1.5, 2.0)]
        assert valori == sorted(valori, reverse=True)

    def test_distribuzione_gol_subiti(self):
        d = distribuzione_gol_subiti(1.3)
        assert d.sum() == pytest.approx(1.0, abs=1e-6)
        assert d[0] == pytest.approx(clean_sheet(1.3), abs=1e-12)
        # La media della distribuzione deve tornare al lambda di partenza.
        assert float((d * np.arange(len(d))).sum()) == pytest.approx(1.3, abs=1e-6)


class TestPipeline:
    def test_aggiungi_attese(self, capsys):
        df = pd.DataFrame({
            "casa": ["Napoli", "Roma"],
            "trasferta": ["Cagliari", "Pisa"],
            "quota_1": [1.38, 2.05],
            "quota_x": [5.10, 3.40],
            "quota_2": [8.50, 3.85],
            "quota_over25": [1.72, 2.00],
            "quota_under25": [2.08, 1.80],
        })
        out = aggiungi_attese(df)

        for c in ("p_1", "lam_casa", "lam_trasferta", "cs_casa", "cs_trasferta"):
            assert c in out.columns
        assert out["usa_over"].all()
        assert (out["lam_casa"] > 0).all()
        # Il Napoli favorito deve avere gol attesi piu' alti della Roma quasi pari.
        assert out.loc[0, "lam_casa"] > out.loc[1, "lam_casa"]

    def test_segnala_le_partite_senza_over_under(self, capsys):
        """L'assenza di Over/Under degrada la stima: deve essere detto, non nascosto."""
        df = pd.DataFrame({
            "casa": ["Roma"], "trasferta": ["Pisa"],
            "quota_1": [2.05], "quota_x": [3.40], "quota_2": [3.85],
            "quota_over25": [np.nan], "quota_under25": [np.nan],
        })
        out = aggiungi_attese(df)
        assert not out["usa_over"].any()
        assert "senza quote" in capsys.readouterr().out
