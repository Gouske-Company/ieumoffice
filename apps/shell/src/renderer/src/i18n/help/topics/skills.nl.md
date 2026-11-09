# Vaardigheden

Een vaardigheid is een set werkinstructies voor de AI. Leg iets wat je steeds opnieuw doet één keer vast — de stappen om vergaderaantekeningen op te schonen, de toon van een verslag, de punten die je elke keer controleert — en je kunt het in het AI-paneel aanroepen, of de AI pakt het zelf op als het past. Een vaardigheid is een map met een `SKILL.md`-bestand in een open formaat, dus een vaardigheid die je in GenOffice maakt, werkt ongewijzigd ook in Claude Code of Codex.

## Vaardigheden aan- en uitzetten

**Instellingen ▸ Vaardigheden** toont de vaardigheden op deze pc, gegroepeerd naar herkomst. Vaardigheden worden bij hun naam getoond, zoals codeeragents dat doen. Met het zoekvak bovenaan vind je er een op naam of beschrijving.

| Herkomst                   | Wat erin staat                                                          | In het begin |
| -------------------------- | ----------------------------------------------------------------------- | ------------ |
| **Ingebouwd**              | De 5 vaardigheden die met GenOffice meekomen                            | Aan          |
| **Mijn vaardigheden**      | Vaardigheden die je hebt toegevoegd of gemaakt (`~/.ieumoffice/skills`) | Aan          |
| **Claude-vaardighedenmap** | De vaardigheden in `~/.claude/skills`                                   | Uit          |
| **Claude-plug-ins**        | De vaardigheden van geïnstalleerde Claude-plug-ins                      | Uit          |
| **Codex-vaardighedenmap**  | De vaardigheden in `~/.agents/skills`                                   | Uit          |

- Met de schakelaar zet je een vaardigheid aan of uit. Dezelfde instelling geldt voor het AI-paneel van elke editor, voor Ask AI op Start en voor het agentvenster.
- Kies voor een vaardigheid die aanstaat **AI beslist** of **Alleen bij aanroepen**. In het begin staat AI beslist ingesteld. Met Alleen bij aanroepen wordt de vaardigheid alleen gebruikt als je hem zelf aanroept.
- Vaardigheden uit verschillende bronnen kunnen dezelfde naam hebben. Het herkomstlabel op elke rij maakt het verschil duidelijk.
- In het menu met meer opties staan **Inhoud bekijken**, **Bewerken** (alleen mijn vaardigheden), **Exporteren (zip)** (alleen mijn vaardigheden) en **Map openen**.
- **Naar prullenbak** verplaatst een van mijn vaardigheden naar de prullenbak van het systeem, waaruit je hem kunt terugzetten.
- Een ingebouwde vaardigheid wordt verborgen in plaats van verwijderd: kies **Verbergen**. **Weer tonen** onderaan de lijst haalt hem terug zoals hij in het begin was.
- Wil je een ingebouwde vaardigheid of een vaardigheid uit een ander programma aanpassen, kies dan **Kopiëren naar mijn vaardigheden**. De kopie verschijnt bij mijn vaardigheden en het origineel gaat uit.
- Exporteer je een vaardigheid met een sjabloon, dan gaat het sjabloondocument ook mee in de zip. Controleer vóór het exporteren dat het document geen persoonsgegevens bevat.
- **Meerdere exporteren** boven aan de pagina zet de vaardigheden die je aanvinkt in één zip-bestand, een map per vaardigheid. Wie de zip krijgt, voegt die toe zoals elke andere vaardigheids-zip en kan kiezen welke vaardigheden eruit te installeren.

## Een vaardigheid toevoegen

1. Klik in **Instellingen ▸ Vaardigheden** op **Toevoegen**.
2. Kies **Uit een map**, **Uit een zip-bestand**, **Uit geplakte tekst** of **Via een GitHub-link**. Voor geplakte tekst plak je de hele `SKILL.md`, vanaf de eerste regel `---`, en klik je op **Voorbeeld**. Voor GitHub vul je het adres van een openbare repository, `owner/repo` of de pagina van een vaardigheid op skills.sh in en klik je op **Zoeken**.
3. Bekijk de gevonden vaardigheden in het voorbeeld. Je ziet het aantal en de grootte van de bestanden, of er scripts in zitten, de webadressen in de tekst, het licentiebestand en de regels om te lezen voordat je installeert.
4. Vink alleen de vaardigheden aan die je wilt installeren en klik op **Installeren**. Geïnstalleerde vaardigheden staan meteen aan.

Onder het voorbeeld staat altijd: "Installeer alleen vaardigheden uit bronnen die je vertrouwt. Een vaardigheid geeft de AI instructies en kan in het agentvenster scripts uitvoeren". Lees een vaardigheid uit een onbekende bron door voordat je hem installeert.

- Staat er bij mijn vaardigheden al een met dezelfde naam, kies dan op die rij **Vervangen** of **Overslaan**.
- Je kunt het zip-bestand van een vaardigheid of een `SKILL.md`-bestand ook op een willekeurig GenOffice-venster neerzetten. **Instellingen ▸ Vaardigheden** opent dan met hetzelfde voorbeeld. Een zip telt als vaardigheid als `SKILL.md` op het hoogste niveau staat of elke map op het hoogste niveau er een bevat; met elke andere zip gebeurt niets. Een `SKILL.md`-bestand komt alleen binnen: zet een vaardigheid met meer bestanden in een zip.
- **Regels om te lezen voordat je installeert** zijn regels die de AI vragen eerdere instructies te negeren, iets voor je verborgen te houden of instructies van een extern adres te halen, en `../`-paden die buiten de vaardigheidsmap wijzen. Bij elke regel staan het bestand en het regelnummer. Ze houden de installatie niet tegen, en een vaardigheid zonder zulke regels is daarom nog niet veilig.
- Bij het downloaden van GitHub maakt GenOffice alleen verbinding met `github.com`, `api.github.com` en `codeload.github.com`, en stuurt het geen aanmeldgegevens mee. Is het archief te groot of komt het niet door de veiligheidscontroles, dan wordt er niets geïnstalleerd.
- De pagina van een vaardigheid op skills.sh (`https://skills.sh/owner/repo/skill`) wordt gelezen als die vaardigheid in de GitHub-repository `owner/repo`. GenOffice maakt geen verbinding met skills.sh.
- **Nieuwe vaardigheid** opent een lege editor waarin je zelf de naam, beschrijving en instructies schrijft.

## Op updates controleren

- Bij een vaardigheid die van GitHub is geïnstalleerd, zoekt **Controleren op updates** in het menu met meer opties naar nieuwe inhoud. Er wordt alleen contact met GitHub gemaakt als je erop klikt.
- Is er niets veranderd, dan staat er "Actueel". Is er wel iets veranderd, bekijk dan de gewijzigde bestanden en het voorbeeld en klik op **Bijwerken**.
- Heb je de vaardigheid na het installeren zelf bewerkt, dan verschijnt ook "Je eigen wijzigingen gaan verloren".
- Bijwerken houdt de aan/uit-stand van de vaardigheid en de keuze tussen AI beslist en Alleen bij aanroepen ongewijzigd.

## Een vaardigheid aanroepen in het AI-paneel

1. Typ `/` of `$` aan het begin van het invoervak van de AI of direct na een spatie. De lijst met vaardigheden die aanstaan verschijnt.
2. Typ verder om de lijst te verkleinen. Zo vindt `/meet` de vaardigheid `meeting-minutes`. Woorden uit de beschrijving werken ook, dus ook `/notu` vindt hem.
3. Kies er een met de pijltjestoetsen en druk op Enter of Tab. De vaardigheid wordt een chip boven het invoervak.
4. Schrijf wat je wilt en verstuur. GenOffice voegt de inhoud van de vaardigheid aan het verzoek toe.

- In het AI-paneel van Excel opent `$` de lijst alleen helemaal aan het begin van het invoervak, zodat het celadressen zoals `$A$1` niet in de weg zit.
- Je kunt meerdere chips toevoegen en er een weghalen met ×. Esc sluit alleen de lijst; een lopende AI-taak stopt er niet door.
- **Vaardigheden beheren…** onderaan de lijst opent **Instellingen ▸ Vaardigheden**.
- Chips blijven bij het verstuurde bericht en in het opgeslagen gesprek staan. Open je een gesprek opnieuw en verstuur je weer, dan wordt de huidige inhoud van de vaardigheid opnieuw gelezen. Een vaardigheid die intussen verwijderd of uitgezet is, staat op de chip als "Niet beschikbaar".
- Is de tekst van de mee te sturen vaardigheden te lang, dan verschijnt "De vaardigheden zijn te groot om mee te sturen" en wordt er niets verstuurd.

## Vaardigheden die de AI zelf gebruikt

- Van de vaardigheden die aanstaan en op AI beslist zijn ingesteld, krijgt de AI de namen en beschrijvingen als lijst. Past er een bij het verzoek, dan neemt de AI de inhoud ervan en gebruikt hem.
- Gebruikt de AI een vaardigheid, dan staat in het gesprek "Vaardigheid 〈naam〉 gebruikt".
- De AI beslist aan de hand van de beschrijving of hij een vaardigheid gebruikt. Een beschrijving die zegt wanneer de vaardigheid bedoeld is, helpt hem goed te kiezen.

## Een vaardigheid maken door erom te vragen

1. Zeg in het AI-paneel bijvoorbeeld "Sla wat we net gedaan hebben op als vaardigheid" of "Maak een vaardigheid die verslagen in onze huisstijl schrijft".
2. De AI haalt de stappen en regels eruit die het herhalen waard zijn en toont een kaart **Nieuwe vaardigheid**. Waarden die alleen deze keer gebruikt zijn, zoals namen en datums, blijven buiten de instructies.
3. Controleer en bewerk de naam, beschrijving en instructies op de kaart. De naam is wat de lijst met vaardigheden toont en wat je na `/` typt: Engelse kleine letters, cijfers en koppeltekens.
4. Klik op **Opslaan**. De nieuwe vaardigheid wordt aan mijn vaardigheden toegevoegd, gaat aan en staat meteen in de lijst van `/`.

- Er wordt geen bestand geschreven tot je op **Opslaan** klikt. Klik je op **Annuleren**, dan bewaart het gesprek hem alleen als "Niet-opgeslagen voorstel voor een vaardigheid".
- Je kunt ook vragen een bestaande vaardigheid aan te passen, bijvoorbeeld "Pas de notulenvaardigheid aan aan hoe wij het doen". De kaart heet dan **Vaardigheid wijzigen**. Een van mijn vaardigheden wordt overschreven met **Vervangen**; een ingebouwde vaardigheid of een uit een ander programma wordt als kopie bij mijn vaardigheden opgeslagen en het origineel gaat uit.

## Een document als sjabloon toevoegen

Maak je een vaardigheid in het AI-paneel van een editor, dan kan het huidige document als sjabloon meegaan. Vink op de kaart **Dit document ook als sjabloon opslaan** aan en de knop wordt er twee.

- **Leeg sjabloon maken**: een kopie van het document opent in een nieuw tabblad, "Sjabloonvoorbeeld - 〈titel〉", en de AI in dat tabblad maakt de ingevulde waarden leeg, zoals namen, datums en persoonsgegevens. Bekijk het tabblad, pas zelf nog dingen aan en klik dan op **Dit tabblad als sjabloon opslaan**; het tabblad zoals het op dat moment is, wordt het sjabloon.
- **Document opslaan zoals het is**: slaat het huidige document ongewijzigd als sjabloon op. Heeft het document delen die je voor de AI hebt verborgen, dan is deze knop geblokkeerd, zodat verborgen inhoud niet zomaar in het sjabloon belandt.
- Het sjabloon wordt als kopie van het document in de map van de vaardigheid bewaard. Het oorspronkelijke document verandert niet.

## Een vaardigheid met een sjabloon gebruiken

- Een vaardigheid met een sjabloon toont **Met sjabloon** in de lijst.
- Roep hem aan als chip en verstuur: een kopie van het sjabloon opent als nieuw naamloos document en de AI in dat tabblad gaat verder met je verzoek. In het oorspronkelijke paneel blijven "Er wordt in een nieuw tabblad met de sjabloon gewerkt" en **Naar het tabblad** staan.
- Kiest de AI zelf een vaardigheid met sjabloon, dan opent er niet meteen een tabblad. Het gesprek toont in plaats daarvan de knop **Nieuw document openen met deze sjabloon**.
- Roep je hem aan in een document dat al inhoud heeft, dan vraagt hij eerst waar hij moet werken in plaats van meteen een tabblad te openen. **In dit document doen** past het huidige document aan volgens de vaardigheid, zonder nieuw tabblad (het sjabloonbestand wordt niet geopend). **Nieuw document uit de sjabloon (dit document bijvoegen)** opent de kopie van de sjabloon in een nieuw tabblad en stuurt het huidige document als bijlage naar het AI-paneel van dat tabblad. Om het bij te voegen moet het huidige document opgeslagen zijn. Is het nooit opgeslagen of zijn er niet-opgeslagen wijzigingen, dan zegt het paneel dat, en **Openen zonder bijlage** opent de kopie zonder. Ook de knop die verschijnt als de AI zelf een vaardigheid met sjabloon gebruikt, voegt een document met inhoud bij. De Markdown- en PDF-editor accepteren geen bijlagen, dus een sjabloon die daar opent krijgt niets bijgevoegd.
- Waar het nieuwe document komt, kies je meestal de eerste keer dat je het opslaat. De Markdown- en HTML-editor slaan zoals altijd op in de standaardmap. Het sjabloonbestand zelf blijft zoals het was.

## Vaardigheden met scripts

- In het gewone AI-paneel en in Ask AI op Start worden de scripts van een vaardigheid nooit uitgevoerd. Alleen de tekst van de vaardigheid bereikt de AI.
- Een vaardigheid met scripts toont **Met scripts · werkt volledig in het agentvenster**, en als je hem als chip toevoegt verschijnt "De scripts van deze vaardigheid worden niet uitgevoerd in het gewone AI-paneel". Versturen wordt niet geblokkeerd.
- Wil je de scripts ook gebruiken, roep de vaardigheid dan aan in het agentvenster. Zie [Agentmodus](help://agent-mode).

## Ingebouwde vaardigheden

| Vaardigheid       | Wat hij doet                                                                                               |
| ----------------- | ---------------------------------------------------------------------------------------------------------- |
| `meeting-minutes` | Maakt van vergaderaantekeningen notulen met de besluiten en actiepunten                                    |
| `internal-comms`  | Schrijft mededelingen, nieuwsbrieven, voortgangsrapporten, veelgestelde vragen en andere interne berichten |
| `humanizer`       | Zoekt formuleringen die naar AI klinken en maakt ze natuurlijk                                             |
| `copy-editing`    | Loopt een Engelse tekst die je hebt geschreven na en maakt hem duidelijker en bondiger                     |
| `find-skills`     | Zoekt in het agentvenster de vaardigheden die je nodig hebt en stelt voor ze te installeren                |

`copy-editing` is gemaakt voor Engelse marketingteksten. `find-skills` werkt alleen in het agentvenster.

## In het agentvenster

- Het agentvenster volgt dezelfde aan/uit-instellingen in **Instellingen ▸ Vaardigheden**, en je roept vaardigheden in het invoervak op dezelfde manier aan met `/` of `$`.
- Vaardigheden in `.claude/skills` en `.agents/skills` van de projectmap worden in die sessie gebruikt zonder dat je ze aanzet.
- De lijst met vaardigheden ligt vast zodra de sessie start. Zet je tijdens een sessie vaardigheden aan of uit, dan verschijnt "Gewijzigde vaardigheden gelden vanaf de volgende sessie".
- Maakt de agent een vaardigheid, dan verschijnt dezelfde kaart in het venster. Kies voor het sjabloon uit de documenten die in tabbladen openstaan en de bestanden in de projectmap.
- Vindt de agent een vaardigheid die het installeren waard is, dan verschijnt een installatievoorstel. Open het met **Voorbeeld openen** en klik zelf op **Installeren**; anders wordt er niets geïnstalleerd. Een geïnstalleerde vaardigheid is beschikbaar vanaf de volgende sessie.
