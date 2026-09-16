package com.openbitfun.mobile.core.persistence

import java.io.File
import kotlin.test.*

class TemporaryDownloadTest {
    @Test fun stagesBoundedChunksPreservesNameAndRemovesOnlyItsTemporaryFile() {
        val sink = TemporaryDownload("../report.bin")
        val block = ByteArray(65536) { (it % 251).toByte() }
        repeat(160) { sink.write(block) }
        sink.close()
        val file = File(sink.reference)
        assertEquals("report.bin", file.name)
        assertEquals(10485760L, file.length())
        file.inputStream().use { input -> repeat(160) { assertContentEquals(block, input.readNBytes(block.size)) }; assertEquals(-1, input.read()) }
        sink.delete()
        assertFalse(file.exists()); assertFalse(file.parentFile.exists())
    }
}
