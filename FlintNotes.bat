@echo off
rem Запуск FlintNotes в Windows: двойной щелчок по этому файлу.
rem Другая папка с заметками: FlintNotes.bat "D:\Мои заметки"
rem (или в самом приложении: меню внизу слева, "Управление хранилищами")
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Не найден Node.js. Установите версию 20 или новее с https://nodejs.org и запустите этот файл снова.
  pause
  exit /b 1
)

rem Готовая сборка лежит в папке release. Ей нужен только Node.js, без установки зависимостей.
if not exist "release\server.mjs" (
  echo Нет готовой сборки в папке release.
  echo Соберите её командой:  npm install  и затем  npm run release
  pause
  exit /b 1
)

rem Сервер сам откроет браузер, когда будет готов. Закройте это окно, чтобы остановить FlintNotes.
set FLINT_OPEN=1
node "release\server.mjs" %*
if errorlevel 1 (
  echo.
  echo FlintNotes завершился с ошибкой. Нужен Node.js версии 20.19 или новее, сейчас установлена:
  node -v
)
pause
