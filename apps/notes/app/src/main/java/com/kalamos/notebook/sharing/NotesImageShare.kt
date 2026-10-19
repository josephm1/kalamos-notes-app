package com.kalamos.notebook.sharing

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.util.UUID

/** Standard Android image sharing. Never addresses a particular app or sends a chat. */
class NotesImageShare(private val context:Context) {
    private val root=File(context.cacheDir,"notes-image-share").apply{mkdirs()}
    private val sessions=mutableMapOf<String,Session>()
    private data class Session(val title:String,val expected:Int,val directory:File,val files:MutableList<File> = mutableListOf(),var bytes:Long=0)
    @Synchronized fun begin(title:String,count:Int):JSONObject {
        require(count in 1..32) { "Share up to 32 pages at a time" }
        require(title.length in 1..200 && title.none{it.isISOControl()}) { "Invalid notebook title" }
        // Keep recently granted files available to receiving apps, including delayed imports.
        root.listFiles()?.filter{it.isDirectory && System.currentTimeMillis()-it.lastModified()>7L*24*60*60*1000}?.forEach{it.deleteRecursively()}
        require(sessions.size<4) { "Finish the current share first" }
        val id=UUID.randomUUID().toString();val directory=File(root,id).apply{check(mkdirs())}
        sessions[id]=Session(title,count,directory)
        return JSONObject().put("token",id)
    }
    @Synchronized fun add(token:String,index:Int,image:String):JSONObject {
        val session=requireNotNull(sessions[token]) { "Share preparation expired" }
        require(index==session.files.size && index<session.expected) { "Invalid page order" }
        require(image.startsWith("data:image/jpeg;base64,") && image.length<=2_000_024) { "Invalid JPEG page" }
        val bytes=android.util.Base64.decode(image.substringAfter(','),android.util.Base64.DEFAULT)
        require(bytes.size in 1..1_500_000 && bytes.size>=3 && bytes[0]==0xff.toByte() && bytes[1]==0xd8.toByte() && bytes[2]==0xff.toByte()) { "Invalid JPEG page" }
        val size=BitmapFactory.Options().apply{inJustDecodeBounds=true};BitmapFactory.decodeByteArray(bytes,0,bytes.size,size)
        require(size.outWidth in 1..2000 && size.outHeight in 1..2000 && size.outMimeType=="image/jpeg") { "Invalid page dimensions" }
        require(session.bytes+bytes.size<=48_000_000) { "Shared pages are too large" }
        val filename=session.title.replace(Regex("[^\\p{L}\\p{N} ._-]"),"_").take(40).trim().ifEmpty{"Notebook"}
        val file=File(session.directory,"$filename - page ${(index+1).toString().padStart(3,'0')}.jpg")
        file.outputStream().use{it.write(bytes);it.fd.sync()};session.files.add(file);session.bytes+=bytes.size
        return JSONObject().put("pages",session.files.size)
    }
    @Synchronized fun intent(token:String):Intent {
        val session=requireNotNull(sessions[token]) { "Share preparation expired" }
        require(session.files.size==session.expected) { "Pages are not ready to share" }
        val uris=ArrayList(session.files.map{FileProvider.getUriForFile(context,"${context.packageName}.agora-documents",it)})
        val send=Intent(if(uris.size==1)Intent.ACTION_SEND else Intent.ACTION_SEND_MULTIPLE).apply {
            type="image/jpeg";addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            putExtra(Intent.EXTRA_TITLE,session.title);putExtra(Intent.EXTRA_SUBJECT,session.title)
            if(uris.size==1)putExtra(Intent.EXTRA_STREAM,uris[0])else putParcelableArrayListExtra(Intent.EXTRA_STREAM,uris)
            clipData=ClipData.newUri(context.contentResolver,session.title,uris[0]).apply{uris.drop(1).forEach{addItem(ClipData.Item(it))}}
        }
        sessions.remove(token)
        return Intent.createChooser(send,"Share").apply{addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);clipData=send.clipData}
    }
    @Synchronized fun cancel(token:String){sessions.remove(token)?.directory?.deleteRecursively()}
    @Synchronized fun release(){sessions.values.forEach{it.directory.deleteRecursively()};sessions.clear()}
}
