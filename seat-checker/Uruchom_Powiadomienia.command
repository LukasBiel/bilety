#!/bin/bash

# Ustawienie poprawnego katalogu roboczego (katalog, w którym znajduje się ten plik)
cd "$(dirname "$0")"

echo "=================================================="
echo " Uruchamianie Automacji: Seat Checker (Mac OS) "
echo "=================================================="

# Sprawdzenie czy zainstalowany jest Node.js
if ! command -v node &> /dev/null
then
    echo "❌ Błąd: Nie znaleziono Node.js. Pobierz i zainstaluj z https://nodejs.org/"
    read -p "Naciśnij Enter, aby zamknąć..."
    exit 1
fi

echo "📦 Pobieranie aktualizacji z serwera..."
git pull

echo "📦 Instalacja ewentualnych nowych bibliotek..."
npm install

echo "🌐 Uruchamianie lokalnego serwera w tle..."
# Uruchamianie serwera w tle z logowaniem do pliku
npm run dev > server_log.txt 2>&1 &
SERVER_PID=$!

echo "⏳ Czekam 10 sekund na start serwera..."
sleep 10

echo "🚀 Serwer działa. Uruchamiam bota powiadomień Discord..."
echo "Aby wyłączyć wszystko, zamknij to okno terminala."

# Automatyczne otwarcie przeglądarki z aplikacją
open "http://localhost:3000"

# Uruchomienie skryptu Crona włączonego bezpośrednio w tym, głównym oknie
node scripts/cron-worker.js

# W przypadku wciśnięcia CMD+C i zamknięcia bota, ubijamy także poboczny proces serwera Next.js
kill $SERVER_PID
