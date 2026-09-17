package com.bitfun.mobile.core.feature.workspace

/** Platform picker owns only reading the user-selected file. Runtime owns publication. */
public interface RuntimeUploadSource {
    public val size: Long
    @Throws(Exception::class)
    public fun read(offset: Long, length: Int): ByteArray
    public fun close()
}
