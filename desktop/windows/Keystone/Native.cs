// The few Windows API calls the application needs: dark title bar, entries in the window (system) menu, the user's
// Downloads folder, and opening a link with the default program.
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace Keystone.Desktop;

internal static partial class Native
{
  public const int WM_SYSCOMMAND = 0x0112;
  private const uint MF_STRING = 0x0000, MF_SEPARATOR = 0x0800;
  private const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;

  [LibraryImport("user32.dll")]
  private static partial IntPtr GetSystemMenu(IntPtr hWnd, [MarshalAs(UnmanagedType.Bool)] bool bRevert);

  [LibraryImport("user32.dll", EntryPoint = "AppendMenuW", StringMarshalling = StringMarshalling.Utf16)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static partial bool AppendMenu(IntPtr hMenu, uint uFlags, UIntPtr uIDNewItem, string? lpNewItem);

  [LibraryImport("dwmapi.dll")]
  private static partial int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

  [LibraryImport("shell32.dll")]
  private static partial int SHGetKnownFolderPath(in Guid rfid, uint dwFlags, IntPtr hToken, out IntPtr ppszPath);

  private static readonly Guid FolderDownloads = new("374DE290-123F-4565-9164-39C4925E467B");

  /// <summary>Dark title bar to match the Nocturne pages (Windows 10 20H1 and later; ignored elsewhere).</summary>
  public static void UseDarkTitleBar(IntPtr hwnd)
  {
    var on = 1;
    try { _ = DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, ref on, sizeof(int)); } catch { /* older Windows */ }
  }

  /// <summary>Adds entries to the window menu (Alt+Espace, or a right click on the title bar). Ids are multiples of 16 below 0xF000.</summary>
  public static void AddSystemMenuItems(IntPtr hwnd, IEnumerable<(int Id, string Text)> items)
  {
    var menu = GetSystemMenu(hwnd, false);
    if (menu == IntPtr.Zero) return;
    AppendMenu(menu, MF_SEPARATOR, UIntPtr.Zero, null);
    foreach (var (id, text) in items)
    {
      if (id == 0) AppendMenu(menu, MF_SEPARATOR, UIntPtr.Zero, null);
      else AppendMenu(menu, MF_STRING, (UIntPtr)id, text);
    }
  }

  /// <summary>The user's Downloads folder (it can be moved, so it is asked to Windows).</summary>
  public static string DownloadsFolder()
  {
    try
    {
      if (SHGetKnownFolderPath(FolderDownloads, 0, IntPtr.Zero, out var p) == 0)
      {
        try { return Marshal.PtrToStringUni(p) ?? Fallback(); }
        finally { Marshal.FreeCoTaskMem(p); }
      }
    }
    catch { /* fall back below */ }
    return Fallback();
    static string Fallback() => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
  }

  /// <summary>Hands a web address, an e-mail address or a telephone number to Windows (default browser, mail app…).</summary>
  public static void OpenWithShell(string target)
  {
    try { Process.Start(new ProcessStartInfo(target) { UseShellExecute = true }); }
    catch (Exception e)
    {
      MessageBox.Show($"Impossible d’ouvrir :\n{target}\n\n{e.Message}", "Keystone", MessageBoxButtons.OK, MessageBoxIcon.Warning);
    }
  }
}
