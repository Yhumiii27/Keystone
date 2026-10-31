// Behaviour shared by the main window and the extra windows a Keystone page opens (target=_blank on a Keystone page):
// which navigations stay in the window, links handed to the default browser, downloads through a save dialog.
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Keystone.Desktop;

internal static class WebViewSetup
{
  /// <summary>Nocturne's page ground (#161826): no white flash before a page paints.</summary>
  public static readonly Color Ground = Color.FromArgb(0x16, 0x18, 0x26);

  public static WebView2 NewWebView() => new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Ground };

  public static void Configure(CoreWebView2 core, Form owner, AppSettings settings, CoreWebView2Environment env)
  {
    var s = core.Settings;
    s.AreDevToolsEnabled = false;
    s.AreHostObjectsAllowed = false;
    s.IsPasswordAutosaveEnabled = false;
    s.IsWebMessageEnabled = true; // only the application's own offline page uses it (MainForm checks where a message comes from)
    s.AreDefaultContextMenusEnabled = true; // copy, paste, spelling

    core.NavigationStarting += (_, e) =>
    {
      switch (Classify(e.Uri, settings))
      {
        case LinkKind.Keystone:
        case LinkKind.SignIn:
        case LinkKind.Local:
          return;
        case LinkKind.External:
          e.Cancel = true;
          Native.OpenWithShell(e.Uri);
          return;
        default:
          e.Cancel = true;
          return;
      }
    };

    core.NewWindowRequested += async (_, e) =>
    {
      e.Handled = true;
      switch (Classify(e.Uri, settings))
      {
        case LinkKind.Keystone:
        case LinkKind.SignIn:
          // A Keystone page opened in a new tab (a photo, a file shown inline…): a second Keystone window with the same
          // session, rather than the browser, where the user may not be signed in.
          var deferral = e.GetDeferral();
          try
          {
            var popup = new PopupForm(settings, env);
            popup.Show(owner);
            var popupCore = await popup.InitAsync();
            if (popupCore is not null) e.NewWindow = popupCore;
          }
          finally
          {
            deferral.Complete();
          }
          return;
        case LinkKind.External:
          Native.OpenWithShell(e.Uri);
          return;
        default:
          return;
      }
    };

    core.DownloadStarting += (_, e) =>
    {
      var deferral = e.GetDeferral();
      owner.BeginInvoke(() =>
      {
        try
        {
          var name = Path.GetFileName(e.ResultFilePath);
          var ext = Path.GetExtension(name);
          using var dialog = new SaveFileDialog
          {
            Title = "Enregistrer le fichier",
            InitialDirectory = Native.DownloadsFolder(),
            FileName = name,
            OverwritePrompt = true,
            Filter = ext.Length > 1
              ? $"Fichier {ext[1..].ToUpperInvariant()} (*{ext})|*{ext}|Tous les fichiers (*.*)|*.*"
              : "Tous les fichiers (*.*)|*.*",
          };
          if (dialog.ShowDialog(owner) == DialogResult.OK) e.ResultFilePath = dialog.FileName;
          else e.Cancel = true;
        }
        catch (Exception ex)
        {
          e.Cancel = true;
          MessageBox.Show(owner, $"Le téléchargement a échoué.\n\n{ex.Message}", "Keystone", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
        finally
        {
          deferral.Complete();
        }
      });
    };
  }

  public static LinkKind Classify(string uri, AppSettings settings) =>
    settings.ServerUrl is null ? LinkKind.Blocked : NavigationRules.Classify(uri, settings.ServerUrl, settings.SignInHosts);
}

/// <summary>An extra window for a Keystone page opened in a new tab; same session, same rules.</summary>
internal sealed class PopupForm : Form
{
  private readonly WebView2 _web = WebViewSetup.NewWebView();
  private readonly AppSettings _settings;
  private readonly CoreWebView2Environment _env;

  public PopupForm(AppSettings settings, CoreWebView2Environment env)
  {
    _settings = settings;
    _env = env;
    Text = "Keystone";
    Icon = Program.AppIcon;
    BackColor = WebViewSetup.Ground;
    Size = new Size(1100, 800);
    MinimumSize = new Size(480, 360);
    StartPosition = FormStartPosition.CenterParent;
    Controls.Add(_web);
  }

  protected override void OnHandleCreated(EventArgs e)
  {
    base.OnHandleCreated(e);
    Native.UseDarkTitleBar(Handle);
  }

  public async Task<CoreWebView2?> InitAsync()
  {
    try
    {
      await _web.EnsureCoreWebView2Async(_env);
    }
    catch (Exception ex)
    {
      MessageBox.Show(this, $"Impossible d’ouvrir la fenêtre.\n\n{ex.Message}", "Keystone", MessageBoxButtons.OK, MessageBoxIcon.Warning);
      Close();
      return null;
    }
    var core = _web.CoreWebView2;
    WebViewSetup.Configure(core, this, _settings, _env);
    core.DocumentTitleChanged += (_, _) => Text = string.IsNullOrWhiteSpace(core.DocumentTitle) ? "Keystone" : $"{core.DocumentTitle} — Keystone";
    core.WindowCloseRequested += (_, _) => Close();
    return core;
  }
}
