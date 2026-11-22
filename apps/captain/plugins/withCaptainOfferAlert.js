const fs = require('fs');
const path = require('path');
const { AndroidConfig, withAndroidManifest, withAppBuildGradle, withDangerousMod } = require('@expo/config-plugins');

const serviceSource = (packageName) => `package ${packageName}

import android.app.*
import android.content.*
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.net.Uri
import android.os.*
import android.provider.Settings
import android.view.*
import android.widget.*
import androidx.core.app.NotificationCompat

class CaptainOfferAlertService : Service() {
  companion object { const val START = "${packageName}.START_OFFER_ALERT"; const val STOP = "${packageName}.STOP_OFFER_ALERT"; const val OFFER_ID = "offerId"; const val RIDE_ID = "rideId"; const val EXPIRES_AT = "expiresAt"; const val PICKUP = "pickup"; const val DROP = "drop"; const val FARE = "fare"; private const val CHANNEL = "incoming-ride-requests-v5"; private const val NOTIFICATION_ID = 7413 }
  private val handler = Handler(Looper.getMainLooper()); private var player: MediaPlayer? = null; private var offerId: String? = null; private var overlay: View? = null; private var windowManager: WindowManager? = null
  private val expiry = Runnable { stopSelf() }
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == STOP) { if (intent.getStringExtra(OFFER_ID) == null || intent.getStringExtra(OFFER_ID) == offerId) stopSelf(); return START_NOT_STICKY }
    val nextOffer = intent?.getStringExtra(OFFER_ID) ?: return START_NOT_STICKY; val rideId = intent.getStringExtra(RIDE_ID) ?: return START_NOT_STICKY; val expiresAt = intent.getLongExtra(EXPIRES_AT, 0L)
    if (expiresAt <= System.currentTimeMillis()) { stopSelf(); return START_NOT_STICKY }
    offerId = nextOffer; createChannel(); startForeground(NOTIFICATION_ID, notification(rideId, nextOffer), if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK else 0)
    showOverlay(rideId, nextOffer, intent.getStringExtra(PICKUP) ?: "Pickup location", intent.getStringExtra(DROP) ?: "Destination", intent.getStringExtra(FARE) ?: "")
    player?.release(); player = MediaPlayer.create(this, R.raw.incoming_ride_alert)?.apply { setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).build()); isLooping = true; start() }
    handler.removeCallbacks(expiry); handler.postDelayed(expiry, expiresAt - System.currentTimeMillis()); return START_NOT_STICKY
  }
  override fun onBind(intent: Intent?) = null
  override fun onDestroy() { handler.removeCallbacks(expiry); removeOverlay(); player?.run { if (isPlaying) stop(); release() }; player = null; super.onDestroy() }
  private fun createChannel() { if (Build.VERSION.SDK_INT >= 26) (getSystemService(NotificationManager::class.java)).createNotificationChannel(NotificationChannel(CHANNEL, "Incoming ride requests", NotificationManager.IMPORTANCE_HIGH).apply { description = "An active ride request needs a response"; setSound(null, null); enableVibration(true); lockscreenVisibility = Notification.VISIBILITY_PUBLIC }) }
  private fun offerIntent(rideId: String, offerId: String): PendingIntent { val uri = Uri.parse("exp+nandyal-ride-captain://ride-offer?rideId=$rideId&offerId=$offerId"); return PendingIntent.getActivity(this, (offerId + "open").hashCode(), Intent(Intent.ACTION_VIEW, uri).setPackage(packageName).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE) }
  private fun actionIntent(rideId: String, offerId: String, action: String): PendingIntent { val intent = Intent(this, CaptainOfferActionReceiver::class.java).setAction(CaptainOfferActionReceiver.ACTION).putExtra(CaptainOfferAlertService.RIDE_ID, rideId).putExtra(CaptainOfferAlertService.OFFER_ID, offerId).putExtra(CaptainOfferActionReceiver.RESPONSE, action); return PendingIntent.getBroadcast(this, (offerId + action).hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE) }
  private fun notification(rideId: String, offerId: String): Notification = NotificationCompat.Builder(this, CHANNEL).setSmallIcon(applicationInfo.icon).setContentTitle("New ride request").setContentText("Respond before this request expires.").setContentIntent(offerIntent(rideId, offerId)).addAction(0, "Reject", actionIntent(rideId, offerId, "reject")).addAction(0, "Accept", actionIntent(rideId, offerId, "accept")).setCategory(NotificationCompat.CATEGORY_CALL).setPriority(NotificationCompat.PRIORITY_MAX).setOngoing(true).setOnlyAlertOnce(true).setAutoCancel(false).build()
  private fun text(value: String, size: Float, color: Int, bold: Boolean = false) = TextView(this).apply { this.text = value; textSize = size; setTextColor(color); if (bold) setTypeface(typeface, 1); maxLines = 2; ellipsize = android.text.TextUtils.TruncateAt.END }
  private fun showOverlay(rideId: String, offerId: String, pickup: String, drop: String, fare: String) {
    removeOverlay(); if (Build.VERSION.SDK_INT < 23 || !Settings.canDrawOverlays(this)) return
    val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(22, 16, 22, 16); background = GradientDrawable().apply { setColor(Color.WHITE); cornerRadius = 32f; setStroke(1, Color.rgb(220, 228, 222)) }; elevation = 18f }
    root.addView(text("NEW RIDE REQUEST", 12f, Color.rgb(25, 106, 69), true)); root.addView(text(pickup, 18f, Color.rgb(25, 35, 29), true), LinearLayout.LayoutParams(-1, -2).apply { topMargin = 8 }); root.addView(text("→  $drop", 14f, Color.rgb(78, 92, 83)), LinearLayout.LayoutParams(-1, -2).apply { topMargin = 5 }); if (fare.isNotBlank()) root.addView(text(fare, 16f, Color.rgb(25, 106, 69), true), LinearLayout.LayoutParams(-1, -2).apply { topMargin = 8 })
    val actions = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL; orientation = LinearLayout.HORIZONTAL }; val reject = Button(this).apply { text = "REJECT"; setOnClickListener { sendBroadcast(Intent(this@CaptainOfferAlertService, CaptainOfferActionReceiver::class.java).setAction(CaptainOfferActionReceiver.ACTION).putExtra(CaptainOfferAlertService.RIDE_ID, rideId).putExtra(CaptainOfferAlertService.OFFER_ID, offerId).putExtra(CaptainOfferActionReceiver.RESPONSE, "reject")) } }; val accept = Button(this).apply { text = "ACCEPT"; setOnClickListener { sendBroadcast(Intent(this@CaptainOfferAlertService, CaptainOfferActionReceiver::class.java).setAction(CaptainOfferActionReceiver.ACTION).putExtra(CaptainOfferAlertService.RIDE_ID, rideId).putExtra(CaptainOfferAlertService.OFFER_ID, offerId).putExtra(CaptainOfferActionReceiver.RESPONSE, "accept")) } }; actions.addView(reject, LinearLayout.LayoutParams(0, -2, 1f)); actions.addView(accept, LinearLayout.LayoutParams(0, -2, 1f)); root.addView(actions, LinearLayout.LayoutParams(-1, -2).apply { topMargin = 10 })
    windowManager = getSystemService(WINDOW_SERVICE) as WindowManager; overlay = root; windowManager?.addView(root, WindowManager.LayoutParams(-1, WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY, WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN, android.graphics.PixelFormat.TRANSLUCENT).apply { gravity = Gravity.BOTTOM; y = 20 })
  }
  private fun removeOverlay() { overlay?.let { view -> try { windowManager?.removeView(view) } catch (_: Exception) {} }; overlay = null; windowManager = null }
}`;

const receiverSource = (packageName) => `package ${packageName}

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri

class CaptainOfferActionReceiver : BroadcastReceiver() {
  companion object { const val ACTION = "${packageName}.OFFER_ACTION"; const val RESPONSE = "response" }
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != ACTION) return
    val rideId = intent.getStringExtra(CaptainOfferAlertService.RIDE_ID) ?: return
    val offerId = intent.getStringExtra(CaptainOfferAlertService.OFFER_ID) ?: return
    val response = intent.getStringExtra(RESPONSE)?.takeIf { it == "accept" || it == "reject" } ?: return
    context.stopService(Intent(context, CaptainOfferAlertService::class.java).setAction(CaptainOfferAlertService.STOP).putExtra(CaptainOfferAlertService.OFFER_ID, offerId))
    val uri = Uri.parse("exp+nandyal-ride-captain://ride-offer?rideId=" + rideId + "&offerId=" + offerId + "&action=" + response)
    context.startActivity(Intent(Intent.ACTION_VIEW, uri).setPackage(context.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP))
  }
}`;

const messagingReceiverSource = (packageName) => `package ${packageName}

import android.content.Context
import android.content.Intent
import android.os.Build
import com.google.firebase.messaging.RemoteMessage
import io.invertase.firebase.messaging.ReactNativeFirebaseMessagingReceiver
import java.text.SimpleDateFormat
import java.util.Locale

// Receives a direct FCM ride offer before React Native's headless task is
// started. Starting the alert service here avoids relying on JS/AppState while
// Captain is behind another app or its JS runtime is suspended.
class CaptainRideMessagingReceiver : ReactNativeFirebaseMessagingReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val message = intent.extras?.let(::RemoteMessage)
    val data = message?.data
    val type = data?.get("type")

    if (type == "ride_offer_closed") {
      context.stopService(Intent(context, CaptainOfferAlertService::class.java)
        .setAction(CaptainOfferAlertService.STOP)
        .putExtra(CaptainOfferAlertService.OFFER_ID, data?.get("offerId")))
      if (!CaptainAppVisibility.isForeground) return
    }

    if (type == "ride_offer" && !CaptainAppVisibility.isForeground) {
      val offerData = data ?: run { super.onReceive(context, intent); return }
      val rideId = offerData["rideId"]
      val offerId = offerData["offerId"]
      val expiresAt = offerData["expiresAt"]?.let(::parseEpochMillis)
      if (!rideId.isNullOrBlank() && !offerId.isNullOrBlank() && expiresAt != null && expiresAt > System.currentTimeMillis()) {
        val alert = Intent(context, CaptainOfferAlertService::class.java)
          .setAction(CaptainOfferAlertService.START)
          .putExtra(CaptainOfferAlertService.RIDE_ID, rideId)
          .putExtra(CaptainOfferAlertService.OFFER_ID, offerId)
          .putExtra(CaptainOfferAlertService.EXPIRES_AT, expiresAt)
          .putExtra(CaptainOfferAlertService.PICKUP, offerData["pickup"])
          .putExtra(CaptainOfferAlertService.DROP, offerData["drop"])
          .putExtra(CaptainOfferAlertService.FARE, offerData["fare"])
        try {
          if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(alert) else context.startService(alert)
        } catch (error: Exception) {
          android.util.Log.e("CaptainRideFCM", "Unable to start the ride alert service", error)
        }
        // The foreground service is now responsible for this background offer.
        // Do not enqueue the same offer through headless JS a second time.
        return
      }
    }

    super.onReceive(context, intent)
  }

  private fun parseEpochMillis(value: String): Long? = runCatching {
    SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSX", Locale.US).parse(value)?.time
      ?: SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssX", Locale.US).parse(value)?.time
  }.getOrNull()
}`;

const appVisibilitySource = (packageName) => `package ${packageName}

import android.app.Activity
import android.app.Application
import android.os.Bundle

// Unlike React Native Firebase's process-level foreground check, this tracks
// whether a Captain activity is actually resumed. A broadcast receiver can
// otherwise mistake a paused Captain activity for a foreground app.
object CaptainAppVisibility : Application.ActivityLifecycleCallbacks {
  @Volatile private var resumedActivities = 0
  val isForeground: Boolean get() = resumedActivities > 0
  override fun onActivityResumed(activity: Activity) { resumedActivities += 1 }
  override fun onActivityPaused(activity: Activity) { resumedActivities = (resumedActivities - 1).coerceAtLeast(0) }
  override fun onActivityCreated(activity: Activity, state: Bundle?) = Unit
  override fun onActivityStarted(activity: Activity) = Unit
  override fun onActivityStopped(activity: Activity) = Unit
  override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
  override fun onActivityDestroyed(activity: Activity) = Unit
}`;

const moduleSource = (packageName) => `package ${packageName}

import android.content.Intent
import android.os.Build
import android.net.Uri
import android.provider.Settings
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class CaptainOfferAlertModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "CaptainOfferAlert"
  @ReactMethod fun start(rideId: String, offerId: String, expiresAt: Double, pickup: String?, drop: String?, fare: String?) { val intent = Intent(context, CaptainOfferAlertService::class.java).setAction(CaptainOfferAlertService.START).putExtra(CaptainOfferAlertService.RIDE_ID, rideId).putExtra(CaptainOfferAlertService.OFFER_ID, offerId).putExtra(CaptainOfferAlertService.EXPIRES_AT, expiresAt.toLong()).putExtra(CaptainOfferAlertService.PICKUP, pickup).putExtra(CaptainOfferAlertService.DROP, drop).putExtra(CaptainOfferAlertService.FARE, fare); if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent) }
  @ReactMethod fun stop(offerId: String?) { context.startService(Intent(context, CaptainOfferAlertService::class.java).setAction(CaptainOfferAlertService.STOP).putExtra(CaptainOfferAlertService.OFFER_ID, offerId)) }
  @ReactMethod fun canDrawOverlays(promise: com.facebook.react.bridge.Promise) { promise.resolve(Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(context)) }
  @ReactMethod fun openOverlaySettings() { context.startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + context.packageName)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
}`;

const packageSource = (packageName) => `package ${packageName}

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class CaptainOfferAlertPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(CaptainOfferAlertModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}`;

module.exports = function withCaptainOfferAlert(config) {
  const packageName = config.android.package;
  config = withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    manifest['uses-permission'] = manifest['uses-permission'] || [];
    if (!manifest['uses-permission'].some((item) => item.$['android:name'] === 'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK')) manifest['uses-permission'].push({ $: { 'android:name': 'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK' } });
    if (!manifest['uses-permission'].some((item) => item.$['android:name'] === 'android.permission.SYSTEM_ALERT_WINDOW')) manifest['uses-permission'].push({ $: { 'android:name': 'android.permission.SYSTEM_ALERT_WINDOW' } });
    const app = manifest.application?.[0]; app.service = app.service || [];
    if (!app.service.some((item) => item.$['android:name'] === '.CaptainOfferAlertService')) app.service.push({ $: { 'android:name': '.CaptainOfferAlertService', 'android:exported': 'false', 'android:foregroundServiceType': 'mediaPlayback' } });
    app.receiver = app.receiver || [];
    // The RN Firebase receiver sends background data messages through headless
    // JS. Replace it with a subclass that starts our native ride alert first.
    if (!app.receiver.some((item) => item.$['android:name'] === 'io.invertase.firebase.messaging.ReactNativeFirebaseMessagingReceiver' && item.$['tools:node'] === 'remove')) app.receiver.push({ $: { 'android:name': 'io.invertase.firebase.messaging.ReactNativeFirebaseMessagingReceiver', 'tools:node': 'remove' } });
    if (!app.receiver.some((item) => item.$['android:name'] === '.CaptainRideMessagingReceiver')) app.receiver.push({ $: { 'android:name': '.CaptainRideMessagingReceiver', 'android:exported': 'true', 'android:permission': 'com.google.android.c2dm.permission.SEND' }, 'intent-filter': [{ action: [{ $: { 'android:name': 'com.google.android.c2dm.intent.RECEIVE' } }] }] });
    if (!app.receiver.some((item) => item.$['android:name'] === '.CaptainOfferActionReceiver')) app.receiver.push({ $: { 'android:name': '.CaptainOfferActionReceiver', 'android:exported': 'false' } });
    return mod;
  });
  // The React Native Firebase module keeps Firebase Messaging as an internal
  // dependency. Our receiver imports RemoteMessage directly, so expose the
  // same BoM-managed dependency to the app module as well.
  config = withAppBuildGradle(config, (mod) => {
    if (!mod.modResults.contents.includes('com.google.firebase:firebase-messaging')) {
      mod.modResults.contents = mod.modResults.contents.replace('dependencies {', 'dependencies {\n    implementation(platform("com.google.firebase:firebase-bom:34.18.0"))\n    implementation("com.google.firebase:firebase-messaging")');
    }
    return mod;
  });
  return withDangerousMod(config, ['android', async (mod) => {
    const sourceDir = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/java', ...packageName.split('.'));
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'CaptainOfferAlertService.kt'), serviceSource(packageName));
    fs.writeFileSync(path.join(sourceDir, 'CaptainOfferActionReceiver.kt'), receiverSource(packageName));
    fs.writeFileSync(path.join(sourceDir, 'CaptainRideMessagingReceiver.kt'), messagingReceiverSource(packageName));
    fs.writeFileSync(path.join(sourceDir, 'CaptainAppVisibility.kt'), appVisibilitySource(packageName));
    fs.writeFileSync(path.join(sourceDir, 'CaptainOfferAlertModule.kt'), moduleSource(packageName));
    fs.writeFileSync(path.join(sourceDir, 'CaptainOfferAlertPackage.kt'), packageSource(packageName));
    const applicationPath = path.join(sourceDir, 'MainApplication.kt'); let application = fs.readFileSync(applicationPath, 'utf8');
    if (!application.includes('CaptainOfferAlertPackage()')) application = application.replace('// Packages that cannot be autolinked yet can be added manually here, for example:', 'add(CaptainOfferAlertPackage())\n              // Packages that cannot be autolinked yet can be added manually here, for example:');
    if (!application.includes('registerActivityLifecycleCallbacks(CaptainAppVisibility)')) application = application.replace('loadReactNative(this)', 'registerActivityLifecycleCallbacks(CaptainAppVisibility)\n    loadReactNative(this)');
    fs.writeFileSync(applicationPath, application);
    return mod;
  }]);
};
