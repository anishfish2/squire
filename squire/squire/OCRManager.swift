import Foundation
import SwiftUI
import ScreenCaptureKit
import Vision

@MainActor
class OCRManager: NSObject, ObservableObject {
    @Published var recognizedText: [String] = []
    
    private var stream: SCStream?
    private var output: FrameOutput?
    private let processingQueue = DispatchQueue(label: "ScreenOCRQueue", qos: .userInitiated)
    
    /// Capture one frame of the main display and run OCR
    func captureAndRecognize() async {
        do {
            // 1. Get available content
            let availableContent: SCShareableContent
            if #available(macOS 14.0, *) {
                availableContent = try await SCShareableContent.excludingDesktopWindows(
                    false,
                    onScreenWindowsOnly: true,
                )
            } else {
                availableContent = try await SCShareableContent.excludingDesktopWindows(
                    false,
                    onScreenWindowsOnly: true
                )
            }
            
            guard let display = availableContent.displays.first else {
                print("No display found")
                return
            }
            
            // 2. Configure stream
            let config = SCStreamConfiguration()
            config.width = display.width
            config.height = display.height
            config.showsCursor = false
            
            let stream = SCStream(
                filter: SCContentFilter(display: display, excludingWindows: []),
                configuration: config,
                delegate: nil
            )
            self.stream = stream
            var output: FrameOutput?
            
            // 3. Create output that stops after first frame
            output = FrameOutput { [weak self] cgImage in
                guard let self = self else { return }
                
                // Run OCR in background
                self.runOCR(on: cgImage)
                
                // ✅ Remove output before stopping capture
                Task {
                    do {
                        if let o = output {
                                        try stream.removeStreamOutput(o, type: .screen)
                                    }
                        try await stream.stopCapture()
                        self.stream = nil
                        self.output = nil
                    } catch {
                        print("Error stopping stream: \(error)")
                    }
                }
            }
            self.output = output
            
            try stream.addStreamOutput(output!, type: .screen, sampleHandlerQueue: processingQueue)
            
            // 4. Start capture
            try await stream.startCapture()
            
        } catch {
            print("ScreenCaptureKit error: \(error)")
        }
    }
    
    /// Run OCR on a CGImage (background)
    private func runOCR(on cgImage: CGImage) {
        let request = VNRecognizeTextRequest { [weak self] request, error in
            guard error == nil else {
                print("OCR Error: \(error!.localizedDescription)")
                return
            }
            
            let recognized = request.results?
                .compactMap { $0 as? VNRecognizedTextObservation }
                .compactMap { $0.topCandidates(1).first?.string } ?? []
            
            // Push results to UI on main thread
            DispatchQueue.main.async {
                self?.recognizedText = recognized
            }
        }
        
        request.recognitionLevel = .accurate  // change to .accurate if you prefer quality over speed
        request.usesLanguageCorrection = true
        
        processingQueue.async {
            let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
            do {
                try handler.perform([request])
            } catch {
                print("Failed OCR: \(error)")
            }
        }
    }
}

/// Custom SCStreamOutput → delivers one CGImage
class FrameOutput: NSObject, SCStreamOutput {
    private let callback: (CGImage) -> Void
    private let context = CIContext()
    private var didProcessFrame = false
    
    init(callback: @escaping (CGImage) -> Void) {
        self.callback = callback
    }
    
    func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of outputType: SCStreamOutputType
    ) {
        guard !didProcessFrame, let imageBuffer = sampleBuffer.imageBuffer else { return }
        didProcessFrame = true
        
        // Convert pixel buffer → CGImage
        let ciImage = CIImage(cvPixelBuffer: imageBuffer)
        if let cgImage = context.createCGImage(ciImage, from: ciImage.extent) {
            callback(cgImage)
        }
    }
}
