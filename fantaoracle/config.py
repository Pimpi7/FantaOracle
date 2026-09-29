"""Caricamento del config di lega.

Il principio: nessuna regola di gioco vive nel codice. Se un modulo ha bisogno di
una regola non ancora confermata, deve fallire subito con un messaggio che dice
esattamente quale campo manca. Un default silenzioso qui produce proiezioni
sbagliate che sembrano giuste, che e' il modo peggiore di sbagliare.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import yaml

from .paths import CONFIG_DIR

PENDING = "PENDING"


class RegolaMancante(KeyError):
    """Sollevata quando si legge una regola non ancora confermata."""


@dataclass(frozen=True)
class LeagueConfig:
    raw: dict[str, Any]

    def get(self, path: str, default: Any = None) -> Any:
        """Legge una regola con notazione a punti: cfg.get('bonus.gol_segnato').

        Solleva RegolaMancante se il valore e' ancora PENDING e non e' stato
        passato un default esplicito.
        """
        node: Any = self.raw
        walked: list[str] = []
        for key in path.split("."):
            walked.append(key)
            if not isinstance(node, dict) or key not in node:
                raise RegolaMancante(
                    f"Campo '{path}' assente in league.yaml "
                    f"(interrotto a '{'.'.join(walked)}')."
                )
            node = node[key]

        if node == PENDING:
            if default is not None:
                return default
            raise RegolaMancante(
                f"La regola '{path}' e' ancora PENDING in config/league.yaml. "
                f"Serve confermarla prima di eseguire questo passaggio."
            )
        return node

    def is_pending(self, path: str) -> bool:
        try:
            self.get(path)
        except RegolaMancante:
            return True
        return False

    @property
    def slot_totali(self) -> int:
        slot = self.get("formato.slot")
        if any(v == PENDING for v in slot.values()):
            raise RegolaMancante("formato.slot contiene valori PENDING.")
        return sum(slot.values())

    @property
    def crediti_lega(self) -> int:
        return self.get("formato.n_squadre") * self.get("formato.crediti_iniziali")


def load_league(path: str | None = None) -> LeagueConfig:
    fp = CONFIG_DIR / "league.yaml" if path is None else path
    with open(fp, encoding="utf-8") as fh:
        return LeagueConfig(raw=yaml.safe_load(fh))


def pending_fields(cfg: LeagueConfig) -> list[str]:
    """Elenca tutti i campi ancora da confermare, per il comando `status`."""
    out: list[str] = []

    def walk(node: Any, prefix: str) -> None:
        if isinstance(node, dict):
            for k, v in node.items():
                walk(v, f"{prefix}.{k}" if prefix else k)
        elif node == PENDING:
            out.append(prefix)

    walk(cfg.raw, "")
    return sorted(out)
