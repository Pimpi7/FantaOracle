"""Calendario, difficolta' delle partite e alternanza fra portieri e attaccanti.

Ogni giornata schieri il portiere, e gli attaccanti, che hanno la partita piu'
comoda: e' l'idea della griglia di FantaLab, dove ogni avversario e' facile,
medio o difficile e si cercano le coppie di squadre che coprono a vicenda le
giornate dure. Qui quella griglia diventa punti.

La difficolta' di una partita mescola due giudizi sull'avversario:

    il modello      attacco e difesa da xG e gol pesati per recenza
                    (`projection.rating_squadre`), piu' il fattore campo
    FantaLab        la fascia dell'avversario, separata per i portieri (quanto
                    attacca) e per gli attaccanti (quanto difende), in
                    `data/ref/fantalab_difficolta.csv`

La fascia si traduce in un rating con il modello stesso: il livello di "difficile"
per i portieri e' l'attacco medio (geometrico) delle squadre che FantaLab mette
in quella fascia. Il rating usato per l'avversario e' la media geometrica fra il
suo rating e il livello della sua fascia, con peso `peso_fantalab`: il modello
resta l'ancora, FantaLab sposta chi giudica diversamente.

Per i portieri la partita cambia i gol subiti attesi e la probabilita' di porta
inviolata; per gli attaccanti moltiplica gol, assist e rigori attesi rispetto a
una partita contro un avversario medio. Voto, malus e presenze non cambiano.
La media sulle giornate che restano e' il Pt/g di stagione: la stessa
quantita' di prima, ora con il calendario dentro anche per gli attaccanti.

Il backtest non usa FantaLab: la classificazione esiste solo per quest'anno e
non c'e' una versione "alla 5a giornata" delle stagioni passate.
"""

from __future__ import annotations

import re

import numpy as np
import pandas as pd

from ..paths import REF

FASCE = ("facile", "media", "difficile")
# Peso di una partita nel voto FantaLab di un abbinamento (0-100): la loro
# griglia stampa 100 meno la media di questi pesi sulle giornate scelte.
PESO_FASCIA = {"facile": 0, "media": 50, "difficile": 100}
VANTAGGIO_CAMPO = 1.08


# --- tabelle di riferimento ----------------------------------------------------------

def carica_fantalab(percorso=None) -> pd.DataFrame:
    """La classificazione FantaLab: squadra, P, A. `attrs['letto_il']` e' la data."""
    fp = percorso or REF / "fantalab_difficolta.csv"
    testo = fp.read_text(encoding="utf-8")
    df = pd.read_csv(fp, comment="#")
    df["squadra"] = df["squadra"].str.strip()
    for r in ("P", "A"):
        df[r] = df[r].str.strip()
        sconosciute = set(df[r]) - set(FASCE)
        if sconosciute:
            raise ValueError(f"{fp.name}: fascia non valida in {r}: {sorted(sconosciute)}")
    if df["squadra"].duplicated().any():
        raise ValueError(f"{fp.name}: squadre ripetute")
    m = re.search(r"il (\d{4}-\d{2}-\d{2})", testo)
    df.attrs["letto_il"] = m.group(1) if m else None
    return df


def carica_calendario(stagione: str, percorso=None) -> pd.DataFrame | None:
    """Calendario ufficiale con il numero di giornata: giornata, casa, trasferta.

    Understat da' date e risultati ma non la giornata; il numero viene dal
    calendario di Fantacalcio.it, che non cambia quando una partita si sposta.
    """
    fp = percorso or REF / f"calendario_{stagione}.csv"
    if not fp.exists():
        return None
    return pd.read_csv(fp)


# --- forza degli avversari ---------------------------------------------------------

def livelli_fantalab(rating: pd.DataFrame, fantalab: pd.DataFrame) -> dict:
    """Il rating tipico di ogni fascia, misurato con il modello.

    Portieri: attacco medio delle squadre della fascia P. Attaccanti: difesa
    media delle squadre della fascia A (piu' bassa = difesa migliore). Medie
    geometriche, perche' i rating sono moltiplicativi.
    """
    r = rating.set_index("squadra")
    out = {}
    for ruolo, col in (("P", "attacco"), ("A", "difesa")):
        lv = {}
        for fascia in FASCE:
            sq = [s for s in fantalab.loc[fantalab[ruolo] == fascia, "squadra"] if s in r.index]
            if sq:
                lv[fascia] = float(np.exp(np.log(r.loc[sq, col]).mean()))
        # Fascia vuota: resta neutra invece di inventare un livello.
        for fascia in FASCE:
            lv.setdefault(fascia, 1.0)
        out[ruolo] = lv
    return out


def forza_avversari(rating: pd.DataFrame, fantalab: pd.DataFrame | None,
                    peso: float = 0.5) -> pd.DataFrame:
    """Attacco e difesa di ogni squadra visti da chi la affronta.

    Senza FantaLab (o con peso 0) sono i rating del modello. Con FantaLab sono la
    media geometrica pesata fra il rating e il livello della fascia.
    """
    out = rating[["squadra", "attacco", "difesa"]].copy().set_index("squadra")
    if fantalab is None or peso <= 0:
        return out.reset_index()
    lv = livelli_fantalab(rating, fantalab)
    fl = fantalab.set_index("squadra")
    for sq in out.index:
        if sq not in fl.index:
            continue
        out.at[sq, "attacco"] = out.at[sq, "attacco"] ** (1 - peso) * lv["P"][fl.at[sq, "P"]] ** peso
        out.at[sq, "difesa"] = out.at[sq, "difesa"] ** (1 - peso) * lv["A"][fl.at[sq, "A"]] ** peso
    return out.reset_index()


# --- le partite che restano -----------------------------------------------------------

def partite_residue(partite: pd.DataFrame, rating: pd.DataFrame, corrente: str,
                    dopo: pd.Timestamp, avversari: pd.DataFrame | None = None,
                    vantaggio: float = VANTAGGIO_CAMPO) -> pd.DataFrame:
    """Una riga per squadra e partita ancora da giocare.

    gs     gol subiti attesi: attacco dell'avversario (visto da chi lo affronta)
           per la difesa della squadra, con il fattore campo
    cs     probabilita' di porta inviolata, exp(-gs)
    gf     gol fatti attesi, con la difesa dell'avversario vista da chi lo affronta
    molt   quanto la partita moltiplica gol e assist di un attaccante rispetto a
           una partita contro un avversario medio su campo neutro (media 1 sulla
           stagione intera, a meno del fattore campo)
    """
    cols = ["squadra", "avversario", "casa", "giornata", "data", "gs", "cs", "gf", "molt"]
    res = partite[(partite["stagione"] == corrente) & (partite["data"] > dopo)]
    if res.empty:
        return pd.DataFrame(columns=cols)
    media = rating.attrs["media_gol"]
    r = rating.set_index("squadra")
    e = (avversari if avversari is not None else rating).set_index("squadra")
    # La difesa di un avversario medio: il moltiplicatore e' relativo a lei.
    dif_media = float(np.exp(np.log(e["difesa"]).mean()))
    campo = {True: vantaggio, False: 1 / vantaggio}
    righe = []
    for m in res.itertuples(index=False):
        if m.casa not in r.index or m.trasferta not in r.index:
            continue
        g = getattr(m, "giornata", None)
        for casa, sq, avv in ((True, m.casa, m.trasferta), (False, m.trasferta, m.casa)):
            # chi gioca in casa segna di piu' e subisce di meno
            gs = media / campo[casa] * e.at[avv, "attacco"] * r.at[sq, "difesa"]
            gf = media * campo[casa] * r.at[sq, "attacco"] * e.at[avv, "difesa"]
            righe.append({"squadra": sq, "avversario": avv, "casa": casa,
                          "giornata": None if g is None or pd.isna(g) else int(g),
                          "data": m.data, "gs": gs, "gf": gf,
                          "molt": campo[casa] * e.at[avv, "difesa"] / dif_media})
    out = pd.DataFrame(righe, columns=[c for c in cols if c != "cs"])
    out["cs"] = np.exp(-out["gs"])
    return out[cols]


def medie_squadra(fix: pd.DataFrame) -> pd.DataFrame:
    """Medie sulle partite residue per squadra: quello che serve al Pt/g di stagione."""
    return fix.groupby("squadra").agg(gol_subiti_attesi=("gs", "mean"),
                                      gol_fatti_attesi=("gf", "mean"),
                                      p_clean_sheet=("cs", "mean"),
                                      calendario_attacco=("molt", "mean"),
                                      partite_residue=("gs", "size"))


# --- punti per giornata -------------------------------------------------------------

def punti_per_giornata(pr: pd.DataFrame, fix: pd.DataFrame, correzione_fm: dict,
                       ruoli=("P", "A")) -> pd.DataFrame:
    """I punti attesi di ogni portiere e attaccante partita per partita.

    `pr` e' l'uscita di `proietta` (con p_voto, voto e bonus gia' calibrati),
    `fix` quella di `partite_residue`. La media per giocatore riproduce il suo
    `punti_giornata`: e' la stessa formula, con la partita al posto della media.
    """
    g = pr[pr["ruolo"].isin(ruoli)].merge(fix, on="squadra", how="inner")
    por = g["ruolo"] == "P"
    corr = g["ruolo"].map(correzione_fm).fillna(0)
    qm = g["quota_modificatore"].fillna(0)
    # Portiere: porta inviolata e gol subiti di quella partita.
    fm_p = (g["voto_atteso"] + g["cs"] + 3 * g["rigori_parati_attesi"]
            - g["gs"] - 0.5 * g["amm_attese"])
    # Attaccante: i bonus offensivi contro un avversario medio, per il moltiplicatore.
    fm_a = g["voto_atteso"] + g["molt"] * g["bonus_neutri"] - g["malus_attesi"]
    g["punti"] = g["p_voto"] * (np.where(por, fm_p, fm_a) + corr + qm)
    return g[["fc_id", "ruolo", "squadra", "giornata", "avversario", "casa", "punti"]]


# --- abbinamenti (stile FantaLab) -------------------------------------------------------

def voto_abbinamento(squadre: list[str], calendario: pd.DataFrame, fantalab: pd.DataFrame,
                     ruolo: str, da: int, a: int) -> dict:
    """Il voto FantaLab di un abbinamento sulle giornate `da..a`.

    Ogni giornata conta la fascia migliore fra le partite delle squadre scelte;
    il voto e' 100 meno la media dei pesi (facile 0, media 50, difficile 100).
    E' il numero che stampa la loro griglia, e serve a verificare che calendario
    e classificazione siano letti bene.
    """
    fascia = fantalab.set_index("squadra")[ruolo]
    conta = {f: 0 for f in FASCE}
    for gi in range(da, a + 1):
        cal = calendario[calendario["giornata"] == gi]
        migliore = None
        for sq in squadre:
            m = cal[(cal["casa"] == sq) | (cal["trasferta"] == sq)]
            if m.empty:
                continue
            avv = m["trasferta"].iat[0] if m["casa"].iat[0] == sq else m["casa"].iat[0]
            f = fascia.get(avv)
            if f is not None and (migliore is None or PESO_FASCIA[f] < PESO_FASCIA[migliore]):
                migliore = f
        if migliore is not None:
            conta[migliore] += 1
    n = sum(conta.values())
    peso = sum(PESO_FASCIA[f] * k for f, k in conta.items())
    return {**conta, "partite": n, "voto": round(100 - peso / n) if n else 0}
