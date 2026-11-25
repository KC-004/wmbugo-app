package app.wmbugo.ocr

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

/** The numeric parts, then the whole pipeline on the synthetic receipts with the real models (skipped when the models are not fetched). */
class PaddleOcrTest {
  @Test
  fun detSizeKeepsAspectAndMultiplesOf32() {
    val (lw, lh) = OcrMath.detSize(2048, 2730)
    assertTrue(lw % 32 == 0 && lh % 32 == 0 && lh <= 992 && lh > lw)
    val (w, h) = OcrMath.detSize(2048, 1536)
    assertTrue(w % 32 == 0 && h % 32 == 0 && maxOf(w, h) <= 992)
    assertEquals(Pair(32, 32), OcrMath.detSize(5, 5))
  }

  @Test
  fun boxesFromMapFindsTwoLinesAndDropsWeakOnes() {
    val w = 100
    val h = 60
    val map = FloatArray(w * h)
    fun fill(x0: Int, y0: Int, x1: Int, y1: Int, v: Float) { for (y in y0 until y1) for (x in x0 until x1) map[y * w + x] = v }
    fill(10, 10, 80, 18, 0.9f)
    fill(10, 30, 60, 38, 0.9f)
    fill(10, 50, 40, 56, 0.4f) // above the pixel threshold but under the box score
    val boxes = OcrMath.boxesFromMap(map, w, h)
    assertEquals(2, boxes.size)
    assertTrue(boxes[0].top < boxes[1].top)
    assertTrue(boxes[0].left <= 10 && boxes[0].right >= 80 && boxes[0].top <= 10 && boxes[0].bottom >= 18)
  }

  @Test
  fun ctcDecodeCollapsesRepeatsAndBlanks() {
    val chars = listOf("a", "b")
    fun row(i: Int) = FloatArray(4).also { it[i] = 0.9f; it[0] += if (i == 0) 0.1f else 0.1f }
    // blank, a, a, blank, a, b, b -> "aab"
    val steps = arrayOf(row(0), row(1), row(1), row(0), row(1), row(2), row(2))
    val (text, confidence) = OcrMath.ctcDecode(steps, chars)
    assertEquals("aab", text)
    assertTrue(confidence > 0.8f)
    // A class past the list is a space.
    assertEquals(" ", OcrMath.ctcDecode(arrayOf(row(3)), chars).first)
  }

  /** Decodes a PNG with the JDK's ImageIO through reflection (the Android class path used to compile unit tests does not have it). */
  private fun load(name: String): RgbImage {
    val io = Class.forName("javax.imageio.ImageIO")
    val img = io.getMethod("read", File::class.java).invoke(null, File("../../../../fixtures/receipts/synthetic/$name.png"))!!
    val c = img.javaClass
    val width = c.getMethod("getWidth").invoke(img) as Int
    val height = c.getMethod("getHeight").invoke(img) as Int
    val getRgb = c.getMethod("getRGB", Int::class.javaPrimitiveType, Int::class.javaPrimitiveType)
    val px = IntArray(width * height)
    for (y in 0 until height) for (x in 0 until width) {
      val argb = getRgb.invoke(img, x, y) as Int
      val alpha = (argb ushr 24) / 255f
      fun ch(shift: Int) = Math.round(((argb shr shift) and 255) * alpha + 255 * (1 - alpha))
      px[y * width + x] = (ch(16) shl 16) or (ch(8) shl 8) or ch(0)
    }
    return RgbImage(width, height, px)
  }

  private fun normal(s: String) = s.lowercase().filter { it.isLetterOrDigit() }

  @Test
  fun readsTheSyntheticReceiptsLikeTheRecordedPaddleOutput() {
    val dir = File("src/main/assets/ocr")
    val det = File(dir, "ch_PP-OCRv4_det_infer.onnx")
    val rec = File(dir, "ch_PP-OCRv4_rec_infer.onnx")
    // CI fetches the models first, so there a missing one is a failure; a developer without them skips this test.
    if (System.getenv("CI") != null) assertTrue("models not fetched", det.exists() && rec.exists())
    assumeTrue("models not fetched (node scripts/fetch-ocr-models.mjs)", det.exists() && rec.exists())
    val ids = listOf("01-india-in", "02-india-in", "11-us-canada-us", "12-us-canada-us", "21-uk-europe-eu", "26-uk-europe-uk", "31-gulf-se-asia-gulf", "37-gulf-se-asia-sg")
      .filter { File("../../../../fixtures/receipts/synthetic/$it.png").exists() }
    assertTrue(ids.size >= 4)
    var recorded = 0
    var matched = 0
    var totals = 0
    PaddleOcr(det.readBytes(), rec.readBytes()).use { engine ->
      for (id in ids) {
        val started = System.nanoTime()
        val blocks = engine.recognise(load(id))
        val ms = (System.nanoTime() - started) / 1_000_000
        println("ocr $id: ${blocks.size} lines in $ms ms")
        val got = blocks.map { normal(it.text) }
        val joined = got.joinToString("")
        // What the recorded run read (Story 10.1 fixtures) should mostly be read again.
        val recordedText = Regex("\"text\": \"((?:[^\"\\\\]|\\\\.)*)\"").findAll(File("../../../../packages/core/test/fixtures/receipts/$id.ocr.json").readText()).map { normal(it.groupValues[1]) }.filter { it.length >= 4 }.toList()
        recorded += recordedText.size
        matched += recordedText.count { t -> got.contains(t) || joined.contains(t) }
        // The printed total, digits only (the decimal mark differs by market).
        val total = Regex("\"totalMinor\": (\\d+)").find(File("../../../../fixtures/receipts/synthetic/$id.json").readText())!!.groupValues[1]
        if (joined.filter { it.isDigit() }.contains(total)) totals++
      }
    }
    println("recall $matched / $recorded, totals $totals / ${ids.size}")
    assertTrue("recall too low: $matched / $recorded", matched >= recorded * 0.85)
    assertTrue("totals found: $totals / ${ids.size}", totals >= ids.size * 0.75)
  }
}
