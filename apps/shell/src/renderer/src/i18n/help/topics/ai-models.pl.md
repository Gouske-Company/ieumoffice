# Modele AI i ustawienia

## Gdzie są ustawienia

Otwórz **Ustawienia** z wiersza w lewym dolnym rogu strony głównej i wybierz **AI**. Najpierw zobaczysz połączenie z subskrypcją. Większości osób to wystarcza, a temat ma własny artykuł: [Połączenie z subskrypcją](help://subscription).

Wszystko, co wymaga klucza, znajduje się w części **Zaawansowane** na dole tej samej strony. Pozostaje ona zwinięta, dopóki jej nie otworzysz.

## Domyślnie: twoja subskrypcja

- Pole **Używane AI** jest początkowo ustawione na **Automatycznie**: spośród połączonych subskrypcji najpierw Claude, potem ChatGPT, potem Codex.
- Tryb automatyczny nigdy nie wybiera niczego, co kosztuje dodatkowo. Klucz API jest używany tylko wtedy, gdy samodzielnie wybierzesz danego dostawcę w polu **Używane AI**.
- Lista modeli u dołu każdego panelu AI pokazuje najpierw subskrypcje, a potem dostawców z kluczem, których konfiguracja jest ukończona. W ramach subskrypcji **Model domyślny** oznacza standardowy model tej subskrypcji.

## Klucze API (Zaawansowane ▸ Model AI)

Dla osób, które wolą płacić dostawcy bezpośrednio albo uruchamiają własny model.

- Wybierz pozycję w polu **Dostawca**, wpisz **Klucz API** (oraz **Base URL**, jeśli dostawca go wymaga), wybierz **Model** i naciśnij **Zapisz**. Lista obejmuje serwery zgodne z OpenAI, Anthropic, Gemini, DeepSeek, DashScope (qwen), Atlas Cloud i inne.
- Lista **Dostawca** decyduje tutaj tylko o tym, czyje pola są widoczne na ekranie. Nie zmienia tego, które AI jest używane; o tym zawsze decyduje **Używane AI**. Jeśli zapisany dostawca nie jest używanym AI, u góry pojawia się **Użyj tego AI**; kliknięcie wybiera go w polu **Używane AI**.
- Rozmowy przez dostawcę z kluczem korzystają z twojego własnego klucza, a opłaty za nie nalicza ten dostawca.
- Klucze są przechowywane w pliku ustawień aplikacji na tym komputerze i wysyłane wyłącznie w nagłówkach żądań.
- **Testuj połączenie**: sprawdza osiągalność punktu końcowego i widoczność modelu przed zapisaniem.
- Adresy bazowe mogą zawierać ścieżkę i ciąg zapytania (w stylu bramy); ścieżki punktów końcowych są dokładnie doklejane.
- Dla serwerów, które uruchamiasz samodzielnie, można zapisać kilka **punktów końcowych** i w każdej chwili się między nimi przełączać.
- **Plik wykonywalny Codex** jest potrzebny tylko wtedy, gdy program Codex jest zainstalowany w nietypowym miejscu. Zostaw pole puste, a program zostanie znaleziony automatycznie.

## Która funkcja czego wymaga

| Funkcja                                                               | Z czego korzysta                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Czat i edycja w panelu AI                                             | Twoja subskrypcja albo samodzielnie wybrany dostawca z kluczem.                                                                                                                                                                                                                                                                                                                                   |
| Rozumienie obrazu                                                     | AI, z którym rozmawiasz, samo ogląda obraz. Dodatkowy klucz nie jest potrzebny. W części Zaawansowane można wybrać osobnego dostawcę analizy.                                                                                                                                                                                                                                                     |
| Generowanie obrazu                                                    | **Przez połączoną subskrypcję Codex.** Jeśli wybierzesz dostawcę obrazów w Zaawansowane ▸ Media i wyszukiwanie AI, jest on używany jako pierwszy. Gdy wybranego nie da się użyć, zastępuje go to, co działa spośród subskrypcji Codex i skonfigurowanych dostawców. Bez żadnego z nich generowanie obrazów jest niedostępne, a Slides używa zamiast tego obrazów znalezionych przez wyszukiwanie. |
| Analiza wideo i dźwięku                                               | Dostawca z kluczem obsługujący wideo, wybrany w Zaawansowane ▸ Media i wyszukiwanie AI.                                                                                                                                                                                                                                                                                                           |
| Wyszukiwanie w sieci i wyszukiwanie obrazów, czytanie strony z adresu | Domyślnie bezpłatne, bez klucza. Klucz dostawcy wyszukiwania jest opcjonalny.                                                                                                                                                                                                                                                                                                                     |
| Wyszukiwanie we własnych plikach                                      | Działa na tym komputerze. Ponowne porządkowanie wyników przez usługę zewnętrzną jest opcjonalne i domyślnie wyłączone.                                                                                                                                                                                                                                                                            |

W części **Zaawansowane ▸ Media i wyszukiwanie AI** klucz i bazowy adres URL dostawcy wpisuje się raz i są one wspólne dla wszystkich funkcji, które z tego dostawcy korzystają.

## Kiedy zmiany zaczynają obowiązywać

- Zmiany modelu i punktu końcowego działają natychmiast; trwająca rozmowa zachowuje poprzednią konfigurację do swojej następnej tury.
