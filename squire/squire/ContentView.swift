import SwiftUI

struct ContentView: View {
    @StateObject private var ocr = OCRManager() // SwiftUI owns the lifecycle
    @StateObject private var tracker = ActiveAppTracker()

    var body: some View {
        VStack(spacing: 12) {
                    Text("Active App:")
                        .font(.headline)
                        .foregroundColor(.white)

                    Text(tracker.currentAppName)
                        .font(.title2)
                        .bold()
                        .foregroundColor(.green)
                        .padding(.horizontal)

                    if !tracker.currentWindowTitle.isEmpty {
                        Text("Window:")
                            .font(.caption)
                            .foregroundColor(.gray)

                        Text(tracker.currentWindowTitle)
                            .font(.caption)
                            .foregroundColor(.yellow)
                            .padding(.horizontal)
                            .multilineTextAlignment(.center)
                    }
                }
                .frame(width: 200, height: 160)
                .background(Color.black)
                .cornerRadius(10)
            
        VStack(alignment: .leading, spacing: 8) {
            // OCR trigger button
            Button("Run OCR on Screen") {
                Task { await ocr.captureAndRecognize() }
            }
            .padding(.bottom, 6)
            .buttonStyle(.borderedProminent)
            
            // OCR results
            if ocr.recognizedText.isEmpty {
                Text("No text yet")
                    .foregroundColor(.gray)
                    .padding(4)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(Array(ocr.recognizedText.enumerated()), id: \.offset) { _, line in
                            Text(line)
                                .foregroundColor(.white)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
                .frame(maxHeight: 400) // prevents runaway growth
            }
        }
        .padding(12)
        .background(Color.black)
        .cornerRadius(10)
        .shadow(radius: 8)
        .fixedSize(horizontal: false, vertical: true) // auto-expand with OCR text
    }
}

#Preview {
    ContentView()
        .padding()
        .previewLayout(.sizeThatFits)
}
