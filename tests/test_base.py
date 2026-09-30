"""Test della base: normalizzazione, matching, config, store.

I casi di normalizzazione non sono inventati: sono le grafie che le fonti usano
davvero e che hanno rotto le versioni precedenti del matcher.
"""

import datetime as dt

import pandas as pd
import pytest

from fantaoracle.config import LeagueConfig, RegolaMancante, pending_fields
from fantaoracle.resolve.match import match_players
from fantaoracle.resolve.normalize import (
    compact_key,
    nomi_compatibili,
    normalize_team,
    split_name,
)


class TestNormalize:
    @pytest.mark.parametrize(
        "grafia,atteso",
        [
            ("Dušan Vlahović", ("vlahovic", "dusan")),
            ("Vlahovic D.", ("vlahovic", "d")),
            ("VLAHOVIC", ("vlahovic", "")),
            ("Giovanni Di Lorenzo", ("di lorenzo", "giovanni")),
            ("Di Lorenzo G.", ("di lorenzo", "g")),
            ("Rasmus Højlund", ("hojlund", "rasmus")),
            ("Evan N'Dicka", ("ndicka", "evan")),
            ("Charles De Ketelaere", ("de ketelaere", "charles")),
            ("Pellegrini Lo.", ("pellegrini", "lo")),
            ("Pellegrini Lu.", ("pellegrini", "lu")),
        ],
    )
    def test_split(self, grafia, atteso):
        assert split_name(grafia) == atteso

    def test_trattino_non_spezza_il_cognome(self):
        # "Fitz-Jim" e' un cognome solo: se il trattino separasse, "Fitz"
        # verrebbe scambiato per nome proprio e il match fallirebbe.
        assert split_name("Fitz-Jim")[0] == "fitzjim"
        assert compact_key("Fitz-Jim") == compact_key("Fitz Jim")

    def test_nomi_compatibili_per_prefisso(self):
        assert nomi_compatibili("lorenzo", "lo") is True
        assert nomi_compatibili("luca", "lo") is False
        assert nomi_compatibili("d", "dusan") is True
        # Senza informazione non si penalizza ne' si premia.
        assert nomi_compatibili("", "dusan") is None

    def test_alias_squadre(self):
        assert normalize_team("FC Internazionale") == "inter"
        assert normalize_team("Hellas Verona") == "verona"
        assert normalize_team("Napoli") == "napoli"


class TestMatch:
    @pytest.fixture
    def listone(self):
        return pd.DataFrame(
            [
                ("Vlahovic", "Juventus"),
                ("Di Lorenzo", "Napoli"),
                ("Hojlund", "Napoli"),
                ("Pellegrini Lo.", "Roma"),
                ("Pellegrini Lu.", "Roma"),
            ],
            columns=["nome", "squadra"],
        )

    def test_omonimi_stessa_squadra(self, listone):
        """Il caso che rompe i matcher ingenui: due Pellegrini nella Roma."""
        fonte = pd.DataFrame(
            [("Lorenzo Pellegrini", "Roma"), ("Luca Pellegrini", "Roma")],
            columns=["nome", "squadra"],
        )
        rep = match_players(fonte, listone, fonte_left="test")
        mappa = dict(zip(rep.matched["nome_fonte"], rep.matched["nome_canonico"]))
        assert mappa["Lorenzo Pellegrini"] == "Pellegrini Lo."
        assert mappa["Luca Pellegrini"] == "Pellegrini Lu."

    def test_giocatore_assente_non_viene_forzato(self, listone):
        """Meglio un buco dichiarato che una riga sbagliata scritta in silenzio."""
        fonte = pd.DataFrame([("Giocatore Inesistente", "Roma")],
                             columns=["nome", "squadra"])
        rep = match_players(fonte, listone, fonte_left="test")
        assert len(rep.matched) == 0
        assert len(rep.unmatched_left) == 1

    def test_diacritici_e_apostrofi(self, listone):
        fonte = pd.DataFrame(
            [("Dušan Vlahović", "Juventus"), ("Rasmus Højlund", "Napoli")],
            columns=["nome", "squadra"],
        )
        rep = match_players(fonte, listone, fonte_left="test")
        assert rep.stats["coverage"] == 1.0

    def test_uno_a_uno(self, listone):
        """Due giocatori diversi non possono finire sulla stessa riga canonica."""
        fonte = pd.DataFrame(
            [("Lorenzo Pellegrini", "Roma"), ("Luca Pellegrini", "Roma")],
            columns=["nome", "squadra"],
        )
        rep = match_players(fonte, listone, fonte_left="test")
        assert rep.matched["nome_canonico"].nunique() == len(rep.matched)


class TestConfig:
    def test_pending_solleva_errore_esplicito(self):
        cfg = LeagueConfig(raw={"bonus": {"gol_segnato": "PENDING"}})
        with pytest.raises(RegolaMancante, match="bonus.gol_segnato"):
            cfg.get("bonus.gol_segnato")

    def test_campo_assente_dice_dove_si_e_fermato(self):
        cfg = LeagueConfig(raw={"bonus": {}})
        with pytest.raises(RegolaMancante, match="bonus.inesistente"):
            cfg.get("bonus.inesistente")

    def test_valore_confermato_passa(self):
        cfg = LeagueConfig(raw={"bonus": {"gol_segnato": 3}})
        assert cfg.get("bonus.gol_segnato") == 3

    def test_elenco_pending(self):
        cfg = LeagueConfig(raw={"a": "PENDING", "b": {"c": "PENDING", "d": 1}})
        assert pending_fields(cfg) == ["a", "b.c"]


class TestStore:
    def test_snapshot_e_lettura_al_passato(self, tmp_path, monkeypatch):
        """Il backtest deve poter leggere solo cio' che esisteva a una data."""
        import fantaoracle.store as store

        monkeypatch.setattr(store, "RAW", tmp_path)

        store.write_snapshot(pd.DataFrame({"x": [1]}), "f", "d",
                             asof=dt.date(2026, 10, 1))
        store.write_snapshot(pd.DataFrame({"x": [2]}), "f", "d",
                             asof=dt.date(2026, 10, 20))

        # Al 10 ottobre esisteva solo il primo snapshot.
        assert store.read_snapshot("f", "d", asof=dt.date(2026, 10, 10))["x"][0] == 1
        assert store.read_snapshot("f", "d")["x"][0] == 2
        assert len(store.list_snapshots("f", "d")) == 2

    def test_non_sovrascrive(self, tmp_path, monkeypatch):
        import fantaoracle.store as store

        monkeypatch.setattr(store, "RAW", tmp_path)
        oggi = dt.date(2026, 10, 1)
        store.write_snapshot(pd.DataFrame({"x": [1]}), "f", "d", asof=oggi)
        store.write_snapshot(pd.DataFrame({"x": [999]}), "f", "d", asof=oggi)
        assert store.read_snapshot("f", "d")["x"][0] == 1
