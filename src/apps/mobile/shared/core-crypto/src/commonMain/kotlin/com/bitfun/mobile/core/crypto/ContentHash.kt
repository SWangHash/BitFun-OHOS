package com.bitfun.mobile.core.crypto

import dev.whyoleg.cryptography.algorithms.SHA256

/** UTF-8 content identity shared by runtime optimistic file writes. */
public object ContentHash {
    public suspend fun sha256(content: String): String = relayCryptographyProvider.get(SHA256)
        .hasher().hash(content.encodeToByteArray()).joinToString("") { byte ->
            (byte.toInt() and 255).toString(16).padStart(2, '0')
        }
}

/** Incremental hashing for selected-file adapters; no whole-file allocation. */
public suspend fun ContentHash.sha256(size: Long, read: suspend (Long, Int) -> ByteArray): String {
    val hash = relayCryptographyProvider.get(SHA256).hasher().createHashFunction()
    try {
        var offset = 0L
        while (offset < size) {
            val length = minOf(3L * 1024 * 1024, size - offset).toInt()
            val bytes = read(offset, length)
            check(bytes.size == length) { "Upload source changed or could not be read" }
            hash.update(bytes); offset += bytes.size
        }
        return hash.hashToByteArray().joinToString("") { (it.toInt() and 255).toString(16).padStart(2, '0') }
    } finally { hash.close() }
}
public fun newFileTransferIdentity(): String = dev.whyoleg.cryptography.random.CryptographyRandom.Default
    .nextBytes(32).joinToString("") { (it.toInt() and 255).toString(16).padStart(2, '0') }
