package com.nandyalride.captain.staging

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
}