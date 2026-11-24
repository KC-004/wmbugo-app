package app.wmbugo.ocr

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import java.nio.FloatBuffer

/** One recognised line: its text, its box in the original image's pixels and how sure the engine is (0 to 1). */
data class TextBlock(val text: String, val box: IntBox, val confidence: Float)

class OcrCancelled : RuntimeException("Cancelled")

/**
 * PaddleOCR PP-OCRv4 on ONNX Runtime (Story 10.10, decision S3): a detection model finds the text lines, a recognition model reads each one.
 * Nothing here knows Android, so the same code runs in the JVM tests against the synthetic receipts.
 *
 * Memory (S3 section 6): the CPU arena allocator and the memory pattern are off, two threads, and the sessions are closed after a scan by
 * whoever owns this object, so the native heap does not stay near 1 GB.
 */
class PaddleOcr(detModel: ByteArray, recModel: ByteArray, private val env: OrtEnvironment = OrtEnvironment.getEnvironment()) : AutoCloseable {
  private val options = OrtSession.SessionOptions().apply {
    setIntraOpNumThreads(2)
    setCPUArenaAllocator(false)
    setMemoryPatternOptimization(false)
  }
  private val det: OrtSession = env.createSession(detModel, options)
  private val rec: OrtSession = env.createSession(recModel, options)

  /** The recognition model carries its character list (one per line) in its metadata. */
  private val chars: List<String> = (rec.metadata.customMetadata["character"] ?: throw IllegalStateException("The recognition model has no character list"))
    .split('\n')
    .let { if (it.isNotEmpty() && it.last().isEmpty()) it.dropLast(1) else it }

  fun recognise(image: RgbImage, cancelled: () -> Boolean = { false }): List<TextBlock> {
    if (cancelled()) throw OcrCancelled()
    val (dw, dh) = OcrMath.detSize(image.width, image.height)
    val small = OcrMath.resize(image, dw, dh)
    val map = detect(small, dw, dh)
    val boxes = OcrMath.boxesFromMap(map, dw, dh).map { OcrMath.scaleBox(it, dw, dh, image.width, image.height) }
    val out = ArrayList<TextBlock>(boxes.size)
    for (box in boxes) {
      if (cancelled()) throw OcrCancelled()
      val line = OcrMath.crop(image, box)
      val crop = OcrMath.resize(line, OcrMath.recWidth(line.width, line.height), OcrMath.REC_HEIGHT)
      val (text, confidence) = read(crop)
      if (text.isNotBlank()) out.add(TextBlock(text.trim(), box, confidence))
    }
    return out
  }

  private fun detect(img: RgbImage, w: Int, h: Int): FloatArray {
    OnnxTensor.createTensor(env, FloatBuffer.wrap(OcrMath.detInput(img)), longArrayOf(1, 3, h.toLong(), w.toLong())).use { input ->
      det.run(mapOf(det.inputNames.first() to input)).use { result ->
        @Suppress("UNCHECKED_CAST")
        val map = result[0].value as Array<Array<Array<FloatArray>>>
        val flat = FloatArray(w * h)
        for (y in 0 until h) System.arraycopy(map[0][0][y], 0, flat, y * w, w)
        return flat
      }
    }
  }

  private fun read(img: RgbImage): Pair<String, Float> {
    OnnxTensor.createTensor(env, FloatBuffer.wrap(OcrMath.recInput(img)), longArrayOf(1, 3, img.height.toLong(), img.width.toLong())).use { input ->
      rec.run(mapOf(rec.inputNames.first() to input)).use { result ->
        @Suppress("UNCHECKED_CAST")
        val steps = result[0].value as Array<Array<FloatArray>>
        return OcrMath.ctcDecode(steps[0], chars)
      }
    }
  }

  override fun close() {
    det.close()
    rec.close()
    options.close()
  }
}
