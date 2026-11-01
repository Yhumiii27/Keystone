// "Adresse du serveur Keystone": asked at the first launch (no keystone.json) and from the window menu
// (« Changer l'adresse du serveur… », Ctrl+Maj+L). The address is checked by NavigationRules.NormalizeServerUrl.
namespace Keystone.Desktop;

internal sealed class ServerDialog : Form
{
  private readonly TextBox _url = new() { Dock = DockStyle.Fill, Margin = new Padding(0, 6, 0, 0) };
  private readonly Label _error = new() { AutoSize = true, ForeColor = Color.Firebrick, MaximumSize = new Size(460, 0), Margin = new Padding(0, 6, 0, 0) };

  /// <summary>The normalised address, set when the dialog closes with OK.</summary>
  public Uri? Result { get; private set; }

  public ServerDialog(Uri? current, bool firstLaunch)
  {
    Text = "Adresse du serveur Keystone";
    FormBorderStyle = FormBorderStyle.FixedDialog;
    MaximizeBox = MinimizeBox = false;
    ShowInTaskbar = firstLaunch; // at the first launch it is the only window
    StartPosition = firstLaunch ? FormStartPosition.CenterScreen : FormStartPosition.CenterParent;
    AutoSize = true;
    AutoSizeMode = AutoSizeMode.GrowAndShrink;
    AutoScaleMode = AutoScaleMode.Dpi;
    Padding = new Padding(16);
    Icon = Program.AppIcon;

    var intro = new Label
    {
      AutoSize = true,
      MaximumSize = new Size(460, 0),
      Text = (firstLaunch ? "Bienvenue dans Keystone.\n\n" : "") +
        "Indiquez l’adresse du serveur Keystone d’EPC2i, telle que vous l’ouvrez dans votre navigateur " +
        "(par exemple https://keystone.exemple.fr). Votre service informatique peut vous la communiquer.",
    };
    _url.Text = current?.ToString() ?? "https://";
    var ok = new Button { Text = "Enregistrer", AutoSize = true, DialogResult = DialogResult.None };
    var cancel = new Button { Text = firstLaunch ? "Quitter" : "Annuler", AutoSize = true, DialogResult = DialogResult.Cancel };
    ok.Click += (_, _) => Accept();
    AcceptButton = ok;
    CancelButton = cancel;

    var buttons = new FlowLayoutPanel { FlowDirection = FlowDirection.RightToLeft, AutoSize = true, Dock = DockStyle.Fill, Margin = new Padding(0, 12, 0, 0) };
    buttons.Controls.Add(cancel);
    buttons.Controls.Add(ok);

    var layout = new TableLayoutPanel { ColumnCount = 1, AutoSize = true, Dock = DockStyle.Fill, MinimumSize = new Size(460, 0) };
    layout.Controls.Add(intro);
    layout.Controls.Add(new Label { Text = "Adresse du serveur :", AutoSize = true, Margin = new Padding(0, 12, 0, 0) });
    layout.Controls.Add(_url);
    layout.Controls.Add(_error);
    layout.Controls.Add(buttons);
    Controls.Add(layout);

    Shown += (_, _) => { _url.Focus(); _url.SelectAll(); };
  }

  private void Accept()
  {
    var url = NavigationRules.NormalizeServerUrl(_url.Text, out var error);
    if (url is null)
    {
      _error.Text = error;
      _url.Focus();
      return;
    }
    Result = url;
    DialogResult = DialogResult.OK;
  }
}
