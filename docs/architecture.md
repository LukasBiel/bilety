# Architektura systemu
## Architektura rozwoju
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

## Architektura uruchomieniowa
Przed uruchomieniem aplikacji upewnij się, że Twój komputer spełnia poniższe wymagania:

| Komponent                | Wersja / Uwagi                                        |
|--------------------------|-------------------------------------------------------|
| Node.js                  | LTS (np. 18.x) – [pobierz tutaj](https://nodejs.org/) |
| npm                      | Zainstalowany razem z Node.js                         |
| Przeglądarka internetowa | Chrome, Firefox lub Edge                              |
| Dysk                     | Min. 500 MB wolnego miejsca (do pobrania Chromium)    |

> 💡 Node.js to środowisko uruchomieniowe dla JavaScript, które pozwala uruchamiać aplikacje webowe i backend.
