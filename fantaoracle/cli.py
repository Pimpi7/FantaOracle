"""Interfaccia a riga di comando.

    python -m fantaoracle status     stato di config, snapshot e database
    python -m fantaoracle ingest     raccolta dati da tutte le fonti
    python -m fantaoracle db         ricostruisce il database dagli snapshot
    python -m fantaoracle model      proiezioni e valutazioni
    python -m fantaoracle export     dati per il tool web
    python -m fantaoracle all        tutta la pipeline, nell'ordine
"""

from __future__ import annotations

import argparse
import sys

from . import __version__
from .config import load_league, pending_fields
from .paths import RAW
from .store import list_snapshots

STAGIONI_STORICHE = {"2023-24": 38, "2024-25": 38, "2025-26": 38}
STAGIONE_CORRENTE = "2026-27"


def cmd_status(_args) -> int:
    print(f"fantaoracle {__version__}\n")
    pend = pending_fields(load_league())
    print(f"Regole da confermare: {', '.join(pend) if pend else 'nessuna'}\n")

    print("Snapshot raccolti:")
    for fonte in sorted(p for p in RAW.glob("*") if p.is_dir()):
        for ds in sorted(p for p in fonte.glob("*") if p.is_dir()):
            date = list_snapshots(fonte.name, ds.name)
            if date:
                print(f"  {fonte.name}/{ds.name}: {len(date)} (ultimo {date[-1]})")

    from .db import DB_PATH
    print(f"\nDatabase: {'presente' if DB_PATH.exists() else 'assente, lanciare `db`'}")
    return 0


def giornate_giocate() -> int:
    """Ultima giornata conclusa della stagione corrente, dal calendario Understat."""
    from .store import read_snapshot
    cal = read_snapshot("understat", "calendario")
    corr = cal[cal["anno"] == int(STAGIONE_CORRENTE[:4])]
    return int(corr["giocata"].sum() // 10)


def cmd_ingest(args) -> int:
    from .ingest import fantacalcio_it, footballdata, sosfanta, understat

    fonti = ["understat", "footballdata", "listone", "voti", "sosfanta"] if args.fonte == "all" \
        else [args.fonte]
    # Le fasce sono un'etichetta in piu' accanto alle stime, non un dato da cui
    # dipende il modello: se SOS Fanta cambia pagina o non risponde, l'aggiornamento
    # di tutto il resto deve andare avanti (il tool mostra l'ultima fascia salvata).
    facoltative = {"sosfanta"}
    errori = 0
    for f in fonti:
        print(f"[{f}]")
        try:
            if f == "understat":
                understat.ingest()
            elif f == "footballdata":
                footballdata.ingest(["2324", "2425", "2526", "2627"])
            elif f == "listone":
                fantacalcio_it.ingest_listone()
            elif f == "voti":
                if list_snapshots("fantacalcio_it", "voti") and not args.completo:
                    fantacalcio_it.aggiorna_voti_correnti(STAGIONE_CORRENTE, giornate_giocate())
                else:
                    stagioni = dict(STAGIONI_STORICHE)
                    stagioni[STAGIONE_CORRENTE] = giornate_giocate()
                    fantacalcio_it.ingest_voti(stagioni)
            elif f == "sosfanta":
                sosfanta.ingest()
        except Exception as e:                                  # noqa: BLE001
            if f in facoltative:
                print(f"  saltato (fonte facoltativa): {type(e).__name__}: {e}")
            else:
                print(f"  fallito: {type(e).__name__}: {e}")
                errori += 1
    return 1 if errori else 0


def cmd_db(_args) -> int:
    from .db import build
    esito = build()
    return 1 if esito["problemi"] else 0


def cmd_model(_args) -> int:
    from .model.pipeline import run
    run()
    return 0


def cmd_export(_args) -> int:
    from .export import esporta
    esporta()
    return 0


def cmd_all(args) -> int:
    args.fonte = "all"
    args.completo = False
    for passo in (cmd_ingest, cmd_db, cmd_model, cmd_export):
        if passo(args):
            print(f"Pipeline interrotta a {passo.__name__}.")
            return 1
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="fantaoracle")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status").set_defaults(func=cmd_status)
    s = sub.add_parser("ingest")
    s.add_argument("--fonte", default="all",
                   choices=["all", "understat", "footballdata", "listone", "voti", "sosfanta"])
    s.add_argument("--completo", action="store_true",
                   help="riscarica anche le stagioni concluse")
    s.set_defaults(func=cmd_ingest)
    sub.add_parser("db").set_defaults(func=cmd_db)
    sub.add_parser("model").set_defaults(func=cmd_model)
    sub.add_parser("export").set_defaults(func=cmd_export)
    sub.add_parser("all").set_defaults(func=cmd_all)
    args = p.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
