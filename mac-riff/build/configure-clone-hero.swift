import Foundation
import CoreFoundation
import AppKit

guard !NSWorkspace.shared.runningApplications.contains(where: { $0.bundleIdentifier == "com.srylain.CloneHero" }) else {
    print("Close Clone Hero before installing controller defaults.")
    exit(1)
}

let playerIndex = CommandLine.arguments.firstIndex(of: "--player")
let player = playerIndex.flatMap { $0 + 1 < CommandLine.arguments.count ? Int(CommandLine.arguments[$0 + 1]) : nil } ?? 1
guard (1...4).contains(player) else { print("Player must be 1–4"); exit(1) }
let controllerName = player == 1 ? "MacRiff Riffmaster" : "MacRiff Riffmaster P\(player)"

// Change only the MacRiff map while Clone Hero is closed. Preserve all other settings.
let domain = "com.srylain.CloneHero" as CFString
let key = "RewiredSaveData|playerName=Player\(player)|dataType=ControllerMap|kv=2|controllerMapType=JoystickMap|categoryId=1|layoutId=3|hardwareGuid=3d919cfa-468e-49f4-bce9-f6c43f2e7e62|duplicate=0" as CFString
let current = CFPreferencesCopyAppValue(key, domain) as? String
let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let marker = root.appendingPathComponent("build/riffmaster-p\(player)-defaults-v2.applied")
if current != nil && (FileManager.default.fileExists(atPath: marker.path) || CommandLine.arguments.contains("--preserve-existing")) && !CommandLine.arguments.contains("--reset") {
    print("Riffmaster defaults already installed; preserving your saved remaps.")
    exit(0)
}
if let old = current, !old.contains("hardwareName=\"MacRiff Riffmaster") {
    print("Another controller uses this mapping slot. Assign MacRiff and map it in-game first.")
    exit(1)
}
let replacement = try String(contentsOf: root.appendingPathComponent("profiles/riffmaster-clonehero.xml"), encoding: .utf8).replacingOccurrences(of: "hardwareName=\"MacRiff Riffmaster\"", with: "hardwareName=\"\(controllerName)\"")
_ = try XMLDocument(xmlString: replacement.replacingOccurrences(of: "utf-16", with: "utf-8"), options: [])
let backupDir = root.appendingPathComponent("build/settings-backups", isDirectory: true)
try FileManager.default.createDirectory(at: backupDir, withIntermediateDirectories: true)
let backup = backupDir.appendingPathComponent("riffmaster-p\(player)-\(Int(Date().timeIntervalSince1970)).plist")
let saved: [String: Any] = ["domain": domain as String, "key": key as String, "existed": current != nil, "value": current ?? ""]
try PropertyListSerialization.data(fromPropertyList: saved, format: .xml, options: 0).write(to: backup, options: .atomic)
CFPreferencesSetAppValue(key, replacement as CFString, domain)
guard CFPreferencesAppSynchronize(domain) else { fatalError("Could not save controller defaults") }
try Data(backup.path.utf8).write(to: marker, options: .atomic)
print("Installed Riffmaster defaults. Previous map: \(backup.path)")
