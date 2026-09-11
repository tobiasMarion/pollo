import Testing

@testable import PolloSession

@Suite struct Retry {
    /// Full jitter rather than a doubling delay: everything that disconnects a
    /// client disconnects the crowd, and a fixed schedule hands the API back the
    /// same herd it just survived.
    @Test func theBackoffCeilingDoublesUpToItsCapAndResets() {
        var backoff = Backoff(base: 1, cap: 4)

        #expect(backoff.next { 1 } == 1)
        #expect(backoff.next { 1 } == 2)
        #expect(backoff.next { 1 } == 4)
        #expect(backoff.next { 1 } == 4)

        // Under the ceiling, never at it.
        #expect(backoff.next { 0.25 } == 1)

        backoff.reset()

        #expect(backoff.next { 1 } == 1)
    }
}
