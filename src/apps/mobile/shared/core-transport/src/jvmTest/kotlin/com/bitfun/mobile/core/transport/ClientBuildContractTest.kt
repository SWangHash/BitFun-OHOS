package com.bitfun.mobile.core.transport

import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Pins the mobile client build identity to the Rust source of truth and to
 * every place that must send it, mirroring
 * `src/web-ui/src/infrastructure/account/clientBuild.contract.test.ts`.
 *
 * The three mobile clients are covered from here because HarmonyOS keeps its
 * own ArkTS transport rather than this Kotlin one, and its unit runner cannot
 * read repository files; the JVM suite can, so it holds the whole contract.
 */
class ClientBuildContractTest {
    private val repoRoot: Path = generateSequence(Path.of("").toAbsolutePath()) { it.parent }
        .first { Files.exists(it.resolve("Cargo.toml")) && Files.exists(it.resolve("package.json")) }

    private fun source(relative: String): String = Files.readString(repoRoot.resolve(relative))

    @Test
    fun protocolVersionMatchesTheRustContract() {
        val accountContract = source("src/crates/contracts/product-domains/src/account.rs")
        assertTrue(
            accountContract.contains("pub const CLIENT_PROTOCOL_VERSION: u32 = $CLIENT_PROTOCOL_VERSION;"),
            "CLIENT_PROTOCOL_VERSION must equal bitfun_product_domains::account::CLIENT_PROTOCOL_VERSION",
        )
        val webContract = source("src/shared/relay-transport/ClientBuild.ts")
        assertTrue(
            webContract.contains("export const CLIENT_PROTOCOL_VERSION = $CLIENT_PROTOCOL_VERSION;"),
            "CLIENT_PROTOCOL_VERSION must equal the web clients' CLIENT_PROTOCOL_VERSION",
        )
    }

    @Test
    fun clientVersionIsTheWorkspaceReleaseVersion() {
        val packageVersion = Regex("\"version\"\\s*:\\s*\"([^\"]+)\"").find(source("package.json"))!!.groupValues[1]
        assertEquals(packageVersion, CLIENT_VERSION)
        assertTrue(Regex("^\\d+\\.\\d+\\.\\d+").containsMatchIn(CLIENT_VERSION))
        assertTrue(CLIENT_VERSION.length <= 64)
    }

    @Test
    fun kotlinTransportReportsTheBuildOnLoginAndOnEveryHandshake() {
        val transport = "src/apps/mobile/shared/core-transport/src/commonMain/kotlin/com/bitfun/mobile/core/transport"
        val realtime = source("$transport/AccountRealtime.kt")
        assertTrue(realtime.contains("put(\"clientVersion\", CLIENT_VERSION)"))
        assertTrue(realtime.contains("put(\"clientProtocol\", CLIENT_PROTOCOL_VERSION)"))
        val client = source("$transport/CloudAccountClient.kt")
        assertTrue(client.contains("@SerialName(\"clientVersion\") val clientVersion: String"))
        assertTrue(client.contains("@SerialName(\"clientProtocol\") val clientProtocol: Int"))
        assertTrue(client.contains("CLIENT_VERSION, CLIENT_PROTOCOL_VERSION"))
    }

    @Test
    fun harmonyOsTransportReportsTheSameBuild() {
        val services = "src/apps/mobile/harmonyos/entry/src/main/ets/services"
        val clientBuild = source("$services/ClientBuild.ets")
        assertTrue(
            clientBuild.contains("export const CLIENT_PROTOCOL_VERSION: number = $CLIENT_PROTOCOL_VERSION;"),
            "HarmonyOS CLIENT_PROTOCOL_VERSION must equal the Kotlin one",
        )
        // HarmonyOS reads its build string from the bundle manifest at runtime,
        // so the value is a call rather than a constant.
        val realtime = source("$services/AccountRealtime.ets")
        assertTrue(realtime.contains("clientVersion: clientVersion()"))
        assertTrue(realtime.contains("clientProtocol: CLIENT_PROTOCOL_VERSION"))
        // The phone login body carries it; a watch is provisioned by the phone
        // and reports its own build on its own handshake instead.
        val client = source("$services/CloudAccountClient.ets")
        assertTrue(client.contains("clientVersion: clientVersion(), clientProtocol: CLIENT_PROTOCOL_VERSION"))
    }
}
