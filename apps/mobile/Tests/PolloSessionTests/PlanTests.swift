import Testing

@testable import PolloSession

/**
 The ceiling on concurrent radio sessions is the largest energy dial this app
 has, so the plan has to hold it whatever order things happen in.

 Every call is hoisted into a `let` first: `#expect` puts its argument inside a
 closure so it can report on the pieces, and a mutating method cannot be called
 from in there.
 */
@Suite struct Plan {
    @Test func theAssignmentIsCappedAtWhatTheRadioIsAskedToCarry() {
        var plan = RangingPlan(maxPeers: 3)

        let change = plan.assign(["a", "b", "c", "d", "e"])

        #expect(change.start == ["a", "b", "c"])
        #expect(plan.peers.count == 3)
    }

    @Test func aPeerBeingObligedGivesWayToOneTheServerAskedFor() {
        var plan = RangingPlan(maxPeers: 2)

        let assigned = plan.assign(["a"])
        #expect(assigned.start == ["a"])

        let courted = plan.court("y")
        #expect(courted)

        // Full, so the third pairing never opens.
        let refused = plan.court("z")
        #expect(!refused)

        let change = plan.assign(["a", "b"])

        #expect(change.stop == ["y"])
        #expect(change.start == ["b"])
    }

    /// Leaving the assignment is not leaving: the peer still has a session open
    /// against this device, and dropping it would cost that peer its edge.
    @Test func aPeerThatHandedOverATokenStaysWhenTheListMovesOn() {
        var plan = RangingPlan(maxPeers: 8)

        let courted = plan.court("y")
        #expect(courted)

        _ = plan.assign(["a"])
        let change = plan.assign(["b"])

        #expect(change.stop == ["a"])
        #expect(change.start == ["b"])
        #expect(plan.peers == ["b", "y"])

        // Already ranging, so its token opens nothing new.
        let again = plan.court("b")
        #expect(!again)
    }

    @Test func aPeerTheRadioLostLeavesBothLists() {
        var plan = RangingPlan(maxPeers: 8)

        _ = plan.assign(["a"])
        let courted = plan.court("y")
        #expect(courted)

        let lostAssigned = plan.lost("a")
        let lostCourted = plan.lost("y")
        let lostTwice = plan.lost("a")

        #expect(lostAssigned)
        #expect(lostCourted)
        #expect(!lostTwice)
        #expect(plan.peers.isEmpty)

        // The retry is the next assignment naming it again, at the server's
        // refresh cadence rather than as fast as the radio can fail.
        let back = plan.assign(["a"])
        #expect(back.start == ["a"])
    }
}
