# Modelli IA e impostazioni

## Dove si trovano le impostazioni

Apri **Impostazioni** dalla riga in basso a sinistra in Home e scegli **IA**. La prima cosa che vedi è la connessione con abbonamento. Alla maggior parte delle persone non serve altro, e ha un articolo tutto suo: [Connessione con abbonamento](help://subscription).

Tutto ciò che richiede una chiave si trova sotto **Avanzate**, in fondo alla stessa pagina. Resta chiuso finché non lo apri.

## L'impostazione predefinita: il tuo abbonamento

- **IA da usare** parte da **Automatico**: tra gli abbonamenti collegati, prima Claude, poi ChatGPT, poi Codex.
- Automatico non sceglie mai nulla che costi denaro in più. Una chiave API viene usata solo finché scegli tu quel provider in **IA da usare**.
- L'elenco dei modelli in fondo a ogni pannello IA mostra prima gli abbonamenti, poi i provider con chiave che hai finito di configurare. Sotto un abbonamento, **Modello predefinito** è il modello standard di quell'abbonamento.

## Chiavi API (Avanzate ▸ Modello IA)

Per chi preferisce pagare direttamente un provider o far girare un proprio modello.

- Scegli un **Provider**, inserisci la sua **Chiave API** (e un **Base URL** se il provider lo richiede), scegli un **Modello**, poi premi **Salva**. L'elenco comprende server compatibili con OpenAI, Anthropic, Gemini, DeepSeek, DashScope (qwen), Atlas Cloud e altri.
- Qui l'elenco **Provider** decide soltanto di chi sono i campi mostrati. Non cambia l'IA in uso; quella è sempre **IA da usare**. Se un provider salvato non è l'IA in uso, in alto compare **Usa questa IA**; premendolo, quel provider diventa l'**IA da usare**.
- Le chat con un provider con chiave usano la tua chiave, ed è quel provider ad addebitartele.
- Le chiavi sono memorizzate nel file delle impostazioni dell'app su questa macchina e inviate solo nelle intestazioni delle richieste.
- **Prova connessione**: verifica che l'endpoint sia raggiungibile e che il modello sia visibile prima di salvare.
- Gli URL di base possono contenere un percorso e una stringa di query (stile gateway); i percorsi degli endpoint vengono aggiunti correttamente.
- Per i server che gestisci tu si possono salvare più **endpoint** e passare dall'uno all'altro in qualsiasi momento.
- **Eseguibile Codex** serve solo per un programma Codex installato in una posizione insolita. Lascialo vuoto e il programma viene trovato automaticamente.

## Che cosa serve a ogni funzione

| Funzione                                                       | Su che cosa si basa                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Chat e modifica nel pannello IA                                | Il tuo abbonamento, oppure un provider con chiave che hai scelto tu.                                                                                                                                                                                                                                                                                                                       |
| Capire un'immagine                                             | L'IA con cui stai chattando guarda direttamente l'immagine. Non serve nessuna chiave in più. In Avanzate si può scegliere un provider di analisi separato.                                                                                                                                                                                                                                 |
| Generare un'immagine                                           | **Con l’abbonamento Codex collegato.** Se scegli un provider di immagini in Avanzate ▸ Media e ricerca IA, viene usato per primo. Se quello scelto non si può usare, lo sostituisce ciò che si può usare tra l’abbonamento Codex e i provider configurati. Senza nessuno dei due, la generazione di immagini non è disponibile, e Slides usa al suo posto immagini trovate con la ricerca. |
| Analisi di video e audio                                       | Un provider con chiave che supporta i video, scelto in Avanzate ▸ Media e ricerca IA.                                                                                                                                                                                                                                                                                                      |
| Ricerca web e di immagini, lettura di una pagina per indirizzo | Gratuita per impostazione predefinita, senza chiave. La chiave di un provider di ricerca è facoltativa.                                                                                                                                                                                                                                                                                    |
| Ricerca nei tuoi file                                          | Gira su questa macchina. Il riordinamento dei risultati tramite un servizio è facoltativo e disattivato per impostazione predefinita.                                                                                                                                                                                                                                                      |

In **Avanzate ▸ Media e ricerca IA**, la chiave e l'URL di base di un provider si inseriscono una volta sola e sono condivisi da tutte le funzioni che usano quel provider.

## Quando hanno effetto le modifiche

- Le modifiche a modello ed endpoint hanno effetto immediato; una conversazione in corso mantiene la vecchia configurazione fino al turno successivo.
