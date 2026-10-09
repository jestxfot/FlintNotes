@echo off
rem Запуск FlintNotes в Windows: двойной щелчок по этому файлу.
rem Другая папка с заметками: FlintNotes.bat "D:\Мои заметки"
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Не найден Node.js. Установите версию 20 или новее с https://nodejs.org и запустите этот файл снова.
  pause
  exit /b 1
)

rem Зависимости, установленные из WSL, содержат программы для Linux: под Windows их нужно поставить заново.
if not exist "node_modules\.bin\tsx.cmd" (
  echo Устанавливаю зависимости. Это нужно один раз и займёт пару минут...
  if exist node_modules rmdir /s /q node_modules
  call npm install --no-fund --no-audit
  if errorlevel 1 (
    echo Не удалось установить зависимости.
    pause
    exit /b 1
  )
)

echo Собираю приложение...
call npm run build
if errorlevel 1 (
  echo Сборка не удалась.
  pause
  exit /b 1
)

rem Сервер сам откроет браузер, когда будет готов. Закройте это окно, чтобы остановить FlintNotes.
set FLINT_OPEN=1
call npm start -- %*
pause
