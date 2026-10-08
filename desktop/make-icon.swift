// Draws the Keystone app icon (1024×1024 PNG): the brand mark of the design — the Phosphor "polygon" glyph
// (four nodes joined by edges) outlined in the Nocturne accent, glowing on the dark ground. Same family as Codex.
// Usage: make-icon out.png
import AppKit

let size: CGFloat = 1024
let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "icon.png"
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size), pixelsHigh: Int(size), bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
let ctx = NSGraphicsContext.current!.cgContext

func rgb(_ hex: Int, _ a: CGFloat = 1) -> CGColor {
  CGColor(red: CGFloat((hex >> 16) & 255) / 255, green: CGFloat((hex >> 8) & 255) / 255, blue: CGFloat(hex & 255) / 255, alpha: a)
}

// macOS icon grid: 824×824 rounded square centred in 1024.
let tile = CGRect(x: 100, y: 100, width: 824, height: 824)
let tilePath = CGPath(roundedRect: tile, cornerWidth: 185, cornerHeight: 185, transform: nil)
ctx.saveGState()
ctx.setShadow(offset: CGSize(width: 0, height: -12), blur: 28, color: rgb(0x000000, 0.45))
ctx.addPath(tilePath); ctx.setFillColor(rgb(0x161826)); ctx.fillPath()
ctx.restoreGState()
ctx.saveGState()
ctx.addPath(tilePath); ctx.clip()
let ground = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: [rgb(0x2b2741), rgb(0x161826)] as CFArray, locations: [0, 1])!
ctx.drawRadialGradient(ground, startCenter: CGPoint(x: 700, y: 900), startRadius: 0, endCenter: CGPoint(x: 700, y: 900), endRadius: 820, options: [.drawsAfterEndLocation])
ctx.restoreGState()
ctx.addPath(tilePath); ctx.setStrokeColor(rgb(0xe9e9ed, 0.10)); ctx.setLineWidth(3); ctx.strokePath()

// Phosphor "polygon" (256-unit grid): nodes at (120,48), (40,120), (160,208), (208,72), radius 16; edges A–B–C–D–A
// drawn between the node rims. Scaled to fit the tile, y flipped.
let unit: CGFloat = 2.6
let nodes: [CGPoint] = [CGPoint(x: 120, y: 48), CGPoint(x: 40, y: 120), CGPoint(x: 160, y: 208), CGPoint(x: 208, y: 72)]
let minX = nodes.map(\.x).min()! - 16, maxX = nodes.map(\.x).max()! + 16
let minY = nodes.map(\.y).min()! - 16, maxY = nodes.map(\.y).max()! + 16
let ox = 512 - (minX + maxX) / 2 * unit, oy = 512 + (minY + maxY) / 2 * unit
func p(_ q: CGPoint) -> CGPoint { CGPoint(x: ox + q.x * unit, y: oy - q.y * unit) }
let r: CGFloat = 16 * unit
let glyph = CGMutablePath()
for n in nodes { glyph.addEllipse(in: CGRect(x: p(n).x - r, y: p(n).y - r, width: 2 * r, height: 2 * r)) }
for i in 0..<nodes.count {
  let a = p(nodes[i]), b = p(nodes[(i + 1) % nodes.count])
  let dx = b.x - a.x, dy = b.y - a.y, len = (dx * dx + dy * dy).squareRoot()
  let ux = dx / len, uy = dy / len
  glyph.move(to: CGPoint(x: a.x + ux * r, y: a.y + uy * r))
  glyph.addLine(to: CGPoint(x: b.x - ux * r, y: b.y - uy * r))
}
let width: CGFloat = 16 * unit
ctx.setLineCap(.round); ctx.setLineJoin(.round)
ctx.saveGState()
ctx.setShadow(offset: .zero, blur: 70, color: rgb(0x9184d9, 0.8))
ctx.addPath(glyph); ctx.setStrokeColor(rgb(0x9184d9)); ctx.setLineWidth(width); ctx.strokePath()
ctx.restoreGState()
ctx.addPath(glyph); ctx.setStrokeColor(rgb(0xb5abfc)); ctx.setLineWidth(width); ctx.strokePath()

NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
