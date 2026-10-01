"""Test degli infortuni: parsing delle fonti, aggancio, rientri e propensione.

I frammenti HTML sono ridotti all'osso ma ricalcano il markup vero delle due
fonti, compresi i casi che hanno rotto le prime versioni del parser: la fascia
da capitano accanto alla croce rossa su Transfermarkt, i refusi di SosFanta sulla
giornata.
"""

import datetime as dt

import pandas as pd
import pytest

from fantaoracle.ingest.infortuni import (
    giornata_rientro,
    parse_club,
    parse_rosa,
    parse_sosfanta,
    parse_storico,
)
from fantaoracle.model.infortuni import (
    applica_rientri,
    calendario_squadre,
    categoria,
    livello,
    propensione,
    rientri,
)
from fantaoracle.resolve.match import match_players

# --- SosFanta ------------------------------------------------------------------


@pytest.mark.parametrize("testo,atteso", [
    ("Lesione al bicipite femorale, in dubbio per la 6a.", 6),
    ("Rientro previsto per la 13a giornata.", 13),
    ("in dubbio per la. 6a", 6),        # refuso vero, Piotrowski, 8 settembre
    ("in dubbio per 29a.", 29),         # refuso vero, Felici, 10 settembre
    ("tempi di recupero di 4-6 mesi dal 1 ottobre.", None),
])
def test_giornata_rientro(testo, atteso):
    assert giornata_rientro(testo) == atteso


def _blocco(squadra, infortunati="", squalificati="-"):
    return (f"<p><strong>{squadra.upper()}</strong></p><p><em>Infortunati:</em></p>{infortunati}"
            f"<p><em>Squalificati:</em> {squalificati}</p><p><em>Diffidati:</em> -</p>")


def test_parse_sosfanta():
    squadre = {"inter", "roma"}
    html = ('<div class="article-body">'
            + _blocco("Inter", "<p><strong>Thuram</strong> - Lesione alla coscia, in dubbio per la 8a.</p>")
            + _blocco("Roma", "", "Cristante, Mancini")
            + "<p>ROMA</p><p><strong>Rumore</strong> - coda pagina</p></div>")
    import fantaoracle.ingest.infortuni as mod
    vecchio, mod.SQUADRE_ATTESE = mod.SQUADRE_ATTESE, 2
    try:
        df = parse_sosfanta(html, squadre)
    finally:
        mod.SQUADRE_ATTESE = vecchio
    inf = df[df["tipo"] == "infortunato"]
    assert inf[["squadra", "nome", "giornata"]].values.tolist() == [["inter", "Thuram", 8]]
    assert sorted(df[df["tipo"] == "squalificato"]["nome"]) == ["Cristante", "Mancini"]
    assert "Rumore" not in set(df["nome"])          # l'intestazione ripetuta chiude il blocco


def test_parse_sosfanta_fallisce_se_mancano_squadre():
    html = '<div class="article-body">' + _blocco("Inter", "<p><strong>X</strong> - y</p>") + "</div>"
    with pytest.raises(RuntimeError, match="squadre riconosciute"):
        parse_sosfanta(html, {"inter", "roma"})


# --- Transfermarkt -------------------------------------------------------------------

def _riga(slug, tm_id, nome, icone=""):
    return (f'<td class="hauptlink">\n<a href="/{slug}/profil/spieler/{tm_id}">\n'
            f'{nome}{icone}            </a>\n</td>')


def test_parse_rosa_croce_rossa_e_capitano():
    righe = [
        _riga("manuel-locatelli", 1, "Manuel Locatelli",
              '<span title="Capitano" class="kapitaenicon-table icons_sprite">&nbsp;</span>'
              '<span title="Infortunio al menisco - Probabile ritorno 07/01/2027" '
              'class="verletzt-table icons_sprite">&nbsp;</span>'),
        _riga("bryan-cristante", 2, "Bryan Cristante",
              '<span title="Capitano" class="kapitaenicon-table icons_sprite">&nbsp;</span>'),
        _riga("donyell-malen", 3, "Donyell Malen",
              '<span title="Problema fisico" class="verletzt-table icons_sprite">&nbsp;</span>'),
    ] + [_riga(f"x-{i}", 100 + i, f"Riserva {i}") for i in range(18)]
    df = parse_rosa("".join(righe), "juventus").set_index("tm_id")
    assert df.loc[1, "infortunio"] == "Infortunio al menisco"
    assert df.loc[1, "rientro"] == dt.date(2027, 1, 7)
    assert pd.isna(df.loc[2, "infortunio"])                 # il capitano non e' un infortunio
    assert df.loc[3, "infortunio"] == "Problema fisico" and df.loc[3, "rientro"] is None
    assert df.loc[1, "nome"] == "Manuel Locatelli"


def test_parse_club_solo_squadre_note():
    html = ('<a href="/as-rom/startseite/verein/12/saison_id/2026">'
            '<a href="/fc-barcelona/startseite/verein/131/saison_id/2026">')
    assert parse_club(html) == {"as-rom": "12"}


def test_parse_storico():
    html = """<table class="items"><thead><tr><th>Stagione</th></tr></thead><tbody>
      <tr><td>26/27</td><td>Infortunio al menisco</td><td>07/09/2026</td><td>07/01/2027</td>
          <td>123 giorni</td><td>3</td></tr>
      <tr><td>24/25</td><td>Distorsione alla caviglia</td><td>01/06/2025</td><td>21/06/2025</td>
          <td>21 giorni</td><td>-</td></tr>
    </tbody></table>
    <a href="/x/verletzungen/spieler/9/page/2">2</a><a href="/x/verletzungen/spieler/9/page/3">3</a>"""
    righe, pagine = parse_storico(html)
    assert pagine == 3
    assert righe[0] == {"stagione": "26/27", "testo": "Infortunio al menisco",
                        "dal": dt.date(2026, 9, 7), "al": dt.date(2027, 1, 7),
                        "giorni": 123, "partite_perse": 3}
    assert righe[1]["partite_perse"] == 0


# --- aggancio ------------------------------------------------------------------------

def test_aggancio_cognomi_composti_e_i_turca():
    """Il listone scrive solo il cognome composto, Transfermarkt nome e cognome."""
    tm = pd.DataFrame({"nome": ["Randal Kolo Muani", "Kenan Yıldız", "Hans Nicolussi Caviglia"],
                       "squadra": ["juventus", "juventus", "parma"]})
    listone = pd.DataFrame({"nome": ["Kolo Muani", "Yildiz", "Nicolussi Caviglia", "Kalulu"],
                            "squadra": ["juventus", "juventus", "parma", "juventus"]})
    rep = match_players(tm, listone, fonte_left="transfermarkt", soglia=82.0)
    coppie = set(zip(rep.matched["nome_fonte"], rep.matched["nome_canonico"]))
    assert coppie == {("Randal Kolo Muani", "Kolo Muani"), ("Kenan Yıldız", "Yildiz"),
                      ("Hans Nicolussi Caviglia", "Nicolussi Caviglia")}


# --- rientri ---------------------------------------------------------------------------

@pytest.fixture
def partite():
    """Inter e Roma: due giocate, quattro da giocare."""
    d = pd.Timestamp
    return pd.DataFrame({
        "stagione": "2026-27",
        "casa": ["inter", "roma", "inter", "roma", "inter", "roma"],
        "trasferta": ["milan", "lazio", "lazio", "milan", "roma", "inter"],
        "data": [d("2026-09-20"), d("2026-09-20"), d("2026-10-10"), d("2026-10-11"),
                 d("2026-10-18"), d("2026-10-25")],
        "giocata": [True, True, False, False, False, False],
    })


def _ind(fc_id, tipo, giornata=None, rientro=None):
    return {"fc_id": fc_id, "tipo": tipo, "giornata": giornata, "rientro": rientro}


def test_calendario_numera_le_giornate(partite):
    cal = calendario_squadre(partite, "2026-27")
    inter = cal[cal["squadra"] == "inter"]
    assert inter["giornata"].tolist() == [1, 2, 3, 4]


def test_rientri(partite):
    cal = calendario_squadre(partite, "2026-27")
    squadra = pd.Series({1: "inter", 2: "inter", 3: "roma", 4: "roma", 5: "inter", 6: "roma"})
    ind = pd.DataFrame([
        _ind(1, "infortunato", giornata=4),                     # salta la 2a e la 3a... da giocare
        _ind(2, "infortunato", giornata=2),                     # in dubbio per la prossima
        _ind(3, "infortunato", rientro=dt.date(2026, 10, 12)),  # solo la data Transfermarkt
        _ind(4, "infortunato", giornata=30),                    # oltre il calendario
        _ind(5, "squalificato"),
        _ind(6, "acciaccato"),
    ])
    r = rientri(ind, squadra, cal).set_index("fc_id")
    assert r.loc[1, "giornate_perse"] == 2 and r.loc[1, "data_rientro"] == dt.date(2026, 10, 25)
    assert r.loc[2, "giornate_perse"] == 0
    assert r.loc[3, "giornata_rientro"] == 3 and r.loc[3, "giornate_perse"] == 1
    assert bool(r.loc[4, "fine_stagione"]) and r.loc[4, "giornate_perse"] == 3
    assert r.loc[5, "giornate_perse"] == 1
    assert r.loc[6, "giornate_perse"] == 0


def test_applica_rientri_scala_i_punti():
    pr = pd.DataFrame({"fc_id": [1, 2], "giornate_residue": [33, 33], "p_voto": [0.9, 0.9],
                       "punti_giornata": [6.0, 6.0], "punti_stagione": [198.0, 198.0]})
    out = applica_rientri(pr, pd.DataFrame({"fc_id": [1], "giornate_perse": [11]})).set_index("fc_id")
    assert out.loc[1, "punti_giornata"] == pytest.approx(4.0)
    assert out.loc[1, "punti_giornata_sano"] == pytest.approx(6.0)
    assert out.loc[1, "p_voto"] == pytest.approx(0.6)
    assert out.loc[2, "punti_giornata"] == pytest.approx(6.0)


# --- propensione -------------------------------------------------------------------------

@pytest.mark.parametrize("testo,atteso", [
    ("Infortunio al bicipite femorale", "muscolare"),
    ("Affaticamento muscolare", "muscolare"),
    ("Rottura del bicipite femorale", "grave"),        # la gravita' prima del muscolo
    ("Rottura del legamento crociato", "grave"),
    ("Influenza", "non conta"),
    ("Ritardo di condizione", "non conta"),
    ("Distorsione alla caviglia", "altro"),
])
def test_categoria(testo, atteso):
    assert categoria(testo) == atteso


def test_livello():
    assert livello(3, 0, 20, 10) == "alta"       # un quarto di stagione perso
    assert livello(9, 9, 10, 2) == "alta"        # ricadute muscolari continue
    assert livello(1, 0, 200, 30) == "bassa"     # un solo stop, anche lungo, non fa un fragile
    assert livello(2, 0, 50, 3) == "media"
    assert livello(6, 0, 5, 1) == "media"
    assert livello(0, 0, 0, 0) == "bassa"


def _stop(fc_id, stagione, testo, giorni, partite, dal="2025-01-01"):
    return {"fc_id": fc_id, "stagione": stagione, "testo": testo, "dal": dt.date.fromisoformat(dal),
            "al": None, "giorni": giorni, "partite_perse": partite}


def test_propensione():
    st = pd.DataFrame([
        _stop(1, "25/26", "Infortunio alla coscia", 60, 10, "2026-02-01"),
        _stop(1, "25/26", "Problema fisico", 30, 5, "2025-10-01"),
        _stop(1, "24/25", "Problema muscolare", 70, 12, "2025-03-01"),
        _stop(1, "24/25", "Influenza", 20, 3, "2025-01-01"),          # non conta
        _stop(1, "24/25", "Botta", 4, 0, "2024-12-01"),               # acciacco, non conta
        _stop(2, "26/27", "Problema muscolare", 40, 5, "2026-09-01"), # solo stagione in corso
    ])
    p = propensione(st).set_index("fc_id")
    assert p.loc[1, "stop"] == 3 and p.loc[1, "muscolari"] == 2
    assert p.loc[1, "livello"] == "alta"
    assert p.loc[1, "giorni_stagione"] == pytest.approx((60 + 30 + 0.75 * 70) / 2.25, abs=0.1)
    assert [e["testo"] for e in p.loc[1, "episodi"]][0] == "Infortunio alla coscia"
    # La stagione in corso conta negli stop ma non nelle medie.
    assert p.loc[2, "stop"] == 1 and p.loc[2, "giorni_stagione"] == 0
