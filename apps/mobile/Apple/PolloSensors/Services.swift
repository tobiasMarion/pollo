import Foundation
import PolloWire
import PolloSession

@MainActor public protocol LocationSource: AnyObject {
    var onLocation: ((Location) -> Void)? { get set }
    var onError: ((String) -> Void)? { get set }
    func start()
    func stop()
}

@MainActor public protocol RangingSource: AnyObject {
    var supported: Bool { get }
    var onInput: ((SessionInput) -> Void)? { get set }
    var onError: ((String) -> Void)? { get set }
    func begin(_ peer: String)
    func configure(_ peer: String, token: String)
    func end(_ peer: String)
    func stop()
}

@MainActor public protocol EventService: AnyObject {
    func nearby(_ location: Location) async throws -> Event?
    func event(_ id: String) async throws -> Event?
}

@MainActor public protocol EventTransport: AnyObject {
    var onInput: ((SessionInput) -> Void)? { get set }
    func connect(_ id: String)
    func send(_ frame: DeviceOutbound)
    func disconnect()
}

@MainActor public protocol LightOutput: AnyObject {
    var torchAvailable: Bool { get }
    var onError: ((String) -> Void)? { get set }
    func begin(_ type: Event.Output)
    func render(_ brightness: Double)
    func stop()
}

public enum APIError: Error { case invalidURL, http(Int) }

@MainActor public final class HTTPEvents: EventService {
    private let base: URL
    private let session: URLSession
    public init(base: URL, session: URLSession = .shared) { self.base = base; self.session = session }
    public func nearby(_ location: Location) async throws -> Event? {
        var url = URLComponents(url: base.appendingPathComponent("events/around"), resolvingAgainstBaseURL: false)!
        url.queryItems = [URLQueryItem(name: "latitude", value: String(location.latitude)), URLQueryItem(name: "longitude", value: String(location.longitude))]
        return try await fetch(url.url!)
    }
    public func event(_ id: String) async throws -> Event? {
        try await fetch(base.appendingPathComponent("events").appendingPathComponent(id))
    }
    private func fetch(_ url: URL) async throws -> Event? {
        let (data, response) = try await session.data(from: url)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 404 { return nil }
        guard status == 200 else { throw APIError.http(status) }
        return try JSONDecoder().decode(EventEnvelope.self, from: data).event
    }
}

/// A serial send chain preserves JOIN-before-measurements, and generation checks
/// prevent a cancelled socket from closing the connection that replaced it.
@MainActor public final class SocketTransport: EventTransport {
    public var onInput: ((SessionInput) -> Void)?
    private let base: URL
    private var socket: URLSessionWebSocketTask?
    private var receiver: Task<Void, Never>?
    private var sender: Task<Void, Never>?
    private var generation = 0
    public init(base: URL) { self.base = base }
    public func connect(_ id: String) {
        disconnect()
        var url = URLComponents(url: base.appendingPathComponent("events/\(id)/join"), resolvingAgainstBaseURL: false)!
        url.scheme = base.scheme == "https" ? "wss" : "ws"
        let task = URLSession.shared.webSocketTask(with: url.url!)
        socket = task
        let current = generation
        task.resume()
        receiver = Task { [weak self] in
            do {
                // Ping completion establishes the upgrade before the core sends JOIN.
                try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                    task.sendPing { error in
                        if let error { continuation.resume(throwing: error) } else { continuation.resume() }
                    }
                }
                guard let self, current == self.generation else { return }
                self.onInput?(.opened)
                while !Task.isCancelled {
                    let message = try await task.receive()
                    guard current == self.generation else { return }
                    let data: Data
                    switch message {
                    case .data(let value): data = value
                    case .string(let value): data = Data(value.utf8)
                    @unknown default: continue
                    }
                    if let frame = try? JSONDecoder().decode(DeviceInbound.self, from: data) {
                        self.onInput?(.received(frame))
                    }
                }
            } catch { self?.failed(current, code: task.closeCode.rawValue) }
        }
    }
    public func send(_ frame: DeviceOutbound) {
        guard let socket, let data = try? JSONEncoder().encode(frame), let string = String(data: data, encoding: .utf8) else { return }
        let preceding = sender
        let current = generation
        sender = Task { [weak self] in
            await preceding?.value
            guard let self, !Task.isCancelled, current == self.generation else { return }
            do { try await socket.send(.string(string)) }
            catch { self.failed(current, code: socket.closeCode.rawValue) }
        }
    }
    private func failed(_ current: Int, code: Int) {
        guard current == generation else { return }
        disconnect()
        onInput?(.closed(code: code))
    }
    public func disconnect() {
        generation += 1
        receiver?.cancel(); receiver = nil
        sender?.cancel(); sender = nil
        socket?.cancel(with: .goingAway, reason: nil); socket = nil
    }
}
