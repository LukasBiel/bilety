# Seat Checker 

## Charakterystyka oprogramowania
**Nazwa:** Seat Checker

**Opis:** Celem aplikacji jest sprawdzanie dostępności miejsc na dane wydarzenia w prosty i szybki sposób. Aplikacja łączy informacje z różnych bileterii, dzięki czemu użytkownik nie musi przejmować się, na stronie której bileterii szukać najlepszego dla niego miejsca.
___
## Prawa autorskie
**Autorzy:** Bielawski Łukasz, Jankowska Noemi
___
## Wymagania wstępne

Przed uruchomieniem aplikacji upewnij się, że Twój komputer spełnia poniższe wymagania:

| Komponent                | Wersja / Uwagi                                        |
|--------------------------|-------------------------------------------------------|
| Node.js                  | LTS (np. 18.x) – [pobierz tutaj](https://nodejs.org/) |
| npm                      | Zainstalowany razem z Node.js                         |
| Przeglądarka internetowa | np. Chrome, Firefox lub Edge                              |
| Dysk                     | Min. 500 MB wolnego miejsca (do pobrania Chromium)    |

> 💡 Node.js to środowisko uruchomieniowe dla JavaScript, które pozwala uruchamiać aplikacje webowe i backend.
___
## Instrukcja uruchamiania aplikacji
Dokładna instrukcja uruchamiania aplikacji jest dostępna w folderze `docs`: [Instrukcja uruchamiania aplikacji w systemie](docs/application-startup.md)
___
## Specyfikacja wymagań

Szczegółowa specyfikacja wymagań jest dostępna w folderze `docs`:
- [Wymagania funkcjonalne i pozafunkcjonalne](docs/requirements.md)
___
## Architektura systemu
### Architektura rozwoju
| Nazwa                                                 | Przeznaczenie                                                   | Wersja |
|-------------------------------------------------------|-----------------------------------------------------------------|--------|
| TypeScript                                            | Język programowania, zapewnia typowanie statyczne               | 5.0+   |
| Next.js                                               | Framework aplikacji webowej, architektura App Router            | 14     |
| React                                                 | Warstwa prezentacji / komponenty UI                             | 18     |
| Tailwind CSS                                          | Stylowanie, Utility-First CSS                                   | latest |
| JSON (pliki `seen_events.json`, `stats_history.json`) | Warstwa danych / lekka baza danych plikowa                      | –      |
| Playwright                                            | Silnik scrapujący, automatyzacja przeglądarki (Headless Chrome) | latest |
| Cheerio                                               | Silnik scrapujący, szybki parsing statycznego HTML              | latest |
| Node.js                                               | Środowisko uruchomieniowe                                       | LTS    |

### Architektura uruchomieniowa
Przed uruchomieniem aplikacji upewnij się, że Twój komputer spełnia poniższe wymagania:

| Komponent                | Wersja / Uwagi                                        |
|--------------------------|-------------------------------------------------------|
| Node.js                  | LTS (np. 18.x) – [pobierz tutaj](https://nodejs.org/) |
| npm                      | Zainstalowany razem z Node.js                         |
| Przeglądarka internetowa | Chrome, Firefox lub Edge                              |
| Dysk                     | Min. 500 MB wolnego miejsca (do pobrania Chromium)    |

> 💡 Node.js to środowisko uruchomieniowe dla JavaScript, które pozwala uruchamiać aplikacje webowe i backend.

___
## Możliwe rozszerzenia systemu
* Użytkownik ma możliwość wybrania organizatora, aby przeglądać tylko wydarzenia przypisane do wybranego organizatora.
* System może powiadamiać użytkownika (e-mail, push, SMS) kiedy miejsca na wybrane wydarzenia zmieniają status z niedostępnych na dostępne.
* Możliwość filtrowania wydarzeń po dacie, lokalizacji, cenie lub rodzaju wydarzenia, a także sortowania wg popularności lub dostępności miejsc.
___
## Licencja
Ten projekt jest objęty licencją **GNU GPLv3**.  
Pełny tekst licencji znajduje się w pliku [LICENSE](LICENSE).
