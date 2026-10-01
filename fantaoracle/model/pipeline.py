"""Proiezioni e valutazioni della stagione corrente, scritte nel database."""

from __future__ import annotations

import datetime as dt
import json

import pandas as pd

from ..config import load_league
from ..db import connetti, tabella
from .infortuni import applica_rientri, calendario_squadre, rientri
from .projection import proietta
from .valuation import prezzo_atteso, valore

STAGIONE = "2026-27"
VERSIONE_MODELLO = "v1"


def giornata_corrente() -> int:
    n = tabella(f"SELECT count(*) FROM partite WHERE stagione = '{STAGIONE}' AND giocata").iat[0, 0]
    return int(n // 10)


def run(verbose: bool = True) -> pd.DataFrame:
    cfg = load_league()
    g = giornata_corrente()

    voti = tabella("SELECT * FROM voti")
    stat = tabella("SELECT * FROM stat_avanzate")
    partite = tabella("SELECT * FROM partite")
    # Solo i giocatori del listone, quindi solo le 20 squadre di quest'anno.
    anag = tabella("""
        SELECT g.fc_id, g.nome, g.squadra, g.ruolo
        FROM giocatori g JOIN squadre s USING (squadra)
        WHERE g.nel_listone AND s.in_serie_a""")
    quot = tabella("""
        SELECT fc_id, qi, qa, fvm1000, pct_giocate FROM quotazioni
        QUALIFY row_number() OVER (PARTITION BY fc_id ORDER BY rilevato DESC) = 1""")

    pr, rating = proietta(voti, stat, partite, anag, STAGIONE, g, con_rating=True)

    # Chi e' fermo adesso: le giornate che salta escono dai punti attesi, e
    # quindi dal valore. Il backtest non passa di qui (non ci sono snapshot
    # degli indisponibili di allora), e la proiezione da sano resta accanto.
    ind = tabella("SELECT * FROM indisponibili")
    perse = rientri(ind, anag.set_index("fc_id")["squadra"], calendario_squadre(partite, STAGIONE))
    pr = applica_rientri(pr, perse)
    pr = pr.merge(anag[["fc_id", "nome"]], on="fc_id").merge(quot, on="fc_id", how="left")
    pr = prezzo_atteso(valore(pr, cfg), cfg)

    versione = f"{VERSIONE_MODELLO}-{dt.date.today().isoformat()}-g{g}"
    adesso = dt.datetime.now()
    con = connetti()
    con.execute("DELETE FROM proiezioni WHERE versione = ?", [versione])
    con.execute("DELETE FROM valutazioni WHERE versione = ?", [versione])

    dettagli = pr.apply(lambda r: json.dumps({
        k: (None if pd.isna(r[k]) else round(float(r[k]), 4)) for k in
        ["gol_attesi", "assist_attesi", "rigori_attesi", "quota_rigori", "amm_attese",
         "minuti_presenza", "quota_titolare", "gol_subiti_attesi", "p_clean_sheet",
         "partite_osservate", "giornate_perse", "p_voto_sano", "punti_giornata_sano"]
        if k in r}), axis=1)
    righe_p = pd.DataFrame({
        "versione": versione, "fc_id": pr["fc_id"], "calcolata": adesso,
        "giornate_residue": pr["giornate_residue"], "p_voto": pr["p_voto"],
        "p_titolare": pr["p_voto"] * pr["quota_titolare"],
        "voto_atteso": pr["voto_atteso"], "bonus_attesi": pr["bonus_attesi"],
        "malus_attesi": pr["malus_attesi"], "fm_attesa": pr["fm_attesa"],
        "quota_modificatore": pr["quota_modificatore"],
        "punti_giornata": pr["punti_giornata"], "punti_stagione": pr["punti_stagione"],
        "dettagli": dettagli,
    })
    righe_v = pd.DataFrame({
        "versione": versione, "fc_id": pr["fc_id"], "vorp": pr["vorp"],
        "valore": pr["valore"], "prezzo_atteso": pr["prezzo_atteso"],
        "affare": pr["affare"], "fattore_tifo": pr["fattore_tifo"],
    })
    for t, d in (("proiezioni", righe_p), ("valutazioni", righe_v)):
        con.register("_t", d)
        con.execute(f"INSERT INTO {t} SELECT * FROM _t")
        con.unregister("_t")
    con.close()

    pr.attrs["versione"] = versione
    pr.attrs["giornata"] = g
    if verbose:
        fermi = perse[perse["giornate_perse"] > 0]
        print(f"  indisponibili: {len(fermi)} saltano almeno una giornata, "
              f"{int(fermi['giornate_perse'].sum())} giornate-giocatore in tutto")
        print(f"  {versione}: {len(pr)} giocatori proiettati su {int(pr['giornate_residue'].max())} "
              f"giornate; scala FVM {pr.attrs.get('scala_fvm', 0):.3f}")
    return pr
