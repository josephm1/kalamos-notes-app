package com.kalamos.notebook.bridge

/** Integer bounds for the Android SurfaceView that owns one native ink session. */
internal data class InkBoxBounds(
    val left: Int,
    val top: Int,
    val right: Int,
    val bottom: Int,
)

/**
 * Clamp web-requested device pixels to the measured Android host.
 *
 * `window.innerWidth * devicePixelRatio` is only an estimate: WebView density conversion can make
 * it one pixel larger than the real view. Bigme rejects any bound outside its physical screen before
 * rebuilding the daemon canvas matrix, which disables pen input. The measured native host is the
 * final geometry authority for every device backend.
 */
internal fun clampInkBoxToHost(
    requested: InkBoxBounds,
    hostWidth: Int,
    hostHeight: Int,
): InkBoxBounds? {
    if (hostWidth <= 0 || hostHeight <= 0) return null
    val left = requested.left.coerceIn(0, hostWidth - 1)
    val top = requested.top.coerceIn(0, hostHeight - 1)
    return InkBoxBounds(
        left = left,
        top = top,
        right = requested.right.coerceIn(left + 1, hostWidth),
        bottom = requested.bottom.coerceIn(top + 1, hostHeight),
    )
}
