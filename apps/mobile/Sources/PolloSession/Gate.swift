import Foundation
import PolloWire

private let metersPerDegreeLatitude = 110_574.0
private let metersPerDegreeLongitude = 111_320.0

/**
 How far apart two fixes are, in metres.

 The same equirectangular approximation as `projectLocation` in
 `packages/geometry`, with one of the readings standing in for the origin. Two
 fixes from the same phone seconds apart are metres apart at most, and over that
 span the approximation is wrong by far less than the receiver is.

 Unlike the effect maths, nothing downstream has to agree with this number: it
 decides only whether this device bothers to speak. So it is a port without a
 parity fixture behind it, which is a deliberate exception rather than an
 oversight.
 */
func metersBetween(_ a: Location, _ b: Location) -> Double {
    let east = (b.longitude - a.longitude) * metersPerDegreeLongitude * cos(a.latitude * .pi / 180)
    let north = (b.latitude - a.latitude) * metersPerDegreeLatitude

    return (east * east + north * north).squareRoot()
}

/**
 Whether a fix is worth a frame.

 `docs/scaling-io.md` §7 calls this the highest-leverage change in the document
 relative to its size, and it is the client deciding what is worth saying: a
 reading that lands inside the uncertainty the server was already told about
 carries no information. In a seated venue that silences almost everything.

 The gate is primed by whatever went out last — including the `JOIN`, which
 carries a location of its own — so a reconnect starts from what the server
 actually knows rather than from nothing.
 */
struct LocationGate {
    var floorMeters: Double
    var improvementFactor: Double

    private var sent: Location?

    init(floorMeters: Double, improvementFactor: Double) {
        self.floorMeters = floorMeters
        self.improvementFactor = improvementFactor
    }

    /// The fix, if it says something the server has not already been told.
    mutating func admit(_ fix: Location) -> Location? {
        guard let last = sent else {
            sent = fix

            return fix
        }

        // The floor applies to both claims, not just to the movement: without
        // it a receiver reporting an accuracy of zero looks infinitely sharper
        // than whatever it said last, and every reading gets through on that.
        let claimed = max(floorMeters, last.horizontalAccuracy)
        let sharpened = max(floorMeters, fix.horizontalAccuracy)

        // Measured against what the server holds, not against the new reading:
        // the old fix is the claim being contradicted, and a phone inside the
        // radius it already declared has not moved as far as anyone can tell.
        let moved = metersBetween(last, fix) > claimed
        let sharper = sharpened * improvementFactor <= claimed

        guard moved || sharper else { return nil }

        sent = fix

        return fix
    }

    /// Forgets what the server was told, for a server that is no longer there.
    mutating func clear() {
        sent = nil
    }
}
