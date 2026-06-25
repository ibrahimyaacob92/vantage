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
let pad: CGFloat = 2, gap: CGFloat = 7
let step: CGFloat = 4.6       // horizontal dot spacing
let rowGap: CGFloat = 2.6     // vertical gap between dot rows
let dotR: CGFloat = 1.7
let gapCD: CGFloat = 1.6      // gap between the code and the dot grid
let maxCols = 4, maxDots = 8  // dots wrap into a 4-col grid, up to 2 rows
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
var maxRows = 1
for t in tiles {
  let code = (t["code"] as? String) ?? "····"
  let dots = Array(((t["dots"] as? [String]) ?? []).map(hex).prefix(maxDots))
  let n = dots.count
  let cols = min(max(n, 1), maxCols)
  let rows = max(1, (n + maxCols - 1) / maxCols)
  maxRows = max(maxRows, rows)
  let codeW = (code as NSString).size(withAttributes: attrs).width
  let gridW = CGFloat(cols - 1) * step + 2 * dotR
  let w = max(codeW, gridW)
  layout.append(Tile(code: code, dots: dots, x: x, w: w))
  x += w + gap
}
let W = max(x - gap + pad, 8)

// Vertically centre the (code + dot grid) block, using a consistent height
// (based on the max rows present) so codes line up across tiles.
let blockH = fontSize + gapCD + (CGFloat(maxRows) * 2 * dotR + CGFloat(maxRows - 1) * rowGap)
let topMargin = (H - blockH) / 2
let codeTopY = H - topMargin            // Cocoa Y of the top of the code
let dotsTopY = codeTopY - fontSize - gapCD

let pxW = Int((W * scale).rounded()), pxH = Int((H * scale).rounded())
guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pxW, pixelsHigh: pxH,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .calibratedRGB, bytesPerRow: 0, bitsPerPixel: 0) else { exit(1) }
rep.size = NSSize(width: W, height: H)

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
NSGraphicsContext.current?.shouldAntialias = true

for l in layout {
  // code, top-aligned to the centred block
  let textH = fontSize * 1.4
  let codeRect = NSRect(x: l.x, y: codeTopY - textH, width: l.w, height: textH)
  (l.code as NSString).draw(in: codeRect, withAttributes: attrs)
  // dots in a 4-column grid (up to 2 rows), each row centred under the tile
  let n = l.dots.count
  let cx0 = l.x + l.w / 2
  for (i, c) in l.dots.enumerated() {
    let row = i / maxCols
    let col = i % maxCols
    let rowCount = min(maxCols, n - row * maxCols)
    let startX = cx0 - CGFloat(rowCount - 1) * step / 2
    let dx = startX + CGFloat(col) * step
    let cy = dotsTopY - dotR - CGFloat(row) * (2 * dotR + rowGap)
    c.setFill()
    NSBezierPath(ovalIn: NSRect(x: dx - dotR, y: cy - dotR, width: 2 * dotR, height: 2 * dotR)).fill()
  }
}
NSGraphicsContext.restoreGraphicsState()

guard let png = rep.representation(using: .png, properties: [:]) else { exit(1) }
do { try png.write(to: URL(fileURLWithPath: outPath)) } catch { exit(1) }
print(Int(W.rounded()))
