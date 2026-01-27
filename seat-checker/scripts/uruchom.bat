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

:: Otworz przegladarke po 5 sekundach
timeout /t 5
start "" "http://localhost:3000"

:: Start aplikacji
call npm run dev
goto Koniec

:BladNode
echo [BLAD] Nie znaleziono Node.js!
echo Prosze zainstalowac Node.js LTS ze strony: https://nodejs.org/
echo.
pause
exit /b

:Koniec
pause
