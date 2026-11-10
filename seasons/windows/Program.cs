using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Diagnostics;
using System.Security.Principal;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using Drawing = System.Drawing;
using Forms = System.Windows.Forms;

namespace Seasonote;
internal static class Program
{
 [STAThread] static void Main()
 {
  var user = WindowsIdentity.GetCurrent().User?.Value ?? Environment.UserName;
  using var mutex = new Mutex(true,"Local\\Seasonote-App-"+user,out var first);
  using var reopen = new EventWaitHandle(false,EventResetMode.AutoReset,"Local\\Seasonote-Open-"+user);
  if(!first) { reopen.Set(); return; }
  var app = new Application { ShutdownMode=ShutdownMode.OnExplicitShutdown };
  using var controller = new Controller(app);
  var wait = ThreadPool.RegisterWaitForSingleObject(reopen,(_,_)=>app.Dispatcher.BeginInvoke(controller.Show),null,Timeout.Infinite,false);
  app.DispatcherUnhandledException += (_,e)=> { controller.Report(e.Exception); e.Handled=true; };
  app.Startup += async (_,_)=>await controller.Start();
  app.Exit += (_,_)=>wait.Unregister(null);
  app.Run();
 }
}
internal sealed class Preferences
{
 public int X { get; set; } = 120; public int Y { get; set; } = 120;
 public int Width { get; set; } = 640; public int Height { get; set; } = 510;
 public bool HasPlacement { get; set; }
 public bool WelcomeShown { get; set; }
 public bool ShortcutCreated { get; set; }
 internal static readonly string Folder=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Seasonote");
 static string FilePath=>Path.Combine(Folder,"settings.json");
 internal static Preferences Load() { try { var p=JsonSerializer.Deserialize<Preferences>(File.ReadAllText(FilePath))??new(); if(p.Width<1||p.Height<1||p.Width>32768||p.Height>32768) { p.Width=640;p.Height=510; } return p; } catch { return new(); } }
 internal void Save() { try { Directory.CreateDirectory(Folder); File.WriteAllText(FilePath+".tmp",JsonSerializer.Serialize(this)); File.Move(FilePath+".tmp",FilePath,true); } catch { } }
 internal Drawing.Rectangle Bounds { get=>new(X,Y,Width,Height); set { X=value.X; Y=value.Y; Width=value.Width; Height=value.Height; } }
}
internal sealed class Controller : IDisposable
{
 readonly Application app;
 readonly Preferences preferences=Preferences.Load();
 readonly Forms.NotifyIcon tray=new();
 readonly LocalAssetServer server=new(Path.Combine(AppContext.BaseDirectory,"web"));
 readonly MusicBridge bridge=new();
 readonly DispatcherTimer desktopMonitor=new() { Interval=TimeSpan.FromSeconds(2) };
 DesktopWindow? desktop;
 Window? controls;
 Button? visibilityButton; TextBlock? statusLabel;
 Forms.ToolStripMenuItem visibilityMenu=null!;
 bool enabled=true,quitting,started,starting,initialized;
 internal Controller(Application app) { this.app=app; }
 internal async Task Start()
 {
  if(started||starting||quitting) return;
  starting=true;
  try {
  if(!initialized) { Directory.CreateDirectory(Preferences.Folder); SetupTray(); CreateShortcut(false); initialized=true; }
  if(!EnsureRuntime()) { OpenControls(); return; }
  if(!Directory.Exists(Path.Combine(AppContext.BaseDirectory,"web"))) { Report(new IOException("动画文件缺失，请完整解压 Seasonote 文件夹后重新打开。")); return; }
  server.Start(); started=true;
  bridge.StateChanged += OnMediaState;
  desktopMonitor.Tick+=(_,_)=>RefreshDesktop(); desktopMonitor.Start();
  RefreshDesktop(); await bridge.StartAsync();
  if(!preferences.WelcomeShown) { OpenControls(); preferences.WelcomeShown=true; preferences.Save(); }
  } finally { starting=false; }
 }
 bool EnsureRuntime()
 {
  try { _=CoreWebView2Environment.GetAvailableBrowserVersionString(); return true; }
  catch(WebView2RuntimeNotFoundException) {
   if(MessageBox.Show("Seasonote 需要 Microsoft WebView2 来显示转盘。点击“是”打开微软官方下载页，安装后重新打开 Seasonote。", "安装显示组件",MessageBoxButton.YesNo,MessageBoxImage.Information)==MessageBoxResult.Yes)
    OpenUrl("https://developer.microsoft.com/microsoft-edge/webview2/#download-section");
   return false;
  }
 }
 void OnMediaState(Dictionary<string,object?> state) => app.Dispatcher.BeginInvoke(()=>desktop?.PushState(state));
 void RefreshDesktop()
 {
  if(quitting||!started) return;
  if(desktop?.NativeLost==true) { desktop.Retire(); desktop=null; }
  if(desktop is null || desktop.ClosedPermanently) {
   desktop=new DesktopWindow(this,server.Origin,preferences.Bounds,preferences.HasPlacement);
   desktop.Closed+=(_,_)=>{ if(!quitting) preferences.Save(); };
   desktop.Show();
  }
  desktop.RefreshHost(enabled); UpdateControls();
 }
 internal void PlaceSaved(Drawing.Rectangle frame) { preferences.Bounds=frame; preferences.HasPlacement=true; preferences.Save(); }
 internal void Show() { enabled=true; if(!started) { _=Start(); return; } RefreshDesktop(); }
 internal void Hide() { enabled=false; desktop?.SetShown(false); UpdateControls(); }
 void Toggle() { if(enabled) Hide(); else Show(); }
 internal bool MusicVisible { get; private set; }
 internal double MusicHeight { get; private set; }
 internal void Layout(bool visible,double height) { MusicVisible=visible; MusicHeight=visible?Math.Clamp(height,0,240):0; }
 internal async Task Media(string action,double? value)
 {
  if(action=="refresh") bridge.PublishCurrentState(true);
  else if(new[]{"play","pause","toggle","previous","next","seek"}.Contains(action)) await bridge.CommandAsync(action,value);
 }
 void UpdateControls()
 {
  if(visibilityButton is not null) visibilityButton.Content=enabled?"隐藏桌面转盘":"显示桌面转盘";
  if(visibilityMenu is not null) visibilityMenu.Text=enabled?"隐藏桌面转盘":"显示桌面转盘";
  if(statusLabel is not null) statusLabel.Text=!started?"等待安装 WebView2 显示组件":enabled?(desktop?.Attached==true?"桌面转盘：显示中":"正在等待 Windows 桌面…"):"桌面转盘：已隐藏";
 }
 internal void OpenControls()
 {
  if(controls is null) {
   controls=new Window { Title="Seasonote · 开关",Width=440,Height=300,ResizeMode=ResizeMode.NoResize,WindowStartupLocation=WindowStartupLocation.CenterScreen,Icon=BitmapFrame.Create(new Uri(Path.Combine(AppContext.BaseDirectory,"Seasonote.ico"))) };
   var root=new StackPanel { Margin=new Thickness(26) }; controls.Content=root;
   root.Children.Add(new TextBlock { Text="Seasonote",FontSize=26,FontWeight=FontWeights.SemiBold });
   statusLabel=new TextBlock { Margin=new Thickness(0,10,0,8),FontSize=14 }; root.Children.Add(statusLabel);
   root.Children.Add(new TextBlock { Text="移入转盘，点击右上角 × 收起。双击桌面 Seasonote 图标，或点击托盘图标重新显示。",TextWrapping=TextWrapping.Wrap,Foreground=Brushes.DimGray });
   visibilityButton=new Button { Margin=new Thickness(0,18,0,10),Height=36 }; visibilityButton.Click+=(_,_)=>Toggle(); root.Children.Add(visibilityButton);
   var row=new DockPanel(); root.Children.Add(row);
   var exit=new Button { Content="退出 Seasonote",Padding=new Thickness(10,5,10,5) }; exit.Click+=(_,_)=>Quit(); DockPanel.SetDock(exit,Dock.Right); row.Children.Add(exit);
   row.Children.Add(new TextBlock { Text="隐藏或退出不会停止音乐。",FontSize=11,VerticalAlignment=VerticalAlignment.Center,Foreground=Brushes.DimGray });
   controls.PreviewKeyDown+=(_,e)=>{ if(e.Key==Key.Q&&(Keyboard.Modifiers&ModifierKeys.Control)!=0) { e.Handled=true; Quit(); } };
   controls.Closed+=(_,_)=>{ controls=null; visibilityButton=null; statusLabel=null; };
  }
  UpdateControls(); controls.Show(); controls.WindowState=WindowState.Normal; controls.Activate();
 }
 void SetupTray()
 {
  tray.Icon=new Drawing.Icon(Path.Combine(AppContext.BaseDirectory,"Seasonote.ico")); tray.Text="Seasonote · 四季音乐转盘";
  var menu=new Forms.ContextMenuStrip();
  void Add(string name,Action action) => menu.Items.Add(name,null,(_,_)=>app.Dispatcher.Invoke(action));
  Add("打开开关窗口…",OpenControls);
  visibilityMenu=new Forms.ToolStripMenuItem("隐藏桌面转盘",null,(_,_)=>app.Dispatcher.Invoke(Toggle)); menu.Items.Add(visibilityMenu);
  menu.Items.Add(new Forms.ToolStripSeparator()); Add("居中显示",()=>desktop?.Center());
  var size=new Forms.ToolStripMenuItem("摆件大小");
  foreach(var (label,width) in new[]{("小 · 480",480),("中 · 640",640),("大 · 820",820)}) size.DropDownItems.Add(label,null,(_,_)=>app.Dispatcher.Invoke(()=>desktop?.ResizePreset(width)));
  menu.Items.Add(size); menu.Items.Add(new Forms.ToolStripSeparator());
  Add("暂停 / 继续季节",()=>desktop?.Command("togglePlay"));
  void Choices(string label,string action,(string,object)[] values) {
   var sub=new Forms.ToolStripMenuItem(label); foreach(var (name,value) in values) sub.DropDownItems.Add(name,null,(_,_)=>app.Dispatcher.Invoke(()=>desktop?.Command(action,value))); menu.Items.Add(sub);
  }
  Choices("循环速度","speed",new (string,object)[]{("原速 · 连续四季（约 25 秒）",25.132741228718345),("60 秒 / 四季",60),("120 秒 / 四季",120)});
  Choices("天气","weather",new (string,object)[]{("随四季变化","auto"),("风","wind"),("雨","rain"),("雪","snow"),("晴","clear")});
  Choices("画质","quality",new (string,object)[]{("高","high"),("中","medium"),("低","low")});
  menu.Items.Add(new Forms.ToolStripSeparator());
  Add("在浏览器中打开预览",()=>{ if(started) OpenUrl(server.Origin.ToString()); });
  Add("创建桌面快捷方式",()=>CreateShortcut(true));
  Add("退出 Seasonote",Quit);
  tray.ContextMenuStrip=menu; tray.MouseClick+=(_,e)=>{ if(e.Button==Forms.MouseButtons.Left) app.Dispatcher.Invoke(Show); }; tray.Visible=true;
 }
 void CreateShortcut(bool notify)
 {
  try {
   var exe=Environment.ProcessPath!; var directory=Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
   var candidates=new[]{Path.Combine(directory,"Seasonote.lnk"),Path.Combine(directory,"Seasonote 桌面转盘.lnk")};
   var shellType=Type.GetTypeFromProgID("WScript.Shell")??throw new InvalidOperationException("无法创建桌面快捷方式");
   dynamic shell=Activator.CreateInstance(shellType)!;
   object? owned=null;
   foreach(var candidate in candidates) {
    if(!File.Exists(candidate)) continue;
    dynamic existing=shell.CreateShortcut(candidate);
    if(string.Equals((string)existing.TargetPath,exe,StringComparison.OrdinalIgnoreCase)||(string)existing.Description=="Seasonote · 四季音乐转盘") { owned=existing; break; }
    System.Runtime.InteropServices.Marshal.FinalReleaseComObject(existing);
   }
   // Respect a shortcut the user deliberately removed; repair existing owned links after a move.
   if(owned is null&&!notify&&preferences.ShortcutCreated) { System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shell); return; }
   if(owned is null) {
    var free=candidates.FirstOrDefault(path=>!File.Exists(path));
    if(free is null) { System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shell); throw new IOException("桌面已有同名快捷方式，已保留原文件。可从解压文件夹打开 Seasonote.exe。"); }
    owned=shell.CreateShortcut(free);
   }
   dynamic link=owned;
   link.TargetPath=exe; link.WorkingDirectory=AppContext.BaseDirectory; link.IconLocation=exe+",0";
   link.Description="Seasonote · 四季音乐转盘"; link.Save();
   System.Runtime.InteropServices.Marshal.FinalReleaseComObject(link); System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shell);
   preferences.ShortcutCreated=true; preferences.Save();
   if(notify) tray.ShowBalloonTip(2500,"Seasonote","桌面快捷方式已创建。",Forms.ToolTipIcon.Info);
  } catch(Exception e) { if(notify) Report(e); }
 }
 internal void Report(Exception error)
 {
  try { Directory.CreateDirectory(Preferences.Folder); File.AppendAllText(Path.Combine(Preferences.Folder,"errors.log"),DateTimeOffset.Now+" "+error+Environment.NewLine); } catch { }
  if(!quitting) tray.ShowBalloonTip(6000,"Seasonote",error.Message,Forms.ToolTipIcon.Warning);
 }
 static void OpenUrl(string url) { Process.Start(new ProcessStartInfo(url) { UseShellExecute=true }); }
 internal void Quit() { if(quitting) return; quitting=true; desktopMonitor.Stop(); bridge.Dispose(); tray.Visible=false; controls?.Close(); desktop?.Close(); server.Dispose(); app.Shutdown(); }
 public void Dispose() { desktopMonitor.Stop(); bridge.Dispose(); tray.Dispose(); if(started) server.Dispose(); }
}
internal sealed class DesktopWindow : Window
{
 readonly Controller owner;
 readonly Uri origin;
 readonly WebView2CompositionControl web=new() { DefaultBackgroundColor=Drawing.Color.Transparent,Background=Brushes.Transparent };
 // Alpha 1/255 keeps the transparent gaps hit-testable in a layered window,
 // so the pointer can cross from the disk to the hover × without losing it.
 readonly Grid root=new() { Background=new SolidColorBrush(Color.FromArgb(1,0,0,0)) };
 readonly Border outline=new() { BorderBrush=new SolidColorBrush(Color.FromArgb(77,255,255,255)),BorderThickness=new Thickness(1),CornerRadius=new CornerRadius(12),Margin=new Thickness(9),IsHitTestVisible=false,Visibility=Visibility.Hidden };
 readonly Canvas handles=new() { IsHitTestVisible=false,Visibility=Visibility.Hidden };
 readonly Button close=new() { Content="×",FontSize=22,Width=28,Height=28,Padding=new Thickness(0),Foreground=Brushes.White,Background=new SolidColorBrush(Color.FromArgb(140,0,0,0)),BorderThickness=new Thickness(0),HorizontalAlignment=HorizontalAlignment.Right,VerticalAlignment=VerticalAlignment.Top,Margin=new Thickness(0,25,25,0),Visibility=Visibility.Hidden,ToolTip="隐藏转盘 · 双击桌面 Seasonote 可重新打开" };
 readonly Border hint=new() { Background=new SolidColorBrush(Color.FromArgb(120,0,0,0)),CornerRadius=new CornerRadius(12),Padding=new Thickness(11,5,11,5),HorizontalAlignment=HorizontalAlignment.Center,VerticalAlignment=VerticalAlignment.Top,Margin=new Thickness(54,19,54,0),IsHitTestVisible=false,Visibility=Visibility.Hidden };
 IntPtr hwnd,host;
 Drawing.Rectangle frame,gestureFrame;
 Drawing.Point? down;
 Point clickPoint;
 int corner=-1;
 bool moved,ready,shown=true,disposing;
 internal bool ClosedPermanently { get; private set; }
 internal bool Attached=>DesktopHost.Attached(hwnd,host);
 internal bool NativeLost=>hwnd!=IntPtr.Zero&&!DesktopHost.Alive(hwnd);
 internal void Retire() { disposing=true; ClosedPermanently=true; web.Dispose(); try { Close(); } catch(InvalidOperationException) { } }
 internal DesktopWindow(Controller owner,Uri origin,Drawing.Rectangle frame,bool restorePlacement)
 {
  this.owner=owner; this.origin=origin; this.frame=DesktopHost.Clamp(frame);
  Title="Seasonote"; WindowStyle=WindowStyle.None; AllowsTransparency=true; Background=Brushes.Transparent;
  ShowInTaskbar=false; ShowActivated=false; ResizeMode=ResizeMode.NoResize; Width=640; Height=510; Opacity=0;
  Content=root; root.Children.Add(web); root.Children.Add(outline); root.Children.Add(handles); root.Children.Add(hint); root.Children.Add(close);
  var closeBorder=new FrameworkElementFactory(typeof(Border)); closeBorder.SetValue(Border.CornerRadiusProperty,new CornerRadius(14)); closeBorder.SetValue(Border.BackgroundProperty,close.Background);
  var closeText=new FrameworkElementFactory(typeof(ContentPresenter)); closeText.SetValue(ContentPresenter.HorizontalAlignmentProperty,HorizontalAlignment.Center); closeText.SetValue(ContentPresenter.VerticalAlignmentProperty,VerticalAlignment.Center); closeBorder.AppendChild(closeText); close.Template=new ControlTemplate(typeof(Button)) { VisualTree=closeBorder };
  hint.Child=new TextBlock { Text="拖动移动 · 四角缩放 · Shift 拖动指针",Foreground=Brushes.White,FontSize=11 };
  System.Windows.Automation.AutomationProperties.SetName(close,"隐藏 Seasonote"); close.Click+=(_,_)=>owner.Hide();
  root.PreviewKeyDown+=(_,e)=>{ if(e.Key==Key.Q&&(Keyboard.Modifiers&ModifierKeys.Control)!=0) { e.Handled=true; owner.Quit(); } };
  root.MouseEnter+=(_,_)=>Chrome(true); root.MouseLeave+=(_,_)=>{ if(down is null) Chrome(false); };
  root.PreviewMouseLeftButtonDown+=PointerDown; root.PreviewMouseMove+=PointerMove; root.PreviewMouseLeftButtonUp+=PointerUp;
  root.LostMouseCapture+=(_,_)=>{ if(down is not null) FinishGesture(); };
  root.PreviewMouseRightButtonUp+=(_,e)=>{ owner.OpenControls(); e.Handled=true; };
  SizeChanged+=(_,_)=>DrawHandles();
  SourceInitialized+=(_,_)=>{
   hwnd=new WindowInteropHelper(this).Handle;
   var scale=DesktopHost.Scale(hwnd);
   if(!restorePlacement) this.frame=new Drawing.Rectangle((int)Math.Round(frame.X*scale),(int)Math.Round(frame.Y*scale),(int)Math.Round(640*scale),(int)Math.Round(510*scale));
   this.frame=DesktopHost.Clamp(this.frame,scale); RefreshHost(true);
  };
  Loaded+=async(_,_)=>await Initialize();
  Closing+=(_,_)=>{ disposing=true; if(DesktopHost.Alive(hwnd)) owner.PlaceSaved(DesktopHost.Bounds(hwnd)); };
  Closed+=(_,_)=>{ ClosedPermanently=true; web.Dispose(); };
 }
 internal void RefreshHost(bool enabled)
 {
  shown=enabled; if(hwnd==IntPtr.Zero||disposing) return;
  if(!Attached) {
   Opacity=0; host=DesktopHost.Find();
   if(!DesktopHost.Attach(hwnd,host)) { DesktopHost.Hide(hwnd); return; }
   frame=DesktopHost.Clamp(frame,DesktopHost.Scale(hwnd)); DesktopHost.Place(hwnd,host,frame,enabled); Opacity=1;
  }
  if(enabled) { DesktopHost.Place(hwnd,host,frame,true); } else DesktopHost.Hide(hwnd);
 }
 internal void SetShown(bool value) { shown=value; if(value) RefreshHost(true); else { FinishGesture(); DesktopHost.Hide(hwnd); Chrome(false); } }
 async Task Initialize()
 {
  try {
   var environment=await CoreWebView2Environment.CreateAsync(null,Path.Combine(Preferences.Folder,"WebView2"));
   await web.EnsureCoreWebView2Async(environment);
   var core=web.CoreWebView2;
   core.Settings.AreDefaultContextMenusEnabled=false; core.Settings.AreDevToolsEnabled=false; core.Settings.IsStatusBarEnabled=false; core.Settings.IsZoomControlEnabled=false;
   core.Settings.AreDefaultScriptDialogsEnabled=false;
   core.PermissionRequested+=(_,e)=>e.State=CoreWebView2PermissionState.Deny;
   core.NewWindowRequested+=(_,e)=>e.Handled=true;
   core.DownloadStarting+=(_,e)=>e.Cancel=true;
   core.NavigationStarting+=(_,e)=> { if(!OwnOrigin(e.Uri)) e.Cancel=true; };
   core.FrameNavigationStarting+=(_,e)=>e.Cancel=true;
   core.WebMessageReceived+=async(_,e)=> {
    if(!OwnOrigin(e.Source)) return;
    try {
     using var document=JsonDocument.Parse(e.WebMessageAsJson); var data=document.RootElement;
     if(!data.TryGetProperty("channel",out var channel)||channel.GetString()!="seasonsMusic") return;
     if(!data.TryGetProperty("action",out var actionValue)) return; var action=actionValue.GetString();
     if(action=="layout") {
      bool visible=data.TryGetProperty("visible",out var v)&&v.ValueKind==JsonValueKind.True;
      double height=data.TryGetProperty("height",out var h)&&h.ValueKind==JsonValueKind.Number&&h.TryGetDouble(out var d)&&double.IsFinite(d)?d:0;
      owner.Layout(visible,Math.Min(height,ActualHeight)); return;
     }
     double? value=data.TryGetProperty("value",out var n)&&n.ValueKind==JsonValueKind.Number&&n.TryGetDouble(out var number)&&double.IsFinite(number)?number:null;
     if(action is not null) await owner.Media(action,value);
    } catch(Exception error) { owner.Report(error); }
   };
   await core.AddScriptToExecuteOnDocumentCreatedAsync("window.__SEASONS_WIDGET__=true;window.__nativeErrors=[];addEventListener('error',e=>window.__nativeErrors.push(e.message));");
   core.NavigationCompleted+=async(_,e)=> { if(e.IsSuccess) { ready=true; await owner.Media("refresh",null); } };
   environment.BrowserProcessExited+=(_,_)=>Dispatcher.BeginInvoke(()=> { if(!disposing) Close(); });
   core.ProcessFailed+=(_,e)=> {
    if(disposing) return;
    if(e.ProcessFailedKind==CoreWebView2ProcessFailedKind.BrowserProcessExited) { ready=false; return; }
    if(e.ProcessFailedKind is CoreWebView2ProcessFailedKind.RenderProcessExited or CoreWebView2ProcessFailedKind.RenderProcessUnresponsive) {
     ready=false; try { core.Reload(); } catch { Close(); }
    }
    // GPU / utility failures are recovered automatically by WebView2.
   };
   core.Navigate(new Uri(origin,"index.html?mode=widget").ToString());
  } catch(Exception e) { owner.Report(e); }
 }
 bool OwnOrigin(string value) => Uri.TryCreate(value,UriKind.Absolute,out var uri)&&uri.Scheme==origin.Scheme&&uri.Host==origin.Host&&uri.Port==origin.Port;
 internal async void PushState(Dictionary<string,object?> state) { if(ready&&!disposing) try { await web.ExecuteScriptAsync("dispatchEvent(new CustomEvent('seasons-music-state',{detail:"+JsonSerializer.Serialize(state)+"}));"); } catch(Exception e) { if(!disposing) owner.Report(e); } }
 internal async void Command(string action,object? value=null) { if(ready&&!disposing) try { await web.ExecuteScriptAsync("dispatchEvent(new CustomEvent('seasons-command',{detail:"+JsonSerializer.Serialize(new{action,value})+"}));"); } catch(Exception e) { owner.Report(e); } }
 void Chrome(bool visible) { var v=visible?Visibility.Visible:Visibility.Hidden; close.Visibility=v; outline.Visibility=v; hint.Visibility=v; handles.Visibility=v; }
 void DrawHandles() {
  handles.Children.Clear(); foreach(var p in new[]{new Point(9,9),new Point(Math.Max(9,ActualWidth-9),9),new Point(9,Math.Max(9,ActualHeight-9)),new Point(Math.Max(9,ActualWidth-9),Math.Max(9,ActualHeight-9))}) {
   var h=new Border { Width=8,Height=8,CornerRadius=new CornerRadius(2),Background=Brushes.White,BorderBrush=Brushes.Gray,BorderThickness=new Thickness(.5) }; Canvas.SetLeft(h,p.X-4); Canvas.SetTop(h,p.Y-4); handles.Children.Add(h);
  }
 }
 int Corner(Point p) { const int e=25; if(p.X<e&&p.Y<e)return 0;if(p.X>ActualWidth-e&&p.Y<e)return 1;if(p.X<e&&p.Y>ActualHeight-e)return 2;if(p.X>ActualWidth-e&&p.Y>ActualHeight-e)return 3;return -1; }
 void PointerDown(object sender,MouseButtonEventArgs e)
 {
  var p=e.GetPosition(root); if(p.X>=ActualWidth-53&&p.X<=ActualWidth-25&&p.Y>=25&&p.Y<=53) return;
  corner=Corner(p);
  if(corner<0&&((Keyboard.Modifiers&ModifierKeys.Shift)!=0||(owner.MusicVisible&&p.Y>=ActualHeight-owner.MusicHeight))) return;
  down=DesktopHost.Cursor(); gestureFrame=DesktopHost.Bounds(hwnd); clickPoint=p; moved=false; root.CaptureMouse(); Chrome(true); e.Handled=true;
 }
 void PointerMove(object sender,MouseEventArgs e)
 {
  if(down is not Drawing.Point start) { var c=Corner(e.GetPosition(root)); root.Cursor=c<0?Cursors.Arrow:(c==0||c==3?Cursors.SizeNWSE:Cursors.SizeNESW); return; }
  var current=DesktopHost.Cursor(); var dx=current.X-start.X;var dy=current.Y-start.Y;
  if(!moved&&Math.Sqrt(dx*dx+dy*dy)<4*DesktopHost.Scale(hwnd)) { e.Handled=true; return; } moved=true;
  if(corner<0) frame=new Drawing.Rectangle(gestureFrame.X+dx,gestureFrame.Y+dy,gestureFrame.Width,gestureFrame.Height);
  else {
   bool left=corner==0||corner==2, top=corner==0||corner==1;
   double sx=dx*(left?-1:1)/(double)gestureFrame.Width, sy=dy*(top?-1:1)/(double)gestureFrame.Height;
   var scale=Math.Max(Math.Max(320.0*DesktopHost.Scale(hwnd)/gestureFrame.Width,240.0*DesktopHost.Scale(hwnd)/gestureFrame.Height),1+(Math.Abs(sx)>Math.Abs(sy)?sx:sy));
   int w=(int)Math.Round(gestureFrame.Width*scale),h=(int)Math.Round(gestureFrame.Height*scale);
   frame=DesktopHost.Clamp(new Drawing.Rectangle(left?gestureFrame.Right-w:gestureFrame.Left,top?gestureFrame.Bottom-h:gestureFrame.Top,w,h),DesktopHost.Scale(hwnd));
  }
  DesktopHost.Place(hwnd,host,frame,shown); e.Handled=true;
 }
 async void PointerUp(object sender,MouseButtonEventArgs e)
 {
  if(down is null) return; var clicked=!moved&&corner<0; var point=clickPoint; FinishGesture(); e.Handled=true;
  if(clicked&&ready) try { await web.ExecuteScriptAsync("dispatchEvent(new CustomEvent('seasons-native-click',{detail:"+JsonSerializer.Serialize(new{x=point.X,y=point.Y})+"}));"); } catch(Exception error) { owner.Report(error); }
 }
 void FinishGesture() { if(down is null) return; down=null; root.ReleaseMouseCapture(); frame=DesktopHost.Bounds(hwnd); owner.PlaceSaved(frame); root.Cursor=Cursors.Arrow; Chrome(root.IsMouseOver); }
 internal void Center() { var area=Forms.Screen.FromRectangle(frame).WorkingArea; frame=new Drawing.Rectangle(area.Left+(area.Width-frame.Width)/2,area.Top+(area.Height-frame.Height)/2,frame.Width,frame.Height); DesktopHost.Place(hwnd,host,frame,shown); owner.PlaceSaved(frame); }
 internal void ResizePreset(int width) { var scale=DesktopHost.Scale(hwnd); var w=(int)Math.Round(width*scale);var h=(int)Math.Round(w*510.0/640);frame=DesktopHost.Clamp(new Drawing.Rectangle(frame.X+(frame.Width-w)/2,frame.Y+(frame.Height-h)/2,w,h),scale); DesktopHost.Place(hwnd,host,frame,shown); owner.PlaceSaved(frame); }
}
