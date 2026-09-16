import Foundation

@main
struct StreamingTextStateTests {
    @MainActor
    static func main() {
        var state = StreamingTextState()
        let text = String(repeating: "中文👨‍👩‍👧‍👦é", count: 100)
        state.update(text, active: true)
        assert(state.visible.isEmpty)
        for _ in 0..<35 {
            let previous = state.visible
            state.advance()
            assert(state.visible.hasPrefix(previous))
            assert(text.hasPrefix(state.visible))
        }
        assert(state.visible == text)
        state.update("中文", active: true)
        assert(state.visible == text && state.target == text)
        state.update(text + " tail", active: true)
        state.advance()
        state.update("corrected", active: true)
        assert(state.visible == "corrected")
        state.update("final", active: false)
        assert(state.visible == "final" && state.ticksRemaining == 0)
        state.update("", active: false)
        assert(state.visible.isEmpty)
        let restored = StreamingTextState(text: text)
        assert(restored.visible == text && restored.ticksRemaining == 0)
        let cache = StreamingRevealCache()
        cache.save("partial", for: "device-a|session-a|row-a|body")
        assert(cache.text(for: "device-a|session-a|row-a|body") == "partial")
        assert(cache.text(for: "device-b|session-a|row-a|body").isEmpty)
        assert(cache.text(for: "device-a|session-b|row-a|body").isEmpty)
        var resumed = StreamingTextState(text: cache.text(for: "device-a|session-a|row-a|body"))
        resumed.update("partial remainder", active: true)
        assert(resumed.visible == "partial")
        resumed.advance()
        assert(resumed.visible.hasPrefix("partial"))
        print("Streaming text state tests passed")
    }
}
