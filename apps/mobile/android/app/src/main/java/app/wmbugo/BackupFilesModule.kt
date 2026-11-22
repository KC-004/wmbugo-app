package app.wmbugo

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
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
  // The descriptor behind a reader is kept: if only the channel were held, the descriptor could be garbage collected and its
  // finalizer would close the file under a read in progress.
  private val readerFds = ConcurrentHashMap<Int, ParcelFileDescriptor>()
  private val decrypting = ConcurrentHashMap<Int, InputStream>()
  private val encrypting = ConcurrentHashMap<Int, EncryptingFile>()

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

  /** The picker for a bank file (Story 9.6): offers CSV and text files first, and still lets the person browse everything. */
  @ReactMethod
  fun pickCsvDocument(promise: Promise) {
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = "*/*"
      putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("text/csv", "text/comma-separated-values", "text/plain", "application/csv", "application/vnd.ms-excel"))
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
      val channel = try {
        FileInputStream(pfd.fileDescriptor).channel
      } catch (e: Exception) {
        pfd.close()
        throw e
      }
      val id = ids.getAndIncrement()
      readerFds[id] = pfd
      readers[id] = channel
      val map = Arguments.createMap()
      map.putInt("handle", id)
      map.putDouble("size", channel.size().toDouble())
      // The file's display name, for the imports list (Story 9.8). The provider may not have one.
      map.putString("name", displayNameOf(Uri.parse(uri)))
      promise.resolve(map)
    } catch (e: Exception) {
      promise.reject("E_OPEN", e.message, e)
    }
  }

  private fun displayNameOf(uri: Uri): String? =
    try {
      ctx.contentResolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
        if (c.moveToFirst()) c.getString(0) else null
      }
    } catch (e: Exception) {
      null
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
      readerFds.remove(handle)?.close()
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
    var input: FileInputStream? = null
    try {
      input = FileInputStream(File(srcPath))
      val iv = ByteArray(IV_BYTES)
      // readFully: a single read may return fewer bytes than asked without the file being short.
      java.io.DataInputStream(input).readFully(iv)
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(fileKey(keyHex), "AES"), GCMParameterSpec(128, iv))
      val id = ids.getAndIncrement()
      decrypting[id] = javax.crypto.CipherInputStream(input, cipher)
      promise.resolve(id)
    } catch (e: Exception) {
      // The stream was opened before the failure: do not leave its descriptor behind.
      try { input?.close() } catch (_: Exception) {}
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

  // ---- photos, encrypted as they arrive (restore) ----

  /** Opens an encrypted photo file in the same format the app uses (12-byte IV, then AES-256-GCM), written as bytes arrive. */
  @ReactMethod
  fun openEncryptedWrite(destPath: String, keyHex: String, promise: Promise) {
    var out: java.io.FileOutputStream? = null
    try {
      val dest = File(destPath)
      dest.parentFile?.mkdirs()
      val iv = ByteArray(IV_BYTES).also { java.security.SecureRandom().nextBytes(it) }
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(fileKey(keyHex), "AES"), GCMParameterSpec(128, iv))
      out = java.io.FileOutputStream(dest)
      out.write(iv)
      val id = ids.getAndIncrement()
      encrypting[id] = EncryptingFile(out, cipher)
      promise.resolve(id)
    } catch (e: Exception) {
      try { out?.close() } catch (_: Exception) {}
      promise.reject("E_OPEN", e.message, e)
    }
  }

  @ReactMethod
  fun writeEncrypted(handle: Int, base64: String, promise: Promise) {
    try {
      val f = encrypting[handle] ?: throw IllegalStateException("Unknown handle")
      val bytes = Base64.decode(base64, Base64.NO_WRAP)
      f.out.write(f.cipher.update(bytes) ?: ByteArray(0))
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("E_WRITE", e.message, e)
    }
  }

  /** Writes the GCM tag and closes. Until this is called the file is not a complete photo. */
  @ReactMethod
  fun abortEncrypted(handle: Int, promise: Promise) {
    // An extraction that failed part-way: the stream is closed without finishing the cipher. The partial file is staging, which the
    // restore removes.
    try {
      encrypting.remove(handle)?.out?.close()
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("E_CLOSE", e.message, e)
    }
  }

  @ReactMethod
  fun closeEncrypted(handle: Int, promise: Promise) {
    try {
      val f = encrypting.remove(handle) ?: throw IllegalStateException("Unknown handle")
      f.out.write(f.cipher.doFinal())
      f.out.close()
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("E_CLOSE", e.message, e)
    }
  }

  /** Starts the app again from its launcher intent and ends this process: a restore swapped the data underneath it. */
  @ReactMethod
  fun restartApp(promise: Promise) {
    try {
      // No launch intent means nothing can bring the app back: say so instead of exiting into nothing.
      val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: throw IllegalStateException("No launch intent")
      launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
      ctx.startActivity(launch)
      promise.resolve(null)
      // A moment later, so the launch is handed over and the answer reaches JS before the process goes.
      Handler(Looper.getMainLooper()).postDelayed({ Runtime.getRuntime().exit(0) }, 300)
    } catch (e: Exception) {
      promise.reject("E_RESTART", e.message, e)
    }
  }

  private class EncryptingFile(val out: java.io.OutputStream, val cipher: Cipher)

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
