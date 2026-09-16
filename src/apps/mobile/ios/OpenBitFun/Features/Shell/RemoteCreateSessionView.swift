import OpenBitFunMobileCore
import SwiftUI
import WebKit
import UniformTypeIdentifiers
import OSLog

struct RemoteCreateSessionView: View {
    @ObservedObject var model: MobileAppModel
    let onBack: () -> Void
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @StateObject private var speech = SpeechInputController()
    @State private var instruction = ""
    @State private var harnessProfile = HarnessProfile.standard
    @Environment(\.scenePhase) private var scenePhase
    @State private var selectedWorkspacePath = ""
    @State private var selectedWorkspaceConnectionId: String?
    @State private var newWorkspacePath = ""
    @State private var directoryVisible = false
    @State private var directoryConnectionId: String?
    @State private var savedConnectionId = ""
    @State private var selectedModelID: String?
    @State private var pickerKind: RemoteCreateSelectionKind? = ProcessInfo.processInfo.arguments.contains(
        "--remote-create-workspace-picker"
    ) ? .workspace : nil
    private let log = Logger(subsystem: "com.openbitfun.mobile.ios", category: "remote-create-ui")

    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                VStack(spacing: 0) {
                    HStack {
                        Button(action: onBack) {
                            Image(systemName: "chevron.left")
                                .font(.system(size: 19, weight: .medium))
                                .foregroundStyle(OpenBitFunTheme.ink)
                                .frame(width: 44, height: 44)
                                .background(OpenBitFunTheme.card)
                                .clipShape(Circle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(model.localized("返回"))
                        Spacer()
                    }
                    .frame(height: 78, alignment: .top)
                    .padding(.leading, 18)
                    .padding(.top, 14)

                    Spacer(minLength: 12)

                    if !model.remoteConnected {
                        createStatus(message: model.localized("连接不可用，请重新连接"), retryTitle: model.localized("重试"), action: model.verifyRemoteConnection)
                    } else if let error = model.remoteCreateError ?? model.remoteCreateDeviceError ??
                                (model.workspaceLoadFailed ? (model.coreErrorMessage ?? model.localized("工作区加载失败，请重试")) : nil) {
                        createStatus(message: error, retryTitle: model.localized("重试"), action: retryCreate)
                    }

                    contextButton(
                        kind: .device,
                        icon: "desktopcomputer",
                        label: deviceLabel,
                        automationIdentifier: selectedDeviceAutomationIdentifier
                    )
                    contextButton(
                        kind: .workspace,
                        icon: selectedWorkspacePath.isEmpty ? "message" : "folder",
                        label: model.remoteCreateWorkspacePhase == .loading
                            ? model.localized("正在加载工作区") : selectedWorkspaceName,
                        automationIdentifier: selectedWorkspaceAutomationIdentifier
                    )
                    createComposer
                }
                .frame(minHeight: geometry.size.height)
            }
        }
        .background(OpenBitFunTheme.page)
        .overlayPreferenceValue(RemoteCreateSelectionAnchorKey.self) { anchors in
            GeometryReader { proxy in
                if horizontalSizeClass == .regular,
                   let kind = pickerKind,
                   let anchor = anchors[kind] {
                    let frame = proxy[anchor]
                    ZStack(alignment: .topLeading) {
                        OpenBitFunTheme.transparent
                            .contentShape(Rectangle())
                            .onTapGesture { pickerKind = nil }
                        selectionContent(kind: kind, includeHeader: false)
                            .openBitFunPopoverSurface()
                            .fixedSize(horizontal: false, vertical: true)
                            .position(
                                x: min(
                                    max(MobileDesignGeometry.popoverWidth / 2 + 8, frame.midX),
                                    proxy.size.width - MobileDesignGeometry.popoverWidth / 2 - 8
                                ),
                                y: max(120, frame.minY - selectionHeight(kind) / 2 - 8)
                            )
                    }
                }
            }
        }
        .sheet(item: compactPicker) { kind in
            selectionContent(kind: kind, includeHeader: true)
                .presentationDetents([.height(selectionHeight(kind))])
                .presentationDragIndicator(.visible)
        }
        .onAppear {
            reconcileSelectedWorkspace()
            selectedModelID = model.modelOptions.first(where: \.selected)?.id ?? model.modelOptions.first?.id
        }
        .onDisappear { speech.stop() }
        .onChange(of: scenePhase) { if $0 != .active { speech.stop() } }
        .onChange(of: model.remoteTargetEpoch) { _ in
            speech.stop()
            selectedWorkspacePath = ""
        }
        .onChange(of: model.remoteWorkspaces) { _ in
            reconcileSelectedWorkspace()
        }
    }

    private var compactPicker: Binding<RemoteCreateSelectionKind?> {
        Binding(
            get: { horizontalSizeClass == .regular ? nil : pickerKind },
            set: { pickerKind = $0 }
        )
    }

    private var deviceLabel: String {
        if model.accountRefreshing || model.accountBusy { return model.localized("正在加载") }
        return model.accountDeviceName ?? model.localized("选择桌面设备")
    }

    private var selectedWorkspaceName: String {
        guard !selectedWorkspacePath.isEmpty else { return model.localized("对话") }
        return model.remoteWorkspaces.first(where: { $0.path == selectedWorkspacePath })?.name
            ?? selectedWorkspacePath
    }

    private var selectedModel: ComposerModelOption? {
        model.modelOptions.first(where: { $0.id == selectedModelID }) ?? model.modelOptions.first
    }

    private var selectedDeviceAutomationIdentifier: String {
        guard let deviceID = model.accountSelectedDeviceID,
              !deviceID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return "remoteCreate.device.unselected"
        }
        return "remoteCreate.device.\(deviceID)"
    }

    private var selectedWorkspaceAutomationIdentifier: String {
        selectedWorkspacePath.isEmpty
            ? "remoteCreate.workspace.chat"
            : "remoteCreate.workspace.\(selectedWorkspacePath)"
    }

    private func contextButton(
        kind: RemoteCreateSelectionKind,
        icon: String,
        label: String,
        automationIdentifier: String
    ) -> some View {
        Button { pickerKind = kind } label: {
            HStack(spacing: 13) {
                Image(systemName: icon)
                    .font(.system(size: 20, weight: .medium))
                    .foregroundStyle(OpenBitFunTheme.muted)
                    .frame(width: 26, height: 26)
                Text(label)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(OpenBitFunTheme.ink)
                    .lineLimit(1)
                Image(systemName: pickerKind == kind ? "chevron.up" : "chevron.down")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(OpenBitFunTheme.muted)
                Spacer(minLength: 0)
            }
            .frame(height: 48)
            .padding(.horizontal, 28)
        }
        .buttonStyle(.plain)
        .disabled(kind == .device
            ? !model.remoteCreateInteraction.canOpenDevicePicker
            : !model.remoteCreateInteraction.canOpenWorkspacePicker)
        .accessibilityIdentifier(automationIdentifier)
        .accessibilityLabel(model.localized(kind.accessibilityLabelKey))
        .accessibilityValue(label)
        .accessibilityHint(model.localized(kind.accessibilityHintKey))
        .anchorPreference(key: RemoteCreateSelectionAnchorKey.self, value: .bounds) {
            [kind: $0]
        }
    }

    private var createComposer: some View {
        VStack(spacing: 2) {
            TextField(
                "",
                text: $instruction,
                prompt: Text(model.localized(speech.isListening ? "正在聆听" : "告诉 OpenBitFun 要做什么"))
                    .foregroundColor(speech.isListening ? OpenBitFunTheme.statusSuccess : OpenBitFunTheme.muted),
                axis: .vertical
            )
            .font(MobileDesignTypography.bodyLarge.font)
            .lineLimit(1...4)
            .accessibilityIdentifier("remoteCreate.composer.input")
            .padding(.horizontal, 6)
            .frame(minHeight: MobileDesignGeometry.composerExpandedInputRowHeight)

            HStack(spacing: 8) {
                if !selectedWorkspacePath.isEmpty,
                   HarnessProfilePolicy.shared.supported(capabilities: model.remoteHostCapabilities) {
                    Menu {
                        ForEach([HarnessProfile.minimal, .standard, .ultimate], id: \.name) { profile in
                            Button { harnessProfile = profile } label: {
                                HarnessProfileLabel(model: model, profile: profile)
                            }
                        }
                    } label: {
                        HarnessProfileLabel(model: model, profile: harnessProfile)
                    }
                    .disabled(model.remoteCreateSubmitting)
                }
                if let selectedModel {
                    Button { pickerKind = .model } label: {
                        HStack(spacing: 4) {
                            Text(selectedModel.primaryLabel)
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(OpenBitFunTheme.ink)
                                .lineLimit(1)
                            Image(systemName: pickerKind == .model ? "chevron.up" : "chevron.down")
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundStyle(OpenBitFunTheme.muted)
                        }
                        .frame(height: 34)
                    }
                    .buttonStyle(.plain)
                    .anchorPreference(key: RemoteCreateSelectionAnchorKey.self, value: .bounds) {
                        [.model: $0]
                    }
                    .accessibilityLabel(model.localized(RemoteCreateSelectionKind.model.accessibilityLabelKey))
                    .accessibilityValue(selectedModel.primaryLabel)
                    .accessibilityHint(model.localized(RemoteCreateSelectionKind.model.accessibilityHintKey))
                    .disabled(model.remoteCreateSubmitting || model.isSending)
                }
                Spacer(minLength: 0)
                Button(action: primaryAction) {
                    Group {
                        if model.remoteCreateSubmitting {
                            ProgressView()
                                .tint(OpenBitFunTheme.contentOnAction)
                        } else {
                            Image(systemName: speech.isListening ? "stop.fill" : (instruction.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "mic.fill" : "arrow.up"))
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundStyle(canSubmit ? OpenBitFunTheme.contentOnAction : OpenBitFunTheme.ink)
                        }
                    }
                    .frame(
                        width: MobileDesignGeometry.composerActionSize,
                        height: MobileDesignGeometry.composerActionSize
                    )
                    .background(canSubmit ? OpenBitFunTheme.accent : OpenBitFunTheme.soft)
                    .clipShape(Circle())
                }
                .buttonStyle(.plain)
                // A session-list refresh is not an active turn and must not disable creation here.
                .disabled(model.remoteCreateSubmitting || !model.remoteConnected)
                .accessibilityLabel(model.localized(model.remoteCreateSubmitting ? "正在加载" : (speech.isListening ? "停止语音输入" : (instruction.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "语音输入" : "发送"))))
            }
            .frame(height: MobileDesignGeometry.composerExpandedActionRowHeight)
        }
        .padding(.horizontal, 8)
        .padding(.top, 4)
        .padding(.bottom, 2)
        .frame(minHeight: MobileDesignGeometry.composerExpandedHeight)
        .background(OpenBitFunTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: MobileDesignGeometry.composerExpandedRadius))
        .shadow(color: OpenBitFunTheme.shadowSubtle, radius: 10, y: 2)
        .padding(.horizontal, MobileDesignGeometry.contentGutter)
        .padding(.top, 8)
        .padding(.bottom, 14)
    }

    private var canSubmit: Bool {
        !instruction.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            model.remoteCreateInteraction.canSubmit
    }

    private func createStatus(message: String, retryTitle: String, action: @escaping () -> Void) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.triangle")
                .foregroundStyle(OpenBitFunTheme.statusDanger)
            Text(message)
                .font(.system(size: 13))
                .foregroundStyle(OpenBitFunTheme.ink)
                .multilineTextAlignment(.leading)
            Spacer(minLength: 4)
            Button(retryTitle, action: action)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(OpenBitFunTheme.accent)
                .disabled(model.remoteCreateSubmitting || model.accountBusy)
                .accessibilityLabel(retryTitle)
                .accessibilityHint(model.localized("选择"))
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 10)
        .background(OpenBitFunTheme.soft)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(model.localized("状态")): \(message)")
    }

    private func retryCreate() {
        if model.remoteCreateError != nil {
            model.createRemoteSession(
                agentType: selectedWorkspacePath.isEmpty ? "Claw" : HarnessProfilePolicy.shared.creationAgent(profile: harnessProfile, capabilities: model.remoteHostCapabilities),
                title: "",
                instruction: instruction,
                modelID: selectedModelID,
                workspacePath: selectedWorkspacePath.isEmpty ? nil : selectedWorkspacePath,
                remoteConnectionId: selectedWorkspaceConnectionId
            )
        } else if model.workspaceLoadFailed {
            model.retryRemoteWorkspaces()
        } else {
            model.refreshRemoteDevices()
        }
    }

    private func primaryAction() {
        if speech.isListening { speech.stop(); return }
        let value = instruction.trimmingCharacters(in: .whitespacesAndNewlines)
        log.info("Remote create primary action invoked: hasInput=\(!value.isEmpty, privacy: .public) connected=\(model.remoteConnected, privacy: .public) busy=\(model.busy, privacy: .public) submitting=\(model.remoteCreateSubmitting, privacy: .public)")
        if !value.isEmpty {
            guard canSubmit else {
                log.error("Remote create primary action blocked by model state: connected=\(model.remoteConnected, privacy: .public) busy=\(model.busy, privacy: .public) submitting=\(model.remoteCreateSubmitting, privacy: .public)")
                return
            }
            model.createRemoteSession(
                agentType: selectedWorkspacePath.isEmpty ? "Claw" : HarnessProfilePolicy.shared.creationAgent(profile: harnessProfile, capabilities: model.remoteHostCapabilities),
                title: "",
                instruction: value,
                modelID: selectedModelID,
                workspacePath: selectedWorkspacePath.isEmpty ? nil : selectedWorkspacePath,
                remoteConnectionId: selectedWorkspaceConnectionId
            )
            return
        }
        if speech.isListening {
            speech.stop()
            return
        }
        speech.start(
            localeIdentifier: model.appLanguage == .simplifiedChinese ? "zh-CN" : "en-US",
            onPartial: { instruction = $0 },
            onFailure: { model.showToast(model.localized($0)) }
        )
    }

    @ViewBuilder
    private func selectionContent(kind: RemoteCreateSelectionKind, includeHeader: Bool) -> some View {
        VStack(spacing: 0) {
            if includeHeader {
                OpenBitFunSelectionHeader(title: model.localized(kind.titleKey), onClose: { pickerKind = nil })
            }
            ScrollView(showsIndicators: false) {
                VStack(spacing: 0) {
                    switch kind {
                    case .device:
                        ForEach(model.accountDevices) { device in
                            selectionRow(
                                kind: .device,
                                icon: "desktopcomputer",
                                title: device.name.isEmpty ? device.id : device.name,
                                subtitle: model.localized(device.online ? "在线" : "离线"),
                                selected: device.selected,
                                enabled: device.online || device.selected
                            ) {
                                pickerKind = nil
                                selectedWorkspacePath = ""
                                selectedWorkspaceConnectionId = nil
                                model.selectRemoteDevice(device)
                            }
                        }
                    case .workspace:
                        switch model.remoteCreateWorkspacePhase {
                        case .loading:
                            selectionStatusRow(
                                title: model.localized("正在加载工作区"),
                                showsProgress: true
                            )
                        case .failed:
                            selectionRetryRow()
                        case .unavailable:
                            selectionStatusRow(
                                title: model.localized("连接不可用，请重新连接"),
                                showsProgress: false
                            )
                        case .ready:
                            if model.workspaceSelectionBusy {
                                selectionStatusRow(
                                    title: model.localized("正在加载"),
                                    showsProgress: true
                                )
                            }
                            selectionRow(
                                kind: .workspace,
                                icon: "message",
                                title: model.localized("对话"),
                                subtitle: "",
                                selected: selectedWorkspacePath.isEmpty,
                                enabled: model.remoteCreateInteraction.canSelectWorkspace
                            ) {
                                selectedWorkspacePath = ""
                                selectedWorkspaceConnectionId = nil
                                pickerKind = nil
                            }
                            VStack {
                                TextField(model.localized("受控设备上的路径"), text: $newWorkspacePath)
                                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                                Picker(model.localized("已保存的 SSH 连接"), selection: $savedConnectionId) {
                                    Text(model.localized("受控设备本机")).tag("")
                                    ForEach(model.savedRuntimeConnections, id: \.id) { connection in
                                        Text(connection.name).tag(connection.id)
                                    }
                                }
                                if model.savedRuntimeConnectionsFailed {
                                    Text(model.localized("无法加载已保存连接，请刷新重试。")).foregroundStyle(OpenBitFunTheme.muted)
                                }
                                Button(model.localized("Browse folders")) {
                                    directoryConnectionId = savedConnectionId.isEmpty ? nil : savedConnectionId
                                    model.browseRuntimeDirectories(newWorkspacePath.isEmpty ? "/" : newWorkspacePath, connectionId: directoryConnectionId)
                                    directoryVisible = true
                                }
                                Button(model.localized("打开工作区")) {
                                    model.openRemoteWorkspacePath(newWorkspacePath, connectionId: savedConnectionId.isEmpty ? nil : savedConnectionId)
                                    pickerKind = nil
                                }
                                .disabled(newWorkspacePath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !model.remoteCreateInteraction.canSelectWorkspace)
                            }.padding()
                            ForEach(model.remoteWorkspaces) { workspace in
                                selectionRow(
                                    kind: .workspace,
                                    icon: "folder",
                                    title: workspace.name,
                                    subtitle: workspace.path,
                                    selected: workspace.path == selectedWorkspacePath,
                                    enabled: model.remoteCreateInteraction.canSelectWorkspace
                                ) {
                                    selectedWorkspacePath = workspace.path
                                    selectedWorkspaceConnectionId = workspace.remoteConnectionId
                                    pickerKind = nil
                                }
                            }
                        }
                    case .model:
                        if model.modelOptions.isEmpty {
                            Text(model.localized("暂无可用模型"))
                                .font(.system(size: 13))
                                .foregroundStyle(OpenBitFunTheme.muted)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(18)
                                .accessibilityElement()
                                .accessibilityLabel(model.localized("暂无可用模型"))
                        } else {
                            ForEach(model.modelOptions) { option in
                                selectionRow(
                                    kind: .model,
                                    icon: option.source == "LOCAL" ? "gearshape" : "cloud",
                                    title: option.primaryLabel,
                                    subtitle: option.secondaryLabel,
                                    selected: option.id == selectedModelID,
                                    enabled: true
                                ) {
                                    selectedModelID = option.id
                                    pickerKind = nil
                                }
                            }
                        }
                    }
                }
            }
        }
        .background(OpenBitFunTheme.card)
        .fullScreenCover(isPresented: $directoryVisible) {
            NavigationStack {
                VStack {
                    if let state = model.runtimeDirectoryPicker {
                        Text(state.directory).font(.caption).padding()
                        if state.busy { ProgressView() }
                        if state.failed { Text(model.localized("文件操作失败，请重试。")) }
                        List {
                            Button(model.localized("Parent folder")) { model.browseRuntimeDirectories((state.directory as NSString).deletingLastPathComponent.isEmpty ? "/" : (state.directory as NSString).deletingLastPathComponent, connectionId: directoryConnectionId) }.disabled(state.directory == "/" || state.busy)
                            ForEach(state.entries.filter { $0.directory }, id: \.path) { entry in
                                Button(entry.name) { model.browseRuntimeDirectories(entry.path, connectionId: directoryConnectionId) }.disabled(state.busy)
                            }
                            if state.hasMore { Button(model.localized("显示更多")) { model.browseRuntimeDirectories(state.directory, connectionId: directoryConnectionId, append: true) }.disabled(state.busy) }
                        }
                    }
                }.navigationTitle(model.localized("Browse folders"))
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) { Button(model.localized("返回")) { directoryVisible = false } }
                        ToolbarItem(placement: .confirmationAction) { Button(model.localized("Choose this folder")) { newWorkspacePath = model.runtimeDirectoryPicker?.directory ?? ""; directoryVisible = false }.disabled(model.runtimeDirectoryPicker?.busy != false || model.runtimeDirectoryPicker?.failed == true) }
                    }
            }
        }

    }

    private func selectionRow(
        kind: RemoteCreateSelectionKind,
        icon: String,
        title: String,
        subtitle: String,
        selected: Bool,
        enabled: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: selected ? "checkmark.circle" : "circle")
                    .font(.system(size: 19))
                    .foregroundStyle(selected ? OpenBitFunTheme.ink : OpenBitFunTheme.transparent)
                    .frame(width: 20)
                Image(systemName: icon)
                    .font(.system(size: 19, weight: .medium))
                    .foregroundStyle(OpenBitFunTheme.muted)
                    .frame(width: 24)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(OpenBitFunTheme.ink)
                        .lineLimit(1)
                    if !subtitle.isEmpty {
                        Text(subtitle)
                            .font(.system(size: 11))
                            .foregroundStyle(OpenBitFunTheme.muted)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
            }
            .frame(minHeight: 58)
            .padding(.horizontal, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.55)
        .accessibilityLabel("\(model.localized(kind.accessibilityLabelKey)): \(title)")
        .accessibilityValue(subtitle)
        .accessibilityHint(model.localized(kind.accessibilityHintKey))
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }

    private func selectionStatusRow(title: String, showsProgress: Bool) -> some View {
        HStack(spacing: 10) {
            if showsProgress {
                ProgressView().controlSize(.small)
            }
            Text(title)
                .font(.system(size: 14))
                .foregroundStyle(OpenBitFunTheme.muted)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 18)
        .frame(minHeight: 52)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(title)
    }

    private func selectionRetryRow() -> some View {
        Button {
            model.retryRemoteWorkspaces()
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "arrow.clockwise")
                Text(model.localized("工作区加载失败，请重试"))
                    .font(.system(size: 14, weight: .medium))
                Spacer(minLength: 0)
            }
            .foregroundStyle(OpenBitFunTheme.accent)
            .padding(.horizontal, 18)
            .frame(minHeight: 52)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(model.localized("重试"))
    }

    private func reconcileSelectedWorkspace() {
        if let selected = model.remoteWorkspaces.first(where: \.selected) {
            selectedWorkspacePath = selected.path
        } else if !selectedWorkspacePath.isEmpty,
                  !model.remoteWorkspaces.contains(where: { $0.path == selectedWorkspacePath }) {
            selectedWorkspacePath = ""
        }
    }

    private func selectionHeight(_ kind: RemoteCreateSelectionKind) -> CGFloat {
        let count: Int
        switch kind {
        case .device: count = max(1, model.accountDevices.count)
        case .workspace: count = max(1, model.remoteWorkspaces.count + 1)
        case .model: count = max(1, model.modelOptions.count)
        }
        let header: CGFloat = horizontalSizeClass == .regular ? 16 : MobileDesignGeometry.sheetHeaderHeight
        return min(440, header + CGFloat(count * 64) + 24)
    }
}

enum RemoteCreateSelectionKind: String, Identifiable, Hashable {
    case device
    case workspace
    case model

    var id: String { rawValue }

    /// Stable localization keys owned by the mobile W3 catalog. The view is
    /// responsible for resolving them with the active app language.
    var titleKey: String {
        switch self {
        case .device: return "桌面设备"
        case .workspace: return "工作区"
        case .model: return "选择模型"
        }
    }

    var accessibilityLabelKey: String {
        switch self {
        case .device: return "桌面设备"
        case .workspace: return "工作区"
        case .model: return "选择模型"
        }
    }

    var accessibilityHintKey: String { "选择" }
}

struct RemoteCreateSelectionAnchorKey: PreferenceKey {
    static var defaultValue: [RemoteCreateSelectionKind: Anchor<CGRect>] = [:]

    static func reduce(
        value: inout [RemoteCreateSelectionKind: Anchor<CGRect>],
        nextValue: () -> [RemoteCreateSelectionKind: Anchor<CGRect>]
    ) {
        value.merge(nextValue(), uniquingKeysWith: { _, next in next })
    }
}

struct HarnessProfileLabel: View {
    @ObservedObject var model: MobileAppModel
    let profile: HarnessProfile
    private var density: Int { profile == .minimal ? 1 : (profile == .ultimate ? 3 : 2) }
    var body: some View {
        HStack(spacing: 12) {
            HStack(spacing: 2) {
                ForEach(0..<density, id: \.self) { index in
                    RoundedRectangle(cornerRadius: 2).fill(OpenBitFunTheme.ink)
                        .frame(width: 4, height: CGFloat(8 + index * 5))
                }
            }.frame(width: 22, height: 22)
            Text(model.localized(profile == .minimal ? "极简" : (profile == .ultimate ? "极致" : "标准")))
                .font(MobileDesignTypography.titleSmall.font)
                .foregroundStyle(OpenBitFunTheme.ink)
        }
    }
}


private struct NativeRuntimeTerminalView: UIViewRepresentable {
    let state: RuntimeTerminalUiState
    let onInput: (String) -> Void
    let onResize: (Int, Int) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(context.coordinator, name: "openbitfunTerminal")
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.scrollView.isScrollEnabled = false
        context.coordinator.view = view
        if let url = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "generated") {
            view.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        }
        return view
    }
    func updateUIView(_ view: WKWebView, context: Context) { context.coordinator.parent = self; context.coordinator.render(force: false) }
    static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) {
        coordinator.disposed = true
        view.configuration.userContentController.removeScriptMessageHandler(forName: "openbitfunTerminal")
        view.stopLoading()
    }
    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        var parent: NativeRuntimeTerminalView
        weak var view: WKWebView?
        var disposed = false
        var ready = false
        var epoch: String?
        var revision: Int64 = -1
        init(_ parent: NativeRuntimeTerminalView) { self.parent = parent }
        func render(force: Bool) {
            let state = parent.state
            guard ready, !disposed, let id = state.sessionId else { return }
            guard force || epoch != id || revision != state.revision else { return }
            let reset = force || epoch != id || state.reset || state.revision != revision + 1
            let frame: [String: Any] = ["epoch": id, "revision": state.revision, "reset": reset, "data": reset ? state.output : state.chunk]
            guard let data = try? JSONSerialization.data(withJSONObject: frame), let json = String(data: data, encoding: .utf8) else { return }
            view?.evaluateJavaScript("window.OpenBitFunTerminal.accept(\(json))")
            epoch = id; revision = state.revision
        }
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard !disposed, let event = message.body as? [String: Any], let type = event["type"] as? String else { return }
            switch type {
            case "ready": ready = true; render(force: true)
            case "resync": render(force: true)
            case "input": if let data = event["data"] as? String { parent.onInput(data) }
            case "resize": if let cols = event["cols"] as? Int, let rows = event["rows"] as? Int, cols > 0, rows > 0 { parent.onResize(cols, rows) }
            default: break
            }
        }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { webView.evaluateJavaScript("window.OpenBitFunTerminal.connect()") }
        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            decisionHandler(navigationAction.request.url?.isFileURL == true ? .allow : .cancel)
        }
    }
}

private struct NativeRuntimeFileEditor: View {
    @ObservedObject var model: MobileAppModel
    @State private var content = ""
    @State private var discard = false
    @State private var rename = false
    @State private var delete = false
    @State private var renamePath = ""
    private var dirty: Bool { content != (model.runtimeFiles?.content ?? "") }
    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if let files = model.runtimeFiles {
                    Text(files.file ?? "").font(.caption).frame(maxWidth: .infinity, alignment: .leading).padding(12)
                    if files.failed { Text(model.localized("文件操作失败，请重试。")) }
                    NativeNumberedCodeEditor(text: $content, enabled: !files.busy).frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .navigationTitle(((model.runtimeFiles?.file ?? "") as NSString).lastPathComponent)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(model.localized("返回")) { if dirty { discard = true } else { model.closeRuntimeFileEditor() } }.disabled(model.runtimeFiles?.busy == true) }
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Button(model.localized("重命名打开的文件")) { renamePath = model.runtimeFiles?.file ?? ""; rename = true }
                        Button(model.localized("删除打开的文件"), role: .destructive) { delete = true }
                    } label: { Image(systemName: "ellipsis") }.disabled(dirty || model.runtimeFiles?.busy == true)
                }
                ToolbarItem(placement: .confirmationAction) { Button(model.localized("保存文件")) { model.saveRuntimeFile(content) }.disabled(!dirty || model.runtimeFiles?.busy == true) }
            }
            .onAppear { content = model.runtimeFiles?.content ?? "" }
            .onChange(of: model.runtimeFiles?.content) { content = $0 ?? "" }
            .alert(model.localized("重命名打开的文件"), isPresented: $rename) {
                TextField(model.localized("文件路径"), text: $renamePath).autocorrectionDisabled().textInputAutocapitalization(.never)
                Button(model.localized("重命名打开的文件")) { model.renameRuntimeFile(renamePath) }.disabled(renamePath.isEmpty)
                Button(model.localized("取消"), role: .cancel) { }
            }
            .confirmationDialog(model.localized("删除打开的文件"), isPresented: $delete, titleVisibility: .visible) {
                Button(model.localized("删除打开的文件"), role: .destructive) { model.deleteRuntimeFile() }
                Button(model.localized("取消"), role: .cancel) { }
            }
            .confirmationDialog(model.localized("Discard unsaved changes?"), isPresented: $discard, titleVisibility: .visible) {
                Button(model.localized("Discard"), role: .destructive) { model.closeRuntimeFileEditor() }
                Button(model.localized("取消"), role: .cancel) { }
            }
        }.interactiveDismissDisabled(dirty || model.runtimeFiles?.busy == true)
    }
}

/// UIKit owns selection, keyboard editing and scroll offsets; the gutter is presentation only.
private struct NativeNumberedCodeEditor: UIViewRepresentable {
    @Binding var text: String
    let enabled: Bool
    func makeUIView(context: Context) -> NumberedCodeEditorView {
        let view = NumberedCodeEditorView()
        view.changed = { text = $0 }
        return view
    }
    func updateUIView(_ view: NumberedCodeEditorView, context: Context) {
        view.changed = { text = $0 }
        view.editor.isEditable = enabled
        if view.editor.text != text { view.setContent(text) }
    }
}

private final class NumberedCodeEditorView: UIView, UITextViewDelegate {
    let editor = UITextView()
    private let gutter = UITextView()
    var changed: ((String) -> Void)?
    private let codeFont = UIFont.monospacedSystemFont(ofSize: 14, weight: .regular)
    private var lineCount = 0
    override init(frame: CGRect) {
        super.init(frame: frame)
        let paragraph = NSMutableParagraphStyle()
        paragraph.minimumLineHeight = 21; paragraph.maximumLineHeight = 21
        for view in [editor, gutter] {
            view.font = codeFont
            view.textContainerInset = UIEdgeInsets(top: 12, left: 12, bottom: 12, right: 12)
            view.textContainer.lineFragmentPadding = 0
            view.backgroundColor = UIColor(OpenBitFunTheme.card)
            view.textColor = UIColor(OpenBitFunTheme.ink)
            view.typingAttributes = [.font: codeFont, .paragraphStyle: paragraph]
            view.isScrollEnabled = true
            view.contentInsetAdjustmentBehavior = .never
            addSubview(view)
        }
        gutter.isEditable = false; gutter.isSelectable = false; gutter.isUserInteractionEnabled = false
        gutter.textColor = UIColor(OpenBitFunTheme.muted)
        gutter.showsVerticalScrollIndicator = false; gutter.showsHorizontalScrollIndicator = false
        editor.textContainer.widthTracksTextView = false
        editor.textContainer.heightTracksTextView = false
        editor.autocorrectionType = .no; editor.autocapitalizationType = .none
        editor.smartQuotesType = .no; editor.smartDashesType = .no; editor.smartInsertDeleteType = .no
        editor.delegate = self
        updateLines()
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func layoutSubviews() {
        super.layoutSubviews()
        let gutterWidth = max(52, CGFloat(String(max(lineCount, 1)).count) * codeFont.pointSize + 24)
        gutter.frame = CGRect(x: 0, y: 0, width: gutterWidth, height: bounds.height)
        editor.frame = CGRect(x: gutterWidth, y: 0, width: max(0, bounds.width - gutterWidth), height: bounds.height)
        updateContainerWidth()
    }
    private func updateContainerWidth() {
        let longest = editor.text.components(separatedBy: "\n").map { ($0 as NSString).size(withAttributes: [.font: codeFont]).width }.max() ?? 0
        editor.textContainer.size = CGSize(width: max(editor.bounds.width - 24, longest + 32), height: .greatestFiniteMagnitude)
    }
    func setContent(_ content: String) {
        let paragraph = NSMutableParagraphStyle(); paragraph.minimumLineHeight = 21; paragraph.maximumLineHeight = 21
        editor.attributedText = NSAttributedString(string: content, attributes: [.font: codeFont, .paragraphStyle: paragraph, .foregroundColor: UIColor(OpenBitFunTheme.ink)])
        editor.typingAttributes = [.font: codeFont, .paragraphStyle: paragraph, .foregroundColor: UIColor(OpenBitFunTheme.ink)]
        updateLines()
    }
    func updateLines() {
        let count = editor.text.components(separatedBy: "\n").count
        if count != lineCount {
            lineCount = count
            let paragraph = NSMutableParagraphStyle(); paragraph.minimumLineHeight = 21; paragraph.maximumLineHeight = 21
            gutter.attributedText = NSAttributedString(string: (1...max(count, 1)).map(String.init).joined(separator: "\n"), attributes: [.font: codeFont, .paragraphStyle: paragraph, .foregroundColor: UIColor(OpenBitFunTheme.muted)])
        }
        updateContainerWidth(); setNeedsLayout()
    }
    func textViewDidChange(_ textView: UITextView) { updateLines(); changed?(textView.text) }
    func scrollViewDidScroll(_ scrollView: UIScrollView) { gutter.contentOffset = CGPoint(x: 0, y: editor.contentOffset.y) }
}

struct NativeDeviceToolsView: View {
    @ObservedObject var model: MobileAppModel
    let terminal: Bool
    let rootPath: String
    let deviceKey: String?
    let onBack: () -> Void
    @State private var filePath = ""
    @State private var uploadPicker = false
    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if terminal {
                    if let state = model.runtimeTerminal {
                        if state.failed { Text(model.localized("终端请求失败。")) }
                        if state.busy { ProgressView() }
                        if state.sessionId != nil { NativeRuntimeTerminalView(state: state, onInput: model.writeRuntimeTerminal, onResize: model.resizeRuntimeTerminal).frame(maxWidth: .infinity, maxHeight: .infinity) }
                    }
                } else {
                    ScrollView {
                            VStack {
                                TextField(model.localized("文件路径"), text: $filePath).autocorrectionDisabled().textInputAutocapitalization(.never)
                                Button(model.localized("浏览文件")) { model.browseRuntimeFiles(filePath) }
                                if let files = model.runtimeFiles {
                                    Menu(model.localized("Sort files")) {
                                        Button(model.localized("Name: A–Z")) { model.sortRuntimeFiles(.nameAsc) }
                                        Button(model.localized("Name: Z–A")) { model.sortRuntimeFiles(.nameDesc) }
                                        Button(model.localized("Modified: newest first")) { model.sortRuntimeFiles(.modifiedDesc) }
                                        Button(model.localized("Modified: oldest first")) { model.sortRuntimeFiles(.modifiedAsc) }
                                    }
                                    Button(model.localized("Parent folder")) { model.browseRuntimeFiles((files.directory as NSString).deletingLastPathComponent.isEmpty ? "/" : (files.directory as NSString).deletingLastPathComponent) }.disabled(files.directory == "/")
                                    ForEach(files.entries, id: \.path) { entry in
                                        Button(entry.name) {
                                            if entry.directory { model.browseRuntimeFiles(entry.path) }
                                            else { model.readRuntimeFile(entry.path) }
                                        }
                                        if !entry.directory {
                                            Button(model.localized("下载")) { model.downloadWorkspaceFile(path: entry.path, label: entry.name) }
                                        }
                                    }
                                    if files.hasMore { Button(model.localized("显示更多")) { model.browseRuntimeFiles(files.directory, append: true) } }
                                    if files.failed { Text(model.localized("文件操作失败，请重试。")) }
                                }
                                Button(model.localized("Upload file")) { uploadPicker = true }.disabled(filePath.isEmpty)
                                    .fileImporter(isPresented: $uploadPicker, allowedContentTypes: [.data], allowsMultipleSelection: false) { result in
                                        guard model.remoteExpectedDeviceKey == deviceKey else { return }
                                        switch result {
                                        case .success(let urls): if let url = urls.first { model.uploadRuntimeFile(filePath, url: url) }
                                        case .failure: model.showToast(model.localized("Could not read the selected file. Choose a local file and retry."))
                                        }
                                    }
                                Button(model.localized("新建文件")) { model.createRuntimeFile(filePath) }.disabled(filePath.isEmpty)
                                if model.runtimeFiles?.file != nil {
                                    Button(model.localized("重命名打开的文件")) { model.renameRuntimeFile(filePath) }.disabled(filePath.isEmpty)
                                    Button(model.localized("删除打开的文件")) { model.deleteRuntimeFile() }
                                }
                                Button(model.localized("创建文件夹")) { model.createRuntimeDirectory(filePath) }
                            }.padding().disabled(model.runtimeFiles?.busy == true)
                    }
                }
            }.navigationTitle(model.localized(terminal ? "打开终端" : "浏览文件"))
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button(model.localized("返回"), action: onBack) }
                    ToolbarItem(placement: .confirmationAction) { if terminal { Button(model.localized("关闭终端")) { model.closeRuntimeTerminal(); onBack() } } }
                }
                .onAppear { filePath = model.runtimeFiles?.directory ?? rootPath }
                .onChange(of: model.runtimeFiles?.directory) { if !terminal, let directory = $0 { filePath = directory } }
                .onChange(of: model.remoteExpectedDeviceKey) { if $0 != deviceKey { onBack() } }
                .fullScreenCover(isPresented: Binding(get: { !terminal && model.runtimeFiles?.file != nil }, set: { if !$0 { model.closeRuntimeFileEditor() } })) { NativeRuntimeFileEditor(model: model) }
        }
    }
}
