import SwiftUI

struct ContentView: View {
    @StateObject private var ocr = OCRManager()
    @StateObject private var tracker: ActiveAppTracker
    
    @State private var showTextBox = false
    @State private var idleWorkItem: DispatchWorkItem?
    @State private var isHovered = false
    
    // Hardcode position for now (can be dynamic later)
    private let dotPosition: DotPosition = .topRight
    
    init() {
        let ocrManager = OCRManager()
        _ocr = StateObject(wrappedValue: ocrManager)
        _tracker = StateObject(wrappedValue: ActiveAppTracker(ocr: ocrManager))
    }
    
    var body: some View {
        ZStack(alignment: alignment(for: dotPosition)) {
            if showTextBox, !ocr.recognizedText.isEmpty {
                textBox
                    .transition(transition(for: dotPosition))
            } else {
                dot
                    .transition(.scale.combined(with: .opacity))
            }
        }
        .animation(.easeInOut(duration: 0.25), value: showTextBox)
        .onChange(of: ocr.recognizedText) { _, newText in
            handleOCRChange(newText)
        }
    }
    
    // MARK: - Dot and Text Box
    
    private var dot: some View {
        Circle()
            .fill(Color.black)
            .frame(width: 40, height: 40)
            .shadow(radius: 4)
    }
    
    private var textBox: some View {
        ScrollView(.vertical, showsIndicators: true) {
            VStack(alignment: .leading, spacing: 4) {
                ForEach(Array(ocr.recognizedText.enumerated()), id: \.offset) { _, line in
                    Text(line)
                        .foregroundColor(.white)
                        .lineLimit(nil) // wrap text
                        .multilineTextAlignment(.leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.bottom, 2)
                }
            }
            .padding(8)
        }
        .frame(
            minWidth: 180,
            idealWidth: 240,
            maxWidth: 280,
            minHeight: 60,
            idealHeight: 100,
            maxHeight: 140
        )
        .background(Color.black)
        .cornerRadius(10)
        .shadow(radius: 8)
        .clipped()
        // Interaction resets the idle timer
        .onHover { inside in
            isHovered = inside
            if inside { resetIdleTimer() }
        }
        .onTapGesture { resetIdleTimer() }
        .simultaneousGesture(
            DragGesture().onChanged { _ in resetIdleTimer() }
        )
    }
    
    // MARK: - Position helpers
    
    private func alignment(for pos: DotPosition) -> Alignment {
        switch pos {
        case .topRight: return .topTrailing
        case .bottomRight: return .bottomTrailing
        case .topLeft: return .topLeading
        case .bottomLeft: return .bottomLeading
        }
    }
    
    private func transition(for pos: DotPosition) -> AnyTransition {
        switch pos {
        case .topRight: return .move(edge: .leading).combined(with: .move(edge: .bottom)).combined(with: .opacity)
        case .bottomRight: return .move(edge: .leading).combined(with: .move(edge: .top)).combined(with: .opacity)
        case .topLeft: return .move(edge: .trailing).combined(with: .move(edge: .bottom)).combined(with: .opacity)
        case .bottomLeft: return .move(edge: .trailing).combined(with: .move(edge: .top)).combined(with: .opacity)
        }
    }
    
    enum DotPosition {
        case topRight, bottomRight, topLeft, bottomLeft
    }
    
    // MARK: - OCR + idle timer
    
    private func handleOCRChange(_ text: [String]) {
        idleWorkItem?.cancel()
        
        guard !text.isEmpty else {
            withAnimation { showTextBox = false }
            return
        }
        
        // Expand immediately
        withAnimation { showTextBox = true }
        
        // Start idle timer
        startIdleTimer()
    }
    
    private func startIdleTimer() {
        idleWorkItem?.cancel()
        let work = DispatchWorkItem {
            if !isHovered {
                withAnimation {
                    showTextBox = false
                }
            }
        }
        idleWorkItem = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 5.0, execute: work)
    }
    
    private func resetIdleTimer() {
        startIdleTimer()
    }
}
