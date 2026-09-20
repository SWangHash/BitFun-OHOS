import Foundation

/// Installation-local presentation state, independent of accounts and app versions.
@MainActor
enum StartupRevealPreference {
    static func claim(defaults: UserDefaults = .standard) -> Bool {
        let key = "startup.brandRevealShown"
        guard !defaults.bool(forKey: key) else { return false }
        // Claim before playback so interruptions do not replay the reveal next launch.
        defaults.set(true, forKey: key)
        return true
    }
}
