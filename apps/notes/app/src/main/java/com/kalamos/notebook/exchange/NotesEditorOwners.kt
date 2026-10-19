package com.kalamos.notebook.exchange

import android.app.Activity
import java.lang.ref.WeakReference

/** One mutable writing model per notebook across Notes' launcher and external activities. */
internal object NotesEditorOwners {
    private val owners = mutableMapOf<String, WeakReference<Activity>>()

    @Synchronized fun acquire(notebookId: String, activity: Activity): Boolean {
        owners.entries.removeAll { it.value.get()?.let { owner -> owner.isDestroyed || owner.isFinishing } != false }
        val existing = owners[notebookId]?.get()
        if (existing != null && existing !== activity) return false
        owners[notebookId] = WeakReference(activity)
        return true
    }
    @Synchronized fun owner(notebookId: String): Activity? = owners[notebookId]?.get()?.takeUnless { it.isDestroyed || it.isFinishing }

    @Synchronized fun release(notebookId: String, activity: Activity?) {
        if (owners[notebookId]?.get() === activity) owners.remove(notebookId)
    }
    @Synchronized fun release(activity: Activity?) {
        owners.entries.removeAll { it.value.get() === activity || it.value.get() == null }
    }
}
