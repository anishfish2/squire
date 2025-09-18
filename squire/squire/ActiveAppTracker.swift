import SwiftUI
import AppKit
import ApplicationServices

class ActiveAppTracker: ObservableObject {
    @Published var currentAppName: String = "No active app"
    @Published var currentWindowTitle: String = ""
    private let myBundleId = Bundle.main.bundleIdentifier
    private var eventMonitor: Any?
    private var localEventMonitor: Any?
    private var pendingWorkItem: DispatchWorkItem?
    private var ocr: OCRManager

    init(ocr : OCRManager) {
        self.ocr = ocr
        updateCurrentApp()
        startTracking()
        startGlobalEventMonitoring()
    }
    

    private func updateCurrentApp() {
         let workspace = NSWorkspace.shared
         var frontmostApp: NSRunningApplication?

         if let app = workspace.frontmostApplication,
            app.bundleIdentifier != myBundleId,
            app.activationPolicy == .regular {
             frontmostApp = app
         }

         if frontmostApp == nil {
             let sortedApps = workspace.runningApplications
                 .filter { $0.bundleIdentifier != myBundleId && $0.activationPolicy == .regular }
                 .sorted { $0.processIdentifier > $1.processIdentifier }
             frontmostApp = sortedApps.first { !$0.isHidden }
         }

         if let app = frontmostApp {
             let newName = app.localizedName ?? "Unknown App"
             if newName != currentAppName {
                 currentAppName = newName
                 print("DEBUG: App switched to: \(currentAppName)")
                 // schedule OCR after 0.5s
                 scheduleOCR(for: newName)
             }
             updateWindowTitle(for: app)
         } else {
             if currentAppName != "No active app" {
                 currentAppName = "No active app"
                 currentWindowTitle = ""
                 print("DEBUG: No active app found")
             }
         }
     }
    
    private func scheduleOCR(for appName: String) {
            pendingWorkItem?.cancel()
            let work = DispatchWorkItem { [weak self] in
                guard let self = self else { return }
                if self.currentAppName == appName {
                    Task { await self.ocr.captureAndRecognize() }
                }
            }
            pendingWorkItem = work
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: work)
        }

    private func updateWindowTitle(for app: NSRunningApplication) {
        // Check if we have accessibility permissions first, and prompt if not
        if !AXIsProcessTrusted() {
            // This will show the permission dialog
            let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true]
            let accessEnabled = AXIsProcessTrustedWithOptions(options as CFDictionary)

            if !accessEnabled {
                if currentWindowTitle != "(Accessibility permission needed)" {
                    currentWindowTitle = "(Accessibility permission needed)"
                    print("DEBUG: Please grant accessibility permissions in System Preferences")
                }
                return
            }
        }

        // Try CGWindowListCopyWindowInfo for a more reliable approach
        let windowListInfo = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]]

        // Look for windows belonging to this app that are on screen
        let appWindows = windowListInfo?.filter { windowInfo in
            guard let windowPID = windowInfo[kCGWindowOwnerPID as String] as? Int32 else { return false }
            return windowPID == app.processIdentifier
        }

        // Get the frontmost window (highest layer) for this app
        let frontmostWindow = appWindows?.max { window1, window2 in
            let layer1 = window1[kCGWindowLayer as String] as? Int ?? 0
            let layer2 = window2[kCGWindowLayer as String] as? Int ?? 0
            return layer1 < layer2
        }

        if let window = frontmostWindow,
           let title = window[kCGWindowName as String] as? String {
            let newTitle = title.isEmpty ? "(No Title)" : title
            if newTitle != currentWindowTitle {
                currentWindowTitle = newTitle
                print("DEBUG: Window title: \(currentWindowTitle)")
            }
        } else {
            // Fallback to Accessibility API
            updateWindowTitleUsingAX(for: app)
        }
    }

    private func updateWindowTitleUsingAX(for app: NSRunningApplication) {
        guard let pid = app.processIdentifier as pid_t? else { return }

        let appElement = AXUIElementCreateApplication(pid)
        var windows: CFTypeRef?

        // Get all windows for the app
        let windowsResult = AXUIElementCopyAttributeValue(appElement, kAXWindowsAttribute as CFString, &windows)

        if windowsResult == .success,
           let windowArray = windows as? [AXUIElement],
           let firstWindow = windowArray.first {

            var windowTitle: CFTypeRef?
            let titleResult = AXUIElementCopyAttributeValue(firstWindow, kAXTitleAttribute as CFString, &windowTitle)

            if titleResult == .success, let title = windowTitle as? String {
                let newTitle = title.isEmpty ? "(No Title)" : title
                if newTitle != currentWindowTitle {
                    currentWindowTitle = newTitle
                    print("DEBUG: Window title (AX): \(currentWindowTitle)")
                }
            } else {
                if currentWindowTitle != "(Unable to read title)" {
                    currentWindowTitle = "(Unable to read title)"
                }
            }
        } else {
            if currentWindowTitle != "(No windows found)" {
                currentWindowTitle = "(No windows found)"
            }
        }
    }

    private func startTracking() {
        // Primary notification-based tracking
        NotificationCenter.default.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            print("DEBUG: ✓ App activation notification")
            DispatchQueue.main.async {
                self?.updateCurrentApp()
            }
        }

        NotificationCenter.default.addObserver(
            forName: NSWorkspace.didDeactivateApplicationNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            print("DEBUG: ✓ App deactivation notification")
            DispatchQueue.main.async {
                self?.updateCurrentApp()
            }
        }

        // Additional window focus notifications
        NotificationCenter.default.addObserver(
            forName: NSApplication.didBecomeActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            print("DEBUG: ✓ App became active notification")
            DispatchQueue.main.async {
                self?.updateCurrentApp()
            }
        }

        NotificationCenter.default.addObserver(
            forName: NSApplication.didResignActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            print("DEBUG: ✓ App resigned active notification")
            DispatchQueue.main.async {
                self?.updateCurrentApp()
            }
        }
    }

    private func startGlobalEventMonitoring() {
        // Monitor global mouse clicks and key presses to detect app switches
        eventMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .keyDown]) { [weak self] event in
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                self?.updateCurrentApp()
            }
        }

        // Also monitor local events (when our app receives focus)
        localEventMonitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .keyDown]) { [weak self] event in
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                self?.updateCurrentApp()
            }
            return event
        }
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        if let monitor = eventMonitor {
            NSEvent.removeMonitor(monitor)
        }
        if let localMonitor = localEventMonitor {
            NSEvent.removeMonitor(localMonitor)
        }
    }
}
