package com.openbitfun.mobile.core.crypto

/** Durable session keys are granted by the authenticated runtime. They are
 * independent of the controller's account-device key and survive reconnect. */
public object SessionEventCipher {
    public suspend fun decrypt(keyBase64: String, nonceBase64: String, ciphertextBase64: String): String {
        val plaintext = AesGcmCipher().decrypt(
            Base64Codec.decode(ciphertextBase64, "session ciphertext"),
            Base64Codec.decode(keyBase64, "session key"),
            Base64Codec.decode(nonceBase64, "session nonce"),
        )
        return plaintext.decodeToString(throwOnInvalidSequence = true)
    }
}
