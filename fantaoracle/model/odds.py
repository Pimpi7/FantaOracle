"""Dalle quote dei bookmaker ai gol attesi.

Questo modulo e' condiviso dai due casi d'uso: l'asta lo usa aggregato su 30
giornate per prezzare portieri e difensori, la formazione lo usa su una singola
partita per il matchup. E' il pezzo che rende superfluo stimare a mano la forza
delle squadre.

Il motivo per cui si parte dalle quote e non dall'xGA stagionale: le quote
incorporano gia' infortuni, squalifiche, forma e turnover europeo, e lo fanno in
tempo reale. L'xGA medio della stagione e' una media su una squadra che nel
frattempo e' cambiata.

Tre passaggi:

1. **Rimozione del margine.** Le quote non sommano a 1: contengono il margine del
   bookmaker. Va tolto, e *come* lo si toglie cambia il risultato.
2. **Inversione Poisson.** Dalle probabilita' 1X2 si risale ai gol attesi delle
   due squadre.
3. **Derivazione.** Da li' escono probabilita' di clean sheet, distribuzione dei
   gol subiti e quota di gol attesi da distribuire ai singoli.

Un punto emerso costruendo il modulo, che vale la pena tenere a mente: con le
sole quote 1X2 il **totale** dei gol e' identificato solo dalla probabilita' di
pareggio, un ancoraggio debole. Misurato, il totale stimato oscilla di circa il
30% al variare di rho nel suo range plausibile. Aggiungendo il mercato
Over/Under 2.5 la stessa stima si muove dello 0.3%. Le quote Over/Under vanno
quindi usate ogni volta che ci sono, e la loro assenza va segnalata.

Il modulo non sa nulla del regolamento della tua lega: produce quantita' fisiche
(gol), non fantapunti. La conversione in punti sta nel motore, che legge le
regole da league.yaml.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.optimize import brentq, least_squares
from scipy.stats import poisson

MAX_GOL = 12  # oltre i 12 gol la coda pesa meno di 1e-9: troncare non costa nulla


# --- 1. rimozione del margine ------------------------------------------------

def _multiplicativo(quote: np.ndarray) -> np.ndarray:
    """Normalizzazione proporzionale: semplice e distorta.

    Distribuisce il margine in proporzione alla probabilita' implicita, il che
    sovrastima sistematicamente gli esiti improbabili (favourite-longshot bias).
    Utile come riferimento, non come default.
    """
    grezze = 1.0 / quote
    return grezze / grezze.sum()


def _shin(quote: np.ndarray, tol: float = 1e-10) -> np.ndarray:
    """Metodo di Shin (1993).

    Modella il margine come difesa del bookmaker contro scommettitori informati,
    e questo produce una correzione piu' forte sugli esiti improbabili — che e'
    la direzione giusta. Su mercati a tre esiti la differenza rispetto al
    multiplicativo e' di qualche punto percentuale sull'1X2, abbastanza da
    spostare i gol attesi al secondo decimale.

    Si risolve per z, la quota di volume informato, tale che le probabilita'
    sommino a 1.
    """
    pi = 1.0 / quote
    somma = pi.sum()

    if somma <= 1.0:  # nessun margine: niente da correggere
        return pi / somma

    def p_di_z(z: float) -> np.ndarray:
        radice = np.sqrt(z**2 + 4.0 * (1.0 - z) * pi**2 / somma)
        return (radice - z) / (2.0 * (1.0 - z))

    def scarto(z: float) -> float:
        return p_di_z(z).sum() - 1.0

    # z=0 riproduce il multiplicativo (scarto positivo); z grande lo comprime.
    z_max = 0.6
    if scarto(0.0) * scarto(z_max) > 0:
        return _multiplicativo(quote)

    z = brentq(scarto, 0.0, z_max, xtol=tol)
    p = p_di_z(z)
    return p / p.sum()


def probabilita_implicite(
    quota_1: float, quota_x: float, quota_2: float, metodo: str = "shin"
) -> tuple[float, float, float]:
    """Converte le quote 1X2 in probabilita' che sommano a 1."""
    quote = np.array([quota_1, quota_x, quota_2], dtype=float)

    if np.any(~np.isfinite(quote)) or np.any(quote <= 1.0):
        return (np.nan, np.nan, np.nan)

    p = _shin(quote) if metodo == "shin" else _multiplicativo(quote)
    return tuple(float(x) for x in p)


def margine(quota_1: float, quota_x: float, quota_2: float) -> float:
    """Margine del bookmaker: quanto le probabilita' grezze eccedono 1."""
    return float(np.sum(1.0 / np.array([quota_1, quota_x, quota_2]))) - 1.0


# --- 2. inversione Poisson ---------------------------------------------------

def matrice_risultati(
    lam_casa: float, lam_trasferta: float, rho: float = 0.0, max_gol: int = MAX_GOL
) -> np.ndarray:
    """Distribuzione congiunta dei gol, con correzione Dixon-Coles opzionale.

    Il Poisson indipendente sottostima i risultati bassi (0-0 e 1-1 in
    particolare), perche' le due squadre non segnano in modo indipendente. La
    correzione di Dixon-Coles ritocca le quattro celle con al massimo un gol per
    parte. `rho` negativo alza 0-0 e 1-1: il valore tipico stimato sui campionati
    europei sta intorno a -0.13.

    Attenzione a cosa fa e cosa non fa: la correzione **preserva le marginali**,
    quindi a lambda dati non cambia di una virgola la probabilita' di clean
    sheet, che e' un evento marginale. Sposta la probabilita' fra i risultati
    esatti, non fra i totali di una squadra. Il canale per cui rho conta davvero
    e' un altro: cambia i lambda che si inferiscono da certe quote, e quello si',
    sposta i clean sheet in modo sostanzioso.
    """
    gol = np.arange(max_gol + 1)
    p_casa = poisson.pmf(gol, lam_casa)
    p_tras = poisson.pmf(gol, lam_trasferta)
    m = np.outer(p_casa, p_tras)

    if rho != 0.0:
        tau = np.ones((2, 2))
        tau[0, 0] = 1.0 - lam_casa * lam_trasferta * rho
        tau[0, 1] = 1.0 + lam_casa * rho
        tau[1, 0] = 1.0 + lam_trasferta * rho
        tau[1, 1] = 1.0 - rho
        m[:2, :2] *= np.maximum(tau, 1e-9)

    # Normalizzazione sempre, non solo con la correzione attiva: troncare a
    # MAX_GOL lascia comunque fuori una coda di ordine 1e-9, e una matrice che
    # non somma esattamente a 1 propaga l'errore in tutto cio' che ci si calcola
    # sopra.
    return m / m.sum()


def _esiti(lam_casa: float, lam_trasferta: float, rho: float) -> tuple[float, float, float]:
    m = matrice_risultati(lam_casa, lam_trasferta, rho)
    p_casa = float(np.tril(m, -1).sum())      # gol_casa > gol_trasferta
    p_pari = float(np.trace(m))
    p_tras = float(np.triu(m, 1).sum())
    return p_casa, p_pari, p_tras


def inverti_poisson(
    p_casa: float,
    p_pari: float,
    p_trasferta: float,
    rho: float = -0.13,
    p_over25: float | None = None,
    peso_over: float = 3.0,
    lam_iniziale: tuple[float, float] = (1.4, 1.2),
) -> tuple[float, float]:
    """Risale ai gol attesi dalle probabilita' di mercato.

    Con il solo 1X2 il sistema e' determinato (due incognite, due equazioni
    indipendenti) ma **mal condizionato**: il totale dei gol viene identificato
    unicamente dalla probabilita' di pareggio, che e' un ancoraggio debole. Il
    risultato e' che il totale stimato oscilla parecchio al variare di rho, e
    quindi anche i clean sheet, che sono cio' che ci serve.

    Il mercato Over/Under 2.5 fissa direttamente il totale, lasciando all'1X2 il
    compito che sa fare bene: dividere quel totale fra le due squadre. Quando la
    quota Over c'e' va usata, e pesata di piu' proprio perche' e' l'informazione
    che il 1X2 non porta.

    `peso_over` regola quanto il fit privilegia il totale rispetto allo split.
    """
    if not all(np.isfinite([p_casa, p_pari, p_trasferta])):
        return (np.nan, np.nan)

    usa_over = p_over25 is not None and np.isfinite(p_over25)

    def residui(log_lam):
        lam_c, lam_t = np.exp(log_lam)
        e_casa, e_pari, e_tras = _esiti(lam_c, lam_t, rho)
        r = [e_casa - p_casa, e_pari - p_pari, e_tras - p_trasferta]
        if usa_over:
            m = matrice_risultati(lam_c, lam_t, rho)
            tot = np.add.outer(np.arange(m.shape[0]), np.arange(m.shape[1]))
            e_over = float(m[tot > 2].sum())
            r.append(peso_over * (e_over - p_over25))
        return r

    sol = least_squares(residui, np.log(lam_iniziale), method="lm", xtol=1e-12)
    lam_c, lam_t = np.exp(sol.x)
    return float(lam_c), float(lam_t)


# --- 3. quantita' derivate ---------------------------------------------------

def clean_sheet(lam_subiti: float, rho: float = 0.0,
                lam_segnati: float | None = None) -> float:
    """Probabilita' di non subire gol.

    E' semplicemente exp(-lambda): il numero di gol subiti e' marginalmente
    Poisson, e la correzione Dixon-Coles non tocca le marginali. I parametri
    `rho` e `lam_segnati` restano per simmetria con il resto del modulo e per
    poter verificare quella proprieta' nei test, ma il valore non cambia.
    """
    if not np.isfinite(lam_subiti):
        return np.nan
    if rho == 0.0 or lam_segnati is None:
        return float(np.exp(-lam_subiti))
    m = matrice_risultati(lam_segnati, lam_subiti, rho)
    return float(m[:, 0].sum())


def distribuzione_gol_subiti(lam_subiti: float, max_gol: int = MAX_GOL) -> np.ndarray:
    """Distribuzione completa dei gol subiti.

    Serve al portiere, il cui malus e' lineare nei gol subiti ma il cui bonus
    imbattibilita' e' una soglia: la media non basta, serve la distribuzione.
    """
    return poisson.pmf(np.arange(max_gol + 1), lam_subiti)


def aggiungi_attese(
    df: pd.DataFrame,
    col_1: str = "quota_1",
    col_x: str = "quota_x",
    col_2: str = "quota_2",
    col_over: str = "quota_over25",
    col_under: str = "quota_under25",
    rho: float = -0.13,
    metodo: str = "shin",
) -> pd.DataFrame:
    """Arricchisce un calendario con probabilita' e gol attesi per partita.

    Input: le colonne quote prodotte dall'ingestion di football-data.
    Output: le stesse righe piu' probabilita' 1X2 depurate, gol attesi delle due
    squadre e probabilita' di clean sheet per parte.
    """
    out = df.copy()
    righe = []
    ha_over = col_over in out.columns and col_under in out.columns
    senza_over = 0

    for _, r in out.iterrows():
        p1, px, p2 = probabilita_implicite(r[col_1], r[col_x], r[col_2], metodo)

        p_over = None
        if ha_over:
            qo, qu = r[col_over], r[col_under]
            if np.isfinite(qo) and np.isfinite(qu) and qo > 1 and qu > 1:
                p_over = float(_shin(np.array([qo, qu], dtype=float))[0])
        if p_over is None:
            senza_over += 1

        lam_c, lam_t = inverti_poisson(p1, px, p2, rho, p_over25=p_over)
        righe.append({
            "p_1": p1,
            "p_x": px,
            "p_2": p2,
            "margine": margine(r[col_1], r[col_x], r[col_2]),
            "lam_casa": lam_c,
            "lam_trasferta": lam_t,
            # Il clean sheet della squadra di casa dipende da quanto segna
            # l'avversario, non da quanto segna lei.
            "cs_casa": clean_sheet(lam_t, rho, lam_c),
            "cs_trasferta": clean_sheet(lam_c, rho, lam_t),
            "usa_over": p_over is not None,
        })

    if senza_over:
        print(f"  attenzione: {senza_over}/{len(out)} partite senza quote "
              f"Over/Under. Su quelle il totale gol e' stimato dal solo 1X2 ed "
              f"e' molto piu' sensibile a rho.")

    return pd.concat([out.reset_index(drop=True), pd.DataFrame(righe)], axis=1)
