package com.nandyalride.captain

import android.app.*
import android.content.*
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.net.Uri
import android.os.*
import androidx.core.app.NotificationCompat

class CaptainOfferAlertService : Service() {
  companion object { const val START = "com.nandyalride.captain.START_OFFER_ALERT"; const val STOP = "com.nandyalride.captain.STOP_OFFER_ALERT"; const val OFFER_ID = "offerId"; const val RIDE_ID = "rideId"; const val EXPIRES_AT = "expiresAt"; private const val CHANNEL = "incoming-ride-requests-v3"; private const val NOTIFICATION_ID = 7413 }
  private val handler = Handler(Looper.getMainLooper()); private var player: MediaPlayer? = null; private var offerId: String? = null
  private val expiry = Runnable { stopSelf() }
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == STOP) { if (intent.getStringExtra(OFFER_ID) == null || intent.getStringExtra(OFFER_ID) == offerId) stopSelf(); return START_NOT_STICKY }
    val nextOffer = intent?.getStringExtra(OFFER_ID) ?: return START_NOT_STICKY; val rideId = intent.getStringExtra(RIDE_ID) ?: return START_NOT_STICKY; val expiresAt = intent.getLongExtra(EXPIRES_AT, 0L)
    if (expiresAt <= System.currentTimeMillis()) { stopSelf(); return START_NOT_STICKY }
    offerId = nextOffer; createChannel(); startForeground(NOTIFICATION_ID, notification(rideId, nextOffer), if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK else 0)
    player?.release(); player = MediaPlayer.create(this, R.raw.incoming_ride_alert)?.apply { setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).build()); isLooping = true; start() }
    handler.removeCallbacks(expiry); handler.postDelayed(expiry, expiresAt - System.currentTimeMillis()); return START_NOT_STICKY
  }
  override fun onBind(intent: Intent?) = null
  override fun onDestroy() { handler.removeCallbacks(expiry); player?.run { if (isPlaying) stop(); release() }; player = null; super.onDestroy() }
  private fun createChannel() { if (Build.VERSION.SDK_INT >= 26) (getSystemService(NotificationManager::class.java)).createNotificationChannel(NotificationChannel(CHANNEL, "Incoming ride requests", NotificationManager.IMPORTANCE_HIGH).apply { description = "An active ride request needs a response"; setSound(null, null); enableVibration(true) }) }
  private fun notification(rideId: String, offerId: String): Notification { val uri = Uri.parse("exp+nandyal-ride-captain://ride-offer?rideId=$rideId&offerId=$offerId"); val content = PendingIntent.getActivity(this, 0, Intent(Intent.ACTION_VIEW, uri).setPackage(packageName).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE); return NotificationCompat.Builder(this, CHANNEL).setSmallIcon(applicationInfo.icon).setContentTitle("New ride request").setContentText("A nearby ride is available.").setContentIntent(content).setCategory(NotificationCompat.CATEGORY_CALL).setPriority(NotificationCompat.PRIORITY_MAX).setOngoing(true).setOnlyAlertOnce(true).setAutoCancel(false).build() }
}