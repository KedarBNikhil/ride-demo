package com.nandyalride.captain

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
}