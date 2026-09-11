import Foundation
import Testing
import PolloWire

@Test func eventMatchesRESTContract() throws {
    let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    let data = try Data(contentsOf: root.appendingPathComponent("Fixtures/event.json"))
    let envelope = try JSONDecoder().decode(EventEnvelope.self, from: data)
    #expect(envelope.event.type == .screen)
    #expect(envelope.event.status == .open)
    let encoded = try JSONEncoder().encode(envelope)
    #expect(try JSONSerialization.jsonObject(with: encoded) as? NSDictionary == JSONSerialization.jsonObject(with: data) as? NSDictionary)
}
