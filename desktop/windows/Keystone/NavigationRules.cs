// Pure rules of the Windows application (R-210): which server addresses are accepted, where a link opens, and how the
// keystone.json file is read. No Windows Forms and no WebView2 here, so the tests (Keystone.Desktop.Tests) run on any OS.
using System.Text.Json;

namespace Keystone.Desktop;

/// <summary>Where a navigation goes.</summary>
public enum LinkKind
{
  /// <summary>A page of the configured Keystone server: stays in the window.</summary>
  Keystone,
  /// <summary>The Microsoft Entra sign-in pages (R-038): stay in the window so the session cookie lands in it.</summary>
  SignIn,
  /// <summary>The application's own pages (offline page, about:blank, blob: of a Keystone page): stay in the window.</summary>
  Local,
  /// <summary>Another web site, an e-mail address or a telephone number: handed to Windows (default browser, mail app).</summary>
  External,
  /// <summary>Anything else (file:, edge:, unknown protocols): refused.</summary>
  Blocked,
}

public static class NavigationRules
{
  /// <summary>
  /// Hosts of the Microsoft sign-in journey: the Entra login pages, the account picker, seamless single sign-on and the
  /// multi-factor registration pages a first sign-in can go through before coming back to Keystone.
  /// </summary>
  public static readonly IReadOnlyList<string> DefaultSignInHosts =
  [
    "login.microsoftonline.com",
    "login.microsoft.com",
    "login.windows.net",
    "login.live.com",
    "device.login.microsoftonline.com",
    "autologon.microsoftazuread-sso.com",
    "mysignins.microsoft.com",
    "account.activedirectory.windowsazure.com",
  ];

  /// <summary>http:// is accepted for these hosts only (a Keystone started on the same PC, for tests).</summary>
  public static bool IsLoopback(string host) =>
    host.Equals("localhost", StringComparison.OrdinalIgnoreCase) || host == "127.0.0.1" || host == "[::1]" || host == "::1";

  /// <summary>
  /// Checks and normalises the address typed by the user or read from keystone.json: https only (http for localhost /
  /// 127.0.0.1), no user name or password, no query or fragment; the scheme defaults to https; the path ends with "/".
  /// Returns null and a French message when the address is refused.
  /// </summary>
  public static Uri? NormalizeServerUrl(string? input, out string error)
  {
    error = "";
    var text = (input ?? "").Trim();
    if (text.Length == 0)
    {
      error = "Indiquez l’adresse du serveur Keystone.";
      return null;
    }
    if (!text.Contains("://", StringComparison.Ordinal)) text = "https://" + text;
    if (!Uri.TryCreate(text, UriKind.Absolute, out var uri) || string.IsNullOrEmpty(uri.Host) || text.Any(char.IsWhiteSpace))
    {
      error = "Cette adresse n’est pas valide. Exemple : https://keystone.exemple.fr";
      return null;
    }
    var scheme = uri.Scheme.ToLowerInvariant();
    if (scheme == "http" && !IsLoopback(uri.Host))
    {
      error = "L’adresse doit commencer par https:// (connexion chiffrée). http:// n’est accepté que pour localhost ou 127.0.0.1.";
      return null;
    }
    if (scheme != "https" && scheme != "http")
    {
      error = "L’adresse doit commencer par https://.";
      return null;
    }
    if (!string.IsNullOrEmpty(uri.UserInfo))
    {
      error = "L’adresse ne doit contenir ni nom d’utilisateur ni mot de passe.";
      return null;
    }
    var path = uri.AbsolutePath.EndsWith('/') ? uri.AbsolutePath : uri.AbsolutePath + "/";
    var builder = new UriBuilder(uri.Scheme, uri.Host, uri.Port, path);
    return builder.Uri;
  }

  /// <summary>Same scheme, host and port: the origin of the Keystone server.</summary>
  public static bool SameOrigin(Uri a, Uri b) =>
    Uri.Compare(a, b, UriComponents.SchemeAndServer, UriFormat.SafeUnescaped, StringComparison.OrdinalIgnoreCase) == 0;

  /// <summary>Whether <paramref name="host"/> is one of <paramref name="hosts"/> ("*.example.fr" matches its sub-domains).</summary>
  public static bool HostMatches(string host, IEnumerable<string> hosts) =>
    hosts.Any(h =>
      h.StartsWith("*.", StringComparison.Ordinal)
        ? host.EndsWith(h[1..], StringComparison.OrdinalIgnoreCase)
        : host.Equals(h, StringComparison.OrdinalIgnoreCase));

  /// <summary>Where a top-level navigation (or a new window) to <paramref name="target"/> goes.</summary>
  public static LinkKind Classify(string target, Uri server, IEnumerable<string> extraSignInHosts)
  {
    if (!Uri.TryCreate(target, UriKind.Absolute, out var uri)) return LinkKind.Blocked;
    switch (uri.Scheme.ToLowerInvariant())
    {
      case "about":
      case "data":
        return LinkKind.Local;
      case "blob":
        // blob:https://host/uuid — a file a Keystone page built (exports) stays with that page.
        return Uri.TryCreate(uri.AbsolutePath, UriKind.Absolute, out var inner) && SameOrigin(inner, server) ? LinkKind.Local : LinkKind.Blocked;
      case "mailto":
      case "tel":
        return LinkKind.External;
      case "http":
      case "https":
        if (SameOrigin(uri, server)) return LinkKind.Keystone;
        if (uri.Scheme == "https" && HostMatches(uri.Host, DefaultSignInHosts.Concat(extraSignInHosts))) return LinkKind.SignIn;
        return LinkKind.External;
      default:
        return LinkKind.Blocked;
    }
  }
}

/// <summary>The content of a keystone.json file.</summary>
public sealed record AppSettingsFile(string? ServerUrl, IReadOnlyList<string> SignInHosts);

public static class SettingsFileFormat
{
  private static readonly JsonDocumentOptions Options = new() { AllowTrailingCommas = true, CommentHandling = JsonCommentHandling.Skip };

  /// <summary>
  /// Reads keystone.json: <c>{"serverUrl": "https://…", "signInHosts": ["adfs.example.fr"]}</c> (property names are
  /// case-insensitive; comments and trailing commas are tolerated). Returns null and a French message when unreadable.
  /// </summary>
  public static AppSettingsFile? Parse(string json, out string error)
  {
    error = "";
    try
    {
      using var doc = JsonDocument.Parse(json, Options);
      if (doc.RootElement.ValueKind != JsonValueKind.Object)
      {
        error = "le fichier doit contenir un objet JSON, par exemple {\"serverUrl\": \"https://keystone.exemple.fr\"}.";
        return null;
      }
      string? server = null;
      var hosts = new List<string>();
      foreach (var p in doc.RootElement.EnumerateObject())
      {
        if (p.Name.Equals("serverUrl", StringComparison.OrdinalIgnoreCase) && p.Value.ValueKind == JsonValueKind.String) server = p.Value.GetString();
        if (p.Name.Equals("signInHosts", StringComparison.OrdinalIgnoreCase) && p.Value.ValueKind == JsonValueKind.Array)
          hosts.AddRange(p.Value.EnumerateArray().Where(v => v.ValueKind == JsonValueKind.String).Select(v => v.GetString()!.Trim()).Where(h => h.Length > 0));
      }
      return new AppSettingsFile(server, hosts);
    }
    catch (JsonException e)
    {
      error = $"JSON illisible ({e.Message}).";
      return null;
    }
  }

  /// <summary>The file written by the application when the user chooses the address (other settings are kept).</summary>
  public static string Serialize(AppSettingsFile settings)
  {
    using var stream = new MemoryStream();
    using (var w = new Utf8JsonWriter(stream, new JsonWriterOptions { Indented = true }))
    {
      w.WriteStartObject();
      w.WriteString("serverUrl", settings.ServerUrl);
      if (settings.SignInHosts.Count > 0)
      {
        w.WriteStartArray("signInHosts");
        foreach (var h in settings.SignInHosts) w.WriteStringValue(h);
        w.WriteEndArray();
      }
      w.WriteEndObject();
    }
    return System.Text.Encoding.UTF8.GetString(stream.ToArray()) + Environment.NewLine;
  }
}
