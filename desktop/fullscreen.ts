import { execFile, spawn } from 'node:child_process'
import path from 'node:path'

// Windows' notification state covers exclusive games and presentations. The foreground
// window's bounds also cover borderless games, video players and browsers (F11).
const WINDOWS = `
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class FlintFullscreen {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct Monitor { public int Size; public Rect Bounds, Work; public uint Flags; }
  [DllImport("shell32.dll")] static extern int SHQueryUserNotificationState(out int state);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern IntPtr GetShellWindow();
  [DllImport("user32.dll", CharSet = CharSet.Auto)] static extern int GetClassName(IntPtr window, StringBuilder name, int size);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr monitor, ref Monitor info);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr window, int index);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out Rect bounds, int size);
  public static bool Active() {
    int state;
    if (SHQueryUserNotificationState(out state) != 0) return true;
    if (state == 1 || state == 2 || state == 3 || state == 4) return true;
    var window = GetForegroundWindow();
    if (window == IntPtr.Zero || window == GetShellWindow()) return false;
    var name = new StringBuilder(256); GetClassName(window, name, name.Capacity);
    if (name.ToString() == "WorkerW" || name.ToString() == "Progman") return false;
    // A maximised ordinary window with an auto-hidden taskbar is not fullscreen.
    if ((GetWindowLong(window, -16) & 0x00c00000) != 0) return false;
    Rect bounds;
    var monitor = new Monitor(); monitor.Size = Marshal.SizeOf(monitor);
    if (DwmGetWindowAttribute(window, 9, out bounds, Marshal.SizeOf(typeof(Rect))) != 0 ||
        !GetMonitorInfo(MonitorFromWindow(window, 2), ref monitor)) return true;
    return Math.Abs(bounds.Left - monitor.Bounds.Left) <= 1 && Math.Abs(bounds.Top - monitor.Bounds.Top) <= 1 &&
           Math.Abs(bounds.Right - monitor.Bounds.Right) <= 1 && Math.Abs(bounds.Bottom - monitor.Bounds.Bottom) <= 1;
  }
}
'@
while ($true) {
  if ([FlintFullscreen]::Active()) { [Console]::WriteLine('1') } else { [Console]::WriteLine('0') }
  Start-Sleep -Milliseconds 500
}
`

/** Watches only while reminders are outstanding. Unknown state holds automatic popups back. */
export function watchFullscreen(changed: (blocked: boolean) => void, failed: (message: string) => void): () => void {
  if (process.platform === 'win32') {
    const executable = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(WINDOWS, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let buffer = ''
    let stopped = false
    let errors = ''
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop()!
      for (const line of lines) if (!stopped && (line === '0' || line === '1')) changed(line === '1')
    })
    child.stderr.on('data', (chunk: Buffer) => (errors = (errors + chunk.toString()).slice(-2000)))
    child.on('error', (error) => {
      if (!stopped) { changed(true); failed(error.message) }
    })
    child.on('exit', () => {
      if (!stopped) { changed(true); failed(errors || 'Проверка полноэкранного режима остановилась') }
    })
    return () => { stopped = true; child.kill() }
  }

  // X11 exposes fullscreen as a window state. On Wayland/macOS, without an accessible
  // foreground-window API, do not risk raising the app over a fullscreen application.
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const query = (args: string[]) => new Promise<string>((resolve, reject) => {
    execFile('xprop', args, { timeout: 2000, maxBuffer: 64 * 1024 }, (error, stdout) => error ? reject(error) : resolve(stdout))
  })
  const check = async () => {
    let blocked = true
    try {
      if (process.platform === 'linux' && !process.env.WAYLAND_DISPLAY) {
        const active = await query(['-root', '_NET_ACTIVE_WINDOW'])
        const id = /0x[\da-f]+/i.exec(active)?.[0]
        blocked = !id || (id !== '0x0' && (await query(['-id', id, '_NET_WM_STATE'])).includes('_NET_WM_STATE_FULLSCREEN'))
      }
    } catch { /* No window-manager information: leave automatic popups held back. */ }
    if (stopped) return
    changed(blocked)
    timer = setTimeout(() => void check(), 1000)
  }
  void check()
  return () => { stopped = true; clearTimeout(timer) }
}
