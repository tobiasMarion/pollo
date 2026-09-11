import CoreGraphics
import ImageIO
import UniformTypeIdentifiers
import Foundation

// Reproducible, opaque app icon matching the web favicon. Run from apps/mobile.
let size = 1024
let context = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8,
    bytesPerRow: size * 4, space: CGColorSpaceCreateDeviceRGB(),
    bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
context.setFillColor(CGColor(gray: 0, alpha: 1))
context.fill(CGRect(x: 0, y: 0, width: size, height: size))
context.setFillColor(CGColor(red: 245 / 255, green: 242 / 255, blue: 252 / 255, alpha: 1))
context.fillEllipse(in: CGRect(x: 368, y: 368, width: 288, height: 288))
let destination = CGImageDestinationCreateWithURL(
    URL(fileURLWithPath: "Apple/PolloApp/Assets.xcassets/AppIcon.appiconset/icon.png") as CFURL,
    UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(destination, context.makeImage()!, nil)
precondition(CGImageDestinationFinalize(destination))
