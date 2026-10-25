; The installer of FlintNotes for Windows, built by scripts/installer.mjs (makensis, from WSL):
;   /DVERSION=0.1.0 /DVERSION4=0.1.0.0 /DSOURCE=<the app's folder> /DOUTFILE=<FlintNotes-Setup.exe> /DICON=<flintnotes.ico>
; It installs for the current user only (no administrator), into %LOCALAPPDATA%\Programs\FlintNotes.
; Silent (/S) it is the app's update of itself; --run then starts the app again (--hidden: in the tray).
; The notes are never touched: they live in their vaults.
Unicode true
ManifestDPIAware true
SetCompressor /SOLID lzma
RequestExecutionLevel user

!include "MUI2.nsh"
!include "FileFunc.nsh"

!define APP "FlintNotes"
!define EXE "FlintNotes.exe"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP}"

Name "${APP}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\${APP}"
InstallDirRegKey HKCU "Software\${APP}" "InstallDir"
BrandingText "${APP} ${VERSION}"

VIProductVersion "${VERSION4}"
VIAddVersionKey /LANG=1049 "ProductName" "${APP}"
VIAddVersionKey /LANG=1049 "FileDescription" "Установка ${APP}"
VIAddVersionKey /LANG=1049 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1049 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=1049 "LegalCopyright" "${APP}"

!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TEXT "FlintNotes — заметки в обычных папках с Markdown, рядом с Obsidian.$\r$\n$\r$\nПрограмма ставится только для вас, права администратора не нужны. Заметки остаются там, где лежат.$\r$\n$\r$\nЕсли FlintNotes сейчас открыт, он сохранит набранное и закроется сам."
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Запустить FlintNotes"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Russian"

; A running FlintNotes is asked to quit (it saves what is typed and stops its server), and only made to
; when it has not done so in 20 seconds.
!macro CLOSE_APP ID
  IfFileExists "$INSTDIR\${EXE}" 0 +2
    nsExec::Exec '"$INSTDIR\${EXE}" --quit'
  StrCpy $R9 0
  wait_${ID}:
    ; `find` answers 0 while the program is among the running ones.
    nsExec::Exec 'cmd /c tasklist /FI "IMAGENAME eq ${EXE}" /NH | find /I "${EXE}"'
    Pop $0
    StrCmp $0 "0" 0 closed_${ID}
    IntOp $R9 $R9 + 1
    IntCmp $R9 40 0 0 kill_${ID}
    Sleep 500
    Goto wait_${ID}
  kill_${ID}:
    nsExec::Exec 'taskkill /F /T /IM ${EXE}'
    Sleep 1000
  closed_${ID}:
!macroend

Section "FlintNotes"
  !insertmacro CLOSE_APP install
  ; The previous version's files go, so that nothing of it stays mixed with the new one.
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\locales"
  SetOutPath "$INSTDIR"
  File /r "${SOURCE}\*.*"
  WriteUninstaller "$INSTDIR\Удалить FlintNotes.exe"

  CreateShortcut "$SMPROGRAMS\${APP}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0
  ; An update of itself does not bring back a desktop shortcut the user has removed.
  IfSilent +2
    CreateShortcut "$DESKTOP\${APP}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0

  WriteRegStr HKCU "Software\${APP}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${APP}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "${APP}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\${EXE}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Удалить FlintNotes.exe"'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '"$INSTDIR\Удалить FlintNotes.exe" /S'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "EstimatedSize" $0

  ; The app's update of itself starts it again, the way it was (in the tray, or with its window).
  ${GetParameters} $0
  ${GetOptions} $0 "--run" $1
  IfErrors done
    ${GetOptions} $0 "--hidden" $1
    IfErrors 0 +3
      Exec '"$INSTDIR\${EXE}"'
      Goto done
    Exec '"$INSTDIR\${EXE}" --hidden'
  done:
SectionEnd

Section "Uninstall"
  !insertmacro CLOSE_APP uninstall
  Delete "$SMPROGRAMS\${APP}.lnk"
  Delete "$DESKTOP\${APP}.lnk"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  DeleteRegKey HKCU "Software\${APP}"
  ; Its start with Windows (desktop/main.ts writes it under the app's id; the first builds under its name).
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "md.flintnotes.app"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APP}"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "md.flintnotes.app"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "${APP}"
  ; The window's place, the log and the browser data in %APPDATA%\FlintNotes stay, as do the notes.
SectionEnd
