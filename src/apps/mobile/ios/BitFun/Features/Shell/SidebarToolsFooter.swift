import SwiftUI

/// Shared by compact drawers and wide sidebars. Navigation state stays in the parent.
struct SidebarToolsFooter: View {
    let toolsTitle: String
    let settingsTitle: String
    let toolsEnabled: Bool
    let onOpenTools: () -> Void
    let onOpenSettings: () -> Void

    var body: some View {
        HStack(spacing: 0) {
            Button(action: onOpenTools) {
                Label(toolsTitle, systemImage: "wrench.and.screwdriver")
                    .labelStyle(SidebarToolsLabelStyle())
                    .padding(.horizontal, 14)
                    .frame(minWidth: 104, minHeight: 48)
                    .background(BitFunTheme.card, in: Capsule())
                    .overlay(Capsule().stroke(BitFunTheme.line, lineWidth: 0.5))
                    .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .foregroundStyle(BitFunTheme.ink)
            .disabled(!toolsEnabled)
            .opacity(toolsEnabled ? 1 : 0.45)
            .accessibilityIdentifier("sidebar.deviceTools")
            Spacer(minLength: 8)
            Button(action: onOpenSettings) {
                Image(systemName: "gearshape")
                    .font(.system(size: 20))
                    .frame(width: 48, height: 48)
                    .background(BitFunTheme.card, in: Circle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(BitFunTheme.ink)
            .accessibilityLabel(settingsTitle)
        }
        .frame(minHeight: 56)
        .padding(.leading, 12)
    }
}

private struct SidebarToolsLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 8) {
            configuration.icon.font(.system(size: 20)).frame(width: 24, height: 24)
            configuration.title.font(.system(size: 15, weight: .medium)).lineLimit(1)
        }
    }
}
