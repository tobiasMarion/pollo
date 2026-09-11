@preconcurrency import NearbyInteraction
import Foundation
import PolloSession

@MainActor public final class Ranging: NSObject, RangingSource, @preconcurrency NISessionDelegate {
    public var onInput: ((SessionInput) -> Void)?
    public var onError: ((String) -> Void)?
    public var supported: Bool { NISession.deviceCapabilities.supportsPreciseDistanceMeasurement }
    private var sessions: [String: NISession] = [:]
    private var configurations: [String: NINearbyPeerConfiguration] = [:]
    private var retries: [String: Task<Void, Never>] = [:]
    public override init() { super.init() }
    public func begin(_ peer: String) {
        guard sessions[peer] == nil, supported else { return }
        let session = NISession()
        session.delegateQueue = .main
        session.delegate = self
        sessions[peer] = session
        guard let token = session.discoveryToken,
              let data = try? NSKeyedArchiver.archivedData(withRootObject: token, requiringSecureCoding: true) else {
            end(peer); onError?("Não foi possível iniciar a medição entre celulares."); return
        }
        onInput?(.minted(token: data.base64EncodedString(), for: peer))
    }
    public func configure(_ peer: String, token: String) {
        guard let session = sessions[peer] else { return }
        guard token.utf8.count < 65_536, let data = Data(base64Encoded: token),
              let decoded = try? NSKeyedUnarchiver.unarchivedObject(ofClass: NIDiscoveryToken.self, from: data) else {
            onInput?(.lostPeer(peer)); return
        }
        let configuration = NINearbyPeerConfiguration(peerToken: decoded)
        configurations[peer] = configuration
        session.run(configuration)
    }
    public func end(_ peer: String) {
        retries.removeValue(forKey: peer)?.cancel()
        let session = sessions.removeValue(forKey: peer)
        configurations.removeValue(forKey: peer)
        session?.delegate = nil
        session?.invalidate()
    }
    public func stop() { for peer in Array(sessions.keys) { end(peer) } }
    private func peer(_ session: NISession) -> String? { sessions.first { $0.value === session }?.key }
    public func session(_ session: NISession, didUpdate nearbyObjects: [NINearbyObject]) {
        guard let peer = peer(session) else { return }
        for object in nearbyObjects {
            if let distance = object.distance, distance.isFinite, distance >= 0 {
                onInput?(.measured(Double(distance), from: peer))
            }
        }
    }
    public func session(_ session: NISession, didRemove nearbyObjects: [NINearbyObject], reason: NINearbyObject.RemovalReason) {
        guard let peer = peer(session) else { return }
        if reason == .timeout, let configuration = configurations[peer] {
            // A range timeout does not change the assignment. Resume the existing
            // pair after a delay; silent sweeps retract its old distance meanwhile.
            retries[peer]?.cancel()
            retries[peer] = Task { [weak self, weak session] in
                try? await Task.sleep(for: .seconds(1))
                guard !Task.isCancelled, let self, let session, self.sessions[peer] === session else { return }
                session.run(configuration)
            }
            return
        }
        onInput?(.lostPeer(peer))
    }
    public func sessionWasSuspended(_ session: NISession) {
        // Keep the pair identity; the core retracts distances after silent sweeps.
    }
    public func sessionSuspensionEnded(_ session: NISession) {
        if let peer = peer(session), let configuration = configurations[peer] { session.run(configuration) }
    }
    public func session(_ session: NISession, didInvalidateWith error: Error) {
        guard let peer = peer(session) else { return }
        onInput?(.lostPeer(peer))
        onError?("A medição entre celulares foi interrompida. Verifique a permissão de Interações Próximas e participe novamente.")
    }
}
