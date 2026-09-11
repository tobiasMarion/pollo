import XCTest

@MainActor final class FlowTests: XCTestCase {
    func testJoinAndLeave() {
        let app = XCUIApplication()
        app.launchArguments = ["--demo"]
        app.launch()
        XCTAssertTrue(app.buttons["join"].waitForExistence(timeout: 10))
        app.buttons["join"].tap()
        XCTAssertTrue(app.buttons["leave"].waitForExistence(timeout: 5))
        app.buttons["leave"].tap()
        XCTAssertTrue(app.buttons["join"].waitForExistence(timeout: 5))
    }
    func testEmptyDiscoveryCanRetry() {
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "--empty"]
        app.launch()
        XCTAssertTrue(app.buttons["Buscar novamente"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["join"].exists)
    }
    func testScreenEffectKeepsExitAccessible() {
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "--live"]
        app.launch()
        XCTAssertTrue(app.buttons["join"].waitForExistence(timeout: 10))
        app.buttons["join"].tap()
        XCTAssertTrue(app.buttons["leave"].waitForExistence(timeout: 5))
        app.buttons["leave"].tap()
        XCTAssertTrue(app.buttons["join"].waitForExistence(timeout: 5))
    }
}
