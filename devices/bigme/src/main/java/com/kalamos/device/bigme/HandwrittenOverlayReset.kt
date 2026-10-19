package com.kalamos.device.bigme

/** The service owns a composed output buffer in addition to the client's mapped drawing canvas.
 * Its firmware API addresses reset by client ID; never reset another editor or a global service. */
internal fun clearHandwrittenOverlay(clientClass: Class<*>, client: Any, serviceClass: Class<*>): Int {
    val server = clientClass.getDeclaredField("mServer").apply { isAccessible = true }.get(client)
        ?: error("Handwritten service is unavailable")
    val id = clientClass.getDeclaredField("mId").apply { isAccessible = true }.getInt(client)
    check(id >= 0) { "Handwritten client is not registered" }
    serviceClass.getMethod("clearOverlay", Int::class.javaPrimitiveType).invoke(server, id)
    return id
}
