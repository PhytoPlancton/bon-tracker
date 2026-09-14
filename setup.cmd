@echo off
setlocal
cd /d "%~dp0"
title Bon Tracker - installation

echo.
echo  =========================================
echo    Bon Tracker - installation
echo  =========================================
echo.

echo  [1/4] Verification de Docker...
docker version >nul 2>&1
if errorlevel 1 (
  echo.
  echo  Docker ne repond pas.
  echo  Demarre Docker Desktop, attends que l'icone soit verte, puis relance ce script.
  echo.
  pause
  exit /b 1
)
echo        Docker est pret.
echo.

if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo  [2/4] Fichier .env cree.
) else (
  echo  [2/4] Fichier .env deja present, il sera complete.
)

rem Compose refuse de demarrer si un fichier env_file manque. Or c'est
rem l'etape de configuration, lancee par Compose, qui le remplit : on le cree
rem donc vide au prealable.
if not exist "secrets.env" type nul > "secrets.env"
echo.

echo  [3/4] Construction des images...
echo        Quelques minutes la premiere fois - Chromium est telecharge.
echo.
docker compose build
if errorlevel 1 (
  echo.
  echo  La construction a echoue. Le detail est au-dessus.
  pause
  exit /b 1
)
echo.

echo  [4/4] Configuration.
echo.
docker compose run --rm --no-deps --user root -v "%cd%:/host" web node scripts/setup.mjs /host
if errorlevel 1 (
  echo.
  echo  Configuration interrompue. Relance ce script pour reprendre.
  pause
  exit /b 1
)

echo  Demarrage des services...
docker compose up -d --remove-orphans
if errorlevel 1 (
  echo.
  echo  Le demarrage a echoue. Le detail est au-dessus.
  pause
  exit /b 1
)

echo.
echo  =========================================
echo    C'est en route.
echo  =========================================
echo.
echo   Sur ce PC       : http://localhost:3000
echo   Depuis l'iPhone : https://bontracker.nmt.ovh
echo                     (si le tunnel Cloudflare est configure)
echo.
echo   Suivre la collecte :  docker compose logs -f worker
echo   Tout arreter       :  docker compose down
echo.
pause
