import Foundation
import PolloWire

@testable import PolloSession

/**
 A session with the two things it does not own held still: the clock, which the
 test moves by hand, and the randomness, which it pins.

 Both are injected rather than read from the world, and that is most of why
 there is anything to test here at all — the client this replaces did its
 waiting and its jittering inside the same objects that talked to the radio.
 */
final class Harness {
    let session: PolloSession
    var now: Double = 0

    init(policy: SessionPolicy = SessionPolicy(), maxPeers: Int = 16, random: Double = 0.5) {
        session = PolloSession(
            deviceId: "device-1",
            policy: policy,
            maxPeers: maxPeers,
            unitRandom: { random }
        )
    }

    @discardableResult
    func handle(_ input: SessionInput) -> [SessionCommand] {
        session.handle(input, at: now)
    }

    /// Started, open, and joined with one fix already through the gate.
    @discardableResult
    func join(_ location: Location = fix()) -> [SessionCommand] {
        handle(.start)
        handle(.opened)

        return handle(.located(location))
    }

    func advance(_ seconds: Double) {
        now += seconds
    }
}

/// A reading a few metres from the origin, honest about how wrong it is.
func fix(north: Double = 0, east: Double = 0, accuracy: Double = 5) -> Location {
    Location(
        latitude: north / 110_574,
        longitude: east / 111_320,
        horizontalAccuracy: accuracy,
        altitude: 0,
        verticalAccuracy: accuracy
    )
}

func point(_ x: Double, _ y: Double, _ z: Double = 0) -> NodePosition {
    let pair = PositionPair(relative: Vector3(x: x, y: y, z: z), absolute: Vector3.zero)

    return NodePosition(uncorrected: pair, simulated: pair)
}

/// Effects have no public initialiser — they only ever arrive from the wire, so
/// this is how a test gets one too.
func effect(_ json: String) throws -> Effect {
    try JSONDecoder().decode(Effect.self, from: Data(json.utf8))
}
