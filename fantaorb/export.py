"""Export dei dati per il tool web: web/data.json.

Il tool e' una pagina statica: tutto quello che mostra arriva da questo file.
Contiene solo i giocatori del listone corrente (le 20 squadre di quest'anno), le
ultime proiezioni e valutazioni, lo storico sintetico per la scheda giocatore e
i parametri della lega che servono all'ottimizzatore.
"""

from __future__ import annotations

import datetime as dt
import json
import math

import pandas as pd

from .config import load_league
from .db import tabella
from .paths import ROOT

WEB = ROOT / "web"


def _r(x, n=2):
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return None
    return round(float(x), n)


def pagina() -> None:
    """web/index.html = web/tool.html dentro un documento completo.

    Il tool e' diviso in tre file: tool.html (struttura), tool.css (stile) e
    tool.js (logica). tool.html e' scritto come frammento (titolo, link, markup)
    perche' e' anche il sorgente della pagina pubblicata come artifact, che
    aggiunge da se' doctype e head. Per GitHub Pages serve il documento intero;
    ai riferimenti a tool.css e tool.js si aggiunge un'impronta del contenuto,
    cosi' dopo un aggiornamento il browser non tiene in cache la versione vecchia.
    """
    import hashlib

    corpo = (WEB / "tool.html").read_text(encoding="utf-8")
    for nome, attr in (("tool.css", "href"), ("tool.js", "src")):
        impronta = hashlib.sha256((WEB / nome).read_bytes()).hexdigest()[:10]
        corpo = corpo.replace(f'{attr}="{nome}"', f'{attr}="{nome}?v={impronta}"')
    (WEB / "index.html").write_text(
        "<!doctype html>\n<html lang=\"it\">\n<head>\n<meta charset=\"utf-8\">\n"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n"
        "</head>\n<body>\n" + corpo + "\n</body>\n</html>\n", encoding="utf-8")


def esporta(verbose: bool = True) -> dict:
    cfg = load_league()
    versione = tabella("SELECT max(versione) v FROM proiezioni").iat[0, 0]
    if versione is None:
        raise RuntimeError("Nessuna proiezione nel database: lanciare prima `model`.")

    df = tabella("""
        SELECT g.fc_id, g.nome, g.squadra, g.ruolo, g.ruolo_mantra,
               p.p_voto, p.p_titolare, p.voto_atteso, p.bonus_attesi, p.malus_attesi,
               p.fm_attesa, p.quota_modificatore, p.punti_giornata, p.punti_stagione,
               p.giornate_residue, p.dettagli,
               v.vorp, v.valore, v.prezzo_atteso, v.affare, v.fattore_tifo
        FROM proiezioni p
        JOIN valutazioni v USING (versione, fc_id)
        JOIN giocatori g USING (fc_id)
        JOIN squadre s ON s.squadra = g.squadra
        WHERE p.versione = ? AND g.nel_listone AND s.in_serie_a
    """, [versione])
    quot = tabella("""
        SELECT fc_id, qi, qa, fvm1000 FROM quotazioni
        QUALIFY row_number() OVER (PARTITION BY fc_id ORDER BY rilevato DESC) = 1""")
    df = df.merge(quot, on="fc_id", how="left")

    storico = tabella("""
        SELECT fc_id, stagione, squadra,
               count(*) FILTER (WHERE NOT sv) AS presenze,
               avg(voto) AS media, avg(fantavoto) AS fm,
               sum(gol + rigori_segnati) AS gol, sum(assist) AS assist
        FROM voti WHERE fc_id IN (SELECT fc_id FROM giocatori WHERE nel_listone)
        GROUP BY 1, 2, 3 ORDER BY 1, 2""")
    st = {k: g for k, g in storico.groupby("fc_id")}

    ultime = tabella("""
        SELECT fc_id, giornata, sv, fantavoto FROM voti
        WHERE stagione = '2026-27' ORDER BY giornata""")
    ul = {k: g for k, g in ultime.groupby("fc_id")}

    giocatori = []
    for _, r in df.iterrows():
        d = json.loads(r["dettagli"]) if r["dettagli"] else {}
        s = st.get(r["fc_id"])
        u = ul.get(r["fc_id"])
        giocatori.append({
            "id": int(r["fc_id"]), "nome": r["nome"], "sq": r["squadra"],
            "r": r["ruolo"], "rm": r["ruolo_mantra"],
            "qa": _r(r["qa"], 0), "qi": _r(r["qi"], 0), "fvm": _r(r["fvm1000"], 0),
            "pg": _r(r["punti_giornata"]), "ps": _r(r["punti_stagione"], 1),
            "pv": _r(r["p_voto"], 3), "pt": _r(r["p_titolare"], 3),
            "va": _r(r["voto_atteso"]), "fm": _r(r["fm_attesa"]),
            "bo": _r(r["bonus_attesi"]), "ma": _r(r["malus_attesi"]),
            "qm": _r(r["quota_modificatore"]),
            "gol": _r(d.get("gol_attesi"), 3), "ass": _r(d.get("assist_attesi"), 3),
            "rig": _r(d.get("rigori_attesi"), 3), "qrig": _r(d.get("quota_rigori"), 2),
            "amm": _r(d.get("amm_attese"), 3), "min": _r(d.get("minuti_presenza"), 0),
            "gs": _r(d.get("gol_subiti_attesi"), 2), "cs": _r(d.get("p_clean_sheet"), 3),
            "val": _r(r["valore"], 0), "pa": int(r["prezzo_atteso"]),
            "aff": _r(r["affare"], 0), "tifo": _r(r["fattore_tifo"], 2),
            "st": [] if s is None else [
                [x.stagione, x.squadra, int(x.presenze), _r(x.media), _r(x.fm), int(x.gol), int(x.assist)]
                for x in s.itertuples()],
            "ul": [] if u is None else [
                [int(x.giornata), None if x.sv else _r(x.fantavoto, 1)] for x in u.itertuples()],
        })

    squadre = tabella("SELECT squadra, nome FROM squadre WHERE in_serie_a ORDER BY nome")
    from .model.pipeline import giornata_corrente
    out = {
        "meta": {
            "generato": dt.datetime.now().isoformat(timespec="minutes"),
            "versione": versione,
            "stagione": "2026-27",
            "giornata": giornata_corrente(),
            "giornate_residue": int(df["giornate_residue"].max()),
            "n_squadre": cfg.get("formato.n_squadre"),
            "crediti": cfg.get("formato.crediti_iniziali"),
            "slot": cfg.get("formato.slot"),
            "max_per_squadra": cfg.get("mercato.max_per_squadra"),
            "blocco_portieri_esente": cfg.get("mercato.blocco_portieri_esente"),
            "tifo": cfg.get("mercato.tifo"),
        },
        "squadre": [{"slug": a, "nome": b} for a, b in squadre.itertuples(index=False)],
        "giocatori": giocatori,
    }
    WEB.mkdir(exist_ok=True)
    fp = WEB / "data.json"
    fp.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    pagina()
    if verbose:
        print(f"  {fp.relative_to(ROOT)}: {len(giocatori)} giocatori, "
              f"{fp.stat().st_size / 1024:.0f} KB, versione {versione}")
    return out
