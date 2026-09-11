import XCTest
import PolloWire
import PolloSession
import PolloSensors
@testable import Pollo

@MainActor final class ControllerTests: XCTestCase {
    func ready() async -> EventController {
        let controller = Demo.make()
        controller.activate()
        for _ in 0..<20 { await Task.yield() }
        return controller
    }
    func testDiscoveryRequiresConfirmation() async {
        let controller = await ready()
        XCTAssertEqual(controller.phase, .ready)
        XCTAssertFalse(controller.participating)
        controller.join()
        XCTAssertTrue(controller.participating)
        XCTAssertEqual(controller.phase, .positioning)
        controller.leave()
    }
    func testBackgroundStopsAndReturnValidatesEvent() async {
        let controller = await ready()
        controller.join()
        controller.suspend()
        XCTAssertFalse(controller.participating)
        XCTAssertEqual(controller.brightness, 0)
        controller.activate()
        for _ in 0..<20 { await Task.yield() }
        XCTAssertTrue(controller.participating)
        controller.leave()
        controller.suspend()
        controller.activate()
        for _ in 0..<20 { await Task.yield() }
        XCTAssertFalse(controller.participating)
        controller.suspend()
    }
    func testUnsupportedHardwareCannotJoin() async {
        let ranging = DemoRanging()
        ranging.supported = false
        let controller = EventController(location: DemoLocation(), ranging: ranging,
            api: DemoEvents(), transport: DemoTransport(), light: DemoLight(), deviceId: "test")
        controller.activate()
        for _ in 0..<20 { await Task.yield() }
        XCTAssertFalse(controller.canJoin)
        controller.join()
        XCTAssertFalse(controller.participating)
        controller.suspend()
    }
    func testTorchEventFallsBackToTheScreenWithoutATorch() async throws {
        let light = DemoLight()
        light.torchAvailable = false
        let transport = DemoTransport()
        var time = 0.0
        let controller = EventController(location: DemoLocation(), ranging: DemoRanging(),
            api: TorchEvents(), transport: transport, light: light, deviceId: "test", now: { time })
        controller.activate()
        for _ in 0..<20 { await Task.yield() }
        XCTAssertTrue(controller.canJoin)
        XCTAssertEqual(controller.message, "Sua tela fará parte do espetáculo.")

        controller.join()
        XCTAssertEqual(light.output, .screen)
        let pair = PositionPair(relative: .zero, absolute: .zero)
        transport.onInput?(.received(.setPoint(NodePosition(uncorrected: pair, simulated: pair))))
        let effect = try JSONDecoder().decode(Effect.self, from: Data("""
        {"name":"PULSE","coordinateType":"RELATIVE","activeTime":2,"spreadDelayPerUnit":0}
        """.utf8))
        transport.onInput?(.received(.effect(effect, center: .zero)))
        time = 1
        try await Task.sleep(for: .milliseconds(50))
        XCTAssertTrue(controller.screenMode)
        XCTAssertGreaterThan(controller.brightness, 0.9)
        controller.suspend()
    }
    func testPermissionFailureTearsDownSession() async {
        let location = DemoLocation()
        let controller = EventController(location: location, ranging: DemoRanging(),
            api: DemoEvents(), transport: DemoTransport(), light: DemoLight(), deviceId: "test")
        controller.activate()
        for _ in 0..<20 { await Task.yield() }
        controller.join()
        location.onError?("Permissão negada")
        XCTAssertEqual(controller.phase, .failed)
        XCTAssertFalse(controller.participating)
        controller.suspend()
    }

    func testStaleDiscoveryCannotRestartAfterBackground() async throws {
        let api = DelayedEvents()
        let controller = EventController(location: DemoLocation(), ranging: DemoRanging(),
            api: api, transport: DemoTransport(), light: DemoLight(), deviceId: "test")
        controller.activate()
        for _ in 0..<20 { await Task.yield() }
        controller.suspend()
        api.complete(try await DemoEvents().event("demo"))
        for _ in 0..<20 { await Task.yield() }
        XCTAssertNil(controller.event)
        XCTAssertFalse(controller.participating)
    }

    func testTerminalSocketFailureStopsOutputAndLateFramesAreIgnored() async throws {
        let transport = DemoTransport()
        let light = DemoLight()
        let controller = EventController(location: DemoLocation(), ranging: DemoRanging(),
            api: DemoEvents(), transport: transport, light: light, deviceId: "test")
        controller.activate()
        for _ in 0..<20 { await Task.yield() }
        controller.join()
        XCTAssertTrue(light.started)
        transport.onInput?(.closed(code: 4404))
        XCTAssertFalse(light.started)
        XCTAssertEqual(controller.phase, .failed)
        transport.onInput?(.opened)
        XCTAssertEqual(controller.phase, .failed)
        controller.suspend()
    }

    func testCueSurvivesTransientDropButNotExplicitExit() async throws {
        let transport = DemoTransport()
        let light = DemoLight()
        var time = 0.0
        let controller = EventController(location: DemoLocation(), ranging: DemoRanging(),
            api: DemoEvents(), transport: transport, light: light, deviceId: "test", now: { time })
        controller.activate()
        for _ in 0..<20 { await Task.yield() }
        controller.join()
        let pair = PositionPair(relative: .zero, absolute: .zero)
        transport.onInput?(.received(.setPoint(NodePosition(uncorrected: pair, simulated: pair))))
        let effect = try JSONDecoder().decode(Effect.self, from: Data("""
        {"name":"PULSE","coordinateType":"RELATIVE","activeTime":2,"spreadDelayPerUnit":0}
        """.utf8))
        transport.onInput?(.received(.effect(effect, center: .zero)))
        time = 1
        try await Task.sleep(for: .milliseconds(50))
        XCTAssertGreaterThan(controller.brightness, 0.9)
        transport.onInput?(.closed(code: 1006))
        XCTAssertTrue(controller.screenMode)
        XCTAssertGreaterThan(controller.brightness, 0.9)
        controller.leave()
        XCTAssertEqual(controller.brightness, 0)
        XCTAssertEqual(light.brightness, 0)
        XCTAssertFalse(controller.screenMode)
        controller.suspend()
    }
}

@MainActor private final class DelayedEvents: EventService {
    var continuation: CheckedContinuation<Event?, Never>?
    func nearby(_ location: Location) async throws -> Event? {
        await withCheckedContinuation { continuation = $0 }
    }
    func event(_ id: String) async throws -> Event? { nil }
    func complete(_ event: Event?) { continuation?.resume(returning: event); continuation = nil }
}

@MainActor private final class TorchEvents: EventService {
    func nearby(_ location: Location) async throws -> Event? {
        try JSONDecoder().decode(Event.self, from: Data("""
        {"id":"torch","name":"Lanternas","type":"TORCH","status":"OPEN","latitude":0,"longitude":0,"userId":"test","createdAt":"2026-09-09T00:00:00Z","updatedAt":"2026-09-09T00:00:00Z"}
        """.utf8))
    }
    func event(_ id: String) async throws -> Event? { try await nearby(Location(latitude: 0, longitude: 0, horizontalAccuracy: 1, altitude: 0, verticalAccuracy: 1)) }
}
