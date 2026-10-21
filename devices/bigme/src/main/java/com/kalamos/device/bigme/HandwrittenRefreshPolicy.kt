package com.kalamos.device.bigme

/** Our retained composition owns every presentation, including regional erase cleanup.
 * Do not let the service replay the whole overlay again on its independent idle timer.
 * This is per-client; input gating and the package's display/auto-clean policy stay untouched. */
internal fun disableHandwrittenRecommit(clientClass: Class<*>, client: Any) {
    clientClass.getMethod("setRecommitEnabled", Boolean::class.javaPrimitiveType,
        Int::class.javaPrimitiveType, Int::class.javaPrimitiveType)
        .invoke(client, false, 0, EinkCenter.MODE_GU16)
}
