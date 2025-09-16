//
//  MouseTracker.swift
//  squire
//
//  Created by Anish Karthik on 9/15/25.
//


import SwiftUI
import AppKit

struct MouseTracker: NSViewRepresentable {
    @Binding var mouseLocation: CGPoint

    func makeNSView(context: Context) -> NSView {
        TrackingNSView(mouseLocation: $mouseLocation)
    }

    func updateNSView(_ nsView: NSView, context: Context) {}
}

class TrackingNSView: NSView {
    @Binding var mouseLocation: CGPoint

    init(mouseLocation: Binding<CGPoint>) {
        _mouseLocation = mouseLocation
        super.init(frame: .zero)
        let options: NSTrackingArea.Options = [.mouseMoved, .activeAlways, .inVisibleRect]
        let trackingArea = NSTrackingArea(rect: .zero, options: options, owner: self, userInfo: nil)
        addTrackingArea(trackingArea)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func mouseMoved(with event: NSEvent) {
        mouseLocation = NSEvent.mouseLocation
    }
}
