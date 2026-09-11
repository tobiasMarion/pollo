import CoreLocation
import XCTest
@testable import PolloSensors

final class GPSTests: XCTestCase {
    func testTwoDimensionalFixCanDiscoverAnEvent() throws {
        let now = Date()
        let fix = CLLocation(coordinate: CLLocationCoordinate2D(latitude: -30.054267, longitude: -51.16169),
            altitude: 0, horizontalAccuracy: 5, verticalAccuracy: -1, timestamp: now)

        let value = try XCTUnwrap(location(from: fix, now: now))

        XCTAssertEqual(value.latitude, -30.054267)
        XCTAssertEqual(value.longitude, -51.16169)
        XCTAssertEqual(value.horizontalAccuracy, 5)
        XCTAssertEqual(value.verticalAccuracy, 100)
    }
}
