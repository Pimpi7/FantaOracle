"""Matching dei giocatori fra fonti diverse.

Strategia, in ordine:

1. **Override manuali** — la tabella `data/ref/player_overrides.csv` vince
   sempre. Sono i casi che nessuna euristica risolve, decisi una volta a mano e
   versionati. Non vanno rigenerati a ogni run: sono un asset del progetto.

2. **Blocking per squadra** — confrontiamo un giocatore solo con i ~25 della sua
   squadra, non con i 600 del campionato. Riduce il costo e, soprattutto, taglia
   i falsi positivi fra omonimi di squadre diverse.

3. **Fuzzy score** su due chiavi (cognome e nome compatto), con premio o penalita'
   sull'iniziale del nome quando entrambe le fonti la espongono.

4. **Assegnazione uno-a-uno** dentro ogni blocco, con marcatura delle ambiguita'.

L'ultimo punto conta piu' di quanto sembri: un match a 91 non e' affidabile se il
secondo candidato sta a 90. Meglio dichiararlo ambiguo e chiedere una decisione
manuale che scrivere in silenzio la riga sbagliata.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd
from rapidfuzz import fuzz

from ..paths import REF
from .normalize import compact_key, nomi_compatibili, normalize_team, split_name

OVERRIDES_FILE = REF / "player_overrides.csv"

SOGLIA_ACCETTAZIONE = 86.0   # sotto questa non si accetta il match
MARGINE_AMBIGUITA = 6.0      # distanza minima dal secondo candidato


@dataclass
class MatchReport:
    matched: pd.DataFrame
    unmatched_left: pd.DataFrame
    ambiguous: pd.DataFrame
    stats: dict = field(default_factory=dict)

    def summary(self) -> str:
        s = self.stats
        return (
            f"match {s.get('n_matched', 0)}/{s.get('n_left', 0)} "
            f"({s.get('coverage', 0):.1%}) | "
            f"ambigui {len(self.ambiguous)} | "
            f"non risolti {len(self.unmatched_left)} | "
            f"override usati {s.get('n_override', 0)}"
        )


def load_overrides() -> pd.DataFrame:
    cols = ["fonte", "nome_fonte", "squadra_fonte", "nome_canonico", "squadra_canonica", "nota"]
    if not OVERRIDES_FILE.exists():
        return pd.DataFrame(columns=cols)
    df = pd.read_csv(OVERRIDES_FILE, dtype=str).fillna("")
    mancanti = set(cols) - set(df.columns)
    if mancanti:
        raise ValueError(f"player_overrides.csv: colonne mancanti {sorted(mancanti)}")
    return df


def _prepare(df: pd.DataFrame, col_nome: str, col_squadra: str) -> pd.DataFrame:
    out = df.copy()
    parti = out[col_nome].map(split_name)
    out["_cognome"] = parti.map(lambda t: t[0])
    out["_nome_proprio"] = parti.map(lambda t: t[1])
    out["_compact"] = out[col_nome].map(compact_key)
    out["_team"] = out[col_squadra].map(normalize_team)
    return out


def _score(l_cog: str, l_ini: str, l_comp: str,
           r_cog: str, r_ini: str, r_comp: str) -> float:
    """Punteggio 0-100 fra due giocatori gia' normalizzati."""
    s_cognome = fuzz.token_set_ratio(l_cog, r_cog)
    s_compact = fuzz.ratio(l_comp, r_comp)
    base = max(s_cognome, s_compact * 0.95)

    # Il nome proprio e' un discriminante forte, ma solo quando entrambe le fonti
    # lo espongono. Il confronto e' per prefisso, cosi' "Lorenzo" risulta
    # compatibile con l'abbreviazione "Lo." e incompatibile con "Lu.".
    compat = nomi_compatibili(l_ini, r_ini)
    if compat is True:
        base += 6.0
    elif compat is False:
        base -= 25.0

    return max(0.0, min(100.0, base))


def match_players(
    left: pd.DataFrame,
    right: pd.DataFrame,
    fonte_left: str,
    col_nome: str = "nome",
    col_squadra: str = "squadra",
    right_nome: str | None = None,
    right_squadra: str | None = None,
    soglia: float = SOGLIA_ACCETTAZIONE,
    usa_blocking: bool = True,
) -> MatchReport:
    """Allinea `left` a `right`. `right` e' la tabella canonica (di norma il listone)."""
    right_nome = right_nome or col_nome
    right_squadra = right_squadra or col_squadra

    L = _prepare(left, col_nome, col_squadra).reset_index(drop=True)
    R = _prepare(right, right_nome, right_squadra).reset_index(drop=True)

    ov = load_overrides()
    ov = ov[ov["fonte"] == fonte_left] if len(ov) else ov
    ov_map = {
        (r["nome_fonte"], normalize_team(r["squadra_fonte"])): (
            r["nome_canonico"], normalize_team(r["squadra_canonica"])
        )
        for _, r in ov.iterrows()
    }

    righe, ambigui, non_risolti = [], [], []
    n_override = 0
    usati_right: set[int] = set()

    blocchi = L.groupby("_team", sort=False) if usa_blocking else [("", L)]

    for team, gruppo in blocchi:
        cand = R[R["_team"] == team] if usa_blocking else R
        if cand.empty and usa_blocking:
            cand = R  # squadra sconosciuta: si ripiega sul confronto globale

        for _, riga in gruppo.iterrows():
            chiave_ov = (str(riga[col_nome]), riga["_team"])
            if chiave_ov in ov_map:
                nome_c, team_c = ov_map[chiave_ov]
                hit = R[(R["_compact"] == compact_key(nome_c)) & (R["_team"] == team_c)]
                if len(hit):
                    righe.append(_riga_match(riga, hit.iloc[0], 100.0, "override",
                                             col_nome, col_squadra, right_nome, right_squadra))
                    usati_right.add(int(hit.index[0]))
                    n_override += 1
                    continue

            punteggi = [
                (int(i), _score(riga["_cognome"], riga["_nome_proprio"], riga["_compact"],
                                c["_cognome"], c["_nome_proprio"], c["_compact"]))
                for i, c in cand.iterrows()
            ]
            punteggi = [p for p in punteggi if p[0] not in usati_right]
            if not punteggi:
                non_risolti.append(riga)
                continue

            punteggi.sort(key=lambda t: -t[1])
            best_i, best_s = punteggi[0]
            second_s = punteggi[1][1] if len(punteggi) > 1 else 0.0

            if best_s < soglia:
                non_risolti.append(riga)
            elif best_s - second_s < MARGINE_AMBIGUITA:
                r = riga.to_dict()
                r["_cand_1"] = R.loc[best_i, right_nome]
                r["_score_1"] = round(best_s, 1)
                r["_cand_2"] = R.loc[punteggi[1][0], right_nome]
                r["_score_2"] = round(second_s, 1)
                ambigui.append(r)
            else:
                righe.append(_riga_match(riga, R.loc[best_i], best_s, "fuzzy",
                                         col_nome, col_squadra, right_nome, right_squadra))
                usati_right.add(best_i)

    matched = pd.DataFrame(righe)
    n_left = len(L)
    return MatchReport(
        matched=matched,
        unmatched_left=pd.DataFrame(non_risolti).drop(
            columns=["_cognome", "_nome_proprio", "_compact"], errors="ignore"),
        ambiguous=pd.DataFrame(ambigui).drop(
            columns=["_cognome", "_nome_proprio", "_compact"], errors="ignore"),
        stats={
            "n_left": n_left,
            "n_matched": len(matched),
            "coverage": len(matched) / n_left if n_left else 0.0,
            "n_override": n_override,
        },
    )


def _riga_match(l, r, score, metodo, col_nome, col_squadra, right_nome, right_squadra) -> dict:
    return {
        "nome_fonte": l[col_nome],
        "squadra_fonte": l[col_squadra],
        "nome_canonico": r[right_nome],
        "squadra_canonica": r[right_squadra],
        "score": round(float(score), 1),
        "metodo": metodo,
    }


def suggerisci_override(report: MatchReport, fonte: str) -> pd.DataFrame:
    """Prepara le righe da incollare in player_overrides.csv.

    Output pensato per essere aperto, corretto a mano e appeso al file: i casi
    ambigui arrivano con i due candidati gia' in colonna, quelli non risolti con
    il campo canonico vuoto da riempire.
    """
    out = []
    for _, r in report.ambiguous.iterrows():
        out.append({
            "fonte": fonte,
            "nome_fonte": r.get("nome", ""),
            "squadra_fonte": r.get("squadra", ""),
            "nome_canonico": "",
            "squadra_canonica": r.get("squadra", ""),
            "nota": f"ambiguo: {r.get('_cand_1')} ({r.get('_score_1')}) "
                    f"vs {r.get('_cand_2')} ({r.get('_score_2')})",
        })
    for _, r in report.unmatched_left.iterrows():
        out.append({
            "fonte": fonte,
            "nome_fonte": r.get("nome", ""),
            "squadra_fonte": r.get("squadra", ""),
            "nome_canonico": "",
            "squadra_canonica": r.get("squadra", ""),
            "nota": "nessun candidato sopra soglia",
        })
    return pd.DataFrame(out)


