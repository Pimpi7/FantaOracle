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
    Scrive anche web/artefatto.html (non in git): il frammento con le impronte, da
    pubblicare come artifact al posto di tool.html.
    """
    import hashlib

    corpo = (WEB / "tool.html").read_text(encoding="utf-8")
    for nome, attr in (("tool.css", "href"), ("tool.js", "src")):
        impronta = hashlib.sha256((WEB / nome).read_bytes()).hexdigest()[:10]
        corpo = corpo.replace(f'{attr}="{nome}"', f'{attr}="{nome}?v={impronta}"')
    # Stesso frammento, con le impronte, per l'artifact su claude.ai: senza, chi l'ha gia'
    # aperto continua a vedere il tool.css e il tool.js vecchi dalla cache del browser.
    (WEB / "artefatto.html").write_text(corpo, encoding="utf-8")
    (WEB / "index.html").write_text(
        "<!doctype html>\n<html lang=\"it\">\n<head>\n<meta charset=\"utf-8\">\n"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n"
        "</head>\n<body>\n" + corpo + "\n</body>\n</html>\n", encoding="utf-8")


def _infortuni() -> tuple[dict, dict, dict]:
    """Indisponibili di oggi e propensione, per fc_id, in forma compatta.

    inf: t tipo, m motivo, g giornata di rientro, d data di rientro, s giornate
         che salta, fs rientro dopo l'ultima giornata, f fonte.
    fr:  l livello (alta, media, bassa), n stop, mu muscolari, gr gravi, gg giorni
         e pp partite perse a stagione, e gli stop piu' recenti
         [stagione, testo, categoria, giorni, partite]. Assente per chi non ha
         una rosa Transfermarkt agganciata: "nessuno storico" non e' "sano".
    """
    from .model.infortuni import calendario_squadre, propensione, rientri
    from .model.pipeline import STAGIONE

    ind = tabella("SELECT * FROM indisponibili")
    anag = tabella("SELECT fc_id, squadra FROM giocatori WHERE nel_listone")
    partite = tabella("SELECT * FROM partite")
    ri = rientri(ind, anag.set_index("fc_id")["squadra"],
                 calendario_squadre(partite, STAGIONE)).set_index("fc_id")
    inf = {}
    for r in ind.itertuples(index=False):
        x = ri.loc[r.fc_id] if r.fc_id in ri.index else None
        data = None if x is None or x["data_rientro"] is None else str(x["data_rientro"])
        if data is None and r.rientro is not None and not pd.isna(r.rientro):
            data = str(pd.Timestamp(r.rientro).date())
        inf[int(r.fc_id)] = {
            "t": r.tipo, "m": r.motivo or "",
            "g": None if x is None or pd.isna(x["giornata_rientro"]) else int(x["giornata_rientro"]),
            "d": data,
            "s": 0 if x is None else int(x["giornate_perse"]),
            "fs": bool(x is not None and x["fine_stagione"]),
            "f": r.fonte,
        }

    storico = tabella("SELECT * FROM storico_infortuni")
    coperti = set(tabella(
        "SELECT DISTINCT fc_id FROM alias WHERE fonte = 'transfermarkt'")["fc_id"])
    prop = propensione(storico).set_index("fc_id")
    fr = {}
    for fc_id in coperti:
        if fc_id in prop.index:
            p = prop.loc[fc_id]
            fr[int(fc_id)] = {
                "l": p["livello"], "n": int(p["stop"]), "mu": int(p["muscolari"]),
                "gr": int(p["gravi"]), "gg": _r(p["giorni_stagione"], 0),
                "pp": _r(p["partite_stagione"], 1),
                "e": [[e["stagione"], e["testo"], e["categoria"], e["giorni"], e["partite"]]
                      for e in p["episodi"][:8]],
            }
        else:
            fr[int(fc_id)] = {"l": "bassa", "n": 0, "mu": 0, "gr": 0, "gg": 0, "pp": 0, "e": []}

    date = tabella("""SELECT
        (SELECT max(rilevato) FROM indisponibili WHERE fonte LIKE 'sosfanta%') sos,
        (SELECT max(rilevato) FROM indisponibili WHERE fonte = 'transfermarkt') tm,
        (SELECT max(rilevato) FROM storico_infortuni) st""").iloc[0]
    date_inf = {k: (None if pd.isna(v) else str(pd.Timestamp(v).date()))
                for k, v in (("sosfanta", date["sos"]), ("transfermarkt", date["tm"]),
                             ("storico", date["st"]))}
    return inf, fr, date_inf


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

    # Fascia della guida all'asta di SOS Fanta: indice nell'elenco ordinato
    # meta.fasce (0 = la migliore). Chi la guida mette fra gli infortunati non ha
    # un livello: se ne stima uno dal confronto con gli altri del ruolo (`fi`).
    # Chi la guida non cita resta senza.
    from .ingest.sosfanta import FASCIA_INFORTUNATI, ordina_fasce
    from .model.fasce import stima_fasce
    fasce = tabella("SELECT fc_id, fascia, rilevato FROM fasce")
    sos = dict(zip(fasce["fc_id"], fasce["fascia"]))
    stimate = stima_fasce(pd.DataFrame({
        "fc_id": df["fc_id"], "ruolo": df["ruolo"], "fascia": df["fc_id"].map(sos),
        "fvm": df["fvm1000"], "qi": df["qi"], "pg": df["punti_giornata"]}),
        FASCIA_INFORTUNATI)
    finale = {i: f for i, f in sos.items() if f != FASCIA_INFORTUNATI}
    finale.update(stimate)
    finale = {i: f for i, f in finale.items() if i in set(df["fc_id"])}
    etichette = ordina_fasce(finale.values())
    indice = {e: i for i, e in enumerate(etichette)}
    fascia_di = {i: indice[f] for i, f in finale.items()}
    fasce_data = None if fasce.empty else pd.Timestamp(fasce["rilevato"].max()).date().isoformat()

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

    inf, fr, date_inf = _infortuni()

    # Portieri e attaccanti partita per partita, allineati alle giornate che
    # restano: la base della griglia di alternanza nel tool.
    pgio = tabella("""
        SELECT p.fc_id, p.giornata, p.avversario, p.casa, p.punti, g.squadra
        FROM proiezioni_giornata p JOIN giocatori g USING (fc_id)
        WHERE p.versione = ?""", [versione])
    giornate = sorted(int(x) for x in pgio["giornata"].dropna().unique())
    pos = {gi: i for i, gi in enumerate(giornate)}
    pgg = {}
    for fc_id, g in pgio.groupby("fc_id"):
        riga = [None] * len(giornate)
        for x in g.itertuples():
            riga[pos[int(x.giornata)]] = _r(x.punti)
        pgg[fc_id] = riga
    calendario = {}
    for sq, g in pgio.drop_duplicates(["squadra", "giornata"]).groupby("squadra"):
        calendario[sq] = [[int(x.giornata), x.avversario, int(bool(x.casa))]
                          for x in g.sort_values("giornata").itertuples()]
    from .model.calendario import carica_fantalab
    fl = carica_fantalab()

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
            "fa": fascia_di.get(r["fc_id"]),
            **({"fi": 1} if r["fc_id"] in stimate else {}),
            "st": [] if s is None else [
                [x.stagione, x.squadra, int(x.presenze), _r(x.media), _r(x.fm), int(x.gol), int(x.assist)]
                for x in s.itertuples()],
            "ul": [] if u is None else [
                [int(x.giornata), None if x.sv else _r(x.fantavoto, 1)] for x in u.itertuples()],
            "inf": inf.get(int(r["fc_id"])),
            "fr": fr.get(int(r["fc_id"])),
            "pgs": _r(d.get("punti_giornata_sano")),
        })
        if r["fc_id"] in pgg:
            giocatori[-1]["pgg"] = pgg[r["fc_id"]]
        if r["ruolo"] == "A" and d.get("calendario_attacco") is not None:
            giocatori[-1]["cal"] = _r(d["calendario_attacco"], 3)

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
            "fasce": [e.capitalize() for e in etichette],
            "fasce_data": fasce_data,
            "infortuni": date_inf,
            # Giornate a cui si riferiscono i punti partita per partita (`pgg`).
            "giornate_cal": giornate,
        },
        "squadre": [{"slug": a, "nome": b} for a, b in squadre.itertuples(index=False)],
        # Partite che restano: squadra -> [giornata, avversario, 1 se in casa].
        "calendario": calendario,
        # Fascia di ogni avversario per chi lo affronta, dalla griglia di FantaLab.
        "fantalab": {
            "letto_il": fl.attrs.get("letto_il"),
            "P": dict(zip(fl["squadra"], fl["P"])),
            "A": dict(zip(fl["squadra"], fl["A"])),
        },
        "giocatori": giocatori,
    }
    WEB.mkdir(exist_ok=True)
    fp = WEB / "data.json"
    fp.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    pagina()
    if verbose:
        print(f"  fasce: {len(fascia_di)} giocatori, di cui {len(stimate)} stimate")
        print(f"  {fp.relative_to(ROOT)}: {len(giocatori)} giocatori, "
              f"{fp.stat().st_size / 1024:.0f} KB, versione {versione}")
    return out
