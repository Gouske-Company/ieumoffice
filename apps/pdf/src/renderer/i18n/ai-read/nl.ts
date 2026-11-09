import type { zh } from './zh'

export const nl = {
  arButton: 'Pagina’s lezen met AI',
  arButtonTip:
    'Laat de AI gescande of onleesbare pagina’s vanaf hun paginabeeld lezen en bewaar het resultaat',
  arMenuRead: 'Pagina’s lezen met AI…',
  arMenuDelete: 'Bewaarde AI-resultaten van dit document verwijderen…',
  arTitle: 'Pagina’s lezen met AI',
  arIntro:
    'Elke gekozen pagina wordt als afbeelding, één per keer, naar de AI gestuurd om tekst, tabellen en formules te lezen. Het resultaat blijft op deze pc en wordt gebruikt voor de omzetting naar Markdown en EPUB, het AI-venster en zoeken.',
  arAnalyzing: 'Document wordt doorgenomen…',
  arAnalyzingProgress: 'Document wordt doorgenomen… pagina {done} van {total}',
  arAnalyzeFailed: 'Het document kon niet worden geanalyseerd.',
  arPreselectNote:
    'Gescande pagina’s, pagina’s waarvan de tekst niet goed te lezen is en pagina’s waarvan de voetnoten niet gekoppeld konden worden, zijn al gekozen. Voeg pagina’s met tabellen of formules zelf toe.',
  arNoPreselect:
    'Er hoefde geen pagina vooraf gekozen te worden. Voeg de te lezen pagina’s zelf toe.',
  arReasonScanned: 'gescand',
  arReasonDegraded: 'tekst onleesbaar',
  arReasonFootnote: 'voetnoten niet gekoppeld',
  arReasonAdded: 'door u toegevoegd',
  arAlreadyRead: 'al gelezen · overgeslagen',
  arPageLabel: 'Pagina {page}',
  arAddLabel: 'Pagina’s toevoegen',
  arAddPlaceholder: 'bijv. 3, 7-9',
  arAdd: 'Toevoegen',
  arSelectedCount: 'Gekozen pagina’s: {count}',
  arNext: 'Volgende',
  arBack: 'Terug',
  arCancel: 'Annuleren',
  arStart: 'Starten',
  arConfirmTitle: 'Controleer voordat u start',
  arConfirmCalls: 'AI-aanroepen: {calls} (één per pagina)',
  arConfirmSkipped: 'Al gelezen pagina’s, niet verstuurd: {count}',
  arConfirmProvider: 'Gebruikte AI: {provider}',
  arConfirmPaid: '{provider} brengt hiervoor kosten in rekening',
  arConfirmSends: 'De paginabeelden worden naar deze AI gestuurd.',
  arConfirmNothing: 'Alle gekozen pagina’s zijn al gelezen. Er valt niets te versturen.',
  arChecking: 'AI-verbinding wordt gecontroleerd…',
  arProviderLabel: 'Aanbieder',
  arProviderNotConnected: '{provider} (niet verbonden)',
  arVisionProvider:
    '{provider} kan geen afbeeldingen lezen, dus pagina’s lezen met AI kan niet starten. Kies in Instellingen een AI die afbeeldingen leest.',
  arVisionModel:
    'Het gekozen model ({model}) kan geen afbeeldingen lezen, dus pagina’s lezen met AI kan niet starten. Kies in Instellingen een model dat afbeeldingen leest.',
  arVisionUnknown:
    'Er kon niet worden bepaald welke AI te gebruiken, dus er kan niet worden gestart.',
  arRouteChanged: 'De AI-verbinding is gewijzigd. Controleer de gegevens opnieuw en start daarna.',
  arRunning: 'De AI leest pagina’s… {done} van {total}',
  arRunningPage: 'leest pagina {page}',
  arStop: 'Stoppen',
  arStopping: 'Bezig met stoppen…',
  arDone: 'Lezen met AI is klaar. Gelezen pagina’s: {count}.',
  arFailedPages: 'Niet gelezen pagina’s: {pages}',
  arStoppedCancelled:
    'Lezen met AI gestopt. De gelezen pagina’s zijn bewaard en u kunt later verdergaan.',
  arStoppedFailures:
    'Lezen met AI gestopt omdat meerdere aanroepen achter elkaar mislukten. De gelezen pagina’s zijn bewaard.',
  arStoppedStore:
    'Lezen met AI gestopt omdat het resultaat niet bewaard kon worden. De schijf is mogelijk vol.',
  arLostPages: 'Ontvangen maar niet bewaard: {pages}',
  arStoppedError: 'Lezen met AI gestopt: {reason}',
  arStartFailed: 'Lezen met AI kon niet starten: {reason}',
  arClose: 'Sluiten',
  arBusy:
    'Er loopt al een AI-taak voor dit document ({done}/{total}). Probeer het opnieuw zodra die klaar of gestopt is.',
  arUnavailable: 'Pagina’s lezen met AI is niet beschikbaar in dit venster.',
  arDeleteConfirm:
    'Alle voor dit document bewaarde AI-resultaten (AI-lezingen, vertalingen, passagekaarten, markeringsvoorstellen en het overzicht) verwijderen? Dit kan niet ongedaan worden gemaakt.',
  arDeleted: 'De bewaarde AI-resultaten van dit document zijn verwijderd.',
  arDeleteFailed: 'De bewaarde AI-resultaten konden niet worden verwijderd.',
  arDeleteBusy: 'Er loopt een AI-taak, dus er kan nu niets worden verwijderd.',
  jobResumeAiRead: 'Onvoltooid lezen met AI {percent}% — doorgaan?',
  jobResumeTranslate: 'Onvoltooide vertaling ({language}) {percent}% — doorgaan?',
  jobResumeHighlight: 'Onvoltooide AI-markering {percent}% — doorgaan?',
  arDeleteAlsoBoth:
    'Ook verwijderd worden: met de hand aangepaste vertalingen ({edited}) en passagekaarten ({cards}).',
  arDeleteAlsoEdited: 'Ook verwijderd worden: met de hand aangepaste vertalingen ({count}).',
  arDeleteAlsoCards: 'Ook verwijderd worden: passagekaarten ({count}).',
  jobResumeContinue: 'Doorgaan',
  jobResumeLater: 'Later',
  searchAiRead: 'Gevonden in door AI gelezen tekst',
  searchAiReadTip:
    'Door AI gelezen tekst heeft geen posities, dus er wordt alleen naar de pagina gegaan',
} satisfies Record<keyof typeof zh, string>
