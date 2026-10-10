import SwiftUI

/// Native rendering of the mobile startup_brand_reveal contract; no network dependencies.
struct StartupBrandReveal: View {
    let onFinished: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var started = Date()
    private let widths: [CGFloat] = [30,25,24,25,28,10,16,24,25,25]
    private let letters = Array("OpenBıtFun")

    var body: some View {
        GeometryReader { geometry in
            TimelineView(.animation) { timeline in
                let p = min(1, max(0, timeline.date.timeIntervalSince(started) / (MobileDesignMotion.startupBrand / 1000)))
                let scale = min(1, max(0.1, (geometry.size.width - 32) / 280))
                ZStack {
                    BitFunTheme.page
                    stage(progress: p)
                        .frame(width: 280, height: 240)
                        .scaleEffect(scale)
                }
                .frame(width: geometry.size.width, height: geometry.size.height)
                .opacity(1 - smooth((p - 0.97) / 0.03))
            }
        }
        .ignoresSafeArea()
        .contentShape(Rectangle())
        .onTapGesture { }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("BitFun")
        .accessibilityIdentifier("startup.brand")
        .task {
            guard !reduceMotion else { onFinished(); return }
            started = Date()
            do {
                try await Task.sleep(nanoseconds: UInt64(MobileDesignMotion.startupBrand * 1_000_000))
                onFinished()
            } catch { /* The overlay was removed or the scene backgrounded. */ }
        }
        .onChange(of: reduceMotion) { if $0 { onFinished() } }
    }

    private func stage(progress p: Double) -> some View {
        let t = min(p / 0.65 * 0.9, 0.9)
        let settle = smooth((p - 0.66) / 0.19)
        let mark = max(0, min(1, (p - 0.66) / 0.19))
        let q = mark - 1
        let markScale = 0.65 + 0.35 * (1 + 2.2*q*q*q + 1.2*q*q)
        return ZStack(alignment: .topLeading) {
            WelcomeBrandFlowView()
                .frame(width: 92, height: 92)
                .scaleEffect(markScale).opacity(ease(mark))
                .position(x: 140, y: 60)
            Canvas { context, _ in
                for i in 0..<letters.count {
                    let start = 0.19 + Double(i) * 0.048
                    let reveal = ease((t - start) / 0.05)
                    let phase = max(0, min(1, (t - start) / 0.085))
                    let bounce = sin(phase * .pi) * pow(1 - phase, 0.65)
                    let center = CGPoint(x: x(i) + widths[i] / 2,
                                         y: 110 + 42*settle + 7*(1-reveal)-8*bounce)
                    var glyphContext = context
                    glyphContext.opacity = reveal
                    glyphContext.translateBy(x: center.x, y: center.y)
                    glyphContext.rotate(by: .degrees((i % 2 == 0 ? -1 : 1) * bounce * 6))
                    let glyph = Text(String(letters[i]))
                        .font(.system(size: MobileDesignTypography.brandWordmark.size, weight: .medium, design: .rounded))
                        .foregroundColor(BitFunTheme.ink)
                    glyphContext.draw(glyph, at: .zero)
                }
                let dot = dotPose(t: t, settle: settle)
                let halo = sin(max(0, min(1, (t - 0.86) / 0.04)) * .pi)
                context.fill(Path(ellipseIn: CGRect(x: dot.x-11,y:dot.y-11,width:22,height:22)),
                             with: .color(MobileDesignColors.brandDot.opacity(0.16 * halo)))
                let bounds = CGRect(x: dot.x-4.5*dot.sx, y:dot.y-4.5*dot.sy,
                                    width:9*dot.sx, height:9*dot.sy)
                context.fill(Path(ellipseIn: bounds), with: .color(MobileDesignColors.brandDot.opacity(ease(t/0.12))))
            }
        }
    }

    private func x(_ index: Int) -> CGFloat { 24 + widths.prefix(index).reduce(0, +) }
    private func dotPose(t: Double, settle: Double) -> DotPose {
        var dot = DotPose(x: 9, y: 110, sx: 1, sy: 1)
        for i in 0..<10 {
            let end = 0.19 + Double(i) * 0.048
            let begin = i == 0 ? end - 0.065 : end - 0.048
            let from = i == 0 ? 9 : x(i) + 10
            let to = x(i+1) + 10
            if t >= end { dot.x = to; continue }
            if t >= begin {
                let step = max(0, min(1, (t-begin)/(end-begin)))
                let hop = max(0, min(1, (step-0.16)/0.84))
                let squash = sin(max(0, min(1, step/0.16)) * .pi)
                dot.x = from + (to-from)*smooth(hop)
                dot.y -= 4*hop*(1-hop)*(i == 0 ? 20 : 15)
                dot.sx = 1+0.2*squash; dot.sy = 1-0.18*squash
            }
            break
        }
        if t >= 0.70 {
            let flight = max(0, min(1, (t-0.70)/0.16))
            let travel = smooth(flight)
            dot.x += (x(5)+5-dot.x)*travel
            dot.y = 110-15*travel-sin(.pi*flight)*44
            dot.sx = 1+(7.35/9-1)*travel; dot.sy = dot.sx
            if t > 0.86 && t < 0.9 { dot.y -= sin((t-0.86)/0.04 * .pi)*2 }
        }
        dot.y += 42*settle
        return dot
    }
    private struct DotPose { var x: CGFloat; var y: CGFloat; var sx: CGFloat; var sy: CGFloat }
    private func smooth(_ x: Double) -> Double { let v=max(0,min(1,x));return v*v*(3-2*v) }
    private func ease(_ x: Double) -> Double { 1-pow(1-max(0,min(1,x)),3) }
}


/// Same fixed diagonal mark as the desktop AboutBrandMark, with slow highlights.
struct WelcomeBrandFlowView: View {
    var sweep = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase

    /// The shared 256-unit geometry, recorded for native renderers in
    /// `design-system/assets/welcome-brand-contours.json`.
    private static let markLength: CGFloat = 1261.949
    private static let mark: Path = {
        let subpaths: [[CGFloat]] = [
            [
                66.56, 16, 67.84, 16, 67.84, 32.64, 70.4, 48, 74.24, 59.52, 82.56, 74.24, 96, 88.96, 131.2,
                115.84, 147.84, 131.84, 152.96, 138.88, 158.72, 152.32, 158.72, 168.96, 151.68, 183.04,
                137.6, 195.2, 122.88, 201.6, 113.92, 203.52, 101.76, 202.88, 108.8, 201.6, 120.96, 195.84,
                130.56, 187.52, 134.4, 181.76, 136.96, 174.72, 137.6, 165.76, 132.48, 151.04, 122.24, 138.88,
                88.32, 112, 71.04, 96, 58.88, 80.64, 51.84, 64, 50.56, 44.16, 52.48, 35.84, 58.88, 23.68
            ],
            [
                52.48, 82.56, 58.24, 95.36, 65.28, 104.96, 80, 119.04, 113.28, 143.36, 126.72, 157.44,
                130.56, 166.4, 130.56, 176, 126.72, 184.96, 119.04, 192.64, 112.64, 195.2, 117.12, 188.16,
                117.12, 179.2, 111.36, 168.32, 103.04, 161.28, 71.68, 141.44, 56.32, 124.8, 51.2, 114.56,
                48.64, 103.04, 49.28, 91.52
            ],
            [
                199.68, 116.48, 206.72, 117.12, 212.48, 120.32, 223.36, 120.96, 232.96, 124.8, 211.84,
                123.52, 200.96, 126.72, 191.36, 132.48, 172.8, 163.2, 158.08, 178.56, 162.56, 169.6, 163.2,
                161.28, 172.16, 150.4, 184.96, 126.08, 191.36, 119.04
            ],
            [
                111.36, 179.2, 112.64, 179.2, 113.28, 182.4, 112.64, 188.16, 106.24, 197.12, 93.44, 202.88,
                58.24, 211.2, 39.68, 218.88, 26.24, 229.76, 19.84, 240.64, 24.32, 223.36, 30.72, 211.84,
                35.2, 207.36, 42.88, 202.88, 54.4, 199.04, 97.28, 190.72, 106.24, 186.24
            ],
        ]
        var path = Path()
        for flat in subpaths {
            path.move(to: CGPoint(x: flat[0], y: flat[1]))
            for index in stride(from: 2, to: flat.count, by: 2) {
                path.addLine(to: CGPoint(x: flat[index], y: flat[index + 1]))
            }
            path.closeSubpath()
        }
        return path
    }()

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0/30, paused: reduceMotion || scenePhase != .active)) { timeline in
            let phase = timeline.date.timeIntervalSince1970.truncatingRemainder(dividingBy: 18)/18
            Canvas { context,size in
                context.scaleBy(x: size.width/256,y: size.height/256)
                let ink = BitFunTheme.ink
                if sweep {
                    let progress = timeline.date.timeIntervalSince1970.truncatingRemainder(dividingBy: 5)/5
                    let shift = reduceMotion ? 0 : (min(1, progress/0.75)*2-1)*256
                    let stops: [Gradient.Stop] = [
                        .init(color: ink.opacity(0.16), location: 0),
                        .init(color: ink.opacity(0.25), location: 0.46),
                        .init(color: ink, location: 0.55),
                        .init(color: ink.opacity(0.25), location: 0.65),
                        .init(color: ink.opacity(0.16), location: 1)
                    ]
                    context.fill(Self.mark, with: .linearGradient(Gradient(stops: stops),
                        startPoint: CGPoint(x: shift, y: shift), endPoint: CGPoint(x: shift+256, y: shift+256)))
                    return
                }
                context.fill(Self.mark,with: .color(ink.opacity(0.25)))
                if !reduceMotion {
                    for (layer,length) in [0.34,0.26,0.18].enumerated() {
                        let total=Self.markLength
                        context.stroke(Self.mark,with: .color(ink.opacity([0.12,0.14,0.36][layer])),
                            style: StrokeStyle(lineWidth: 1,dash: [total*length/2,total*(1-length),total*length/2,0],dashPhase: -total*phase))
                    }
                }
            }
        }.accessibilityHidden(true)
    }
}
