# make-icon.ps1 — turns the raw logo JPG into a square app icon PNG.
# Mode "transparent": keys out the light-gray background + soft shadow, keeps the 3D "P".
# Mode "tile": simple square crop that keeps the original background.
param(
  [Parameter(Mandatory=$true)][string]$Source,
  [Parameter(Mandatory=$true)][string]$Out,
  [ValidateSet("transparent","tile")][string]$Mode = "transparent",
  [int]$Size = 1024
)

Add-Type -AssemblyName System.Drawing

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;

public static class IconMaker {
  // Background color estimated from the four corners.
  static Color EstimateBackground(Bitmap src) {
    int r=0,g=0,b=0,n=0;
    int[] xs = {2, src.Width-3}; int[] ys = {2, src.Height-3};
    foreach (int x in xs) foreach (int y in ys) {
      for (int dx=-2; dx<=2; dx++) for (int dy=-2; dy<=2; dy++) {
        Color c = src.GetPixel(Math.Max(0,Math.Min(src.Width-1,x+dx)), Math.Max(0,Math.Min(src.Height-1,y+dy)));
        r+=c.R; g+=c.G; b+=c.B; n++;
      }
    }
    return Color.FromArgb(255, r/n, g/n, b/n);
  }

  static byte[] ToBytes(Bitmap bmp, ImageLockMode mode, out BitmapData data) {
    data = bmp.LockBits(new Rectangle(0,0,bmp.Width,bmp.Height), mode, PixelFormat.Format32bppArgb);
    byte[] buf = new byte[bmp.Width*bmp.Height*4];
    Marshal.Copy(data.Scan0, buf, 0, buf.Length);
    return buf;
  }

  static void FromBytes(Bitmap bmp, byte[] buf, BitmapData data) {
    Marshal.Copy(buf, 0, data.Scan0, buf.Length);
    bmp.UnlockBits(data);
  }

  // Per-pixel alpha keying + soft-shadow removal, then square crop & resize.
  public static Bitmap MakeTransparent(Bitmap src) {
    Color bg = EstimateBackground(src);
    double bgLum = 0.299*bg.R + 0.587*bg.G + 0.114*bg.B;
    int w = src.Width, h = src.Height;

    BitmapData sd;
    byte[] sbuf = ToBytes(src, ImageLockMode.ReadOnly, out sd);
    src.UnlockBits(sd);
    byte[] dbuf = new byte[sbuf.Length]; // keyed output, same BGRA layout

    for (int i = 0; i < w*h; i++) {
      byte b = sbuf[i*4], g = sbuf[i*4+1], r = sbuf[i*4+2]; // BGRA layout
      double d = Math.Sqrt((r-bg.R)*(r-bg.R) + (g-bg.G)*(g-bg.G) + (b-bg.B)*(b-bg.B));
      int mx = Math.Max(r, Math.Max(g,b)), mn = Math.Min(r, Math.Min(g,b));
      double sat = mx == 0 ? 0 : (mx-mn)/(double)mx;
      double lum = 0.299*r + 0.587*g + 0.114*b;
      double a = (d - 8) / 40.0; if (a < 0) a = 0; if (a > 1) a = 1;
      // The soft drop shadow is darker than the bg and desaturated -> fade it out.
      if (lum < bgLum - 2 && sat < 0.14 && d < 50) {
        double f = (d - 26) / 20.0; if (f < 0) f = 0; if (f > 1) f = 1;
        a *= f;
      }
      dbuf[i*4]   = b;
      dbuf[i*4+1] = g;
      dbuf[i*4+2] = r;
      dbuf[i*4+3] = (byte)(a*255);
    }

    Bitmap keyed = new Bitmap(w, h, PixelFormat.Format32bppArgb);
    BitmapData kd;
    byte[] kb = ToBytes(keyed, ImageLockMode.WriteOnly, out kd);
    Buffer.BlockCopy(dbuf, 0, kb, 0, dbuf.Length);
    FromBytes(keyed, kb, kd);

    // Trim to the visible logo bounding box (alpha > 32).
    int minX=w, minY=h, maxX=-1, maxY=-1;
    for (int y=0; y<h; y++) for (int x=0; x<w; x++) {
      if (dbuf[(y*w+x)*4+3] > 32) {
        if (x<minX) minX=x; if (x>maxX) maxX=x;
        if (y<minY) minY=y; if (y>maxY) maxY=y;
      }
    }
    if (maxX < 0) throw new Exception("Nothing detected above the background.");

    // Square crop with ~10% padding, logo centered.
    int bw = maxX-minX+1, bh = maxY-minY+1;
    int side = (int)Math.Max(bw, bh) * 10 / 8;
    int cx = (minX+maxX)/2, cy = (minY+maxY)/2;
    int x0 = cx - side/2, y0 = cy - side/2;

    Bitmap square = new Bitmap(side, side, PixelFormat.Format32bppArgb);
    using (Graphics gr = Graphics.FromImage(square)) {
      gr.Clear(Color.Transparent);
      gr.InterpolationMode = InterpolationMode.HighQualityBicubic;
      gr.DrawImage(keyed, new Rectangle(0,0,side,side), x0, y0, side, side, GraphicsUnit.Pixel);
    }
    keyed.Dispose();
    return square;
  }

  // Square crop that keeps the original light background.
  public static Bitmap MakeTile(Bitmap src) {
    int w = src.Width, h = src.Height;
    Color bg = EstimateBackground(src);
    int side = Math.Min(w, h);
    Bitmap square = new Bitmap(side, side, PixelFormat.Format32bppArgb);
    using (Graphics gr = Graphics.FromImage(square)) {
      gr.Clear(bg);
      gr.InterpolationMode = InterpolationMode.HighQualityBicubic;
      gr.DrawImage(src, new Rectangle(0,0,side,side), (w-side)/2, 0, side, side, GraphicsUnit.Pixel);
    }
    return square;
  }

  public static void SavePng(Bitmap bmp, string path, int size) {
    Bitmap scaled = new Bitmap(size, size, PixelFormat.Format32bppArgb);
    using (Graphics gr = Graphics.FromImage(scaled)) {
      gr.InterpolationMode = InterpolationMode.HighQualityBicubic;
      gr.SmoothingMode = SmoothingMode.HighQuality;
      gr.PixelOffsetMode = PixelOffsetMode.HighQuality;
      gr.DrawImage(bmp, new Rectangle(0,0,size,size), 0, 0, bmp.Width, bmp.Height, GraphicsUnit.Pixel);
    }
    scaled.Save(path, ImageFormat.Png);
    scaled.Dispose();
  }
}
"@

$src = [System.Drawing.Bitmap]::FromFile($Source)
try {
  if ($Mode -eq "transparent") { $master = [IconMaker]::MakeTransparent($src) }
  else { $master = [IconMaker]::MakeTile($src) }
  [IconMaker]::SavePng($master, $Out, $Size)
  Write-Output "OK -> $Out ($Size x $Size, mode=$Mode)"
} finally {
  $src.Dispose()
}
