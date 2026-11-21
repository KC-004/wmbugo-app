package app.wmbugo

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.util.Base64
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.io.OutputStream
import java.nio.channels.FileChannel
import java.nio.ByteBuffer
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * What backup and restore need from Android (Stories 8.7 to 8.9). No storage permission is used: the system save dialog and
 * file picker (Storage Access Framework) hand back one document the person chose.
 *
 * - `createDocument` / `pickDocument`: the system dialogs; resolve the content URI, or null when cancelled.
 * - `openWrite` / `write` / `closeWrite` / `deleteDocument`: stream encrypted bytes into the chosen document.
 * - `openRead` / `readAt` / `closeRead`: random-access reads of a picked backup.
 * - `openDecrypted` / `readDecrypted` / `closeDecrypted`: a receipt photo decrypted with the device file key and streamed to the
 *   caller in memory, so a photo never exists in plain form on disk during a backup. The GCM tag is checked at the end.
 */
class BackupFilesModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx), ActivityEventListener {
  private var pending: Promise? = null
  private val ids = AtomicInteger(1)
  private val writers = ConcurrentHashMap<Int, OutputStream>()
  private val readers = ConcurrentHashMap<Int, FileChannel>()
  private val decrypting = ConcurrentHashMap<Int, InputStream>()

  init {
    ctx.addActivityEventListener(this)
  }

  override fun getName() = "WmbugoBackupFiles"

  private fun launch(intent: Intent, request: Int, promise: Promise) {
    val activity = ctx.currentActivity
    if (activity == null) {
      promise.reject("E_NO_ACTIVITY", "No activity")
      return
    }
    if (pending != null) {
      promise.reject("E_BUSY", "A dialog is already open")
      return
    }
    pending = promise
    try {
      activity.startActivityForResult(intent, request)
    } catch (e: Exception) {
      pending = null
      promise.reject("E_DIALOG", e)
    }
  }

  @ReactMethod
  fun createDocument(suggestedName: String, promise: Promise) {
    val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = "application/octet-stream"
      putExtra(Intent.EXTRA_TITLE, suggestedName)
    }
    launch(intent, REQUEST_CREATE, promise)
  }

  @ReactMethod
  fun pickDocument(promise: Promise) {
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = "*/*"
    }
    launch(intent, REQUEST_PICK, promise)
  }

  /** A diagnostics export is plain text, so the save dialog offers a text file (Story 8.10). */
  @ReactMethod
  fun createTextDocument(suggestedName: String, promise: Promise) {
    val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = "text/plain"
      putExtra(Intent.EXTRA_TITLE, suggestedName)
    }
    launch(intent, REQUEST_CREATE, promise)
  }

  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode != REQUEST_CREATE && requestCode != REQUEST_PICK) return
    val promise = pending ?: return
    pending = null
    val uri = data?.data
    if (resultCode == Activity.RESULT_OK && uri != null) promise.resolve(uri.toString()) else promise.resolve(null)
  }

  override fun onNewIntent(intent: Intent) {}

  // ---- writing ----

  @ReactMethod
  fun openWrite(uri: String, promise: Promise) {
    try {
      val out = ctx.contentResolver.openOutputStream(Uri.parse(uri), "wt") ?: throw IllegalStateException("Cannot open the document")
      val id = ids.getAndIncrement()
      writers[id] = out
      promise.resolve(id)
    } catch (e: Exception) {
      promise.reject("E_OPEN", e.message, e)
    }
  }

  @ReactMethod
  fun write(handle: Int, base64: String, promise: Promise) {
    try {
      val out = writers[handle] ?: throw IllegalStateException("Unknown handle")
      out.write(Base64.decode(base64, Base64.NO_WRAP))
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("E_WRITE", e.message, e)
    }
  }

  @ReactMethod
  fun closeWrite(handle: Int, promise: Promise) {
    try {
      writers.remove(handle)?.let {
        it.flush()
        it.close()
      }
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("E_CLOSE", e.message, e)
    }
  }

  /** Removes a partly written or abandoned document. */
  @ReactMethod
  fun deleteDocument(uri: String, promise: Promise) {
    try {
      val ok = try {
        DocumentsContract.deleteDocument(ctx.contentResolver, Uri.parse(uri))
      } catch (_: Exception) {
        false
      }
      promise.resolve(ok)
    } catch (e: Exception) {
      promise.reject("E_DELETE", e.message, e)
    }
  }

  // ---- reading ----

  @ReactMethod
  fun openRead(uri: String, promise: Promise) {
    try {
      val pfd = ctx.contentResolver.openFileDescriptor(Uri.parse(uri), "r") ?: throw IllegalStateException("Cannot open the file")
      val channel = FileInputStream(pfd.fileDescriptor).channel
      val id = ids.getAndIncrement()
      readers[id] = channel
      val map = Arguments.createMap()
      map.putInt("handle", id)
      map.putDouble("size", channel.size().toDouble())
      promise.resolve(map)
    } catch (e: Exception) {
      promise.reject("E_OPEN", e.message, e)
    }
  }

  @ReactMethod
  fun readAt(handle: Int, offset: Double, length: Int, promise: Promise) {
    try {
      val ch = readers[handle] ?: throw IllegalStateException("Unknown handle")
      val buf = ByteBuffer.allocate(length)
      var pos = offset.toLong()
      while (buf.hasRemaining()) {
        val n = ch.read(buf, pos)
        if (n < 0) break
        pos += n
      }
      promise.resolve(Base64.encodeToString(buf.array(), 0, buf.position(), Base64.NO_WRAP))
    } catch (e: Exception) {
      promise.reject("E_READ", e.message, e)
    }
  }

  @ReactMethod
  fun closeRead(handle: Int, promise: Promise) {
    try {
      readers.remove(handle)?.close()
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("E_CLOSE", e.message, e)
    }
  }

  // ---- photos, decrypted in memory ----

  private fun fileKey(keyHex: String): ByteArray {
    // Same derivation as ReceiptFilesModule: HMAC-SHA256 of a fixed label keyed with the database key.
    val raw = ByteArray(keyHex.length / 2) { keyHex.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(raw, "HmacSHA256"))
    return mac.doFinal(FILE_KEY_LABEL.toByteArray(Charsets.UTF_8))
  }

  @ReactMethod
  fun openDecrypted(srcPath: String, keyHex: String, promise: Promise) {
    try {
      val input = FileInputStream(File(srcPath))
      val iv = ByteArray(IV_BYTES)
      if (input.read(iv) != IV_BYTES) throw IllegalStateException("Corrupt file")
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(fileKey(keyHex), "AES"), GCMParameterSpec(128, iv))
      val id = ids.getAndIncrement()
      decrypting[id] = javax.crypto.CipherInputStream(input, cipher)
      promise.resolve(id)
    } catch (e: Exception) {
      promise.reject("E_OPEN", e.message, e)
    }
  }

  /** Up to `length` plain bytes as base64; an empty string at the end. A damaged file throws here, at the end. */
  @ReactMethod
  fun readDecrypted(handle: Int, length: Int, promise: Promise) {
    Thread {
      try {
        val input = decrypting[handle] ?: throw IllegalStateException("Unknown handle")
        val buf = ByteArray(length)
        var filled = 0
        while (filled < length) {
          val n = input.read(buf, filled, length - filled)
          if (n < 0) break
          filled += n
        }
        promise.resolve(Base64.encodeToString(buf, 0, filled, Base64.NO_WRAP))
      } catch (e: Exception) {
        promise.reject("E_READ", e.message, e)
      }
    }.start()
  }

  @ReactMethod
  fun closeDecrypted(handle: Int, promise: Promise) {
    try {
      decrypting.remove(handle)?.close()
      promise.resolve(null)
    } catch (_: Exception) {
      promise.resolve(null)
    }
  }

  companion object {
    private const val REQUEST_CREATE = 7201
    private const val REQUEST_PICK = 7202
    private const val IV_BYTES = 12
    private const val FILE_KEY_LABEL = "wmbugo.filestore.v1"
  }
}

class BackupFilesPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(BackupFilesModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
