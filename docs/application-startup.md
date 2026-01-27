# Instrukcja uruchamiania aplikacji

## Krok 1 – pobranie repozytorium (tylko raz)
1. Wejdź na GitHub: [https://github.com/LukasBiel/bilety](https://github.com/LukasBiel/bilety)
2. Pobierz repozytorium 
* Za pomocą Git
```bash
git clone https://github.com/LukasBiel/bilety.git
```
* Pobierz ZIP z GitHub, a następnie rozpakuj plik ZIP

## Krok 2 – uruchamianie aplikacji (za każdym razem)
### Za pomocą pliku wsadowego Windows
1. Wejdź do folderu `seat-checker`.
2. Kliknij plik `uruchom.bat` i uruchom jako administrator (jeśli wymagane do instalacji zależności).
3. Terminal uruchomi aplikację i wyświetli adres: `http://localhost:3000`.
4. Otwórz przeglądarkę i przejdź pod ten adres, aby korzystać z aplikacji.

❗Nie zamykaj terminala, dopóki chcesz korzystać z aplikacji – jeśli go zamkniesz, aplikacja również się wyłączy.
5. Gdy chcesz wyłączyć aplikację, kliknij terminal i wciśnij:
```bash
Ctrl + C
```
Po tym poleceniu terminal zatrzyma działanie serwera i aplikacja przestanie działać.

### Ręczne pobieranie i uruchamianie
1. Wejdź do katalogu projektu w terminalu (`seat-checker`).
2. Zainstaluj zależności Node.js:
```bash
npm install
```
3. Zainstaluj przeglądarkę Playwright:
```bash
npx playwright install chromium
```
Jeśli `npx` nie działa:
```bash
node node_modules/playwright/cli.js install chromium
```
4. Uruchom aplikację:
```bash
npm run dev
```
5. Otwórz przeglądarkę i wejdź na http://localhost:3000.
6. Nie zamykaj terminala, dopóki chcesz korzystać z aplikacji.
7. Aby zakończyć działanie, wciśnij `Ctrl + C` w terminalu.