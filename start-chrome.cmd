@echo off
setlocal
title Bon Tracker - Chrome dedie

rem Lance un Chrome separe, que le collecteur pilotera.
rem
rem Profil distinct de ta navigation habituelle : tes onglets, ton historique et
rem tes comptes ne sont pas touches. Il faut s'y connecter a leboncoin une seule
rem fois, la session y reste ensuite.

set "CHROME="
for %%P in (
  "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
  "%LocalAppData%\Google\Chrome\Application\chrome.exe"
) do if not defined CHROME if exist %%P set "CHROME=%%~P"

if not defined CHROME (
  echo.
  echo  Chrome est introuvable aux emplacements habituels.
  echo  Installe Google Chrome, ou indique son chemin dans ce fichier.
  echo.
  pause
  exit /b 1
)

set "PROFIL=%USERPROFILE%\bon-tracker-chrome"

echo.
echo  =========================================
echo    Bon Tracker - Chrome dedie
echo  =========================================
echo.
echo   Cette fenetre Chrome sert au collecteur.
echo   Laisse-la ouverte : sans elle, pas de releve.
echo.
echo   Au premier lancement, connecte-toi a leboncoin
echo   dans cette fenetre. C'est a faire une seule fois.
echo.

rem --remote-debugging-address=0.0.0.0 est necessaire pour que le collecteur,
rem qui tourne dans un container, puisse joindre ce Chrome. Le port 9222 devient
rem alors visible depuis le reseau local : a n'utiliser que sur un reseau de
rem confiance, et a bloquer dans le pare-feu Windows si tu es sur un reseau
rem partage.
start "" "%CHROME%" ^
  --remote-debugging-port=9222 ^
  --remote-debugging-address=0.0.0.0 ^
  --user-data-dir="%PROFIL%" ^
  --no-first-run ^
  --no-default-browser-check ^
  --disable-session-crashed-bubble ^
  --restore-last-session ^
  "https://www.leboncoin.fr/favorites"

echo   Chrome demarre. Tu peux fermer cette fenetre noire,
echo   mais pas la fenetre Chrome.
echo.
timeout /t 8 >nul
