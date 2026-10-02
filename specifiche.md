# FantaOracle · specifiche tecniche

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
| F | Pallino colorato a sinistra del nome (ordinabile). La fascia della Guida all'Asta di SOS Fanta (Super top, Top, Semitop… fino a Da evitare, passando per Infortunati e A rischio). È l'opinione della redazione, non entra nel modello. Spento se la guida non classifica il giocatore; vuoto se la fascia è stimata. Ogni fascia ha il suo colore, la legenda compare al passaggio del mouse (o al tocco); il pallino è anche nella scheda e nella rosa. |
| **Pt/g** | Punti attesi a giornata: probabilità di prendere voto × fantavoto atteso. Per portieri e difensori include la quota del modificatore difesa. |
| FM att. | Fantavoto atteso quando gioca |
| Pres. | Probabilità di prendere voto in una giornata |
| **Valore** | Quanto vale per noi, in crediti, rispetto a chi potremmo prendere al suo posto |
| **Prezzo** | Quanto costerà presumibilmente nella nostra asta |
| **Affare** | Valore meno prezzo |
| QA | Quotazione attuale Fantacalcio.it |

**Fasce stimate.** SOS Fanta mette alcuni giocatori fra gli *Infortunati*, che è uno stato e
non un livello. Per non lasciarli fuori dal confronto se ne stima la fascia
([`model/fasce.py`](fantaoracle/model/fasce.py)): si cercano, dentro lo stesso ruolo, i sette
giocatori classificati più vicini per FVM, quotazione iniziale e punti attesi, e si prende la
mediana pesata delle loro fasce. Si usa solo la scala di qualità, da *Super top* a *Leghe
numerose*; i jolly, le scommesse e i rischi sono giudizi di convenienza e non si inferiscono.
Nascondendo la fascia a ciascuno dei 253 giocatori classificati e ricostruendola, la fascia esatta
esce nel 39% dei casi, entro un gradino nell'81%, con un errore medio di 0,86 gradini (indovinare
sempre la mediana del ruolo sbaglia di 2,2). È una stima: nel tool la pill è tratteggiata e porta
una ~. Quotazioni e FVM di un infortunato possono già essere scontati, quindi la stima tende a
essere prudente per i campioni.

`RIG` segnala i rigoristi, `TIFO` i giocatori con prezzo maggiorato perché in
lega ci sono molti tifosi di quella squadra. Un clic sul nome apre la scheda: da
cosa nasce il punteggio, fantavoti di questa stagione, storico delle ultime tre.

**Infortuni.** Accanto al nome, in rosso pieno chi salta almeno una delle
prossime giornate (`OUT → 8a`: rientro alla 8ª, `OUT STAGIONE` se torna dopo
l'ultima, `SQUALIFICATO`), tratteggiato chi è in dubbio per la prossima o ha un
acciacco senza data (`IN DUBBIO`, `DIFFIDATO`). Poi la propensione dallo
storico: `FRAGILE` (circa uno su sette) e, più discreto, `DELICATO` (uno su
quattro). È un giudizio nostro sullo storico, diverso dalla fascia "A rischio"
della guida SOS Fanta. Passandoci sopra si leggono motivo, data di rientro e i numeri che
hanno deciso il giudizio. Un filtro tiene solo i disponibili, i disponibili non
fragili, gli indisponibili o i fragili e delicati. La scheda ha una sezione Infortuni con
lo stop in corso, quanto farebbe da sano e l'elenco degli stop dalla 23/24.

**Calendario e abbinamenti.** Nella scheda di portieri e attaccanti c'è la loro
riga della griglia di alternanza: una casella per giornata con l'avversario,
verde, gialla o rossa secondo la fascia della griglia di
[FantaLab](https://app.fantalab.it/griglia-portieri) (facile, media, difficile),
maiuscola in casa e minuscola fuori. Sotto, i compagni con cui alternarlo meglio:
per ognuno le giornate in cui almeno uno dei due ha una partita facile, il voto
FantaLab della coppia (0–100) e **+Pt/g**, i punti a giornata in più se ogni turno
schieri chi ha la partita migliore invece di lui sempre in campo. Tre gruppi: chi
hai già in rosa, i migliori, e i low cost (fino a 5 crediti su 500). Un clic su
*Griglia* mette la coppia nella griglia, con sbiadita la partita di chi resta in
panchina e barrate le giornate che un giocatore salta per infortunio o
squalifica. Le riserve (meno di un voto ogni tre giornate) non compaiono.

**Costruttore guidato.** Metti in rosa chi vuoi, al prezzo che vuoi: il tool
completa gli slot rimanenti con la combinazione più forte che sta nel budget
restante e la evidenzia in giallo, anche nel listone. Ogni volta che cambi
qualcosa ricalcola. Per ogni suggerito propone le alternative che rientrano nel
budget. I giocatori esclusi (✕) escono dai suggerimenti.

Vincoli rispettati: rosa 3-8-8-6, 500 crediti, almeno 1 credito per ogni slot
ancora vuoto, al massimo 3 giocatori della stessa squadra reale (il blocco
portieri può essere escluso), margine di prudenza sui prezzi (0–30%).

Portieri e attaccanti si valutano giornata per giornata (vedi
[il costruttore](#il-costruttore)): una coppia di portieri con calendari che si
coprono vale più della somma dei loro Pt/g. Sotto i portieri della rosa il tool
dice in quante giornate almeno uno ha una partita facile e quanti punti rende
l'alternanza; sotto gli attaccanti, quanti in media hanno una partita facile.

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
| `python -m fantaoracle ingest` | raccolta da tutte le fonti (`--fonte voti`, `--fonte infortuni`, `--completo`). Fasce di SOS Fanta e infortuni sono facoltativi: se una pagina cambia o non risponde, l'aggiornamento del resto prosegue |
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
| SOS Fanta, Guida all'Asta | fascia di ogni giocatore, per ruolo, aggiornata dalla redazione | HTML pubblico |
| SosFanta, tabella indisponibili | infortunati, squalificati e diffidati, con la giornata di rientro | HTML pubblico |
| Transfermarkt, rose e pagine "Infortuni" | data di probabile ritorno di chi è fermo; storico degli stop dalla 23/24 (tipo, giorni, partite perse) | HTML pubblico |

FBref non è usato: da febbraio 2026 non pubblica più xG e xA.

Gli infortuni sono un complemento: se SosFanta o Transfermarkt bloccano la
raccolta, l'aggiornamento prosegue e il database usa l'ultimo snapshot buono.
Lo storico Transfermarkt (circa 600 pagine) si riscarica solo quando l'ultimo
snapshot ha più di sei giorni.

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
| `partite` | calendario 2023–2027 con risultati, xG e quote; `giornata` per la stagione in corso, dal calendario ufficiale |
| `stat_avanzate` | giocatore × stagione: minuti, xG, npxG, xA, tiri, rigori stimati |
| `quotazioni` | serie storica di QI, QA, FVM |
| `proiezioni`, `valutazioni` | output del modello, con versione (`v1-data-giornata`) |
| `proiezioni_giornata` | punti attesi di portieri e attaccanti partita per partita, con avversario e campo (zero nelle giornate che saltano) |
| `fasce` | fascia SOS Fanta per giocatore (`fascia`, `ordine`, `posizione`), abbinata al listone dentro il ruolo |
| `indisponibili` | chi è fermo adesso: tipo, motivo, giornata (SosFanta) e data (Transfermarkt) di rientro |
| `storico_infortuni` | giocatore × stop dalla 23/24, da Transfermarkt: base della propensione |
| `probabili` | pronta per le probabili formazioni |
| `rose_lega`, `override_manuali` | stato della lega; il rebuild non le tocca |
| `log_ingest` | esito di ogni build con i controlli di qualità |

Controlli a ogni build: voti senza giocatore, voti fuori scala, fantavoto non
ricostruibile, numero di squadre in Serie A, partite della stagione in corso
senza numero di giornata. L'allineamento dei nomi Understat →
Fantacalcio.it copre fra il 98,4% e il 99% dei giocatori con almeno 5 voti.
Un cognome composto scritto da solo ("Kolo Muani") e con il nome ("Randal Kolo
Muani") è lo stesso giocatore anche se lo split li legge diversamente, e la ı
turca diventa i (Yıldız). Le rose Transfermarkt agganciano 533 dei 599
giocatori del listone: gli altri, per Transfermarkt, sono in un'altra squadra o
fuori rosa, e per loro la scheda dice che lo storico manca invece di
dichiararli sani.

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
| Portieri | Gol subiti e imbattibilità partita per partita, dal rating difensivo della squadra e dall'attacco dell'avversario, sulle 33 partite residue (rating da xG e gol, pesati per recenza; neopromosse con prior pessimista). |
| Calendario attaccanti | Gol, assist e rigori attesi moltiplicati, partita per partita, per la difesa dell'avversario rispetto a una media e per il fattore campo. |
| Modificatore | Per portieri e difensori, 0,72 punti per ogni punto di voto sopra il 6: pendenza della tabella a fasce intorno a 6,2 per la probabilità di schierare la difesa a 4. |

### Partita per partita: calendario e alternanza

[`fantaoracle/model/calendario.py`](fantaoracle/model/calendario.py)

Per portieri e attaccanti il modello stima i punti di ogni partita che resta, non
solo la media: è quello che serve per alternarli. La media sulle giornate è il
Pt/g del listone, quindi i due numeri non possono divergere.

La difficoltà di una partita mescola due giudizi sull'avversario:

- **il modello**: attacco e difesa da xG e gol pesati per recenza, più il fattore
  campo (1,08);
- **FantaLab**: la fascia della loro griglia, facile, media o difficile,
  separata per chi affronta quella squadra da portiere (quanto attacca) e da
  attaccante (quanto difende). È in
  [`data/ref/fantalab_difficolta.csv`](data/ref/fantalab_difficolta.csv), letta a
  mano dalla griglia: il colore dipende solo dall'avversario, mai dal campo o
  dalla giornata.

La fascia diventa un rating con il modello stesso: il livello di "difficile" per i
portieri è l'attacco medio (geometrico) delle squadre che FantaLab mette in quella
fascia. Il rating usato per l'avversario è la media geometrica fra il suo e quello
della sua fascia (`peso_fantalab = 0,5`): il modello resta l'ancora, FantaLab
sposta le squadre che giudica diversamente.

Il calendario ufficiale con i numeri di giornata (Understat ha solo le date) è
in [`data/ref/calendario_2026-27.csv`](data/ref/calendario_2026-27.csv), da
Fantacalcio.it: tutte le 380 partite coincidono con quelle di Understat. Un test
ricostruisce il voto che la griglia FantaLab stampa per Atalanta + Bologna sulle
giornate 6–38 (86 per i portieri, 91 per gli attaccanti).

**Backtest dell'alternanza.** Il modello è stato congelato alla 5ª giornata del
2024-25 e del 2025-26 (senza FantaLab, che non ha una classificazione storica),
e i punti previsti partita per partita sono stati confrontati con i fantavoti
reali. Per le coppie di titolari di squadre diverse si confronta lo schierare
ogni giornata chi ha la partita migliore con lo schierare sempre quello dal
Pt/g più alto, sulle giornate in cui hanno preso voto entrambi
(`backtest.alternanza`).

| Ruolo | Stagione | Correlazione nel giocatore | Giornate in cui si cambia | Guadagno quando si cambia |
|---|---|---|---|---|
| P | 2024-25 | 0,21 | 14% | +0,50 |
| P | 2025-26 | 0,16 | 16% | +0,21 |
| A | 2024-25 | 0,05 | 6% | +0,01 |
| A | 2025-26 | 0,12 | 5% | +0,29 |

Per i portieri il segnale c'è in entrambe le stagioni, e la pendenza fra scarti
previsti e reali è vicina a 1 (0,97 e 1,43): la differenza di punti fra una
partita facile e una difficile è stimata nella misura giusta. Per gli attaccanti
il calendario conta meno e il segnale è più rumoroso: l'alternanza fra
attaccanti è un criterio di spareggio, non un motivo per comprare. Sulla
classifica di stagione il calendario degli attaccanti non sposta nulla
(correlazione di rango 0,652 contro 0,651 e 0,471 contro 0,472).

**Calibrazione.** Sul backtest le presenze arrivate erano l'88–90% di quelle
previste, in tutti i ruoli: le prime giornate mostrano chi è titolare, non gli
infortuni, le rotazioni e le cessioni che arrivano dopo. Il fantavoto quando gioca
era invece preciso per difensori e centrocampisti, un po' alto per attaccanti e
portieri. Due correzioni per ruolo (fattore di disponibilità e scarto sul
fantavoto) riportano il rapporto fra punti reali e previsti a 1,00 per difensori,
centrocampisti e attaccanti. Non cambiano l'ordinamento dentro il ruolo.

La funzione è point in time: riceve i dati fino a una giornata e guarda solo
quelli. Lo stesso codice fa la proiezione vera e il backtest.

### Infortuni

[`fantaoracle/model/infortuni.py`](fantaoracle/model/infortuni.py)

**Chi è fermo adesso** cambia i punti. La giornata di rientro viene da SosFanta
("in dubbio per la 8a"); dove manca, dalla data di probabile ritorno di
Transfermarkt, letta sul calendario del club (con la giornata del calendario
ufficiale; senza, la k-esima partita di una squadra è la sua k-esima giornata).
Le giornate saltate si contano solo fra quelle da
giocare: chi è in dubbio per la prossima non ne perde nessuna. La probabilità di
voto si moltiplica per la quota di giornate residue in cui c'è (chi ne salta 11
su 33 tiene i due terzi dei punti attesi), e da lì cambiano valore e
suggerimenti. Le squalifiche valgono una giornata, diffide e acciacchi senza
data nessuna. Chi è fermo solo per Transfermarkt con una data di ritorno già
passata non entra: è una pagina non aggiornata. La proiezione da sano resta
nella scheda. Per portieri e attaccanti le giornate saltate valgono zero
partita per partita e il Pt/g è la media delle partite: chi salta proprio quelle
facili perde un po' di più, e nella griglia di alternanza quelle giornate sono
barrate, perché lì serve il compagno.

**Chi si ferma spesso** resta un avviso e non tocca i punti: lo storico delle
presenze, che il modello già usa, contiene le partite saltate per infortunio, e
scontarle di nuovo punirebbe due volte lo stesso fatto. Il giudizio usa gli stop
da Transfermarkt dalla 23/24, togliendo malattie, "ritardo di condizione" e
acciacchi sotto i 10 giorni senza partite perse. Le medie per stagione pesano
25/26 piena, 24/25 a 0,75, 23/24 a 0,5; la stagione in corso conta negli stop ma
non nelle medie. Un solo stop vale al massimo 365 giorni.

| Livello | Regola |
|---|---|
| **Fragile** | almeno 3 stop e, a stagione, 10 partite perse o 90 giorni fuori; oppure 9 stop muscolari |
| **Delicato** | almeno 2 stop e, a stagione, 5 partite o 45 giorni; oppure 4 muscolari; oppure 6 stop |

Sul listone di oggi: 78 fragili, 144 delicati, 311 senza segnalazioni, 66 senza
storico. Un solo crociato, anche lungo, non fa un fragile.

### Backtest

[`fantaoracle/model/backtest.py`](fantaoracle/model/backtest.py). Le stagioni
2024-25 e 2025-26 vengono congelate alla 5ª giornata (quella dell'asta),
proiettate sulle restanti 33 e confrontate con i fantapunti realmente fatti. Gli
xG della stagione congelata sono esclusi, perché sono aggregati di fine stagione:
il modello è quindi un po' svantaggiato rispetto all'uso reale.

Correlazione di rango fra punti previsti e reali, media delle due stagioni:

| Ruolo | FantaOracle | Punti prime 5 giornate | Fantamedia pesata × presenze | Punti anno scorso |
|---|---|---|---|---|
| P | **0,606** | 0,553 | 0,594 | 0,487 |
| D | 0,543 | **0,556** | 0,537 | 0,319 |
| C | **0,553** | 0,516 | 0,510 | 0,331 |
| A | 0,562 | **0,566** | 0,535 | 0,254 |
| **Media** | **0,566** | 0,548 | 0,544 | 0,348 |

Punti reali medi dei primi giocatori indicati da ciascun metodo (primi 10 P, 30 D,
30 C, 20 A): FantaOracle 153,7, prime 5 giornate 152,0, fantamedia 151,3, anno
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

Per portieri e attaccanti l'ordine si rifà **giornata per giornata** sui punti
partita per partita: ogni turno il titolare è chi ha la partita migliore, e la
forza del reparto è la media sulle giornate. Con calendari piatti il conto è
identico a quello di stagione; con calendari complementari la coppia vale di più.
Per non rallentare l'ottimizzatore, ogni reparto si ordina una volta per giornata
e il guadagno di un candidato costa solo la ricerca della sua posizione: sulla
rosa vuota resta intorno ai 90 ms.

Il calcolo di "fin dove spingerti" all'asta tiene conto che l'ottimizzatore è
un'euristica: una rosa trovata pagando un giocatore di più resta valida pagandolo
di meno, quindi la forza con lui a un prezzo è almeno la migliore trovata a un
prezzo uguale o più alto.

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
  ingest/                   raccolta: Fantacalcio.it, Understat, football-data, infortuni
  resolve/                  allineamento dei nomi fra fonti
  model/
    projection.py           punti attesi per giocatore
    calendario.py           difficoltà delle partite, FantaLab, punti per giornata
    infortuni.py            giornate saltate e propensione agli infortuni
    backtest.py             validazione sulle stagioni passate (anche dell'alternanza)
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
data/ref/                   tabelle curate a mano: override dei nomi, calendario
                            ufficiale con le giornate, fasce FantaLab
tests/                      111 test
```

Due moduli preparano il terreno per il tool formazione e non sono ancora usati
dal costruttore: `odds.py` (gol attesi dalle quote di ogni partita, con Shin e
Dixon-Coles, ancorati al mercato Over/Under) e `scoring.py` (modificatore difesa
e conversione punti → gol applicati simulazione per simulazione, perché con
funzioni a gradini la media non basta).

---

## Limiti noti

- La propensione agli infortuni è un avviso, non entra nei punti (vedi sopra).
  Le date di rientro sono quelle delle fonti: un "in dubbio" resta un dubbio.
- Le statistiche avanzate raccolte sono solo quelle di Serie A: per chi è
  arrivato quest'estate da un altro campionato il punteggio si basa sulle
  giornate giocate qui e sulla media del ruolo.
- Il mercato di gennaio non è modellato.
- Il fattore tifo è una stima a mano, con peso volutamente basso.
- La classificazione FantaLab si aggiorna a mano: se rivedono un giudizio, va
  corretto `data/ref/fantalab_difficolta.csv` (con la data in testa).
- Il calendario partita per partita cambia gol e porta inviolata, non il voto: un
  portiere che subisce tre gol prende anche un voto più basso. La differenza fra
  partite facili e difficili è quindi, se mai, sottostimata.

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
2. Tool formazione: probabili formazioni da più fonti, simulazione della
   giornata con modificatore, switch e confronto h2h con l'avversario.
