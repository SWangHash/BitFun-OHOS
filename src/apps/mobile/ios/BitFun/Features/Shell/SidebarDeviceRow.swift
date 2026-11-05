import SwiftUI

/// Device selection and reachability are independent visual states.
struct SidebarDeviceRow: View {
    let name: String
    let current: Bool
    let enabled: Bool
    let loading: Bool
    let statusColor: Color
    let statusLabel: String
    let accessibilityID: String
    let onSelect: () -> Void

    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: 8) {
                Image(systemName: "desktopcomputer")
                    .font(.system(size: 18))
                    .frame(width: 24, height: 20)
                Text(name)
                    .font(.system(size: 14, weight: current ? .bold : .regular))
                    .lineLimit(1)
                Spacer(minLength: 0)
                if loading {
                    ProgressView().controlSize(.small)
                } else {
                    Circle().fill(statusColor).frame(width: 8, height: 8)
                }

            }
            // Explicit styling prevents disabled/default button tint from implying
            // that a collapsed or unselected device has disconnected.
            .foregroundStyle(BitFunTheme.sidebarInk)
            .padding(.leading, 8)
            .padding(.trailing, 4)
            .frame(height: 52)
            .background(current ? BitFunTheme.sidebarSelection : BitFunTheme.transparent, in: RoundedRectangle(cornerRadius: 10))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .accessibilityAddTraits(current ? .isSelected : [])
        .accessibilityIdentifier(accessibilityID)
        .accessibilityLabel(Text(name))
        .accessibilityValue(Text(statusLabel))
    }
}
