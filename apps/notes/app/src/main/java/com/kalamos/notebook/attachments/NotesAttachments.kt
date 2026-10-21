package com.kalamos.notebook.attachments

import android.content.Intent
import android.media.MediaPlayer
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import androidx.fragment.app.Fragment
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** The picker and playback are app-owned; importing only copies bytes on an IO worker. */
internal class NotesAttachments(private val fragment: Fragment, private val emit: (JSONObject) -> Unit) : DefaultLifecycleObserver {
    private val context = fragment.requireContext().applicationContext
    private val store = NotesAttachmentStore(context)
    private val executor = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private val released = AtomicBoolean(false)
    private val audioManager = context.getSystemService(AudioManager::class.java)
    private val audioAttributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()
    private val audioFocus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
        .setAudioAttributes(audioAttributes).setOnAudioFocusChangeListener({ change ->
            if (change != AudioManager.AUDIOFOCUS_GAIN) stopAudio()
        }, main).build()
    init { fragment.lifecycle.addObserver(this) }
    override fun onStop(owner: LifecycleOwner) { stopAudio() }
    private var pending: Pair<String, String>? = null // main thread only
    private var player: MediaPlayer? = null
    private var playingId: String? = null
    private var prepared = false
    private var preparingRequest: String? = null
    private val ticker = object : Runnable {
        override fun run() {
            if (player != null && prepared && !released.get()) {
                val status = audioStatus()
                publishAudio(status)
                if (status.optBoolean("playing")) main.postDelayed(this, 1000)
            }
        }
    }
    private val picker = fragment.registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        val request = pending ?: return@registerForActivityResult
        pending = null
        if (released.get()) return@registerForActivityResult
        if (uri == null) result(request.first, JSONObject().put("cancelled", true))
        else work(request.first) { store.importUri(uri, request.second) }
    }

    fun call(method: String, args: JSONObject): String? = when (method) {
        "notes.attachments.pick" -> request { id ->
            val kind = args.getString("kind")
            require(kind in setOf("image", "audio", "file"))
            main.post {
                if (pending != null) error(id, "Finish the open file picker first")
                else if (!released.get()) {
                    pending = id to kind
                    try { picker.launch(arrayOf(if (kind == "file") "*/*" else "$kind/*")) }
                    catch (e: Exception) { pending = null; error(id, e.message ?: "File picker unavailable") }
                }
            }
        }
        "notes.attachments.image" -> request { id -> work(id) { store.image(args.getString("id")) } }
        "notes.attachments.open" -> request { id -> work(id) {
            val (file, mime) = store.openCopy(args.getString("id"))
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.agora-documents", file)
            launch(id, Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
            null
        } }
        "notes.attachments.link" -> request { id ->
            val uri = Uri.parse(args.getString("url"))
            require(uri.scheme in setOf("https", "http") && !uri.host.isNullOrBlank() && uri.userInfo == null) { "Enter an http or https link" }
            launch(id, Intent(Intent.ACTION_VIEW, uri))
        }
        "notes.attachments.audio" -> request { id -> work(id) {
            val asset = args.getString("id")
            require(store.metadata(asset).getString("mime").startsWith("audio/")) { "Not an audio attachment" }
            val file = store.file(asset)
            main.post { toggleAudio(id, asset, file.absolutePath) }
            null
        } }
        "notes.attachments.stop" -> { main.post { stopAudio() }; "{}" }
        else -> null
    }

    private fun request(start: (String) -> Unit): String {
        check(!released.get()) { "Notes was closed" }
        val id = UUID.randomUUID().toString()
        start(id)
        return JSONObject().put("reqId", id).toString()
    }

    private fun work(id: String, block: () -> JSONObject?) {
        executor.execute {
            if (!released.get()) try { block()?.let { result(id, it) } }
            catch (e: Exception) { error(id, e.message ?: "Attachment operation failed") }
        }
    }

    private fun launch(id: String, intent: Intent) {
        main.post {
            if (!released.get()) try {
                requireNotNull(fragment.activity) { "Notes was closed" }.startActivity(intent)
                result(id, JSONObject())
            } catch (e: Exception) { error(id, "No app could open this attachment: ${e.message ?: "unavailable"}") }
        }
    }

    private fun toggleAudio(request: String, asset: String, path: String) {
        if (released.get()) return
        try {
            val current = player
            if (playingId == asset && current != null) {
                check(prepared) { "Audio is still loading" }
                if (current.isPlaying) { current.pause(); audioManager.abandonAudioFocusRequest(audioFocus) } else startAudio(current)
                val status = audioStatus(); publishAudio(status); result(request, status); return
            }
            stopAudio()
            val next = MediaPlayer(); player = next; playingId = asset; preparingRequest = request
            next.setAudioAttributes(audioAttributes)
            next.setOnPreparedListener {
                if (player === next && !released.get()) {
                    prepared = true; preparingRequest = null
                    try { startAudio(next); result(request, audioStatus()) }
                    catch (e: Exception) { error(request, e.message ?: "Audio playback failed"); stopAudio() }
                }
            }
            next.setOnCompletionListener { if (player === next) { main.removeCallbacks(ticker); publishAudio(audioStatus()); audioManager.abandonAudioFocusRequest(audioFocus) } }
            next.setOnErrorListener { _, _, _ ->
                if (player === next) {
                    if(prepared && !released.get())emit(JSONObject().put("id", "notes.attachments.audioStatus").put("type", "error").put("message", "This device could not continue audio playback"))
                    else error(preparingRequest ?: request, "This device could not play the audio file")
                    preparingRequest = null; stopAudio()
                }
                true
            }
            next.setDataSource(path); next.prepareAsync()
        } catch (e: Exception) { error(request, e.message ?: "Audio playback failed"); stopAudio() }
    }

    private fun startAudio(value: MediaPlayer) {
        check(audioManager.requestAudioFocus(audioFocus) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) { "Audio is in use by another app" }
        value.start(); main.removeCallbacks(ticker); main.post(ticker)
    }
    private fun audioStatus(): JSONObject {
        val current = player
        val status = JSONObject().put("id", playingId ?: "").put("playing", false).put("positionMs", 0).put("durationMs", 0)
        if (current != null && prepared) runCatching {
            status.put("playing", current.isPlaying).put("positionMs", maxOf(0, current.currentPosition))
                .put("durationMs", maxOf(0, current.duration))
        }
        return status
    }
    private fun publishAudio(status: JSONObject) {
        if (!released.get() && status.optString("id").isNotBlank())
            emit(JSONObject().put("id", "notes.attachments.audioStatus").put("type", "status").put("value", status))
    }
    private fun stopAudio() {
        main.removeCallbacks(ticker)
        val status = audioStatus().put("playing", false)
        publishAudio(status)
        audioManager.abandonAudioFocusRequest(audioFocus)
        preparingRequest?.let { error(it, "Audio playback was cancelled") }
        preparingRequest = null; player?.release(); player = null; playingId = null; prepared = false
    }
    private fun result(id: String, value: JSONObject) {
        if (!released.get()) emit(JSONObject().put("id", id).put("type", "result").put("value", value))
    }
    private fun error(id: String, message: String) {
        if (!released.get()) emit(JSONObject().put("id", id).put("type", "error").put("message", message))
    }
    fun release() {
        released.set(true); executor.shutdown(); main.post { fragment.lifecycle.removeObserver(this); pending = null; stopAudio() }
    }
}
