"""Infortuni: chi e' fermo adesso e chi si ferma spesso.

Tre dataset, da due fonti:

- `sosfanta/indisponibili`: la tabella indisponibili di SosFanta. Venti blocchi,
  uno per squadra, con tre elenchi (infortunati, squalificati, diffidati). E'
  l'unica fonte che scrive il rientro **in giornate** ("in dubbio per la 8a"),
  aggiornata a ogni turno.
- `transfermarkt/rose`: la rosa di ogni club su Transfermarkt. Da' l'id
  Transfermarkt di ogni giocatore e, per chi e' fermo, una pillola con
  "Probabile ritorno GG/MM/AAAA": la **data** dove SosFanta non scrive la
  giornata, e chi SosFanta non elenca.
- `transfermarkt/infortuni`: lo storico infortuni di ogni giocatore delle venti
  rose, una riga per stop (stagione, tipo, dal, al, giorni, partite perse), dalla
  `PRIMA_STAGIONE` in poi. Serve al giudizio sulla propensione.

Lo storico cambia poco: le pagine restano in cache sei giorni, quindi i due
aggiornamenti settimanali ne riscaricano al massimo uno. Le rose e la tabella
SosFanta invece si riscaricano a ogni aggiornamento.

Il parsing e' difensivo come quello dei voti: se le squadre riconosciute non
sono venti, o se non si legge nessun infortunato, si fallisce nominando il
problema invece di scrivere uno snapshot vuoto. "Nessun infortunato" e' un
risultato plausibile a leggersi, ed e' il piu' insidioso dei bug.
"""

from __future__ import annotations

import datetime as dt
import html as htmllib
import re
from concurrent.futures import ThreadPoolExecutor

import pandas as pd

from ..resolve.normalize import normalize_team
from ..store import list_snapshots, write_snapshot
from .http import get

SOSFANTA_URL = ("https://www.sosfanta.com/indisponibili-e-squalificati/"
                "tabella-indisponibili-seriea-fantacalcio-asta-infortunati-"
                "tempi-recupero-squalificati-diffidati/")

TM = "https://www.transfermarkt.it"
TM_STAGIONE = 2026                       # saison_id: anno d'inizio della stagione
TM_LEGA = f"{TM}/serie-a/startseite/wettbewerb/IT1/saison_id/{TM_STAGIONE}"
PRIMA_STAGIONE = "23/24"                 # tre stagioni intere piu' quella in corso

# Transfermarkt usa gli slug tedeschi ("as-rom", "inter-mailand"). Tabella chiusa,
# scritta a mano: come TEAM_ALIASES, va aggiornata con le neopromosse.
TM_CLUB = {
    "atalanta-bergamo": "atalanta", "fc-bologna": "bologna", "cagliari-calcio": "cagliari",
    "como-1907": "como", "ac-florenz": "fiorentina", "frosinone-calcio": "frosinone",
    "genua-cfc": "genoa", "inter-mailand": "inter", "juventus-turin": "juventus",
    "lazio-rom": "lazio", "us-lecce": "lecce", "ac-mailand": "milan", "ac-monza": "monza",
    "ssc-neapel": "napoli", "parma-calcio-1913": "parma", "as-rom": "roma",
    "us-sassuolo": "sassuolo", "fc-turin": "torino", "udinese-calcio": "udinese",
    "venezia-fc": "venezia", "hellas-verona": "verona", "us-cremonese": "cremonese",
    "ac-pisa-1909": "pisa", "fc-empoli": "empoli",
}

SQUADRE_ATTESE = 20

# Pagine scaricate in parallelo: basso, non c'e' fretta e Transfermarkt non ama
# i picchi.
PARALLELI = 3


def _testo(frammento: str) -> str:
    return re.sub(r"\s+", " ", htmllib.unescape(re.sub(r"<[^>]+>", " ", frammento))).strip()


def _data(raw: str | None) -> dt.date | None:
    m = re.search(r"(\d{2})/(\d{2})/(\d{4})", raw or "")
    return dt.date(int(m.group(3)), int(m.group(2)), int(m.group(1))) if m else None


# --- SosFanta ------------------------------------------------------------------

_SEZIONI = (("Infortunati", "infortunato"), ("Squalificati", "squalificato"),
            ("Diffidati", "diffidato"))


def giornata_rientro(testo: str) -> int | None:
    """"in dubbio per la 6a" -> 6.

    Il punto dopo "la" e l'articolo mancante sono refusi visti davvero sulla
    fonte ("per la. 6a", "per 29a"): ognuno, da solo, toglieva la giornata senza
    far fallire niente.
    """
    m = re.search(r"\bper (?:la\.? )?(\d{1,2})\s?[ªa°]\b", testo, re.I)
    return int(m.group(1)) if m else None


def parse_sosfanta(html: str, squadre: set[str]) -> pd.DataFrame:
    """Righe della tabella: squadra, tipo, nome, testo, giornata.

    Ogni paragrafo dell'articolo e' o un'intestazione di squadra (il suo testo,
    normalizzato, e' una delle squadre attese), o l'etichetta di una sezione, o
    una voce `<strong>Nome</strong> - descrizione`. Squalificati e diffidati
    possono stare sulla riga dell'etichetta, separati da virgola.
    """
    inizio = html.find("article-body")
    if inizio < 0:
        raise RuntimeError("SosFanta: blocco 'article-body' non trovato, markup cambiato.")
    paragrafi = []
    for inner in re.findall(r"<p[^>]*>(.*?)</p>", html[inizio:], re.S):
        t = _testo(inner)
        if not t:
            continue
        s = re.search(r"<strong[^>]*>(.*?)</strong>", inner, re.S)
        paragrafi.append((_testo(s.group(1)) if s else None, t))

    righe, viste = [], set()
    squadra, sezione = None, None
    for forte, t in paragrafi:
        sq = normalize_team(t)
        if sq in squadre:
            # Un'intestazione ripetuta e' rumore di coda pagina, non un blocco nuovo.
            squadra = None if sq in viste else sq
            viste.add(sq)
            sezione = None
            continue
        if squadra is None:
            continue
        etichetta = next(((lab, k) for lab, k in _SEZIONI
                          if re.match(rf"^{lab}\s*:", t, re.I)), None)
        if etichetta:
            sezione = etichetta[1]
            resto = re.sub(rf"^{etichetta[0]}\s*:", "", t, flags=re.I).strip()
            if resto and resto != "-":
                for nome in (n.strip() for n in resto.split(",")):
                    if nome:
                        righe.append({"squadra": squadra, "tipo": sezione, "nome": nome,
                                      "testo": "", "giornata": None})
            continue
        if sezione is None or not forte:
            continue
        desc = re.sub(r"^\s*[-–—]\s*", "", t[len(forte):]).strip()
        righe.append({"squadra": squadra, "tipo": sezione, "nome": forte, "testo": desc,
                      "giornata": giornata_rientro(desc)})

    if len(viste) != SQUADRE_ATTESE:
        raise RuntimeError(f"SosFanta: {len(viste)} squadre riconosciute invece di "
                           f"{SQUADRE_ATTESE}. Mancano: {sorted(squadre - viste)}")
    df = pd.DataFrame(righe, columns=["squadra", "tipo", "nome", "testo", "giornata"])
    if not (df["tipo"] == "infortunato").any():
        raise RuntimeError("SosFanta: nessun infortunato letto in venti squadre.")
    df["giornata"] = df["giornata"].astype("Int64")
    return df


def ingest_sosfanta(squadre: set[str]) -> pd.DataFrame:
    df = parse_sosfanta(get(SOSFANTA_URL, ttl_ore=2).decode("utf-8", "replace"), squadre)
    write_snapshot(df, "sosfanta", "indisponibili", overwrite=True,
                   meta={"url": SOSFANTA_URL})
    inf = df[df["tipo"] == "infortunato"]
    print(f"  sosfanta/indisponibili: {len(inf)} infortunati "
          f"({inf['giornata'].notna().sum()} con la giornata), "
          f"{len(df) - len(inf)} squalificati o diffidati")
    return df


# --- Transfermarkt: rose ---------------------------------------------------------

_RIGA_ROSA = re.compile(
    r'<td class="hauptlink">\s*<a href="/([^"/]+)/profil/spieler/(\d+)">(.*?)</a>', re.S)


def parse_club(html: str) -> dict[str, str]:
    """Slug Transfermarkt -> id del club, per le squadre note in TM_CLUB."""
    out = {}
    for slug, cid in re.findall(r'href="/([a-z0-9-]+)/startseite/verein/(\d+)/saison_id/\d+"', html):
        if slug in TM_CLUB:
            out[slug] = cid
    return out


def parse_rosa(html: str, squadra: str) -> pd.DataFrame:
    righe, visti = [], set()
    for slug, tm_id, inner in _RIGA_ROSA.findall(html):
        if tm_id in visti:
            continue
        visti.add(tm_id)
        nome = _testo(re.sub(r"<span.*?</span>", "", inner, flags=re.S))
        infortunio, rientro = None, None
        # Nella stessa cella possono esserci altre icone con un title (la fascia
        # da capitano, la squalifica): conta solo quella della croce rossa.
        croce = re.search(r'<span[^>]*title="([^"]*)"[^>]*class="verletzt-table', inner)
        if croce:
            titolo = htmllib.unescape(croce.group(1))
            parti = titolo.split(" - ")
            infortunio = parti[0].strip()
            rientro = _data(parti[1]) if len(parti) > 1 else None
        righe.append({"tm_id": int(tm_id), "tm_slug": slug, "nome": nome, "squadra": squadra,
                      "infortunio": infortunio, "rientro": rientro})
    if len(righe) < 18:
        raise RuntimeError(f"Transfermarkt: solo {len(righe)} giocatori nella rosa di {squadra}.")
    return pd.DataFrame(righe)


def ingest_rose() -> pd.DataFrame:
    club = parse_club(get(TM_LEGA, ttl_ore=12).decode("utf-8", "replace"))
    if len(club) != SQUADRE_ATTESE:
        raise RuntimeError(f"Transfermarkt: {len(club)} club in Serie A invece di "
                           f"{SQUADRE_ATTESE}. Controllare TM_CLUB.")
    rose = []
    for slug, cid in sorted(club.items()):
        url = f"{TM}/{slug}/kader/verein/{cid}/saison_id/{TM_STAGIONE}"
        rose.append(parse_rosa(get(url, ttl_ore=12).decode("utf-8", "replace"), TM_CLUB[slug]))
    df = pd.concat(rose, ignore_index=True)
    write_snapshot(df, "transfermarkt", "rose", overwrite=True, meta={"url": TM_LEGA})
    print(f"  transfermarkt/rose: {len(df)} giocatori, {df['infortunio'].notna().sum()} fermi")
    return df


# --- Transfermarkt: storico infortuni ------------------------------------------------

def _anno_stagione(s: str) -> int | None:
    m = re.match(r"^(\d{2})/\d{2}$", s or "")
    return 2000 + int(m.group(1)) if m else None


def parse_storico(html: str) -> tuple[list[dict], int]:
    """Righe della tabella "Infortuni" e numero di pagine."""
    i = html.find('class="items"')
    righe = []
    if i >= 0:
        tabella = html[i:html.find("</table>", i)]
        for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", tabella, re.S):
            celle = [_testo(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)]
            if len(celle) < 6:
                continue
            stagione, testo, dal, al, giorni, perse = celle[:6]
            g = re.match(r"(\d+)", giorni)
            righe.append({
                "stagione": stagione, "testo": testo, "dal": _data(dal), "al": _data(al),
                "giorni": int(g.group(1)) if g else None,
                "partite_perse": int(perse) if perse.isdigit() else 0,
            })
    pagine = max([1] + [int(n) for n in re.findall(r"verletzungen/spieler/\d+/page/(\d+)", html)])
    return righe, pagine


def storico_giocatore(tm_slug: str, tm_id: int) -> list[dict]:
    """Lo storico dalla PRIMA_STAGIONE in poi, girando pagina finche' serve."""
    soglia = _anno_stagione(PRIMA_STAGIONE)
    out, pagina = [], 1
    while True:
        url = f"{TM}/{tm_slug}/verletzungen/spieler/{tm_id}" + (f"/page/{pagina}" if pagina > 1 else "")
        righe, pagine = parse_storico(get(url, ttl_ore=24 * 6).decode("utf-8", "replace"))
        vecchie = False
        for r in righe:
            anno = _anno_stagione(r["stagione"])
            if anno is None:
                continue
            if anno < soglia:
                vecchie = True
                continue
            out.append({"tm_id": tm_id, **r})
        if vecchie or pagina >= pagine:
            return out
        pagina += 1


def ingest_storico(rose: pd.DataFrame) -> pd.DataFrame:
    with ThreadPoolExecutor(PARALLELI) as ex:
        tutte = list(ex.map(lambda r: storico_giocatore(r.tm_slug, r.tm_id),
                            rose.itertuples(index=False)))
    df = pd.DataFrame([r for g in tutte for r in g],
                      columns=["tm_id", "stagione", "testo", "dal", "al", "giorni",
                               "partite_perse"])
    df["giorni"] = df["giorni"].astype("Int64")
    if df.empty:
        raise RuntimeError("Transfermarkt: storico vuoto per tutte le rose.")
    write_snapshot(df, "transfermarkt", "infortuni", overwrite=True,
                   meta={"prima_stagione": PRIMA_STAGIONE})
    print(f"  transfermarkt/infortuni: {len(df)} stop di {df['tm_id'].nunique()} giocatori "
          f"dalla {PRIMA_STAGIONE}")
    return df


STORICO_VALIDO_GIORNI = 6


def ingest(squadre: set[str], completo: bool = False) -> None:
    """Le tre raccolte. SosFanta e Transfermarkt sono indipendenti: se una delle
    due fallisce l'altra si salva lo stesso, e il database usa l'ultimo snapshot
    buono di quella mancante.

    Lo storico si riscarica solo se l'ultimo snapshot ha piu' di sei giorni (o con
    `completo`): sono seicento pagine che in una settimana cambiano per pochi.
    """
    errori = []
    try:
        ingest_sosfanta(squadre)
    except Exception as e:                                       # noqa: BLE001
        errori.append(f"sosfanta: {e}")
    try:
        rose = ingest_rose()
        ultimi = list_snapshots("transfermarkt", "infortuni")
        fresco = ultimi and (dt.date.today() - ultimi[-1]).days < STORICO_VALIDO_GIORNI
        if completo or not fresco:
            ingest_storico(rose)
        else:
            print(f"  transfermarkt/infortuni: snapshot del {ultimi[-1]} ancora valido")
    except Exception as e:                                       # noqa: BLE001
        errori.append(f"transfermarkt: {e}")
    if errori:
        raise RuntimeError("; ".join(errori))
