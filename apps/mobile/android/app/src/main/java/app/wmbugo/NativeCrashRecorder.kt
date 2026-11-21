package app.wmbugo

import android.content.Context
import java.io.File
import java.util.concurrent.atomic.AtomicInteger

/**
 * Records an uncaught native exception as a local crash record (Story 8.1). The record holds the time, app version, the
 * exception class and code locations only: the exception message is never written, because it could carry anything. The
 * file goes to app-private storage next to the JS records (`files/crashes`, same name pattern, newest 20 kept). Nothing is
 * sent anywhere, and the previous handler still runs so the process dies as before.
 */
object NativeCrashRecorder {
  private const val MAX_RECORDS = 20
  private const val MAX_FRAMES = 30
  private val counter = AtomicInteger(0)

  fun install(context: Context) {
    val appVersion = try { context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "unknown" } catch (_: Throwable) { "unknown" }
    val previous = Thread.getDefaultUncaughtExceptionHandler()
    val dir = File(context.filesDir, "crashes")
    Thread.setDefaultUncaughtExceptionHandler { thread, error ->
      try {
        write(dir, appVersion, error)
      } catch (_: Throwable) {
        // a crash handler must never crash
      }
      previous?.uncaughtException(thread, error)
    }
  }

  internal fun write(dir: File, appVersion: String, error: Throwable) {
    dir.mkdirs()
    val t = System.currentTimeMillis()
    val frames = error.stackTrace.take(MAX_FRAMES).joinToString(",") { quote("at ${it.className}.${it.methodName} (${it.fileName ?: "?"}:${it.lineNumber})") }
    val json = "{\"t\":$t,\"appVersion\":${quote(appVersion)},\"schemaVersion\":null,\"kind\":\"native\"," +
      "\"errorType\":${quote(error.javaClass.name)},\"message\":\"\",\"frames\":[$frames]}"
    val name = "crash-" + t.toString().padStart(15, '0') + "-" + counter.getAndIncrement() + ".json"
    File(dir, name).writeText(json)
    val records = dir.listFiles { f -> Regex("crash-[0-9]+-[0-9]+[.]json").matches(f.name) }?.sortedBy { it.name } ?: return
    records.take(maxOf(0, records.size - MAX_RECORDS)).forEach { it.delete() }
  }

  private fun quote(s: String): String =
    "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ").replace("\r", " ") + "\""
}
