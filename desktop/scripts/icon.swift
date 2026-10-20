// Build the app's vector monogram into a native macOS icon container.
import AppKit
let directory = CommandLine.arguments[1]
try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
for (name, size) in [("icon_512x512.png", 512), ("icon_512x512@2x.png", 1024)] {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    let context = NSGraphicsContext(bitmapImageRep: bitmap)!
    NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = context
    let n = CGFloat(size)
    NSColor(calibratedRed: 0.10, green: 0.14, blue: 0.09, alpha: 1).setFill()
    NSBezierPath(roundedRect: NSRect(x:n*0.035,y:n*0.035,width:n*0.93,height:n*0.93), xRadius:n*0.2,yRadius:n*0.2).fill()
    let attrs:[NSAttributedString.Key:Any] = [.font:NSFont.systemFont(ofSize:n*0.70,weight:.black),.foregroundColor:NSColor(calibratedRed:0.88,green:0.92,blue:0.76,alpha:1)]
    let text = NSAttributedString(string:"B",attributes:attrs)
    let measured = text.size(); text.draw(at:NSPoint(x:(n-measured.width)/2,y:(n-measured.height)/2+n*0.015))
    NSColor(calibratedRed:0.95,green:0.69,blue:0.29,alpha:1).setFill()
    let beam=NSBezierPath();beam.move(to:NSPoint(x:n*0.63,y:n*0.17));beam.line(to:NSPoint(x:n*0.84,y:n*0.17));beam.line(to:NSPoint(x:n*0.735,y:n*0.39));beam.close();beam.fill()
    NSGraphicsContext.restoreGraphicsState()
    try bitmap.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:directory).appendingPathComponent(name))
}
