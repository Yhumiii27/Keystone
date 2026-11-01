// The application's own page, shown in the window when the Keystone server cannot be reached. Same look as the Mac
// app's status pages (desktop/KeystoneApp.swift). Its buttons talk to MainForm through chrome.webview.postMessage.
using System.Net;

namespace Keystone.Desktop;

internal static class StatusPages
{
  public static string Offline(string title, string detail, Uri server, bool canChangeServer)
  {
    var change = canChangeServer
      ? "<button class=\"g\" onclick=\"send('settings')\">Changer l’adresse du serveur</button>"
      : "";
    return $$"""
      <!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Keystone</title><style>
      html,body{height:100%;margin:0;background:#161826;color:#e9e9ed;font:14px/1.5 "Segoe UI",system-ui,sans-serif}
      .c{height:100%;display:grid;place-items:center}.b{display:flex;flex-direction:column;align-items:center;gap:14px;max-width:560px;padding:24px;text-align:center}
      .logo{width:44px;height:44px;border:1px solid #9184d9;border-radius:10px;display:grid;place-items:center;color:#9184d9;box-shadow:0 0 22px rgba(145,132,217,.35)}
      h1{font-weight:500;font-size:19px;margin:0}.m{color:rgba(233,233,237,.62)}code{color:rgba(233,233,237,.8)}
      .r{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}
      button{font:inherit;color:#161826;background:#9184d9;border:1px solid #9184d9;border-radius:8px;padding:6px 16px;cursor:pointer}
      button.g{color:#9184d9;background:transparent}button:focus-visible{outline:2px solid #b5abfc;outline-offset:2px}
      </style></head><body><div class="c"><div class="b">
      <div class="logo"><svg width="24" height="24" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M230.64,49.36a32,32,0,0,0-45.26,0h0a31.9,31.9,0,0,0-5.16,6.76L152,48.42A32,32,0,0,0,97.37,25.36h0a32.06,32.06,0,0,0-5.76,37.41L57.67,93.32a32.05,32.05,0,0,0-40.31,4.05h0a32,32,0,0,0,42.89,47.41l70,51.36a32,32,0,1,0,47.57-14.69l27.39-77.59q1.38.12,2.76.12a32,32,0,0,0,22.63-54.62Zm-122-12.69h0a16,16,0,1,1,0,22.64A16,16,0,0,1,108.68,36.67Zm-80,94.65a16,16,0,0,1,0-22.64h0a16,16,0,1,1,0,22.64Zm142.65,88a16,16,0,0,1-22.63-22.63h0a16,16,0,1,1,22.63,22.63Zm-8.55-43.18a32,32,0,0,0-23,7.08l-70-51.36a32.17,32.17,0,0,0-1.34-26.65l33.95-30.55a32,32,0,0,0,45.47-10.81L176,71.56a32,32,0,0,0,14.12,27Zm56.56-92.84A16,16,0,1,1,196.7,60.68h0a16,16,0,0,1,22.63,22.63Z"/></svg></div>
      <h1>{{Html(title)}}</h1>
      <div class="m">{{Html(detail)}}</div>
      <div class="m">Serveur : <code>{{Html(server.ToString())}}</code></div>
      <div class="r"><button autofocus onclick="send('retry')">Réessayer</button>{{change}}</div>
      <div class="m">Keystone reste aussi accessible depuis votre navigateur, à la même adresse.</div>
      </div></div><script>
      function send(m){ if (window.chrome && chrome.webview) chrome.webview.postMessage(m); }
      window.addEventListener('online', function(){ send('retry'); });
      </script></body></html>
      """;
  }

  private static string Html(string s) => WebUtility.HtmlEncode(s).Replace("\n", "<br>");
}
