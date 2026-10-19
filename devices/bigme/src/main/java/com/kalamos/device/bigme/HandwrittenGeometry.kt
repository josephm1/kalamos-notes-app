package com.kalamos.device.bigme

/**
 * Refresh the vendor client's dependent geometry in the only safe order.
 *
 * HandwrittenClient.updateRotation() calculates the physical rotation and screen rectangle.
 * updateLayout() then uses those values to build the Matrix installed by getCanvas(). Reversing
 * the calls can leave a portrait SurfaceView backed by an untransformed landscape ION canvas:
 * the ordinary page looks correct, but each pen invalidation reveals vertically rotated content.
 */
internal fun refreshHandwrittenGeometry(
    updateRotation: () -> Unit,
    updateLayout: () -> Boolean,
): Boolean {
    updateRotation()
    return updateLayout()
}

/** Firmware may expose a Canvas object before its ION allocation is usable. */
internal fun usableHandwrittenCanvas(width: Int, height: Int, viewWidth: Int, viewHeight: Int): Boolean =
    width > 0 && height > 0 && viewWidth > 0 && viewHeight > 0 &&
        ((width == viewWidth && height == viewHeight) || (width == viewHeight && height == viewWidth))
