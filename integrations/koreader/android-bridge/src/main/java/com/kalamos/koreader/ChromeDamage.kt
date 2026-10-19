package com.kalamos.koreader

import android.graphics.Rect

/** Replacing a queued chrome frame must retain every region that still needs clearing. */
internal class ChromeDamage {
    data class Ticket(val session: Long, val revision: Long, val bounds: Rect)
    private var session = Long.MIN_VALUE
    private var revision = 0L
    private val pending = Rect()
    fun add(owner: Long, region: Rect): Ticket {
        if (owner != session) { pending.setEmpty(); session = owner }
        pending.union(region)
        return Ticket(owner, ++revision, Rect(pending))
    }
    fun presented(ticket: Ticket) {
        if (ticket.session == session && ticket.revision == revision) pending.setEmpty()
    }
}
