package com.kalamos.notebook.sharing
import android.app.Application
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import org.junit.Assert.*
import org.junit.Test
import org.junit.Before
import androidx.core.content.FileProvider
import java.io.File
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.ByteArrayOutputStream

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],application=Application::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class NotesImageShareTest {
 private val context get()=RuntimeEnvironment.getApplication()
 @Before fun resetProviderCache(){
  val field=FileProvider::class.java.getDeclaredField("sCache");field.isAccessible=true;(field.get(null) as MutableMap<*,*>).clear()
 }
 private fun jpeg():String {val bmp=Bitmap.createBitmap(20,30,Bitmap.Config.ARGB_8888);val output=ByteArrayOutputStream();bmp.compress(Bitmap.CompressFormat.JPEG,90,output);bmp.recycle();return "data:image/jpeg;base64,"+android.util.Base64.encodeToString(output.toByteArray(),android.util.Base64.NO_WRAP)}
 @Test fun singleImageUsesAndroidChooserWithReadableContentUriAndThumbnailClip(){
  val share=NotesImageShare(context);val token=share.begin("Notes / title",1).getString("token");share.add(token,0,jpeg())
  val chooser=share.intent(token);assertEquals(Intent.ACTION_CHOOSER,chooser.action)
  val send=chooser.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)!!
  assertEquals(Intent.ACTION_SEND,send.action);assertEquals("image/jpeg",send.type);assertNull(send.`package`);assertNull(send.component)
  assertTrue(send.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION!=0);assertEquals(0,send.flags and Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
  val uri=send.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)!!;assertEquals("content",uri.scheme);assertEquals(uri,send.clipData!!.getItemAt(0).uri)
  assertEquals(uri,chooser.clipData!!.getItemAt(0).uri);assertEquals("Notes / title",send.getStringExtra(Intent.EXTRA_TITLE))
  val file=File(context.cacheDir,"notes-image-share").walkTopDown().first{it.extension=="jpg"};assertTrue(file.readBytes().isNotEmpty())
  val cursor=context.contentResolver.query(uri,arrayOf(android.provider.OpenableColumns.DISPLAY_NAME),null,null,null)!!
  cursor.use{assertTrue(it.moveToFirst());assertTrue(it.getString(0).endsWith("001.jpg"))}
  share.release();assertTrue(file.readBytes().isNotEmpty())
 }
 @Test fun multiplePagesPreserveOrderAndGrantEveryImage(){
  val share=NotesImageShare(context);val token=share.begin("Notebook",2).getString("token");share.add(token,0,jpeg());share.add(token,1,jpeg())
  val send=share.intent(token).getParcelableExtra<Intent>(Intent.EXTRA_INTENT)!!;assertEquals(Intent.ACTION_SEND_MULTIPLE,send.action)
  val images=send.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)!!;assertEquals(2,images.size)
  assertTrue(images[0].lastPathSegment!!.contains("001.jpg"));assertTrue(images[1].lastPathSegment!!.contains("002.jpg"))
  assertEquals(images,(0 until send.clipData!!.itemCount).map{send.clipData!!.getItemAt(it).uri})
 }
 @Test fun invalidPartialOrCancelledSharesNeverLaunch(){
  val share=NotesImageShare(context);assertThrows(IllegalArgumentException::class.java){share.begin("Notebook",33)}
  val token=share.begin("Notebook",2).getString("token")
  assertThrows(IllegalArgumentException::class.java){share.add(token,1,jpeg())}
  assertThrows(IllegalArgumentException::class.java){share.add(token,0,"data:image/jpeg;base64,AQID")}
  share.add(token,0,jpeg());assertThrows(IllegalArgumentException::class.java){share.intent(token)}
  share.cancel(token);assertThrows(IllegalArgumentException::class.java){share.intent(token)}
 }
}
