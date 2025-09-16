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
        WindowGroup {
            ContentView()
                .background(Color.black)
                .cornerRadius(8)
                .shadow(radius: 8)
                .fixedSize() // auto-size to fit OCR text
        }
        .windowStyle(.hiddenTitleBar)
        .windowResizability(.contentSize) // resize = content-driven
    }
}

class AppDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow?

    func applicationDidFinishLaunching(_ notification: Notification) {
        DispatchQueue.main.async {
            if let window = NSApp.windows.first {
                self.window = window
                self.setupOverlayWindow(window)
            }
        }
    }

    private func setupOverlayWindow(_ window: NSWindow) {
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = true

        // Borderless style (no traffic lights)
        window.styleMask = [.borderless]

        // Allow dragging by clicking anywhere in the background
        window.isMovableByWindowBackground = true
        
        // Float above other windows
        window.level = .floating
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]

        if let screen = NSScreen.main {
            let boxWidth: CGFloat = 200
            let boxHeight: CGFloat = 120
            let startFrame = NSRect(
                x: screen.frame.midX - boxWidth/2,
                y: screen.frame.midY - boxHeight/2,
                width: boxWidth,
                height: boxHeight
            )
            window.setFrame(startFrame, display: true)
        }
    }


}
