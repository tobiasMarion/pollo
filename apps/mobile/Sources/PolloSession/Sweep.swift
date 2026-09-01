import PolloWire

/**
 The readings that came in since the last frame went out, and what to say about
 them.

 Ranging callbacks arrive at tens of hertz per peer; the wire wants one frame
 per sweep. `docs/scaling-io.md` §7 measured a frame per reading as eighty per
 cent of the whole system's inbound traffic, and this is the client half of the
 fix — the other half being that a crowd standing still has nothing to report at
 all.

 Deliberately no `import Foundation`: `Measurement` is a name Foundation also
 uses, and the one that matters here is the wire's.
 */
struct Sweep {
    var noiseFloorMeters: Double
    var silentSweepsBeforeRetraction: Int

    /// Readings since the last drain. Last one per peer wins — the older ones
    /// were true a few hundred milliseconds ago and nobody wants them.
    private var fresh: [String: Double] = [:]

    /// The edge the server currently believes, per peer.
    private var sent: [String: Double] = [:]

    /// Consecutive sweeps a peer with an edge on record produced nothing in.
    private var silence: [String: Int] = [:]

    init(noiseFloorMeters: Double, silentSweepsBeforeRetraction: Int) {
        self.noiseFloorMeters = noiseFloorMeters
        self.silentSweepsBeforeRetraction = silentSweepsBeforeRetraction
    }

    mutating func record(_ distance: Double, from peer: String) {
        fresh[peer] = distance
    }

    /**
     One sweep's worth of measurements, or nothing at all.

     Three states, and the wire distinguishes all three: a distance is a fresh
     reading worth having, a `null` retracts an edge that no longer holds, and a
     peer left out was simply not measured this time. Only the middle one
     removes an edge, so a peer that goes quiet has to be retracted explicitly —
     an edge nobody withdraws is indistinguishable from one that is still true.
     */
    mutating func drain(ranging: Set<String>) -> [Measurement] {
        var frame: [Measurement] = []
        var heard: Set<String> = []

        for peer in fresh.keys.sorted() {
            guard let distance = fresh[peer] else { continue }

            heard.insert(peer)

            // Heard, but no different from what the server already holds.
            if let last = sent[peer], abs(distance - last) < noiseFloorMeters { continue }

            sent[peer] = distance
            frame.append(Measurement(to: peer, distance: distance))
        }

        fresh.removeAll(keepingCapacity: true)

        for peer in sent.keys.sorted() {
            // Suppressing a reading is not the same as not getting one: a peer
            // that never moves is heard every sweep and says nothing.
            if heard.contains(peer) {
                silence[peer] = 0
                continue
            }

            if ranging.contains(peer) {
                let quiet = (silence[peer] ?? 0) + 1

                if quiet < silentSweepsBeforeRetraction {
                    silence[peer] = quiet
                    continue
                }
            }

            frame.append(Measurement(to: peer, distance: nil))
            sent[peer] = nil
            silence[peer] = nil
        }

        return frame
    }

    /// A new socket starts from nothing: the server drops a device's edges when
    /// it leaves, so there is nothing left on the other side to retract.
    mutating func clear() {
        fresh.removeAll()
        sent.removeAll()
        silence.removeAll()
    }
}
