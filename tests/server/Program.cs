using System.Net;
using System.Net.Sockets;
using System.Text;
using Seasonote;
var root=Path.Combine(Path.GetTempPath(),"seasonote-server-tests-"+Guid.NewGuid());Directory.CreateDirectory(root);File.WriteAllText(Path.Combine(root,"index.html"),"seasonote-home");File.WriteAllText(Path.Combine(root,"sample.js"),"export const ready=true");
try {
 using var server=new LocalAssetServer(root);server.Start();using var client=new HttpClient();
 async Task Expect(string path,HttpStatusCode status,string? body=null){ var r=await client.GetAsync(new Uri(server.Origin,path));if(r.StatusCode!=status)throw new Exception(path+" status "+r.StatusCode);if(body!=null&&(await r.Content.ReadAsStringAsync())!=body)throw new Exception(path+" body");Console.WriteLine("PASS "+path);}
 await Expect("/",HttpStatusCode.OK,"seasonote-home");await Expect("/sample.js?version=1",HttpStatusCode.OK,"export const ready=true");await Expect("/missing",HttpStatusCode.NotFound);
 var js=await client.GetAsync(new Uri(server.Origin,"sample.js"));if(js.Content.Headers.ContentType?.MediaType!="text/javascript")throw new Exception("MIME");Console.WriteLine("PASS module MIME");
 var head=await client.SendAsync(new HttpRequestMessage(HttpMethod.Head,new Uri(server.Origin,"/")));var headLength=head.Content.Headers.ContentLength; if((await head.Content.ReadAsByteArrayAsync()).Length!=0||headLength!="seasonote-home".Length)throw new Exception("HEAD");Console.WriteLine("PASS HEAD");
 var post=await client.PostAsync(server.Origin,new StringContent(""));if(post.StatusCode!=HttpStatusCode.MethodNotAllowed)throw new Exception("POST");Console.WriteLine("PASS reject POST");
 foreach(var path in new[]{"/%2e%2e/secret","/%5c../secret","/C:%5cWindows","/%00bad"}) {
  using var tcp=new TcpClient();await tcp.ConnectAsync("127.0.0.1",server.Origin.Port);var stream=tcp.GetStream();await stream.WriteAsync(Encoding.ASCII.GetBytes("GET "+path+" HTTP/1.1\r\nHost: localhost\r\n\r\n"));using var reader=new StreamReader(stream);var result=await reader.ReadToEndAsync();if(!result.StartsWith("HTTP/1.1 403"))throw new Exception("Traversal allowed "+path);Console.WriteLine("PASS reject "+path);
 }
 await Task.WhenAll(Enumerable.Range(0,16).Select(_=>Expect("/sample.js",HttpStatusCode.OK,"export const ready=true")));
 server.Dispose();server.Dispose();Console.WriteLine("PASS idempotent shutdown");
 try { await client.GetAsync(server.Origin);throw new Exception("server alive after stop"); } catch(HttpRequestException) {Console.WriteLine("PASS listener stops");}
}finally{Directory.Delete(root,true);}
