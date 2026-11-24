package app.wmbugo.ocr

import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/** A decoded image as packed 0xRRGGBB pixels, row by row. No Android types, so the whole pipeline runs in a plain JVM test. */
class RgbImage(val width: Int, val height: Int, val rgb: IntArray) {
  init {
    require(width > 0 && height > 0 && rgb.size == width * height) { "Bad image size" }
  }
}

/** A box in image pixels. Right and bottom are exclusive. */
data class IntBox(val left: Int, val top: Int, val right: Int, val bottom: Int) {
  val width get() = right - left
  val height get() = bottom - top
}

/** The numeric parts of PaddleOCR PP-OCRv4 detection (DB) and recognition (CTC): pure functions, no model and no runtime. */
object OcrMath {
  const val DET_MAX_SIDE = 960
  const val DET_THRESHOLD = 0.3f
  const val DET_BOX_THRESHOLD = 0.6f
  const val DET_UNCLIP_RATIO = 1.5f
  const val REC_HEIGHT = 48
  const val REC_MAX_WIDTH = 2048

  private val DET_MEAN = floatArrayOf(0.485f, 0.456f, 0.406f)
  private val DET_STD = floatArrayOf(0.229f, 0.224f, 0.225f)

  /** The size detection runs at: the long side at most [DET_MAX_SIDE], both sides rounded to a multiple of 32 (at least 32). */
  fun detSize(width: Int, height: Int): Pair<Int, Int> {
    val scale = min(1f, DET_MAX_SIDE.toFloat() / max(width, height))
    fun snap(v: Int) = max(32, (Math.round(v * scale / 32f)) * 32)
    return Pair(snap(width), snap(height))
  }

  fun resize(src: RgbImage, w: Int, h: Int): RgbImage {
    if (src.width == w && src.height == h) return src
    val out = IntArray(w * h)
    val sx = src.width.toFloat() / w
    val sy = src.height.toFloat() / h
    for (y in 0 until h) {
      val fy = max(0f, (y + 0.5f) * sy - 0.5f)
      val y0 = min(src.height - 1, floor(fy).toInt())
      val y1 = min(src.height - 1, y0 + 1)
      val wy = fy - y0
      for (x in 0 until w) {
        val fx = max(0f, (x + 0.5f) * sx - 0.5f)
        val x0 = min(src.width - 1, floor(fx).toInt())
        val x1 = min(src.width - 1, x0 + 1)
        val wx = fx - x0
        var px = 0
        for (shift in intArrayOf(16, 8, 0)) {
          val a = (src.rgb[y0 * src.width + x0] shr shift) and 255
          val b = (src.rgb[y0 * src.width + x1] shr shift) and 255
          val c = (src.rgb[y1 * src.width + x0] shr shift) and 255
          val d = (src.rgb[y1 * src.width + x1] shr shift) and 255
          val top = a + (b - a) * wx
          val bottom = c + (d - c) * wx
          px = (px shl 8) or Math.round(top + (bottom - top) * wy).coerceIn(0, 255)
        }
        out[y * w + x] = px
      }
    }
    return RgbImage(w, h, out)
  }

  fun crop(src: RgbImage, box: IntBox): RgbImage {
    val l = box.left.coerceIn(0, src.width - 1)
    val t = box.top.coerceIn(0, src.height - 1)
    val r = box.right.coerceIn(l + 1, src.width)
    val b = box.bottom.coerceIn(t + 1, src.height)
    val w = r - l
    val h = b - t
    val out = IntArray(w * h)
    for (y in 0 until h) System.arraycopy(src.rgb, (t + y) * src.width + l, out, y * w, w)
    return RgbImage(w, h, out)
  }

  /** Channel-first float input: `(pixel / 255 - mean) / std` for each of R, G, B. */
  private fun tensor(img: RgbImage, mean: FloatArray, std: FloatArray): FloatArray {
    val plane = img.width * img.height
    val out = FloatArray(3 * plane)
    for (i in 0 until plane) {
      val p = img.rgb[i]
      out[i] = (((p shr 16) and 255) / 255f - mean[0]) / std[0]
      out[plane + i] = (((p shr 8) and 255) / 255f - mean[1]) / std[1]
      out[2 * plane + i] = ((p and 255) / 255f - mean[2]) / std[2]
    }
    return out
  }

  fun detInput(img: RgbImage): FloatArray = tensor(img, DET_MEAN, DET_STD)

  fun recInput(img: RgbImage): FloatArray = tensor(img, floatArrayOf(0.5f, 0.5f, 0.5f), floatArrayOf(0.5f, 0.5f, 0.5f))

  /** Width of a recognition crop at [REC_HEIGHT] for a text box of this size. */
  fun recWidth(boxWidth: Int, boxHeight: Int): Int = ceil(REC_HEIGHT.toFloat() * boxWidth / max(1, boxHeight)).toInt().coerceIn(16, REC_MAX_WIDTH)

  /**
   * Text boxes from a detection probability map (row by row, `w` by `h`): pixels above [DET_THRESHOLD] form connected regions, a region
   * whose mean probability is under [DET_BOX_THRESHOLD] or that is tiny is dropped, and each box grows by the DB "unclip" distance
   * (`area * ratio / perimeter`) to undo the shrink the model was trained with. Boxes are in map pixels, sorted top to bottom, then left to right.
   */
  fun boxesFromMap(prob: FloatArray, w: Int, h: Int): List<IntBox> {
    val seen = BooleanArray(w * h)
    val stack = IntArray(w * h)
    val boxes = ArrayList<IntBox>()
    for (start in 0 until w * h) {
      if (seen[start] || prob[start] <= DET_THRESHOLD) continue
      var sp = 0
      stack[sp++] = start
      seen[start] = true
      var minX = w
      var minY = h
      var maxX = 0
      var maxY = 0
      var sum = 0.0
      var count = 0
      while (sp > 0) {
        val i = stack[--sp]
        val x = i % w
        val y = i / w
        sum += prob[i]
        count++
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
        for (dy in -1..1) for (dx in -1..1) {
          if (dx == 0 && dy == 0) continue
          val nx = x + dx
          val ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          val n = ny * w + nx
          if (!seen[n] && prob[n] > DET_THRESHOLD) {
            seen[n] = true
            stack[sp++] = n
          }
        }
      }
      val bw = maxX - minX + 1
      val bh = maxY - minY + 1
      if (min(bw, bh) < 3 || sum / count < DET_BOX_THRESHOLD) continue
      val d = (bw.toFloat() * bh * DET_UNCLIP_RATIO / (2f * (bw + bh)))
      val l = max(0, floor(minX - d).toInt())
      val t = max(0, floor(minY - d).toInt())
      val r = min(w, ceil(maxX + 1 + d).toInt())
      val b = min(h, ceil(maxY + 1 + d).toInt())
      if (min(r - l, b - t) >= 5) boxes.add(IntBox(l, t, r, b))
    }
    return boxes.sortedWith(compareBy<IntBox>({ it.top / 10 }, { it.left }))
  }

  /** Scales a box from detection-map pixels to the original image. */
  fun scaleBox(box: IntBox, fromW: Int, fromH: Int, toW: Int, toH: Int): IntBox {
    val sx = toW.toFloat() / fromW
    val sy = toH.toFloat() / fromH
    val l = floor(box.left * sx).toInt().coerceIn(0, toW - 1)
    val t = floor(box.top * sy).toInt().coerceIn(0, toH - 1)
    return IntBox(l, t, ceil(box.right * sx).toInt().coerceIn(l + 1, toW), ceil(box.bottom * sy).toInt().coerceIn(t + 1, toH))
  }

  /**
   * CTC greedy decoding of one recognition result (`steps` x classes). Class 0 is the blank; class `i` is `chars[i - 1]`, and any class past
   * the list is a space (the model has one more class than the dictionary). Repeats collapse and blanks go. The confidence is the mean
   * of the winning probability over the kept steps. Raw scores (outside 0..1) are turned into probabilities first.
   */
  fun ctcDecode(steps: Array<FloatArray>, chars: List<String>): Pair<String, Float> {
    val sb = StringBuilder()
    var total = 0f
    var kept = 0
    var last = -1
    for (row in steps) {
      var best = 0
      for (c in 1 until row.size) if (row[c] > row[best]) best = c
      if (best != 0 && best != last) {
        sb.append(if (best - 1 < chars.size) chars[best - 1] else " ")
        total += probability(row, best)
        kept++
      }
      last = best
    }
    return Pair(sb.toString(), if (kept == 0) 0f else total / kept)
  }

  private fun probability(row: FloatArray, best: Int): Float {
    var sum = 0f
    var inRange = true
    for (v in row) {
      if (v < 0f || v > 1f) inRange = false
      sum += v
    }
    if (inRange && sum in 0.9f..1.1f) return row[best]
    var m = row[0]
    for (v in row) if (v > m) m = v
    var e = 0.0
    for (v in row) e += Math.exp((v - m).toDouble())
    return (1.0 / e).toFloat()
  }
}
