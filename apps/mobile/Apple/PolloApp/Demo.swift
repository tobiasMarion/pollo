#if DEBUG
import Foundation
import PolloWire
import PolloSession
import PolloSensors

/// No radio, network or real light is touched by previews and UI tests.
@MainActor enum Demo {
    static func make() -> EventController {
        EventController(location: DemoLocation(), ranging: DemoRanging(), api: DemoEvents(),
                        transport: DemoTransport(), light: DemoLight(), deviceId: "preview")
    }
}
@MainActor final class DemoLocation: LocationSource {
    var onLocation: ((Location) -> Void)?
    var onError: ((String) -> Void)?
    func start() {
        onLocation?(Location(latitude: -29.68, longitude: -53.80, horizontalAccuracy: 5, altitude: 100, verticalAccuracy: 8))
    }
    func stop() {}
}
@MainActor final class DemoRanging: RangingSource {
    var supported = true
    var onInput: ((SessionInput) -> Void)?
    var onError: ((String) -> Void)?
    func begin(_ peer: String) {}
    func configure(_ peer: String, token: String) {}
    func end(_ peer: String) {}
    func stop() {}
}
@MainActor final class DemoEvents: EventService {
    func nearby(_ location: Location) async throws -> Event? {
        if ProcessInfo.processInfo.arguments.contains("--empty") { return nil }
        return try JSONDecoder().decode(Event.self, from: Data("""
        {"id":"demo","name":"Uma noite de luz","type":"SCREEN","status":"OPEN","latitude":0,"longitude":0,"userId":"demo","createdAt":"2026-09-09T00:00:00Z","updatedAt":"2026-09-09T00:00:00Z"}
        """.utf8))
    }
    func event(_ id: String) async throws -> Event? { try await nearby(Location(latitude: 0, longitude: 0, horizontalAccuracy: 1, altitude: 0, verticalAccuracy: 1)) }
}
@MainActor final class DemoTransport: EventTransport {
    var onInput: ((SessionInput) -> Void)?
    func connect(_ id: String) { onInput?(.opened) }
    func send(_ frame: DeviceOutbound) {
        guard case .join = frame, ProcessInfo.processInfo.arguments.contains("--live") else { return }
        let position = PositionPair(relative: .zero, absolute: .zero)
        onInput?(.received(.setPoint(NodePosition(uncorrected: position, simulated: position))))
        if let effect = try? JSONDecoder().decode(Effect.self, from: Data("""
        {"name":"PULSE","coordinateType":"RELATIVE","activeTime":3,"spreadDelayPerUnit":0}
        """.utf8)) {
            onInput?(.received(.effect(effect, center: .zero)))
        }
    }
    func disconnect() {}
}
@MainActor final class DemoLight: LightOutput {
    var torchAvailable = true
    var onError: ((String) -> Void)?
    var started = false
    var brightness = 0.0
    func begin(_ type: Event.Output) { started = true }
    func render(_ brightness: Double) { self.brightness = brightness }
    func stop() { started = false; brightness = 0 }
}
#endif
