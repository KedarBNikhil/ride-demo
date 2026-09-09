package com.nandyalride.captain

import android.content.Intent
import android.os.Build
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class CaptainOfferAlertModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "CaptainOfferAlert"
  @ReactMethod fun start(rideId: String, offerId: String, expiresAt: Double) { val intent = Intent(context, CaptainOfferAlertService::class.java).setAction(CaptainOfferAlertService.START).putExtra(CaptainOfferAlertService.RIDE_ID, rideId).putExtra(CaptainOfferAlertService.OFFER_ID, offerId).putExtra(CaptainOfferAlertService.EXPIRES_AT, expiresAt.toLong()); if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent) }
  @ReactMethod fun stop(offerId: String?) { context.startService(Intent(context, CaptainOfferAlertService::class.java).setAction(CaptainOfferAlertService.STOP).putExtra(CaptainOfferAlertService.OFFER_ID, offerId)) }
}