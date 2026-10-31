using Keystone.Desktop;
using Xunit;

namespace Keystone.Tests;

public class ServerUrlTests
{
  [Theory]
  [InlineData("https://keystone.exemple.fr", "https://keystone.exemple.fr/")]
  [InlineData("  https://keystone.exemple.fr/  ", "https://keystone.exemple.fr/")]
  [InlineData("keystone.exemple.fr", "https://keystone.exemple.fr/")]
  [InlineData("HTTPS://Keystone.Exemple.FR:8443/pm", "https://keystone.exemple.fr:8443/pm/")]
  [InlineData("https://keystone.exemple.fr/projects?x=1#top", "https://keystone.exemple.fr/projects/")]
  [InlineData("http://localhost:3000", "http://localhost:3000/")]
  [InlineData("http://127.0.0.1:3000/", "http://127.0.0.1:3000/")]
  public void Accepts_and_normalises(string input, string expected)
  {
    var url = NavigationRules.NormalizeServerUrl(input, out var error);
    Assert.Equal("", error);
    Assert.Equal(expected, url!.ToString());
  }

  [Theory]
  [InlineData("")]
  [InlineData("   ")]
  [InlineData(null)]
  [InlineData("http://keystone.exemple.fr")]
  [InlineData("http://192.168.1.10:3000")]
  [InlineData("ftp://keystone.exemple.fr")]
  [InlineData("file:///C:/keystone")]
  [InlineData("https://user:secret@keystone.exemple.fr")]
  [InlineData("https://keystone exemple.fr")]
  [InlineData("https://")]
  public void Refuses_with_a_french_message(string? input)
  {
    Assert.Null(NavigationRules.NormalizeServerUrl(input, out var error));
    Assert.NotEqual("", error);
  }
}

public class ClassifyTests
{
  private static readonly Uri Server = new("https://keystone.exemple.fr/");

  private static LinkKind Of(string target, params string[] extra) => NavigationRules.Classify(target, Server, extra);

  [Fact]
  public void Keystone_pages_stay_in_the_window()
  {
    Assert.Equal(LinkKind.Keystone, Of("https://keystone.exemple.fr/projects/HLT-026/budget"));
    Assert.Equal(LinkKind.Keystone, Of("https://KEYSTONE.exemple.fr/api/auth/callback?code=x"));
  }

  [Fact]
  public void Another_port_or_scheme_is_another_site()
  {
    Assert.Equal(LinkKind.External, Of("https://keystone.exemple.fr:8443/"));
    Assert.Equal(LinkKind.External, Of("http://keystone.exemple.fr/"));
    Assert.Equal(LinkKind.External, Of("https://codex.exemple.fr/documents/1"));
  }

  [Fact]
  public void Microsoft_sign_in_stays_in_the_window()
  {
    Assert.Equal(LinkKind.SignIn, Of("https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize?client_id=x"));
    Assert.Equal(LinkKind.SignIn, Of("https://login.microsoft.com/common/"));
    Assert.Equal(LinkKind.SignIn, Of("https://mysignins.microsoft.com/register"));
    // Only over https, and only these hosts.
    Assert.Equal(LinkKind.External, Of("http://login.microsoftonline.com/"));
    Assert.Equal(LinkKind.External, Of("https://login.microsoftonline.com.evil.example/"));
    Assert.Equal(LinkKind.External, Of("https://www.microsoft.com/"));
  }

  [Fact]
  public void Extra_sign_in_hosts_from_keystone_json()
  {
    Assert.Equal(LinkKind.External, Of("https://adfs.epc2i.example/adfs/ls"));
    Assert.Equal(LinkKind.SignIn, Of("https://adfs.epc2i.example/adfs/ls", "adfs.epc2i.example"));
    Assert.Equal(LinkKind.SignIn, Of("https://sts.epc2i.example/", "*.epc2i.example"));
    Assert.Equal(LinkKind.External, Of("https://epc2i.example.other/", "*.epc2i.example"));
  }

  [Fact]
  public void Mail_and_telephone_go_to_windows()
  {
    Assert.Equal(LinkKind.External, Of("mailto:pm@exemple.fr"));
    Assert.Equal(LinkKind.External, Of("tel:+33100000000"));
  }

  [Fact]
  public void Local_and_refused_schemes()
  {
    Assert.Equal(LinkKind.Local, Of("about:blank"));
    Assert.Equal(LinkKind.Local, Of("data:text/html;charset=utf-8,hello"));
    Assert.Equal(LinkKind.Local, Of("blob:https://keystone.exemple.fr/6f1c0e1e-1111-4a3b-9c1e-000000000000"));
    Assert.Equal(LinkKind.Blocked, Of("blob:https://other.exemple.fr/6f1c0e1e-1111-4a3b-9c1e-000000000000"));
    Assert.Equal(LinkKind.Blocked, Of("file:///C:/Windows/win.ini"));
    Assert.Equal(LinkKind.Blocked, Of("ms-settings:privacy"));
    Assert.Equal(LinkKind.Blocked, Of("not a url"));
  }
}

public class SettingsFileTests
{
  [Fact]
  public void Reads_the_documented_file()
  {
    var file = SettingsFileFormat.Parse("""{ "serverUrl": "https://keystone.exemple.fr", "signInHosts": ["adfs.exemple.fr", " ", 3] }""", out var error);
    Assert.Equal("", error);
    Assert.Equal("https://keystone.exemple.fr", file!.ServerUrl);
    Assert.Equal(["adfs.exemple.fr"], file.SignInHosts);
  }

  [Fact]
  public void Tolerates_comments_trailing_commas_and_case()
  {
    var file = SettingsFileFormat.Parse("// set by IT\n{ \"ServerURL\": \"https://k.exemple.fr\", }", out _);
    Assert.Equal("https://k.exemple.fr", file!.ServerUrl);
  }

  [Theory]
  [InlineData("")]
  [InlineData("{")]
  [InlineData("[\"https://k.exemple.fr\"]")]
  public void Refuses_unreadable_files(string json)
  {
    Assert.Null(SettingsFileFormat.Parse(json, out var error));
    Assert.NotEqual("", error);
  }

  [Fact]
  public void Round_trips()
  {
    var text = SettingsFileFormat.Serialize(new AppSettingsFile("https://k.exemple.fr/", ["adfs.exemple.fr"]));
    var file = SettingsFileFormat.Parse(text, out _);
    Assert.Equal("https://k.exemple.fr/", file!.ServerUrl);
    Assert.Equal(["adfs.exemple.fr"], file.SignInHosts);
    Assert.DoesNotContain("signInHosts", SettingsFileFormat.Serialize(new AppSettingsFile("https://k.exemple.fr/", [])));
  }
}
