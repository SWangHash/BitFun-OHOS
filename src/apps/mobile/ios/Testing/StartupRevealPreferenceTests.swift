import Foundation

@main
struct StartupRevealPreferenceTests {
    @MainActor static func main() {
        let suite = "startup-reveal-test-\(UUID().uuidString)"
        let first = UserDefaults(suiteName: suite)!
        defer { first.removePersistentDomain(forName: suite) }
        precondition(StartupRevealPreference.claim(defaults: first))
        precondition(!StartupRevealPreference.claim(defaults: first))
        let reopened = UserDefaults(suiteName: suite)!
        precondition(!StartupRevealPreference.claim(defaults: reopened))
        reopened.set("other-account", forKey: "account")
        precondition(!StartupRevealPreference.claim(defaults: reopened))
        print("Startup reveal persistence tests passed.")
    }
}
