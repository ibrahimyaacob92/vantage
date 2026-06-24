import AppKit
import Foundation

// projflow menu-bar tile renderer (native CoreText, crisp @2x).
// Usage: barrender <spec.json> <out.png>   — prints the logical width on stdout.
// Spec: { "h":22, "scale":2, "fontSize":6.5, "fg":[1,1,1],
//         "tiles":[ { "code":"COLL", "dots":["#ffd60a","#0a84ff"] }, ... ] }

let args = CommandLine.arguments
guard args.count >= 3,
      let data = FileManager.default.contents(atPath: args[1]),
      let spec = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
else { FileHandle.standardError.write(Data("barrender: bad args\n".utf8)); exit(1) }

let outPath = args[2]
let scale = CGFloat((spec["scale"] as? Double) ?? 2)
let H = CGFloat((spec["h"] as? Double) ?? 22)
let fontSize = CGFloat((spec["fontSize"] as? Double) ?? 6.5)
let pad: CGFloat = 2, gap: CGFloat = 7, step: CGFloat = 5.8, dotR: CGFloat = 2.2
let fgArr0 = (spec["fg"] as? [Double]) ?? [1, 1, 1]
let fgArr = fgArr0.count >= 3 ? fgArr0 : [1, 1, 1]
let fg = NSColor(srgbRed: CGFloat(fgArr[0]), green: CGFloat(fgArr[1]), blue: CGFloat(fgArr[2]), alpha: 1)
let tiles = (spec["tiles"] as? [[String: Any]]) ?? []

let font = NSFont.systemFont(ofSize: fontSize, weight: .medium)
let para = NSMutableParagraphStyle(); para.alignment = .center
let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: fg, .paragraphStyle: para]

func hex(_ s: String) -> NSColor {
  var h = s; if h.hasPrefix("#") { h.removeFirst() }
  func c(_ i: Int) -> CGFloat {
    let start = h.index(h.startIndex, offsetBy: i)
    let end = h.index(start, offsetBy: 2)
    return CGFloat(Int(h[start..<end], radix: 16) ?? 130) / 255
  }
  return h.count >= 6 ? NSColor(srgbRed: c(0), green: c(2), blue: c(4), alpha: 1)
                      : NSColor(srgbRed: 0.55, green: 0.55, blue: 0.58, alpha: 1)
}

struct Tile { let code: String; let dots: [NSColor]; let x: CGFloat; let w: CGFloat }
var layout: [Tile] = []
var x = pad
for t in tiles {
  let code = (t["code"] as? String) ?? "····"
  let dots = ((t["dots"] as? [String]) ?? []).map(hex)
  let codeW = (code as NSString).size(withAttributes: attrs).width
  let dotsW = max(CGFloat(max(dots.count - 1, 0)) * step + 2 * dotR, 2 * dotR)
  let w = max(codeW, dotsW)
  layout.append(Tile(code: code, dots: dots, x: x, w: w))
  x += w + gap
}
let W = max(x - gap + pad, 8)

let pxW = Int((W * scale).rounded()), pxH = Int((H * scale).rounded())
guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pxW, pixelsHigh: pxH,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .calibratedRGB, bytesPerRow: 0, bitsPerPixel: 0) else { exit(1) }
rep.size = NSSize(width: W, height: H)

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
NSGraphicsContext.current?.shouldAntialias = true

for l in layout {
  // top row: code
  let textH = fontSize * 1.4
  let codeRect = NSRect(x: l.x, y: H - textH - 0.5, width: l.w, height: textH)
  (l.code as NSString).draw(in: codeRect, withAttributes: attrs)
  // bottom row: colored dots, centered under the tile
  let n = l.dots.count
  var dx = l.x + l.w / 2 - CGFloat(max(n - 1, 0)) * step / 2
  let cy: CGFloat = 4.6
  for c in l.dots {
    c.setFill()
    NSBezierPath(ovalIn: NSRect(x: dx - dotR, y: cy - dotR, width: 2 * dotR, height: 2 * dotR)).fill()
    dx += step
  }
}
NSGraphicsContext.restoreGraphicsState()

guard let png = rep.representation(using: .png, properties: [:]) else { exit(1) }
do { try png.write(to: URL(fileURLWithPath: outPath)) } catch { exit(1) }
print(Int(W.rounded()))
