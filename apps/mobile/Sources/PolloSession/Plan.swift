/**
 Who this device has a radio session open with, and why.

 Two reasons, and both are necessary. The server tells each device what to
 measure, and those lists are not symmetric — it works out a spread of
 directions per device, so A is routinely asked to measure B while B is not
 asked to measure A. But ranging is a two-party act: A cannot get a distance
 unless B is also running a session against A. So a token arriving is itself a
 reason to range, or half the edges the server asked for would never be
 measured by anybody.

 The distinction is kept rather than collapsed because leaving the assignment
 stops the measuring, while a peer who is only being obliged has to stay until
 its side gives up.
 */
struct RangingPlan {
    /// The most sessions the radio is asked to keep at once.
    var maxPeers: Int

    private(set) var assigned: Set<String> = []

    /// Peers that handed over a token, in the order they did. An array because
    /// eviction has to pick somebody, and arrival order is the only ranking
    /// there is.
    private(set) var courting: [String] = []

    init(maxPeers: Int) {
        self.maxPeers = maxPeers
    }

    var peers: Set<String> {
        assigned.union(courting)
    }

    /**
     Replaces the assignment outright, and says what changed.

     Only the difference: a peer on both lists keeps the session it has. Tearing
     the set down and rebuilding it restarts the radio for everybody every time
     anyone moves, which is the single most expensive thing this client could do
     with a message that arrives every ten seconds.
     */
    mutating func assign(_ peers: [String]) -> (stop: [String], start: [String]) {
        let before = self.peers

        assigned = Set(peers.prefix(maxPeers))
        courting.removeAll { assigned.contains($0) }

        // Newest first: the oldest pairing is the one most likely to be live.
        let room = max(0, maxPeers - assigned.count)
        if courting.count > room { courting.removeLast(courting.count - room) }

        let after = self.peers

        return (stop: before.subtracting(after).sorted(), start: after.subtracting(before).sorted())
    }

    /// A peer handed over its token. `true` if that opens a session.
    mutating func court(_ peer: String) -> Bool {
        guard !peers.contains(peer), peers.count < maxPeers else { return false }

        courting.append(peer)

        return true
    }

    /**
     The radio says this peer is gone. `true` if there was a session to close.

     Dropped from the assignment too, even though the server still wants it. The
     retry is the next `SET_NEIGHBORS`, which names the peer again and reads as
     new — so a peer that cannot be reached is tried at the server's refresh
     cadence rather than as fast as the callback fires, and nothing here has to
     own a timer to make that true.
     */
    mutating func lost(_ peer: String) -> Bool {
        let known = peers.contains(peer)

        assigned.remove(peer)
        courting.removeAll { $0 == peer }

        return known
    }

    /// Everything, closed. Sorted, because a command list nobody can predict is
    /// a command list nobody can test.
    mutating func clear() -> [String] {
        let all = peers.sorted()

        assigned = []
        courting = []

        return all
    }
}
