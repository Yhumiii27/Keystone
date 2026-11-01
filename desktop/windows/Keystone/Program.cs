// Keystone.exe — the Windows application of Keystone PM (R-210, owner's answer L9-X2 of 31 Oct 2026): the Keystone web
// app of the EPC2i server in a native window (Microsoft Edge WebView2). The web access stays; each user chooses.
// Build: desktop/windows/build.ps1 (or the "Windows app" workflow, run by hand).
using System.Reflection;
using Microsoft.Web.WebView2.Core;

namespace Keystone.Desktop;

internal static class Program
{
  /// <summary>Microsoft's page for the WebView2 runtime (the "Evergreen Bootstrapper" installs it on Windows 10).</summary>
  public const string WebView2DownloadPage = "https://developer.microsoft.com/microsoft-edge/webview2/";

  private static Icon? _icon;

  /// <summary>Keystone.ico, embedded in the exe.</summary>
  public static Icon AppIcon =>
    _icon ??= Assembly.GetExecutingAssembly().GetManifestResourceStream("Keystone.ico") is { } s ? new Icon(s) : SystemIcons.Application;

  [STAThread]
  private static void Main()
  {
    ApplicationConfiguration.Initialize();

    if (!WebView2Installed()) return;

    var settings = AppSettings.Load();
    if (settings.Warnings.Count > 0)
      MessageBox.Show("Un fichier de réglages de Keystone n’a pas pu être utilisé :\n\n" + string.Join("\n\n", settings.Warnings),
        "Keystone", MessageBoxButtons.OK, MessageBoxIcon.Warning);

    if (settings.ServerUrl is null)
    {
      using var dialog = new ServerDialog(null, firstLaunch: true);
      if (dialog.ShowDialog() != DialogResult.OK || dialog.Result is null) return;
      var error = settings.ChooseServerUrl(dialog.Result);
      if (error is not null)
        MessageBox.Show($"L’adresse sera utilisée jusqu’à la fermeture de Keystone, mais n’a pas pu être enregistrée.\n\n{error}",
          "Keystone", MessageBoxButtons.OK, MessageBoxIcon.Warning);
    }

    Application.Run(new MainForm(settings));
  }

  /// <summary>Checks that the Microsoft Edge WebView2 runtime is installed; explains how to get it when it is not.</summary>
  private static bool WebView2Installed()
  {
    try
    {
      if (!string.IsNullOrEmpty(CoreWebView2Environment.GetAvailableBrowserVersionString())) return true;
    }
    catch (WebView2RuntimeNotFoundException)
    {
      // handled below
    }
    catch (Exception e)
    {
      MessageBox.Show($"Keystone ne peut pas vérifier la présence de Microsoft Edge WebView2.\n\n{e.Message}", "Keystone",
        MessageBoxButtons.OK, MessageBoxIcon.Error);
      return false;
    }
    ShowRuntimeMissing(null);
    return false;
  }

  public static void ShowRuntimeMissing(IWin32Window? owner)
  {
    const string text =
      "Keystone a besoin de « Microsoft Edge WebView2 Runtime » pour afficher ses pages. Ce composant gratuit de Microsoft " +
      "est fourni avec Windows 11, mais il manque sur ce poste.\n\n" +
      "Installez-le depuis la page de Microsoft (choisir « Evergreen Bootstrapper ») :\n" + WebView2DownloadPage + "\n\n" +
      "Si vous n’avez pas les droits d’installation, demandez-le à votre service informatique. En attendant, Keystone reste " +
      "accessible depuis votre navigateur, à l’adresse habituelle.\n\n" +
      "Ouvrir la page de téléchargement maintenant ?";
    var answer = owner is null
      ? MessageBox.Show(text, "Keystone — composant manquant", MessageBoxButtons.YesNo, MessageBoxIcon.Warning)
      : MessageBox.Show(owner, text, "Keystone — composant manquant", MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
    if (answer == DialogResult.Yes) Native.OpenWithShell(WebView2DownloadPage);
  }
}
