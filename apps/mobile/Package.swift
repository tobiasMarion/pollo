// swift-tools-version: 6.2

import PackageDescription

/**
 Only the parts of the client that no Apple framework touches.

 CoreLocation and NearbyInteraction live in the app target instead, where the
 generated Xcode project puts them. Keeping them out is what lets everything
 that decides anything — the codec, the effect maths, the session policy —
 build and be tested on a machine with no iOS SDK on it, and lets the
 sensors be swapped for fakes when it is.
 */
let package = Package(
    name: "PolloKit",
    platforms: [.iOS(.v26), .macOS(.v14)],
    products: [
        .library(name: "PolloKit", targets: ["PolloWire", "PolloEffects", "PolloSession"])
    ],
    targets: [
        .target(name: "PolloWire"),
        .target(name: "PolloEffects", dependencies: ["PolloWire"]),
        .target(name: "PolloSession", dependencies: ["PolloWire"]),

        // The fixtures are read straight off disk through `#filePath` rather than
        // bundled: they are one directory that two test targets and a Node script
        // all have to agree on, and copying them would make that three.
        .testTarget(name: "PolloWireTests", dependencies: ["PolloWire"]),
        .testTarget(name: "PolloEffectsTests", dependencies: ["PolloEffects", "PolloWire"]),
        .testTarget(name: "PolloSessionTests", dependencies: ["PolloSession", "PolloWire"]),
    ],
    swiftLanguageModes: [.v6]
)
