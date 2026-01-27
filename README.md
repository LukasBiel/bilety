# Seat Checker 

## Charakterystyka oprogramowania
**Nazwa:** Seat Checker

**Opis:** Celem aplikacji jest sprawdzanie dostępności miejsc na dane wydarzenia w prosty i szybki sposób. Aplikacja łączy informacje z różnych bileterii, dzięki czemu użytkownik nie musi przejmować się, na stronie której bileterii szukać najlepszego dla niego miejsca.
___
## Prawa autorskie i licencja
**Autorzy:** Bielawski Łukasz, Jankowska Noemi

**Licencja:** Ten projekt jest objęty licencją **GNU GPLv3**. Pełny tekst licencji znajduje się w pliku [LICENSE](LICENSE).
___
## Struktura projektu
```bash
.
├── seat-checker/                        # Główny kod aplikacji
│   ├── src/                             # Kod źródłowy aplikacji (UI + API + logika)
│   ├── scripts/                         # Plik .bat do uruchamiania aplikacji
│   ├── data/                            # Pliki danych 
│   └── .gitignore                       # Pliki ignorowane przez Git
│
├── docs/                                # Dokumentacja projektowa
│   ├── architecture.md                  # Architektura systemu
│   ├── application-startup.md           # Instrukcja uruchamiania
│   └── requirements.md                  # Specyfikacja wymagań
│
├── presentation/                        # Prezentacja projektu (Spotify API)
├── .vscode/                             # Ustawienia środowiska VS Code
├── LICENSE                              # Licencja projektu (GPLv3)
└── README.md                            # Główny opis projektu
```
___
## Wymagania wstępne

Przed uruchomieniem aplikacji upewnij się, że Twój komputer spełnia wymagania dotyczące niezbędnych komponentów.
Dokładna architektura systemu jest dostępna w folderze `docs`: [architecture](docs/architecture.md).
___
## Instrukcja uruchamiania aplikacji
Dokładna instrukcja uruchamiania aplikacji jest dostępna w folderze `docs`: [Instrukcja uruchamiania aplikacji w systemie](docs/application-startup.md)
___
## Specyfikacja wymagań

Szczegółowa specyfikacja wymagań jest dostępna w folderze `docs`:
- [Wymagania funkcjonalne i pozafunkcjonalne](docs/requirements.md)
___
## Możliwe rozszerzenia systemu
* Użytkownik ma możliwość wybrania organizatora, aby przeglądać tylko wydarzenia przypisane do wybranego organizatora.
* System może powiadamiać użytkownika (e-mail, push, SMS) kiedy miejsca na wybrane wydarzenia zmieniają status z niedostępnych na dostępne.
* Możliwość filtrowania wydarzeń po dacie, lokalizacji, cenie lub rodzaju wydarzenia, a także sortowania wg popularności lub dostępności miejsc.
___


