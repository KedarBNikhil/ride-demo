package com.nandyalride.captain.staging

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
}