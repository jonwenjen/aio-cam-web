// Numeric HDR check: decode each file with Apple's own pipeline (CoreImage, expandToHDR) and report
// how far highlights go above SDR white (1.0 in extended-linear Display P3).
import Foundation
import CoreImage

let cs = CGColorSpace(name: CGColorSpace.extendedLinearDisplayP3)!
let ctx = CIContext(options: [.workingFormat: CIFormat.RGBAh, .workingColorSpace: cs])

func stats(_ img: CIImage) -> (max: Float, p999: Float, over1: Double, size: CGSize) {
    let ext = img.extent
    let s = min(1.0, 768.0 / max(ext.width, ext.height))
    let small = img.applyingFilter("CILanczosScaleTransform", parameters: ["inputScale": s, "inputAspectRatio": 1.0])
    let r = small.extent.integral
    let w = Int(r.width), h = Int(r.height)
    var buf = [Float](repeating: 0, count: w * h * 4)
    ctx.render(small, toBitmap: &buf, rowBytes: w * 16, bounds: r, format: .RGBAf, colorSpace: cs)
    var lum = [Float](); lum.reserveCapacity(w * h)
    for i in stride(from: 0, to: buf.count, by: 4) { lum.append(0.2290 * buf[i] + 0.6917 * buf[i + 1] + 0.0793 * buf[i + 2]) }
    let sorted = lum.sorted()
    let over = Double(lum.filter { $0 > 1.02 }.count) / Double(lum.count)
    return (sorted.last ?? 0, sorted[Int(Double(sorted.count - 1) * 0.999)], over, ext.size)
}

for path in CommandLine.arguments.dropFirst() {
    let url = URL(fileURLWithPath: path)
    guard let sdr = CIImage(contentsOf: url, options: [.applyOrientationProperty: true]) else { print(path, "cannot decode"); continue }
    let hdr = CIImage(contentsOf: url, options: [.expandToHDR: true, .applyOrientationProperty: true]) ?? sdr
    let a = stats(sdr), b = stats(hdr)
    print(String(format: "%@ | %.0fx%.0f | SDR max %.2f | HDR max %.2f  p99.9 %.2f  pixels>1.0: %.1f%%  => %@",
                 (path as NSString).lastPathComponent, b.size.width, b.size.height, a.max, b.max, b.p999, b.over1 * 100,
                 b.max > 1.05 ? "HDR" : "SDR only"))
}
