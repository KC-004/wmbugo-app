package app.wmbugo

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
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
import java.io.FileOutputStream
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Receipt photos (Story 3.11). The Android Photo Picker (or the system file chooser before Android 13) hands back one
 * image without any storage or camera permission. The image is encrypted with AES-256-GCM into app-private storage; the
 * key is derived from the database key (HMAC-SHA256 with a fixed label), so the files are only readable with it.
 */
class ReceiptFilesModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx), ActivityEventListener {
  private var pickPromise: Promise? = null

  init {
    ctx.addActivityEventListener(this)
  }

  override fun getName() = "WmbugoReceiptFiles"

  /** Opens the picker. Resolves with the chosen image's content URI, or null when cancelled. */
  @ReactMethod
  fun pickPhoto(promise: Promise) {
    val activity = ctx.currentActivity
    if (activity == null) {
      promise.reject("E_NO_ACTIVITY", "No activity")
      return
    }
    if (pickPromise != null) {
      promise.reject("E_BUSY", "A picker is already open")
      return
    }
    val intent =
      if (Build.VERSION.SDK_INT >= 33) {
        Intent(MediaStore.ACTION_PICK_IMAGES)
      } else {
        Intent(Intent.ACTION_GET_CONTENT).apply {
          type = "image/*"
          addCategory(Intent.CATEGORY_OPENABLE)
        }
      }
    pickPromise = promise
    try {
      activity.startActivityForResult(intent, REQUEST_PICK)
    } catch (e: Exception) {
      pickPromise = null
      promise.reject("E_PICK", e)
    }
  }

  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode != REQUEST_PICK) return
    val promise = pickPromise ?: return
    pickPromise = null
    val uri = data?.data
    if (resultCode == Activity.RESULT_OK && uri != null) promise.resolve(uri.toString()) else promise.resolve(null)
  }

  override fun onNewIntent(intent: Intent) {}

  /** Reads the image, computes its SHA-256, and writes it encrypted to destPath. Resolves { digest, size } (plain size). */
  @ReactMethod
  fun importEncrypted(uri: String, destPath: String, keyHex: String, promise: Promise) {
    Thread {
      val dest = File(destPath)
      try {
        val key = deriveKey(keyHex)
        dest.parentFile?.mkdirs()
        val digest = MessageDigest.getInstance("SHA-256")
        val iv = ByteArray(IV_BYTES).also { SecureRandom().nextBytes(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
        var total = 0L
        ctx.contentResolver.openInputStream(Uri.parse(uri)).use { input ->
          if (input == null) throw IllegalStateException("Cannot open the image")
          FileOutputStream(dest).use { out ->
            out.write(iv)
            val buffer = ByteArray(64 * 1024)
            while (true) {
              val n = input.read(buffer)
              if (n < 0) break
              total += n
              if (total > MAX_BYTES) throw IllegalStateException("Image too large")
              digest.update(buffer, 0, n)
              out.write(cipher.update(buffer, 0, n) ?: ByteArray(0))
            }
            out.write(cipher.doFinal())
          }
        }
        if (total == 0L) throw IllegalStateException("Empty image")
        val map = Arguments.createMap()
        map.putString("digest", digest.digest().joinToString("") { "%02x".format(it) })
        map.putDouble("size", total.toDouble())
        promise.resolve(map)
      } catch (e: Exception) {
        dest.delete()
        promise.reject("E_IMPORT", e.message, e)
      }
    }.start()
  }

  /** Decrypts into the cache folder for display and resolves the plain file path. The cache is cleared with clearViewCache. */
  @ReactMethod
  fun decryptToCache(srcPath: String, keyHex: String, name: String, promise: Promise) {
    Thread {
      try {
        val key = deriveKey(keyHex)
        val dir = File(ctx.cacheDir, VIEW_DIR).also { it.mkdirs() }
        val out = File(dir, "$name.img")
        FileInputStream(srcPath).use { input ->
          val iv = ByteArray(IV_BYTES)
          if (input.read(iv) != IV_BYTES) throw IllegalStateException("Corrupt file")
          val cipher = Cipher.getInstance("AES/GCM/NoPadding")
          cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
          javax.crypto.CipherInputStream(input, cipher).use { plain -> FileOutputStream(out).use { plain.copyTo(it) } }
        }
        promise.resolve(out.absolutePath)
      } catch (e: Exception) {
        promise.reject("E_DECRYPT", e.message, e)
      }
    }.start()
  }

  @ReactMethod
  fun clearViewCache(promise: Promise) {
    try {
      File(ctx.cacheDir, VIEW_DIR).deleteRecursively()
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("E_CLEAR", e)
    }
  }

  private fun deriveKey(keyHex: String): ByteArray {
    val raw = ByteArray(keyHex.length / 2) { keyHex.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(raw, "HmacSHA256"))
    return mac.doFinal("wmbugo.filestore.v1".toByteArray(Charsets.UTF_8))
  }

  private companion object {
    const val REQUEST_PICK = 4471
    const val IV_BYTES = 12
    const val MAX_BYTES = 25L * 1024 * 1024
    const val VIEW_DIR = "receipt-view"
  }
}

class ReceiptFilesPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(ReceiptFilesModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
