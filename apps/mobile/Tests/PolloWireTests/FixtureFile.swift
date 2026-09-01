import Foundation

/// Where the fixtures sit, relative to this file — three levels up from
/// `Tests/PolloWireTests/`. Resolved at compile time, so a test run needs no
/// working directory and no resource bundle.
func fixture(_ name: String) throws -> Data {
    let root = URL(filePath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()

    return try Data(contentsOf: root.appending(path: "Fixtures/\(name)"))
}

/// Sorted keys and one representation per number, so two encoders that agree on
/// the content are compared as equal whatever order they wrote it in.
func canonical(_ data: Data) throws -> Data {
    let object = try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])

    return try JSONSerialization.data(
        withJSONObject: object,
        options: [.sortedKeys, .fragmentsAllowed]
    )
}

/// One branch of `messages.json`, still as JSON, so it can be handed to a decoder.
func frames(_ direction: String) throws -> Data {
    let root = try JSONSerialization.jsonObject(with: fixture("messages.json"))

    guard
        let root = root as? [String: Any],
        let branch = root[direction]
    else {
        throw FixtureError.missing(direction)
    }

    return try JSONSerialization.data(withJSONObject: branch)
}

enum FixtureError: Error {
    case missing(String)
}
