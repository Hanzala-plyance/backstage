import SwiftUI
import AppKit

struct PlayerCard: View {
    @ObservedObject var model: SetupModel
    let player: PlayerAssignment
    var body: some View {
        GroupBox("Player \(player.id)") {
            VStack(alignment: .leading, spacing: 8) {
                if player.id > 1 && player.id == model.visiblePlayers.last?.id {
                    HStack {
                        Spacer()
                        Button("Remove Player", role: .destructive) { model.removeLastPlayer() }
                            .buttonStyle(.borderless).font(.caption)
                    }
                }
                Picker("Device", selection: Binding(get: { player.deviceKey }, set: { model.selectDevice(player.id, $0) })) {
                    Text("Not playing").tag("")
                    if !player.deviceKey.isEmpty && model.device(player) == nil { Text("Saved device (disconnected)").tag(player.deviceKey) }
                    ForEach(model.devices) { d in
                        Text(d.name + (d.id.hasPrefix("usb:") ? " · port " + d.id.dropFirst(4) : "")).tag(d.id)
                            .disabled(model.active.contains { $0.id != player.id && $0.deviceKey == d.id })
                    }
                }
                if !player.deviceKey.isEmpty {
                    HStack {
                        Picker("Profile", selection: Binding(get: { player.instrument }, set: { v in model.updatePlayer(player.id) { $0.instrument = v } })) {
                            Text("5-fret guitar").tag("guitar"); Text("Drums").tag("drums"); Text("Gamepad").tag("gamepad")
                        }
                        Picker("Connection", selection: Binding(get: { player.routing }, set: { v in model.updatePlayer(player.id) { $0.routing = v } })) {
                            Text("Automatic").tag("auto"); Text("Native (already works)").tag("native"); Text("Riffmaster bridge").tag("bridge")
                        }
                    }
                    Label(model.routeLabel(player), systemImage: model.route(player) == "bridge" ? "arrow.triangle.branch" : "cable.connector")
                        .font(.caption).foregroundColor(.secondary)
                    if let error = model.readerErrors[player.id], model.locked { Text(error).font(.caption).foregroundColor(.orange) }
                    if model.route(player) == "bridge" && model.checked(player.id) & 127 == 127 {
                        Label("Frets and strumming checked", systemImage: "checkmark.circle.fill").font(.caption).foregroundColor(.green)
                    }
                }
            }.padding(8).frame(maxWidth: .infinity, minHeight: 100, alignment: .topLeading)
                .disabled(model.locked)
        }
    }
}
struct SetupView: View {
    @StateObject var model = SetupModel()
    @State var showSave = false
    @State var newName = ""
    let colors: [Color] = [.green, .red, .yellow, .blue, .orange]
    let names = ["Green", "Red", "Yellow", "Blue", "Orange"]
    let extras = ["Whammy", "Tilt", "Joystick X", "Joystick Y", "Stick click", "Start", "Select"]
    var focusedPlayer: PlayerAssignment { model.players.first { $0.id == model.focused } ?? model.players[0] }
    var state: [String: Any] { model.states[model.focused] ?? [:] }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Image(systemName: "guitars.fill").font(.largeTitle).foregroundColor(.accentColor)
                    VStack(alignment: .leading) {
                        Text("MacRiff").font(.largeTitle.bold())
                        Text("Connect. Test. Play.").foregroundColor(.secondary)
                    }
                    Spacer()
                    Button("Refresh devices") { model.scan() }.disabled(model.busy)
                    Button("Help") { NSWorkspace.shared.open(model.root.appendingPathComponent("CONTROLLER-MODE.md")) }
                }
                HStack {
                    Picker("Saved setup", selection: Binding(get: { model.presetID }, set: { model.choosePreset($0) })) {
                        ForEach(model.presets) { Text($0.name).tag($0.id) }
                    }.frame(maxWidth: 380).disabled(model.locked)
                    Button("Save a copy…") { newName = ""; showSave = true }.disabled(model.locked)
                    Text("Changes save automatically").font(.caption).foregroundColor(.secondary)
                }
                HStack {
                    Text(model.visiblePlayers.count == 1 ? "1. Choose your controller" : "1. Choose your controllers").font(.headline)
                    Spacer()
                    if model.visiblePlayers.count < 4 {
                        Button { model.addPlayer() } label: { Label("Add Player", systemImage: "plus") }
                            .disabled(model.locked)
                    }
                }
                LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: model.visiblePlayers.count == 1 ? 1 : 2), spacing: 12) {
                    ForEach(model.visiblePlayers) { PlayerCard(model: model, player: $0) }
                }
                Text("Working Xbox, PlayStation and other native controllers go directly to the game. MIDI drums use the game’s MIDI mapper. Only selected bridge devices are emulated.")
                    .font(.callout).foregroundColor(.secondary)
                GroupBox("2. Test controllers that need the bridge") {
                    VStack(alignment: .leading, spacing: 12) {
                        if model.bridges.isEmpty {
                            Label("No emulation needed for the selected native devices", systemImage: "cable.connector")
                            Text("Launch the original game below, assign each device to its player, and use its existing mappings. Device detection here does not replace an in-game input test.")
                                .font(.callout).foregroundColor(.secondary)
                        } else {
                            HStack {
                                Button(model.testing ? "Bridge tests active" : "Connect & Test Bridges") { model.beginTest() }
                                    .buttonStyle(.borderedProminent).disabled(!model.canTest)
                                Button("Disconnect Tests") { model.stop() }.disabled(!model.testing || model.busy)
                                Spacer()
                                Picker("Inspect", selection: $model.focused) {
                                    ForEach(model.bridges) { Text("Player \($0.id)").tag($0.id) }
                                }.frame(width: 180)
                            }
                            if model.route(focusedPlayer) == "bridge" {
                                HStack(spacing: 20) {
                                    ForEach(0..<5) { i in
                                        let pressed = (state["frets"] as? [Bool] ?? Array(repeating: false, count: 5))[i]
                                        VStack {
                                            Circle().fill(colors[i].opacity(pressed ? 1 : 0.2))
                                                .overlay(Circle().stroke(colors[i], lineWidth: pressed ? 3 : 1))
                                                .overlay(Image(systemName: model.checked(model.focused) & (1 << i) != 0 ? "checkmark" : ""))
                                                .frame(width: 36, height: 36)
                                            Text(names[i]).font(.caption)
                                        }
                                    }
                                    Spacer()
                                    VStack(alignment: .leading) {
                                        indicator("Strum up", model.checked(model.focused) & 32 != 0)
                                        indicator("Strum down", model.checked(model.focused) & 64 != 0)
                                    }
                                }
                                HStack { meter("Whammy", "whammy"); meter("Tilt", "tilt") }
                                Text(String(format: "Joystick X: %.2f   Y: %.2f", state["stickX"] as? Double ?? 0, state["stickY"] as? Double ?? 0)).font(.caption).monospacedDigit()
                                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), alignment: .leading), count: 4)) {
                                    ForEach(0..<extras.count, id: \.self) { i in indicator(extras[i], model.checked(model.focused) & (1 << (i + 7)) != 0) }
                                }
                                if let error = model.readerErrors[model.focused] {
                                    HStack { Text(error).font(.caption).foregroundColor(.orange); Button("Retry now") { model.retryPlayer(model.focused) }.disabled(model.busy) }
                                }
                            }
                            Text("For each bridged guitar, check all five frets and both strum directions. Native players do not need this test. Optional checks include whammy, tilt, stick and menu buttons.")
                                .font(.caption).foregroundColor(.secondary)
                        }
                    }.padding(10).frame(maxWidth: .infinity, alignment: .leading)
                }
                GroupBox("3. Play together") {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Picker("Game", selection: Binding(get: { model.game }, set: { model.setGame($0) })) {
                                Text("Clone Hero").tag("clonehero"); Text("YARG").tag("yarg")
                            }.pickerStyle(.segmented).frame(width: 300).disabled(model.locked)
                            Spacer()
                            Button(model.game == "clonehero" ? "Play Clone Hero" : "Play YARG") { model.launch() }
                                .buttonStyle(.borderedProminent).controlSize(.large).disabled(!model.canPlay)
                            Button("Stop Game") { model.stop() }.disabled(!model.running || model.busy)
                        }
                        if let error = model.configurationError { Text(error).font(.callout).foregroundColor(.orange) }
                        else if model.gameURL == nil { Text("Install the selected game in Applications first.").foregroundColor(.secondary) }
                        Text("Select each player’s matching instrument/profile inside the game. MacRiff saves device choices; native game bindings and MIDI note maps stay in the game.")
                            .font(.caption).foregroundColor(.secondary)
                    }.padding(10)
                }
                HStack {
                    if model.busy { ProgressView().controlSize(.small) }
                    Text(model.message).font(.callout)
                    Spacer()
                    Button("Logs") { NSWorkspace.shared.open(model.activeSession ?? model.root.appendingPathComponent("build")) }
                }
            }.padding(24)
        }.frame(width: 940, height: 820)
            .sheet(isPresented: $showSave) {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Save this setup").font(.headline)
                    TextField("For example: Solo, Guitars + drums, Four players", text: $newName).frame(width: 360)
                    HStack { Button("Cancel") { showSave = false }; Spacer(); Button("Save") { model.newPreset(newName); showSave = false }.disabled(newName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) }
                }.padding(24)
            }
    }
    func indicator(_ text: String, _ on: Bool) -> some View {
        Label(text, systemImage: on ? "checkmark.circle.fill" : "circle").foregroundColor(on ? .green : .secondary).font(.caption)
    }
    func meter(_ name: String, _ key: String) -> some View {
        VStack(alignment: .leading) { Text(name).font(.caption); ProgressView(value: state[key] as? Double ?? 0, total: 1) }.frame(maxWidth: .infinity)
    }
}
final class SetupDelegate: NSObject, NSApplicationDelegate {
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}
@main struct MacRiffSetup: App {
    @NSApplicationDelegateAdaptor(SetupDelegate.self) var delegate
    init() {
        if CommandLine.arguments.contains("--self-test") {
            let m = SetupModel()
            m.devices = [
                DeviceRow(id: "hid:xbox", name: "Xbox", vendor: 1118, product: 1, native: true, midi: false),
                DeviceRow(id: "hid:ps3", name: "PS3", vendor: 1356, product: 616, native: true, midi: false),
                DeviceRow(id: "midi:kit", name: "Drums", vendor: 0, product: 0, native: true, midi: true),
                DeviceRow(id: "usb:1:2", name: "Riffmaster", vendor: 3695, product: 584, native: false, midi: false)]
            var p = BandPreset(name: "Test band")
            p.players[0].deviceKey = "hid:xbox"; p.players[0].instrument = "gamepad"
            p.players[1].deviceKey = "hid:ps3"; p.players[1].instrument = "gamepad"
            p.players[2].deviceKey = "midi:kit"; p.players[2].instrument = "drums"
            m.presets = [p]; m.presetID = p.id; m.running = false; m.testing = false; m.busy = false
            precondition(m.configurationError == nil && m.bridges.isEmpty && m.canPlay)
            precondition(!m.canTest && m.route(p.players[0]) == "native" && m.route(p.players[1]) == "native")
            m.presets[0].players[3].deviceKey = "usb:1:2"
            precondition(m.bridges.map(\.id) == [4] && !m.canPlay)
            m.testing = true; m.states[4] = ["connected": true, "observed": 127]
            precondition(m.canPlay)
            m.sessionRoutes = [4: "bridge"]
            let riff = m.devices.removeLast()
            precondition(m.bridges.map(\.id) == [4], "A disconnected receiver must retain its session slot")
            m.states[4] = ["connected": false, "observed": 127]
            precondition(!m.canPlay, "A disconnected receiver must block game handoff")
            m.devices.append(riff); m.sessionRoutes = [:]
            m.presets[0].players[3].routing = "native"
            precondition(m.bridges.isEmpty)
            m.presets[0].players[1].deviceKey = "hid:xbox"
            precondition(m.configurationError != nil)
            let encoded = try! JSONEncoder().encode(PresetStore(selected: p.id, presets: [p]))
            let decoded = try! JSONDecoder().decode(PresetStore.self, from: encoded)
            precondition(decoded.presets[0].players[2].instrument == "drums")
            try? FileManager.default.removeItem(at: m.root)
            print("PASS: retained disconnected bridge slots, Xbox/PS3 remain native, MIDI drums, mixed bridge routing, per-player test gate, duplicates and setup persistence.")
            exit(0)
        }
        if CommandLine.arguments.contains("--diagnose") {
            let model = SetupModel()
            for d in model.devices { print("\(d.name) [\(d.id)] native=\(d.native) MIDI=\(d.midi)") }
            print("Runtime error: \(model.runtimeError ?? "none")")
            print("Saved setups: \(model.presets.count); visible players: \(model.visiblePlayers.count)")
            for p in model.active { print("Player \(p.id): \(model.routeLabel(p))") }
            exit(model.runtimeError == nil ? 0 : 1)
        }
    }
    var body: some Scene { Window("MacRiff Setup", id: "setup") { SetupView() }.windowResizability(.contentSize) }
}
