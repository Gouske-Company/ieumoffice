# AI-modellen en instellingen

## Waar de instellingen staan

Open **Instellingen** via de regel linksonder op Start en kies **AI**. Het eerste wat je ziet is de abonnementsverbinding. Meer hebben de meeste mensen niet nodig, en er is een eigen artikel over: [Abonnementsverbinding](help://subscription).

Alles waarvoor een sleutel nodig is, staat onder **Geavanceerd**, onderaan dezelfde pagina. Dat blijft dicht tot je het opent.

## De standaard: je abonnement

- **AI die wordt gebruikt** staat eerst op **Automatisch**: van de verbonden abonnementen eerst Claude, dan ChatGPT, dan Codex.
- Automatisch kiest nooit iets wat extra geld kost. Een API-sleutel wordt alleen gebruikt zolang je die provider zelf kiest onder **AI die wordt gebruikt**.
- De modellenlijst onder in elk AI-paneel toont eerst de abonnementen en daarna de providers met een sleutel die je volledig hebt ingesteld. Onder een abonnement is **Standaardmodel** het standaardmodel van dat abonnement.

## API-sleutels (Geavanceerd ▸ AI-model)

Voor wie liever rechtstreeks aan een provider betaalt of een eigen model draait.

- Kies een **Provider**, vul de **API-sleutel** in (en een **Base URL** als de provider die nodig heeft), kies een **Model** en druk op **Opslaan**. De lijst bevat OpenAI-compatibele servers, Anthropic, Gemini, DeepSeek, DashScope (qwen), Atlas Cloud en meer.
- De lijst **Provider** bepaalt hier alleen wiens velden op het scherm staan. Welke AI in gebruik is, verandert er niet door; dat bepaalt altijd **AI die wordt gebruikt**. Is een opgeslagen provider niet de AI die in gebruik is, dan verschijnt bovenaan **Deze AI gebruiken**; een klik maakt die provider de **AI die wordt gebruikt**.
- Gesprekken via een provider met een sleutel gebruiken je eigen sleutel, en die provider brengt ze bij je in rekening.
- Sleutels worden opgeslagen in het instellingenbestand van de app op deze machine en alleen in aanvraagheaders verzonden.
- **Verbinding testen**: controleert vóór het opslaan of het eindpunt bereikbaar is en het model zichtbaar is.
- Basis-URL's mogen een pad en een querystring bevatten (gateway-stijl); eindpuntpaden worden correct toegevoegd.
- Voor servers die je zelf draait kun je meerdere **eindpunten** opslaan en er op elk moment tussen wisselen.
- **Codex-uitvoerbaar bestand** is alleen bedoeld voor een Codex-programma dat op een ongebruikelijke plek is geïnstalleerd. Laat je het leeg, dan wordt het programma automatisch gevonden.

## Welke functie wat nodig heeft

| Functie                                                              | Waarop het draait                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chatten en bewerken in het AI-paneel                                 | Je abonnement, of een provider met een sleutel die je zelf hebt gekozen.                                                                                                                                                                                                                                                                                                                                        |
| Een afbeelding begrijpen                                             | De AI waarmee je chat, bekijkt de afbeelding zelf. Er is geen extra sleutel nodig. Onder Geavanceerd kun je een aparte provider voor analyse kiezen.                                                                                                                                                                                                                                                            |
| Een afbeelding genereren                                             | **Met je verbonden Codex-abonnement.** Kies je onder Geavanceerd ▸ AI-media en zoeken een afbeeldingsprovider, dan gaat die voor. Is de gekozen optie niet bruikbaar, dan neemt wat bruikbaar is van het Codex-abonnement en je ingestelde providers het over. Zonder een van beide is afbeeldingen genereren niet beschikbaar, en gebruikt Slides in plaats daarvan afbeeldingen die via zoeken zijn gevonden. |
| Video- en audioanalyse                                               | Een provider met een sleutel die video ondersteunt, gekozen onder Geavanceerd ▸ AI-media en zoeken.                                                                                                                                                                                                                                                                                                             |
| Zoeken op het web en naar afbeeldingen, pagina's lezen via een adres | Standaard gratis, zonder sleutel. Een sleutel van een zoekprovider is optioneel.                                                                                                                                                                                                                                                                                                                                |
| Zoeken in je eigen bestanden                                         | Draait op deze machine. De resultaten door een dienst opnieuw laten rangschikken is optioneel en staat standaard uit.                                                                                                                                                                                                                                                                                           |

Onder **Geavanceerd ▸ AI-media en zoeken** vul je de sleutel en de basis-URL van een provider één keer in; elke functie die die provider gebruikt, deelt ze.

## Wanneer wijzigingen ingaan

- Wijzigingen aan model en eindpunt gaan meteen in; een lopend gesprek houdt de oude configuratie aan tot de volgende beurt.
