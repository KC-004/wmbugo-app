package app.wmbugo

import android.app.Activity
import android.app.Application
import android.content.Context
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager

/**
 * What the app switcher (recent apps) shows (Story 8.2, SEC-005). The choice is kept in a private preference so a cold
 * start applies it before any JavaScript runs, and it is applied to every activity the app owns, so a dialog-styled
 * activity added later is covered too.
 *
 * Android 13 and later: `setRecentsScreenshotEnabled(false)` leaves the switcher without a snapshot.
 * Android 8 to 12: `FLAG_SECURE` on the window, which also blocks screenshots of wmbugo on those versions.
 *
 * Two reasons can ask for the hiding: the `Hide wmbugo in recent apps` setting, and app lock (Story 8.3), which enforces
 * it whatever the setting says. Both are separate preferences; the window is hidden when either is on.
 */
object RecentsPrivacy {
  private const val PREFS = "wmbugo_privacy"
  private const val KEY_SETTING = "hide_in_recents"
  private const val KEY_LOCK = "hide_for_app_lock"

  fun isHidden(context: Context): Boolean {
    val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    return p.getBoolean(KEY_SETTING, false) || p.getBoolean(KEY_LOCK, false)
  }

  fun setSetting(context: Context, hidden: Boolean) =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_SETTING, hidden).apply()

  fun setForAppLock(context: Context, on: Boolean) =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_LOCK, on).apply()

  fun apply(activity: Activity) {
    val hidden = isHidden(activity)
    if (Build.VERSION.SDK_INT >= 33) {
      activity.setRecentsScreenshotEnabled(!hidden)
    } else if (hidden) {
      activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
    } else {
      activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }
  }

  /** Applies the choice to each activity as it is created and resumed. */
  fun install(app: Application) {
    app.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
      override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = apply(activity)
      override fun onActivityResumed(activity: Activity) = apply(activity)
      override fun onActivityStarted(activity: Activity) {}
      override fun onActivityPaused(activity: Activity) {}
      override fun onActivityStopped(activity: Activity) {}
      override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
      override fun onActivityDestroyed(activity: Activity) {}
    })
  }
}

class PrivacyModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  override fun getName() = "WmbugoPrivacy"

  /** Android API level, so the screen can show the screenshot caption only where FLAG_SECURE is used. */
  @ReactMethod
  fun getApiLevel(promise: Promise) = promise.resolve(Build.VERSION.SDK_INT)

  @ReactMethod
  fun setHideInRecents(hidden: Boolean, promise: Promise) {
    try {
      RecentsPrivacy.setSetting(ctx, hidden)
      ctx.currentActivity?.let { a -> a.runOnUiThread { RecentsPrivacy.apply(a) } }
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("E_PRIVACY", e)
    }
  }

  /** Story 8.3: app lock forces the hiding on, whatever the setting says. */
  @ReactMethod
  fun setHideForAppLock(on: Boolean, promise: Promise) {
    try {
      RecentsPrivacy.setForAppLock(ctx, on)
      ctx.currentActivity?.let { a -> a.runOnUiThread { RecentsPrivacy.apply(a) } }
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("E_PRIVACY", e)
    }
  }
}

class PrivacyPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(PrivacyModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
