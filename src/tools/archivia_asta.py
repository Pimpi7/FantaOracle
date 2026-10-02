"""Storicizza un'asta: dal testo di "Esporta l'asta" ai CSV in data/aste/<data>/.

Il tool web tiene l'asta solo nella memoria del browser. Qui la si mette in git, in una
cartella per data, in forma leggibile. Le aste sono dati di una lega: non vanno su main, che
resta buono per chiunque, ma su un branch personale (asta-personale):

    asta.json      l'export del tool, con i nomi delle fantasquadre resi anonimi (con Importa si ricarica nel tool)
    acquisti.csv   una riga per acquisto, nell'ordine dell'asta
    rose.csv       le rose finali, una riga per giocatore
    squadre.csv    il riepilogo per fantasquadra
    ruoli.csv      il riepilogo per ruolo
    README.md      cosa c'e' nella cartella e i numeri principali

    python src/tools/archivia_asta.py <export.json> [--uscita data/aste] [--dati src/web/data.json] [--nomi-veri]

I nomi delle fantasquadre non finiscono nell'archivio: diventano "La mia squadra" e "Squadra 2",
"Squadra 3"... nell'ordine in cui erano sedute (--nomi-veri li lascia come sono).

Nomi, ruoli, prezzi previsti e fasce vengono da data.json: sono quelli della versione dei dati
con cui si lancia lo script, che conviene sia la stessa dell'asta (e' scritta nel README).
Se nella cartella c'e' grafico.csv (letto dal sito con scraping_grafico_asta.js), ogni riga
viene confrontata con i conti fatti qui: se non coincidono lo script si ferma.
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

RUOLI = ["P", "D", "C", "A"]
NOMI_RUOLO = {"P": "Portieri", "D": "Difensori", "C": "Centrocampisti", "A": "Attaccanti"}
FINESTRA = 6  # acquisti nella media mobile del grafico, come nel tool
ROMA = ZoneInfo("Europe/Rome")
RADICE = Path(__file__).resolve().parents[2]


def _scrivi(percorso: Path, colonne: list[str], righe: list[dict]) -> None:
    with percorso.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=colonne, lineterminator="\n")
        w.writeheader()
        w.writerows(righe)


def _ora(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


def _mezzo_su(x: float, cifre: int = 0) -> float:
    """Arrotonda come il tool (la meta' va in su), non come round() di Python (al pari)."""
    k = 10 ** cifre
    return int(x * k + 0.5) / k


def anonimizza(asta: dict) -> dict:
    """I nomi delle fantasquadre diventano quelli di partenza del tool, nell'ordine del tavolo."""
    io = asta.get("io", 0)
    for k, t in enumerate(asta["squadre"]):
        t["nome"] = "La mia squadra" if k == io else f"Squadra {k + 1}"
    return asta


def archivia(export: Path, uscita: Path, dati: Path, nomi_veri: bool = False) -> Path:
    testo = export.read_text(encoding="utf-8")
    asta = json.loads(testo)["asta"]
    if not nomi_veri:
        asta = anonimizza(asta)
        testo = json.dumps({"asta": asta}, ensure_ascii=False, separators=(",", ":"))
    d = json.loads(dati.read_text(encoding="utf-8"))
    meta, gioc = d["meta"], {g["id"]: g for g in d["giocatori"]}
    squadra = {s["slug"]: s["nome"] for s in d["squadre"]}
    fasce = meta.get("fasce") or []
    slot, crediti = meta["slot"], meta["crediti"]
    nomi = [t["nome"] for t in asta["squadre"]]
    io = asta.get("io", 0)
    piano = {int(k): v for k, v in (asta.get("obiettiviPrezzi") or {}).items()}
    obiettivi = {int(x) for x in asta.get("obiettivi") or []}

    mancanti = [x["id"] for x in asta["log"] if x["id"] not in gioc]
    if mancanti:
        sys.exit(f"giocatori dell'asta che non sono in {dati}: {mancanti}")

    inizio = _ora(asta["inizio"]) if asta.get("inizio") else _ora(asta["log"][0]["ora"])
    cartella = uscita.resolve() / inizio.astimezone(ROMA).strftime("%Y-%m-%d")
    cartella.mkdir(parents=True, exist_ok=True)
    (cartella / "asta.json").write_text(testo, encoding="utf-8")

    # --- acquisti, nell'ordine dell'asta ---
    acquisti, cumulato = [], 0
    for i, x in enumerate(asta["log"]):
        g = gioc[x["id"]]
        cumulato += x["p"]
        finestra = asta["log"][max(0, i - FINESTRA + 1): i + 1]
        pagato = sum(y["p"] for y in finestra)
        previsto = sum(gioc[y["id"]]["pa"] for y in finestra)
        ora = _ora(x["ora"]) if x.get("ora") else None
        acquisti.append({
            "n": i + 1,
            "ora_utc": ora.strftime("%Y-%m-%dT%H:%M:%SZ") if ora else "",
            "ora_locale": ora.astimezone(ROMA).strftime("%Y-%m-%d %H:%M:%S") if ora else "",
            "ruolo": g["r"], "id": g["id"], "giocatore": g["nome"], "squadra": squadra.get(g["sq"], g["sq"]),
            "fantasquadra": nomi[x["t"]], "mia": int(x["t"] == io),
            "prezzo": x["p"], "prezzo_previsto": g["pa"], "scarto": x["p"] - g["pa"],
            "pagato_su_previsto": round(x["p"] / max(1, g["pa"]), 3),
            "media6_crediti": round(pagato / len(finestra), 2),
            "media6_su_previsto": round(pagato / max(1, previsto), 3),
            "crediti_spesi_cumulati": cumulato,
            "turno_giro": nomi[x["tu"]] if x.get("tu") is not None else "",
            "quotazione": g.get("qa"), "fvm": g.get("fvm"),
            "fascia": fasce[g["fa"]] if g.get("fa") is not None and g["fa"] < len(fasce) else "",
            "fascia_stimata": int(bool(g.get("fi"))),
            "punti_a_giornata": g.get("pg"), "valore": g.get("val"),
            "nel_mio_piano": int(g["id"] in obiettivi), "prezzo_nel_piano": piano.get(g["id"], ""),
        })
    _scrivi(cartella / "acquisti.csv", list(acquisti[0].keys()), acquisti)

    # --- controllo con il grafico letto dal sito ---
    grafico = cartella / "grafico.csv"
    confronto = ""
    if grafico.exists():
        with grafico.open(encoding="utf-8") as f:
            letti = list(csv.DictReader(f))
        if len(letti) != len(acquisti):
            sys.exit(f"grafico.csv ha {len(letti)} righe, l'asta {len(acquisti)} acquisti")
        for a, r in zip(acquisti, letti):
            mio = (a["giocatore"], a["ruolo"], a["fantasquadra"], a["prezzo"], a["prezzo_previsto"],
                   _mezzo_su(a["media6_crediti"], 1), _mezzo_su(a["media6_su_previsto"] * 100))
            suo = (r["giocatore"], r["ruolo"], r["fantasquadra"], int(r["crediti"]), int(r["previsto"]),
                   float(r["media6_crediti"]), float(r["media6_pct_previsto"]))
            # le medie del grafico sono arrotondate per la lettura: un decimo o un punto di tolleranza
            if mio[:5] != suo[:5] or abs(mio[5] - suo[5]) > 0.11 or abs(mio[6] - suo[6]) > 1.01:
                sys.exit(f"acquisto {a['n']}: l'export dice {mio}, il grafico del sito {suo}")
        confronto = f"I {len(letti)} acquisti letti dal grafico del sito (`grafico.csv`) coincidono con l'export, riga per riga."

    # --- rose finali ---
    rose = []
    for t in asta["squadre"]:
        for gid, pz in t["rosa"].items():
            g = gioc[int(gid)]
            rose.append({"fantasquadra": t["nome"], "ruolo": g["r"], "id": g["id"], "giocatore": g["nome"],
                         "squadra": squadra.get(g["sq"], g["sq"]), "prezzo": pz, "prezzo_previsto": g["pa"],
                         "punti_a_giornata": g.get("pg")})
    rose.sort(key=lambda r: (nomi.index(r["fantasquadra"]), RUOLI.index(r["ruolo"]), -r["prezzo"], r["giocatore"]))
    _scrivi(cartella / "rose.csv", list(rose[0].keys()), rose)

    # --- riepilogo per fantasquadra e per ruolo ---
    squadre = []
    for k, nome in enumerate(nomi):
        suoi = [r for r in rose if r["fantasquadra"] == nome]
        riga = {"fantasquadra": nome, "mia": int(k == io), "giocatori": len(suoi),
                "slot_liberi": sum(slot.values()) - len(suoi),
                "crediti_spesi": sum(r["prezzo"] for r in suoi), "crediti_rimasti": crediti - sum(r["prezzo"] for r in suoi)}
        for r in RUOLI:
            del_ruolo = [x for x in suoi if x["ruolo"] == r]
            riga[f"n_{r}"] = len(del_ruolo)
            riga[f"spesa_{r}"] = sum(x["prezzo"] for x in del_ruolo)
        caro = max(suoi, key=lambda x: x["prezzo"])
        riga["acquisto_piu_caro"] = f"{caro['giocatore']} ({caro['prezzo']})"
        squadre.append(riga)
    _scrivi(cartella / "squadre.csv", list(squadre[0].keys()), squadre)

    ruoli = []
    for r in RUOLI:
        suoi = [a for a in acquisti if a["ruolo"] == r]
        pagato, previsto = sum(a["prezzo"] for a in suoi), sum(a["prezzo_previsto"] for a in suoi)
        caro = max(suoi, key=lambda a: a["prezzo"])
        ruoli.append({"ruolo": r, "assegnati": len(suoi), "slot_in_lega": slot[r] * len(nomi),
                      "crediti_pagati": pagato, "crediti_previsti": previsto,
                      "pagato_su_previsto": round(pagato / max(1, previsto), 3),
                      "media_a_giocatore": round(pagato / len(suoi), 2),
                      "acquisto_piu_caro": f"{caro['giocatore']} ({caro['prezzo']}, {caro['fantasquadra']})"})
    _scrivi(cartella / "ruoli.csv", list(ruoli[0].keys()), ruoli)

    # --- README della cartella ---
    fine = _ora(asta["log"][-1]["ora"])
    tot_slot = sum(slot.values()) * len(nomi)
    spesi = sum(a["prezzo"] for a in acquisti)
    locale = lambda t: t.astimezone(ROMA).strftime("%H:%M")  # noqa: E731
    righe_sq = "\n".join(
        f"| {s['fantasquadra']}{' (io)' if s['mia'] and nomi_veri else ''} | {s['giocatori']} | {s['crediti_spesi']} | {s['crediti_rimasti']} | "
        + " | ".join(str(s[f"spesa_{r}"]) for r in RUOLI) + f" | {s['acquisto_piu_caro']} |" for s in squadre)
    righe_r = "\n".join(
        f"| {NOMI_RUOLO[x['ruolo']]} | {x['assegnati']}/{x['slot_in_lega']} | {x['crediti_pagati']} | {x['crediti_previsti']} | "
        f"{round(x['pagato_su_previsto'] * 100)}% | {str(x['media_a_giocatore']).replace('.', ',')} | {x['acquisto_piu_caro']} |" for x in ruoli)
    incompleta = "" if len(acquisti) == tot_slot else (
        f" L'export e' stato fatto con {tot_slot - len(acquisti)} slot ancora liberi: l'asta non risulta chiusa nel tool.")
    readme = f"""# Asta del {inizio.astimezone(ROMA).strftime('%d/%m/%Y')}

{len(nomi)} squadre, {crediti} crediti, rosa {'-'.join(str(slot[r]) for r in RUOLI)}, chiamata {'per ruolo' if asta.get('modo') != 'libero' else 'libera'}.
Dalle {locale(inizio)} alle {locale(fine)} (ora italiana): {len(acquisti)} acquisti su {tot_slot} slot, {spesi} crediti spesi su {crediti * len(nomi)}.{incompleta}

## File

| File | Cosa contiene |
|---|---|
| `asta.json` | L'export del tool (*Esporta l'asta*){"" if nomi_veri else ", con i nomi delle fantasquadre resi anonimi"}. Con *Importa* si ricarica nel tool. |
| `acquisti.csv` | Una riga per acquisto, nell'ordine dell'asta: ora, giocatore, chi l'ha preso, prezzo, prezzo previsto prima dell'asta e scarto, le medie degli ultimi {FINESTRA} acquisti (quelle del grafico), i crediti spesi fin li', quotazione, FVM, fascia e punti attesi. |
| `rose.csv` | Le rose finali: una riga per giocatore, con il prezzo pagato. |
| `squadre.csv` | Per fantasquadra: giocatori, crediti spesi e rimasti, numero e spesa per ruolo. |
| `ruoli.csv` | Per ruolo: assegnati, crediti pagati contro previsti, media a giocatore. |
| `grafico.csv`, `grafico.png`, `grafico_riquadri.json` | Il grafico *Andamento del mercato* letto dal sito con `src/tools/scraping_grafico_asta.js`: una riga per colonna del grafico, l'immagine e i numeri dei riquadri. |

{"" if nomi_veri else "Le fantasquadre sono anonime: *La mia squadra* e *Squadra 2*, *Squadra 3*... nell'ordine in cui erano sedute al tavolo." + chr(10)}`mia` vale 1 per la mia squadra. `turno_giro` e' la squadra a cui toccava chiamare nel giro al momento dell'acquisto
(se aveva gia' il ruolo pieno ha chiamato la successiva). `nel_mio_piano` e `prezzo_nel_piano` vengono dal piano con cui
e' stata avviata l'asta. I prezzi previsti, le fasce e i punti sono quelli dei dati `{meta.get('versione', '')}`
(Serie A {meta.get('stagione', '')}, dati alla {meta.get('giornata', '')}ª giornata).
{confronto}

## Per fantasquadra

| Fantasquadra | Giocatori | Spesi | Rimasti | P | D | C | A | Acquisto piu' caro |
|---|---|---|---|---|---|---|---|---|
{righe_sq}

## Per ruolo

| Ruolo | Assegnati | Pagati | Previsti | Pagato sul previsto | Media a giocatore | Acquisto piu' caro |
|---|---|---|---|---|---|---|
{righe_r}

## Rigenerare

    python src/tools/archivia_asta.py {cartella.as_posix()}/asta.json
    node src/tools/scraping_grafico_asta.js {cartella.as_posix()}/asta.json {cartella.as_posix()}
"""
    (cartella / "README.md").write_text(readme.replace(RADICE.as_posix() + "/", ""), encoding="utf-8")
    return cartella


if __name__ == "__main__":
    radice = RADICE
    ap = argparse.ArgumentParser(description="Storicizza un'asta esportata dal tool in data/aste/<data>/.")
    ap.add_argument("export", type=Path, help='il testo di "Esporta l\'asta", salvato in un file')
    ap.add_argument("--uscita", type=Path, default=radice / "data" / "aste")
    ap.add_argument("--dati", type=Path, default=radice / "src" / "web" / "data.json")
    ap.add_argument("--nomi-veri", action="store_true", help="lascia i nomi delle fantasquadre come sono nell'export")
    a = ap.parse_args()
    print(archivia(a.export, a.uscita, a.dati, a.nomi_veri))
