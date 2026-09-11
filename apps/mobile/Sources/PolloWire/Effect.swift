import Foundation

/// `relative` measures from the event origin, `absolute` from the earth frame.
public enum CoordinateType: String, Codable, Sendable {
    case absolute = "ABSOLUTE"
    case relative = "RELATIVE"
}

/// Axis a front travels along — `x` east, `y` north, `z` up.
public enum Axis: String, Codable, Sendable {
    case x = "X"
    case y = "Y"
    case z = "Z"
}

/// A ring travelling outwards from the center of the field.
public struct PulseEffect: Codable, Equatable, Sendable {
    public var coordinateType: CoordinateType
    /// How long a single pixel stays lit once its turn comes, in seconds.
    public var activeTime: Double
    /// Delay per meter away from the center — 0 lights everyone at once.
    public var spreadDelayPerUnit: Double
}

/// A front sweeping across the field along one axis.
public struct WaveEffect: Codable, Equatable, Sendable {
    public var direction: Axis
    public var activeTime: Double
    /// Delay per meter along the axis, in seconds.
    public var spreadDelayPerUnit: Double
}

/// A radar arm sweeping around the center.
public struct RotateEffect: Codable, Equatable, Sendable {
    public var activeTime: Double
    /// Delay per radian of the sweep, in seconds.
    public var spreadDelayPerRadian: Double
}

/// A radar arm that also travels outwards as it turns.
public struct SpiralEffect: Codable, Equatable, Sendable {
    public var activeTime: Double
    /// How fast the arm grows outwards, in m/s.
    public var radialSpeed: Double
    /// How fast the arm turns, in rad/s.
    public var angularSpeed: Double
}

/// Every effect Pollo knows how to fire, discriminated by `name` on the wire.
public enum Effect: Equatable, Sendable {
    case pulse(PulseEffect)
    case wave(WaveEffect)
    case rotate(RotateEffect)
    case spiral(SpiralEffect)

    public enum Name: String, Codable, Sendable, CaseIterable {
        case pulse = "PULSE"
        case wave = "WAVE"
        case rotate = "ROTATE"
        case spiral = "SPIRAL"
    }

    public var name: Name {
        switch self {
        case .pulse: .pulse
        case .wave: .wave
        case .rotate: .rotate
        case .spiral: .spiral
        }
    }

    /// How long a pixel stays lit once its turn comes, in seconds.
    public var activeTime: Double {
        switch self {
        case let .pulse(effect): effect.activeTime
        case let .wave(effect): effect.activeTime
        case let .rotate(effect): effect.activeTime
        case let .spiral(effect): effect.activeTime
        }
    }
}

/// The parameters sit beside `name` rather than under it, so the payload is
/// encoded into the same container the discriminator was written to.
extension Effect: Codable {
    private enum CodingKeys: String, CodingKey {
        case name
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        switch try container.decode(Name.self, forKey: .name) {
        case .pulse: self = .pulse(try PulseEffect(from: decoder))
        case .wave: self = .wave(try WaveEffect(from: decoder))
        case .rotate: self = .rotate(try RotateEffect(from: decoder))
        case .spiral: self = .spiral(try SpiralEffect(from: decoder))
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(name, forKey: .name)

        switch self {
        case let .pulse(effect): try effect.encode(to: encoder)
        case let .wave(effect): try effect.encode(to: encoder)
        case let .rotate(effect): try effect.encode(to: encoder)
        case let .spiral(effect): try effect.encode(to: encoder)
        }
    }
}
