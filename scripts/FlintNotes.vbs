' FlintNotes: запускает сервер заметок в фоне, без окон. Заметки открываются в браузере
' по адресу http://localhost:4600 (порт меняется в настройках приложения).
' Другая папка с заметками: перетащите её на этот файл, или в самом приложении:
' меню внизу слева, «Управление хранилищами».
' Этот файл собирается командой npm run release из scripts/FlintNotes.vbs.
Option Explicit

Dim shell, fso, dir, port, args, i, waited
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = dir

If Not fso.FileExists(dir & "\release\launcher.mjs") Then
  MsgBox "Нет готовой сборки в папке release." & vbLf & "Соберите её командой:  npm run release", vbExclamation, "FlintNotes"
  WScript.Quit 1
End If

If shell.Run("where.exe /q node", 0, True) <> 0 Then
  MsgBox "Не найден Node.js. Установите версию 20.19 или новее с https://nodejs.org и запустите FlintNotes снова.", vbExclamation, "FlintNotes"
  WScript.Quit 1
End If

port = ChosenPort()
' Уже работает (запущен вместе с компьютером или раньше): делать нечего.
If Answers() Then WScript.Quit 0

args = ""
For i = 0 To WScript.Arguments.Count - 1
  args = args & " """ & WScript.Arguments(i) & """"
Next
' 0: без окна; False: не ждать, сервер работает дальше сам.
shell.Run "node.exe ""release\launcher.mjs""" & args, 0, False

' Первый запуск бывает долгим (антивирус проверяет новые файлы); о неудаче нужно сказать, окна ведь нет.
For waited = 1 To 60
  WScript.Sleep 500
  If Answers() Then WScript.Quit 0
Next
MsgBox "FlintNotes не запустился за 30 секунд." & vbLf & "Подробности в файле " & dir & "\release\flintnotes.log", vbExclamation, "FlintNotes"
WScript.Quit 1

' Порт: переменная FLINT_PORT, иначе выбранный в настройках (он хранится в .flintnotes.json), иначе 4600.
Function ChosenPort()
  Dim value, file, re, found
  ChosenPort = "4600"
  value = shell.ExpandEnvironmentStrings("%FLINT_PORT%")
  If value <> "%FLINT_PORT%" Then
    ChosenPort = value
    Exit Function
  End If
  file = shell.ExpandEnvironmentStrings("%FLINT_CONFIG%")
  If file = "%FLINT_CONFIG%" Then file = shell.ExpandEnvironmentStrings("%USERPROFILE%") & "\.flintnotes.json"
  If Not fso.FileExists(file) Then Exit Function
  Set re = New RegExp
  re.Pattern = """port""\s*:\s*(\d+)"
  Set found = re.Execute(fso.OpenTextFile(file, 1).ReadAll())
  If found.Count > 0 Then ChosenPort = found(0).SubMatches(0)
End Function

' Отвечает ли FlintNotes на этом порту.
Function Answers()
  Dim http
  Answers = False
  On Error Resume Next
  Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  http.setTimeouts 1000, 1000, 1000, 1000
  http.open "GET", "http://127.0.0.1:" & port & "/api/port", False
  http.send
  If Err.Number = 0 Then Answers = (http.status = 200)
  On Error GoTo 0
End Function
