package app.wmbugo

import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock
import android.provider.Settings
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager

/**
 * The system prompt behind app lock (Story 8.3, SEC-004). App lock is a UI gate only: nothing here touches the database
 * key, so scheduled work runs while locked and a change of enrolled fingerprints never locks the user out (AD-9).
 *
 * Android 11 and later accepts a strong biometric or the device credential. Android 8 to 10 cannot combine a strong
 * biometric with the credential, so a weak biometric with the device credential as the fallback is used.
 */
class AppLockModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  override fun getName() = "WmbugoAppLock"

  private fun authenticators(): Int =
    if (Build.VERSION.SDK_INT >= 30) BIOMETRIC_STRONG or DEVICE_CREDENTIAL else BIOMETRIC_WEAK or DEVICE_CREDENTIAL

  /** True when the phone has a secure screen lock (PIN, pattern, password or an enrolled biometric). */
  @ReactMethod
  fun isDeviceSecure(promise: Promise) {
    try {
      val km = ctx.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
      promise.resolve(km.isDeviceSecure)
    } catch (e: Exception) {
      promise.reject("E_APPLOCK", e)
    }
  }

  /** `biometric` when a strong biometric is enrolled, `credential` when only a screen lock exists, `none` otherwise. */
  @ReactMethod
  fun availableKind(promise: Promise) {
    try {
      val bm = BiometricManager.from(ctx)
      val biometric = bm.canAuthenticate(BIOMETRIC_STRONG) == BiometricManager.BIOMETRIC_SUCCESS
      val km = ctx.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
      promise.resolve(if (biometric) "biometric" else if (km.isDeviceSecure) "credential" else "none")
    } catch (e: Exception) {
      promise.reject("E_APPLOCK", e)
    }
  }

  /** Resolves `{ result: 'success' | 'cancelled' | 'lockout' | 'unavailable' | 'error', message }`. */
  @ReactMethod
  fun authenticate(title: String, promise: Promise) {
    val activity = ctx.currentActivity as? FragmentActivity
    if (activity == null) {
      promise.resolve(outcome("unavailable", ""))
      return
    }
    activity.runOnUiThread {
      try {
        if (BiometricManager.from(ctx).canAuthenticate(authenticators()) != BiometricManager.BIOMETRIC_SUCCESS) {
          promise.resolve(outcome("unavailable", ""))
          return@runOnUiThread
        }
        var settled = false
        val settle = { result: String, message: String ->
          if (!settled) {
            settled = true
            promise.resolve(outcome(result, message))
          }
        }
        val callback = object : BiometricPrompt.AuthenticationCallback() {
          override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) = settle("success", "")
          override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
            val kind = when (errorCode) {
              BiometricPrompt.ERROR_USER_CANCELED, BiometricPrompt.ERROR_NEGATIVE_BUTTON, BiometricPrompt.ERROR_CANCELED -> "cancelled"
              BiometricPrompt.ERROR_LOCKOUT, BiometricPrompt.ERROR_LOCKOUT_PERMANENT -> "lockout"
              BiometricPrompt.ERROR_HW_NOT_PRESENT, BiometricPrompt.ERROR_HW_UNAVAILABLE, BiometricPrompt.ERROR_NO_BIOMETRICS, BiometricPrompt.ERROR_NO_DEVICE_CREDENTIAL -> "unavailable"
              else -> "error"
            }
            settle(kind, errString.toString())
          }
        }
        val info = BiometricPrompt.PromptInfo.Builder()
          .setTitle(title)
          .setAllowedAuthenticators(authenticators())
          .build()
        BiometricPrompt(activity, ContextCompat.getMainExecutor(ctx), callback).authenticate(info)
      } catch (e: Exception) {
        promise.resolve(outcome("error", e.javaClass.simpleName))
      }
    }
  }

  /** The monotonic clock (milliseconds since boot, counting deep sleep): changing the phone's clock cannot move it. */
  @ReactMethod
  fun elapsedRealtime(promise: Promise) = promise.resolve(SystemClock.elapsedRealtime().toDouble())

  @ReactMethod
  fun openSecuritySettings(promise: Promise) {
    try {
      val intent = Intent(Settings.ACTION_SECURITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      ctx.startActivity(intent)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("E_APPLOCK", e)
    }
  }

  private fun outcome(result: String, message: String) =
    com.facebook.react.bridge.Arguments.createMap().apply {
      putString("result", result)
      putString("message", message)
    }
}

class AppLockPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(AppLockModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
