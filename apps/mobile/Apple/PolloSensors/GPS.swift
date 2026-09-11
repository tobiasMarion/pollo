@preconcurrency import CoreLocation
import PolloWire

private let unknownVerticalAccuracyMeters = 100.0

func location(from fix: CLLocation, now: Date = Date()) -> Location? {
    guard abs(fix.timestamp.timeIntervalSince(now)) < 15,
          fix.horizontalAccuracy.isFinite, fix.horizontalAccuracy > 0,
          CLLocationCoordinate2DIsValid(fix.coordinate) else { return nil }

    let altitude = fix.ellipsoidalAltitude.isFinite ? fix.ellipsoidalAltitude : 0
    let verticalAccuracy = fix.verticalAccuracy.isFinite && fix.verticalAccuracy > 0
        ? fix.verticalAccuracy
        : max(fix.horizontalAccuracy, unknownVerticalAccuracyMeters)

    return Location(latitude: fix.coordinate.latitude, longitude: fix.coordinate.longitude,
        horizontalAccuracy: fix.horizontalAccuracy, altitude: altitude,
        verticalAccuracy: verticalAccuracy)
}

@MainActor public final class GPS: NSObject, LocationSource, @preconcurrency CLLocationManagerDelegate {
    public var onLocation: ((Location) -> Void)?
    public var onError: ((String) -> Void)?
    private let manager = CLLocationManager()
    private var active = false
    public override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 1
    }
    public func start() {
        active = true
        locationManagerDidChangeAuthorization(manager)
    }
    public func stop() { active = false; manager.stopUpdatingLocation() }
    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard active else { return }
        switch manager.authorizationStatus {
        case .notDetermined: manager.requestWhenInUseAuthorization()
        case .authorizedAlways, .authorizedWhenInUse: manager.startUpdatingLocation()
        default: onError?("Permita a localização nos Ajustes para encontrar seu evento.")
        }
    }
    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard active, let fix = locations.last, let value = location(from: fix) else { return }
        onLocation?(value)
    }
    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        guard active else { return }
        if (error as? CLError)?.code == .locationUnknown { return }
        onError?("Não foi possível obter sua localização. Verifique os Ajustes e tente novamente.")
    }
}
