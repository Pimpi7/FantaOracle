# fantaOracle · specifiche tecniche

Documento tecnico completo: dati, database, modello, backtest, ottimizzatore e automazione.
Per una presentazione del tool e di come usarlo vedi il [README](README.md).

Framework dati per il fantacalcio. Raccoglie voti, statistiche avanzate e quote,
stima quanti punti farà ogni giocatore nelle giornate che restano, li converte in
crediti e ti aiuta a costruire la rosa all'asta con un budget realistico.

Tutto è costruito su una lega precisa (Serie A 2026/27, Classic, 8 squadre, 500
crediti, h2h con modificatore difesa), ma nessuna regola vive nel codice: stanno
tutte in [`config/league.yaml`](config/league.yaml).

---

## Il tool

Una pagina web statica ([`web/`](web/)), utilizzabile da computer e da telefono.

**Listone.** I 599 giocatori delle 20 squadre di quest'anno, filtrabili per
ruolo, squadra, prezzo e nome e ordinabili per ogni colonna. Al posto della
fantamedia mostra il nostro punteggio:

| Colonna | Significato |
|---|---|
| **Pt/g** | Punti attesi a giornata: probabilità di prendere voto × fantavoto atteso. Per portieri e difensori include la quota del modificatore difesa. |
| FM att. | Fantavoto atteso quando gioca |
| Pres. | Probabilità di prendere voto in una giornata |
| **Valore** | Quanto vale per noi, in crediti, rispetto a chi potremmo prendere al suo posto |
| **Prezzo** | Quanto costerà presumibilmente nella nostra asta |
| **Affare** | Valore meno prezzo |
| QA | Quotazione attuale Fantacalcio.it |

`RIG` segnala i rigoristi, `TIFO` i giocatori con prezzo maggiorato perché in
lega ci sono molti tifosi di quella squadra. Un clic sul nome apre la scheda: da
cosa nasce il punteggio, fantavoti di questa stagione, storico delle ultime tre.

**Costruttore guidato.** Metti in rosa chi vuoi, al prezzo che vuoi: il tool
completa gli slot rimanenti con la combinazione più forte che sta nel budget
restante e la evidenzia in giallo, anche nel listone. Ogni volta che cambi
qualcosa ricalcola. Per ogni suggerito propone le alternative che rientrano nel
budget. I giocatori esclusi (✕) escono dai suggerimenti.

Vincoli rispettati: rosa 3-8-8-6, 500 crediti, almeno 1 credito per ogni slot
ancora vuoto, al massimo 3 giocatori della stessa squadra reale (il blocco
portieri può essere escluso), margine di prudenza sui prezzi (0–30%).

Due strategie:
- **Omogenea**: i crediti vanno dove rendono di più, su tutta la rosa.
- **Top + 1 credito**: gli ultimi slot vanno a giocatori da 1 credito (terzo
  portiere, ultimi tre difensori, ultimi tre centrocampisti, ultimi due
  attaccanti), scelti fra i migliori che dovrebbero costare il minimo; il resto
  del budget si concentra sui titolari più forti. I giocatori che hai già preso
  a 1 credito contano nella quota del loro ruolo.

**Budget per ruolo.** In automatico l'algoritmo divide i crediti fra i ruoli; in
manuale fissi tu i crediti di portieri, difensori, centrocampisti e attaccanti
(giocatori già scelti compresi) e il tool trova la rosa più forte dentro quei
limiti. Non spende un credito se non c'è un giocatore che valga di più: il
residuo per ruolo resta visibile.

Tre piani (A, B, C) salvati nel browser, esportabili e reimportabili come testo.

**Modalità asta.** Il bottone col pallone in testata avvia l'asta live (il pallone rotola sul bottone e apre il setup). Si danno i nomi
alle 8 squadre e si sceglie da quale piano prendere gli obiettivi (restano segnati
nel listone, le rose partono vuote). Da lì la testata diventa la fascia scura
"In asta" e compare la sezione **Asta**:

- **Occasioni di fine ruolo**, in cima: titolari buoni ancora liberi che gli
  avversari non possono più contendersi, per slot pieni o crediti finiti, con il
  prezzo realistico accanto a quello atteso. Il prezzo realistico è il massimo che
  può offrire il rivale più ricco con uno slot libero in quel ruolo, più uno.
- **Tabellone** (la fascia in alto): giocatori assegnati sul totale con una barra per ruolo, ultimo acquisto, rivale con l'offerta massima più alta, da quanto dura l'asta; a destra crediti, offerta massima, rosa e slot liberi per ruolo della tua squadra.
- **Giocatore chiamato**: cerchi il nome e vedi punti attesi, valore, prezzo
  atteso e la tua offerta massima. Poi **fin dove spingerti**: il prezzo più alto a
  cui la rosa migliore con lui resta forte almeno quanto la rosa migliore senza di
  lui. Si calcola rifacendo l'ottimizzazione a ogni prezzo provato, per bisezione.
  Sotto, chi può ancora prenderlo e al massimo a quanto.
- **Registrazione**: chi l'ha preso, a quanto, Aggiudicato. Il tool rifiuta le
  offerte che superano il massimo possibile di quella squadra o un ruolo già pieno.
- **Squadre**: crediti, offerta massima e slot liberi per ruolo di ognuna, con la
  rosa apribile. **Ultimi acquisti**, con Annulla l'ultimo.

Durante l'asta "La mia rosa" è la rosa reale: i tuoi acquisti al prezzo pagato,
gli acquisti degli altri esclusi dai suggerimenti. I prezzi attesi dei giocatori
rimasti seguono il mercato: si riscalano sui crediti che restano davvero rispetto
a quelli che il mercato avrebbe chiesto per riempire le rose. Lo stato è salvato
nel browser a ogni acquisto ed è esportabile. Per uscire: **Sospendi** lascia tutto
com'è e il pulsante diventa "Riprendi l'asta"; **Chiudi** archivia le rose finali
nel browser (base del tool formazione), mostra subito il testo da copiare come
copia di sicurezza e riporta il pulsante a "Modalità asta". Da definire: tipo di asta e ordine
dei ruoli (per ora ogni ruolo si può chiamare in qualsiasi momento).

---

## Avvio

```bash
pip install -e ".[dev]"
python -m fantaoracle all          # raccolta -> database -> modello -> export
cd web && python -m http.server    # poi apri http://localhost:8000
```

Il tool va aperto tramite un server (anche quello di Python va bene): aprendo
`index.html` direttamente dal disco il browser blocca la lettura di `data.json`.

Comandi singoli:

| Comando | Cosa fa |
|---|---|
| `python -m fantaoracle status` | regole da confermare, snapshot raccolti, stato del database |
| `python -m fantaoracle ingest` | raccolta da tutte le fonti (`--fonte voti`, `--completo`) |
| `python -m fantaoracle db` | ricostruisce `data/fantaoracle.duckdb` dagli snapshot |
| `python -m fantaoracle model` | proiezioni e valutazioni, scritte nel database |
| `python -m fantaoracle export` | `web/data.json` e `web/index.html` |
| `make test` | test |

---

## Architettura

```
fonti web ──> snapshot grezzi ──> database DuckDB ──> modello ──> export ──> tool web
              data/raw/           data/*.duckdb       proiezioni   web/data.json
              Parquet datati      tabelle pulite      valutazioni
              (in git)            (ricostruibile)
```

**Gli snapshot non si sovrascrivono.** Ogni raccolta finisce in una partizione
datata `data/raw/<fonte>/<dataset>/asof=AAAA-MM-GG/`. `read_snapshot(asof=...)`
restituisce solo ciò che esisteva a quella data: è quello che permette backtest
onesti, senza sbirciare il futuro.

**Il database si ricostruisce.** `data/fantaoracle.duckdb` non è in git: si
rigenera dagli snapshot in pochi secondi. Tenerlo nella repo la farebbe crescere a
ogni aggiornamento senza aggiungere nulla di non ricostruibile.

### Fonti

| Fonte | Cosa dà | Accesso |
|---|---|---|
| Fantacalcio.it, pagine voti | voto, fantavoto ed eventi per giocatore e giornata, redazione Fantacalcio | HTML pubblico |
| Fantacalcio.it, quotazioni | listone con quotazione iniziale, attuale e FVM | HTML pubblico |
| Understat | xG, npxG, xA, tiri, minuti; storico xG delle squadre; calendario completo | API JSON |
| football-data.co.uk | risultati, quote 1X2 e Over/Under | CSV |

FBref non è usato: da febbraio 2026 non pubblica più xG e xA.

I voti sono presi solo dalla colonna della redazione Fantacalcio, perché è la
fonte voti della lega: voti di redazioni diverse non sono confrontabili. A ogni
build il fantavoto viene ricostruito dalle regole di `league.yaml` e confrontato
con quello del sito: coincide sul 100% delle 37.304 righe.

### Database

Chiave unica `fc_id`, l'ID di Fantacalcio.it, stabile fra stagioni. Le altre
fonti ci arrivano attraverso la tabella `alias`.

| Tabella | Contenuto |
|---|---|
| `squadre` | le 25 squadre viste negli ultimi quattro anni, con `in_serie_a` per le 20 di quest'anno |
| `giocatori` | anagrafica; `nel_listone` per i giocatori acquistabili |
| `alias` | fonte + chiave esterna → `fc_id`, con punteggio e metodo del match |
| `voti` | giocatore × giornata: voto, fantavoto, eventi, subentri (il target del modello) |
| `partite` | calendario 2023–2027 con risultati, xG e quote |
| `stat_avanzate` | giocatore × stagione: minuti, xG, npxG, xA, tiri, rigori stimati |
| `quotazioni` | serie storica di QI, QA, FVM |
| `proiezioni`, `valutazioni` | output del modello, con versione (`v1-data-giornata`) |
| `indisponibili`, `probabili` | pronte per infortuni e probabili formazioni |
| `rose_lega`, `override_manuali` | stato della lega; il rebuild non le tocca |
| `log_ingest` | esito di ogni build con i controlli di qualità |

Controlli a ogni build: voti senza giocatore, voti fuori scala, fantavoto non
ricostruibile, numero di squadre in Serie A. L'allineamento dei nomi Understat →
Fantacalcio.it copre fra il 97% e il 98,5% dei giocatori con almeno 5 voti.

### Allineamento dei nomi

Lo stesso giocatore è "Vlahovic D." su una fonte e "Dušan Vlahović" su
un'altra. Pipeline: override manuali ([`data/ref/player_overrides.csv`](data/ref/player_overrides.csv))
→ blocking per squadra e stagione → fuzzy score su cognome e nome compatto →
assegnazione uno a uno. Trattini e apostrofi uniscono invece di separare
(Fitz-Jim, N'Dicka), e il nome proprio resta intero così gli omonimi della
stessa squadra si separano (Pellegrini Lo. / Pellegrini Lu.). Un match con il
secondo candidato troppo vicino viene dichiarato ambiguo invece di essere scritto.

---

## Il modello

[`fantaoracle/model/projection.py`](fantaoracle/model/projection.py)

```
punti a giornata = probabilità di voto × fantavoto atteso quando gioca
```

| Componente | Come si stima |
|---|---|
| Probabilità di voto | Parte dallo storico personale di presenze (non dalla media del ruolo, che schiaccerebbe i titolari fissi) e si aggiorna con le giornate di quest'anno; lo storico pesa quanto 6 giornate. Chi ha cambiato squadra riparte a metà strada verso la media del ruolo. |
| Voto atteso | Media dei voti pesata per recenza (1, 0,5, 0,25, 0,12 per stagione), tirata verso la media del ruolo con peso di 10 partite. |
| Gol | Tasso per 90' che mescola npxG e gol reali in parti uguali, con shrinkage verso il ruolo pari a 450 minuti. |
| Rigori | Quota dei rigori della squadra calciati dal giocatore, contando solo le stagioni nella squadra attuale; valore atteso 1,68 punti a rigore (78% di conversione, ±3). |
| Assist | Assist Fantacalcio.it mescolati a xA ricalibrato sugli assist redazionali. |
| Malus | Ammonizioni, espulsioni e autogol, con shrinkage. |
| Portieri | Gol subiti e imbattibilità dal rating difensivo della squadra sulle 33 partite residue (rating da xG e gol, pesati per recenza; neopromosse con prior pessimista). |
| Modificatore | Per portieri e difensori, 0,72 punti per ogni punto di voto sopra il 6: pendenza della tabella a fasce intorno a 6,2 per la probabilità di schierare la difesa a 4. |

**Calibrazione.** Sul backtest le presenze arrivate erano l'88–90% di quelle
previste, in tutti i ruoli: le prime giornate mostrano chi è titolare, non gli
infortuni, le rotazioni e le cessioni che arrivano dopo. Il fantavoto quando gioca
era invece preciso per difensori e centrocampisti, un po' alto per attaccanti e
portieri. Due correzioni per ruolo (fattore di disponibilità e scarto sul
fantavoto) riportano il rapporto fra punti reali e previsti a 1,00 per difensori,
centrocampisti e attaccanti. Non cambiano l'ordinamento dentro il ruolo.

La funzione è point in time: riceve i dati fino a una giornata e guarda solo
quelli. Lo stesso codice fa la proiezione vera e il backtest.

### Backtest

[`fantaoracle/model/backtest.py`](fantaoracle/model/backtest.py). Le stagioni
2024-25 e 2025-26 vengono congelate alla 5ª giornata (quella dell'asta),
proiettate sulle restanti 33 e confrontate con i fantapunti realmente fatti. Gli
xG della stagione congelata sono esclusi, perché sono aggregati di fine stagione:
il modello è quindi un po' svantaggiato rispetto all'uso reale.

Correlazione di rango fra punti previsti e reali, media delle due stagioni:

| Ruolo | fantaOracle | Punti prime 5 giornate | Fantamedia pesata × presenze | Punti anno scorso |
|---|---|---|---|---|
| P | **0,606** | 0,553 | 0,594 | 0,487 |
| D | 0,542 | **0,556** | 0,537 | 0,319 |
| C | **0,553** | 0,516 | 0,510 | 0,331 |
| A | 0,562 | **0,566** | 0,535 | 0,254 |
| **Media** | **0,566** | 0,548 | 0,544 | 0,348 |

Punti reali medi dei primi giocatori indicati da ciascun metodo (primi 10 P, 30 D,
30 C, 20 A): fantaOracle 153,7, prime 5 giornate 152,0, fantamedia 151,3, anno
scorso 144,4.

Il modello è il migliore in media, ma il vantaggio è contenuto e non vale in ogni
ruolo: per difensori e attaccanti le prime giornate della stagione sono quasi
altrettanto informative. Il segnale più forte in assoluto è chi gioca, e le
prime giornate lo rivelano bene. I parametri sono calibrati su questo backtest.

---

## Valore e prezzo atteso

[`fantaoracle/model/valuation.py`](fantaoracle/model/valuation.py)

**Valore.** VORP a due livelli. Si comprano 24 portieri ma ne giocano 8 a
settimana: misurare il valore rispetto al 25° portiere gonfierebbe tutti i
portieri. Il VORP è quindi pieno sopra la linea dei titolari (8 squadre × 1
portiere, 4 difensori, 3,5 centrocampisti, 2,5 attaccanti) e al 25% fra quella
linea e l'ultimo giocatore comprato, per il valore di chi copre rotazioni e
infortuni. I 3.800 crediti discrezionali della lega (4.000 meno 1 per ciascuno
dei 200 slot) si dividono in proporzione.

**Prezzo atteso.** Parte dal FVM di Fantacalcio.it, costruito sui prezzi delle
aste reali, e viene riscalato perché i 200 giocatori che verranno comprati
sommino ai 4.000 crediti della lega. Prima del riscalamento si applica il
fattore tifo (Roma +6%, Lazio +3%, configurabile): i crediti in più spesi sulle
romane vengono tolti, in proporzione, a tutti gli altri.

Il modello e il mercato divergono in modo netto su due punti: valuta i portieri
più di quanto costano e le stelle offensive meno. Le differenze fra portieri sono
reali (un buon portiere fa circa un punto a partita più di uno mediocre), ma il
modello ordina i giocatori solo un po' meglio delle alternative: l'affare è
un'indicazione, non una regola.

---

## Il costruttore

[`web/tool.js`](web/tool.js)

L'obiettivo non è la somma dei 25 giocatori ma la forza dell'undici che puoi
schierare ogni settimana. Dentro ogni ruolo i giocatori sono ordinati per punti
attesi e pesati per posto:

| Ruolo | Pesi dal migliore in giù |
|---|---|
| P | 1 · 0,10 · 0,03 |
| D | 1 · 1 · 1 · 1 · 0,45 · 0,25 · 0,12 · 0,06 |
| C | 1 · 1 · 1 · 0,75 · 0,40 · 0,20 · 0,10 · 0,05 |
| A | 1 · 1 · 0,55 · 0,30 · 0,12 · 0,05 |

Il quinto difensore pesa più delle quinte scelte degli altri ruoli perché il
modificatore richiede la difesa a 4. Questi pesi sono ciò che produce una rosa
equilibrata invece di tre campioni e ventidue scarti.

Algoritmo: greedy su guadagno di forza meno λ × prezzo per 14 valori di λ, si
tiene la rosa migliore, poi ricerca locale con scambi migliorativi dentro il
budget. Circa 85 ms sulla rosa vuota.

---

## Automazione su GitHub

| Workflow | Quando | Cosa fa |
|---|---|---|
| [`aggiorna-dati.yml`](.github/workflows/aggiorna-dati.yml) | martedì e venerdì mattina, o a mano | test, pipeline completa, commit dei nuovi snapshot e di `web/data.json` |
| [`pages.yml`](.github/workflows/pages.yml) | a ogni modifica di `web/` e dopo ogni aggiornamento dei dati | pubblica il tool su GitHub Pages |

Per attivare GitHub Pages: *Settings → Pages → Source: GitHub Actions*. Su una
repo privata Pages richiede un piano GitHub Pro (incluso nel GitHub Student
Developer Pack).

---

## Struttura

```
config/league.yaml          regole della lega, mercato, parametri del motore
fantaoracle/
  ingest/                   raccolta: Fantacalcio.it, Understat, football-data
  resolve/                  allineamento dei nomi fra fonti
  model/
    projection.py           punti attesi per giocatore
    backtest.py             validazione sulle stagioni passate
    valuation.py            valore, prezzo atteso, affare
    odds.py                 quote -> gol attesi e clean sheet
    scoring.py              fantavoto, modificatore difesa, esito h2h
    pipeline.py             proiezione della stagione corrente nel database
  db.py                     schema e build del database
  store.py                  snapshot append-only
  export.py                 dati e pagina del tool
web/
  tool.html                 struttura della pagina (frammento, sorgente anche dell'artifact)
  tool.css                  stile: token di colore per tema chiaro, scuro e modalità asta
  tool.js                   logica: ottimizzatore, listone, rosa, formazione tipo, asta
  index.html                documento completo per Pages, generato da `export`
  data.json                 giocatori, proiezioni, valutazioni e regole della lega
data/raw/                   snapshot in Parquet
data/ref/                   tabelle curate a mano (override dei nomi)
tests/                      63 test
```

Due moduli preparano il terreno per il tool formazione e non sono ancora usati
dal costruttore: `odds.py` (gol attesi dalle quote di ogni partita, con Shin e
Dixon-Coles, ancorati al mercato Over/Under) e `scoring.py` (modificatore difesa
e conversione punti → gol applicati simulazione per simulazione, perché con
funzioni a gradini la media non basta).

---

## Limiti noti

- Gli infortuni non sono ancora nel modello: un giocatore fermo per due mesi ha
  la stessa probabilità di voto di prima dell'infortunio finché non salta le
  partite. La tabella `indisponibili` è pronta.
- Le statistiche avanzate raccolte sono solo quelle di Serie A: per chi è
  arrivato quest'estate da un altro campionato il punteggio si basa sulle
  giornate giocate qui e sulla media del ruolo.
- Il mercato di gennaio non è modellato.
- Il fattore tifo è una stima a mano, con peso volutamente basso.

## Prossimi passi

1. Modalità asta, rifiniture: tipo di asta e ordine dei ruoli, stato condiviso
   fra computer e telefono. (La prima versione è nel tool: vedi sopra. Nota
   originale sulle **occasioni di fine ruolo**: giocatori buoni rimasti liberi quando un ruolo
   sta per chiudersi, che si possono prendere a pochissimo. Si avvia con un
   bottone **Modalità asta** col pallone in testata, con un passaggio di
   conferma e la scelta del piano da cui partire; ad asta avviata il pulsante
   smette di lampeggiare e resta visibile lo stato "In asta". Per stimarle servono
   i crediti e gli slot rimasti a ciascun avversario: chi ha pochi crediti o il
   ruolo già pieno non rilancia.
2. Indisponibili con data di rientro nella probabilità di voto.
3. Tool formazione: probabili formazioni da più fonti, simulazione della
   giornata con modificatore, switch e confronto h2h con l'avversario.
