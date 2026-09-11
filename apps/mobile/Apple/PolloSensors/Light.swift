import AVFoundation
import UIKit
import PolloWire

@MainActor public final class Light: LightOutput {
    public var onError: ((String) -> Void)?
    private let camera = AVCaptureDevice.default(for: .video)
    public var torchAvailable: Bool { camera?.hasTorch == true && camera?.isTorchAvailable == true }
    private var output: Event.Output?
    private var originalBrightness: CGFloat?
    private weak var screen: UIScreen?
    private var originalIdle: Bool?
    private var previous: Float = -1
    public init() {}
    public func begin(_ type: Event.Output) {
        stop()
        output = type
        originalIdle = UIApplication.shared.isIdleTimerDisabled
        UIApplication.shared.isIdleTimerDisabled = true
        if type == .screen {
            screen = UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .first { $0.activationState == .foregroundActive && $0.windows.contains(where: \.isKeyWindow) }?.screen
            originalBrightness = screen?.brightness
            screen?.brightness = 1
        }
    }
    public func render(_ brightness: Double) {
        guard output == .torch, let camera else { return }
        let value = Float(min(1, max(0, brightness)))
        guard value == 0 ? previous != 0 : abs(value - previous) >= 0.01 else { return }
        do {
            try camera.lockForConfiguration()
            defer { camera.unlockForConfiguration() }
            if value == 0 { camera.torchMode = .off }
            else { try camera.setTorchModeOn(level: min(value, AVCaptureDevice.maxAvailableTorchLevel)) }
            previous = value
        } catch { onError?("A lanterna não está disponível. Saia do evento e tente novamente.") }
    }
    public func stop() {
        render(0)
        output = nil
        if let originalBrightness { screen?.brightness = originalBrightness }
        screen = nil
        if let originalIdle { UIApplication.shared.isIdleTimerDisabled = originalIdle }
        originalBrightness = nil; originalIdle = nil; previous = -1
    }
}
