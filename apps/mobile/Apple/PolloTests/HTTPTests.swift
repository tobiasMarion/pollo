import Foundation
import XCTest
import PolloSensors
import PolloWire

private final class FixtureProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let url = request.url!
        let status = url.host == "missing.test" ? 404 : url.host == "error.test" ? 503 : 200
        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        if status == 200 {
            let body = """
            {"event":{"id":"example","name":"Evento","type":"TORCH","status":"OPEN","latitude":0,"longitude":0,"userId":"admin","createdAt":"2026-09-09T00:00:00Z","updatedAt":"2026-09-09T00:00:00Z"}}
            """
            client?.urlProtocol(self, didLoad: Data(body.utf8))
        }
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@MainActor final class HTTPTests: XCTestCase {
    func api(_ host: String) -> HTTPEvents {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [FixtureProtocol.self]
        return HTTPEvents(base: URL(string: "https://\(host)")!, session: URLSession(configuration: configuration))
    }
    func testMissingEventIsNotANetworkFailure() async throws {
        let event = try await api("missing.test").event("id")
        XCTAssertNil(event)
    }
    func testServerFailureDoesNotMasqueradeAsEmptyDiscovery() async {
        do { _ = try await api("error.test").event("id"); XCTFail("Expected HTTP error") }
        catch APIError.http(503) {}
        catch { XCTFail("Unexpected error: \(error)") }
    }
    func testDecodesOutputMode() async throws {
        let event = try await api("success.test").event("id")
        XCTAssertEqual(event?.type, .torch)
    }
}
