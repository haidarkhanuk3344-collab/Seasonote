using System;
using System.Runtime.InteropServices;
using System.Text;
using Drawing = System.Drawing;
using Forms = System.Windows.Forms;

namespace Seasonote;
// A child of Explorer's desktop surface remains on the desktop when Win+D is used.
// Unlike a bottommost top-level window, it cannot float over ordinary applications.
internal static class DesktopHost
{
 const int GWL_STYLE = -16, GWL_EXSTYLE = -20;
 const long WS_CHILD = 0x40000000, WS_POPUP = 0x80000000, WS_EX_TOOLWINDOW = 0x80, WS_EX_APPWINDOW = 0x40000;
 internal static IntPtr Find()
 {
  IntPtr host = IntPtr.Zero;
  EnumWindows((window,_) => {
   if(FindWindowEx(window,IntPtr.Zero,"SHELLDLL_DefView",null) != IntPtr.Zero) { host = window; return false; }
   return true;
  },IntPtr.Zero);
  return host;
 }
 internal static bool Attach(IntPtr window,IntPtr host)
 {
  if(host == IntPtr.Zero || !IsWindow(host)) return false;
  var style = GetWindowLongPtr(window,GWL_STYLE).ToInt64();
  SetWindowLongPtr(window,GWL_STYLE,new IntPtr((style & ~WS_POPUP) | WS_CHILD));
  var extended = GetWindowLongPtr(window,GWL_EXSTYLE).ToInt64();
  SetWindowLongPtr(window,GWL_EXSTYLE,new IntPtr((extended | WS_EX_TOOLWINDOW) & ~WS_EX_APPWINDOW));
  SetParent(window,host);
  return GetParent(window) == host;
 }
 internal static bool Alive(IntPtr handle) => handle != IntPtr.Zero && IsWindow(handle);
 internal static bool Attached(IntPtr window,IntPtr host) => Alive(host) && GetParent(window) == host;
 internal static Drawing.Rectangle Bounds(IntPtr window) { GetWindowRect(window,out var r); return Drawing.Rectangle.FromLTRB(r.Left,r.Top,r.Right,r.Bottom); }
 internal static void Place(IntPtr window,IntPtr host,Drawing.Rectangle bounds,bool show)
 {
  var point = new POINT { X=bounds.X,Y=bounds.Y }; ScreenToClient(host,ref point);
  SetWindowPos(window,IntPtr.Zero,point.X,point.Y,bounds.Width,bounds.Height,0x0010|0x0020|(show?0x0040u:0u));
 }
 internal static void Hide(IntPtr window) => ShowWindow(window,0);
 internal static Drawing.Point Cursor() { GetCursorPos(out var p); return new Drawing.Point(p.X,p.Y); }
 internal static double Scale(IntPtr hwnd) => Math.Max(1,GetDpiForWindow(hwnd)/96.0);
 internal static Drawing.Rectangle Clamp(Drawing.Rectangle bounds,double dpiScale=1)
 {
  var screen = Forms.Screen.FromRectangle(bounds).WorkingArea;
  double width=Math.Max(1,bounds.Width),height=Math.Max(1,bounds.Height);
  double availableWidth=Math.Max(1,screen.Width-16), availableHeight=Math.Max(1,screen.Height-16);
  double maximum=Math.Min(availableWidth/width,availableHeight/height);
  double minimum=Math.Max(320*dpiScale/width,240*dpiScale/height);
  double factor=Math.Clamp(1,Math.Min(minimum,maximum),maximum);
  int w=Math.Max(1,(int)Math.Round(width*factor)),h=Math.Max(1,(int)Math.Round(height*factor));
  return new Drawing.Rectangle(Math.Clamp(bounds.X,screen.Left,Math.Max(screen.Left,screen.Right-w)),Math.Clamp(bounds.Y,screen.Top,Math.Max(screen.Top,screen.Bottom-h)),w,h);
 }
 delegate bool EnumProc(IntPtr handle,IntPtr parameter);
 [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left,Top,Right,Bottom; }
 [StructLayout(LayoutKind.Sequential)] struct POINT { public int X,Y; }
 [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback,IntPtr param);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr parent,IntPtr after,string? name,string? title);
 [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
 [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr window);
 [DllImport("user32.dll",SetLastError=true)] static extern IntPtr SetParent(IntPtr window,IntPtr parent);
 [DllImport("user32.dll",EntryPoint="GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr(IntPtr hwnd,int index);
 [DllImport("user32.dll",EntryPoint="SetWindowLongPtrW")] static extern IntPtr SetWindowLongPtr(IntPtr hwnd,int index,IntPtr value);
 [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hwnd,IntPtr after,int x,int y,int width,int height,uint flags);
 [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd,out RECT rect);
 [DllImport("user32.dll")] static extern bool ScreenToClient(IntPtr hwnd,ref POINT p);
 [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
 [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd,int command);
 [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr hwnd);
}
