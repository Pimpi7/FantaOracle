"""Il database: un unico file DuckDB, ricostruito dagli snapshot grezzi.

Principi:

- **Ricostruibile.** Nessun dato vive solo qui: tutto viene dagli snapshot in
  `data/raw`. Cancellare il file e rilanciare `build()` riproduce lo stesso stato.
  Le uniche eccezioni sono le tabelle di stato della lega (`rose_lega`,
  `override_manuali`), che non vengono mai toccate dal rebuild.

- **Una chiave sola.** Ogni giocatore e' identificato dall'ID di Fantacalcio.it
  (`fc_id`), stabile fra stagioni. Le altre fonti ci arrivano tramite `alias`.

- **Pensato per dopo.** Le tabelle per il tool formazione (probabili,
  proiezioni per giornata, rose della lega) esistono gia', anche se vuote.

Schema in breve:

    squadre            una riga per squadra (slug Fantacalcio.it)
    giocatori          anagrafica corrente, chiave fc_id
    alias              fonte + chiave esterna -> fc_id
    voti               giocatore x giornata: voto, fantavoto, eventi   <- target
    partite            calendario completo con xG, quote, gol attesi
    stat_avanzate      giocatore x stagione: minuti, xG, npxG, xA, tiri
    quotazioni         serie storica QI, QA, FVM
    indisponibili      chi e' fermo adesso: giornata (SosFanta) e data (Transfermarkt) di rientro
    storico_infortuni  giocatore x stop, dalla 23/24 (Transfermarkt): base della propensione
    probabili          snapshot probabili formazioni (per il tool formazione)
    proiezioni         output del modello, per versione
    proiezioni_giornata  portieri e attaccanti partita per partita, per versione
    valutazioni        valore, prezzo atteso, affare, per versione
    rose_lega          chi ha comprato chi e a quanto (asta e avversari)
    log_ingest         esito di ogni build con i controlli di qualita'
"""

from __future__ import annotations

import datetime as dt
import json

import duckdb
import numpy as np
import pandas as pd

from .paths import DATA_DIR
from .resolve.match import match_players
from .resolve.normalize import normalize_team
from .store import read_all_snapshots, read_snapshot

DB_PATH = DATA_DIR / "fantaoracle.duckdb"

SCHEMA = """
CREATE TABLE IF NOT EXISTS squadre (
    squadra      VARCHAR PRIMARY KEY,   -- slug normalizzato: 'roma', 'inter'
    nome         VARCHAR,
    in_serie_a   BOOLEAN                -- nella stagione corrente
);

CREATE TABLE IF NOT EXISTS giocatori (
    fc_id        INTEGER PRIMARY KEY,
    nome         VARCHAR,
    slug         VARCHAR,
    squadra      VARCHAR,               -- squadra attuale (o ultima nota)
    ruolo        VARCHAR,               -- P D C A
    ruolo_mantra VARCHAR,
    nel_listone  BOOLEAN
);

CREATE TABLE IF NOT EXISTS alias (
    fonte        VARCHAR,
    chiave       VARCHAR,
    anno         INTEGER,
    fc_id        INTEGER,
    score        DOUBLE,
    metodo       VARCHAR
);

CREATE TABLE IF NOT EXISTS voti (
    fc_id        INTEGER,
    stagione     VARCHAR,
    giornata     INTEGER,
    squadra      VARCHAR,
    ruolo        VARCHAR,
    sv           BOOLEAN,               -- a referto ma senza voto
    voto         DOUBLE,
    fantavoto    DOUBLE,
    subentrato   BOOLEAN,
    sostituito   BOOLEAN,
    gol INTEGER, assist INTEGER, ammonizione INTEGER, espulsione INTEGER,
    rigori_segnati INTEGER, rigori_sbagliati INTEGER, rigori_parati INTEGER,
    autogol INTEGER, gol_subiti INTEGER,
    PRIMARY KEY (fc_id, stagione, giornata)
);

CREATE TABLE IF NOT EXISTS partite (
    stagione     VARCHAR,
    data         TIMESTAMP,
    casa         VARCHAR,
    trasferta    VARCHAR,
    giocata      BOOLEAN,
    gol_casa DOUBLE, gol_trasferta DOUBLE,
    xg_casa DOUBLE, xg_trasferta DOUBLE,
    quota_1 DOUBLE, quota_x DOUBLE, quota_2 DOUBLE,
    quota_over25 DOUBLE, quota_under25 DOUBLE
);

CREATE TABLE IF NOT EXISTS stat_avanzate (
    fc_id        INTEGER,
    stagione     VARCHAR,
    presenze     INTEGER,
    minuti       DOUBLE,
    gol DOUBLE, npg DOUBLE, xg DOUBLE, npxg DOUBLE,
    assist DOUBLE, xa DOUBLE, tiri DOUBLE, key_passes DOUBLE,
    rigori_stimati DOUBLE, gol_rigore DOUBLE,
    PRIMARY KEY (fc_id, stagione)
);

CREATE TABLE IF NOT EXISTS quotazioni (
    fc_id INTEGER, rilevato DATE, qi DOUBLE, qa DOUBLE, fvm1000 DOUBLE,
    pct_giocate DOUBLE
);

CREATE TABLE IF NOT EXISTS indisponibili (
    fc_id INTEGER, rilevato DATE, motivo VARCHAR, rientro DATE, fonte VARCHAR,
    tipo VARCHAR,           -- infortunato | squalificato | diffidato | acciaccato
    giornata INTEGER        -- giornata di rientro scritta da SosFanta
);

CREATE TABLE IF NOT EXISTS storico_infortuni (
    fc_id INTEGER, stagione VARCHAR, testo VARCHAR, dal DATE, al DATE,
    giorni INTEGER, partite_perse INTEGER, rilevato DATE
);

CREATE TABLE IF NOT EXISTS fasce (
    fc_id INTEGER, rilevato DATE, fonte VARCHAR,
    fascia VARCHAR,         -- etichetta di SOS Fanta: 'SUPER TOP', 'JOLLY 1ª FASCIA'...
    ordine INTEGER,         -- posizione della fascia nella scheda del ruolo
    posizione INTEGER       -- posizione del nome dentro la fascia
);

CREATE TABLE IF NOT EXISTS probabili (
    fc_id INTEGER, stagione VARCHAR, giornata INTEGER, fonte VARCHAR,
    stato VARCHAR,          -- titolare | panchina | dubbio | indisponibile
    rilevato TIMESTAMP
);

CREATE TABLE IF NOT EXISTS proiezioni (
    versione VARCHAR, fc_id INTEGER, calcolata TIMESTAMP,
    giornate_residue INTEGER,
    p_voto DOUBLE,          -- probabilita' di prendere voto in una giornata
    p_titolare DOUBLE,
    voto_atteso DOUBLE, bonus_attesi DOUBLE, malus_attesi DOUBLE,
    fm_attesa DOUBLE,       -- fantavoto atteso quando gioca
    quota_modificatore DOUBLE,
    punti_giornata DOUBLE,  -- contributo atteso a giornata (include p_voto)
    punti_stagione DOUBLE,
    dettagli JSON
);

CREATE TABLE IF NOT EXISTS valutazioni (
    versione VARCHAR, fc_id INTEGER,
    vorp DOUBLE, valore DOUBLE, prezzo_atteso DOUBLE, affare DOUBLE,
    fattore_tifo DOUBLE
);

CREATE TABLE IF NOT EXISTS rose_lega (
    fantasquadra VARCHAR, fc_id INTEGER, prezzo INTEGER,
    acquistato TIMESTAMP, note VARCHAR
);

CREATE TABLE IF NOT EXISTS override_manuali (
    fc_id INTEGER, campo VARCHAR, valore VARCHAR, nota VARCHAR,
    inserito TIMESTAMP
);

CREATE TABLE IF NOT EXISTS log_ingest (
    eseguito TIMESTAMP, passo VARCHAR, righe INTEGER, esito VARCHAR,
    dettagli JSON
);

-- Punti attesi partita per partita di portieri e attaccanti: la base della
-- griglia di alternanza e del costruttore che sceglie chi schierare ogni turno.
CREATE TABLE IF NOT EXISTS proiezioni_giornata (
    versione VARCHAR, fc_id INTEGER, giornata INTEGER,
    avversario VARCHAR, casa BOOLEAN,
    punti DOUBLE            -- contributo atteso in quella partita (include p_voto)
);

-- Aggiunte dopo la prima versione: un database gia' creato le riceve qui.
ALTER TABLE partite ADD COLUMN IF NOT EXISTS giornata INTEGER;
"""

# Colonne aggiunte dopo la prima versione dello schema: un database gia' creato
# le riceve qui, senza doverlo cancellare (rose_lega e override vivono li').
MIGRAZIONI = [
    "ALTER TABLE indisponibili ADD COLUMN IF NOT EXISTS tipo VARCHAR",
    "ALTER TABLE indisponibili ADD COLUMN IF NOT EXISTS giornata INTEGER",
]

# Tabelle derivate dagli snapshot: svuotate e ricaricate a ogni build.
DERIVATE = ["squadre", "giocatori", "alias", "voti", "partite", "stat_avanzate",
            "quotazioni", "indisponibili", "storico_infortuni", "fasce"]


def connetti(read_only: bool = False) -> duckdb.DuckDBPyConnection:
    con = duckdb.connect(str(DB_PATH), read_only=read_only)
    if not read_only:
        con.execute(SCHEMA)
        for m in MIGRAZIONI:
            con.execute(m)
    return con


def anno_to_stagione(anno: int) -> str:
    return f"{anno}-{str(anno + 1)[-2:]}"


def _log(con, passo: str, righe: int, esito: str = "ok", **dettagli):
    con.execute("INSERT INTO log_ingest VALUES (?, ?, ?, ?, ?)",
                [dt.datetime.now(), passo, righe, esito, json.dumps(dettagli, default=str)])


def _carica(con, tabella: str, df: pd.DataFrame):
    cols = [c[0] for c in con.execute(f"DESCRIBE {tabella}").fetchall()]
    df = df.reindex(columns=cols)
    con.register("_tmp", df)
    con.execute(f"INSERT INTO {tabella} SELECT * FROM _tmp")
    con.unregister("_tmp")


# --- costruzione delle singole tabelle -----------------------------------------

def _voti() -> pd.DataFrame:
    v = read_snapshot("fantacalcio_it", "voti").copy()
    v["squadra"] = v["squadra"].map(normalize_team)
    v = v.drop_duplicates(["fc_id", "stagione", "giornata"])
    return v


def _squadre(v: pd.DataFrame, listone: pd.DataFrame) -> pd.DataFrame:
    nomi = (read_snapshot("fantacalcio_it", "voti")[["squadra"]].drop_duplicates())
    nomi["slug"] = nomi["squadra"].map(normalize_team)
    correnti = set(listone["squadra_slug"].map(normalize_team))
    return pd.DataFrame({
        "squadra": nomi["slug"], "nome": nomi["squadra"],
        "in_serie_a": nomi["slug"].isin(correnti),
    }).drop_duplicates("squadra")


def _giocatori(v: pd.DataFrame, listone: pd.DataFrame) -> pd.DataFrame:
    l = listone.copy()
    l["squadra"] = l["squadra_slug"].map(normalize_team)
    cor = l[["fc_id", "nome", "slug", "squadra", "ruolo", "ruolo_mantra"]].copy()
    cor["nel_listone"] = True

    # Giocatori storici non piu' in listone: ultima apparizione nei voti.
    ultimi = (v.sort_values(["stagione", "giornata"])
               .groupby("fc_id").tail(1)[["fc_id", "nome", "slug", "squadra", "ruolo"]])
    ultimi = ultimi[~ultimi["fc_id"].isin(cor["fc_id"])].copy()
    ultimi["ruolo_mantra"] = None
    ultimi["nel_listone"] = False
    return pd.concat([cor, ultimi], ignore_index=True)


def _partite() -> pd.DataFrame:
    us = read_snapshot("understat", "calendario").copy()
    us["stagione"] = us["anno"].map(anno_to_stagione)
    us["casa"] = us["casa"].map(normalize_team)
    us["trasferta"] = us["trasferta"].map(normalize_team)

    fd = read_snapshot("footballdata", "serie_a").copy()
    fd["casa"] = fd["casa"].map(normalize_team)
    fd["trasferta"] = fd["trasferta"].map(normalize_team)
    quote = ["quota_1", "quota_x", "quota_2", "quota_over25", "quota_under25"]
    fd = fd[["stagione", "casa", "trasferta"] + [q for q in quote if q in fd.columns]]

    out = us.merge(fd, on=["stagione", "casa", "trasferta"], how="left")

    # Numero di giornata dal calendario ufficiale (Understat ha solo le date):
    # serve alla griglia di alternanza e ai punti per giornata. Solo le stagioni
    # che hanno il file in data/ref; le altre restano senza.
    from .model.calendario import carica_calendario
    pezzi = []
    for stagione in out["stagione"].unique():
        cal = carica_calendario(stagione)
        if cal is not None:
            pezzi.append(cal.assign(stagione=stagione))
    if pezzi:
        out = out.merge(pd.concat(pezzi), on=["stagione", "casa", "trasferta"], how="left")
    else:
        out["giornata"] = None
    return out


def _stat_avanzate(v: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    """Allinea i giocatori Understat agli fc_id, stagione per stagione.

    Il blocking e' per squadra e per stagione: si confronta un giocatore Understat
    solo con chi ha preso voto per quella squadra in quella stagione. Chi ha
    cambiato squadra a gennaio compare in Understat con entrambe le squadre
    ("Genoa,Roma") e viene cercato in tutte e due.
    """
    us = read_snapshot("understat", "giocatori").copy()
    alias, stat, copertura = [], [], {}

    for anno, gu in us.groupby("anno"):
        stagione = anno_to_stagione(int(anno))
        cand = (v[v["stagione"] == stagione][["fc_id", "nome", "squadra"]]
                .drop_duplicates(["fc_id", "squadra"]))
        if cand.empty:
            continue

        esplosi = gu.assign(squadra=gu["team_title"].str.split(",")).explode("squadra")
        esplosi["squadra"] = esplosi["squadra"].map(normalize_team)
        esplosi = esplosi.rename(columns={"player_name": "nome"})

        rep = match_players(esplosi[["us_id", "nome", "squadra"]], cand,
                            fonte_left="understat", soglia=82.0)
        m = rep.matched.merge(
            esplosi[["us_id", "nome", "squadra"]].rename(
                columns={"nome": "nome_fonte", "squadra": "squadra_fonte"}),
            on=["nome_fonte", "squadra_fonte"], how="left")
        m = m.merge(cand.rename(columns={"nome": "nome_canonico",
                                         "squadra": "squadra_canonica"}),
                    on=["nome_canonico", "squadra_canonica"], how="left")
        m = m.sort_values("score", ascending=False).drop_duplicates("us_id")
        m = m.drop_duplicates("fc_id")

        alias.append(pd.DataFrame({
            "fonte": "understat", "chiave": m["us_id"].astype(str), "anno": int(anno),
            "fc_id": m["fc_id"], "score": m["score"], "metodo": m["metodo"],
        }))

        s = gu.merge(m[["us_id", "fc_id"]], on="us_id", how="inner")
        stat.append(pd.DataFrame({
            "fc_id": s["fc_id"], "stagione": stagione, "presenze": s["games"],
            "minuti": s["time"], "gol": s["goals"], "npg": s["npg"], "xg": s["xG"],
            "npxg": s["npxG"], "assist": s["assists"], "xa": s["xA"],
            "tiri": s["shots"], "key_passes": s["key_passes"],
            "rigori_stimati": s["rigori_stimati"], "gol_rigore": s["gol_rigore"],
        }))

        # Copertura sui giocatori che contano: almeno 5 voti in stagione.
        pres = v[(v["stagione"] == stagione) & (~v["sv"])].groupby("fc_id").size()
        rilevanti = set(pres[pres >= 5].index)
        coperti = rilevanti & set(m["fc_id"])
        copertura[stagione] = round(len(coperti) / max(len(rilevanti), 1), 3)

    return (pd.concat(alias, ignore_index=True),
            pd.concat(stat, ignore_index=True).drop_duplicates(["fc_id", "stagione"]),
            copertura)


def _quotazioni() -> pd.DataFrame:
    q = read_all_snapshots("fantacalcio_it", "listone").rename(columns={"asof": "rilevato"})
    return q[["fc_id", "rilevato", "qi", "qa", "fvm1000", "pct_giocate"]]


def _aggancia(fonte_df: pd.DataFrame, cand: pd.DataFrame, fonte: str) -> pd.DataFrame:
    """Righe di `fonte_df` (nome, squadra, ...) con il loro fc_id.

    Blocking per squadra come per Understat: si confronta un nome solo con la
    rosa del suo club nel listone. Chi non aggancia resta fuori, chi e' ambiguo
    anche: un infortunio attribuito all'uomo sbagliato costa crediti veri.
    """
    if fonte_df.empty:
        return fonte_df.assign(fc_id=pd.Series(dtype="int64"))
    rep = match_players(fonte_df[["nome", "squadra"]].drop_duplicates(), cand,
                        fonte_left=fonte, soglia=82.0)
    if rep.matched.empty:
        return fonte_df.iloc[0:0].assign(fc_id=pd.Series(dtype="int64"))
    m = rep.matched.merge(cand.rename(columns={"nome": "nome_canonico",
                                               "squadra": "squadra_canonica"}),
                          on=["nome_canonico", "squadra_canonica"])
    m = m.drop_duplicates("fc_id")
    return fonte_df.merge(m[["nome_fonte", "squadra_fonte", "fc_id"]],
                          left_on=["nome", "squadra"],
                          right_on=["nome_fonte", "squadra_fonte"]
                          ).drop(columns=["nome_fonte", "squadra_fonte"])


VUOTA_IND = ["fc_id", "rilevato", "motivo", "rientro", "fonte", "tipo", "giornata"]


def _infortuni(giocatori: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, dict]:
    """Indisponibili di oggi e storico infortuni, agganciati agli fc_id.

    Le due fonti si completano invece di sovrapporsi:

    - **SosFanta** e' la fonte principale di chi e' fermo: scrive la giornata di
      rientro ed e' aggiornata a ogni turno.
    - **Transfermarkt** aggiunge la data di "probabile ritorno" a chi SosFanta
      lascia senza giornata, e chi SosFanta non elenca. Un fermo che c'e' solo
      su Transfermarkt e senza data e' di solito un acciacco di giornata: entra
      come `acciaccato`, che il tool mostra ma il modello non sconta. Uno con la
      data gia' passata e' una pagina non aggiornata, e non entra.

    Lo storico viene solo da Transfermarkt, agganciato tramite le rose.
    """
    cand = giocatori[giocatori["nel_listone"]][["fc_id", "nome", "squadra"]]
    info: dict = {}

    try:
        sos = read_snapshot("sosfanta", "indisponibili")
        rilevato_sos = pd.Timestamp(sos.attrs["asof"]).date()
        sos = _aggancia(sos, cand, "sosfanta")
        info["sosfanta"] = f"{len(sos)} agganciati"
    except FileNotFoundError:
        sos, rilevato_sos = pd.DataFrame(columns=["fc_id", "tipo", "testo", "giornata"]), None

    try:
        rose = read_snapshot("transfermarkt", "rose")
        rilevato_tm = pd.Timestamp(rose.attrs["asof"]).date()
        rose = _aggancia(rose, cand, "transfermarkt")
        info["transfermarkt"] = f"{rose['fc_id'].nunique()}/{len(cand)} del listone"
    except FileNotFoundError:
        rose, rilevato_tm = pd.DataFrame(columns=["fc_id", "tm_id", "infortunio", "rientro"]), None

    # Un uomo, una riga: il tipo piu' grave se SosFanta lo elenca due volte.
    gravita = {"infortunato": 0, "squalificato": 1, "diffidato": 2}
    sos = (sos.assign(_g=sos["tipo"].map(gravita)).sort_values("_g")
              .drop_duplicates("fc_id").drop(columns="_g"))
    fermi_tm = rose[rose["infortunio"].notna()].set_index("fc_id")

    righe = []
    for r in sos.itertuples(index=False):
        tm = fermi_tm["rientro"].get(r.fc_id) if r.tipo == "infortunato" else None
        tm = None if tm is None or pd.isna(tm) else tm
        righe.append({"fc_id": r.fc_id, "rilevato": rilevato_sos, "motivo": r.testo,
                      "rientro": tm, "fonte": "sosfanta" + ("+transfermarkt" if tm else ""),
                      "tipo": r.tipo,
                      "giornata": None if pd.isna(r.giornata) else int(r.giornata)})
    gia = set(sos["fc_id"])
    for fc_id, r in fermi_tm.iterrows():
        if fc_id in gia:
            continue
        rientro = None if pd.isna(r["rientro"]) else r["rientro"]
        if rientro is not None and rilevato_tm is not None and rientro < rilevato_tm:
            continue
        righe.append({"fc_id": fc_id, "rilevato": rilevato_tm, "motivo": r["infortunio"],
                      "rientro": rientro, "fonte": "transfermarkt",
                      "tipo": "infortunato" if rientro is not None else "acciaccato",
                      "giornata": None})
    ind = pd.DataFrame(righe, columns=VUOTA_IND)

    try:
        st = read_snapshot("transfermarkt", "infortuni")
        rilevato_st = pd.Timestamp(st.attrs["asof"]).date()
        st = st.merge(rose[["tm_id", "fc_id"]].drop_duplicates("tm_id"), on="tm_id")
        storico = pd.DataFrame({
            "fc_id": st["fc_id"], "stagione": st["stagione"], "testo": st["testo"],
            "dal": st["dal"], "al": st["al"], "giorni": st["giorni"],
            "partite_perse": st["partite_perse"],
            "rilevato": rilevato_st,
        })
    except FileNotFoundError:
        storico = pd.DataFrame(columns=["fc_id", "stagione", "testo", "dal", "al", "giorni",
                                        "partite_perse", "rilevato"])

    alias = pd.DataFrame({
        "fonte": "transfermarkt", "chiave": rose["tm_id"].astype(str), "anno": 2026,
        "fc_id": rose["fc_id"], "score": None, "metodo": "rosa",
    }) if len(rose) else pd.DataFrame()
    return ind, storico, alias, info


def abbina_fasce(fasce: pd.DataFrame, cand: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """Assegna un fc_id a ogni nome della guida di SOS Fanta.

    La guida non dice la squadra, ma divide i giocatori per ruolo: si abbina
    dentro il ruolo (un "Thuram" fra gli attaccanti non e' il "Thuram K."
    centrocampista). `cand` ha fc_id, nome, squadra, ruolo del listone.
    Restituisce le righe abbinate e un resoconto con i nomi non risolti.
    """
    abbinati, non_risolti, ambigui = [], [], []
    for ruolo, sos in fasce.groupby("ruolo"):
        pool = cand[cand["ruolo"] == ruolo]
        sinistra = sos[["nome"]].drop_duplicates().assign(squadra="")
        rep = match_players(sinistra, pool[["nome", "squadra"]], fonte_left="sosfanta",
                            soglia=82.0, usa_blocking=False)
        m = rep.matched.merge(pool[["fc_id", "nome", "squadra"]]
                              .rename(columns={"nome": "nome_canonico",
                                               "squadra": "squadra_canonica"}),
                              on=["nome_canonico", "squadra_canonica"])
        abbinati.append(sos.merge(m[["nome_fonte", "fc_id"]], left_on="nome",
                                  right_on="nome_fonte").drop(columns="nome_fonte"))
        non_risolti += [f"{ruolo}:{n}" for n in rep.unmatched_left.get("nome", [])]
        ambigui += [f"{ruolo}:{n}" for n in rep.ambiguous.get("nome", [])]

    out = pd.concat(abbinati, ignore_index=True) if abbinati else fasce.iloc[0:0].assign(fc_id=0)
    # Un giocatore compare una volta sola nella guida; se due nomi finissero sullo
    # stesso fc_id e' un abbinamento sbagliato, e si tiene quello piu' in alto.
    out = out.sort_values(["ordine", "posizione"]).drop_duplicates("fc_id")
    return out, {"nomi": len(fasce), "abbinati": len(out),
                 "non_risolti": non_risolti, "ambigui": ambigui}


def _fasce(giocatori: pd.DataFrame) -> pd.DataFrame:
    try:
        sos = read_snapshot("sosfanta", "fasce")
    except FileNotFoundError:
        return pd.DataFrame(columns=["fc_id", "rilevato", "fonte", "fascia", "ordine", "posizione"])
    cand = giocatori[giocatori["nel_listone"]][["fc_id", "nome", "squadra", "ruolo"]]
    m, rep = abbina_fasce(sos, cand)
    if rep["non_risolti"] or rep["ambigui"]:
        print(f"  fasce SOS Fanta: {rep['abbinati']}/{rep['nomi']} abbinati | "
              f"non risolti {rep['non_risolti']} | ambigui {rep['ambigui']}")
    return pd.DataFrame({
        "fc_id": m["fc_id"], "rilevato": pd.Timestamp(sos.attrs.get("asof")).date(),
        "fonte": "sosfanta", "fascia": m["fascia"], "ordine": m["ordine"],
        "posizione": m["posizione"],
    })


# --- build ---------------------------------------------------------------------

def controlli(con) -> dict:
    """Controlli di sanita' che devono restare veri. Restituisce i problemi trovati."""
    q = lambda s: con.execute(s).fetchone()[0]       # noqa: E731
    problemi = {}

    orfani = q("SELECT count(*) FROM voti WHERE fc_id NOT IN (SELECT fc_id FROM giocatori)")
    if orfani:
        problemi["voti_senza_giocatore"] = orfani

    fuori = q("SELECT count(*) FROM voti WHERE NOT sv AND (voto < 3 OR voto > 10)")
    if fuori:
        problemi["voti_fuori_scala"] = fuori

    # Il fantavoto deve essere ricostruibile dalle regole: e' il test piu' forte
    # sulla correttezza del parser e sulla tabella bonus del config.
    scarti = q("""SELECT count(*) FROM voti WHERE NOT sv AND abs(fantavoto - (voto
        + 3*gol + 3*rigori_segnati + assist + 3*rigori_parati - 0.5*ammonizione
        - espulsione - 3*rigori_sbagliati - 2*autogol - gol_subiti)) > 0.01""")
    if scarti:
        problemi["fantavoto_non_ricostruibile"] = scarti

    squadre_correnti = q("SELECT count(*) FROM squadre WHERE in_serie_a")
    if squadre_correnti != 20:
        problemi["squadre_correnti"] = squadre_correnti

    residue = q("""SELECT count(*) FROM partite WHERE stagione = '2026-27' AND NOT giocata""")
    problemi_info = {"partite_residue_2026_27": residue}

    # Ogni partita della stagione in corso deve avere la sua giornata: una
    # partita senza numero sparirebbe dalla griglia di alternanza.
    senza = q("""SELECT count(*) FROM partite WHERE stagione = '2026-27' AND giornata IS NULL""")
    if senza:
        problemi["partite_senza_giornata_2026_27"] = senza

    return {"problemi": problemi, "info": problemi_info}


def build(verbose: bool = True) -> dict:
    con = connetti()
    for t in DERIVATE:
        con.execute(f"DELETE FROM {t}")

    listone = read_snapshot("fantacalcio_it", "listone")
    v = _voti()
    giocatori = _giocatori(v, listone)

    _carica(con, "squadre", _squadre(v, listone))
    _carica(con, "giocatori", giocatori)
    _carica(con, "voti", v)
    _carica(con, "partite", _partite())
    alias, stat, copertura = _stat_avanzate(v)
    ind, storico, alias_tm, info_inf = _infortuni(giocatori)
    _carica(con, "alias", pd.concat([alias, alias_tm], ignore_index=True))
    _carica(con, "stat_avanzate", stat)
    _carica(con, "quotazioni", _quotazioni())
    _carica(con, "indisponibili", ind)
    _carica(con, "storico_infortuni", storico)
    _carica(con, "fasce", _fasce(giocatori))

    esito = controlli(con)
    esito["copertura_understat"] = copertura
    esito["infortuni"] = info_inf
    conteggi = {t: con.execute(f"SELECT count(*) FROM {t}").fetchone()[0] for t in DERIVATE}
    esito["conteggi"] = conteggi
    _log(con, "build", sum(conteggi.values()),
         "ok" if not esito["problemi"] else "problemi", **esito)
    con.close()

    if verbose:
        print("  righe:", conteggi)
        print("  copertura Understat (giocatori con 5+ voti):", copertura)
        print("  infortuni:", info_inf or "nessuno snapshot")
        print("  controlli:", esito["problemi"] or "tutti superati", "|", esito["info"])
    return esito


def tabella(sql: str, params=None) -> pd.DataFrame:
    con = connetti(read_only=True)
    try:
        return con.execute(sql, params or []).df()
    finally:
        con.close()


if __name__ == "__main__":  # pragma: no cover
    build()
    _ = np  # evita warning linter
