import SwiftUI

struct ContentView: View {
    @StateObject private var ocr = OCRManager() // SwiftUI owns the lifecycle
    
    var body: some View {
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
