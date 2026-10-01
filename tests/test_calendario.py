"""Test della griglia di alternanza: calendario, fasce FantaLab, punti per giornata.

I numeri di FantaLab non sono inventati: sono quelli che la loro griglia stampa
per Atalanta + Bologna sulle giornate 6-38, letti il 2026-10-01. Se calendario o
classificazione fossero letti male, il voto dell'abbinamento non tornerebbe.
"""

import numpy as np
import pandas as pd
import pytest

from fantaoracle.model.calendario import (
    FASCE,
    carica_calendario,
    carica_fantalab,
    forza_avversari,
    livelli_fantalab,
    medie_squadra,
    partite_residue,
    punti_per_giornata,
    voto_abbinamento,
)

# La riga dell'Atalanta nella griglia FantaLab: l'avversario di ogni giornata.
ATALANTA_FANTALAB = [
    "sassuolo", "bologna", "roma", "cagliari", "juventus", "venezia", "milan", "frosinone",
    "fiorentina", "parma", "monza", "inter", "lecce", "lazio", "genoa", "napoli", "udinese",
    "como", "torino", "roma", "bologna", "fiorentina", "lazio", "genoa", "monza", "inter",
    "torino", "venezia", "milan", "sassuolo", "cagliari", "udinese", "parma", "juventus",
    "frosinone", "como", "lecce", "napoli",
]


@pytest.fixture(scope="module")
def cal():
    return carica_calendario("2026-27")


@pytest.fixture(scope="module")
def fl():
    return carica_fantalab()


class TestRiferimenti:
    def test_calendario_completo(self, cal):
        assert len(cal) == 380
        assert cal.groupby("giornata").size().eq(10).all()
        for _, g in cal.groupby("giornata"):
            assert len(set(g["casa"]) | set(g["trasferta"])) == 20
        assert cal["casa"].value_counts().eq(19).all()
        assert not cal.duplicated(["casa", "trasferta"]).any()

    def test_calendario_come_fantalab(self, cal):
        for gi, avv in enumerate(ATALANTA_FANTALAB, start=1):
            m = cal[(cal["giornata"] == gi) & ((cal["casa"] == "atalanta") | (cal["trasferta"] == "atalanta"))]
            assert len(m) == 1
            r = m.iloc[0]
            assert (r["trasferta"] if r["casa"] == "atalanta" else r["casa"]) == avv, f"giornata {gi}"

    def test_fantalab(self, fl, cal):
        assert set(fl["squadra"]) == set(cal["casa"])
        assert set(fl["P"]) <= set(FASCE) and set(fl["A"]) <= set(FASCE)
        assert fl.attrs["letto_il"] == "2026-10-01"
        # Le due fasce differiscono solo dove FantaLab le distingue.
        diverse = fl[fl["P"] != fl["A"]]["squadra"].tolist()
        assert diverse == ["fiorentina"]

    @pytest.mark.parametrize("ruolo,atteso", [
        ("P", {"facile": 25, "media": 7, "difficile": 1, "partite": 33, "voto": 86}),
        ("A", {"facile": 28, "media": 4, "difficile": 1, "partite": 33, "voto": 91}),
    ])
    def test_voto_come_fantalab(self, cal, fl, ruolo, atteso):
        assert voto_abbinamento(["atalanta", "bologna"], cal, fl, ruolo, 6, 38) == atteso


def _rating():
    r = pd.DataFrame({"squadra": ["a", "b", "c", "d"],
                      "attacco": [1.4, 1.0, 0.8, 0.7],
                      "difesa": [0.7, 1.0, 1.2, 1.3]})
    r.attrs["media_gol"] = 1.3
    return r


def _fl():
    return pd.DataFrame({"squadra": ["a", "b", "c", "d"],
                         "P": ["difficile", "media", "facile", "facile"],
                         "A": ["difficile", "facile", "facile", "media"]})


def _partite():
    # Girone all'italiana a 4 squadre, andata e ritorno: tutti affrontano tutti.
    coppie = [("a", "b"), ("c", "d"), ("a", "c"), ("b", "d"), ("a", "d"), ("b", "c")]
    righe, gi = [], 0
    for i, (x, y) in enumerate(coppie + [(y, x) for x, y in coppie]):
        gi = i // 2 + 1
        righe.append({"stagione": "s", "data": pd.Timestamp("2026-09-01") + pd.Timedelta(days=7 * gi),
                      "casa": x, "trasferta": y, "giocata": False, "giornata": gi})
    return pd.DataFrame(righe)


class TestForza:
    def test_senza_fantalab_e_il_modello(self):
        r = _rating()
        out = forza_avversari(r, None).set_index("squadra")
        assert np.allclose(out["attacco"], r.set_index("squadra")["attacco"])
        assert np.allclose(forza_avversari(r, _fl(), peso=0).set_index("squadra")["difesa"],
                           r.set_index("squadra")["difesa"])

    def test_livelli_misurati_col_modello(self):
        lv = livelli_fantalab(_rating(), _fl())
        assert lv["P"]["difficile"] == pytest.approx(1.4)
        assert lv["P"]["facile"] == pytest.approx(np.sqrt(0.8 * 0.7))
        assert lv["A"]["media"] == pytest.approx(1.3)

    def test_media_geometrica(self):
        r, fl = _rating(), _fl()
        lv = livelli_fantalab(r, fl)
        out = forza_avversari(r, fl, peso=0.5).set_index("squadra")
        # "d" e' facile per i portieri: il suo attacco si avvicina a quello della fascia.
        assert out.at["d", "attacco"] == pytest.approx(np.sqrt(0.7 * lv["P"]["facile"]))
        solo = forza_avversari(r, fl, peso=1).set_index("squadra")
        assert solo.at["b", "difesa"] == pytest.approx(lv["A"]["facile"])


class TestPartite:
    def test_gol_subiti_e_campo(self):
        r = _rating()
        fix = partite_residue(_partite(), r, "s", pd.Timestamp("2026-01-01"))
        assert len(fix) == 24
        x = fix[(fix["squadra"] == "a") & (fix["avversario"] == "b") & fix["casa"]].iloc[0]
        assert x["gs"] == pytest.approx(1.3 / 1.08 * 1.0 * 0.7)
        assert x["cs"] == pytest.approx(np.exp(-x["gs"]))
        # Stessa partita a campi invertiti: in trasferta si subisce di piu'.
        y = fix[(fix["squadra"] == "a") & (fix["avversario"] == "b") & ~fix["casa"]].iloc[0]
        assert y["gs"] > x["gs"] and y["molt"] < x["molt"]

    def test_moltiplicatore_relativo_a_un_avversario_medio(self):
        fix = partite_residue(_partite(), _rating(), "s", pd.Timestamp("2026-01-01"))
        # Contro la difesa migliore si segna meno che contro la peggiore.
        m = fix.groupby("avversario")["molt"].mean()
        assert m["a"] < m["b"] < m["c"] < m["d"]
        # Sul campionato intero, fattore campo a parte, la media e' 1.
        geo = np.exp(np.log(fix["molt"]).mean())
        assert geo == pytest.approx(1.0, abs=1e-9)

    def test_solo_partite_future(self):
        p = _partite()
        fix = partite_residue(p, _rating(), "s", p["data"].sort_values().iloc[3])
        assert fix["giornata"].min() == 3


class TestInfortuni:
    def test_giornate_perse_valgono_zero(self):
        from fantaoracle.model.infortuni import azzera_giornate_perse
        pg = pd.DataFrame({"fc_id": [1] * 4 + [2] * 4 + [3] * 4,
                           "giornata": [6, 7, 8, 9] * 3, "punti": 1.0})
        perse = pd.DataFrame({"fc_id": [1, 2, 3], "giornata_rientro": [8, None, None],
                              "giornate_perse": [2, 4, 0], "fine_stagione": [False, True, False]})
        out = azzera_giornate_perse(pg, perse).set_index(["fc_id", "giornata"])["punti"]
        assert out[1].tolist() == [0.0, 0.0, 1.0, 1.0]     # rientra alla 8a
        assert out[2].tolist() == [0.0] * 4                 # fuori fino alla fine
        assert out[3].tolist() == [1.0] * 4                 # in dubbio: non perde niente

    def test_calendario_squadre_con_la_giornata_ufficiale(self):
        from fantaoracle.model.infortuni import calendario_squadre
        d = pd.Timestamp
        # Il recupero della 1a si gioca dopo la 2a: la giornata ufficiale non cambia.
        partite = pd.DataFrame({
            "stagione": "s", "casa": ["a", "a"], "trasferta": ["b", "c"],
            "data": [d("2026-10-20"), d("2026-10-10")], "giocata": [False, False], "giornata": [1, 2]})
        cal = calendario_squadre(partite, "s")
        a = cal[cal["squadra"] == "a"].set_index("data")["giornata"]
        assert a[d("2026-10-20")] == 1 and a[d("2026-10-10")] == 2


class TestPuntiPerGiornata:
    def test_la_media_e_il_pt_g(self):
        r = _rating()
        fix = partite_residue(_partite(), r, "s", pd.Timestamp("2026-01-01"))
        corr = {"P": -0.3, "A": -0.15}
        pr = pd.DataFrame({
            "fc_id": [1, 2], "ruolo": ["P", "A"], "squadra": ["c", "c"], "p_voto": [0.9, 0.8],
            "voto_atteso": [6.1, 6.2], "rigori_parati_attesi": [0.03, 0.0], "amm_attese": [0.02, 0.1],
            "bonus_neutri": [0.0, 1.5], "malus_attesi": [0.0, 0.06], "quota_modificatore": [0.07, 0.0],
        })
        pg = punti_per_giornata(pr, fix, corr)
        assert len(pg) == 12
        med = medie_squadra(fix).loc["c"]
        p_atteso = 0.9 * (6.1 + med["p_clean_sheet"] + 3 * 0.03 - med["gol_subiti_attesi"]
                          - 0.5 * 0.02 - 0.3 + 0.07)
        a_atteso = 0.8 * (6.2 + med["calendario_attacco"] * 1.5 - 0.06 - 0.15)
        media = pg.groupby("fc_id")["punti"].mean()
        assert media[1] == pytest.approx(p_atteso)
        assert media[2] == pytest.approx(a_atteso)
        # Il portiere fa piu' punti contro l'attacco piu' debole, l'attaccante
        # contro la difesa peggiore.
        per_avv = pg.groupby(["fc_id", "avversario"])["punti"].mean()
        assert per_avv[1]["d"] > per_avv[1]["b"] > per_avv[1]["a"]
        assert per_avv[2]["d"] > per_avv[2]["b"] > per_avv[2]["a"]
