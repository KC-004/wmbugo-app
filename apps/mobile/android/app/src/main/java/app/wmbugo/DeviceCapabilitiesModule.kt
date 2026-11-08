package app.wmbugo

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager

/**
 * Facts the glass fallback rule needs (docs/decisions/S8-reference-devices.md): API level,
 * reported total RAM, battery saver and the animator duration scale. No permission is required.
 */
class DeviceCapabilitiesModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  override fun getName() = "WmbugoDeviceCapabilities"

  @ReactMethod
  fun getCapabilities(promise: Promise) {
    try {
      val memory = ActivityManager.MemoryInfo()
      (ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).getMemoryInfo(memory)
      val power = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
      val scale = Settings.Global.getFloat(ctx.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f)
      val map = Arguments.createMap()
      map.putInt("apiLevel", Build.VERSION.SDK_INT)
      map.putDouble("totalRamMb", (memory.totalMem / (1024 * 1024)).toDouble())
      map.putBoolean("batterySaver", power.isPowerSaveMode)
      map.putDouble("animatorScale", scale.toDouble())
      promise.resolve(map)
    } catch (e: Exception) {
      promise.reject("E_CAPABILITIES", e)
    }
  }
}

class DeviceCapabilitiesPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(DeviceCapabilitiesModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
