// Where the application keeps its settings (R-210):
// - keystone.json next to Keystone.exe: placed by IT, it fixes the server address (the menu cannot change it);
// - else %APPDATA%\Keystone\keystone.json: the address chosen by the user (first-launch dialog or the menu);
// - %APPDATA%\Keystone\window.json: the window's size and position;
// - %LOCALAPPDATA%\Keystone\WebView2: the browser profile (cookies, so the Keystone session survives a restart).
using System.Text.Json;

namespace Keystone.Desktop;

public sealed class AppSettings
{
  public static readonly string RoamingDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Keystone");
  public static readonly string LocalDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Keystone");
  public static readonly string UserFile = Path.Combine(RoamingDir, "keystone.json");
  public static readonly string MachineFile = Path.Combine(AppContext.BaseDirectory, "keystone.json");
  public static readonly string WebViewDataDir = Path.Combine(LocalDir, "WebView2");
  private static readonly string WindowFile = Path.Combine(RoamingDir, "window.json");

  /// <summary>The Keystone server (normalised), null until one is chosen.</summary>
  public Uri? ServerUrl { get; private set; }

  /// <summary>Extra sign-in hosts (an AD FS federation server, for instance) from keystone.json.</summary>
  public IReadOnlyList<string> SignInHosts { get; private set; } = [];

  /// <summary>True when the address comes from the keystone.json next to the exe (set by IT).</summary>
  public bool Locked { get; private set; }

  /// <summary>Problems met while reading the files, shown once to the user.</summary>
  public List<string> Warnings { get; } = [];

  public static AppSettings Load()
  {
    var s = new AppSettings();
    if (s.TryFile(MachineFile, locked: true)) return s;
    s.TryFile(UserFile, locked: false);
    return s;
  }

  private bool TryFile(string path, bool locked)
  {
    if (!File.Exists(path)) return false;
    string text;
    try { text = File.ReadAllText(path); }
    catch (Exception e) { Warnings.Add($"{path} : lecture impossible ({e.Message})."); return false; }
    var file = SettingsFileFormat.Parse(text, out var error);
    if (file is null) { Warnings.Add($"{path} : {error}"); return false; }
    var url = NavigationRules.NormalizeServerUrl(file.ServerUrl, out error);
    SignInHosts = file.SignInHosts;
    if (url is null)
    {
      if (file.ServerUrl is not null || locked) Warnings.Add($"{path} : {error}");
      return false;
    }
    ServerUrl = url;
    Locked = locked;
    return true;
  }

  /// <summary>
  /// Uses the address chosen by the user and saves it in %APPDATA%\Keystone\keystone.json (the sign-in hosts read from
  /// the file are kept). Returns null, or the reason it could not be saved (the address is then used until Keystone closes).
  /// </summary>
  public string? ChooseServerUrl(Uri url)
  {
    ServerUrl = url;
    Locked = false;
    try
    {
      Directory.CreateDirectory(RoamingDir);
      File.WriteAllText(UserFile, SettingsFileFormat.Serialize(new AppSettingsFile(url.ToString(), SignInHosts)));
      return null;
    }
    catch (Exception e)
    {
      return $"{UserFile} : {e.Message}";
    }
  }

  // Window placement ---------------------------------------------------------------------------------------------------

  public sealed record WindowPlacement(int X, int Y, int Width, int Height, bool Maximized);

  public static WindowPlacement? LoadWindow()
  {
    try
    {
      if (!File.Exists(WindowFile)) return null;
      return JsonSerializer.Deserialize(File.ReadAllText(WindowFile), PlacementJson.Default.WindowPlacement);
    }
    catch { return null; } // a damaged file only costs the default placement
  }

  public static void SaveWindow(WindowPlacement placement)
  {
    try
    {
      Directory.CreateDirectory(RoamingDir);
      File.WriteAllText(WindowFile, JsonSerializer.Serialize(placement, PlacementJson.Default.WindowPlacement));
    }
    catch { /* not worth an error message on exit */ }
  }
}

[System.Text.Json.Serialization.JsonSerializable(typeof(AppSettings.WindowPlacement))]
internal sealed partial class PlacementJson : System.Text.Json.Serialization.JsonSerializerContext;
