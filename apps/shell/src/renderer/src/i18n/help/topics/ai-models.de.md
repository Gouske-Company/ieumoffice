# KI-Modelle und Einstellungen

## Wo die Einstellungen liegen

Öffnen Sie über die Zeile unten links auf der Startseite die **Einstellungen** und wählen Sie **KI**. Als Erstes sehen Sie die Abonnement-Verbindung. Mehr brauchen die meisten nicht, und sie hat einen eigenen Artikel: [Abonnement-Verbindung](help://subscription).

Alles, wofür ein Schlüssel nötig ist, liegt unter **Erweitert** am unteren Ende derselben Seite. Der Bereich bleibt geschlossen, bis Sie ihn öffnen.

## Der Standard: Ihr Abonnement

- **Verwendete KI** steht anfangs auf **Automatisch**: von den verbundenen Abonnements zuerst Claude, dann ChatGPT, dann Codex.
- Automatisch wählt nie etwas, das zusätzlich Geld kostet. Ein API-Schlüssel wird nur verwendet, solange Sie diesen Anbieter selbst unter **Verwendete KI** auswählen.
- Die Modellliste unten in jedem KI-Bereich zeigt zuerst die Abonnements, dann die Anbieter mit Schlüssel, die Sie fertig eingerichtet haben. Unter einem Abonnement ist **Standardmodell** das reguläre Modell dieses Abonnements.

## API-Schlüssel (Erweitert ▸ KI-Modell)

Für alle, die lieber direkt bei einem Anbieter bezahlen oder ein eigenes Modell betreiben.

- Wählen Sie einen **Anbieter**, tragen Sie dessen **API-Schlüssel** ein (und eine **Base URL**, wenn der Anbieter eine braucht), wählen Sie ein **Modell** und klicken Sie auf **Speichern**. Die Liste umfasst OpenAI-kompatible Server, Anthropic, Gemini, DeepSeek, DashScope (qwen), Atlas Cloud und weitere.
- Die Liste **Anbieter** legt hier nur fest, wessen Felder angezeigt werden. Welche KI verwendet wird, ändert sie nicht; das bestimmt immer **Verwendete KI**. Ist ein gespeicherter Anbieter nicht die KI in Verwendung, erscheint oben **Diese KI verwenden**; ein Klick wählt ihn unter **Verwendete KI** aus.
- Chats über einen Anbieter mit Schlüssel laufen über Ihren eigenen Schlüssel, und dieser Anbieter stellt sie Ihnen in Rechnung.
- Schlüssel werden in der Einstellungsdatei der App auf diesem Rechner gespeichert und nur in den Anfrage-Headern gesendet.
- **Verbindung testen**: prüft die Erreichbarkeit des Endpunkts und die Sichtbarkeit des Modells, bevor gespeichert wird.
- Basis-URLs dürfen Pfad und Abfragezeichenfolge enthalten (Gateway-Stil); Endpunktpfade werden korrekt angehängt.
- Für Server, die Sie selbst betreiben, lassen sich mehrere **Endpunkte** speichern, zwischen denen Sie jederzeit wechseln können.
- **Codex-Programmdatei** ist nur für ein Codex-Programm gedacht, das an einem ungewöhnlichen Ort installiert ist. Bleibt das Feld leer, wird das Programm automatisch gefunden.

## Welche Funktion was braucht

| Funktion                                     | Worüber sie läuft                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chat und Bearbeitung im KI-Bereich           | Ihr Abonnement oder ein Anbieter mit Schlüssel, den Sie selbst gewählt haben.                                                                                                                                                                                                                                                                                                         |
| Ein Bild verstehen                           | Die KI, mit der Sie chatten, sieht sich das Bild selbst an. Ein zusätzlicher Schlüssel ist nicht nötig. Unter Erweitert lässt sich ein eigener Anbieter für die Analyse wählen.                                                                                                                                                                                                       |
| Ein Bild erzeugen                            | **Mit Ihrem verbundenen Codex-Abonnement.** Wählen Sie unter Erweitert ▸ KI-Medien & Suche einen Bildanbieter, wird dieser zuerst verwendet. Ist die gewählte Option nicht nutzbar, springt ein, was von Codex-Abonnement und eingerichteten Anbietern nutzbar ist. Ohne beides steht die Bildgenerierung nicht zur Verfügung, und Slides verwendet stattdessen Bilder aus der Suche. |
| Video- und Audioanalyse                      | Ein Anbieter mit Schlüssel, der Video unterstützt, gewählt unter Erweitert ▸ KI-Medien & Suche.                                                                                                                                                                                                                                                                                       |
| Web- und Bildsuche, Seiten per Adresse lesen | Standardmäßig kostenlos und ohne Schlüssel. Der Schlüssel eines Suchanbieters ist optional.                                                                                                                                                                                                                                                                                           |
| Suche in Ihren eigenen Dateien               | Läuft auf diesem Rechner. Das Neuordnen der Ergebnisse über einen Dienst ist optional und standardmäßig aus.                                                                                                                                                                                                                                                                          |

Unter **Erweitert ▸ KI-Medien & Suche** werden Schlüssel und Basis-URL eines Anbieters einmal eingetragen und von jeder Funktion gemeinsam genutzt, die diesen Anbieter verwendet.

## Wann Änderungen wirksam werden

- Änderungen an Modell und Endpunkt gelten sofort; eine laufende Unterhaltung behält die alte Konfiguration bis zu ihrem nächsten Durchgang.
