import Foundation
import ImageIO

for path in CommandLine.arguments.dropFirst() {
    guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil) else { print(path, "NO SOURCE"); continue }
    let count = CGImageSourceGetCount(src)
    let apple = CGImageSourceCopyAuxiliaryDataInfoAtIndex(src, 0, kCGImageAuxiliaryDataTypeHDRGainMap) as? [String: Any]
    var iso: [String: Any]? = nil
    if #available(macOS 15.0, *) { iso = CGImageSourceCopyAuxiliaryDataInfoAtIndex(src, 0, kCGImageAuxiliaryDataTypeISOGainMap) as? [String: Any] }
    let desc = apple?[kCGImageAuxiliaryDataInfoDataDescription as String] as? [String: Any]
    let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [String: Any]
    let maker = props?[kCGImagePropertyMakerAppleDictionary as String] as? [String: Any]
    print(path, "| images:", count, "| appleGainMap:", apple != nil, desc.map { "\($0["Width"] ?? "?")x\($0["Height"] ?? "?")" } ?? "-",
          "| isoGainMap:", iso != nil, "| makerApple keys 33/48:", maker?["33"] ?? "-", maker?["48"] ?? "-",
          "| profile:", props?[kCGImagePropertyProfileName as String] ?? "-")
}
