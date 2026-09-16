package com.openbitfun.mobile.app.platform

import android.content.ContentResolver
import android.net.Uri
import com.openbitfun.mobile.core.feature.workspace.RuntimeUploadSource
import java.io.FileInputStream
import java.nio.ByteBuffer

/** A picker-granted local file is a byte source, never a runtime workspace. */
internal class AndroidRuntimeUploadSource(resolver: ContentResolver, uri: Uri) : RuntimeUploadSource {
    private val descriptor = requireNotNull(resolver.openFileDescriptor(uri, "r")) { "Selected file could not be opened" }
    private val stream = FileInputStream(descriptor.fileDescriptor)
    override val size: Long = descriptor.statSize.also { if (it < 0) { close(); error("Selected provider does not expose a seekable file") } }
    override fun read(offset: Long, length: Int): ByteArray {
        val buffer = ByteBuffer.allocate(length)
        stream.channel.position(offset)
        while (buffer.hasRemaining()) { if (stream.channel.read(buffer) < 0) break }
        return buffer.array().copyOf(buffer.position())
    }
    override fun close() { runCatching { stream.close() }; runCatching { descriptor.close() } }
}
