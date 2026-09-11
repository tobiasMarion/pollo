import PolloWire
import Testing

@testable import PolloSession

/**
 The client's behaviour, as a list of things that happened and a list of things
 it did about them.

 Everything below is a battery decision wearing a test: how often it speaks, how
 many radio sessions it keeps, and how patiently it waits before trying a socket
 that just dropped it.
 */
@Suite struct Session {
    @Test func joinsWithTheFirstFixAndNotBefore() {
        let harness = Harness()

        #expect(harness.handle(.start) == [.connect])
        #expect(harness.handle(.opened) == [])
        #expect(harness.session.phase == .joining)

        let reading = fix()

        #expect(harness.handle(.located(reading)) == [.send(.join(deviceId: "device-1", location: reading))])
        #expect(harness.session.phase == .joined)
    }

    /// The join carries a location, so the server already knows where this
    /// device is and the same reading again is not news.
    @Test func theJoinPrimesTheGate() {
        let harness = Harness()
        let reading = fix(accuracy: 5)

        harness.join(reading)

        #expect(harness.handle(.located(reading)) == [])
        #expect(harness.handle(.located(fix(north: 2, accuracy: 5))) == [])
        #expect(harness.handle(.located(fix(north: 8, accuracy: 5))).count == 1)
    }

    @Test func neighborsAreDiffedRatherThanRebuilt() {
        let harness = Harness()
        harness.join()

        #expect(
            harness.handle(.received(.setNeighbors(["a", "b", "c"]))) == [
                .beginRanging(peer: "a"), .beginRanging(peer: "b"), .beginRanging(peer: "c"),
            ]
        )

        // b and c keep the sessions they have. Rebuilding the set restarts the
        // radio for everyone every time anybody moves.
        #expect(
            harness.handle(.received(.setNeighbors(["b", "c", "d"]))) == [
                .endRanging(peer: "a"), .beginRanging(peer: "d"),
            ]
        )
    }

    /// Assignments are not symmetric, so a token from somebody this device was
    /// never told to measure is still worth a session: without it, the peer that
    /// *was* told cannot get a distance either.
    @Test func aTokenFromAStrangerOpensASession() {
        let harness = Harness()
        harness.join()

        #expect(
            harness.handle(.received(.peerToken(peer: "z", token: "T"))) == [
                .beginRanging(peer: "z"), .configureRanging(peer: "z", token: "T"),
            ]
        )
    }

    @Test func aTokenThatArrivedFirstIsUsedWhenTheServerNamesThePeer() {
        let harness = Harness(maxPeers: 1)
        harness.join()

        harness.handle(.received(.setNeighbors(["a"])))

        // Refused: the radio is full. The token is kept anyway.
        #expect(harness.handle(.received(.peerToken(peer: "b", token: "T"))) == [])

        #expect(
            harness.handle(.received(.setNeighbors(["b"]))) == [
                .endRanging(peer: "a"),
                .beginRanging(peer: "b"),
                .configureRanging(peer: "b", token: "T"),
            ]
        )
    }

    @Test func theClientHandsOverItsOwnHalfOfTheHandshake() {
        let harness = Harness()
        harness.join()
        harness.handle(.received(.setNeighbors(["a"])))

        #expect(
            harness.handle(.minted(token: "mine", for: "a"))
                == [.send(.peerToken(peer: "a", token: "mine"))]
        )

        // Nobody is ranging z, so its token is nothing this device can use.
        #expect(harness.handle(.minted(token: "mine", for: "z")) == [])
    }

    @Test func oneFramePerSweepHoweverManyReadingsArrive() {
        let harness = Harness()
        harness.join()
        harness.handle(.received(.setNeighbors(["a", "b"])))

        for _ in 0..<50 {
            harness.handle(.measured(3.0, from: "a"))
            harness.handle(.measured(4.0, from: "b"))
        }

        #expect(harness.handle(.tick) == [])

        // Half of the two-second window, because the harness pins the stagger.
        harness.advance(1)

        #expect(
            harness.handle(.tick) == [
                .send(
                    .distances([
                        PolloWire.Measurement(to: "a", distance: 3.0),
                        PolloWire.Measurement(to: "b", distance: 4.0),
                    ])
                )
            ]
        )
    }

    /// A crowd standing still produces the same numbers forever, and re-sending
    /// them tells the worker nothing it does not already believe.
    @Test func aDistanceThatDidNotChangeIsNotWorthAFrame() {
        let harness = Harness()
        harness.join()
        harness.handle(.received(.setNeighbors(["a"])))

        harness.handle(.measured(3.0, from: "a"))
        harness.advance(1)
        #expect(harness.handle(.tick).count == 1)

        harness.handle(.measured(3.02, from: "a"))
        harness.advance(2)
        #expect(harness.handle(.tick) == [])

        harness.handle(.measured(3.5, from: "a"))
        harness.advance(2)
        #expect(
            harness.handle(.tick)
                == [.send(.distances([PolloWire.Measurement(to: "a", distance: 3.5)]))]
        )
    }

    /// Absence means "not measured" on this wire, so a peer that walked out of
    /// the list has to be withdrawn out loud or its edge stands forever.
    @Test func aPeerOffTheListIsRetractedRatherThanDropped() {
        let harness = Harness()
        harness.join()
        harness.handle(.received(.setNeighbors(["a"])))
        harness.handle(.measured(3.0, from: "a"))
        harness.advance(1)
        harness.handle(.tick)

        harness.handle(.received(.setNeighbors([])))
        harness.advance(2)

        #expect(
            harness.handle(.tick)
                == [.send(.distances([PolloWire.Measurement(to: "a", distance: nil)]))]
        )
    }

    @Test func aRadioThatStoppedHearingSomebodyGivesUpAfterTwoSweeps() {
        let harness = Harness()
        harness.join()
        harness.handle(.received(.setNeighbors(["a"])))
        harness.handle(.measured(3.0, from: "a"))
        harness.advance(1)
        harness.handle(.tick)

        harness.advance(2)
        #expect(harness.handle(.tick) == [])

        harness.advance(2)
        #expect(
            harness.handle(.tick)
                == [.send(.distances([PolloWire.Measurement(to: "a", distance: nil)]))]
        )
    }

    @Test func aCloseTearsTheRadioDownAndComesBackAfterTheBackoff() {
        let harness = Harness()
        harness.join()
        harness.handle(.received(.setNeighbors(["a", "b"])))

        #expect(
            harness.handle(.closed(code: 1006)) == [
                .endRanging(peer: "a"), .endRanging(peer: "b"),
            ]
        )
        #expect(harness.session.phase == .waiting)

        // Half of a one-second ceiling, with the harness's random pinned.
        harness.advance(0.4)
        #expect(harness.handle(.tick) == [])

        harness.advance(0.2)
        #expect(harness.handle(.tick) == [.connect])
    }

    /// 4400 and 4404 are the server saying the socket was wrong, not unlucky.
    /// Retrying is how a client turns a rejection into a denial of service.
    @Test func aRejectionIsNotRetried() {
        let harness = Harness()
        harness.join()

        harness.handle(.closed(code: 4404))

        #expect(harness.session.phase == .stopped)

        harness.advance(60)

        #expect(harness.handle(.tick) == [])
    }

    @Test func closingIsClosing() {
        let harness = Harness()
        harness.join()
        harness.handle(.received(.setNeighbors(["a"])))

        #expect(harness.handle(.stop) == [.endRanging(peer: "a"), .disconnect])

        harness.advance(60)

        #expect(harness.handle(.tick) == [])
        #expect(harness.handle(.located(fix(north: 100))) == [])
    }

    /// Nothing to back off from: the wait exists because the API might be
    /// struggling, and an aeroplane is not the API struggling.
    @Test func losingTheNetworkIsNotSomethingToRetry() {
        let harness = Harness()
        harness.join()

        #expect(harness.handle(.network(available: false)) == [.disconnect])
        #expect(harness.session.phase == .offline)

        harness.advance(60)
        #expect(harness.handle(.tick) == [])

        #expect(harness.handle(.network(available: true)) == [.connect])
    }

    /// A phone with no ultra-wideband is still a GPS anchor, and the worker can
    /// use one. What it must not do is keep asking a radio that is not there.
    @Test func aPhoneWithoutARadioStillReportsWhereItIs() {
        let harness = Harness()
        harness.join()
        harness.handle(.received(.setNeighbors(["a"])))
        harness.handle(.measured(3.0, from: "a"))
        harness.advance(1)
        harness.handle(.tick)

        #expect(harness.handle(.rangingUnavailable) == [.endRanging(peer: "a")])

        harness.advance(2)

        // The edge it did report still has to be withdrawn.
        #expect(
            harness.handle(.tick)
                == [.send(.distances([PolloWire.Measurement(to: "a", distance: nil)]))]
        )

        #expect(harness.handle(.received(.setNeighbors(["a", "b"]))) == [])
        #expect(harness.handle(.located(fix(north: 50))).count == 1)
    }

    /// There is no fired-at on the wire: a cue is parameters, and every phone
    /// runs its own clock from the moment it hears one.
    @Test func aCueIsTimedFromWhenItArrived() throws {
        let harness = Harness()
        harness.join()
        harness.handle(.received(.setPoint(point(0, 0))))

        let pulse = try effect(
            #"{"name":"PULSE","coordinateType":"RELATIVE","activeTime":1,"spreadDelayPerUnit":0}"#
        )

        harness.advance(10)
        harness.handle(.received(.effect(pulse, center: Vector3.zero)))

        #expect(harness.session.brightness(at: 10) == 0)
        #expect(harness.session.brightness(at: 10.5) == 1)
        #expect(harness.session.brightness(at: 12) == 0)
    }

    @Test func nothingIsLitUntilTheWorkerHasPlacedIt() throws {
        let harness = Harness()
        harness.join()

        let pulse = try effect(
            #"{"name":"PULSE","coordinateType":"RELATIVE","activeTime":1,"spreadDelayPerUnit":0}"#
        )

        harness.handle(.received(.effect(pulse, center: Vector3.zero)))

        #expect(harness.session.brightness(at: 0.5) == 0)
    }
}
