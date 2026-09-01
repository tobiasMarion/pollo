import Foundation

/// A GPS reading, accuracy included. The accuracies are load-bearing: the worker
/// anchors each device to its own reading weighted by one over the variance it
/// claimed, so a device that flatters itself drags the whole reconstruction.
public struct Location: Codable, Equatable, Sendable {
    /// Decimal degrees, WGS 84.
    public var latitude: Double
    /// Decimal degrees, WGS 84.
    public var longitude: Double
    /// Radius of uncertainty of the coordinate pair, in meters.
    public var horizontalAccuracy: Double
    /// Height above the WGS 84 reference ellipsoid, in meters.
    public var altitude: Double
    /// Uncertainty of the altitude, in meters.
    public var verticalAccuracy: Double

    public init(
        latitude: Double,
        longitude: Double,
        horizontalAccuracy: Double,
        altitude: Double,
        verticalAccuracy: Double
    ) {
        self.latitude = latitude
        self.longitude = longitude
        self.horizontalAccuracy = horizontalAccuracy
        self.altitude = altitude
        self.verticalAccuracy = verticalAccuracy
    }
}

/// A point in meters.
public struct Vector3: Codable, Equatable, Sendable {
    public var x: Double
    public var y: Double
    public var z: Double

    public static let zero = Vector3(x: 0, y: 0, z: 0)

    public init(x: Double, y: Double, z: Double) {
        self.x = x
        self.y = y
        self.z = z
    }
}

/// The same point in both frames: offset from the event origin, and earth-centered.
public struct PositionPair: Codable, Equatable, Sendable {
    public var relative: Vector3
    public var absolute: Vector3

    public init(relative: Vector3, absolute: Vector3) {
        self.relative = relative
        self.absolute = absolute
    }
}

/// Where a pixel sits, before and after the simulation. `simulated.relative` is
/// what a device renders from; `uncorrected` is its own GPS wearing the same shape.
public struct NodePosition: Codable, Equatable, Sendable {
    public var uncorrected: PositionPair
    public var simulated: PositionPair

    public init(uncorrected: PositionPair, simulated: PositionPair) {
        self.uncorrected = uncorrected
        self.simulated = simulated
    }
}

/// One entry of a `DISTANCES` sweep.
public struct Measurement: Equatable, Sendable {
    /// The device that was measured.
    public var to: String
    /// Meters, or `nil` to retract an edge that no longer holds.
    public var distance: Double?

    public init(to: String, distance: Double?) {
        self.to = to
        self.distance = distance
    }
}

/**
 Hand-written rather than synthesised, for one reason.

 A synthesised encoder writes an optional with `encodeIfPresent`, which leaves
 the key out when it is `nil` — and on this wire an absent `distance` and a null
 one are different statements. Absent means the peer was never reached; null
 means an edge that used to hold no longer does, and it is the only thing that
 ever removes one. Dropping the key turns a retraction into silence, and an edge
 nobody retracts is indistinguishable from one that is still true.
 */
extension Measurement: Codable {
    private enum CodingKeys: String, CodingKey {
        case to
        case distance
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        to = try container.decode(String.self, forKey: .to)
        distance = try container.decodeIfPresent(Double.self, forKey: .distance)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)

        try container.encode(to, forKey: .to)
        try container.encode(distance, forKey: .distance)
    }
}
