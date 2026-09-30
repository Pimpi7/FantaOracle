> Piano originale del 29 settembre 2026, scritto quando l'asta era prevista dopo il 20 ottobre.
> L'asta è stata poi fissata al 2 ottobre: il piano è stato compresso e lo stato aggiornato è in [specifiche.md](../specifiche.md).

# fantaorb — Roadmap v1 (costruttore di rosa)

Stato al 29 settembre 2026. Da approvare prima dello sviluppo.

## Requisiti

### Regole della lega (confermate)
Serie A, Classic, 8 squadre, 500 crediti, rosa 3-8-8-6. H2H con conversione 66 punti = 1 gol, poi uno ogni 6. Bonus/malus classici Fantacalcio.it, voti redazione Fantacalcio.it. Modificatore difesa classico: media 6,00 → +1, 6,50 → +3, 7,00 → +6, su portiere + 3 migliori difensori, solo con difesa a 4 o 5. Switch basic. Asta dopo il 20 ottobre: si comprano circa 30 giornate.

### Tool: costruttore di rosa
- **R1 Listone.** Tutti i giocatori, con filtri per ruolo, squadra, fascia di prezzo e ricerca per nome. Ordinato per il nostro punteggio, non per fantamedia.
- **R2 Scheda giocatore.** Da cosa nasce il punteggio: presenze attese, voto atteso, bonus attesi, calendario, rigori, indisponibilità.
- **R3 Costruzione guidata.** Inserisco un giocatore con il prezzo; il tool completa gli slot rimanenti e propone alternative per ciascuno.
- **R4 Budget realistico.** Ogni suggerimento usa il prezzo che il giocatore farà presumibilmente nella nostra asta, calibrato sui 4.000 crediti della lega, non la quotazione del listone.
- **R5 Diversificazione.** Tetto di giocatori per squadra reale.
- **R6 Fattore tifo.** Roma e Lazio costeranno di più: il prezzo atteso ne tiene conto, in misura contenuta.
- **R7 Piani.** Più rose in bozza (piano A, piano B), salvabili ed esportabili.

### Base dati
- **R8** Un database unico, ricostruibile dagli snapshot grezzi, con ID canonici e controlli di qualità, progettato per servire anche il tool formazione (probabili, proiezioni per giornata, rose della lega).

## Verifica delle fonti (29 settembre)

| Fonte | Cosa dà | Stato |
|---|---|---|
| Fantacalcio.it, pagine voti | voti e fantavoti per giornata, stagioni passate e corrente | pubbliche, senza login |
| Fantacalcio.it, quotazioni | listone 2026/27 completo | pubblico in HTML (l'Excel invece richiede login) |
| Understat | xG, xA, npxG, tiri, passaggi chiave, minuti; calendario completo | API funzionante |
| football-data.co.uk | risultati, quote 1X2 e Over/Under, ora anche xG di squadra | funzionante |
| Virgilio | probabili formazioni, indisponibili con data di rientro | funzionante |
| FBref | niente piu' xG/xA da febbraio 2026 | scartato |
| Transfermarkt | sito bloccato, dataset dcaribou su GitHub raggiungibile | opzionale |

Il rischio principale del progetto — i voti storici — e' risolto: sono pubblici. FBref esce dal piano, Understat prende il suo posto per xG e xA.

Limite noto: Understat copre i 5 grandi campionati. Per chi arriva da Eredivisie, Portogallo o simili non ci sono dati avanzati: per loro il punteggio si appoggia alla quotazione del listone e alle giornate giocate in Serie A.

## Architettura

```
snapshot grezzi (Parquet datati, mai sovrascritti)
   -> fantaorb.duckdb   (tabelle pulite, ID canonici, controlli)
   -> modello            (proiezioni, valore, prezzo atteso)
   -> export JSON
   -> pagina web         (listone + costruttore, anche da telefono)
```

### Tabelle principali
- `giocatori`, `squadre`, `alias` — anagrafica con ID Fantacalcio.it come chiave; alias per le altre fonti
- `partite` — calendario completo, risultati, quote, gol attesi, clean sheet
- `voti` — una riga per giocatore e giornata: voto, fantavoto, eventi (il target del modello)
- `stat_avanzate` — xG, xA, tiri, minuti per giocatore e stagione
- `quotazioni` — serie storica di quotazione e FVM
- `indisponibili`, `probabili` — snapshot con fonte e ora (servono gia' all'asta, poi alla formazione)
- `proiezioni` — output del modello, versionato
- `valutazioni` — valore, prezzo atteso, affare
- `rose_lega` — chi ha chi e a quanto (per l'asta e per il modulo avversario)
- `log_ingest` — ogni raccolta con esito e controlli

## Scelte di design

**Il punteggio.** Punti attesi a giornata = probabilita' di prendere voto × fantavoto atteso, sulle giornate che restano, con il calendario reale. Il fantavoto atteso somma voto atteso (storico con shrinkage verso la media di ruolo), bonus attesi (da xG e xA, non dai gol fatti; rigoristi a parte) e malus. Per portieri e difensori entrano gol subiti attesi, imbattibilita' e la quota del modificatore. Il punteggio va nel tool solo se batte le due baseline ovvie — fantamedia dell'anno scorso e fantamedia corrente — in un backtest sulla stagione 2025/26 congelata alla giornata 8.

**Il valore.** Il punteggio diventa crediti con il VORP: quanto un giocatore rende in piu' del sostituto disponibile (25esimo portiere, 65esimo difensore e centrocampista, 49esimo attaccante).

**Il prezzo atteso.** Parte da quotazione e FVM, e viene tarato perche' i prezzi dei giocatori che verranno comprati sommino ai 4.000 crediti della lega. L'affare e' valore meno prezzo atteso.

**Il fattore tifo.** Maggiorazione sul prezzo atteso dei giocatori di Roma e Lazio, piccola di default. Conta quanti tifosi ci sono: con due tifosi della stessa squadra che si rilanciano a vicenda il prezzo sale di piu' che con uno solo. I crediti spesi li' mancano altrove, quindi il resto del listone costa leggermente meno.

**Il costruttore.** L'obiettivo non e' la somma dei 25, ma la forza dell'undici che puoi schierare ogni settimana: i titolari pesano pieno, le riserve in proporzione a quanto serviranno davvero. Questo e' cio' che rende la rosa equilibrata invece di tre campioni e ventidue scarti, o venticinque medi. L'ottimizzatore gira nella pagina, quindi ogni modifica si ricalcola all'istante.

**Diversificazione.** Tetto di 3 giocatori per squadra reale, con eccezione opzionale per il blocco portieri.

## Fasi (date indicative)

| Fase | Cosa | Quando | Consegna |
|---|---|---|---|
| 1 | Base dati: raccolta, database, ID, controlli | 30 set – 4 ott | `fantaorb.duckdb` + report di copertura |
| 2 | Punteggio, valore, prezzo atteso, backtest | 5 – 10 ott | proiezioni validate + numeri del backtest |
| 3 | Tool: listone e costruttore guidato | 11 – 15 ott | pagina web da provare |
| 4 | Prova insieme, dati aggiornati alla g.8, correzioni | 16 – 19 ott | versione pre-asta |
| 5 | Modalita' asta live | dal 19 ott al giorno dell'asta | stesso tool, con stato dell'asta |
| 6 | Tool formazione | dopo l'asta | formazione con modificatore, switch e h2h |

## Dove vive il progetto
Il container di lavoro si azzera fra le sessioni. Il progetto e il database stanno sul PC (proposta: `Documenti\fantaoracle`), con una copia a ogni consegna.

## Domande aperte
1. Data esatta dell'asta.
2. Fra gli altri 7, quanti tifano Roma e quanti Lazio?
3. Tetto di 3 per squadra reale, con eccezione per il blocco portieri: va bene?
4. Cartella sul PC: va bene `Documenti\fantaoracle`?
