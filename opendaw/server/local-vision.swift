import Foundation
import ImageIO
import Vision

struct Label: Encodable {
    let label: String
    let confidence: Float
}
enum InputError: Error {case invalidImage, invalidBatch}

func classify(_ encoded: String) throws -> [Label] {
    guard encoded.count <= 2_000_000,
          let data = Data(base64Encoded: encoded),
          let source = CGImageSourceCreateWithData(data as CFData, nil),
          CGImageSourceGetType(source) as String? == "public.jpeg" else {throw InputError.invalidImage}
    let options: [CFString: Any] = [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: 512
    ]
    guard let frame = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {throw InputError.invalidImage}
    let request = VNClassifyImageRequest()
    let handler = VNImageRequestHandler(cgImage: frame)
    try handler.perform([request])
    var labels = (request.results ?? [])
        .filter { $0.confidence >= 0.25 && $0.hasMinimumPrecision(0.6, forRecall: 0.25) }
        .prefix(5)
        .map { Label(label: $0.identifier, confidence: $0.confidence) }
    let people = VNDetectHumanRectanglesRequest()
    people.upperBodyOnly = false
    if (try? handler.perform([people])) != nil,
       let strongest = people.results?.map({ $0.confidence }).max(), strongest >= 0.65 {
        labels.append(Label(label: "person", confidence: strongest))
    }
    return Array(labels.sorted(by: { $0.confidence > $1.confidence }).prefix(6))
}

do {
    let frames = try JSONDecoder().decode([String].self, from: FileHandle.standardInput.readDataToEndOfFile())
    guard !frames.isEmpty && frames.count <= 16 else {throw InputError.invalidBatch}
    var result: [[Label]] = []
    for frame in frames {result.append(try autoreleasepool {try classify(frame)})}
    FileHandle.standardOutput.write(try JSONEncoder().encode(result))
} catch {
    FileHandle.standardError.write(Data("Local image classification failed: \(error)\n".utf8))
    exit(1)
}
