//
//  squireApp.swift
//  squire
//
//  Created by Anish Karthik on 9/8/25.
//

import SwiftUI
import AppKit

@main
struct squireApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        // We don’t use WindowGroup for the overlay anymore.
        // The AppDelegate creates the floating panel manually.
        Settings {
            EmptyView() // no default settings window
        }
    }
}

// MARK: - Non-activating Overlay Panel

class OverlayPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

// MARK: - AppDelegate sets up overlay

class AppDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow?

    func applicationDidFinishLaunching(_ notification: Notification) {
        setupOverlayWindow()
    }

    private func setupOverlayWindow() {
        guard let screen = NSScreen.main else { return }

        let barWidth: CGFloat = 120
        let barFrame = NSRect(
            x: screen.visibleFrame.maxX - barWidth,
            y: screen.visibleFrame.minY,
            width: barWidth,
            height: screen.visibleFrame.height
        )

        let panel = OverlayPanel(
            contentRect: barFrame,
            styleMask: [.nonactivatingPanel, .hudWindow],
            backing: .buffered,
            defer: false
        )

        panel.isFloatingPanel = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hidesOnDeactivate = false
        panel.hasShadow = true

        panel.contentView = NSHostingView(rootView: ContentView())

        // Important: don’t make it key
        panel.orderFrontRegardless()
        self.window = panel
    }
}
