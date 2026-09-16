package com.openbitfun.mobile.core.feature.session

/**
 * Whether the desktop peer can accept edited tool approvals.
 */
public enum class ToolApprovalEditSupport {
    SUPPORTED,
    UNSUPPORTED,
}

/** Runtime approvals accept a JSON-object patch in updated_input. */
public object ToolApprovalEditContract {
    public val support: ToolApprovalEditSupport = ToolApprovalEditSupport.SUPPORTED
}
