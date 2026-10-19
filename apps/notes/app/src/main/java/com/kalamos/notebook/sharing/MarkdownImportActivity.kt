package com.kalamos.notebook.sharing

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.util.AtomicFile
import android.widget.Toast
import com.kalamos.notebook.MainActivity
import org.json.JSONObject
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors

/** Copies granted shared text before returning to the single existing Notes editor activity. */
class MarkdownImportActivity:Activity() {
    override fun onCreate(state:Bundle?) {
        super.onCreate(state)
        val id=state?.getString("requestId")?:UUID.randomUUID().toString()
        requestId=id
        executor.execute {
            try {
                val file=MarkdownImport.file(this,id)
                if(!file.isFile) {
                    val payload=MarkdownImport.read(this,intent).put("notebookId","shared-$id")
                    val atomic=AtomicFile(file);val out=atomic.startWrite()
                    try{out.write(payload.toString().toByteArray());atomic.finishWrite(out)}catch(e:Exception){atomic.failWrite(out);throw e}
                }
                runOnUiThread {
                    if(isFinishing||isDestroyed)return@runOnUiThread
                    startActivity(Intent(this,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP).putExtra(MarkdownImport.EXTRA,id))
                    finish()
                }
            } catch(e:Exception) { runOnUiThread{Toast.makeText(this,e.message?:"Could not import Markdown",Toast.LENGTH_LONG).show();finish()} }
        }
    }
    private var requestId=""
    override fun onSaveInstanceState(out:Bundle){out.putString("requestId",requestId);super.onSaveInstanceState(out)}
    companion object {private val executor=Executors.newSingleThreadExecutor()}
}

internal object MarkdownImport {
    const val EXTRA="com.kalamos.notes.SHARED_MARKDOWN"
    fun file(context:Context,id:String):File {
        require(UUID.fromString(id).toString()==id){"Invalid share request"}
        return File(File(context.filesDir,"markdown-imports").apply{mkdirs()},"$id.json")
    }
    fun read(context:Context,intent:Intent):JSONObject {
        require(intent.action==Intent.ACTION_SEND){"Unsupported share"}
        require(intent.type in setOf("text/plain","text/markdown","text/x-markdown")){"Choose Markdown or text"}
        @Suppress("DEPRECATION") val uri=intent.getParcelableExtra<android.net.Uri>(Intent.EXTRA_STREAM)
        val text=if(uri!=null) {
            require(uri.scheme=="content"){"Choose a readable Markdown file"}
            val bytes=context.contentResolver.openInputStream(uri)!!.use { input ->
                val out=java.io.ByteArrayOutputStream();val buffer=ByteArray(8192)
                while(out.size()<=1_048_576){val n=input.read(buffer,0,minOf(buffer.size,1_048_577-out.size()));if(n<0)break;out.write(buffer,0,n)}
                out.toByteArray()
            }
            require(bytes.size<=1_048_576){"Markdown is too large (maximum 1 MB)"}
            Charsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(bytes)).toString()
        } else intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString().orEmpty()
        require(text.isNotBlank()&&!text.contains('\u0000')){"The share has no Markdown text"}
        require(text.toByteArray(Charsets.UTF_8).size<=1_048_576){"Markdown is too large (maximum 1 MB)"}
        val name=(intent.getStringExtra(Intent.EXTRA_TITLE)?:intent.getStringExtra(Intent.EXTRA_SUBJECT))?.trim()?.takeIf{it.isNotBlank()}
            ?:text.lineSequence().firstOrNull{it.isNotBlank()}?.trim()?.trimStart('#',' ')?:"Shared note"
        return JSONObject().put("name",name.take(120)).put("text",text)
    }
    @Synchronized fun pending(context:Context,intent:Intent):JSONObject {
        val id=intent.getStringExtra(EXTRA)?:return JSONObject()
        val f=file(context,id)
        if(!f.isFile)return JSONObject()
        return JSONObject(f.readText()).put("requestId",id)
    }
    @Synchronized fun acknowledge(context:Context,intent:Intent,id:String) {
        require(intent.getStringExtra(EXTRA)==id){"Share request changed"}
        file(context,id).delete();intent.removeExtra(EXTRA)
    }
}
