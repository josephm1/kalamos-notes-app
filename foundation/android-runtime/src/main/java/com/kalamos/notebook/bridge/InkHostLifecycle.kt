package com.kalamos.notebook.bridge

/** Activity visibility and pending attachment ownership. This gate never draws or sets policy.
 * Tickets may be acquired on the bridge thread; retirement must precede releasing the device. */
class InkHostLifecycle {
    private var epoch = 0L
    private var hostEpoch = 0L
    private var visible = true
    @Synchronized fun hostTicket(): Long = if (visible) hostEpoch else -1L
    @Synchronized fun acceptsHost(ticket: Long): Boolean = visible && ticket == hostEpoch
    @Synchronized fun request(): Long = ++epoch
    @Synchronized fun accepts(ticket: Long): Boolean = visible && ticket == epoch
    @Synchronized fun retire() { epoch++ }
    @Synchronized fun stop() { visible = false; epoch++; hostEpoch++ }
    @Synchronized fun resume() { visible = true }
    @Synchronized fun isVisible(): Boolean = visible
}
