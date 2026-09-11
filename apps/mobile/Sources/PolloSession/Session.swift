import PolloEffects
import PolloWire

/// Where the client is between "nothing is running" and "measuring".
public enum SessionPhase: Equatable, Sendable {
    case idle
    case connecting
    /// The socket is open, but there is no fix yet and `JOIN` carries one.
    case joining
    case joined
    /// Closed, and coming back once the clock catches up with the backoff.
    case waiting
    /// Closed because there is no network. Nothing to back off from.
    case offline
    /// Told to stop, or told off by the server. Either way it is over.
    case stopped
}

/// Something that happened to the client.
public enum SessionInput: Equatable, Sendable {
    case start
    /// Backgrounded, or shut down. Closing means closing.
    case stop
    case opened
    case closed(code: Int)
    case received(DeviceInbound)
    case located(Location)
    /// The radio produced this device's own token for that one pairing.
    case minted(token: String, for: String)
    case measured(Double, from: String)
    /// The radio gave up on a peer.
    case lostPeer(String)
    case network(available: Bool)
    /// No ultra-wideband here — old hardware, or the permission was refused.
    case rangingUnavailable
    case tick
}

/// Something for the adapters to do about it.
public enum SessionCommand: Equatable, Sendable {
    case connect
    case disconnect
    case send(DeviceOutbound)
    /// Open a session against this peer and hand back the token it mints.
    case beginRanging(peer: String)
    /// Run it, now that the peer's own token has arrived.
    case configureRanging(peer: String, token: String)
    /// Invalidate it. Leaving the list means the radio stops, not that a
    /// dictionary forgets.
    case endRanging(peer: String)
}

/// A cue and when it reached this device.
public struct Cue: Equatable, Sendable {
    public var effect: Effect
    public var center: Vector3

    /**
     Arrival, not firing — there is no fired-at on the wire, on purpose.

     A cue is parameters rather than frames, so each phone runs its own clock
     from the moment it hears. Nobody waits on a shared one, nobody has to be
     told what time the server thinks it is, and a device whose frame took an
     extra hundred milliseconds is a hundred milliseconds late rather than
     wrong.
     */
    public var arrivedAt: Double
}

/// A read-only snapshot for the developer panel. It deliberately contains
/// client state only; the phone cannot infer graph edges or distances held by
/// other devices.
public struct SessionDiagnostics: Equatable, Sendable {
    public let phase: SessionPhase
    public let deviceId: String
    public let maxPeers: Int
    public let assignedPeers: [String]
    public let courtingPeers: [String]
    public let sentDistances: [String: Double]
    public let pendingDistances: [String: Double]
    public let silentSweeps: [String: Int]
    public let rangingAvailable: Bool
    public let point: Vector3?
    public let cue: Cue?
}

/// Close codes that mean the socket was wrong rather than unlucky. Retrying
/// them is how a client turns a rejection into a denial of service.
private let terminalCloseCodes: Set<Int> = [4400, 4401, 4404]

/**
 The whole client, minus the radios and the screen.

 Every rule that costs battery lives here — how often a sweep goes out, whether
 a fix is worth a frame, which peers keep a radio session, how long a dead
 socket is left alone — and none of it touches an Apple framework. That is the
 point: the adapters below it are thin enough to read, and everything that
 decides anything is driven by a list of inputs and checked against a list of
 commands.

 It owns no clock. `now` is monotonic seconds, supplied by the caller, and one
 ticker in the app drives both the sweep and the reconnect — a client that
 wakes a crowd's worth of timers to do nothing is the shape of the problem this
 whole app is trying to avoid.
 */
public final class PolloSession {
    /// Chosen by this device and stable across reconnects. Not a radio token:
    /// those are per-pair, and there are as many of them as there are peers.
    public let deviceId: String

    public private(set) var phase: SessionPhase = .idle

    /// Where the worker put this device, in the event's frame. `nil` until it
    /// has enough edges to place it — a device with no point renders nothing.
    public private(set) var point: Vector3?

    public private(set) var cue: Cue?

    private let policy: SessionPolicy
    private let unitRandom: () -> Double

    private var backoff: Backoff
    private var plan: RangingPlan
    private var sweep: Sweep
    private var gate: LocationGate

    /// The most recent fix, sent or not. `JOIN` needs one and the gate does not
    /// apply to it.
    private var lastFix: Location?

    /// Tokens peers handed over, kept so a pairing that could not start when it
    /// arrived can start later without waiting for the peer to send again.
    private var tokens: [String: String] = [:]

    private var rangingAvailable = true
    private var retryAt: Double = 0
    private var nextSweepAt: Double = 0

    public init(
        deviceId: String,
        policy: SessionPolicy = SessionPolicy(),
        maxPeers: Int = 16,
        unitRandom: @escaping () -> Double = { Double.random(in: 0..<1) }
    ) {
        self.deviceId = deviceId
        self.policy = policy
        self.unitRandom = unitRandom

        backoff = policy.backoff
        plan = RangingPlan(maxPeers: maxPeers)
        sweep = Sweep(
            noiseFloorMeters: policy.rangingNoiseFloorMeters,
            silentSweepsBeforeRetraction: policy.silentSweepsBeforeRetraction
        )
        gate = LocationGate(
            floorMeters: policy.locationFloorMeters,
            improvementFactor: policy.accuracyImprovementFactor
        )
    }

    /// Peers with a radio session open, for anyone drawing a status line.
    public var rangingPeers: [String] {
        plan.peers.sorted()
    }

    public var diagnostics: SessionDiagnostics {
        SessionDiagnostics(
            phase: phase,
            deviceId: deviceId,
            maxPeers: plan.maxPeers,
            assignedPeers: plan.assignedPeers,
            courtingPeers: plan.courtingPeers,
            sentDistances: sweep.sentDistances,
            pendingDistances: sweep.pendingDistances,
            silentSweeps: sweep.silentSweeps,
            rangingAvailable: rangingAvailable,
            point: point,
            cue: cue
        )
    }

    /// How brightly this device should be lit, right now. 0 whenever it has no
    /// point, no cue, or the cue's pass has already gone by.
    public func brightness(at now: Double) -> Double {
        guard let point, let cue else { return 0 }

        return effectBrightness(
            cue.effect,
            at: point,
            center: cue.center,
            elapsedSeconds: now - cue.arrivedAt
        )
    }

    public func handle(_ input: SessionInput, at now: Double) -> [SessionCommand] {
        switch input {
        case .start: start()
        case .stop: stop()
        case .opened: opened(at: now)
        case let .closed(code): closed(code: code, at: now)
        case let .received(frame): receive(frame, at: now)
        case let .located(fix): locate(fix, at: now)
        case let .minted(token, peer): mint(token, for: peer)
        case let .measured(distance, peer): measure(distance, from: peer)
        case let .lostPeer(peer): lose(peer)
        case let .network(available): network(available, at: now)
        case .rangingUnavailable: radioGone()
        case .tick: tick(at: now)
        }
    }

    private func start() -> [SessionCommand] {
        guard phase == .idle || phase == .stopped || phase == .waiting else { return [] }

        backoff.reset()
        phase = .connecting

        return [.connect]
    }

    private func stop() -> [SessionCommand] {
        point = nil
        cue = nil
        guard phase != .stopped else { return [] }

        let commands = teardown() + [.disconnect]
        phase = .stopped

        return commands
    }

    private func opened(at now: Double) -> [SessionCommand] {
        guard phase == .connecting else { return [] }

        backoff.reset()

        guard let fix = lastFix else {
            phase = .joining

            return []
        }

        return join(with: fix, at: now)
    }

    private func join(with fix: Location, at now: Double) -> [SessionCommand] {
        phase = .joined

        // The join is the first thing the server hears about this position, so
        // the gate starts from it rather than from nothing.
        _ = gate.admit(fix)

        // Spread out, because everybody who was just disconnected is joining on
        // the same second and would otherwise sweep on the same second forever.
        nextSweepAt = now + unitRandom() * policy.sweepSeconds

        return [.send(.join(deviceId: deviceId, location: fix))]
    }

    private func closed(code: Int, at now: Double) -> [SessionCommand] {
        guard phase != .stopped else { return [] }

        let commands = teardown()

        guard !terminalCloseCodes.contains(code) else {
            phase = .stopped

            return commands
        }

        phase = .waiting
        retryAt = now + backoff.next(unitRandom)

        return commands
    }

    private func receive(_ frame: DeviceInbound, at now: Double) -> [SessionCommand] {
        switch frame {
        case let .setPoint(position):
            point = position.simulated.relative

            return []

        case let .setNeighbors(peers):
            guard rangingAvailable else { return [] }

            let change = plan.assign(peers)

            for peer in change.stop { tokens[peer] = nil }

            return change.stop.map { .endRanging(peer: $0) }
                + change.start.flatMap { peer in
                    // Held from before the server named this peer: their side
                    // reached the pairing first, which happens whenever the two
                    // assignments are cut a second apart.
                    if let token = tokens[peer] {
                        [SessionCommand.beginRanging(peer: peer),
                         .configureRanging(peer: peer, token: token)]
                    } else {
                        [SessionCommand.beginRanging(peer: peer)]
                    }
                }

        case let .effect(effect, center):
            cue = Cue(effect: effect, center: center, arrivedAt: now)

            return []

        case let .peerToken(peer, token):
            guard rangingAvailable else { return [] }

            tokens[peer] = token

            if plan.court(peer) {
                return [.beginRanging(peer: peer), .configureRanging(peer: peer, token: token)]
            }

            // Refused, because the radio is already carrying as much as it can.
            guard plan.peers.contains(peer) else { return [] }

            return [.configureRanging(peer: peer, token: token)]
        }
    }

    private func locate(_ fix: Location, at now: Double) -> [SessionCommand] {
        lastFix = fix

        switch phase {
        case .joining:
            return join(with: fix, at: now)

        case .joined:
            guard let admitted = gate.admit(fix) else { return [] }

            return [.send(.locationUpdate(admitted))]

        default:
            return []
        }
    }

    private func mint(_ token: String, for peer: String) -> [SessionCommand] {
        guard phase == .joined, plan.peers.contains(peer) else { return [] }

        return [.send(.peerToken(peer: peer, token: token))]
    }

    private func measure(_ distance: Double, from peer: String) -> [SessionCommand] {
        guard plan.peers.contains(peer) else { return [] }

        sweep.record(distance, from: peer)

        return []
    }

    private func lose(_ peer: String) -> [SessionCommand] {
        tokens[peer] = nil

        // The edge is not retracted here. It goes out with the next sweep, as a
        // `null`, because that is the frame the server reads retractions from.
        guard plan.lost(peer) else { return [] }

        return [.endRanging(peer: peer)]
    }

    private func network(_ available: Bool, at now: Double) -> [SessionCommand] {
        if available {
            guard phase == .offline else { return [] }

            // Straight back, no wait: the reason for waiting was the network,
            // and it just came back.
            backoff.reset()
            phase = .connecting

            return [.connect]
        }

        switch phase {
        case .connecting, .joining, .joined:
            let commands = teardown() + [.disconnect]
            phase = .offline

            return commands

        case .waiting:
            phase = .offline

            return []

        default:
            return []
        }
    }

    private func radioGone() -> [SessionCommand] {
        rangingAvailable = false

        // The sweep is left alone on purpose: it still holds the edges this
        // device reported, and with nothing left to range they go out as
        // retractions on the next drain. A phone with no radio is still a GPS
        // anchor, and the worker can use one.
        return plan.clear().map { .endRanging(peer: $0) }
    }

    private func tick(at now: Double) -> [SessionCommand] {
        switch phase {
        case .waiting:
            guard now >= retryAt else { return [] }

            phase = .connecting

            return [.connect]

        case .joined:
            guard now >= nextSweepAt else { return [] }

            // From now rather than from the missed deadline, so a stall does not
            // come back as a burst of sweeps nobody measured.
            nextSweepAt = max(now, nextSweepAt + policy.sweepSeconds)

            let frame = sweep.drain(ranging: plan.peers)

            return frame.isEmpty ? [] : [.send(.distances(frame))]

        default:
            return []
        }
    }

    /// Everything the far side owns, given up. The server forgets a device that
    /// leaves, so there is nothing on the other end left to correct.
    private func teardown() -> [SessionCommand] {
        let peers = plan.clear()

        sweep.clear()
        gate.clear()
        tokens.removeAll()

        return peers.map { .endRanging(peer: $0) }
    }
}
