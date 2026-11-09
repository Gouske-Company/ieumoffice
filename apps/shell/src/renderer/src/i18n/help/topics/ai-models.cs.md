# Modely AI a nastavení

## Kde nastavení najdete

Otevřete **Nastavení** z řádku vlevo dole na domovské stránce a zvolte **AI**. Jako první uvidíte připojení předplatného. Většině lidí to stačí a má vlastní kapitolu: [Připojení předplatného](help://subscription).

Vše, k čemu je potřeba klíč, je v části **Pokročilé** dole na téže stránce. Zůstává sbalená, dokud ji neotevřete.

## Výchozí stav: vaše předplatné

- Volba **Používaná AI** je zpočátku nastavena na **Automaticky**: z připojených předplatných nejprve Claude, potom ChatGPT, potom Codex.
- Automatický režim nikdy nevybere nic, co stojí peníze navíc. Klíč API se používá jen tehdy, když daného poskytovatele sami zvolíte v nabídce **Používaná AI**.
- Seznam modelů ve spodní části každého panelu AI zobrazuje nejprve předplatná a potom poskytovatele s klíčem, jejichž nastavení jste dokončili. U předplatného znamená **Výchozí model** standardní model daného předplatného.

## Klíče API (Pokročilé ▸ Model AI)

Pro ty, kdo chtějí platit poskytovateli přímo nebo provozují vlastní model.

- Zvolte položku v poli **Poskytovatel**, zadejte **Klíč API** (a **Základní URL**, pokud ji poskytovatel vyžaduje), vyberte **Model** a stiskněte **Uložit**. Seznam zahrnuje servery kompatibilní s OpenAI, Anthropic, Gemini, DeepSeek, DashScope (qwen), Atlas Cloud a další.
- Seznam **Poskytovatel** zde určuje jen to, čí pole jsou na obrazovce. Nemění, která AI se používá; o tom vždy rozhoduje **Používaná AI**. Pokud uložený poskytovatel není právě používaná AI, nahoře se objeví **Použít tuto AI**; kliknutím ho vyberete v poli **Používaná AI**.
- Konverzace přes poskytovatele s klíčem používají váš vlastní klíč a účtuje vám je tento poskytovatel.
- Klíče se ukládají do souboru nastavení aplikace na tomto počítači a odesílají pouze v hlavičkách požadavků.
- **Otestovat připojení**: ověří dosažitelnost koncového bodu a viditelnost modelu před uložením.
- Základní URL může obsahovat cestu a dotaz (ve stylu brány); cesty koncových bodů se správně připojují.
- Pro servery, které provozujete sami, lze uložit několik **koncových bodů** a kdykoli mezi nimi přepínat.
- **Spustitelný soubor Codex** je určen jen pro program Codex nainstalovaný na neobvyklém místě. Necháte-li pole prázdné, program se najde automaticky.

## Která funkce co potřebuje

| Funkce                                                       | Na čem běží                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chat a úpravy v panelu AI                                    | Vaše předplatné, nebo poskytovatel s klíčem, kterého jste sami zvolili.                                                                                                                                                                                                                                                                                         |
| Porozumění obrázku                                           | AI, se kterou chatujete, si obrázek prohlédne sama. Žádný další klíč není potřeba. V části Pokročilé lze zvolit samostatného poskytovatele analýzy.                                                                                                                                                                                                             |
| Generování obrázku                                           | **Přes připojené předplatné Codex.** Pokud v části Pokročilé ▸ AI média a vyhledávání vyberete poskytovatele obrázků, použije se jako první. Když vybraný použít nejde, zastoupí ho to, co jde použít z předplatného Codex a nastavených poskytovatelů. Bez obojího není generování obrázků dostupné a Slides místo toho používá obrázky nalezené vyhledáváním. |
| Analýza videa a zvuku                                        | Poskytovatel s klíčem, který podporuje video, zvolený v části Pokročilé ▸ AI média a vyhledávání.                                                                                                                                                                                                                                                               |
| Vyhledávání na webu a obrázků, čtení stránky z webové adresy | Ve výchozím stavu zdarma, bez klíče. Klíč poskytovatele vyhledávání je volitelný.                                                                                                                                                                                                                                                                               |
| Hledání ve vlastních souborech                               | Běží na tomto počítači. Přeřazení výsledků přes externí službu je volitelné a ve výchozím stavu vypnuté.                                                                                                                                                                                                                                                        |

V části **Pokročilé ▸ AI média a vyhledávání** se klíč a základní URL poskytovatele zadávají jednou a sdílí je každá funkce, která tohoto poskytovatele používá.

## Kdy se změny projeví

- Změny modelu a koncového bodu působí okamžitě; probíhající konverzace si drží původní nastavení až do svého dalšího kroku.
