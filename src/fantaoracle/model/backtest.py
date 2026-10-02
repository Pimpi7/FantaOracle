"""Backtest: il punteggio batte le alternative ovvie?

Si congela una stagione passata alla giornata dell'asta (la 5a), si proiettano
le giornate restanti con i soli dati disponibili a quel punto, e si confronta con
i fantapunti realmente fatti. Le statistiche Understat della stagione congelata
vengono escluse, perche' sono aggregati a fine stagione e guarderebbero il futuro:
il modello e' quindi un po' svantaggiato rispetto alla proiezione vera.

Metrica: correlazione di rango (Spearman) per ruolo fra punti previsti e punti
fatti. All'asta conta l'ordinamento dentro il ruolo, non il valore assoluto.

Alternative confrontate:
  - "anno scorso":   fantapunti totali della stagione precedente
  - "stagione":      fantapunti delle prime giornate della stagione in corso
  - "fantamedia":    fantamedia pesata di stagione precedente e corrente,
                     moltiplicata per le presenze: e' come ragiona un
                     fantallenatore attento senza modello
"""

from __future__ import annotations

import pandas as pd

from ..db import tabella
from .projection import GIORNATE, Parametri, proietta


def _stagione_prec(s: str) -> str:
    a = int(s[:4]) - 1
    return f"{a}-{str(a + 1)[-2:]}"


def popolazione(voti: pd.DataFrame, stagione: str, giornata: int) -> pd.DataFrame:
    """Giocatori valutabili all'asta di quella stagione.

    Chi era in rosa nelle prime giornate, piu' chi c'era l'anno prima ed e'
    rimasto in Serie A. Squadra e ruolo sono quelli noti alla giornata dell'asta.
    """
    corr = voti[voti["stagione"] == stagione]
    prime = corr[corr["giornata"] <= giornata]
    prec = voti[voti["stagione"] == _stagione_prec(stagione)]
    ids = set(prime["fc_id"]) | (set(prec["fc_id"]) & set(corr["fc_id"]))

    noto = pd.concat([prec, prime]).sort_values(["stagione", "giornata"])
    ultimo = noto.groupby("fc_id").tail(1).set_index("fc_id")
    ruolo = corr.groupby("fc_id")["ruolo"].agg(lambda s: s.mode().iat[0])
    out = pd.DataFrame({"fc_id": sorted(ids)})
    out["squadra"] = out["fc_id"].map(ultimo["squadra"])
    # Chi non compare prima dell'asta: prima squadra in cui compare.
    primo = corr.sort_values("giornata").groupby("fc_id")["squadra"].first()
    out["squadra"] = out["squadra"].fillna(out["fc_id"].map(primo))
    out["ruolo"] = out["fc_id"].map(ruolo)
    out["nome"] = out["fc_id"].astype(str)
    return out.dropna(subset=["ruolo", "squadra"])


def esegui(stagione: str, giornata: int = 5, p: Parametri | None = None,
           dati: dict | None = None) -> dict:
    d = dati or {
        "voti": tabella("SELECT * FROM voti"),
        "stat": tabella("SELECT * FROM stat_avanzate"),
        "partite": tabella("SELECT * FROM partite"),
    }
    voti = d["voti"]
    pop = popolazione(voti, stagione, giornata)
    pr = proietta(voti, d["stat"], d["partite"], pop, stagione, giornata,
                  usa_stat_correnti=False, p=p)

    fv = voti[~voti["sv"]].copy()
    corr = fv[fv["stagione"] == stagione]
    reale = corr[corr["giornata"] > giornata].groupby("fc_id")["fantavoto"].sum()
    prime = corr[corr["giornata"] <= giornata]
    prec = fv[fv["stagione"] == _stagione_prec(stagione)]

    t = pr[["fc_id", "ruolo", "punti_stagione_fv"]].copy()
    t["reale"] = t["fc_id"].map(reale).fillna(0)
    t["anno_scorso"] = t["fc_id"].map(prec.groupby("fc_id")["fantavoto"].sum()).fillna(0)
    t["stagione_in_corso"] = t["fc_id"].map(prime.groupby("fc_id")["fantavoto"].sum()).fillna(0)

    # Fantamedia pesata x presenze: la baseline "da fantallenatore attento".
    fm_prec = prec.groupby("fc_id")["fantavoto"].mean()
    n_prec = prec.groupby("fc_id").size()
    fm_corr = prime.groupby("fc_id")["fantavoto"].mean()
    n_corr = prime.groupby("fc_id").size()
    w_prec = t["fc_id"].map(n_prec).fillna(0) * 0.35
    w_corr = t["fc_id"].map(n_corr).fillna(0)
    fm = ((t["fc_id"].map(fm_prec).fillna(0) * w_prec + t["fc_id"].map(fm_corr).fillna(0) * w_corr)
          / (w_prec + w_corr).replace(0, 1))
    pres = (t["fc_id"].map(n_prec).fillna(0) / GIORNATE * 0.5
            + t["fc_id"].map(n_corr).fillna(0) / giornata * 0.5)
    t["fantamedia"] = fm * pres

    metodi = ["punti_stagione_fv", "fantamedia", "anno_scorso", "stagione_in_corso"]
    righe = []
    for ruolo, g in t.groupby("ruolo"):
        riga = {"ruolo": ruolo, "n": len(g)}
        for m in metodi:
            riga[m] = g[m].corr(g["reale"], method="spearman")
        # Qualita' della cima: media dei punti reali dei primi N previsti.
        n_top = {"P": 10, "D": 30, "C": 30, "A": 20}[ruolo]
        for m in metodi:
            riga[f"top_{m}"] = g.nlargest(n_top, m)["reale"].mean()
        righe.append(riga)

    res = pd.DataFrame(righe).set_index("ruolo")
    return {"stagione": stagione, "giornata": giornata, "per_ruolo": res,
            "dettaglio": t}


def _con_giornate(partite: pd.DataFrame, stagione: str) -> pd.DataFrame:
    """Le partite di una stagione passata con il numero di giornata.

    Il calendario ufficiale c'e' solo per quest'anno: per le stagioni passate la
    giornata e' l'ordine della partita fra quelle della squadra, per data. Se le
    due squadre non sono d'accordo (un recupero) la partita resta senza giornata
    ed esce dal confronto.
    """
    s = partite[partite["stagione"] == stagione].drop(columns="giornata", errors="ignore")
    lunga = pd.concat([s.assign(sq=s["casa"]), s.assign(sq=s["trasferta"])])
    lunga["k"] = lunga.groupby("sq")["data"].rank(method="first").astype(int)
    k = lunga.groupby(["casa", "trasferta"])["k"].agg(["min", "max"])
    k = k[k["min"] == k["max"]]["min"].rename("giornata").reset_index()
    altre = partite[partite["stagione"] != stagione]
    return pd.concat([altre, s.merge(k, on=["casa", "trasferta"], how="left")], ignore_index=True)


def alternanza(stagione: str, giornata: int = 5, p: Parametri | None = None,
               dati: dict | None = None, primi: dict | None = None) -> pd.DataFrame:
    """La scelta partita per partita serve davvero? Il test della griglia.

    Si congela la stagione alla giornata dell'asta e si stimano i punti di ogni
    portiere e attaccante partita per partita, con il solo modello (FantaLab non
    ha una classificazione storica). Poi, per ruolo:

    - correlazione dentro il giocatore: nelle partite in cui ha preso voto, il
      fantavoto e' piu' alto proprio dove il modello se lo aspettava? (scarti
      dalla media del giocatore, previsti contro reali)
    - coppie: per ogni coppia di titolari di squadre diverse, schierare ogni
      giornata quello con la partita migliore contro schierare sempre quello col
      Pt/g piu' alto. Si contano le giornate in cui hanno preso voto entrambi.
    """
    from .calendario import punti_per_giornata

    p = p or Parametri()
    primi = primi or {"P": 20, "A": 40}
    d = dati or {
        "voti": tabella("SELECT * FROM voti"),
        "stat": tabella("SELECT * FROM stat_avanzate"),
        "partite": tabella("SELECT * FROM partite"),
    }
    voti = d["voti"]
    partite = _con_giornate(d["partite"], stagione)
    pop = popolazione(voti, stagione, giornata)
    pr, _, fix = proietta(voti, d["stat"], partite, pop, stagione, giornata,
                          usa_stat_correnti=False, p=p, con_partite=True)
    pg = punti_per_giornata(pr, fix.dropna(subset=["giornata"]), p.correzione_fm)

    reali = voti[(voti["stagione"] == stagione) & (voti["giornata"] > giornata) & ~voti["sv"]]
    pg = pg.merge(reali[["fc_id", "giornata", "squadra", "fantavoto"]],
                  on=["fc_id", "giornata", "squadra"], how="left")
    stagione_pg = pr.set_index("fc_id")["punti_giornata"]

    righe = []
    for ruolo, g in pg.groupby("ruolo"):
        giocate = g.dropna(subset=["fantavoto"])
        n = giocate.groupby("fc_id")["fantavoto"].transform("size")
        giocate = giocate[n >= 10]
        dp = giocate["punti"] - giocate.groupby("fc_id")["punti"].transform("mean")
        dr = giocate["fantavoto"] - giocate.groupby("fc_id")["fantavoto"].transform("mean")

        # Coppie di titolari: i primi del ruolo per Pt/g di stagione.
        ids = stagione_pg[stagione_pg.index.isin(g["fc_id"])].nlargest(primi[ruolo]).index
        tab = giocate[giocate["fc_id"].isin(ids)].pivot_table(
            index="giornata", columns="fc_id", values=["punti", "fantavoto"])
        squadra = g.drop_duplicates("fc_id").set_index("fc_id")["squadra"]
        guadagni, sui_cambi = [], []
        ids = [i for i in ids if ("punti", i) in tab.columns]
        for a_i, a in enumerate(ids):
            for b in ids[a_i + 1:]:
                if squadra[a] == squadra[b]:
                    continue
                fisso, altro = (a, b) if stagione_pg[a] >= stagione_pg[b] else (b, a)
                t = tab[[("punti", fisso), ("punti", altro), ("fantavoto", fisso), ("fantavoto", altro)]].dropna()
                if t.empty:
                    continue
                scegli_altro = t[("punti", altro)] > t[("punti", fisso)]
                scelto = t[("fantavoto", altro)].where(scegli_altro, t[("fantavoto", fisso)])
                guadagno = scelto - t[("fantavoto", fisso)]
                guadagni.append(guadagno.values)
                sui_cambi.append(guadagno[scegli_altro].values)
        tutti = pd.Series([x for v in guadagni for x in v], dtype=float)
        cambiate = pd.Series([x for v in sui_cambi for x in v], dtype=float)
        righe.append({
            "stagione": stagione, "ruolo": ruolo,
            "partite": len(giocate),
            "corr_dentro_giocatore": float(dp.corr(dr)),
            # Pendenza: un punto previsto in piu' quanti ne porta davvero.
            "pendenza": float((dp * dr).sum() / (dp * dp).sum()),
            "coppie_giornate": len(tutti),
            "quota_cambi": len(cambiate) / max(len(tutti), 1),
            "guadagno_per_giornata": float(tutti.mean()) if len(tutti) else float("nan"),
            "guadagno_per_cambio": float(cambiate.mean()) if len(cambiate) else float("nan"),
        })
    return pd.DataFrame(righe)


def report(stagioni=("2024-25", "2025-26"), giornata: int = 5) -> pd.DataFrame:
    dati = {
        "voti": tabella("SELECT * FROM voti"),
        "stat": tabella("SELECT * FROM stat_avanzate"),
        "partite": tabella("SELECT * FROM partite"),
    }
    out = []
    for s in stagioni:
        r = esegui(s, giornata, dati=dati)["per_ruolo"]
        r.insert(0, "stagione", s)
        out.append(r.reset_index())
    return pd.concat(out, ignore_index=True)
