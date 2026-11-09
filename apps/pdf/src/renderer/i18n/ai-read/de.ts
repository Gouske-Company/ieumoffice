import type { zh } from './zh'

export const de = {
  arButton: 'KI-Seitenlesen',
  arButtonTip:
    'Gescannte oder unlesbare Seiten von der KI anhand ihres Seitenbilds lesen lassen und das Ergebnis aufbewahren',
  arMenuRead: 'Seiten mit KI lesen…',
  arMenuDelete: 'Gespeicherte KI-Ergebnisse dieses Dokuments löschen…',
  arTitle: 'Seiten mit KI lesen',
  arIntro:
    'Jede gewählte Seite wird einzeln als Bild an die KI gesendet, die Text, Tabellen und Formeln daraus liest. Das Ergebnis bleibt auf diesem PC und wird für die Markdown- und EPUB-Umwandlung, das KI-Fenster und die Suche verwendet.',
  arAnalyzing: 'Dokument wird durchgesehen…',
  arAnalyzingProgress: 'Dokument wird durchgesehen… Seite {done} von {total}',
  arAnalyzeFailed: 'Das Dokument konnte nicht analysiert werden.',
  arPreselectNote:
    'Gescannte Seiten, Seiten mit nicht richtig lesbarem Text und Seiten, deren Fußnoten nicht verknüpft werden konnten, sind bereits ausgewählt. Seiten mit Tabellen oder Formeln fügen Sie selbst hinzu.',
  arNoPreselect:
    'Keine Seite musste vorausgewählt werden. Fügen Sie die zu lesenden Seiten selbst hinzu.',
  arReasonScanned: 'gescannt',
  arReasonDegraded: 'Text nicht lesbar',
  arReasonFootnote: 'Fußnoten nicht verknüpft',
  arReasonAdded: 'von Ihnen hinzugefügt',
  arAlreadyRead: 'bereits gelesen · übersprungen',
  arPageLabel: 'Seite {page}',
  arAddLabel: 'Seiten hinzufügen',
  arAddPlaceholder: 'z. B. 3, 7-9',
  arAdd: 'Hinzufügen',
  arSelectedCount: 'Gewählte Seiten: {count}',
  arNext: 'Weiter',
  arBack: 'Zurück',
  arCancel: 'Abbrechen',
  arStart: 'Starten',
  arConfirmTitle: 'Vor dem Start prüfen',
  arConfirmCalls: 'KI-Aufrufe: {calls} (einer pro Seite)',
  arConfirmSkipped: 'Bereits gelesene Seiten, nicht gesendet: {count}',
  arConfirmProvider: 'Verwendete KI: {provider}',
  arConfirmPaid: '{provider} stellt dies in Rechnung',
  arConfirmSends: 'Die Seitenbilder werden an diese KI gesendet.',
  arConfirmNothing: 'Alle gewählten Seiten wurden bereits gelesen. Es gibt nichts zu senden.',
  arChecking: 'KI-Verbindung wird geprüft…',
  arProviderLabel: 'Anbieter',
  arProviderNotConnected: '{provider} (nicht verbunden)',
  arVisionProvider:
    '{provider} kann keine Bilder lesen, daher kann das KI-Seitenlesen nicht starten. Wählen Sie in den Einstellungen eine KI, die Bilder liest.',
  arVisionModel:
    'Das gewählte Modell ({model}) kann keine Bilder lesen, daher kann das KI-Seitenlesen nicht starten. Wählen Sie in den Einstellungen ein Modell, das Bilder liest.',
  arVisionUnknown:
    'Die zu verwendende KI konnte nicht bestimmt werden, daher kann nicht gestartet werden.',
  arRouteChanged:
    'Die KI-Verbindung hat sich geändert. Prüfen Sie die Angaben erneut und starten Sie dann.',
  arRunning: 'Die KI liest Seiten… {done} von {total}',
  arRunningPage: 'liest Seite {page}',
  arStop: 'Stoppen',
  arStopping: 'Wird gestoppt…',
  arDone: 'KI-Lesen abgeschlossen. Gelesene Seiten: {count}.',
  arFailedPages: 'Nicht gelesene Seiten: {pages}',
  arStoppedCancelled:
    'KI-Lesen gestoppt. Die bisher gelesenen Seiten bleiben erhalten, Sie können später fortfahren.',
  arStoppedFailures:
    'KI-Lesen gestoppt, weil mehrere Aufrufe nacheinander fehlschlugen. Die bisher gelesenen Seiten bleiben erhalten.',
  arStoppedStore:
    'KI-Lesen gestoppt, weil das Ergebnis nicht gespeichert werden konnte. Der Datenträger ist möglicherweise voll.',
  arLostPages: 'Empfangen, aber nicht gespeichert: {pages}',
  arStoppedError: 'KI-Lesen gestoppt: {reason}',
  arStartFailed: 'KI-Lesen konnte nicht starten: {reason}',
  arClose: 'Schließen',
  arBusy:
    'Für dieses Dokument läuft bereits eine KI-Aufgabe ({done}/{total}). Versuchen Sie es erneut, wenn sie beendet oder gestoppt ist.',
  arUnavailable: 'KI-Seitenlesen ist in diesem Fenster nicht verfügbar.',
  arDeleteConfirm:
    'Alle für dieses Dokument gespeicherten KI-Ergebnisse (KI-Lesungen, Übersetzungen, Passagenkarten, Markierungsvorschläge und die Übersicht) löschen? Dies kann nicht rückgängig gemacht werden.',
  arDeleted: 'Die gespeicherten KI-Ergebnisse dieses Dokuments wurden gelöscht.',
  arDeleteFailed: 'Die gespeicherten KI-Ergebnisse konnten nicht gelöscht werden.',
  arDeleteBusy: 'Eine KI-Aufgabe läuft, daher kann jetzt nichts gelöscht werden.',
  jobResumeAiRead: 'Unvollendetes KI-Lesen {percent} % — fortfahren?',
  jobResumeTranslate: 'Unvollendete Übersetzung ({language}) {percent} % — fortfahren?',
  jobResumeHighlight: 'Unvollendete KI-Markierung {percent} % — fortfahren?',
  arDeleteAlsoBoth:
    'Ebenfalls gelöscht werden: von Hand bearbeitete Übersetzungen ({edited}) und Passagenkarten ({cards}).',
  arDeleteAlsoEdited: 'Ebenfalls gelöscht werden: von Hand bearbeitete Übersetzungen ({count}).',
  arDeleteAlsoCards: 'Ebenfalls gelöscht werden: Passagenkarten ({count}).',
  jobResumeContinue: 'Fortfahren',
  jobResumeLater: 'Später',
  searchAiRead: 'Im von der KI gelesenen Text gefunden',
  searchAiReadTip:
    'Von der KI gelesener Text hat keine Positionen, daher wird nur zur Seite gesprungen',
} satisfies Record<keyof typeof zh, string>
