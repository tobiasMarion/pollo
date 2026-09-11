import Foundation

public struct EventEnvelope: Codable, Sendable {
    public let event: Event
}

public struct Event: Codable, Equatable, Sendable, Identifiable {
    public enum Output: String, Codable, Sendable { case screen = "SCREEN", torch = "TORCH" }
    public enum Status: String, Codable, Sendable { case open = "OPEN", finished = "FINISHED" }
    public let id: String
    public let name: String
    public let type: Output
    public let status: Status
    public let latitude: Double
    public let longitude: Double
    public let userId: String
    public let createdAt: String
    public let updatedAt: String
}
