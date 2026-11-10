using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace Seasonote;
internal sealed class LocalAssetServer : IDisposable
{
 readonly TcpListener listener = new(IPAddress.Loopback, 0);
 readonly CancellationTokenSource stop = new();
 readonly string root;
 int disposed;
 public Uri Origin { get; private set; } = null!;
 public LocalAssetServer(string root) { this.root = Path.GetFullPath(root) + Path.DirectorySeparatorChar; }
 public void Start() { listener.Start(); Origin = new Uri($"http://127.0.0.1:{((IPEndPoint)listener.LocalEndpoint).Port}/"); _ = Accept(); }
 async Task Accept()
 {
  while (!stop.IsCancellationRequested)
  {
   try { var client = await listener.AcceptTcpClientAsync(stop.Token); _ = Serve(client); }
   catch (OperationCanceledException) { break; } catch (ObjectDisposedException) { break; } catch { if (stop.IsCancellationRequested) break; }
  }
 }
 async Task Serve(TcpClient client)
 {
  using (client)
  using (var timeout = CancellationTokenSource.CreateLinkedTokenSource(stop.Token))
  {
   timeout.CancelAfter(TimeSpan.FromSeconds(8));
   try {
    var stream = client.GetStream(); var buffer = new byte[4096]; using var header = new MemoryStream();
    string request;
    while (true) {
     var count = await stream.ReadAsync(buffer, timeout.Token); if(count == 0) return;
     header.Write(buffer, 0, count); if(header.Length > 32768) return;
     request = Encoding.ASCII.GetString(header.ToArray()); if(request.Contains("\r\n\r\n")) break;
    }
    var parts = request.Split('\n')[0].Trim().Split(' '); if(parts.Length < 2) return;
    if(parts[0] != "GET" && parts[0] != "HEAD") { await Reply(stream, "405 Method Not Allowed", "text/plain", Array.Empty<byte>(), false, timeout.Token); return; }
    var relative = Uri.UnescapeDataString(parts[1].Split('?')[0]).TrimStart('/'); if(relative.Length == 0) relative = "index.html";
    if(relative.IndexOfAny(new[]{'\0', '\\', ':'}) >= 0) { await Reply(stream,"403 Forbidden","text/plain",Array.Empty<byte>(),false,timeout.Token); return; }
    var path = Path.GetFullPath(Path.Combine(root,relative));
    if(!path.StartsWith(root,StringComparison.OrdinalIgnoreCase)) { await Reply(stream,"403 Forbidden","text/plain",Array.Empty<byte>(),false,timeout.Token); return; }
    var type = Path.GetExtension(path).ToLowerInvariant() switch { ".html"=>"text/html; charset=utf-8", ".js" or ".mjs"=>"text/javascript; charset=utf-8", ".css"=>"text/css", ".json"=>"application/json", ".png"=>"image/png", ".jpg" or ".jpeg"=>"image/jpeg", ".webp"=>"image/webp", ".svg"=>"image/svg+xml", ".woff2"=>"font/woff2", _=>"application/octet-stream" };
    if(!File.Exists(path)) { await Reply(stream,"404 Not Found","text/plain",Array.Empty<byte>(),false,timeout.Token); return; }
    var bytes = await File.ReadAllBytesAsync(path,timeout.Token);
    await Reply(stream,"200 OK",type,bytes,parts[0]=="HEAD",timeout.Token);
   } catch(Exception e) when (e is IOException or OperationCanceledException or ArgumentException or UnauthorizedAccessException) { }
  }
 }
 static async Task Reply(NetworkStream stream,string status,string type,byte[] bytes,bool head,CancellationToken token)
 {
  var h = Encoding.ASCII.GetBytes($"HTTP/1.1 {status}\r\nContent-Type: {type}\r\nContent-Length: {bytes.Length}\r\nConnection: close\r\nCache-Control: no-cache\r\nX-Content-Type-Options: nosniff\r\n\r\n");
  await stream.WriteAsync(h,token); if(!head) await stream.WriteAsync(bytes,token);
 }
 public void Dispose() { if(Interlocked.Exchange(ref disposed,1)!=0) return; stop.Cancel(); listener.Stop(); stop.Dispose(); }
}
