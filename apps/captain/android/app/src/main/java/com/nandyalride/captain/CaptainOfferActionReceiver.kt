package com.nandyalride.captain

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri

class CaptainOfferActionReceiver : BroadcastReceiver() {
  companion object { const val ACTION = "com.nandyalride.captain.OFFER_ACTION"; const val RESPONSE = "response" }
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != ACTION) return
    val rideId = intent.getStringExtra(CaptainOfferAlertService.RIDE_ID) ?: return
    val offerId = intent.getStringExtra(CaptainOfferAlertService.OFFER_ID) ?: return
    val response = intent.getStringExtra(RESPONSE)?.takeIf { it == "accept" || it == "reject" } ?: return
    context.stopService(Intent(context, CaptainOfferAlertService::class.java).setAction(CaptainOfferAlertService.STOP).putExtra(CaptainOfferAlertService.OFFER_ID, offerId))
    val uri = Uri.parse("exp+nandyal-ride-captain://ride-offer?rideId=" + rideId + "&offerId=" + offerId + "&action=" + response)
    context.startActivity(Intent(Intent.ACTION_VIEW, uri).setPackage(context.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP))
  }
}