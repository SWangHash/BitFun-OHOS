//! Channel contracts for the runtime Qt toolchain provisioning: the pure
//! submit-path decision and the provisioner-to-port report mapping, compiled
//! in isolation via this shadow target because they live inside `bitfun-core`.

#[path = "../src/agentic/coordination/qt_toolchain_provisioning/decision.rs"]
mod provisioning_decision;

#[path = "../src/agentic/coordination/qt_toolchain_provisioning/report.rs"]
mod provisioning_report;
