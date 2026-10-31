// The Keystone window: the Keystone web app of the EPC2i server in WebView2 (R-210). No local server and no local
// database (unlike the Mac app of the demo, R-019): the window is a thin client of the server chosen in keystone.json.
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Keystone.Desktop;

internal sealed class MainForm : Form
{
  private const int CmdReload = 0x100, CmdHome = 0x110, CmdBrowser = 0x120, CmdServer = 0x130, CmdAbout = 0x140;

  private readonly AppSettings _settings;
  private readonly WebView2 _web = WebViewSetup.NewWebView();
  private CoreWebView2Environment? _env;
  /// <summary>True while the offline page (not a Keystone page) is shown.</summary>
  private bool _offline;
  /// <summary>The Keystone (or sign-in) address that failed, reopened by « Réessayer ».</summary>
  private string? _failedUri;

  public MainForm(AppSettings settings)
  {
    _settings = settings;
    Text = "Keystone";
    Icon = Program.AppIcon;
    BackColor = WebViewSetup.Ground;
    MinimumSize = new Size(900, 600);
    Controls.Add(_web);
    _web.KeyDown += OnWebKeyDown;
    RestorePlacement();
  }

  // Window ---------------------------------------------------------------------------------------------------------------

  protected override void OnHandleCreated(EventArgs e)
  {
    base.OnHandleCreated(e);
    Native.UseDarkTitleBar(Handle);
    Native.AddSystemMenuItems(Handle,
    [
      (CmdReload, "Recharger\tF5"),
      (CmdHome, "Accueil de Keystone\tAlt+Origine"),
      (CmdBrowser, "Ouvrir cette page dans le navigateur\tCtrl+Maj+O"),
      (0, ""),
      (CmdServer, "Changer l’adresse du serveur…\tCtrl+Maj+L"),
      (CmdAbout, "À propos de Keystone"),
    ]);
  }

  protected override void WndProc(ref Message m)
  {
    if (m.Msg == Native.WM_SYSCOMMAND && Run((int)(m.WParam.ToInt64() & 0xFFF0))) return;
    base.WndProc(ref m);
  }

  /// <summary>Shortcuts while the window itself has the focus (before the page is shown).</summary>
  protected override bool ProcessCmdKey(ref Message msg, Keys keyData) => Shortcut(keyData) || base.ProcessCmdKey(ref msg, keyData);

  /// <summary>
  /// Shortcuts while the page has the focus: the WebView2 control raises KeyDown for the accelerator keys the page does
  /// not consume (keys with Ctrl or Alt, function keys); Handled stops the browser's own action (its F5).
  /// </summary>
  private void OnWebKeyDown(object? sender, KeyEventArgs e)
  {
    if (Shortcut(e.KeyData)) e.Handled = true;
  }

  private bool Shortcut(Keys keyData) =>
    keyData switch
    {
      Keys.F5 => Run(CmdReload),
      Keys.Alt | Keys.Home => Run(CmdHome),
      Keys.Control | Keys.Shift | Keys.O => Run(CmdBrowser),
      Keys.Control | Keys.Shift | Keys.L => Run(CmdServer),
      _ => false,
    };

  private bool Run(int command)
  {
    switch (command)
    {
      case CmdReload:
        if (_offline) Retry();
        else _web.CoreWebView2?.Reload();
        return true;
      case CmdHome:
        GoHome();
        return true;
      case CmdBrowser:
        var current = _web.CoreWebView2?.Source;
        Native.OpenWithShell(!_offline && current is not null && WebViewSetup.Classify(current, _settings) == LinkKind.Keystone ? current : _settings.ServerUrl!.ToString());
        return true;
      case CmdServer:
        ChangeServer();
        return true;
      case CmdAbout:
        About();
        return true;
      default:
        return false;
    }
  }

  // WebView2 -------------------------------------------------------------------------------------------------------------

  protected override async void OnShown(EventArgs e)
  {
    base.OnShown(e);
    try
    {
      Directory.CreateDirectory(AppSettings.WebViewDataDir);
      // The profile lives in %LOCALAPPDATA%\Keystone\WebView2 (not next to the exe): the session cookie survives a restart
      // and an update of Keystone.exe. Windows single sign-on: a PC signed in with an EPC2i work account may skip the
      // Microsoft password page.
      _env = await CoreWebView2Environment.CreateAsync(null, AppSettings.WebViewDataDir,
        new CoreWebView2EnvironmentOptions { AllowSingleSignOnUsingOSPrimaryAccount = true });
      await _web.EnsureCoreWebView2Async(_env);
    }
    catch (WebView2RuntimeNotFoundException)
    {
      Program.ShowRuntimeMissing(this);
      Close();
      return;
    }
    catch (Exception ex)
    {
      MessageBox.Show(this, $"Keystone ne peut pas démarrer son affichage (Microsoft Edge WebView2).\n\n{ex.Message}\n\nDossier : {AppSettings.WebViewDataDir}",
        "Keystone", MessageBoxButtons.OK, MessageBoxIcon.Error);
      Close();
      return;
    }

    var core = _web.CoreWebView2;
    WebViewSetup.Configure(core, this, _settings, _env);
    core.NavigationStarting += (_, args) =>
    {
      if (WebViewSetup.Classify(args.Uri, _settings) is LinkKind.Keystone or LinkKind.SignIn) _offline = false;
    };
    core.NavigationCompleted += OnNavigationCompleted;
    core.WebMessageReceived += OnWebMessage;
    GoHome();
  }

  private void GoHome() => Open(_settings.ServerUrl!.ToString());

  private void Open(string uri)
  {
    _offline = false;
    _web.CoreWebView2?.Navigate(uri);
  }

  private void OnNavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs e)
  {
    if (e.IsSuccess && e.HttpStatusCode is not (502 or 503 or 504)) return;
    var source = _web.CoreWebView2.Source;
    var detail = e.WebErrorStatus switch
    {
      // A newer navigation replaced this one, or the response became a download: nothing failed.
      CoreWebView2WebErrorStatus.OperationCanceled => null,
      CoreWebView2WebErrorStatus.HostNameNotResolved =>
        "L’adresse du serveur est introuvable. Vérifiez votre connexion (réseau d’EPC2i ou VPN) et l’adresse du serveur.",
      CoreWebView2WebErrorStatus.CannotConnect or CoreWebView2WebErrorStatus.ServerUnreachable
        or CoreWebView2WebErrorStatus.Timeout or CoreWebView2WebErrorStatus.Disconnected
        or CoreWebView2WebErrorStatus.ConnectionAborted or CoreWebView2WebErrorStatus.ConnectionReset =>
        "Le serveur ne répond pas. Vérifiez votre connexion à Internet ou au réseau d’EPC2i, puis réessayez.",
      CoreWebView2WebErrorStatus.CertificateCommonNameIsIncorrect or CoreWebView2WebErrorStatus.CertificateExpired
        or CoreWebView2WebErrorStatus.ClientCertificateContainsErrors or CoreWebView2WebErrorStatus.CertificateRevoked
        or CoreWebView2WebErrorStatus.CertificateIsInvalid =>
        "Le certificat de sécurité du serveur n’est pas valide : la connexion a été refusée pour vous protéger. Prévenez votre service informatique.",
      CoreWebView2WebErrorStatus.ErrorHttpInvalidServerResponse or CoreWebView2WebErrorStatus.RedirectFailed
        or CoreWebView2WebErrorStatus.UnexpectedError =>
        "Le serveur a renvoyé une réponse inattendue. Réessayez dans un instant.",
      _ when e.HttpStatusCode is 502 or 503 or 504 =>
        "Le serveur Keystone est momentanément indisponible (mise à jour ou maintenance). Réessayez dans un instant.",
      // Other HTTP errors (404…) are Keystone's own pages: they stay on screen.
      _ => null,
    };
    if (detail is null) return;
    _failedUri = source;
    _offline = true;
    _web.CoreWebView2.NavigateToString(StatusPages.Offline("Keystone est injoignable", detail, _settings.ServerUrl!, !_settings.Locked));
  }

  private void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
  {
    // Only the offline page may ask: never a Keystone page or any other site.
    if (!_offline || !(e.Source.StartsWith("about:", StringComparison.Ordinal) || e.Source.StartsWith("data:", StringComparison.Ordinal))) return;
    string? message;
    try { message = e.TryGetWebMessageAsString(); } catch { return; }
    if (message == "retry") Retry();
    else if (message == "settings") ChangeServer();
  }

  private void Retry()
  {
    var target = _failedUri is not null && WebViewSetup.Classify(_failedUri, _settings) is LinkKind.Keystone or LinkKind.SignIn
      ? _failedUri
      : _settings.ServerUrl!.ToString();
    Open(target);
  }

  // Menu actions -----------------------------------------------------------------------------------------------------------

  private void ChangeServer()
  {
    if (_settings.Locked)
    {
      MessageBox.Show(this,
        $"L’adresse du serveur est fixée par votre service informatique (fichier keystone.json placé à côté de Keystone.exe) :\n\n{_settings.ServerUrl}",
        "Adresse du serveur Keystone", MessageBoxButtons.OK, MessageBoxIcon.Information);
      return;
    }
    using var dialog = new ServerDialog(_settings.ServerUrl, firstLaunch: false);
    if (dialog.ShowDialog(this) != DialogResult.OK || dialog.Result is null) return;
    var error = _settings.ChooseServerUrl(dialog.Result);
    if (error is not null)
      MessageBox.Show(this, $"L’adresse sera utilisée jusqu’à la fermeture de Keystone, mais n’a pas pu être enregistrée.\n\n{error}",
        "Keystone", MessageBoxButtons.OK, MessageBoxIcon.Warning);
    _failedUri = null;
    GoHome();
  }

  private void About()
  {
    var version = Application.ProductVersion.Split('+')[0];
    var webView = _env?.BrowserVersionString ?? "—";
    MessageBox.Show(this,
      $"Keystone {version}\nApplication Windows de Keystone, la gestion de projets d’EPC2i.\n\n" +
      $"Serveur : {_settings.ServerUrl}{(_settings.Locked ? " (fixé par le service informatique)" : "")}\n" +
      $"Microsoft Edge WebView2 : {webView}\n" +
      $"Données de navigation : {AppSettings.WebViewDataDir}",
      "À propos de Keystone", MessageBoxButtons.OK, MessageBoxIcon.Information);
  }

  // Placement --------------------------------------------------------------------------------------------------------------

  private void RestorePlacement()
  {
    var saved = AppSettings.LoadWindow();
    if (saved is not null && saved.Width >= MinimumSize.Width && saved.Height >= MinimumSize.Height)
    {
      var bounds = new Rectangle(saved.X, saved.Y, saved.Width, saved.Height);
      // The title bar must land on a screen that is still there (a second monitor may have been unplugged).
      var titleBar = new Rectangle(bounds.X + 40, bounds.Y, Math.Max(bounds.Width - 80, 40), 32);
      if (Screen.AllScreens.Any(s => s.WorkingArea.IntersectsWith(titleBar)))
      {
        StartPosition = FormStartPosition.Manual;
        Bounds = bounds;
        if (saved.Maximized) WindowState = FormWindowState.Maximized;
        return;
      }
    }
    var area = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 1440, 900);
    Size = new Size(Math.Min(1440, area.Width * 9 / 10), Math.Min(900, area.Height * 9 / 10));
    StartPosition = FormStartPosition.CenterScreen;
  }

  protected override void OnFormClosing(FormClosingEventArgs e)
  {
    var normal = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
    AppSettings.SaveWindow(new AppSettings.WindowPlacement(normal.X, normal.Y, normal.Width, normal.Height, WindowState == FormWindowState.Maximized));
    base.OnFormClosing(e);
  }
}
