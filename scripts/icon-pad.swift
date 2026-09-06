// Usage: swift pad.swift <in.png> <out.png> [canvas=1024] [inner=864]
// Places the input image, scaled to `inner`, centred on a transparent `canvas` square.
import AppKit
let a = CommandLine.arguments
let canvas = a.count > 3 ? Int(a[3])! : 1024
let inner = a.count > 4 ? Int(a[4])! : 864
guard let img = NSImage(contentsOfFile: a[1]) else { print("cannot read \(a[1])"); exit(1) }
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: canvas, pixelsHigh: canvas, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
NSGraphicsContext.current?.imageInterpolation = .high
let off = CGFloat(canvas - inner) / 2
img.draw(in: NSRect(x: off, y: off, width: CGFloat(inner), height: CGFloat(inner)), from: .zero, operation: .sourceOver, fraction: 1)
NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: a[2]))
print("wrote \(a[2]) \(canvas)px, art \(inner)px")
