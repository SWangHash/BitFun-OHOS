@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class)
package com.openbitfun.mobile.core.persistence
import kotlinx.cinterop.*
import platform.Foundation.NSTemporaryDirectory
import platform.Foundation.NSUUID
import platform.posix.*
public actual class TemporaryDownload actual constructor(name: String) {
    private val directory = NSTemporaryDirectory() + "openbitfun-download-" + NSUUID().UUIDString
    init { check(mkdir(directory, 448u) == 0) { "Could not create download directory" } }
    public actual val reference: String = directory + "/" + (name.substringAfterLast('/').substringAfterLast('\\').takeIf { it.isNotBlank() && it != "." && it != ".." } ?: "download")
    private var output = fopen(reference, "wb") ?: error("Could not create download staging file")
    private var closed = false
    public actual fun write(bytes: ByteArray) {
        check(!closed)
        if (bytes.isNotEmpty()) bytes.usePinned { check(fwrite(it.addressOf(0), 1u, bytes.size.toULong(), output) == bytes.size.toULong()) { "Download staging write failed" } }
    }
    public actual fun close() { if (!closed) { closed = true; check(fclose(output) == 0) { "Download staging close failed" } } }
    public actual fun delete() { close(); remove(reference); rmdir(directory) }
}
