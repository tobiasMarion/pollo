import Foundation
import Testing

@testable import PolloWire

/**
 The codec against fixtures written from `@pollo/contracts` itself.

 Decoding proves the client understands what the server says; re-encoding and
 comparing the JSON proves it says the same thing back, which decoding alone
 does not — a field read under the wrong name round-trips through Swift
 perfectly and is never seen by the API.
 */
@Suite struct Wire {
    @Test func everyOutboundFrameSurvivesARoundTrip() throws {
        let json = try frames("outbound")

        // A dictionary of them, so a message type the client has no case for
        // throws here rather than going unnoticed for want of a test.
        let decoded = try JSONDecoder().decode([String: DeviceOutbound].self, from: json)
        let reencoded = try JSONEncoder().encode(decoded)

        #expect(try canonical(reencoded) == canonical(json))
    }

    @Test func everyInboundFrameSurvivesARoundTrip() throws {
        let json = try frames("inbound")

        let decoded = try JSONDecoder().decode([String: DeviceInbound].self, from: json)
        let reencoded = try JSONEncoder().encode(decoded)

        #expect(try canonical(reencoded) == canonical(json))
    }

    /**
     The one a synthesised encoder gets wrong.

     `nil` means an edge that no longer holds, and it is the only thing that ever
     removes one. Written with `encodeIfPresent` the key disappears, the server
     reads a sweep that simply did not mention that peer, and the edge stays in
     the graph for good.
     */
    @Test func aRetractionIsANullAndNotAnAbsence() throws {
        let sweep = DeviceOutbound.distances([
            Measurement(to: "device-2", distance: 3.25),
            Measurement(to: "device-3", distance: nil),
        ])

        let written = try JSONEncoder().encode(sweep)
        let object = try JSONSerialization.jsonObject(with: written) as? [String: Any]
        let measurements = object?["measurements"] as? [[String: Any]]

        #expect(measurements?.count == 2)
        #expect(measurements?[1]["to"] as? String == "device-3")
        #expect(measurements?[1].keys.contains("distance") == true)
        #expect(measurements?[1]["distance"] is NSNull)
    }

    @Test func aPeerTokenIsReadTheSameWayInBothDirections() throws {
        let raw = Data(#"{"type":"PEER_TOKEN","peer":"device-9","token":"BGtleXM="}"#.utf8)

        #expect(
            try JSONDecoder().decode(DeviceInbound.self, from: raw)
                == .peerToken(peer: "device-9", token: "BGtleXM=")
        )
        #expect(
            try JSONDecoder().decode(DeviceOutbound.self, from: raw)
                == .peerToken(peer: "device-9", token: "BGtleXM=")
        )
    }

    /// A newer server saying something this build has no case for is worth
    /// dropping, not worth dropping the connection over.
    @Test func anUnknownTypeIsItsOwnError() throws {
        let raw = Data(#"{"type":"SET_WEATHER","rain":true}"#.utf8)

        #expect(throws: WireError.unknownMessageType("SET_WEATHER")) {
            try JSONDecoder().decode(DeviceInbound.self, from: raw)
        }
    }

    @Test func aCueCarriesTheCentreItIsMeasuredFrom() throws {
        let json = try frames("inbound")
        let decoded = try JSONDecoder().decode([String: DeviceInbound].self, from: json)

        guard case let .effect(effect, center) = decoded["EFFECT"] else {
            return #expect(Bool(false), "the fixture has no EFFECT frame")
        }

        #expect(effect.name == .wave)
        #expect(center != Vector3.zero)
    }
}
