@echo off
setlocal
cd ..
title Seat Checker Launcher

echo ===================================================
echo   URUCHAMIANIE APLIKACJI SEAT CHECKER
echo ===================================================
echo.

:: 1. Sprawdz czy Node.js jest zainstalowany
where node >nul 2>nul
if %errorlevel% neq 0 goto BladNode

:: 2. Sprawdz czy biblioteki sa, jesli tak to pomin instalacje
if exist "node_modules" goto StartSerwera

echo [INFO] Pierwsze uruchomienie - instaluje biblioteki...
echo To moze potrwac kilka minut.
echo.
call npm install

echo.
echo [INFO] Pobieranie przegladarki Chromium...
call npx playwright install chromium

:StartSerwera
:: 3. Uruchom serwer i otworz przegladarke
echo.
echo [INFO] Startuje serwer...
echo Aplikacja bedzie dostepna pod adresem: http://localhost:3000
echo Nie zamykaj tego czarnego okna, dopoki korzystasz z programu!
echo.

:: Start aplikacji w nowym oknie
start "Serwer Next.js" cmd /c "npm run dev"

echo.
echo [INFO] Czekam 10 sekund na start serwera...
timeout /t 10

echo.
echo [INFO] Serwer dziala. Uruchamiam bota powiadomien Discord (CRON JOB)...
echo Nie zamykaj tego czarnego okna, jesli chcesz otrzymywac powiadomienia!
echo Zamykajac to okno wylaczysz zarowno bota, jak i serwer.
echo.

:: Otworz przegladarke
start "" "http://localhost:3000"

:: Start Crona w glownym oknie
node scripts/cron-worker.js

goto Koniec

:BladNode
echo [BLAD] Nie znaleziono Node.js!
echo Prosze zainstalowac Node.js LTS ze strony: https://nodejs.org/
echo.
pause
exit /b

:Koniec
pause
