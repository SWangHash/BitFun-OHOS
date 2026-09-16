package com.openbitfun.mobile.core.persistence
import java.io.File
import java.io.FileOutputStream
public actual class TemporaryDownload actual constructor(name: String) {
    private val directory = java.nio.file.Files.createTempDirectory("openbitfun-download-").toFile()
    private val file = File(directory, name.substringAfterLast('/').substringAfterLast('\\').takeIf { it.isNotBlank() && it != "." && it != ".." } ?: "download")
    private var output: FileOutputStream? = FileOutputStream(file)
    public actual val reference: String get() = file.absolutePath
    public actual fun write(bytes: ByteArray) { checkNotNull(output).write(bytes) }
    public actual fun close() { output?.close(); output = null }
    public actual fun delete() { close(); if (file.exists()) check(file.delete()) { "Could not remove download staging file" }; directory.delete() }
}
