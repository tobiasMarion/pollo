import Testing
@testable import PolloSession

@Test func explicitStopClearsPositionAndCue() throws {
    let h = Harness()
    h.join()
    h.handle(.received(.setPoint(point(0, 0))))
    h.handle(.received(.effect(try effect("""
    {"name":"PULSE","coordinateType":"RELATIVE","activeTime":1,"spreadDelayPerUnit":0}
    """), center: .zero)))
    h.advance(0.5)
    #expect(h.session.brightness(at: h.now) > 0)
    h.handle(.closed(code: 1006))
    #expect(h.session.cue != nil)
    h.handle(.stop)
    #expect(h.session.cue == nil)
    #expect(h.session.point == nil)
    #expect(h.session.brightness(at: h.now) == 0)
}
