import Foundation
import CoreFoundation
import AppKit

guard CommandLine.arguments.count == 2 else {
    print("Usage: swift restore-controller-settings.swift build/settings-backups/riffmaster-TIMESTAMP.plist")
    exit(1)
}
guard !NSWorkspace.shared.runningApplications.contains(where: { $0.bundleIdentifier == "com.srylain.CloneHero" }) else {
    print("Close Clone Hero before restoring settings.")
    exit(1)
}
let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
guard let saved = try PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any],
      let key = saved["key"] as? String, (1...4).contains(where: { key.contains("playerName=Player\($0)|dataType=ControllerMap|") }),
      key.contains("hardwareGuid=3d919cfa-468e-49f4-bce9-f6c43f2e7e62"),
      saved["domain"] as? String == "com.srylain.CloneHero",
      let existed = saved["existed"] as? Bool, let value = saved["value"] as? String else {
    print("Not a MacRiff controller-map backup.")
    exit(1)
}
CFPreferencesSetAppValue(key as CFString, existed ? value as CFString : nil, "com.srylain.CloneHero" as CFString)
guard CFPreferencesAppSynchronize("com.srylain.CloneHero" as CFString) else { exit(1) }
print("Restored the saved Riffmaster mapping. Other settings are unchanged.")
