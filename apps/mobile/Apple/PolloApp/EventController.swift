import Foundation
import Observation
import PolloEffects
import PolloSensors
import PolloSession
import PolloWire

@MainActor @Observable final class EventController {
  enum Phase: String {
    case locating, searching, empty, ready, connecting, positioning, live, reconnecting, failed
  }
  private(set) var phase: Phase = .locating
  private(set) var event: Event?
  private(set) var message = "Buscando sua localização…"
  private(set) var participating = false
  private(set) var brightness = 0.0
  private(set) var peers = 0
  private(set) var fix: Location?
  private(set) var positioned = false
  private(set) var diagnostics: SessionDiagnostics?
  private(set) var lastInput = "—"
  private(set) var lastUpdatedAt = Date()
  private(set) var sentFrameCount = 0
  private(set) var receivedFrameCount = 0
  private(set) var commandCount = 0
  private(set) var errorMessage: String?
  var supported: Bool { ranging.supported }
  var deviceIdentifier: String { deviceId }
  var peerLimit: Int { maxPeers }
  var canJoin: Bool { phase == .ready && supported }
  var screenMode: Bool { participating && output == .screen && positioned }
  @ObservationIgnored private let location: any LocationSource
  @ObservationIgnored private let ranging: any RangingSource
  @ObservationIgnored private let api: any EventService
  @ObservationIgnored private let transport: any EventTransport
  @ObservationIgnored private let light: any LightOutput
  @ObservationIgnored private let now: () -> Double
  @ObservationIgnored private let deviceId: String
  @ObservationIgnored private var session: PolloSession?
  @ObservationIgnored private var ticker: Task<Void, Never>?
  @ObservationIgnored private var frames: Task<Void, Never>?
  @ObservationIgnored private var discovery: Task<Void, Never>?
  @ObservationIgnored private var generation = 0
  @ObservationIgnored private var active = false
  @ObservationIgnored private var resumeEvent: String?
  @ObservationIgnored private var needsDiscovery = true
  @ObservationIgnored private let maxPeers: Int
  private var output: Event.Output? {
    guard let type = event?.type else { return nil }
    return type == .torch && !light.torchAvailable ? .screen : type
  }

  init(
    location: any LocationSource, ranging: any RangingSource, api: any EventService,
    transport: any EventTransport, light: any LightOutput, deviceId: String,
    maxPeers: Int = 16, now: @escaping () -> Double = { ProcessInfo.processInfo.systemUptime }
  ) {
    self.location = location
    self.ranging = ranging
    self.api = api
    self.transport = transport
    self.light = light
    self.deviceId = deviceId
    self.now = now
    self.maxPeers = maxPeers
    location.onLocation = { [weak self] in self?.located($0) }
    location.onError = { [weak self] in self?.fail($0) }
    ranging.onInput = { [weak self] in self?.input($0) }
    ranging.onError = { [weak self] in self?.fail($0) }
    transport.onInput = { [weak self] in self?.input($0) }
    light.onError = { [weak self] error in
      // Defer teardown until the hardware operation has released its lock.
      Task { @MainActor [weak self] in self?.fail(error) }
    }
  }
  func activate() {
    guard !active else { return }
    active = true
    retry()
  }
  func suspend() {
    resumeEvent = participating ? event?.id : nil
    active = false
    teardown()
  }
  func retry() {
    guard active else { return }
    generation += 1
    discovery?.cancel()
    discovery = nil
    needsDiscovery = true
    phase = .locating
    message = "Buscando sua localização…"
    location.start()
  }
  private func located(_ value: Location) {
    guard active else { return }
    fix = value
    input(.located(value))
    if needsDiscovery { discover(value) }
  }
  private func discover(_ value: Location) {
    needsDiscovery = false
    phase = .searching
    message = "Buscando eventos…"
    let current = generation
    let resume = resumeEvent
    resumeEvent = nil
    discovery = Task { [weak self] in
      guard let self else { return }
      do {
        let result: Event?
        if let resume {
          result = try await self.api.event(resume)
        } else {
          result = try await self.api.nearby(value)
        }
        guard !Task.isCancelled, current == self.generation, self.active else { return }
        self.event = result?.status == .open ? result : nil
        guard let event = self.event else {
          self.phase = .empty
          self.message = "Nenhum evento por perto."
          return
        }
        self.phase = .ready
        if !self.supported {
          self.message = "Este iPhone não oferece medição de distância UWB."
        } else if event.type == .torch && !self.light.torchAvailable {
          self.message = "Sua tela fará parte do espetáculo."
        } else {
          self.message = "Sua luz faz parte do espetáculo."
        }
        if resume != nil && self.canJoin { self.join() }
      } catch {
        guard !Task.isCancelled, current == self.generation else { return }
        self.fail("Não foi possível encontrar o evento. Confira sua conexão e tente novamente.")
      }
    }
  }
  func join() {
    guard canJoin, let fix, let output else { return }
    let core = PolloSession(deviceId: deviceId, maxPeers: maxPeers)
    session = core
    participating = true
    phase = .connecting
    message = "Conectando ao evento…"
    light.begin(output)
    input(.located(fix))
    input(.start)
    ticker = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: .milliseconds(250))
        guard !Task.isCancelled else { return }
        self?.input(.tick)
      }
    }
  }
  func leave() {
    resumeEvent = nil
    teardown()
    phase = event == nil ? .empty : .ready
    message = "Você saiu do evento."
    if active { location.start() }
  }
  private func fail(_ text: String) {
    resumeEvent = nil
    errorMessage = text
    teardown()
    phase = .failed
    message = text
  }
  private func teardown() {
    generation += 1
    discovery?.cancel()
    discovery = nil
    ticker?.cancel()
    ticker = nil
    frames?.cancel()
    frames = nil
    let commands = session?.handle(.stop, at: now()) ?? []
    session = nil
    execute(commands)
    transport.disconnect()
    ranging.stop()
    location.stop()
    light.stop()
    participating = false
    brightness = 0
    peers = 0
    positioned = false
    diagnostics = nil
  }
  private func input(_ value: SessionInput) {
    guard active, let session else { return }
    lastInput = String(describing: value)
    lastUpdatedAt = Date()
    receivedFrameCount += 1
    let commands = session.handle(value, at: now())
    execute(commands)
    guard self.session === session else { return }
    peers = session.rangingPeers.count
    positioned = session.point != nil
    diagnostics = session.diagnostics
    switch session.phase {
    case .joined:
      phase = session.point == nil ? .positioning : .live
      message =
        session.point == nil ? "Aguardando posicionamento…" : "Tudo pronto. Aguarde as luzes."
    case .waiting, .offline:
      phase = .reconnecting
      message = "Reconectando…"
    case .stopped:
      fail("O evento não está disponível. Busque novamente.")
    default: break
    }
    if case .received(.effect) = value { startFrames() }
    if case .received(.setPoint) = value, session.cue != nil { startFrames() }
  }
  private func execute(_ commands: [SessionCommand]) {
    commandCount += commands.count
    for command in commands {
      switch command {
      case .connect:
        if let event { transport.connect(event.id) }
      case .disconnect:
        transport.disconnect()
      case .send(let frame):
        sentFrameCount += 1
        transport.send(frame)
      case .beginRanging(let peer):
        ranging.begin(peer)
      case .configureRanging(let peer, let token):
        ranging.configure(peer, token: token)
      case .endRanging(let peer):
        ranging.end(peer)
      }
    }
  }
  private func startFrames() {
    frames?.cancel()
    frames = Task { [weak self] in
      while !Task.isCancelled {
        guard let self, let core = self.session, let cue = core.cue, let point = core.point else {
          return
        }
        let elapsed = self.now() - cue.arrivedAt
        let end =
          effectDelaySeconds(cue.effect, at: point, center: cue.center)
          + max(cue.effect.activeTime, 0.05)
        self.brightness = core.brightness(at: self.now())
        self.light.render(self.brightness)
        if elapsed >= end {
          self.brightness = 0
          self.light.render(0)
          return
        }
        try? await Task.sleep(for: .milliseconds(33))
      }
    }
  }
}
