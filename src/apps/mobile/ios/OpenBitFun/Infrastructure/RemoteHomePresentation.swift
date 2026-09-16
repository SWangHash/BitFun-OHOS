// Presentation of the current remote target, independent of conversation navigation.
enum RemoteHomePresentation: Equatable {
    case chooseDevice, pairDevice, connecting, unavailable, loadingSessions, ready

    static func resolve(signedIn: Bool, hasTarget: Bool, connected: Bool,
                        reconnecting: Bool, sessionsLoaded: Bool) -> Self {
        guard hasTarget else { return signedIn ? .chooseDevice : .pairDevice }
        if reconnecting { return .connecting }
        guard connected else { return .unavailable }
        return sessionsLoaded ? .ready : .loadingSessions
    }
}
