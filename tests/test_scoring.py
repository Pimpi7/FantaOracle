"""Test del modulo punteggio.

Il test centrale e' `test_media_non_sostituisce_la_simulazione`: blocca
l'invariante su cui poggia tutta l'architettura del motore, cioe' che le funzioni
a gradini vanno applicate alle simulazioni e non alla media.
"""

import numpy as np
import pytest

from fantaoracle.config import LeagueConfig, load_league
from fantaoracle.model.scoring import (
    bonus_da_tabella,
    fantavoto,
    media_difensiva,
    modificatore_difesa,
    prob_vittoria,
    punteggio_squadra,
    punti_a_gol,
    punti_classifica,
)


@pytest.fixture
def cfg():
    return load_league()


class TestFantavoto:
    def test_gol_e_ammonizione(self, cfg):
        assert fantavoto(np.array([6.0]), cfg, gol=1, ammonizioni=1)[0] == 8.5

    def test_portiere_gol_subiti(self, cfg):
        assert fantavoto(np.array([6.0]), cfg, gol_subiti=2)[0] == 4.0

    def test_portiere_imbattuto(self, cfg):
        assert fantavoto(np.array([6.0]), cfg, imbattuto=1)[0] == 7.0

    def test_rigore_vale_come_gol(self, cfg):
        """Nella tabella classica il rigore trasformato e' un gol qualunque."""
        a = fantavoto(np.array([6.0]), cfg, gol=1)[0]
        b = fantavoto(np.array([6.0]), cfg, rigori_segnati=1)[0]
        assert a == b

    def test_vettoriale(self, cfg):
        out = fantavoto(np.array([6.0, 5.5, 7.0]), cfg, gol=np.array([1, 0, 2]))
        assert out.tolist() == [9.0, 5.5, 13.0]


class TestTabellaGradini:
    def test_fasce(self, cfg):
        s = cfg.get("modificatori.difesa.soglie")
        casi = {5.99: 0, 6.0: 1, 6.49: 1, 6.5: 3, 6.99: 3, 7.0: 6, 9.0: 6}
        for media, atteso in casi.items():
            assert bonus_da_tabella(np.array([media]), s)[0] == atteso

    def test_soglia_inclusiva(self, cfg):
        """Esattamente 6.00 deve dare il bonus, non restarne fuori."""
        s = cfg.get("modificatori.difesa.soglie")
        assert bonus_da_tabella(np.array([6.0]), s)[0] == 1

    def test_ordina_una_tabella_disordinata(self):
        s = [[7.0, 6], [6.0, 1], [6.5, 3]]
        assert bonus_da_tabella(np.array([6.7]), s)[0] == 3


class TestMediaDifensiva:
    def test_prende_i_migliori_e_scarta_il_resto(self, cfg):
        """Con 5 difensori i due peggiori non contano: base fissa a 4 voti."""
        p = np.array([6.0])
        d = np.array([[7.0, 6.5, 6.0, 4.0, 5.0]])
        # (6.0 portiere + 7.0 + 6.5 + 6.0) / 4
        assert media_difensiva(p, d, cfg)[0] == pytest.approx(6.375)

    def test_schierare_un_difensore_in_piu_non_puo_peggiorare(self, cfg):
        p = np.array([6.0])
        con4 = media_difensiva(p, np.array([[6.5, 6.0, 6.0, 5.0]]), cfg)[0]
        con5 = media_difensiva(p, np.array([[6.5, 6.0, 6.0, 5.0, 7.0]]), cfg)[0]
        assert con5 >= con4

    def test_troppi_pochi_difensori_solleva(self, cfg):
        with pytest.raises(ValueError, match="almeno"):
            media_difensiva(np.array([6.0]), np.array([[6.0, 6.0]]), cfg)


class TestModificatoreDifesa:
    def test_difesa_a_tre_non_attiva(self, cfg):
        """Serve una difesa a 4: col 3-4-3 il modificatore non scatta."""
        b = modificatore_difesa(
            np.array([7.0]), np.array([[7.0, 7.0, 7.0]]), cfg,
            n_difensori_schierati=3,
        )
        assert b[0] == 0.0

    def test_disattivato_da_config(self):
        spento = LeagueConfig(raw={"modificatori": {"difesa": {"attivo": False}}})
        b = modificatore_difesa(np.array([7.0]), np.array([[7.0] * 4]), spento)
        assert b[0] == 0.0

    def test_media_non_sostituisce_la_simulazione(self, cfg):
        """L'invariante su cui poggia il motore: E[f(X)] != f(E[X]).

        Con una funzione a gradini, calcolare la media dei voti e poi leggere la
        tabella da' un risultato diverso da applicare la tabella a ogni
        simulazione. La differenza non e' trascurabile: qui vale oltre mezzo punto
        per giornata, cioe' una ventina di punti su una stagione residua.

        Se questo test inizia a passare con `abs=0.01`, qualcuno ha sostituito la
        simulazione con una scorciatoia sulla media.
        """
        rng = np.random.default_rng(7)
        n = 100_000
        mu = 6.4
        p = rng.normal(mu, 0.6, n)
        d = rng.normal(mu, 0.6, (n, 4))

        atteso_simulato = modificatore_difesa(p, d, cfg).mean()
        media_dei_voti = media_difensiva(p, d, cfg).mean()
        ingenuo = bonus_da_tabella(
            np.array([media_dei_voti]), cfg.get("modificatori.difesa.soglie")
        )[0]

        assert abs(atteso_simulato - ingenuo) > 0.5

    def test_bonus_cresce_con_la_media(self, cfg):
        rng = np.random.default_rng(3)
        n = 20_000
        valori = []
        for mu in (6.0, 6.5, 7.0):
            p = rng.normal(mu, 0.5, n)
            d = rng.normal(mu, 0.5, (n, 4))
            valori.append(modificatore_difesa(p, d, cfg).mean())
        assert valori == sorted(valori)


class TestPuntiEGol:
    def test_soglie(self, cfg):
        casi = {60: 0, 65.5: 0, 66: 1, 71.9: 1, 72: 2, 78: 3, 103: 7}
        for punti, gol in casi.items():
            assert punti_a_gol(np.array([punti]), cfg)[0] == gol

    def test_punti_classifica(self):
        gn = np.array([2, 1, 0])
        ga = np.array([1, 1, 2])
        assert punti_classifica(gn, ga).tolist() == [3, 1, 0]

    def test_punteggio_squadra_somma_e_modificatore(self, cfg):
        fv = np.array([[6.0] * 11])
        senza = punteggio_squadra(fv, cfg)[0]
        con = punteggio_squadra(
            fv, cfg, voto_portiere=np.array([7.0]),
            voti_difensori=np.array([[7.0, 7.0, 7.0, 7.0]]),
        )[0]
        assert senza == pytest.approx(66.0)
        assert con == pytest.approx(66.0 + 6.0)   # media 7.0 -> +6


class TestProbVittoria:
    def test_varianza_aiuta_lo_sfavorito(self, cfg):
        """Il risultato che rende diverso l'h2h dai punti totali.

        Due formazioni con la stessa media: contro un avversario piu' forte quella
        volatile rende piu' punti in classifica, perche' giocando la media si
        perde con certezza.
        """
        rng = np.random.default_rng(11)
        n = 60_000
        solida = rng.normal(68, 5, n)
        volatile = rng.normal(68, 12, n)
        corazzata = rng.normal(80, 8, n)

        a = prob_vittoria(solida, corazzata, cfg)
        b = prob_vittoria(volatile, corazzata, cfg)

        assert a["punteggio_medio"] == pytest.approx(b["punteggio_medio"], abs=0.3)
        assert b["punti_attesi"] > a["punti_attesi"]

    def test_solidita_aiuta_il_favorito(self, cfg):
        rng = np.random.default_rng(12)
        n = 60_000
        solida = rng.normal(68, 5, n)
        volatile = rng.normal(68, 12, n)
        debole = rng.normal(56, 8, n)

        a = prob_vittoria(solida, debole, cfg)
        b = prob_vittoria(volatile, debole, cfg)
        assert a["punti_attesi"] > b["punti_attesi"]

    def test_probabilita_sommano_a_uno(self, cfg):
        rng = np.random.default_rng(5)
        n = 10_000
        r = prob_vittoria(rng.normal(68, 8, n), rng.normal(68, 8, n), cfg)
        assert r["p_vittoria"] + r["p_pareggio"] + r["p_sconfitta"] == pytest.approx(1.0)
