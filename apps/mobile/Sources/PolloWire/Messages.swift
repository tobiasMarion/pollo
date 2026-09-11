import Foundation

/// A frame this client could not make sense of.
public enum WireError: Error, Equatable, Sendable {
    /// A `type` this client has no case for — a newer server, most likely. Worth
    /// dropping rather than treating as a broken connection.
    case unknownMessageType(String)
}

private enum MessageKey: String, CodingKey {
    case type
    case deviceId
    case location
    case measurements
    case peer
    case token
    case position
    case peers
    case effect
    case center
}

/// What a device sends: where it is, how far its peers are, and how to measure it.
public enum DeviceOutbound: Equatable, Sendable {
    /// First frame of a device socket. `deviceId` is fixed for the connection.
    case join(deviceId: String, location: Location)
    case locationUpdate(Location)
    /// One sweep. Peers that were not reached are simply absent.
    case distances([Measurement])
    /// Half of a ranging handshake, addressed to `peer`.
    case peerToken(peer: String, token: String)

    var type: String {
        switch self {
        case .join: "JOIN"
        case .locationUpdate: "LOCATION_UPDATE"
        case .distances: "DISTANCES"
        case .peerToken: "PEER_TOKEN"
        }
    }
}

extension DeviceOutbound: Codable {
    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: MessageKey.self)
        let type = try container.decode(String.self, forKey: .type)

        switch type {
        case "JOIN":
            self = .join(
                deviceId: try container.decode(String.self, forKey: .deviceId),
                location: try container.decode(Location.self, forKey: .location)
            )
        case "LOCATION_UPDATE":
            self = .locationUpdate(try container.decode(Location.self, forKey: .location))
        case "DISTANCES":
            self = .distances(try container.decode([Measurement].self, forKey: .measurements))
        case "PEER_TOKEN":
            self = .peerToken(
                peer: try container.decode(String.self, forKey: .peer),
                token: try container.decode(String.self, forKey: .token)
            )
        default:
            throw WireError.unknownMessageType(type)
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: MessageKey.self)
        try container.encode(type, forKey: .type)

        switch self {
        case let .join(deviceId, location):
            try container.encode(deviceId, forKey: .deviceId)
            try container.encode(location, forKey: .location)
        case let .locationUpdate(location):
            try container.encode(location, forKey: .location)
        case let .distances(measurements):
            try container.encode(measurements, forKey: .measurements)
        case let .peerToken(peer, token):
            try container.encode(peer, forKey: .peer)
            try container.encode(token, forKey: .token)
        }
    }
}

/// What a device receives: its own position, who to measure, how, and cues.
public enum DeviceInbound: Equatable, Sendable {
    /// Where the worker placed this device — sent to this device alone.
    case setPoint(NodePosition)
    /// Peers to range against. Replaces the previous list outright.
    case setNeighbors([String])
    /// A cue, and the middle of the field it is measured from.
    case effect(Effect, center: Vector3)
    /// Half of a ranging handshake, from `peer`.
    case peerToken(peer: String, token: String)

    var type: String {
        switch self {
        case .setPoint: "SET_POINT"
        case .setNeighbors: "SET_NEIGHBORS"
        case .effect: "EFFECT"
        case .peerToken: "PEER_TOKEN"
        }
    }
}

extension DeviceInbound: Codable {
    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: MessageKey.self)
        let type = try container.decode(String.self, forKey: .type)

        switch type {
        case "SET_POINT":
            self = .setPoint(try container.decode(NodePosition.self, forKey: .position))
        case "SET_NEIGHBORS":
            self = .setNeighbors(try container.decode([String].self, forKey: .peers))
        case "EFFECT":
            self = .effect(
                try container.decode(Effect.self, forKey: .effect),
                center: try container.decode(Vector3.self, forKey: .center)
            )
        case "PEER_TOKEN":
            self = .peerToken(
                peer: try container.decode(String.self, forKey: .peer),
                token: try container.decode(String.self, forKey: .token)
            )
        default:
            throw WireError.unknownMessageType(type)
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: MessageKey.self)
        try container.encode(type, forKey: .type)

        switch self {
        case let .setPoint(position):
            try container.encode(position, forKey: .position)
        case let .setNeighbors(peers):
            try container.encode(peers, forKey: .peers)
        case let .effect(effect, center):
            try container.encode(effect, forKey: .effect)
            try container.encode(center, forKey: .center)
        case let .peerToken(peer, token):
            try container.encode(peer, forKey: .peer)
            try container.encode(token, forKey: .token)
        }
    }
}
