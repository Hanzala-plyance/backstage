import AppKit
import Foundation
import ApplicationServices
import Darwin

class AppDelegate: NSObject, NSApplicationDelegate {
    var statusItem: NSStatusItem!
    var statusMenuItem: NSMenuItem!
    var startMenuItem: NSMenuItem!
    var stopMenuItem: NSMenuItem!
    var disableWhammyTiltMenuItem: NSMenuItem!
    var keyboardStatusMenuItem: NSMenuItem!
    var eventPipePath = ""
    var eventPipeDirectory = ""
    var eventPipeDescriptor: Int32 = -1
    var eventPipeSource: DispatchSourceRead?
    var eventBuffer = ""
    var pressedKeys = Set<CGKeyCode>()
    var testWindow: NSWindow?
    var testTextView: NSTextView?
    let keyboardEventSource = CGEventSource(stateID: .hidSystemState)
    
    var nodePath: String = "node"
    var resourcePath: String = ""
    var bridgeScriptPath: String = ""
    let logPath = "/tmp/macriff.log"
    var disableWhammyTilt: Bool = false
    
    func applicationDidFinishLaunching(_ aNotification: Notification) {
        // Request Accessibility permissions with native macOS prompt on launch
        let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as CFString
        let options = [key: true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(options)
        
        // Resolve bundle resource paths
        let bundle = Bundle.main
        resourcePath = bundle.resourcePath ?? "/Users/cdapayne/Documents/GitHub/MacRiff"
        bridgeScriptPath = "\(resourcePath)/bridge.js"
        
        // Find Node.js installation path
        nodePath = findNodePath()
        print("[MacRiffApp] Using Node path: \(nodePath)")
        print("[MacRiffApp] Using Resource path: \(resourcePath)")

        do {
            try setupEventPipe()
        } catch {
            let alert = NSAlert()
            alert.messageText = "MacRiff could not start keyboard output"
            alert.informativeText = error.localizedDescription
            alert.runModal()
            NSApplication.shared.terminate(nil)
            return
        }

        
        // Create system status bar item
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        
        if let button = statusItem.button {
            button.title = "🎸 MacRiff"
        }
        
        let menu = NSMenu()
        
        statusMenuItem = NSMenuItem(title: "Status: Stopped", action: nil, keyEquivalent: "")
        statusMenuItem.isEnabled = false
        menu.addItem(statusMenuItem)

        keyboardStatusMenuItem = NSMenuItem(title: "", action: nil, keyEquivalent: "")
        keyboardStatusMenuItem.isEnabled = false
        menu.addItem(keyboardStatusMenuItem)
        
        menu.addItem(NSMenuItem.separator())
        
        startMenuItem = NSMenuItem(title: "Start Bridge", action: #selector(startBridge), keyEquivalent: "s")
        startMenuItem.target = self
        menu.addItem(startMenuItem)
        
        stopMenuItem = NSMenuItem(title: "Stop Bridge", action: #selector(stopBridge), keyEquivalent: "t")
        stopMenuItem.target = self
        stopMenuItem.isEnabled = false
        menu.addItem(stopMenuItem)
        
        menu.addItem(NSMenuItem.separator())
        
        disableWhammyTiltMenuItem = NSMenuItem(title: "Disable Whammy & Star Power", action: #selector(toggleDisableWhammyTilt), keyEquivalent: "")
        disableWhammyTiltMenuItem.target = self
        disableWhammyTiltMenuItem.state = .off
        menu.addItem(disableWhammyTiltMenuItem)
        
        menu.addItem(NSMenuItem.separator())
        
        let viewLogsItem = NSMenuItem(title: "View Logs...", action: #selector(viewLogs), keyEquivalent: "l")
        viewLogsItem.target = self
        menu.addItem(viewLogsItem)

        let testItem = NSMenuItem(title: "Test Keyboard Output...", action: #selector(showKeyboardTest), keyEquivalent: "")
        testItem.target = self
        menu.addItem(testItem)
        
        menu.addItem(NSMenuItem.separator())
        
        let quitItem = NSMenuItem(title: "Quit", action: #selector(quitApp), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)
        
        statusItem.menu = menu
        
        // Poll status every 2 seconds
        Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { _ in
            self.updateStatus()
        }
        
        // Initial status check
        updateStatus()
    }

    func setupEventPipe() throws {
        let directory = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("macriff-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false,
                                               attributes: [.posixPermissions: 0o700])
        eventPipeDirectory = directory.path
        eventPipePath = directory.appendingPathComponent("events").path
        guard mkfifo(eventPipePath, 0o600) == 0 else {
            throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
        }
        eventPipeDescriptor = Darwin.open(eventPipePath, O_RDWR | O_NONBLOCK)
        guard eventPipeDescriptor >= 0 else {
            throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
        }
        let source = DispatchSource.makeReadSource(fileDescriptor: eventPipeDescriptor, queue: .main)
        source.setEventHandler { [weak self] in self?.readKeyboardEvents() }
        let descriptor = eventPipeDescriptor
        source.setCancelHandler { Darwin.close(descriptor) }
        eventPipeSource = source
        source.resume()
        print("[MacRiffApp] Keyboard event pipe: \(eventPipePath)")
        print("[MacRiffApp] Accessibility trusted: \(AXIsProcessTrusted())")
    }

    func readKeyboardEvents() {
        var bytes = [UInt8](repeating: 0, count: 4096)
        while true {
            let count = Darwin.read(eventPipeDescriptor, &bytes, bytes.count)
            if count <= 0 { break }
            eventBuffer += String(decoding: bytes.prefix(count), as: UTF8.self)
            while let newline = eventBuffer.firstIndex(of: "\n") {
                let command = String(eventBuffer[..<newline])
                eventBuffer.removeSubrange(...newline)
                postKeyboardCommand(command)
            }
        }
    }

    func postKeyboardCommand(_ command: String) {
        guard AXIsProcessTrusted() else { return }
        let parts = command.split(separator: " ")
        guard parts.count >= 2 else { return }
        if parts[0] == "K", parts.count == 3,
           let keyCode = CGKeyCode(parts[1]), keyCode <= 127,
           let state = Int(parts[2]), state == 0 || state == 1 {
            if state == 1 { pressedKeys.insert(keyCode) } else { pressedKeys.remove(keyCode) }
            let event = CGEvent(keyboardEventSource: keyboardEventSource,
                                virtualKey: keyCode, keyDown: state == 1)
            event?.post(tap: .cghidEventTap)
        } else if parts[0] == "S", parts.count == 2, let delta = Int32(parts[1]) {
            let event = CGEvent(scrollWheelEvent2Source: keyboardEventSource, units: .line,
                                wheelCount: 1, wheel1: delta, wheel2: 0, wheel3: 0)
            event?.post(tap: .cghidEventTap)
        }
    }

    func releaseKeyboardKeys() {
        for keyCode in pressedKeys {
            CGEvent(keyboardEventSource: keyboardEventSource, virtualKey: keyCode, keyDown: false)?
                .post(tap: .cghidEventTap)
        }
        pressedKeys.removeAll()
    }

    func showAccessibilityHelp() {
        let alert = NSAlert()
        alert.messageText = "Enable Accessibility for MacRiff"
        alert.informativeText = "Open System Settings → Privacy & Security → Accessibility and enable this MacRiff app. If it is already enabled, remove it and add this app again. Then restart MacRiff."
        alert.addButton(withTitle: "Open Settings")
        alert.addButton(withTitle: "Cancel")
        if alert.runModal() == .alertFirstButtonReturn,
           let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
            NSWorkspace.shared.open(url)
        }
    }

    @objc func showKeyboardTest() {
        if testWindow == nil {
            let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 540, height: 260),
                                  styleMask: [.titled, .closable], backing: .buffered, defer: false)
            window.title = "MacRiff Keyboard Test"
            window.isReleasedWhenClosed = false
            let label = NSTextField(labelWithString: "Press your guitar frets here. Test Keys should type asjkl.")
            label.frame = NSRect(x: 20, y: 215, width: 500, height: 25)
            window.contentView?.addSubview(label)
            let scroll = NSScrollView(frame: NSRect(x: 20, y: 60, width: 500, height: 145))
            scroll.hasVerticalScroller = true
            scroll.borderType = .bezelBorder
            let text = NSTextView(frame: scroll.bounds)
            text.isRichText = false
            text.font = NSFont.monospacedSystemFont(ofSize: 22, weight: .regular)
            scroll.documentView = text
            window.contentView?.addSubview(scroll)
            let button = NSButton(title: "Test Keys", target: self, action: #selector(testKeyboardOutput))
            button.frame = NSRect(x: 20, y: 15, width: 110, height: 32)
            window.contentView?.addSubview(button)
            window.center()
            testWindow = window
            testTextView = text
        }
        NSApplication.shared.activate(ignoringOtherApps: true)
        testWindow?.makeKeyAndOrderFront(nil)
        testWindow?.makeFirstResponder(testTextView)
    }

    @objc func testKeyboardOutput() {
        guard AXIsProcessTrusted() else { showAccessibilityHelp(); return }
        showKeyboardTest()
        testTextView?.string = ""
        for (index, keyCode) in [0, 1, 38, 40, 37].enumerated() {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3 + Double(index) * 0.1) {
                let command = "K \(keyCode) 1\nK \(keyCode) 0\n"
                command.withCString { pointer in
                    _ = Darwin.write(self.eventPipeDescriptor, pointer, command.utf8.count)
                }
            }
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        releaseKeyboardKeys()
        eventPipeSource?.cancel()
        if !eventPipeDirectory.isEmpty {
            try? FileManager.default.removeItem(atPath: eventPipeDirectory)
        }
    }
    
    func findNodePath() -> String {
        // Older Node installations cannot parse the USB library. Check each
        // candidate before choosing it, including ones in common locations.
        func isSupportedNode(_ path: String) -> Bool {
            guard FileManager.default.isExecutableFile(atPath: path) else { return false }
            let process = Process()
            process.executableURL = URL(fileURLWithPath: path)
            process.arguments = ["--version"]
            let pipe = Pipe()
            process.standardOutput = pipe
            process.standardError = pipe
            do {
                try process.run()
                process.waitUntilExit()
                let data = pipe.fileHandleForReading.readDataToEndOfFile()
                let version = String(data: data, encoding: .utf8)?
                    .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                guard process.terminationStatus == 0, version.hasPrefix("v"),
                      let major = Int(version.dropFirst().split(separator: ".").first ?? "") else {
                    return false
                }
                return major >= 16
            } catch {
                return false
            }
        }

        // 1. Quick check common locations first (avoids slow login shell spin-up)
        let commonPaths = [
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            "/usr/bin/node"
        ]
        
        for path in commonPaths {
            if isSupportedNode(path) {
                return path
            }
        }

        // Finder-launched apps may not load NVM's shell initialization.
        // Look for installed versions directly, newest first.
        let nvmRoot = ProcessInfo.processInfo.environment["NVM_DIR"]
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".nvm").path
        let versionsPath = "\(nvmRoot)/versions/node"
        if let versions = try? FileManager.default.contentsOfDirectory(atPath: versionsPath) {
            for version in versions.sorted(by: { $0.compare($1, options: .numeric) == .orderedDescending }) {
                let path = "\(versionsPath)/\(version)/bin/node"
                if isSupportedNode(path) {
                    return path
                }
            }
        }
        
        // 2. Fallback to querying node using a login shell (captures NVM, FNM, etc.)
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = ["-l", "-c", "which node"]
        
        let pipe = Pipe()
        process.standardOutput = pipe
        
        do {
            try process.run()
            process.waitUntilExit()
            
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            if let path = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines), isSupportedNode(path) {
                return path
            }
        } catch {}
        
        return "node" // final fallback
    }

    
    @objc func toggleDisableWhammyTilt() {
        disableWhammyTilt.toggle()
        disableWhammyTiltMenuItem.state = disableWhammyTilt ? .on : .off
        
        // If the bridge is currently running, restart it with the new arguments
        if checkBridgeRunning() {
            DispatchQueue.global(qos: .userInitiated).async {
                self.stopBridgeSync()
                Thread.sleep(forTimeInterval: 0.5)
                self.startBridgeSync()
            }
        }
    }

    @objc func startBridge() {
        guard AXIsProcessTrusted() else { showAccessibilityHelp(); return }
        // Run in background thread so password prompt doesn't freeze menu bar UI
        DispatchQueue.global(qos: .userInitiated).async {
            self.startBridgeSync()
        }
    }
    
    func startBridgeSync() {
        let extraArgs = self.disableWhammyTilt ? " --no-special" : ""
        func shellQuote(_ value: String) -> String {
            return "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'"
        }
        let command = "cd \(shellQuote(resourcePath)) && \(shellQuote(nodePath)) bridge.js\(extraArgs) --event-pipe \(shellQuote(eventPipePath)) > \(shellQuote(logPath)) 2>&1 < /dev/null &"
        let escapedCommand = command.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        let osascript = "do shell script \"\(escapedCommand)\" with administrator privileges"
        
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-e", osascript]
        
        do {
            try process.run()
            process.waitUntilExit()
            
            // Wait a moment for process to spin up and update status on the main thread
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                self.updateStatus()
            }
        } catch {
            print("Failed to run start bridge osascript: \(error)")
        }
    }
    
    @objc func stopBridge() {
        // Run in background thread to keep UI completely responsive
        DispatchQueue.global(qos: .userInitiated).async {
            self.stopBridgeSync()
        }
    }
    
    func stopBridgeSync() {
        let osascript = """
        do shell script "pkill -f bridge.js" with administrator privileges
        """
        
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-e", osascript]
        
        do {
            try process.run()
            process.waitUntilExit()
            
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                self.updateStatus()
            }
        } catch {
            print("Failed to run stop bridge osascript: \(error)")
        }
    }

    
    @objc func viewLogs() {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        process.arguments = [logPath]
        try? process.run()
    }
    
    @objc func quitApp() {
        // Automatically stop the bridge on app termination
        let osascript = """
        do shell script "pkill -f bridge.js" with administrator privileges
        """
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-e", osascript]
        try? process.run()
        process.waitUntilExit()
        
        NSApplication.shared.terminate(self)
    }
    
    func updateStatus() {
        // Offload pgrep checking to a background thread to keep UI completely thread-safe
        DispatchQueue.global(qos: .background).async {
            let isRunning = self.checkBridgeRunning()
            DispatchQueue.main.async {
                self.updateUI(isRunning: isRunning)
            }
        }
    }
    
    func updateUI(isRunning: Bool) {
        keyboardStatusMenuItem.title = AXIsProcessTrusted()
            ? "Keyboard: Ready" : "Keyboard: Needs Accessibility"
        if isRunning {
            statusMenuItem.title = "Status: Running"
            startMenuItem.isEnabled = false
            stopMenuItem.isEnabled = true
            if let button = statusItem.button {
                button.title = "🎸 MacRiff (Active)"
            }
        } else {
            releaseKeyboardKeys()
            statusMenuItem.title = "Status: Stopped"
            startMenuItem.isEnabled = true
            stopMenuItem.isEnabled = false
            if let button = statusItem.button {
                button.title = "🎸 MacRiff"
            }
        }
    }

    
    func checkBridgeRunning() -> Bool {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/sh")
        process.arguments = ["-c", "pgrep -f bridge.js"]
        
        let pipe = Pipe()
        process.standardOutput = pipe
        
        do {
            try process.run()
            process.waitUntilExit()
            
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            if let output = String(data: data, encoding: .utf8), !output.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return true
            }
        } catch {
            return false
        }
        return false
    }
}

// Bootstrap Cocoa application
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory) // Hide App icon from the Dock and run as a status bar agent
app.run()
