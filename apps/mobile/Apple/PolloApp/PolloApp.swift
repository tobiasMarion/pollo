import SwiftUI
import PolloSensors

@main struct PolloApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @State private var controller: EventController
    init() {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--demo") {
            _controller = State(initialValue: Demo.make())
            return
        }
        #endif
        let configured = Bundle.main.object(forInfoDictionaryKey: "POLLO_API_URL") as? String ?? ""
        guard let base = URL(string: configured), ["http", "https"].contains(base.scheme), base.host != nil else {
            fatalError("Configure POLLO_API_URL in Config/Local.xcconfig before building.")
        }
        let defaults = UserDefaults.standard
        let id = defaults.string(forKey: "deviceId") ?? UUID().uuidString
        defaults.set(id, forKey: "deviceId")
        #if DEBUG
        let peers = min(16, max(1, defaults.object(forKey: "maxPeers") as? Int ?? 16))
        #else
        let peers = 16
        #endif
        _controller = State(initialValue: EventController(location: GPS(), ranging: Ranging(),
            api: HTTPEvents(base: base), transport: SocketTransport(base: base), light: Light(),
            deviceId: id, maxPeers: peers))
    }
    var body: some Scene {
        WindowGroup {
            MainScreen(controller: controller)
                .preferredColorScheme(.dark)
                .onChange(of: scenePhase) { _, phase in
                    // Permission prompts are inactive, not background transitions.
                    if phase == .background { controller.suspend() }
                    else if phase == .active { controller.activate() }
                }
                .onAppear { controller.activate() }
        }
    }
}
