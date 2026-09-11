import Foundation
import Testing

@testable import PolloEffects
@testable import PolloWire

/**
 The effect maths against numbers TypeScript produced.

 A cue carries parameters, not frames: the server says "a wave, this fast" and
 every phone works out its own brightness from where it is standing. That only
 holds the crowd together while every client computes the same number, so the
 check that matters is not that this code is reasonable but that it agrees with
 the other implementation, digit for digit.
 */
@Suite struct EffectParity {
    struct Case: Decodable {
        let effect: Effect
        let point: Vector3
        let center: Vector3
        let elapsed: Double
        let delay: Double
        let brightness: Double
    }

    struct Fixtures: Decodable {
        let cases: [Case]
    }

    static func load() throws -> [Case] {
        let root = URL(filePath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()

        let data = try Data(contentsOf: root.appending(path: "Fixtures/effects.json"))

        return try JSONDecoder().decode(Fixtures.self, from: data).cases
    }

    /// Loose enough for two languages' `sin`, `atan2` and `pow` to disagree in the
    /// last places, tight enough that a wrong formula cannot hide under it.
    static let tolerance = 1e-9

    @Test func matchesTheTypeScriptToTheLastPlace() throws {
        for testCase in try Self.load() {
            let delay = effectDelaySeconds(testCase.effect, at: testCase.point, center: testCase.center)
            let brightness = effectBrightness(
                testCase.effect,
                at: testCase.point,
                center: testCase.center,
                elapsedSeconds: testCase.elapsed
            )

            #expect(
                abs(delay - testCase.delay) < Self.tolerance,
                "\(testCase.effect.name) delay at \(testCase.point)"
            )
            #expect(
                abs(brightness - testCase.brightness) < Self.tolerance,
                "\(testCase.effect.name) brightness at \(testCase.point), t=\(testCase.elapsed)"
            )
        }
    }

    /// A new effect with no fixtures behind it would pass the test above by
    /// having nothing to check.
    @Test func coversEveryEffectThereIs() throws {
        let covered = Set(try Self.load().map(\.effect.name))

        #expect(covered == Set(Effect.Name.allCases))
    }

    /// Nobody is lit before their turn or after it — the property the fixtures
    /// sample but do not state.
    @Test func staysDarkOutsideItsPass() throws {
        for testCase in try Self.load() where testCase.brightness > 0 {
            let delay = testCase.delay

            #expect(testCase.elapsed >= delay)
            #expect(testCase.elapsed <= delay + max(testCase.effect.activeTime, 0.05))
        }
    }
}
