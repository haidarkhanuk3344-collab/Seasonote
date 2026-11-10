using System.Drawing;
using Seasonote;
void Check(string name,Rectangle input,double dpi,Rectangle expected) { var actual=DesktopHost.Clamp(input,dpi);if(actual!=expected)throw new Exception($"{name}: {actual} != {expected}");Console.WriteLine("PASS "+name); }
Check("unchanged fitting frame",new(120,120,640,510),1,new(120,120,640,510));
Check("100% minimum preserves ratio",new(20,20,100,80),1,new(20,20,320,256));
Check("200% minimum preserves ratio",new(20,20,100,80),2,new(20,20,640,512));
Check("200% initial 640 DIP",new(240,40,1280,1020),2,new(240,40,1280,1020));
Check("right/bottom clipping",new(1800,1000,640,510),1,new(1280,570,640,510));
System.Windows.Forms.Screen.WorkArea=new Rectangle(-1920,0,1920,1080);
Check("negative-coordinate monitor",new(-1800,120,640,510),1,new(-1800,120,640,510));
System.Windows.Forms.Screen.WorkArea=new Rectangle(0,0,300,200);
Check("small screen outranks minimum",new(0,0,640,510),2,new(0,0,231,184));
namespace System.Windows.Forms { public class Screen { public static Rectangle WorkArea=new(0,0,1920,1080); public Rectangle WorkingArea=>WorkArea; public static Screen FromRectangle(Rectangle _)=>new(); } }
