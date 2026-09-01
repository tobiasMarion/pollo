import PolloWire

/// A reading a few metres from the origin, honest about how wrong it is.
func fix(north: Double = 0, east: Double = 0, accuracy: Double = 5) -> Location {
    Location(
        latitude: north / 110_574,
        longitude: east / 111_320,
        horizontalAccuracy: accuracy,
        altitude: 0,
        verticalAccuracy: accuracy
    )
}
