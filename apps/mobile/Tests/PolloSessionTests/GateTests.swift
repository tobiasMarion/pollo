import PolloWire
import Testing

@testable import PolloSession

/**
 `docs/scaling-io.md` §7 calls this the highest-leverage change in the document
 relative to its size: a phone standing still has nothing to say, and the client
 is the only thing in the system that can know that.
 */
@Suite struct Gate {
    @Test func aFixInsideTheUncertaintyAlreadyDeclaredSaysNothingNew() {
        var gate = LocationGate(floorMeters: 1, improvementFactor: 2)

        #expect(gate.admit(fix(accuracy: 10)) != nil)
        #expect(gate.admit(fix(north: 7, accuracy: 10)) == nil)
        #expect(gate.admit(fix(north: 11, accuracy: 10)) != nil)
    }

    /// A receiver claiming a perfect fix would otherwise report its own jitter
    /// as movement, once a second, from a phone on a table.
    @Test func thereIsAFloorUnderWhateverTheReceiverClaims() {
        var gate = LocationGate(floorMeters: 1, improvementFactor: 2)

        #expect(gate.admit(fix(accuracy: 0)) != nil)
        #expect(gate.admit(fix(north: 0.5, accuracy: 0)) == nil)
        #expect(gate.admit(fix(north: 1.5, accuracy: 0)) != nil)
    }

    /// The worker weights each anchor by one over the variance it claimed, so a
    /// receiver that just got a lock has something worth hearing even standing
    /// perfectly still.
    @Test func aMuchSharperFixIsWorthSendingFromAStandstill() {
        var gate = LocationGate(floorMeters: 1, improvementFactor: 2)

        #expect(gate.admit(fix(accuracy: 40)) != nil)
        #expect(gate.admit(fix(accuracy: 30)) == nil)
        #expect(gate.admit(fix(accuracy: 5)) != nil)
    }

    @Test func aGateWithNoServerBehindItStartsOver() {
        var gate = LocationGate(floorMeters: 1, improvementFactor: 2)

        #expect(gate.admit(fix(accuracy: 10)) != nil)
        gate.clear()
        #expect(gate.admit(fix(accuracy: 10)) != nil)
    }
}
