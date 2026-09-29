"""Proiezione dei punti attesi per le giornate che restano.

Per ogni giocatore:

    punti_giornata = p_voto x (fantavoto atteso quando gioca)

con il fantavoto atteso scomposto in pezzi che si stimano ciascuno dalla fonte
piu' adatta:

    voto atteso      media dei voti con peso decrescente per le stagioni
                     vecchie, tirata verso la media di ruolo (shrinkage)
    gol attesi       tasso per 90' da npxG (Understat) mescolato ai gol reali,
                     tirato verso la media di ruolo in proporzione ai minuti
    rigori           quota dei rigori della squadra calciati dal giocatore,
                     solo per le stagioni passate nella squadra attuale
    assist attesi    assist Fantacalcio.it reali mescolati a xA ricalibrato
    malus attesi     ammonizioni, espulsioni, autogol (tassi con shrinkage)
    portieri         gol subiti e imbattibilita' dal rating difensivo della
                     squadra sulle partite che restano

Le penalizzazioni di shrinkage sono il cuore del modello: 5 giornate di stagione
corrente sono poche, e senza shrinkage chi ha segnato 3 gol in 5 partite
risulterebbe un fenomeno. Con lo shrinkage il dato corrente pesa tanto quanto la
sua affidabilita'.

La funzione e' "point in time": riceve i dati fino a una giornata e guarda solo
quelli. Lo stesso codice fa la proiezione vera e il backtest sulle stagioni
passate.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

GIORNATE = 38
RUOLI = ["P", "D", "C", "A"]


@dataclass
class Parametri:
    # Peso di una partita in funzione di quante stagioni fa e' stata giocata.
    decadimento: dict = field(default_factory=lambda: {0: 1.0, 1: 0.5, 2: 0.25, 3: 0.12})
    k_voto: float = 10.0            # partite equivalenti di prior sul voto
    k_presenze: float = 6.0         # giornate equivalenti dello storico su p_voto
    # Quanto si crede allo storico di presenze di chi ha cambiato squadra
    # (1 = come se fosse rimasto, 0 = si riparte dalla media del ruolo).
    peso_se_cambia_squadra: float = 0.5
    k_minuti: float = 450.0         # minuti equivalenti di prior sui tassi per 90' (backtest)
    quota_xg: float = 0.5           # peso di npxG rispetto ai gol reali (backtest)
    k_malus: float = 15.0
    conversione_rigori: float = 0.78
    minuti_titolare: float = 82.0
    minuti_subentrato: float = 22.0
    # Contributo al modificatore difesa di un punto di voto in piu' (P e D):
    # ~0.9 punti per la derivata della tabella intorno a 6.2, per 0.8 di
    # probabilita' di schierare la difesa a 4 o 5.
    pendenza_modificatore: float = 0.72


def _stagioni_indietro(stagione: str, corrente: str) -> int:
    return int(corrente[:4]) - int(stagione[:4])


# --- rating delle squadre --------------------------------------------------------

def rating_squadre(partite: pd.DataFrame, fino_a: pd.Timestamp, corrente: str,
                   squadre_correnti: list[str], p: Parametri) -> pd.DataFrame:
    """Attacco e difesa relativi alla media, da xG e gol, pesati per recenza.

    Le neopromosse senza storico in Serie A partono da un prior pessimista
    (attacco 0.85, difesa 1.15) che le partite giocate correggono.
    """
    g = partite[(partite["giocata"]) & (partite["data"] <= fino_a)].copy()
    g["w"] = g["stagione"].map(lambda s: p.decadimento.get(_stagioni_indietro(s, corrente), 0.05))

    casa = pd.DataFrame({"squadra": g["casa"], "fatti": 0.7 * g["xg_casa"] + 0.3 * g["gol_casa"],
                         "subiti": 0.7 * g["xg_trasferta"] + 0.3 * g["gol_trasferta"],
                         "w": g["w"], "stagione": g["stagione"]})
    tras = pd.DataFrame({"squadra": g["trasferta"], "fatti": 0.7 * g["xg_trasferta"] + 0.3 * g["gol_trasferta"],
                         "subiti": 0.7 * g["xg_casa"] + 0.3 * g["gol_casa"],
                         "w": g["w"], "stagione": g["stagione"]})
    t = pd.concat([casa, tras])
    media = np.average(t["fatti"], weights=t["w"])

    agg = t.groupby("squadra").apply(lambda d: pd.Series({
        "fatti": np.average(d["fatti"], weights=d["w"]),
        "subiti": np.average(d["subiti"], weights=d["w"]),
        "peso": d["w"].sum(),
        "ha_storico": (d["stagione"] != corrente).any(),
    }), include_groups=False)

    righe = []
    for sq in squadre_correnti:
        if sq in agg.index:
            r = agg.loc[sq]
            prior_att, prior_dif = (1.0, 1.0) if r["ha_storico"] else (0.85, 1.15)
            k = 8.0
            att = (k * prior_att + r["peso"] * r["fatti"] / media) / (k + r["peso"])
            dif = (k * prior_dif + r["peso"] * r["subiti"] / media) / (k + r["peso"])
        else:
            att, dif = 0.85, 1.15
        righe.append({"squadra": sq, "attacco": att, "difesa": dif})
    out = pd.DataFrame(righe)
    out.attrs["media_gol"] = media
    return out


def attese_calendario(partite: pd.DataFrame, rating: pd.DataFrame, corrente: str,
                      dopo: pd.Timestamp) -> pd.DataFrame:
    """Gol subiti attesi e probabilita' di clean sheet medi sulle partite residue."""
    res = partite[(partite["stagione"] == corrente) & (partite["data"] > dopo)]
    media = rating.attrs["media_gol"]
    r = rating.set_index("squadra")
    vantaggio = 1.08                                # fattore campo

    righe = []
    for _, m in res.iterrows():
        if m["casa"] not in r.index or m["trasferta"] not in r.index:
            continue
        lam_c = media * vantaggio * r.at[m["casa"], "attacco"] * r.at[m["trasferta"], "difesa"]
        lam_t = media / vantaggio * r.at[m["trasferta"], "attacco"] * r.at[m["casa"], "difesa"]
        righe += [{"squadra": m["casa"], "gs": lam_t, "gf": lam_c},
                  {"squadra": m["trasferta"], "gs": lam_c, "gf": lam_t}]
    c = pd.DataFrame(righe)
    c["cs"] = np.exp(-c["gs"])
    out = c.groupby("squadra").agg(gol_subiti_attesi=("gs", "mean"),
                                   gol_fatti_attesi=("gf", "mean"),
                                   p_clean_sheet=("cs", "mean"),
                                   partite_residue=("gs", "size")).reset_index()
    return out


# --- proiezione per giocatore ------------------------------------------------------

def _tasso(num, den, prior, k):
    """Tasso con shrinkage: (k*prior + num) / (k + den)."""
    return (k * prior + num) / (k + den)


def proietta(voti: pd.DataFrame, stat: pd.DataFrame, partite: pd.DataFrame,
             anagrafica: pd.DataFrame, corrente: str, giornata: int,
             usa_stat_correnti: bool = True, p: Parametri | None = None,
             con_rating: bool = False):
    """Proiezione per i giocatori di `anagrafica` (fc_id, nome, squadra, ruolo).

    Usa solo i voti fino a (`corrente`, `giornata`). Con usa_stat_correnti=False
    ignora le statistiche Understat della stagione corrente, che sono aggregati a
    fine periodo e nel backtest guarderebbero il futuro.

    Con con_rating=True restituisce anche il rating delle squadre usato per il
    calendario residuo.
    """
    p = p or Parametri()

    v = voti[(voti["stagione"] < corrente) |
             ((voti["stagione"] == corrente) & (voti["giornata"] <= giornata))].copy()
    v["d"] = v["stagione"].map(lambda s: _stagioni_indietro(s, corrente))
    v = v[v["d"] <= 3]
    v["w"] = v["d"].map(p.decadimento)
    v["gioca"] = ~v["sv"] & v["voto"].notna()
    v["tit"] = v["gioca"] & ~v["subentrato"]
    v["min_est"] = np.where(v["tit"], p.minuti_titolare,
                            np.where(v["gioca"], p.minuti_subentrato, 0.0))

    anag = anagrafica.set_index("fc_id")
    squadra_attuale = anag["squadra"]

    # --- presenze: p_voto ---------------------------------------------------
    # Il prior di ogni giocatore e' il SUO storico di presenze nelle stagioni
    # precedenti, non la media del ruolo: la media del ruolo comprende tutte le
    # riserve e schiaccerebbe verso il basso i titolari fissi. Chi ha cambiato
    # squadra ha uno storico meno affidabile e viene avvicinato alla media del
    # ruolo. Le giornate della stagione in corso aggiornano il prior con peso
    # pari a `k_presenze` giornate equivalenti.
    base = pd.DataFrame(index=anag.index)
    base["ruolo"] = anag["ruolo"]
    base["squadra"] = squadra_attuale
    base["v_cur"] = (v[v["d"] == 0].groupby("fc_id")["gioca"].sum()
                     .reindex(base.index).fillna(0))

    storico = v[v["d"] >= 1]
    quote_st = (storico.groupby(["fc_id", "d"])["gioca"].sum() / GIORNATE).rename("q").reset_index()
    quote_st["w"] = quote_st["d"].map({1: 1.0, 2: 0.5, 3: 0.25})
    m_pers = (quote_st.assign(x=quote_st["q"] * quote_st["w"]).groupby("fc_id")["x"].sum()
              / quote_st.groupby("fc_id")["w"].sum())
    peso_pers = quote_st.groupby("fc_id")["w"].sum()

    prec_squadra = v[v["d"] == 1].sort_values("giornata").groupby("fc_id")["squadra"].last()
    stessa = prec_squadra.reindex(base.index) == base["squadra"]

    # Media di ruolo fra chi era in Serie A l'anno scorso.
    m_ruolo = (m_pers.reindex(base.index).groupby(base["ruolo"]).mean()).fillna(0.35)
    base["m_ruolo"] = base["ruolo"].map(m_ruolo)
    fiducia = (peso_pers.reindex(base.index).fillna(0) / 1.75).clip(0, 1) \
        * np.where(stessa, 1.0, p.peso_se_cambia_squadra)
    base["m0"] = fiducia * m_pers.reindex(base.index).fillna(0) + (1 - fiducia) * base["m_ruolo"]
    base["p_voto"] = (p.k_presenze * base["m0"] + base["v_cur"]) / (p.k_presenze + giornata)

    # --- aggregati pesati sulle partite giocate -------------------------------
    gv = v[v["gioca"]].copy()
    for c in ["voto", "gol", "assist", "ammonizione", "espulsione", "autogol",
              "rigori_parati", "min_est", "tit"]:
        gv[f"w_{c}"] = gv["w"] * gv[c].astype(float)
    agg = gv.groupby("fc_id").agg(
        n=("w", "sum"), n_raw=("w", "size"),
        voto=("w_voto", "sum"), gol=("w_gol", "sum"), assist=("w_assist", "sum"),
        amm=("w_ammonizione", "sum"), esp=("w_espulsione", "sum"),
        autogol=("w_autogol", "sum"), rp=("w_rigori_parati", "sum"),
        minuti=("w_min_est", "sum"), tit=("w_tit", "sum"),
    ).reindex(base.index).fillna(0)

    ruolo = base["ruolo"]
    tot = agg.join(ruolo).groupby("ruolo").sum()

    def prior_ruolo(col, den="n"):
        return ruolo.map(tot[col] / tot[den])

    # Voto atteso
    base["voto_atteso"] = _tasso(agg["voto"], agg["n"], prior_ruolo("voto"), p.k_voto)

    # Minuti per presenza (da quota di partite da titolare)
    quota_tit = _tasso(agg["tit"], agg["n"], prior_ruolo("tit"), 4.0)
    base["quota_titolare"] = quota_tit
    base["minuti_presenza"] = quota_tit * p.minuti_titolare + (1 - quota_tit) * p.minuti_subentrato

    # --- statistiche avanzate --------------------------------------------------
    s = stat.copy()
    s["d"] = s["stagione"].map(lambda x: _stagioni_indietro(x, corrente))
    s = s[(s["d"] >= (0 if usa_stat_correnti else 1)) & (s["d"] <= 3)]
    s["w"] = s["d"].map(p.decadimento)
    for c in ["minuti", "npxg", "xa", "rigori_stimati"]:
        s[f"w_{c}"] = s["w"] * s[c]
    sa = s.groupby("fc_id")[["w_minuti", "w_npxg", "w_xa"]].sum().reindex(base.index).fillna(0)

    r_gol_ruolo = ruolo.map(tot["gol"] / tot["minuti"] * 90)
    r_ass_ruolo = ruolo.map(tot["assist"] / tot["minuti"] * 90)

    # Gol: npxG per 90 mescolato ai gol reali (solo non su rigore: nei voti
    # Fantacalcio.it i rigori segnati sono contati a parte).
    r_gol_reale = np.where(agg["minuti"] > 0, agg["gol"] / agg["minuti"].replace(0, np.nan) * 90, 0)
    r_xg = np.where(sa["w_minuti"] > 0, sa["w_npxg"] / sa["w_minuti"].replace(0, np.nan) * 90, np.nan)
    r_mix = np.where(np.isnan(r_xg), r_gol_reale, p.quota_xg * r_xg + (1 - p.quota_xg) * r_gol_reale)
    base["gol90"] = _tasso(r_mix * agg["minuti"], agg["minuti"], r_gol_ruolo, p.k_minuti)

    # Assist: calibrazione di xA sugli assist Fantacalcio.it (redazionali, piu'
    # generosi degli assist statistici).
    cal = float(np.clip(agg["assist"].sum() / max(sa["w_xa"].sum(), 1e-9), 0.6, 2.0))
    r_ass_reale = np.where(agg["minuti"] > 0, agg["assist"] / agg["minuti"].replace(0, np.nan) * 90, 0)
    r_xa = np.where(sa["w_minuti"] > 0, cal * sa["w_xa"] / sa["w_minuti"].replace(0, np.nan) * 90, np.nan)
    r_amix = np.where(np.isnan(r_xa), r_ass_reale, 0.5 * r_xa + 0.5 * r_ass_reale)
    base["assist90"] = _tasso(r_amix * agg["minuti"], agg["minuti"], r_ass_ruolo, p.k_minuti)

    fattore_min = base["minuti_presenza"] / 90
    base["gol_attesi"] = base["gol90"] * fattore_min
    base["assist_attesi"] = base["assist90"] * fattore_min

    # --- rigori ---------------------------------------------------------------
    # Quota dei rigori della squadra calciati dal giocatore, contando solo le
    # stagioni in cui era nella squadra attuale.
    rv = v.copy()
    rv["rig"] = rv["rigori_segnati"] + rv["rigori_sbagliati"]
    rv["peso_r"] = rv["d"].map({0: 2.0, 1: 1.0, 2: 0.4, 3: 0.2})
    rv = rv[rv["squadra"] == rv["fc_id"].map(squadra_attuale)]
    pers = (rv["rig"] * rv["peso_r"]).groupby(rv["fc_id"]).sum()
    tot_sq = (rv.drop_duplicates(["fc_id", "stagione", "giornata"])
                .assign(x=lambda d: d["rig"] * d["peso_r"])
                .groupby("squadra")["x"].sum())
    quota_rig = (pers.reindex(base.index).fillna(0)
                 / (base["squadra"].map(tot_sq).fillna(0) + 1.5))   # +1.5: prior contro i casi singoli
    base["quota_rigori"] = quota_rig.clip(0, 1)
    rig_partita = v.groupby(["stagione", "giornata"])["rigori_segnati"].sum().sum() + \
        v.groupby(["stagione", "giornata"])["rigori_sbagliati"].sum().sum()
    partite_squadra = v.drop_duplicates(["stagione", "giornata", "squadra"]).shape[0]
    tasso_rig_squadra = rig_partita / max(partite_squadra, 1)
    base["rigori_attesi"] = base["quota_rigori"] * tasso_rig_squadra * np.clip(fattore_min * 1.1, 0, 1)
    valore_rigore = 3 * p.conversione_rigori - 3 * (1 - p.conversione_rigori)

    # --- malus ------------------------------------------------------------------
    base["amm_attese"] = _tasso(agg["amm"], agg["n"], prior_ruolo("amm"), p.k_malus)
    base["esp_attese"] = _tasso(agg["esp"], agg["n"], prior_ruolo("esp"), p.k_malus * 3)
    base["autogol_attesi"] = prior_ruolo("autogol")

    # --- composizione ------------------------------------------------------------
    base["bonus_attesi"] = (3 * base["gol_attesi"] + base["assist_attesi"]
                            + valore_rigore * base["rigori_attesi"])
    base["malus_attesi"] = (0.5 * base["amm_attese"] + base["esp_attese"]
                            + 2 * base["autogol_attesi"])

    # Portieri: gol subiti e imbattibilita' dal calendario residuo.
    partite_ok = partite.copy()
    fino_a = _data_fine_giornata(partite_ok, corrente, giornata)
    rating = rating_squadre(partite_ok, fino_a, corrente, sorted(base["squadra"].dropna().unique()), p)
    cal_sq = attese_calendario(partite_ok, rating, corrente, fino_a).set_index("squadra")
    base = base.join(cal_sq, on="squadra")

    por = base["ruolo"] == "P"
    base["rigori_parati_attesi"] = np.where(por, _tasso(agg["rp"], agg["n"], prior_ruolo("rp"), 30.0), 0.0)
    base.loc[por, "bonus_attesi"] = (base.loc[por, "p_clean_sheet"]
                                     + 3 * base.loc[por, "rigori_parati_attesi"])
    base.loc[por, "malus_attesi"] = (base.loc[por, "gol_subiti_attesi"]
                                     + 0.5 * base.loc[por, "amm_attese"])

    base["fm_attesa"] = base["voto_atteso"] + base["bonus_attesi"] - base["malus_attesi"]
    difesa = base["ruolo"].isin(["P", "D"])
    base["quota_modificatore"] = np.where(
        difesa, p.pendenza_modificatore * (base["voto_atteso"] - 6.0), 0.0)

    n_res = base["partite_residue"].fillna(GIORNATE - giornata)
    base["giornate_residue"] = n_res
    base["punti_giornata"] = base["p_voto"] * (base["fm_attesa"] + base["quota_modificatore"])
    base["punti_stagione"] = base["punti_giornata"] * n_res
    # Senza modificatore: e' la quantita' confrontabile con i fantavoti reali.
    base["punti_stagione_fv"] = base["p_voto"] * base["fm_attesa"] * n_res
    base["partite_osservate"] = agg["n_raw"]

    out = base.reset_index()
    return (out, rating) if con_rating else out


def _data_fine_giornata(partite: pd.DataFrame, stagione: str, giornata: int) -> pd.Timestamp:
    """Data dell'ultima partita della giornata `giornata` (10 partite a giornata)."""
    s = partite[partite["stagione"] == stagione].sort_values("data")
    n = giornata * 10
    if n <= 0:
        return s["data"].min() - pd.Timedelta(days=1)
    return s["data"].iloc[min(n, len(s)) - 1]
