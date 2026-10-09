import SwiftUI
import AppKit
import IOKit
import IOKit.hid
import CoreMIDI

struct ControllerProfile: Decodable {
    let id: String, name: String, decoder: String, pairing: String
    let vendorId: Int
    let productIds: [Int]
    let games: [String: String]
}
struct ProfileCatalog: Decodable { let schemaVersion: Int; let profiles: [ControllerProfile] }
struct DeviceRow: Identifiable, Hashable, Decodable {
    let id: String, name: String
    let vendor: Int, product: Int
    let native: Bool, midi: Bool
}
struct PlayerAssignment: Codable, Identifiable {
    var id: Int
    var deviceKey = ""
    var instrument = "guitar"
    var routing = "auto"
}
struct BandPreset: Codable, Identifiable {
    var id = UUID().uuidString
    var name: String
    var game = "backstage"
    var visiblePlayerCount: Int?
    var players = (1...4).map { PlayerAssignment(id: $0) }
}
struct PresetStore: Codable { var selected: String; var presets: [BandPreset] }

@MainActor final class SetupModel: ObservableObject {
    @Published var devices: [DeviceRow] = []
    @Published var presets: [BandPreset] = [BandPreset(name: "My setup")]
    @Published var presetID = ""
    @Published var focused = 1
    @Published var message = "Choose devices for up to four players. Controllers that already work can use Native."
    @Published var states: [Int: [String: Any]] = [:]
    @Published var readerErrors: [Int: String] = [:]
    @Published var testing = false
    @Published var running = false
    @Published var busy = false
    @Published var runtimeError: String?
    let root: URL
    let profiles: [ControllerProfile]
    var sessionProcess: Process?
    var timer: Timer?
    var ticks = 0
    var operationBusy = false
    var savedChecks: [Int: Int] = [:]
    var nativeGame: URL?
    var sessionRoutes: [Int: String] = [:]
    var activeSession: URL?
    var gameSearchRoots = [URL(fileURLWithPath: "/Applications"), FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications")]
    var currentPresetIndex: Int { presets.firstIndex { $0.id == presetID } ?? 0 }
    var current: BandPreset { presets[currentPresetIndex] }
    var players: [PlayerAssignment] { current.players }
    var visiblePlayers: [PlayerAssignment] {
        // Old saved setups retain configured players; unused slots stay hidden.
        let configuredCount = active.map(\.id).max() ?? 1
        let count = min(4, max(configuredCount, current.visiblePlayerCount ?? 1))
        return Array(players.prefix(count))
    }
    var game: String { current.game }
    var active: [PlayerAssignment] { players.filter { !$0.deviceKey.isEmpty } }
    var bridges: [PlayerAssignment] { active.filter { route($0) == "bridge" } }
    var locked: Bool { busy || testing || running }
    init() {
        root = CommandLine.arguments.contains("--self-test") ? FileManager.default.temporaryDirectory.appendingPathComponent("macriff-model-test-" + UUID().uuidString) : FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/MacRiff")
        do { try Self.installRuntime(at: root) }
        catch { runtimeError = error.localizedDescription; message = "Could not prepare MacRiff: \(error.localizedDescription)" }
        profiles = (try? JSONDecoder().decode(ProfileCatalog.self, from: Data(contentsOf: root.appendingPathComponent("profiles/controllers.json"))))?.profiles ?? []
        if let saved = try? JSONDecoder().decode(PresetStore.self, from: Data(contentsOf: root.appendingPathComponent("setups.json"))),
           !saved.presets.isEmpty, saved.presets.allSatisfy({ $0.players.map(\.id) == [1,2,3,4] }) {
            presets = saved.presets; presetID = saved.selected
        } else { presetID = presets[0].id }
        scan()
        if active.isEmpty, let first = devices.first, !FileManager.default.fileExists(atPath: root.appendingPathComponent("setups.json").path) { selectDevice(1, first.id) }
        refresh()
        timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
            guard let owner = self else { return }
            Task { @MainActor in owner.refresh(); owner.ticks += 1; if owner.ticks == 12 { owner.ticks = 0; owner.scan() } }
        }
    }
    static func installRuntime(at root: URL) throws {
        let fm = FileManager.default
        guard let payload = Bundle.main.resourceURL?.appendingPathComponent("Runtime") else { throw CocoaError(.fileNoSuchFile) }
        let version = try String(contentsOf: payload.appendingPathComponent("payload-version"), encoding: .utf8) + payload.path
        if (try? String(contentsOf: root.appendingPathComponent("payload-version"), encoding: .utf8)) == version { return }
        try fm.createDirectory(at: root, withIntermediateDirectories: true)
        guard let items = fm.enumerator(at: payload, includingPropertiesForKeys: [.isDirectoryKey]) else { throw CocoaError(.fileReadUnknown) }
        for case let source as URL in items {
            let relative = String(source.path.dropFirst(payload.path.count + 1)); if relative == "payload-version" { continue }
            let target = root.appendingPathComponent(relative)
            if relative == "bin" || relative == "node_modules" {
                items.skipDescendants()
                if fm.fileExists(atPath: target.path) || (try? fm.destinationOfSymbolicLink(atPath: target.path)) != nil { try fm.removeItem(at: target) }
                try fm.createSymbolicLink(at: target, withDestinationURL: source)
            } else if try source.resourceValues(forKeys: [.isDirectoryKey]).isDirectory == true {
                try fm.createDirectory(at: target, withIntermediateDirectories: true)
            } else {
                if fm.fileExists(atPath: target.path) { try fm.removeItem(at: target) }
                try fm.copyItem(at: source, to: target)
            }
        }
        try Data(version.utf8).write(to: root.appendingPathComponent("payload-version"), options: .atomic)
    }
    func device(_ p: PlayerAssignment) -> DeviceRow? { devices.first { $0.id == p.deviceKey } }
    func profile(_ p: PlayerAssignment) -> ControllerProfile? {
        guard let d = device(p) else { return nil }
        return profiles.first { $0.vendorId == d.vendor && $0.productIds.contains(d.product) }
    }
    func route(_ p: PlayerAssignment) -> String {
        if locked, let saved = sessionRoutes[p.id] { return saved }
        guard let d = device(p) else { return p.deviceKey.isEmpty ? "off" : "missing" }
        if d.midi { return "midi" }
        if p.routing == "native" { return "native" }
        if p.routing == "bridge" { return profile(p)?.decoder == "xbox-gip-riffmaster" && p.instrument == "guitar" ? "bridge" : "unsupported" }
        // Recognized bridge hardware gets its decoder; all other HID controllers stay native.
        if profile(p)?.decoder == "xbox-gip-riffmaster" { return p.instrument == "guitar" ? "bridge" : "unsupported" }
        return d.native ? "native" : "unsupported"
    }
    func routeLabel(_ p: PlayerAssignment) -> String {
        if locked && device(p) == nil && !p.deviceKey.isEmpty {
            return route(p) == "bridge" ? "Receiver disconnected · reconnect to the same USB port" : "Device disconnected · reconnect it, then check its player in the game"
        }
        switch route(p) {
        case "native": return "Native · existing game mappings"
        case "midi": return "Native MIDI · map pads in the game"
        case "bridge": return "Riffmaster bridge · separate player input"
        case "missing": return "Saved device disconnected — reconnect or select another"
        case "unsupported": return "No bridge for this device/profile. Use Native only if it already works."
        default: return "Not playing"
        }
    }
    var gameURL: URL? {
        let names = game == "backstage" ? ["Backstage.app"] : game == "clonehero" ? ["Clone Hero.app"] : ["YARG.app", "YARG (Nightly).app"]
        for base in gameSearchRoots {
            for name in names { let url = base.appendingPathComponent(name); if FileManager.default.fileExists(atPath: url.path) { return url } }
        }
        return nil
    }
    var configurationError: String? {
        if let error = runtimeError { return error }
        if active.isEmpty { return "Choose at least one player’s device." }
        if Set(active.map(\.deviceKey)).count != active.count { return "Each physical device can belong to only one player." }
        for p in active {
            if ["missing", "unsupported"].contains(route(p)) { return "Player \(p.id): \(routeLabel(p))" }
            if route(p) == "midi" && p.instrument != "drums" { return "Player \(p.id): choose Drums for the MIDI input." }
            if route(p) == "bridge" && game != "clonehero" { return "Riffmaster bridging is available only for Clone Hero. Native Backstage/YARG setups can launch directly." }
        }
        return nil
    }
    func checked(_ id: Int) -> Int { (states[id]?["observed"] as? Int ?? 0) | (running ? savedChecks[id] ?? 0 : 0) }
    func bridgeReady(_ p: PlayerAssignment) -> Bool { states[p.id]?["connected"] as? Bool == true && checked(p.id) & 127 == 127 && readerErrors[p.id] == nil }
    var canTest: Bool { !busy && !running && !testing && configurationError == nil && !bridges.isEmpty }
    var canPlay: Bool { !busy && !running && configurationError == nil && gameURL != nil && (bridges.isEmpty || (testing && bridges.allSatisfy { bridgeReady($0) })) }
    func save() {
        do { try JSONEncoder().encode(PresetStore(selected: presetID, presets: presets)).write(to: root.appendingPathComponent("setups.json"), options: .atomic) }
        catch { message = "Could not save this setup: \(error.localizedDescription)" }
    }
    func choosePreset(_ id: String) { guard !locked else { return }; presetID = id; savedChecks = [:]; states = [:]; save() }
    func newPreset(_ name: String) {
        guard !locked else { return }
        var copy = current; copy.id = UUID().uuidString; copy.name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !copy.name.isEmpty else { return }; presets.append(copy); presetID = copy.id; save()
    }
    func addPlayer() {
        guard !locked, visiblePlayers.count < 4 else { return }
        presets[currentPresetIndex].visiblePlayerCount = visiblePlayers.count + 1
        save()
    }
    func removeLastPlayer() {
        guard !locked, let last = visiblePlayers.last, last.id > 1 else { return }
        presets[currentPresetIndex].players[last.id - 1] = PlayerAssignment(id: last.id)
        presets[currentPresetIndex].visiblePlayerCount = last.id - 1
        states[last.id] = nil; savedChecks[last.id] = nil; readerErrors[last.id] = nil
        if focused == last.id { focused = 1 }
        save()
    }
    func updatePlayer(_ id: Int, _ change: (inout PlayerAssignment) -> Void) {
        guard !locked else { return }; change(&presets[currentPresetIndex].players[id - 1]); states[id] = nil; savedChecks[id] = nil; save()
    }
    func selectDevice(_ id: Int, _ key: String) {
        updatePlayer(id) { p in p.deviceKey = key; p.routing = "auto"; if devices.first(where: { $0.id == key })?.midi == true { p.instrument = "drums" } }
    }
    func setGame(_ value: String) { guard !locked else { return }; presets[currentPresetIndex].game = value; save() }
    func scan() {
        var found: [DeviceRow] = []
        let task = Process(), pipe = Pipe()
        task.executableURL = root.appendingPathComponent("bin/node"); task.arguments = [root.appendingPathComponent("device-inventory.js").path]
        task.standardOutput = pipe; task.standardError = FileHandle.nullDevice
        if (try? task.run()) != nil {
            let data = pipe.fileHandleForReading.readDataToEndOfFile(); task.waitUntilExit()
            found = (try? JSONDecoder().decode([DeviceRow].self, from: data)) ?? []
        }
        let manager = IOHIDManagerCreate(kCFAllocatorDefault, IOOptionBits(kIOHIDOptionsTypeNone))
        IOHIDManagerSetDeviceMatchingMultiple(manager, [4,5,8].map { [kIOHIDDeviceUsagePageKey: 1, kIOHIDDeviceUsageKey: $0] as NSDictionary } as CFArray)
        if let hidDevices = IOHIDManagerCopyDevices(manager) as? Set<IOHIDDevice> {
            for hid in hidDevices {
                func prop(_ key: String) -> Any? { IOHIDDeviceGetProperty(hid, key as CFString) }
                let vendor = (prop(kIOHIDVendorIDKey) as? NSNumber)?.intValue ?? 0
                let product = (prop(kIOHIDProductIDKey) as? NSNumber)?.intValue ?? 0
                if vendor == 0x0e6f && product == 0x0248 { continue }
                let name = prop(kIOHIDProductKey) as? String ?? "HID controller"
                var entry: UInt64 = 0; IORegistryEntryGetRegistryEntryID(IOHIDDeviceGetService(hid), &entry)
                let location = (prop(kIOHIDLocationIDKey) as? NSNumber)?.uint64Value ?? entry
                let serial = prop(kIOHIDSerialNumberKey) as? String ?? ""
                let key = "hid:\(vendor):\(product):\(serial.isEmpty ? String(location) : serial)"
                if !found.contains(where: { $0.id == key }) { found.append(DeviceRow(id: key, name: name, vendor: vendor, product: product, native: true, midi: false)) }
            }
        }
        for index in 0..<MIDIGetNumberOfSources() {
            let endpoint = MIDIGetSource(index)
            var name: Unmanaged<CFString>?, unique: Int32 = 0
            MIDIObjectGetStringProperty(endpoint, kMIDIPropertyDisplayName, &name)
            MIDIObjectGetIntegerProperty(endpoint, kMIDIPropertyUniqueID, &unique)
            found.append(DeviceRow(id: "midi:\(unique)", name: (name?.takeRetainedValue() as String?) ?? "MIDI input", vendor: 0, product: 0, native: true, midi: true))
        }
        devices = found.sorted { $0.name == $1.name ? $0.id < $1.id : $0.name < $1.name }
    }
    func readJSON(_ file: URL) -> [String: Any] { guard let data = try? Data(contentsOf: file), let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }; return object }
    func refresh() {
        let copied = root.appendingPathComponent("build/Clone Hero (MacRiff).app").path
        let applications = NSWorkspace.shared.runningApplications
        let bridgeRunning = applications.contains { $0.bundleURL?.path == copied }
        running = bridgeRunning || applications.contains { nativeGame != nil && $0.bundleURL == nativeGame }
        if sessionProcess?.isRunning == true || (bridgeRunning && activeSession == nil), let path = try? String(contentsOf: root.appendingPathComponent("build/latest-band-session.txt"), encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines), path.hasPrefix("/tmp/macriff-band.") { activeSession = URL(fileURLWithPath: path) }
        guard let dir = activeSession else {
            if let p = sessionProcess, !p.isRunning {
                busy = false
                let log = (try? String(contentsOf: root.appendingPathComponent("build/setup-launch.log"), encoding: .utf8)) ?? ""
                message = "Session could not start. " + (log.split(separator: "\n").first.map(String.init) ?? "Open Logs for details.")
            }
            return
        }
        let session = readJSON(dir.appendingPathComponent("session.json"))
        let alive = sessionProcess?.isRunning == true
        testing = alive && session["mode"] as? String == "test"
        if let phase = session["phase"] as? String {
            busy = operationBusy || (alive && ["starting", "authorizing"].contains(phase))
            if let info = session["message"] as? String { message = info }
        }
        if !alive { busy = operationBusy; testing = false }
        if alive || running {
            for entry in session["players"] as? [[String: Any]] ?? [] {
                if let id = entry["player"] as? Int, let route = entry["route"] as? String { sessionRoutes[id] = route }
            }
        } else { sessionRoutes = [:] }
        for p in bridges {
            let playerDir = dir.appendingPathComponent("p\(p.id)")
            states[p.id] = alive || running ? readJSON(playerDir.appendingPathComponent("status.json")) : [:]
            let health = readJSON(playerDir.appendingPathComponent("reader-status.json"))
            let fresh = Date().timeIntervalSince1970 - (states[p.id]?["updated"] as? Double ?? 0) < 4
            if !fresh { states[p.id] = [:] }
            if alive || running {
                if health["phase"] as? String == "connected" && fresh && states[p.id]?["connected"] as? Bool == true { readerErrors[p.id] = nil }
                else { readerErrors[p.id] = health["phase"] as? String == "connected" ? "Connection interrupted. Recovering automatically…" : health["message"] as? String ?? "Waiting for the receiver…" }
            } else { readerErrors[p.id] = nil }
            if testing { savedChecks[p.id] = states[p.id]?["observed"] as? Int ?? 0 }
        }
    }
    func planData() throws -> Data {
        let entries: [[String: Any]] = active.map { p in ["player": p.id, "deviceKey": p.deviceKey, "name": device(p)?.name ?? "", "route": route(p), "instrument": p.instrument, "profile": profile(p)?.id ?? "native"] }
        return try JSONSerialization.data(withJSONObject: ["game": game, "players": entries] as [String: Any])
    }
    func startSession(_ mode: String) {
        do {
            let plan = root.appendingPathComponent("build/session-plan.json")
            try planData().write(to: plan, options: .atomic)
            let log = root.appendingPathComponent("build/setup-launch.log")
            FileManager.default.createFile(atPath: log.path, contents: nil)
            let handle = try FileHandle(forWritingTo: log)
            let process = Process(); process.executableURL = root.appendingPathComponent("bin/node")
            process.arguments = [root.appendingPathComponent("session-manager.js").path, mode, plan.path]
            process.currentDirectoryURL = root
            var env = ProcessInfo.processInfo.environment; env["MACRIFF_GAME_APP"] = gameURL?.path
            process.environment = env; process.standardOutput = handle; process.standardError = handle; process.standardInput = FileHandle.nullDevice
            sessionRoutes = Dictionary(uniqueKeysWithValues: active.map { ($0.id, route($0)) })
            activeSession = nil; states = [:]; readerErrors = [:]; busy = true
            try process.run(); try? handle.close(); sessionProcess = process
            message = mode == "test" ? "Connecting selected bridge receivers…" : "Preparing game…"
            if mode == "test" { savedChecks = [:] }
        } catch { busy = false; message = error.localizedDescription }
    }
    func beginTest() { guard canTest else { return }; focused = bridges.first?.id ?? 1; startSession("test") }
    func endTest() async {
        if sessionProcess?.isRunning == true { sessionProcess?.terminate() }
        for _ in 0..<80 { if sessionProcess?.isRunning != true { break }; try? await Task.sleep(nanoseconds: 100_000_000) }
        sessionProcess = nil; testing = false
    }
    func launch() {
        guard canPlay, let url = gameURL else { return }
        if bridges.isEmpty {
            sessionRoutes = Dictionary(uniqueKeysWithValues: active.map { ($0.id, route($0)) })
            activeSession = nil; sessionProcess = nil; states = [:]; readerErrors = [:]
            nativeGame = url; NSWorkspace.shared.open(url)
            message = "Opened the original game. Assign each native controller or MIDI input to its player; existing mappings are preserved."
            return
        }
        busy = true; operationBusy = true
        Task { await endTest(); operationBusy = false; startSession("game") }
    }
    func retryPlayer(_ id: Int) {
        guard !busy, testing || running, let dir = activeSession, bridges.contains(where: { $0.id == id }), readerErrors[id] != nil else { return }
        do {
            // The already-authorized supervisor owns retries. Never spawn a second reader.
            try Data().write(to: dir.appendingPathComponent("p\(id)/retry-request"), options: .atomic)
            readerErrors[id] = "Retry requested. Recovering this player’s connection…"
        } catch { readerErrors[id] = error.localizedDescription }
    }
    func stop() {
        guard !busy else { return }
        if testing {
            busy = true; operationBusy = true; Task { await endTest(); busy = false; operationBusy = false; states = [:]; message = "Bridge tests stopped. Native controllers remain available." }
        } else if running {
            let copied = root.appendingPathComponent("build/Clone Hero (MacRiff).app").path
            for app in NSWorkspace.shared.runningApplications where app.bundleURL?.path == copied || (nativeGame != nil && app.bundleURL == nativeGame) { app.terminate() }
        }
    }
}
