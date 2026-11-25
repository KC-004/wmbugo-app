package app.wmbugo.ocr

import android.graphics.BitmapFactory
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/**
 * `WmbugoOcr` (Story 10.10): reads one receipt image with the bundled PaddleOCR models, on its own thread (AD-16). The models live in the
 * APK's assets (`ocr/`), so nothing is downloaded and nothing leaves the phone. When a model is missing or will not load, the call rejects
 * with `E_UNAVAILABLE`; the JS adapter turns that into `OCR_UNAVAILABLE`. A bad image or a read that fails rejects with `E_IMAGE` or
 * `E_FAILED`, which can be tried again.
 */
class OcrModule(ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  private val worker = Executors.newSingleThreadExecutor { r -> Thread(null, r, "wmbugo-ocr", 16L * 1024 * 1024) }
  /** The stop flag of the newest read. Each read has its own, so a new one never revives a cancelled one. */
  private val current = AtomicReference<AtomicBoolean?>(null)

  override fun getName() = "WmbugoOcr"

  /** Resolves `{ width, height, blocks: [{ text, left, top, right, bottom, confidence }] }` in the image's own pixels. */
  @ReactMethod
  fun recognise(path: String, promise: Promise) {
    val cancelled = AtomicBoolean(false)
    current.getAndSet(cancelled)?.set(true)
    worker.execute {
      try {
        if (cancelled.get()) {
          promise.reject("E_CANCELLED", "Cancelled")
          return@execute
        }
        val assets = reactApplicationContext.assets
        val detBytes: ByteArray
        val recBytes: ByteArray
        try {
          detBytes = assets.open(DET).use { it.readBytes() }
          recBytes = assets.open(REC).use { it.readBytes() }
        } catch (e: Exception) {
          promise.reject("E_UNAVAILABLE", "The OCR models are not in this build", e)
          return@execute
        }
        val bitmap = BitmapFactory.decodeFile(path)
        if (bitmap == null) {
          promise.reject("E_IMAGE", "Cannot read the image")
          return@execute
        }
        val pixels = IntArray(bitmap.width * bitmap.height)
        bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
        val image = RgbImage(bitmap.width, bitmap.height, IntArray(pixels.size) { pixels[it] and 0xFFFFFF })
        bitmap.recycle()
        // The sessions are closed as soon as the scan ends, so the native heap does not stay large (S3 section 6).
        val engine = try {
          PaddleOcr(detBytes, recBytes)
        } catch (e: Throwable) {
          promise.reject("E_UNAVAILABLE", e.message ?: "The OCR models will not load", e)
          return@execute
        }
        val blocks = try {
          engine.use { it.recognise(image) { cancelled.get() } }
        } catch (e: OcrCancelled) {
          promise.reject("E_CANCELLED", "Cancelled")
          return@execute
        }
        val list = Arguments.createArray()
        for (b in blocks) {
          val m = Arguments.createMap()
          m.putString("text", b.text)
          m.putInt("left", b.box.left)
          m.putInt("top", b.box.top)
          m.putInt("right", b.box.right)
          m.putInt("bottom", b.box.bottom)
          m.putDouble("confidence", b.confidence.toDouble())
          list.pushMap(m)
        }
        val out = Arguments.createMap()
        out.putInt("width", image.width)
        out.putInt("height", image.height)
        out.putArray("blocks", list)
        promise.resolve(out)
      } catch (e: Throwable) {
        // Out of memory included: this read failed, the engine may well work on the next one.
        promise.reject("E_FAILED", e.message ?: "The read failed", e)
      }
    }
  }

  /** Stops a running read between two lines. */
  @ReactMethod
  fun cancel(promise: Promise) {
    current.get()?.set(true)
    promise.resolve(null)
  }

  private companion object {
    const val DET = "ocr/ch_PP-OCRv4_det_infer.onnx"
    const val REC = "ocr/ch_PP-OCRv4_rec_infer.onnx"
  }
}

class OcrPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> = listOf(OcrModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
