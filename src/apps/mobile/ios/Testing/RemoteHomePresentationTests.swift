@main
struct RemoteHomePresentationTests {
    static func main() {
        // Exhaust the independent account, target, transport and directory facts.
        // A previous target's loaded flag must never override target/connection state.
        for signedIn in [false, true] {
            for hasTarget in [false, true] {
                for connected in [false, true] {
                    for reconnecting in [false, true] {
                        for loaded in [false, true] {
                            let state = RemoteHomePresentation.resolve(
                                signedIn: signedIn, hasTarget: hasTarget, connected: connected,
                                reconnecting: reconnecting, sessionsLoaded: loaded)
                            if !hasTarget {
                                precondition(state == (signedIn ? .chooseDevice : .pairDevice))
                            } else if reconnecting {
                                precondition(state == .connecting)
                            } else if !connected {
                                precondition(state == .unavailable)
                            } else {
                                precondition(state == (loaded ? .ready : .loadingSessions))
                            }
                            if state == .ready {
                                precondition(hasTarget && connected && !reconnecting && loaded)
                            }
                        }
                    }
                }
            }
        }
        print("Remote home presentation: all 32 state combinations passed.")
    }
}
