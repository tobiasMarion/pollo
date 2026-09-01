/**
 Every number the client's behaviour turns on, in one place.

 They are defaults rather than constants because the only honest way to settle
 most of them is to measure a phone with Instruments, and a value that has to be
 re-measured should be reachable without recompiling the module that uses it.
 */
public struct SessionPolicy: Equatable, Sendable {
    /// Seconds between `DISTANCES` frames. One frame per sweep, never per
    /// reading: the radio produces readings at tens of hertz and the wire has no
    /// use for them at that rate. 0.5 Hz is what the simulator runs at.
    public var sweepSeconds: Double

    /// Metres a distance has to change before it is worth re-sending. A crowd
    /// standing still produces the same numbers forever, and re-sending them
    /// tells the worker nothing it does not already believe.
    public var rangingNoiseFloorMeters: Double

    /// Sweeps a peer may produce nothing for before the edge is retracted.
    ///
    /// A radio that stops hearing somebody reports no failure — it simply goes
    /// quiet — so silence is the only signal there is. Two matches the server's
    /// own patience with a socket, and absence alone must never retract: on this
    /// wire it means "not measured", which is a different statement.
    public var silentSweepsBeforeRetraction: Int

    /// The tightest a location gate may ever be, whatever the receiver claims.
    /// A phone asserting a perfect fix is a phone that would report its own
    /// jitter as movement, once a second, standing still.
    public var locationFloorMeters: Double

    /// How much better a fix has to be before it is worth sending from a
    /// standstill. The worker weights each anchor by one over the variance it
    /// claimed, so a receiver that just got a lock has something new to say even
    /// though it did not move.
    public var accuracyImprovementFactor: Double

    public var backoff: Backoff

    public init(
        sweepSeconds: Double = 2,
        rangingNoiseFloorMeters: Double = 0.1,
        silentSweepsBeforeRetraction: Int = 2,
        locationFloorMeters: Double = 1,
        accuracyImprovementFactor: Double = 2,
        backoff: Backoff = Backoff()
    ) {
        self.sweepSeconds = sweepSeconds
        self.rangingNoiseFloorMeters = rangingNoiseFloorMeters
        self.silentSweepsBeforeRetraction = silentSweepsBeforeRetraction
        self.locationFloorMeters = locationFloorMeters
        self.accuracyImprovementFactor = accuracyImprovementFactor
        self.backoff = backoff
    }
}

/**
 How long to wait before trying the socket again.

 Full jitter — the delay is drawn from under a ceiling that doubles — rather
 than a doubling delay, because the reason a client is reconnecting is usually
 that something happened to everyone at once. A fixed schedule reassembles the
 crowd into a queue and hands the API the same thundering herd it just survived.
 */
public struct Backoff: Equatable, Sendable {
    /// The first ceiling, in seconds.
    public var base: Double
    /// The largest the ceiling ever gets, in seconds.
    public var cap: Double

    private var ceiling: Double

    public init(base: Double = 1, cap: Double = 30) {
        self.base = base
        self.cap = cap
        ceiling = base
    }

    /// `unitRandom` yields 0..<1.
    mutating func next(_ unitRandom: () -> Double) -> Double {
        let delay = unitRandom() * ceiling

        ceiling = min(cap, ceiling * 2)

        return delay
    }

    /// A connection that opened is evidence the wait can start over.
    mutating func reset() {
        ceiling = base
    }
}
