package com.openbitfun.mobile.core.persistence

/** Controller-local staging file. Remote content is streamed; no whole-file buffer. */
public expect class TemporaryDownload public constructor(name: String) {
    public val reference: String
    public fun write(bytes: ByteArray)
    public fun close()
    public fun delete()
}
