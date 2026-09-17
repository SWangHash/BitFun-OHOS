import XCTest

final class RemoteCodeSessionSendUITests: XCTestCase {
    private let app = XCUIApplication(bundleIdentifier: "com.bitfun.mobile.ios")

    override func setUpWithError() throws {
        continueAfterFailure = false
        app.launch()
    }

    func testSendMessageInCurrentRemoteCodeSession() throws {
        let activeSession = app.descendants(matching: .any).matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "conversation.session.")
        ).firstMatch
        guard activeSession.waitForExistence(timeout: 20) else {
            recordDiagnostics(named: "NoActiveRemoteSession")
            XCTFail(
                "No active Remote Code Session is visible. Keep the phone unlocked and navigate BitFun to the intended existing remote code session; this test will not choose a session automatically."
            )
            return
        }

        let composer = app.textFields.firstMatch
        guard composer.waitForExistence(timeout: 10), composer.isHittable else {
            recordDiagnostics(named: "ComposerUnavailable")
            XCTFail("The current remote session is visible, but its composer text field is unavailable or obstructed.")
            return
        }

        let message = "iPhone remote send E2E \(Int(Date().timeIntervalSince1970))"
        composer.tap()
        composer.typeText(message)
        XCTAssertEqual(composer.value as? String, message, "The complete harmless E2E message was not entered.")

        let sendButton = firstExistingElement([
            app.buttons["发送"],
            app.buttons["Send"],
        ])
        guard let sendButton else {
            recordDiagnostics(named: "SendButtonMissing")
            XCTFail("The composer contains the E2E message, but no localized Send button is visible.")
            return
        }
        guard sendButton.isEnabled else {
            recordDiagnostics(named: "SendButtonDisabled")
            XCTFail("The Send button is disabled; remote mutation authority may not be confirmed or the session may be busy. The draft was not dispatched.")
            return
        }

        sendButton.tap()

        let draftCleared = NSPredicate { evaluated, _ in
            guard let field = evaluated as? XCUIElement else { return false }
            return (field.value as? String) != message
        }
        expectation(for: draftCleared, evaluatedWith: composer)
        waitForExpectations(timeout: 10)

        let timelineMessage = app.staticTexts[message]
        guard timelineMessage.waitForExistence(timeout: 20) else {
            recordDiagnostics(named: "TimelineMessageMissing")
            XCTFail("The draft cleared after tapping Send, but the exact E2E message did not appear in the current timeline; dispatch or peer synchronization may have failed.")
            return
        }

        let evidence = XCTAttachment(string: "Sent message visible in current timeline: \(message)")
        evidence.name = "RemoteCodeSessionSendEvidence"
        evidence.lifetime = .keepAlways
        add(evidence)
        recordDiagnostics(named: "RemoteCodeSessionSendSucceeded")
    }

    private func firstExistingElement(_ elements: [XCUIElement]) -> XCUIElement? {
        elements.first { $0.waitForExistence(timeout: 2) }
    }

    private func recordDiagnostics(named name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)

        let hierarchy = XCTAttachment(string: app.debugDescription)
        hierarchy.name = "\(name)-Hierarchy"
        hierarchy.lifetime = .keepAlways
        add(hierarchy)
    }
}

/// Read-only real-device probe for the remote-create critical path. It opens
/// the workspace picker and observes its first usable row, but never selects a
/// workspace, creates a session, or sends content.
final class RemoteWorkspaceLoadingPerformanceUITests: XCTestCase {
    private let app = XCUIApplication(bundleIdentifier: "com.bitfun.mobile.ios")
    private var startedAt = Date()

    override func setUpWithError() throws {
        continueAfterFailure = false
        startedAt = Date()
        app.launch()
    }

    func testConnectedHomeToWorkspaceRowsReadOnly() throws {
        let connected = firstExistingElement([
            app.staticTexts["桌面端已连接"],
            app.staticTexts["Desktop connected"],
        ], timeout: 30)
        XCTAssertNotNil(connected, "The existing remote connection did not restore on the device.")
        recordMilestone("connected_home")

        guard let create = firstExistingElement([
            app.buttons["新建远程会话"],
            app.buttons["New remote session"],
        ], timeout: 10) else {
            recordDiagnostics(named: "RemoteCreateActionMissing")
            XCTFail("The connected home did not expose the remote-create action.")
            return
        }
        XCTAssertTrue(create.isHittable)
        create.tap()
        recordMilestone("create_opened")

        let selectors = app.buttons.matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "remoteCreate.workspace.")
        )
        let selector = selectors.firstMatch
        let usableSelector = NSPredicate { evaluated, _ in
            guard let element = evaluated as? XCUIElement else { return false }
            return element.exists && element.isHittable && element.isEnabled
        }
        expectation(for: usableSelector, evaluatedWith: selector)
        waitForExpectations(timeout: 15)
        XCTAssertEqual(selectors.count, 1, "Workspace selector must be unambiguous.")
        recordMilestone("workspace_selector_usable")

        selector.tap()
        recordMilestone("workspace_picker_opened")

        let workspaceRows = app.buttons.matching(
            NSPredicate(
                format: "label BEGINSWITH %@ OR label BEGINSWITH %@",
                "工作区:",
                "Workspace:"
            )
        )
        let firstRow = workspaceRows.firstMatch
        let usableRow = NSPredicate { evaluated, _ in
            guard let element = evaluated as? XCUIElement else { return false }
            return element.exists && element.isHittable && element.isEnabled
        }
        expectation(for: usableRow, evaluatedWith: firstRow)
        waitForExpectations(timeout: 45)
        recordMilestone("first_workspace_row_usable")
        recordDiagnostics(named: "WorkspaceRowsReadOnlySucceeded")
    }

    private func firstExistingElement(_ elements: [XCUIElement], timeout: TimeInterval) -> XCUIElement? {
        elements.first { $0.waitForExistence(timeout: timeout) }
    }

    private func recordMilestone(_ name: String) {
        let elapsed = Date().timeIntervalSince(startedAt)
        let attachment = XCTAttachment(string: String(format: "%@ +%.3fs", name, elapsed))
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func recordDiagnostics(named name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)

        let hierarchy = XCTAttachment(string: app.debugDescription)
        hierarchy.name = "\(name)-Hierarchy"
        hierarchy.lifetime = .keepAlways
        add(hierarchy)
    }
}

final class RemoteCreateWorkspacePickerUITests: XCTestCase {
    private let app = XCUIApplication(bundleIdentifier: "com.bitfun.mobile.ios")

    override func setUpWithError() throws {
        continueAfterFailure = false
        app.launchArguments = ["--harness-preview", "--remote-create"]
        app.launchMobileReady()
    }

    func testWorkspacePickerOpensAndExposesUsableRows() {
        assertWorkspacePickerUsable()
    }

    func testSessionDirectoryBusyDoesNotDisableWorkspacePicker() {
        app.terminate()
        app.launchArguments = ["--harness-preview", "--remote-create-session-loading"]
        app.launchMobileReady()
        assertWorkspacePickerUsable()
    }

    private func assertWorkspacePickerUsable() {
        let selectors = app.buttons.matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "remoteCreate.workspace.")
        )
        let selector = selectors.firstMatch
        XCTAssertTrue(selector.waitForExistence(timeout: 10))
        XCTAssertEqual(selectors.count, 1)
        XCTAssertTrue(selector.isHittable)
        XCTAssertTrue(selector.isEnabled, "Independent session loading must not disable the workspace selector.")

        selector.tap()

        let workspaceRows = app.buttons.matching(
            NSPredicate(
                format: "label BEGINSWITH %@ OR label BEGINSWITH %@",
                "工作区:",
                "Workspace:"
            )
        )
        let row = workspaceRows.firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        XCTAssertTrue(row.isHittable)
        XCTAssertTrue(row.isEnabled)

        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "RemoteCreateWorkspacePickerUsable"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}

/// Read-only responsiveness probes for the two composer implementations. The
/// tests enter a disposable character but never submit it or mutate a remote
/// session.
final class ComposerFocusResponsivenessUITests: XCTestCase {
    private let app = XCUIApplication(bundleIdentifier: "com.bitfun.mobile.ios")

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testRemoteConversationComposerAcceptsFirstCharacter() {
        app.launchArguments = ["--harness-preview", "--remote", "--connected"]
        app.launchMobileReady()
        assertFirstCharacterResponsiveness(
            identifier: "composer.input",
            named: "RemoteHomeComposer"
        )
    }

    func testRemoteCreateComposerAcceptsFirstCharacter() {
        app.launchArguments = ["--harness-preview", "--remote-create"]
        app.launchMobileReady()
        assertFirstCharacterResponsiveness(
            identifier: "remoteCreate.composer.input",
            named: "RemoteCreateComposer"
        )
    }

    private func assertFirstCharacterResponsiveness(identifier: String, named name: String) {
        let field = app.textFields[identifier]
        XCTAssertTrue(field.waitForExistence(timeout: 10), "\(name) text field did not appear.")
        XCTAssertTrue(field.isHittable, "\(name) text field is obstructed.")

        let tapStart = Date()
        field.tap()
        let tapElapsed = Date().timeIntervalSince(tapStart)

        let typeStart = Date()
        field.typeText("x")
        let typeElapsed = Date().timeIntervalSince(typeStart)

        XCTAssertEqual(field.value as? String, "x", "\(name) did not accept the first character.")
        XCTAssertLessThan(tapElapsed, 2, "\(name) focus transition blocked UI automation.")
        XCTAssertLessThan(typeElapsed, 2, "\(name) first character handling blocked UI automation.")
        let keyboard = app.keyboards.firstMatch
        if keyboard.exists {
            XCTAssertLessThanOrEqual(
                field.frame.maxY,
                keyboard.frame.minY + 1,
                "\(name) is covered by the software keyboard."
            )
        }

        let timing = XCTAttachment(
            string: String(format: "tap=%.3fs type=%.3fs keyboards=%d", tapElapsed, typeElapsed, app.keyboards.count)
        )
        timing.name = "\(name)-Timing"
        timing.lifetime = .keepAlways
        add(timing)

        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "\(name)-Focused"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}

/// Exercises the complete account-driven remote workflow against a real relay.
/// Credentials are supplied by the invoking process and are never persisted in
/// the test bundle or emitted in diagnostics.
final class RemoteAccountWorkflowPerformanceUITests: XCTestCase {
    private let app = XCUIApplication(bundleIdentifier: "com.bitfun.mobile.ios")
    private var workflowStartedAt = Date()

    override func setUpWithError() throws {
        continueAfterFailure = false
        workflowStartedAt = Date()
        app.launchArguments = ["--simplified-chinese"]
        app.launch()
    }

    func testLoginDeviceWorkspaceSessionSwitchAndSend() throws {
        let environment = ProcessInfo.processInfo.environment
        guard let username = environment["BITFUN_E2E_USERNAME"], !username.isEmpty,
              let password = environment["BITFUN_E2E_PASSWORD"], !password.isEmpty else {
            throw XCTSkip("Set BITFUN_E2E_USERNAME and BITFUN_E2E_PASSWORD to run the real relay workflow.")
        }

        let sidebarAlreadyOpen = try signIn(username: username, password: password)
        let deviceID = try selectFirstRemoteDevice(openSidebar: !sidebarAlreadyOpen)
        let sessionIDs = try exerciseWorkspaceDirectory(deviceID: deviceID)
        try exerciseSessionSwitching(sessionIDs: sessionIDs)
        try sendVerificationMessage()
        let idleStarted = Date()
        RunLoop.current.run(until: Date().addingTimeInterval(5))
        recordStep("post_workflow_idle", since: idleStarted)
        recordDiagnostics(named: "RemoteAccountWorkflowSucceeded")
    }

    private func signIn(username: String, password: String) throws -> Bool {
        let sidebar = try requireFirst([
            app.buttons["打开侧栏"],
            app.buttons["Open sidebar"],
        ], timeout: 20, failure: "The sidebar action did not become available.")
        sidebar.tap()

        let accountActions = [
            app.buttons["登录 BitFun 账号"],
            app.buttons["Sign in to BitFun"],
        ]
        if !waitUntil(timeout: 5, condition: {
            accountActions.contains(where: \.exists) || self.app.buttons.matching(
                NSPredicate(format: "identifier BEGINSWITH %@", "sidebar.device.")
            ).count > 0
        }) {
            recordDiagnostics(named: "AccountStateUnavailable")
            XCTFail("The sidebar exposed neither account login nor a restored device directory.")
            throw WorkflowError.requiredElementMissing
        }
        if !accountActions.contains(where: \.exists) {
            recordStep("account_restore_ready", since: workflowStartedAt)
            return true
        }
        let accountAction = accountActions.first(where: \.exists)!
        accountAction.tap()

        let usernameField = try requireFirst([
            app.textFields["用户名"],
            app.textFields["Username"],
        ], timeout: 10, failure: "The username field did not appear.")
        let passwordField = try requireFirst([
            app.secureTextFields["密码"],
            app.secureTextFields["Password"],
        ], timeout: 10, failure: "The password field did not appear.")
        usernameField.tap()
        usernameField.typeText(username)
        passwordField.tap()
        passwordField.typeText(password)

        let login = try requireFirst([
            app.buttons["登录"],
            app.buttons["Sign in"],
        ], timeout: 5, failure: "The login button did not become available.")
        XCTAssertTrue(login.isEnabled, "The completed login form remained disabled.")
        let started = Date()
        login.tap()

        _ = try requireFirst([
            app.staticTexts["个人资料"],
            app.staticTexts["Profile"],
        ], timeout: 45, failure: "Login did not reach the account profile.")
        recordStep("login_ready", since: started)

        let close = try requireFirst([
            app.buttons["关闭"],
            app.buttons["Close"],
        ], timeout: 5, failure: "The account sheet could not be closed.")
        close.tap()
        _ = try requireFirst([
            app.buttons["打开侧栏"],
            app.buttons["Open sidebar"],
        ], timeout: 10, failure: "The conversation surface did not return after login.")
        return false
    }

    private func selectFirstRemoteDevice(openSidebar: Bool) throws -> String {
        if openSidebar {
            let sidebar = try requireFirst([
                app.buttons["打开侧栏"],
                app.buttons["Open sidebar"],
            ], timeout: 10, failure: "The sidebar action was unavailable after login.")
            sidebar.tap()
        }

        let devices = app.buttons.matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "sidebar.device.")
        )
        let device = try requireUsableElement(
            in: devices,
            timeout: 30,
            failure: "No online account device became selectable."
        )
        let identifier = device.identifier
        let deviceID = String(identifier.dropFirst("sidebar.device.".count))
        let started = Date()
        device.tap()

        let workspaces = app.buttons.matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "sidebar.workspace.\(deviceID).")
        )
        _ = try requireUsableElement(
            in: workspaces,
            timeout: 45,
            failure: "The selected device did not expose a usable workspace."
        )
        recordStep("device_workspaces_ready", since: started)
        return deviceID
    }

    private func exerciseWorkspaceDirectory(deviceID: String) throws -> [String] {
        let workspacePrefix = "sidebar.workspace.\(deviceID)."
        let sessionPrefix = "sidebar.session.\(deviceID)."
        let workspaces = app.buttons.matching(
            NSPredicate(format: "identifier BEGINSWITH %@", workspacePrefix)
        )
        XCTAssertGreaterThan(workspaces.count, 1, "At least two workspaces are required to validate switching.")

        var chosenWorkspace: XCUIElement?
        var sessionIDs: [String] = []
        let candidateCount = min(workspaces.count, 8)
        for index in 0..<candidateCount {
            let workspace = workspaces.element(boundBy: index)
            guard scrollToHittable(workspace) else { continue }
            let started = Date()
            workspace.tap()
            waitForDirectoryLoadingToFinish(timeout: 30)
            recordStep("workspace_\(index + 1)_expanded", since: started)

            let sessions = app.buttons.matching(
                NSPredicate(format: "identifier BEGINSWITH %@", sessionPrefix)
            )
            sessionIDs = uniqueIdentifiers(from: sessions)
            if sessionIDs.count >= 2 {
                chosenWorkspace = workspace
                break
            }

            if scrollToHittable(workspace) { workspace.tap() }
        }

        guard let chosenWorkspace else {
            recordDiagnostics(named: "NoWorkspaceWithTwoSessions")
            XCTFail("No inspected workspace exposed two sessions for rapid switching.")
            return []
        }

        if scrollToHittable(chosenWorkspace) { chosenWorkspace.tap() }
        let secondWorkspace = workspaces.element(boundBy: 1)
        guard scrollToHittable(secondWorkspace) else {
            XCTFail("A second workspace exists but could not be scrolled into view.")
            return []
        }
        let switchStarted = Date()
        secondWorkspace.tap()
        waitForDirectoryLoadingToFinish(timeout: 30)
        recordStep("workspace_switch_ready", since: switchStarted)

        if scrollToHittable(secondWorkspace) { secondWorkspace.tap() }
        guard scrollToHittable(chosenWorkspace) else {
            XCTFail("The source workspace could not be restored after switching.")
            return []
        }
        chosenWorkspace.tap()
        waitForDirectoryLoadingToFinish(timeout: 30)
        return Array(sessionIDs.prefix(3))
    }

    private func exerciseSessionSwitching(sessionIDs: [String]) throws {
        guard sessionIDs.count >= 2 else {
            XCTFail("Rapid switching requires at least two sessions.")
            return
        }

        try openSession(sessionIDs[0], step: "session_first_ready")
        try reopenSidebar()
        try selectSessionWithoutWaiting(sessionIDs[1], step: "rapid_switch_first_selected")
        try reopenSidebar()
        let finalSession = sessionIDs.count > 2 ? sessionIDs[2] : sessionIDs[0]
        try openSession(finalSession, step: "rapid_switch_final_ready")
        try reopenSidebar()
        try openSession(sessionIDs[0], step: "cached_session_return_ready")
        try reopenSidebar()
        try openSession(finalSession, step: "cached_final_session_ready")
        try selectIdleSession(from: sessionIDs)
    }

    private func openSession(_ sessionID: String, step: String) throws {
        let session = app.buttons[sessionID]
        guard scrollToHittable(session) else {
            recordDiagnostics(named: "SessionUnavailable")
            XCTFail("The requested session was not reachable in the expanded workspace.")
            return
        }
        let rawID = sessionID.components(separatedBy: ".").last ?? sessionID
        let started = Date()
        session.tap()

        let conversation = app.descendants(matching: .any)["conversation.session.\(rawID)"]
        XCTAssertTrue(
            waitUntil(timeout: 10) { conversation.exists },
            "The selected conversation identity did not update."
        )
        waitForConversationLoadingToFinish(timeout: 45)
        let composer = app.textFields["composer.input"]
        XCTAssertTrue(
            waitUntil(timeout: 10) { composer.exists && composer.isHittable },
            "The selected conversation composer did not become available."
        )
        XCTAssertTrue(
            waitUntil(timeout: 45) {
                let voice = self.app.buttons["语音输入"]
                let stop = self.app.buttons["停止"]
                return (voice.exists && voice.isEnabled) || (stop.exists && stop.isEnabled)
            },
            "The selected conversation remained busy after its content appeared."
        )
        recordStep(step, since: started)
    }

    private func selectSessionWithoutWaiting(_ sessionID: String, step: String) throws {
        let session = app.buttons[sessionID]
        guard scrollToHittable(session) else {
            XCTFail("The rapid-switch source session was unreachable.")
            return
        }
        let rawID = sessionID.components(separatedBy: ".").last ?? sessionID
        let started = Date()
        session.tap()
        let conversation = app.descendants(matching: .any)["conversation.session.\(rawID)"]
        XCTAssertTrue(
            waitUntil(timeout: 10) { conversation.exists },
            "The rapid-switch source selection was not projected."
        )
        recordStep(step, since: started)
    }

    private func selectIdleSession(from sessionIDs: [String]) throws {
        for (index, sessionID) in sessionIDs.enumerated() {
            try reopenSidebar()
            try openSession(sessionID, step: "send_candidate_\(index + 1)_ready")
            let voice = app.buttons["语音输入"]
            if voice.exists && voice.isEnabled { return }
            let send = app.buttons["发送"]
            XCTAssertFalse(
                send.exists && send.isEnabled,
                "A session with an active turn unexpectedly allowed another send."
            )
        }
        recordDiagnostics(named: "NoIdleSessionForSend")
        XCTFail("All inspected sessions still had active turns, so the verification message was not dispatched.")
        throw WorkflowError.requiredElementMissing
    }

    private func reopenSidebar() throws {
        let action = try requireFirst([
            app.buttons["打开侧栏"],
            app.buttons["Open sidebar"],
        ], timeout: 10, failure: "The sidebar could not be reopened while switching sessions.")
        action.tap()
        let sessions = app.buttons.matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "sidebar.session.")
        )
        _ = try requireUsableElement(in: sessions, timeout: 10, failure: "Expanded sessions were not restored in the sidebar.")
    }

    private func sendVerificationMessage() throws {
        let composer = app.textFields["composer.input"]
        XCTAssertTrue(waitUntil(timeout: 10) { composer.exists }, "The composer was unavailable before send.")
        XCTAssertTrue(composer.isHittable, "The composer was obstructed before send.")

        let message = "iOS 模拟器端到端性能验证 \(Int(Date().timeIntervalSince1970))"
        composer.tap()
        composer.typeText(message)
        XCTAssertEqual(composer.value as? String, message)

        let send = try requireFirst([
            app.buttons["发送"],
            app.buttons["Send"],
        ], timeout: 5, failure: "The Send button did not become available after typing.")
        XCTAssertTrue(send.isEnabled, "The selected session did not allow message sending.")
        let started = Date()
        send.tap()

        XCTAssertTrue(
            waitUntil(timeout: 10) { (composer.value as? String) != message },
            "The draft did not clear after dispatch."
        )
        recordStep("send_draft_cleared", since: started)

        let timelineMessage = app.staticTexts[message]
        XCTAssertTrue(
            waitUntil(timeout: 30) { timelineMessage.exists },
            "The submitted message did not appear in the active timeline."
        )
        recordStep("send_message_visible", since: started)
    }

    private func waitForDirectoryLoadingToFinish(timeout: TimeInterval) {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            let loading = app.staticTexts["正在加载"]
            let loadingWorkspaces = app.staticTexts["正在加载工作区"]
            if !loading.exists && !loadingWorkspaces.exists { return }
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        }
    }

    private func waitForConversationLoadingToFinish(timeout: TimeInterval) {
        RunLoop.current.run(until: Date().addingTimeInterval(0.18))
        let loading = app.descendants(matching: .any).matching(
            NSPredicate(format: "label == %@", "正在加载")
        ).firstMatch
        guard loading.exists else { return }
        XCTAssertTrue(waitUntil(timeout: timeout) { !loading.exists }, "The conversation loading state did not finish.")
    }

    private func requireFirst(
        _ elements: [XCUIElement],
        timeout: TimeInterval,
        failure: String
    ) throws -> XCUIElement {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            if let element = elements.first(where: \.exists) { return element }
            RunLoop.current.run(until: Date().addingTimeInterval(0.05))
        } while Date() < deadline
        if let element = elements.first(where: \.exists) {
            return element
        }
        recordDiagnostics(named: "RequiredElementMissing")
        XCTFail(failure)
        throw WorkflowError.requiredElementMissing
    }

    private func requireUsableElement(
        in query: XCUIElementQuery,
        timeout: TimeInterval,
        failure: String
    ) throws -> XCUIElement {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            for index in 0..<query.count {
                let candidate = query.element(boundBy: index)
                if candidate.exists && candidate.isEnabled && candidate.isHittable { return candidate }
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        }
        recordDiagnostics(named: "UsableElementMissing")
        XCTFail(failure)
        throw WorkflowError.requiredElementMissing
    }

    private func scrollToHittable(_ element: XCUIElement) -> Bool {
        guard waitUntil(timeout: 5, condition: { element.exists }) else { return false }
        for _ in 0..<8 {
            if element.isHittable { return true }
            app.swipeUp()
        }
        for _ in 0..<8 {
            if element.isHittable { return true }
            app.swipeDown()
        }
        return element.isHittable
    }

    private func waitUntil(timeout: TimeInterval, condition: () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.05))
        } while Date() < deadline
        return condition()
    }

    private func uniqueIdentifiers(from query: XCUIElementQuery) -> [String] {
        var seen = Set<String>()
        var result: [String] = []
        for index in 0..<query.count {
            let identifier = query.element(boundBy: index).identifier
            if !identifier.isEmpty, seen.insert(identifier).inserted { result.append(identifier) }
        }
        return result
    }

    private func recordStep(_ name: String, since started: Date) {
        let elapsedMS = Date().timeIntervalSince(started) * 1_000
        let totalMS = Date().timeIntervalSince(workflowStartedAt) * 1_000
        let line = String(format: "[IOS_E2E_PERF] step=%@ elapsed_ms=%.0f total_ms=%.0f", name, elapsedMS, totalMS)
        print(line)
        let attachment = XCTAttachment(string: line)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func recordDiagnostics(named name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)

        let hierarchy = XCTAttachment(string: app.debugDescription)
        hierarchy.name = "\(name)-Hierarchy"
        hierarchy.lifetime = .keepAlways
        add(hierarchy)
    }

    private enum WorkflowError: Error {
        case requiredElementMissing
    }
}

/// Run on a fresh simulator installation so notification authorization is undecided.
final class NotificationOnboardingUITests: XCTestCase {
    func testLaterPersistsAcrossRelaunch() {
        let app = XCUIApplication(bundleIdentifier: "com.bitfun.mobile.ios")
        app.launch()
        let prompt = app.alerts.firstMatch
        XCTAssertTrue(prompt.waitForExistence(timeout: 15))
        let later = app.buttons.matching(NSPredicate(format: "label IN %@", ["Later", "稍后"])).firstMatch
        XCTAssertTrue(later.exists)
        later.tap()
        XCTAssertFalse(prompt.exists)
        app.terminate()
        app.launch()
        let sidebar = app.buttons.matching(NSPredicate(format: "label IN %@", ["Open sidebar", "打开侧栏"])).firstMatch
        XCTAssertTrue(sidebar.waitForExistence(timeout: 15))
        XCTAssertFalse(prompt.waitForExistence(timeout: 3), "Skipping onboarding must survive process restart.")
        // Use the existing settings inspection route without signing in a test account.
        app.terminate()
        app.launchArguments = ["--settings"]
        app.launch()
        let notifications = app.buttons["settings.notifications"]
        XCTAssertTrue(notifications.waitForExistence(timeout: 5))
        notifications.tap()
        let systemPrompt = XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.firstMatch
        XCTAssertTrue(systemPrompt.waitForExistence(timeout: 10), "Settings must still allow authorization after Later.")
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = "NotificationAuthorizationAfterLater"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}

final class SidebarNavigationUITests: XCTestCase {
    func testNewChatOffersHarnessProfilesInCompactAndWideSidebar() {
        let app = XCUIApplication(bundleIdentifier: "com.bitfun.mobile.ios")
        app.launchArguments = ["--harness-preview", "--drawer", "--simplified-chinese"]
        app.launchMobileReady()
        let later = app.alerts.buttons["稍后"]
        if later.waitForExistence(timeout: 3) { later.tap() }
        let newChat = app.buttons["sidebar.newChat"]
        XCTAssertTrue(newChat.waitForExistence(timeout: 10))
        XCTAssertTrue(newChat.isEnabled)
        XCTAssertTrue(newChat.label.contains("新聊天"))
        let workspace = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "sidebar.workspace.")).firstMatch
        XCTAssertTrue(workspace.exists)
        workspace.tap()
        let compact = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        compact.name = "SidebarCompact"
        compact.lifetime = .keepAlways
        add(compact)
        newChat.tap()
        XCTAssertTrue(app.buttons.containing(NSPredicate(format: "label CONTAINS %@", "标准")).firstMatch.waitForExistence(timeout: 5))
        app.terminate()
        XCUIDevice.shared.orientation = .landscapeLeft
        defer { XCUIDevice.shared.orientation = .portrait }
        app.launchMobileReady()
        XCTAssertTrue(newChat.waitForExistence(timeout: 10))
        XCTAssertTrue(newChat.isHittable)
        app.scrollViews["sidebar.workspaces"].swipeUp()
        XCTAssertLessThan(workspace.frame.maxY, newChat.frame.minY, "The final workspace must scroll clear of the floating actions.")
        let wide = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        wide.name = "SidebarWide"
        wide.lifetime = .keepAlways
        add(wide)
    }
}

final class GitHubLoginPresentationUITests: XCTestCase {
    func testLoginUsesCompactSheetAndOpensBrowserAutomatically() {
        let app = XCUIApplication(bundleIdentifier: "com.bitfun.mobile.ios")
        app.launchArguments = ["--drawer", "--simplified-chinese"]
        app.launch()
        let later = app.alerts.buttons["稍后"]
        if later.waitForExistence(timeout: 3) { later.tap() }
        let account = app.buttons["使用 GitHub 登录"]
        XCTAssertTrue(account.waitForExistence(timeout: 10), "Run on a signed-out simulator.")
        account.tap()
        let login = app.buttons["account.login"]
        XCTAssertTrue(login.waitForExistence(timeout: 5))
        let title = app.staticTexts["使用 GitHub 登录"]
        XCTAssertGreaterThan(title.frame.minY, app.frame.height * 0.5)
        let sheet = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        sheet.name = "CompactGitHubLogin"
        sheet.lifetime = .keepAlways
        add(sheet)
        login.tap()
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        let opened = XCTNSPredicateExpectation(predicate: NSPredicate(format: "state == %d", XCUIApplication.State.runningForeground.rawValue), object: safari)
        XCTAssertEqual(XCTWaiter.wait(for: [opened], timeout: 30), .completed, "A single login tap must open the authorization browser.")
        let browser = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        browser.name = "AutomaticallyOpenedAuthorization"
        browser.lifetime = .keepAlways
        add(browser)
        app.activate()
        XCTAssertTrue(login.waitForExistence(timeout: 5))
        XCTAssertTrue(login.isEnabled, "Returning from the browser must allow reopening the same authorization.")
        XCTAssertTrue(login.label.contains("打开 GitHub 授权"))
        app.terminate()
    }
}

final class MobileParityUITests: XCTestCase {
    func testPlanCardExplainsUnsupportedHost() {
        let app = XCUIApplication(bundleIdentifier: "com.bitfun.mobile.ios")
        app.launchArguments = ["--harness-preview", "--plan-preview", "--simplified-chinese"]
        app.launchMobileReady()
        XCTAssertTrue(app.staticTexts["Mobile parity"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["查看计划"].exists)
        XCTAssertFalse(app.buttons["执行计划"].isEnabled)
        XCTAssertTrue(app.staticTexts["此电脑暂不支持执行计划"].exists)
        let evidence = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        evidence.name = "PlanCardUnsupportedHost"
        evidence.lifetime = .keepAlways
        add(evidence)
    }

    func testRemoteCodePreviewShowsNumberedLines() {
        let app = XCUIApplication(bundleIdentifier: "com.bitfun.mobile.ios")
        app.launchArguments = ["--harness-preview", "--file-preview", "--simplified-chinese"]
        app.launchMobileReady()
        let code = app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "fn main()")).firstMatch
        XCTAssertTrue(code.waitForExistence(timeout: 10))
        XCTAssertTrue(code.label.trimmingCharacters(in: .whitespaces).hasPrefix("2"))
        let evidence = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        evidence.name = "NumberedCodePreview"
        evidence.lifetime = .keepAlways
        add(evidence)
    }

    func testLanguageSwitchUpdatesExistingAndNewScreens() {
        let app = XCUIApplication(bundleIdentifier: "com.bitfun.mobile.ios")
        app.launchArguments = ["--harness-preview", "--settings", "--simplified-chinese"]
        app.launchMobileReady()
        let language = app.buttons.containing(NSPredicate(format: "label CONTAINS %@", "语言")).firstMatch
        XCTAssertTrue(language.waitForExistence(timeout: 15))
        language.tap()
        XCTAssertTrue(app.buttons["English"].waitForExistence(timeout: 5))
        app.buttons["English"].tap()
        XCTAssertTrue(app.staticTexts["Settings"].waitForExistence(timeout: 5))
        let account = app.buttons.containing(NSPredicate(format: "label CONTAINS %@", "Current account")).firstMatch
        XCTAssertTrue(account.exists)
        account.tap()
        XCTAssertTrue(app.buttons["Sign out"].waitForExistence(timeout: 5))
        let evidence = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        evidence.name = "LanguageEnglishApplied"
        evidence.lifetime = .keepAlways
        add(evidence)
    }

    func testOfflineMiniAppsOpenFromSidebar() {
        let app = XCUIApplication(bundleIdentifier: "com.bitfun.mobile.ios")
        app.launchArguments = ["--harness-preview", "--drawer", "--simplified-chinese"]
        app.launchMobileReady()
        let miniapps = app.buttons["小应用"].firstMatch
        XCTAssertTrue(miniapps.waitForExistence(timeout: 15))
        let sidebar = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        sidebar.name = "OfflineMiniApp-Sidebar"
        sidebar.lifetime = .keepAlways
        add(sidebar)
        miniapps.tap()
        XCTAssertTrue(app.staticTexts["全部应用"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["离线可用"].exists)
        let gallery = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        gallery.name = "OfflineMiniApp-Gallery"
        gallery.lifetime = .keepAlways
        add(gallery)
        for title in ["五子棋", "正则游乐场", "每日占卜"] {
            let entry = app.buttons.containing(NSPredicate(format: "label CONTAINS %@", title)).firstMatch
            XCTAssertTrue(entry.waitForExistence(timeout: 10))
            entry.tap()
            XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 10))
            XCTAssertTrue(app.webViews.staticTexts[title].waitForExistence(timeout: 10), "The bundled page must render, not just create a WebView.")
            let evidence = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            evidence.name = "OfflineMiniApp-" + title
            evidence.lifetime = .keepAlways
            add(evidence)
            app.buttons["返回"].tap()
            XCTAssertTrue(entry.waitForExistence(timeout: 5))
        }
    }
}

private extension XCUIApplication {
    func launchMobileReady() {
        launch()
        let startup = descendants(matching: .any)["startup.brand"].firstMatch
        if startup.waitForExistence(timeout: 2) {
            let disappeared = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: startup)
            XCTAssertEqual(XCTWaiter.wait(for: [disappeared], timeout: 15), .completed)
        }
        let later = alerts.buttons["稍后"]
        if later.exists { later.tap() }
    }
}

final class StreamingPresentationUITests: XCTestCase {
    func testDirectoryOpenRoutesBeforeAuthorityIsReady() {
        let app = XCUIApplication()
        app.launchArguments = ["--streaming-regression", "--fixture-shell", "--open-loading-regression", "--status-regression"]
        app.launch()
        let open = app.buttons["fixture.openDelayed"]
        XCTAssertTrue(open.waitForExistence(timeout: 15))
        let status = app.descendants(matching: .any)["conversation.connectionStatus"].firstMatch
        XCTAssertTrue(status.exists)
        XCTAssertEqual(status.frame.height, 48, accuracy: 1)
        open.tap()
        let detail = app.descendants(matching: .any)["conversation.session.delayed"].firstMatch
        XCTAssertTrue(detail.waitForExistence(timeout: 2))
        let loading = app.descendants(matching: .any)["conversation.loading"].firstMatch
        XCTAssertTrue(loading.waitForExistence(timeout: 2))
        XCTAssertFalse(status.exists, "The connection strip must not compete with the loading skeleton")
        app.buttons["fixture.bindTarget"].tap()
        XCTAssertTrue(detail.exists, "Binding the selected device must preserve pending navigation")
        XCTAssertTrue(loading.waitForExistence(timeout: 2))
        app.buttons["fixture.finishLoading"].tap()
        XCTAssertTrue(app.staticTexts["LOADED-SESSION"].waitForExistence(timeout: 3))
        XCTAssertFalse(loading.exists)
    }

    func testSubagentDetailsMatchHarmonyPreviewAndThinking() {
        let app = XCUIApplication()
        app.launchArguments = ["--streaming-regression", "--card-regression", "--subagent-detail-regression"]
        app.launch()
        let task = app.buttons["subagent.toggle.details"]
        XCTAssertTrue(task.waitForExistence(timeout: 15))
        XCTAssertFalse(app.staticTexts["LIVE-CHILD-THOUGHT"].exists)
        XCTAssertFalse(app.buttons["subagent.toggle.empty"].isEnabled, "Empty tasks must not offer disclosure")
        task.tap()
        XCTAssertTrue(app.staticTexts["LIVE-CHILD-THOUGHT"].waitForExistence(timeout: 3))
        XCTAssertFalse(app.staticTexts["OLD-CHILD-THOUGHT"].exists)
        XCTAssertFalse(app.staticTexts["PARENT-SUMMARY-MUST-NOT-REPEAT"].exists)
        let preview = app.staticTexts["subagent.output.child-output"]
        XCTAssertTrue(preview.exists)
        XCTAssertLessThanOrEqual(preview.label.count, 321)
        XCTAssertFalse(preview.label.contains("HIDDEN-OUTPUT-TAIL"))
        XCTAssertLessThan(preview.frame.height, 100)
        XCTAssertTrue(app.buttons["tool.toggle.child-one"].exists)
        XCTAssertTrue(app.buttons["tool.toggle.child-two"].exists)
        XCTAssertFalse(app.buttons["tool.summary.child-one"].exists)
        XCTAssertFalse(app.staticTexts["NESTED-OUTPUT"].exists)
        app.buttons["subagent.toggle.nested"].tap()
        XCTAssertTrue(app.staticTexts["NESTED-OUTPUT"].exists)
        app.buttons["subagent.toggle.nested"].tap()
        app.buttons["fixture.send"].tap()
        XCTAssertTrue(task.label.contains("失败"), "Host failures must remain visible in the subtask header")
        XCTAssertTrue(preview.exists, "Completing keeps the manually opened subtask open")
        XCTAssertFalse(app.staticTexts["LIVE-CHILD-THOUGHT"].exists)
        app.buttons["thinking.toggle.child-old"].tap()
        XCTAssertTrue(app.staticTexts["OLD-CHILD-THOUGHT"].exists)
    }

    func testCardsMatchHarmonyExpansionAndOrdering() {
        let app = XCUIApplication()
        app.launchArguments = ["--streaming-regression", "--card-regression"]
        app.launch()
        let task = app.buttons["subagent.toggle.task"]
        XCTAssertTrue(task.waitForExistence(timeout: 15))
        XCTAssertFalse(app.staticTexts["TASK-BODY"].exists, "Running tasks start collapsed")
        task.tap()
        XCTAssertTrue(app.staticTexts["TASK-BODY"].waitForExistence(timeout: 3))
        app.buttons["fixture.send"].tap()
        XCTAssertTrue(app.staticTexts["TASK-BODY"].exists, "Status updates preserve the user's expansion")
        task.tap()
        XCTAssertFalse(app.staticTexts["TASK-BODY"].exists)
        let summary = app.buttons["tool.summary.one"]
        XCTAssertTrue(summary.exists)
        XCTAssertFalse(app.buttons["tool.toggle.one"].exists)
        XCTAssertFalse(app.staticTexts["REASON-BEFORE"].exists)
        XCTAssertFalse(app.buttons["thinking.toggle.before"].exists)
        XCTAssertTrue(app.buttons["tool.toggle.running"].exists)
        XCTAssertTrue(app.buttons["tool.toggle.failed"].exists)
        summary.tap()
        let one = app.buttons["tool.toggle.one"]
        let two = app.buttons["tool.toggle.two"]
        XCTAssertTrue(one.waitForExistence(timeout: 3))
        let before = app.buttons["thinking.toggle.before"]
        let between = app.buttons["thinking.toggle.between"]
        XCTAssertTrue(before.exists && between.exists)
        XCTAssertLessThan(before.frame.minY, one.frame.minY)
        XCTAssertLessThan(one.frame.minY, between.frame.minY)
        XCTAssertLessThan(between.frame.minY, two.frame.minY)
        one.tap()
        XCTAssertTrue(app.staticTexts["OUTPUT-one"].waitForExistence(timeout: 3))
        two.tap()
        XCTAssertTrue(app.staticTexts["OUTPUT-two"].waitForExistence(timeout: 3))
        XCTAssertFalse(app.staticTexts["OUTPUT-one"].exists, "Only one tool detail is expanded")
        XCTAssertLessThan(one.frame.minY, two.frame.minY)
        app.buttons["fixture.send"].tap()
        XCTAssertTrue(app.buttons["tool.toggle.three"].waitForExistence(timeout: 3),
            "Appending a completed tool must preserve the open summary")
        XCTAssertTrue(app.staticTexts["OUTPUT-two"].exists,
            "Appending tools must preserve the selected detail")
        summary.tap()
        XCTAssertFalse(one.exists)
        XCTAssertFalse(app.staticTexts["OUTPUT-two"].exists)
        XCTAssertTrue(app.staticTexts["ANSWER-AFTER-ACTIVITY"].isHittable)
        let capture = XCTAttachment(screenshot: app.screenshot())
        capture.lifetime = .keepAlways
        add(capture)
    }

    func testSentUserBubbleStaysVisibleBeforeReply() {
        let app = XCUIApplication()
        app.launchArguments = ["--streaming-regression", "--user-bubble-regression"]
        app.launch()
        let start = app.buttons["fixture.send"]
        XCTAssertTrue(start.waitForExistence(timeout: 15))
        let input = app.textFields.firstMatch
        input.tap()
        input.typeText("Message before reply")
        start.tap()
        let bubble = app.staticTexts["SENT-USER-BUBBLE"]
        XCTAssertTrue(bubble.waitForExistence(timeout: 5))
        for _ in 0..<4 {
            XCTAssertTrue(bubble.isHittable, "The sent message must remain visible while awaiting a reply")
            let tick = expectation(description: "Observe pending/acknowledged user bubble")
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { tick.fulfill() }
            wait(for: [tick], timeout: 2)
        }
        XCTAssertTrue(app.staticTexts["Stream finished"].waitForExistence(timeout: 15))
        XCTAssertTrue(bubble.isHittable)
        XCTAssertTrue(app.staticTexts["SHORT-REPLY"].isHittable)
        let capture = XCTAttachment(screenshot: app.screenshot())
        capture.lifetime = .keepAlways
        add(capture)
    }

    func testLongThinkingFoldsWhenAnswerStarts() {
        let app = XCUIApplication()
        app.launchArguments = ["--streaming-regression", "--thinking-regression"]
        app.launch()
        let start = app.buttons["fixture.send"]
        XCTAssertTrue(start.waitForExistence(timeout: 15))
        start.tap()
        let thought = app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "Thinking segment 12")).firstMatch
        XCTAssertTrue(thought.waitForExistence(timeout: 10))
        XCTAssertGreaterThan(thought.frame.height, app.scrollViews.firstMatch.frame.height)
        let answer = app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "ANSWER-AFTER-THINKING")).firstMatch
        XCTAssertTrue(answer.waitForExistence(timeout: 10))
        let folded = NSPredicate { _, _ in !thought.exists }
        expectation(for: folded, evaluatedWith: nil)
        waitForExpectations(timeout: 5)
        XCTAssertTrue(answer.isHittable)
        XCTAssertTrue(app.staticTexts["Stream finished"].waitForExistence(timeout: 10))
        XCTAssertTrue(answer.isHittable)
        let capture = XCTAttachment(screenshot: app.screenshot())
        capture.lifetime = .keepAlways
        add(capture)
    }

    override func setUpWithError() throws { continueAfterFailure = false }

    func testPrependingHistoryPreservesVisibleRowOffset() {
        let app = XCUIApplication()
        app.launchArguments = ["--streaming-regression"]
        app.launch()
        let short = app.buttons["fixture.shortHistory"]
        XCTAssertTrue(short.waitForExistence(timeout: 15))
        short.tap()
        let load = app.buttons["timeline.loadOlder"]
        XCTAssertTrue(load.waitForExistence(timeout: 5))
        let row = app.staticTexts["History row 0"]
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        let originalY = row.frame.minY
        print("History anchor before: \(originalY)")
        let before = XCTAttachment(screenshot: app.screenshot())
        before.name = "BeforePrepend"
        before.lifetime = .keepAlways
        add(before)
        load.tap()
        let after = XCTAttachment(screenshot: app.screenshot())
        after.name = "AfterPrepend"
        after.lifetime = .keepAlways
        add(after)
        let restored = NSPredicate { _, _ in
            print("History anchor observed: exists=\(row.exists) y=\(row.frame.minY) expected=\(originalY)")
            return row.exists && abs(row.frame.minY - originalY) < 4
        }
        expectation(for: restored, evaluatedWith: nil)
        waitForExpectations(timeout: 5)
        XCTAssertFalse(load.exists)
    }

    func testUserCanReadHistoryAndResumeFollowingDuringStreaming() {
        let app = XCUIApplication()
        app.launchArguments = ["--streaming-regression"]
        app.launch()
        let start = app.buttons["fixture.send"]
        XCTAssertTrue(start.waitForExistence(timeout: 15))
        start.tap()
        let scroll = app.scrollViews.firstMatch
        XCTAssertTrue(scroll.waitForExistence(timeout: 5))
        scroll.swipeDown()
        scroll.swipeDown()
        let follow = app.buttons["timeline.scrollToBottom"]
        XCTAssertTrue(follow.waitForExistence(timeout: 5))
        follow.tap()
        XCTAssertTrue(app.staticTexts["Stream finished"].waitForExistence(timeout: 25))
        let end = app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "STREAM-END")).firstMatch
        XCTAssertTrue(end.waitForExistence(timeout: 5))
        XCTAssertTrue(end.isHittable)
        app.buttons["fixture.reset"].tap()
        XCTAssertTrue(start.exists)
        XCTAssertTrue(app.textFields.firstMatch.exists)
        expectation(for: NSPredicate { _, _ in !end.exists }, evaluatedWith: nil)
        waitForExpectations(timeout: 5)
    }

    func testKeyboardDismissalAndLongStreamKeepContentVisible() {
        checkKeyboardAndStream(shell: false)
    }

    func testFullShellRemainsVisibleThroughKeyboardAndStreaming() {
        checkKeyboardAndStream(shell: true)
    }

    private func checkKeyboardAndStream(shell: Bool) {
        let app = XCUIApplication()
        app.launchArguments = ["--streaming-regression"] + (shell ? ["--fixture-shell"] : [])
        app.launch()
        let start = app.buttons["fixture.send"]
        XCTAssertTrue(start.waitForExistence(timeout: 15))
        let input = app.textFields.firstMatch
        XCTAssertTrue(input.waitForExistence(timeout: 10))
        input.tap()
        input.typeText("Draft before streaming")
        XCTAssertTrue(app.keyboards.firstMatch.exists)
        start.tap()
        let keyboardGone = NSPredicate { _, _ in !app.keyboards.firstMatch.exists }
        expectation(for: keyboardGone, evaluatedWith: nil)
        waitForExpectations(timeout: 5)
        XCTAssertTrue(start.exists)
        XCTAssertTrue(input.exists)
        XCTAssertTrue(app.staticTexts["Stream finished"].waitForExistence(timeout: 25))
        let end = app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "STREAM-END")).firstMatch
        XCTAssertTrue(end.waitForExistence(timeout: 5))
        XCTAssertTrue(end.isHittable, "The final response should remain in the viewport")
        let capture = XCTAttachment(screenshot: app.screenshot())
        capture.lifetime = .keepAlways
        add(capture)
    }
}

/// Real-device diagnostics. Sending probes require an explicit environment opt-in.
final class RemoteTimelineScrollProbeUITests: XCTestCase {
    func testStreamInCurrentConversation() throws {
        guard ProcessInfo.processInfo.environment["PROBE_SEND_CURRENT"] == "1" else {
            throw XCTSkip("Explicit live send probe is not enabled")
        }
        let app = XCUIApplication(bundleIdentifier: "com.bitfun.mobile.ios")
        app.activate()
        let conversation = app.descendants(matching: .any).matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "conversation.session.")
        ).firstMatch
        XCTAssertTrue(conversation.waitForExistence(timeout: 10))
        let input = app.textFields["composer.input"]
        XCTAssertTrue(input.exists)
        input.tap()
        input.typeText("请写一篇约1500字的中文说明，分成十段，介绍聊天界面应有的交互体验。不要调用工具或修改文件。这是流式滚动诊断测试。")
        app.buttons["arrow.up"].tap()
        for index in 0..<6 {
            let pause = expectation(description: "Allow streaming progress")
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { pause.fulfill() }
            wait(for: [pause], timeout: 3)
            let capture = XCTAttachment(screenshot: app.screenshot())
            capture.name = "StreamPhase\(index)"
            capture.lifetime = .keepAlways
            add(capture)
            if index == 2 || index == 4 {
                let scroll = conversation.scrollViews.firstMatch
                scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25))
                    .press(forDuration: 0.1, thenDragTo: scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.8)))
            }
        }
        let hierarchy = XCTAttachment(string: app.debugDescription)
        hierarchy.name = "AfterStreamingDrag"
        hierarchy.lifetime = .keepAlways
        add(hierarchy)
    }

    func testInspectCurrentScreen() {
        let app = XCUIApplication(bundleIdentifier: "com.bitfun.mobile.ios")
        app.activate()
        if app.buttons["查看设备"].waitForExistence(timeout: 3) { app.buttons["查看设备"].tap() }
        let device = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "sidebar.device.")).firstMatch
        if !device.waitForExistence(timeout: 8), app.buttons["查看设备"].exists {
            app.buttons["查看设备"].tap()
            _ = device.waitForExistence(timeout: 8)
        }
        if device.exists && !device.isHittable && app.buttons["打开侧栏"].exists {
            app.buttons["打开侧栏"].tap()
        }
        if device.exists && device.isHittable {
            device.tap()
            let workspace = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "sidebar.workspace.")).firstMatch
            _ = workspace.waitForExistence(timeout: 20)
        }
        if let sessionID = ProcessInfo.processInfo.environment["PROBE_SESSION_ID"] {
            let session = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND identifier ENDSWITH %@", "sidebar.session.", sessionID)).firstMatch
            let workspaces = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "sidebar.workspace."))
            for workspace in workspaces.allElementsBoundByIndex {
                if session.exists { break }
                if workspace.isHittable { workspace.tap(); _ = session.waitForExistence(timeout: 5) }
            }
            if session.exists && session.isHittable {
                session.tap()
                let input = app.textFields["composer.input"]
                if input.waitForExistence(timeout: 15) {
                    let message = ProcessInfo.processInfo.environment["PROBE_MESSAGE"] ?? "请仅用三段简短中文介绍你能做什么。不要调用工具或修改任何文件。这是一条手机流式显示测试消息。"
                    input.tap()
                    if (input.value as? String) != message { input.typeText(message) }
                    let send = app.buttons["arrow.up"]
                    if send.exists && send.isEnabled {
                        send.tap()
                        let sent = XCTAttachment(screenshot: app.screenshot())
                        sent.name = "ImmediatelyAfterSend"
                        sent.lifetime = .keepAlways
                        add(sent)
                        let draftCleared = NSPredicate { _, _ in (input.value as? String) != message }
                        _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: draftCleared, object: nil)], timeout: 10)
                        let settled = NSPredicate { _, _ in !app.buttons["停止"].exists }
                        _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: settled, object: nil)], timeout: 45)
                        let conversation = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "conversation.session.")).firstMatch
                        let scroll = conversation.scrollViews.firstMatch
                        if scroll.exists {
                            let beforeDrag = XCTAttachment(string: app.debugDescription)
                            beforeDrag.name = "AfterReplyBeforeDrag"
                            beforeDrag.lifetime = .keepAlways
                            add(beforeDrag)
                            scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).press(forDuration: 0.1, thenDragTo: scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.8)))
                        }
                    }
                }
            }
        }
        let hierarchy = XCTAttachment(string: app.debugDescription)
        hierarchy.name = "CurrentScreen"
        hierarchy.lifetime = .keepAlways
        add(hierarchy)
    }

    func testProfileCurrentComposerInteractions() {
        let app = XCUIApplication(bundleIdentifier: "com.bitfun.mobile.ios")
        app.activate()
        let header = app.buttons["打开侧栏"]
        if header.exists && header.frame.minX > 100 { header.tap() }
        let input = app.textFields["composer.input"]
        if !input.waitForExistence(timeout: 10) {
            if app.buttons["查看设备"].exists { app.buttons["查看设备"].tap() }
            let device = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "sidebar.device.")).firstMatch
            if !device.isHittable && header.exists { header.tap() }
            XCTAssertTrue(device.waitForExistence(timeout: 10))
            device.tap()
            let workspaces = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "sidebar.workspace."))
            XCTAssertTrue(workspaces.firstMatch.waitForExistence(timeout: 20))
            guard let sessionID = ProcessInfo.processInfo.environment["PROBE_SESSION_ID"] else {
                XCTFail("A session ID is required to open a closed conversation"); return
            }
            let session = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND identifier ENDSWITH %@", "sidebar.session.", sessionID)).firstMatch
            for workspace in workspaces.allElementsBoundByIndex {
                if session.exists { break }
                if workspace.isHittable { workspace.tap(); _ = session.waitForExistence(timeout: 5) }
            }
            XCTAssertTrue(session.waitForExistence(timeout: 10))
            session.tap()
        }
        XCTAssertTrue(input.waitForExistence(timeout: 10))
        for cycle in 0..<6 {
            let pause = expectation(description: "Prepare interaction profiling")
            DispatchQueue.main.asyncAfter(deadline: .now() + 4) { pause.fulfill() }
            wait(for: [pause], timeout: 6)
            print("ComposerProbe cycle=\(cycle) action=focus begin")
            input.tap()
            let picker = app.buttons["选择模型"]
            XCTAssertTrue(picker.waitForExistence(timeout: 10))
            print("ComposerProbe cycle=\(cycle) action=model-picker begin")
            picker.tap()
            let close = app.buttons["关闭"].firstMatch
            XCTAssertTrue(close.waitForExistence(timeout: 10))
            close.tap()
            let conversation = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "conversation.session.")).firstMatch
            conversation.scrollViews.firstMatch.swipeDown()
            print("ComposerProbe cycle=\(cycle) action=finished")
        }
    }

    func testCurrentConversationCanScroll() throws {
        let app = XCUIApplication(bundleIdentifier: "com.bitfun.mobile.ios")
        app.activate()
        let before = XCTAttachment(string: app.debugDescription)
        before.name = "RemoteTimelineBeforeDrag"
        before.lifetime = .keepAlways
        add(before)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "RemoteTimelineBeforeDrag"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        let conversation = app.descendants(matching: .any).matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "conversation.session.")
        ).firstMatch
        let scroll = conversation.scrollViews.firstMatch
        guard scroll.waitForExistence(timeout: 10) else {
            XCTFail("No conversation scroll view is available")
            return
        }
        let start = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25))
        let end = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.8))
        for _ in 0..<12 { start.press(forDuration: 0.1, thenDragTo: end) }
        let after = XCTAttachment(string: app.debugDescription)
        after.name = "RemoteTimelineAfterDrag"
        after.lifetime = .keepAlways
        add(after)
        let afterScreenshot = XCTAttachment(screenshot: app.screenshot())
        afterScreenshot.name = "RemoteTimelineAfterDrag"
        afterScreenshot.lifetime = .keepAlways
        add(afterScreenshot)
    }
}
