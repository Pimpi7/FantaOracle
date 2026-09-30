"""Dagli eventi al punteggio, e dal punteggio al risultato h2h.

Questo modulo traduce le regole di league.yaml in numeri. Non contiene modello
statistico: riceve eventi (veri o simulati) e restituisce punti. Tutto vettoriale
su numpy, perche' verra' chiamato su array di simulazioni, non su singole righe.

Il principio che governa tutto il modulo: **le funzioni a gradini si applicano
dentro la simulazione, non alla media**. La lega ne ha due, il modificatore
difesa e la conversione punti -> gol, e per entrambe E[f(X)] != f(E[X]). Calcolare
la media e poi leggere la tabella e' l'errore piu' comune in questo dominio, e
produce numeri plausibili e sbagliati. Le funzioni qui sotto accettano array
proprio per rendere difficile sbagliare.
"""

from __future__ import annotations

import numpy as np

from ..config import LeagueConfig

# --- fantavoto da eventi -----------------------------------------------------


def fantavoto(
    voto: np.ndarray,
    cfg: LeagueConfig,
    gol: np.ndarray | int = 0,
    assist: np.ndarray | int = 0,
    ammonizioni: np.ndarray | int = 0,
    espulsioni: np.ndarray | int = 0,
    rigori_segnati: np.ndarray | int = 0,
    rigori_sbagliati: np.ndarray | int = 0,
    rigori_parati: np.ndarray | int = 0,
    autogol: np.ndarray | int = 0,
    gol_subiti: np.ndarray | int = 0,
    imbattuto: np.ndarray | int = 0,
) -> np.ndarray:
    """Voto piu' bonus meno malus, con i valori presi dal config.

    `gol` e `rigori_segnati` sono contati separatamente ma nella tabella classica
    valgono lo stesso: il rigore trasformato e' un gol a tutti gli effetti. Restano
    distinti perche' servono separati al modello (i rigori si predicono in modo
    diverso dai gol su azione) e perche' una lega potrebbe valorizzarli diversamente.

    `gol_subiti` e `imbattuto` si applicano ai soli portieri: e' il chiamante a
    passarli a zero per gli altri ruoli.
    """
    b = cfg.get("bonus")
    return (
        np.asarray(voto, dtype=float)
        + b["gol_segnato"] * np.asarray(gol)
        + b["rigore_segnato"] * np.asarray(rigori_segnati)
        + b["assist"] * np.asarray(assist)
        + b["rigore_parato"] * np.asarray(rigori_parati)
        + b["portiere_imbattuto"] * np.asarray(imbattuto)
        + b["ammonizione"] * np.asarray(ammonizioni)
        + b["espulsione"] * np.asarray(espulsioni)
        + b["rigore_sbagliato"] * np.asarray(rigori_sbagliati)
        + b["autogol"] * np.asarray(autogol)
        + b["gol_subito"] * np.asarray(gol_subiti)
    )


# --- modificatore difesa -----------------------------------------------------


def _tabella(soglie: list) -> tuple[np.ndarray, np.ndarray]:
    arr = np.asarray(soglie, dtype=float)
    ordine = np.argsort(arr[:, 0])
    return arr[ordine, 0], arr[ordine, 1]


def bonus_da_tabella(media: np.ndarray, soglie: list) -> np.ndarray:
    """Applica una tabella a gradini a un array di medie.

    Restituisce il valore della fascia piu' alta raggiunta, 0 sotto la prima
    soglia. Vettoriale: `media` puo' essere un array di simulazioni.
    """
    livelli, valori = _tabella(soglie)
    media = np.asarray(media, dtype=float)
    # searchsorted con 'right' conta quante soglie sono <= media.
    idx = np.searchsorted(livelli, media, side="right") - 1
    return np.where(idx >= 0, valori[np.clip(idx, 0, None)], 0.0)


def media_difensiva(
    voto_portiere: np.ndarray,
    voti_difensori: np.ndarray,
    cfg: LeagueConfig,
) -> np.ndarray:
    """Media dei voti puri su cui si calcola il modificatore difesa.

    Regola Fantacalcio.it: portiere piu' i `n_difensori` MIGLIORI difensori, su
    una base fissa di `base_calcolo` voti. I voti sono quelli puri della pagella,
    senza bonus ne' malus: un difensore che segna entra col suo voto, non col
    fantavoto.

    `voti_difensori` ha forma (n_simulazioni, n_difensori_schierati). Si prendono
    i migliori, quindi schierarne 5 invece di 4 e' un vantaggio: il peggiore viene
    scartato.
    """
    n_migliori = cfg.get("modificatori.difesa.n_difensori")
    base = cfg.get("modificatori.difesa.base_calcolo")
    include_p = cfg.get("modificatori.difesa.include_portiere")

    d = np.atleast_2d(np.asarray(voti_difensori, dtype=float))
    if d.shape[1] < n_migliori:
        raise ValueError(
            f"Servono almeno {n_migliori} difensori per il modificatore, "
            f"ricevuti {d.shape[1]}."
        )

    # Ordine decrescente, poi si tagliano i migliori n.
    migliori = np.sort(d, axis=1)[:, ::-1][:, :n_migliori]

    if include_p:
        p = np.asarray(voto_portiere, dtype=float).reshape(-1, 1)
        somma = p.sum(axis=1) + migliori.sum(axis=1)
    else:
        somma = migliori.sum(axis=1)

    return somma / base


def modificatore_difesa(
    voto_portiere: np.ndarray,
    voti_difensori: np.ndarray,
    cfg: LeagueConfig,
    n_difensori_schierati: int | None = None,
) -> np.ndarray:
    """Bonus difensivo, applicato simulazione per simulazione.

    Il modificatore richiede almeno 4 difensori schierati piu' il portiere: con
    una difesa a 3 non si attiva e il bonus e' zero per l'intera giornata.
    """
    if not cfg.get("modificatori.difesa.attivo", default=False):
        return np.zeros(np.atleast_2d(voti_difensori).shape[0])

    minimo_schierati = cfg.get("modificatori.difesa.base_calcolo")
    schierati = n_difensori_schierati
    if schierati is None:
        schierati = np.atleast_2d(voti_difensori).shape[1]

    if schierati < minimo_schierati:
        return np.zeros(np.atleast_2d(voti_difensori).shape[0])

    media = media_difensiva(voto_portiere, voti_difensori, cfg)
    return bonus_da_tabella(media, cfg.get("modificatori.difesa.soglie"))


# --- punteggio di squadra e risultato h2h ------------------------------------


def punteggio_squadra(
    fantavoti: np.ndarray,
    cfg: LeagueConfig,
    voto_portiere: np.ndarray | None = None,
    voti_difensori: np.ndarray | None = None,
    n_difensori_schierati: int | None = None,
) -> np.ndarray:
    """Somma degli undici piu' i modificatori.

    `fantavoti` ha forma (n_simulazioni, 11). I voti puri di portiere e difensori
    vanno passati a parte perche' il modificatore lavora su quelli, non sui
    fantavoti.
    """
    totale = np.asarray(fantavoti, dtype=float).sum(axis=1)

    if voto_portiere is not None and voti_difensori is not None:
        totale = totale + modificatore_difesa(
            voto_portiere, voti_difensori, cfg, n_difensori_schierati
        )

    return totale


def punti_a_gol(punteggio: np.ndarray, cfg: LeagueConfig) -> np.ndarray:
    """Conversione punteggio -> gol con le soglie della lega.

    Seconda funzione a gradini del regolamento: 66 punti un gol, 72 due, e cosi'
    via. Da applicare alle singole simulazioni, mai al punteggio medio.
    """
    soglie = np.asarray(cfg.get("punteggio.soglie_gol"), dtype=float)
    p = np.asarray(punteggio, dtype=float)
    return (p[..., None] >= soglie).sum(axis=-1)


def risultato_h2h(
    punteggio_casa: np.ndarray, punteggio_ospite: np.ndarray, cfg: LeagueConfig
) -> tuple[np.ndarray, np.ndarray]:
    """Gol delle due squadre in un confronto diretto."""
    return punti_a_gol(punteggio_casa, cfg), punti_a_gol(punteggio_ospite, cfg)


def punti_classifica(
    gol_nostri: np.ndarray, gol_avversari: np.ndarray
) -> np.ndarray:
    """3 per la vittoria, 1 per il pareggio, 0 per la sconfitta."""
    return np.where(gol_nostri > gol_avversari, 3, np.where(gol_nostri == gol_avversari, 1, 0))


def prob_vittoria(
    punteggio_nostro: np.ndarray, punteggio_avversario: np.ndarray, cfg: LeagueConfig
) -> dict[str, float]:
    """Esiti attesi di un confronto, dalle simulazioni delle due squadre.

    Questo e' l'obiettivo da massimizzare nella scelta della formazione in una
    lega h2h: non il punteggio atteso, ma i punti in classifica attesi contro
    quell'avversario. Le due cose divergono, e la divergenza e' il motivo per cui
    serve la simulazione.
    """
    gn, ga = risultato_h2h(punteggio_nostro, punteggio_avversario, cfg)
    pt = punti_classifica(gn, ga)
    return {
        "p_vittoria": float((gn > ga).mean()),
        "p_pareggio": float((gn == ga).mean()),
        "p_sconfitta": float((gn < ga).mean()),
        "punti_attesi": float(pt.mean()),
        "punteggio_medio": float(np.asarray(punteggio_nostro).mean()),
        "gol_medi": float(gn.mean()),
    }
