"""Infortuni nel modello: chi e' fermo adesso e chi si ferma spesso.

Due domande diverse, due risposte diverse.

**Chi e' fermo adesso** cambia i punti attesi. Un giocatore che salta le prossime
quattro giornate su 33 porta in media 4/33 di punti in meno: la probabilita' di
voto si moltiplica per la quota di giornate residue in cui c'e'. La giornata di
rientro viene da SosFanta; dove SosFanta non la scrive, dalla data di "probabile
ritorno" di Transfermarkt letta sul calendario del club. Le squalifiche valgono
una giornata (la fonte non dice quante), diffide e acciacchi nessuna.

**Chi si ferma spesso** invece resta un'etichetta e non tocca i punti: lo
storico delle presenze, che il modello gia' usa per la probabilita' di voto,
contiene gia' le partite saltate per infortunio. Scontarle una seconda volta
punirebbe due volte lo stesso fatto. Il giudizio serve a chi decide all'asta:
"fragile" dice che quella probabilita' di voto ha una coda lunga, non che e' piu'
bassa.

Le soglie della propensione sono scritte per essere lette, non stimate: la scheda
deve poter dire *perche'* uno e' fragile, con i numeri che l'hanno deciso.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

# --- chi e' fermo adesso ------------------------------------------------------------

GIORNATE_SQUALIFICA = 1


def calendario_squadre(partite: pd.DataFrame, stagione: str) -> pd.DataFrame:
    """Partite della stagione per squadra, con il numero di giornata.

    Understat non scrive la giornata: la k-esima partita di una squadra in ordine
    di data e' la sua k-esima giornata. Un recupero sposta la data, non il
    numero, ed e' l'approssimazione che serve qui.
    """
    p = partite[partite["stagione"] == stagione]
    lati = pd.concat([
        p[["data", "giocata"]].assign(squadra=p["casa"]),
        p[["data", "giocata"]].assign(squadra=p["trasferta"]),
    ], ignore_index=True)
    lati["data"] = pd.to_datetime(lati["data"])
    lati = lati.sort_values(["squadra", "data"])
    lati["giornata"] = lati.groupby("squadra").cumcount() + 1
    return lati.reset_index(drop=True)


def rientri(indisponibili: pd.DataFrame, squadra_di: pd.Series,
            calendario: pd.DataFrame) -> pd.DataFrame:
    """Per ogni indisponibile: giornata e data di rientro, giornate che salta.

    `squadra_di`: fc_id -> squadra attuale. Le giornate saltate si contano solo
    fra quelle ancora da giocare: "in dubbio per la 6a" a cinque giornate giocate
    vuol dire zero giornate perse, non sei.

    Colonne: fc_id, giornata_rientro, data_rientro, giornate_perse, fine_stagione.
    """
    righe = []
    for r in indisponibili.itertuples(index=False):
        cal = calendario[calendario["squadra"] == squadra_di.get(r.fc_id)]
        future = cal[~cal["giocata"]]
        ultima = int(cal["giornata"].max()) if len(cal) else 38

        g = None if pd.isna(r.giornata) else int(r.giornata)
        rientro = None if pd.isna(r.rientro) else pd.Timestamp(r.rientro)
        if r.tipo == "infortunato":
            if g is None and rientro is not None:
                dopo = cal[cal["data"].dt.normalize() >= rientro]
                g = int(dopo["giornata"].min()) if len(dopo) else ultima + 1
            if g is None:
                perse = 0                       # fermo, ma nessuno sa per quanto
            else:
                perse = int((future["giornata"] < g).sum())
        elif r.tipo == "squalificato":
            perse = min(GIORNATE_SQUALIFICA, len(future))
            g = int(future["giornata"].min()) + perse if len(future) else None
        else:
            perse, g = 0, None

        fine = g is not None and g > ultima
        data = None
        if g is not None and not fine:
            riga = cal[cal["giornata"] == g]
            data = riga["data"].iloc[0].date() if len(riga) else None
        righe.append({"fc_id": r.fc_id, "giornata_rientro": None if fine else g,
                      "data_rientro": data, "giornate_perse": perse, "fine_stagione": fine})
    return pd.DataFrame(righe, columns=["fc_id", "giornata_rientro", "data_rientro",
                                        "giornate_perse", "fine_stagione"])


def applica_rientri(pr: pd.DataFrame, perse: pd.DataFrame) -> pd.DataFrame:
    """Sconta le giornate che salta dalla probabilita' di voto e dai punti.

    `pr` e' l'uscita di `proietta`. La probabilita' di voto resta "a giornata",
    mediata sulle residue: chi ne salta 4 su 33 ha p_voto * 29/33. Si tiene anche
    quella da sano, perche' la scheda deve poter dire quanto vale quando torna.
    """
    out = pr.merge(perse[["fc_id", "giornate_perse"]], on="fc_id", how="left")
    out["giornate_perse"] = out["giornate_perse"].fillna(0).astype(int)
    n_res = out["giornate_residue"].astype(float)
    quota = np.where(n_res > 0, (n_res - out["giornate_perse"]).clip(lower=0) / n_res, 1.0)
    out["p_voto_sano"] = out["p_voto"]
    out["punti_giornata_sano"] = out["punti_giornata"]
    out["p_voto"] = out["p_voto"] * quota
    for c in ("punti_giornata", "punti_stagione", "punti_stagione_fv"):
        if c in out:
            out[c] = out[c] * quota
    return out


# --- chi si ferma spesso ----------------------------------------------------------

# Peso delle stagioni intere nella media: l'ultima piena, poi a scalare. La
# stagione in corso conta negli stop ma non nelle medie: e' a un quinto, e
# mediarla con le altre la sottostimerebbe.
PESI_STAGIONE = {"25/26": 1.0, "24/25": 0.75, "23/24": 0.5}

GIORNI_MINIMI = 10        # sotto, e senza partite perse, e' un acciacco
GIORNI_GRAVE = 90         # sopra, uno stop e' grave qualunque cosa dica il nome
TETTO_GIORNI = 365        # un solo stop non vale piu' di un anno

NON_CONTA = ("influenz", "malat", "febbre", "gastro", "infezion", "virus", "covid",
             "corona", "tonsill", "polmon", "intossic", "raffreddore", "quarantena",
             "ritardo di condizione", "riposo precauzionale", "motivi", "capitano")
GRAVE = ("crociato", "rottura", "frattura", "operazion", "menisco", "achille",
         "lacerazione", "artroscop", "intervento", "chirurg")
MUSCOLARE = ("muscol", "coscia", "femoral", "adduttor", "polpacc", "stiramento",
             "strappo", "contrattura", "affaticamento", "flessor", "quadricip", "gluteo",
             "sovraccarico", "inguin", "pubic", "pube", "pubalg", "ileopsoas", "fibre")


def categoria(testo: str) -> str:
    """muscolare | grave | altro | non conta.

    L'ordine conta: "rottura del bicipite femorale" e' grave prima che
    muscolare, perche' e' la gravita' a decidere quanto sta fuori.
    """
    t = (testo or "").lower()
    if any(k in t for k in NON_CONTA):
        return "non conta"
    if any(k in t for k in GRAVE):
        return "grave"
    if any(k in t for k in MUSCOLARE):
        return "muscolare"
    return "altro"


def _conta(r) -> bool:
    if categoria(r["testo"]) == "non conta":
        return False
    giorni = 0 if pd.isna(r["giorni"]) else r["giorni"]
    return giorni >= GIORNI_MINIMI or r["partite_perse"] >= 1


def livello(stop: int, muscolari: int, giorni_st: float, partite_st: float) -> str:
    """alta ("fragile") | media ("a rischio") | bassa.

    - alta: almeno tre stop e, a stagione, dieci partite perse o novanta giorni
      fuori (un quarto di campionato); oppure nove muscolari, la ricaduta
      cronica anche quando ogni stop e' breve.
    - media: due stop e, a stagione, cinque partite o 45 giorni; oppure quattro
      muscolari; oppure sei stop in tutto.

    Tarate sul listone 2026/27 perche' "fragile" resti raro (circa uno su
    sette) e "a rischio" uno su quattro: un flag che accende mezzo listone non
    flagga niente.
    """
    if (stop >= 3 and (partite_st >= 10 or giorni_st >= 90)) or muscolari >= 9:
        return "alta"
    if (stop >= 2 and (partite_st >= 5 or giorni_st >= 45)) or muscolari >= 4 or stop >= 6:
        return "media"
    return "bassa"


def propensione(storico: pd.DataFrame) -> pd.DataFrame:
    """Una riga per giocatore con storico: livello e le cifre che lo spiegano.

    Colonne: fc_id, livello, stop, muscolari, gravi, giorni_stagione,
    partite_stagione, episodi (lista di dict, dal piu' recente).
    """
    colonne = ["fc_id", "livello", "stop", "muscolari", "gravi", "giorni_stagione",
               "partite_stagione", "episodi"]
    if storico.empty:
        return pd.DataFrame(columns=colonne)
    s = storico.copy()
    s["categoria"] = s["testo"].map(categoria)
    s = s[s.apply(_conta, axis=1)]
    s["peso"] = s["stagione"].map(PESI_STAGIONE).fillna(0.0)
    s["g"] = s["giorni"].fillna(0).clip(upper=TETTO_GIORNI)
    tot_pesi = sum(PESI_STAGIONE.values())

    righe = []
    for fc_id in storico["fc_id"].unique():
        e = s[s["fc_id"] == fc_id].sort_values("dal", ascending=False, na_position="last")
        stop = len(e)
        mus = int((e["categoria"] == "muscolare").sum())
        gravi = int(((e["categoria"] == "grave") | (e["g"] >= GIORNI_GRAVE)).sum())
        gs = float((e["peso"] * e["g"]).sum() / tot_pesi)
        ps = float((e["peso"] * e["partite_perse"]).sum() / tot_pesi)
        righe.append({
            "fc_id": fc_id, "livello": livello(stop, mus, gs, ps), "stop": stop,
            "muscolari": mus, "gravi": gravi, "giorni_stagione": round(gs, 1),
            "partite_stagione": round(ps, 1),
            "episodi": [
                {"stagione": x.stagione, "testo": x.testo, "categoria": x.categoria,
                 "dal": None if pd.isna(x.dal) else x.dal,
                 "giorni": None if pd.isna(x.giorni) else int(x.giorni),
                 "partite": int(x.partite_perse)}
                for x in e.itertuples(index=False)],
        })
    return pd.DataFrame(righe, columns=colonne)

