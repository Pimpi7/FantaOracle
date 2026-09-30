"""Normalizzazione di nomi giocatori e squadre.

Il problema concreto: lo stesso giocatore compare come

    listone   ->  "VLAHOVIC"          oppure  "Vlahovic D."
    FBref     ->  "Dusan Vlahovic"    (con i diacritici: Dusan Vlahovic)
    Understat ->  "Dusan Vlahovic"
    Virgilio  ->  "D. Vlahovic"

Quattro grafie, un giocatore. La strategia e' ridurre tutto a due chiavi:
`cognome` (la parte piu' stabile fra le fonti) e `iniziale` (quando c'e').
Il matching vero sta in match.py e lavora su queste chiavi.
"""

from __future__ import annotations

import re
import unicodedata

# Particelle che fanno parte del cognome e non vanno trattate come nome proprio.
# "Di Lorenzo" e' cognome intero, non nome "Di" + cognome "Lorenzo".
PARTICELLE = {
    "de", "del", "della", "dello", "dei", "degli", "di", "da", "dal", "dalla",
    "van", "von", "der", "den", "ter", "te", "op", "el", "al", "bin", "ben",
    "mc", "mac", "o", "d", "la", "le", "lo", "dos", "das", "do", "san", "santa",
}

# Suffissi generazionali da ignorare.
SUFFISSI = {"jr", "junior", "sr", "senior", "ii", "iii", "filho", "neto"}

_PUNTEGGIATURA = re.compile(r"[^\w\s]", flags=re.UNICODE)
_SPAZI = re.compile(r"\s+")

# Trattino e apostrofo tengono insieme il cognome, non lo spezzano:
# "Fitz-Jim" e' un cognome solo, "N'Dicka" pure. Vanno rimossi senza
# lasciare spazio, altrimenti la seconda meta' viene scambiata per il cognome
# e la prima per il nome proprio.
_GIUNZIONI = re.compile(r"[-'\u2019\u2018\u02bc\u00b4`]")


def strip_accents(s: str) -> str:
    """Rimuove i diacritici mantenendo la lettera base.

    Necessario perche' le fonti italiane scrivono senza accenti e FBref con.
    Cura particolare per la d con tratto croata/serba, che la decomposizione
    Unicode non tocca ma che compare spesso nei nomi balcanici della Serie A.
    """
    s = s.replace("\u0111", "d").replace("\u0110", "D")  # đ Đ
    s = s.replace("\u00f8", "o").replace("\u00d8", "O")  # ø Ø
    s = s.replace("\u0142", "l").replace("\u0141", "L")  # ł Ł
    s = s.replace("\u00df", "ss")                        # ß
    nfkd = unicodedata.normalize("NFKD", s)
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def basic_clean(s: str) -> str:
    """Minuscolo, senza accenti, senza punteggiatura, spazi normalizzati."""
    if s is None:
        return ""
    s = strip_accents(str(s)).lower()
    s = _GIUNZIONI.sub("", s)
    s = _PUNTEGGIATURA.sub(" ", s)
    return _SPAZI.sub(" ", s).strip()


# Un token di 1-3 lettere seguito da punto e' un nome proprio abbreviato.
# Il listone usa due lettere per distinguere gli omonimi ("Pellegrini Lo." per
# Lorenzo, "Pellegrini Lu." per Luca): buttare via tutto tranne l'iniziale
# distruggerebbe proprio l'informazione che serve a separarli.
_ABBREVIAZIONE = re.compile(r"^([a-z]{1,3})\.$")


def split_name(nome: str) -> tuple[str, str]:
    """Separa un nome in (cognome, nome_proprio).

    Il nome proprio e' restituito per intero quando la fonte lo espone, e in
    forma abbreviata quando la fonte abbrevia:

        "Dusan Vlahovic"      -> ("vlahovic", "dusan")
        "Vlahovic D."         -> ("vlahovic", "d")
        "VLAHOVIC"            -> ("vlahovic", "")
        "Di Lorenzo G."       -> ("di lorenzo", "g")
        "Pellegrini Lo."      -> ("pellegrini", "lo")
        "Lorenzo Pellegrini"  -> ("pellegrini", "lorenzo")

    Il confronto fra "lo" e "lorenzo" lo fa `nomi_compatibili`, che ragiona per
    prefisso: "lorenzo" e' compatibile con "lo" ma non con "lu".
    """
    grezzo = strip_accents(str(nome or "")).lower()
    grezzo = _GIUNZIONI.sub("", grezzo)
    grezzo = _SPAZI.sub(" ", grezzo).strip()
    if not grezzo:
        return "", ""

    abbreviazioni: list[str] = []
    token: list[str] = []
    for t in grezzo.split():
        m = _ABBREVIAZIONE.match(t)
        if m:
            abbreviazioni.append(m.group(1))
            continue
        pulito = _PUNTEGGIATURA.sub("", t)
        if not pulito or pulito in SUFFISSI:
            continue
        if len(pulito) == 1:            # iniziale senza punto
            abbreviazioni.append(pulito)
        else:
            token.append(pulito)

    if not token:
        return (abbreviazioni[0], "") if abbreviazioni else ("", "")

    if abbreviazioni:
        return " ".join(token), abbreviazioni[0]

    if len(token) == 1:
        return token[0], ""

    if token[0] in PARTICELLE:
        return " ".join(token), ""

    return " ".join(token[1:]), token[0]


def nomi_compatibili(a: str, b: str) -> bool | None:
    """Confronta due nomi propri di lunghezza diversa.

    Restituisce None se almeno uno dei due manca: in quel caso il nome proprio
    non porta informazione e non deve ne' premiare ne' penalizzare il match.
    """
    if not a or not b:
        return None
    corto, lungo = (a, b) if len(a) <= len(b) else (b, a)
    return lungo.startswith(corto)


def player_key(nome: str, squadra: str | None = None) -> str:
    """Chiave di confronto: cognome + iniziale, opzionalmente con la squadra.

    Non e' un id: e' la stringa su cui il fuzzy matching lavora dopo il blocking.
    """
    cognome, iniziale = split_name(nome)
    base = f"{cognome}|{iniziale}" if iniziale else cognome
    return f"{base}|{normalize_team(squadra)}" if squadra else base


def compact_key(nome: str) -> str:
    """Nome intero senza spazi ne' accenti.

    Confronto secondario per i casi in cui una fonte spezza un cognome che
    un'altra tiene unito ("Fitz Jim" contro "Fitz-Jim"): sulla chiave compatta
    le due grafie coincidono.
    """
    return basic_clean(nome).replace(" ", "")


# --- squadre -----------------------------------------------------------------

# Alias delle 20 squadre di Serie A fra le varie fonti. Va tenuto aggiornato a
# inizio stagione con le neopromosse: e' l'unico punto da toccare.
TEAM_ALIASES: dict[str, str] = {
    "internazionale": "inter",
    "inter milan": "inter",
    "fc internazionale": "inter",
    "ac milan": "milan",
    "milan ac": "milan",
    "as roma": "roma",
    "ss lazio": "lazio",
    "ssc napoli": "napoli",
    "juve": "juventus",
    "hellas verona": "verona",
    "hellas": "verona",
    "acf fiorentina": "fiorentina",
    "atalanta bc": "atalanta",
    "bologna fc": "bologna",
    "us lecce": "lecce",
    "torino fc": "torino",
    "udinese calcio": "udinese",
    "us sassuolo": "sassuolo",
    "sassuolo calcio": "sassuolo",
    "cagliari calcio": "cagliari",
    "genoa cfc": "genoa",
    "como 1907": "como",
    "parma calcio": "parma",
    "parma calcio 1913": "parma",
    "spezia calcio": "spezia",
    "empoli fc": "empoli",
    "venezia fc": "venezia",
    "frosinone calcio": "frosinone",
    "us cremonese": "cremonese",
    "ac monza": "monza",
    "ac pisa": "pisa",
    "pisa sc": "pisa",
    "salernitana": "salernitana",
    "us salernitana": "salernitana",
}


def normalize_team(squadra: str | None) -> str:
    if not squadra:
        return ""
    s = basic_clean(squadra)
    return TEAM_ALIASES.get(s, s)
