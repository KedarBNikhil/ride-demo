import { AppState, type AppStateStatus } from 'react-native';
import type { AudioPlayer } from 'expo-audio';

/**
 * One process-wide foreground-only alert. Android does not permit this JS
 * service to keep playing after the app backgrounds; the incoming-request
 * notification channel is the background/terminated alert mechanism.
 */
class IncomingRideAlertService {
  private activeOfferId: string | null = null;
  private player: AudioPlayer | null = null;

  start(offerId: string) {
    if (AppState.currentState !== 'active' || this.activeOfferId === offerId) return;
    this.stop();
    this.activeOfferId = offerId;
    try {
      // Android's system notification tone is deliberately used until a
      // product-owned assets/sounds/incoming_ride.wav is supplied.
      // Keep this native require inside the Captain-only lifecycle. The
      // Customer bundle imports shared navigation modules but never loads this
      // native module.
      const { createAudioPlayer } = require('expo-audio') as typeof import('expo-audio');
      const player = createAudioPlayer('content://settings/system/notification_sound');
      player.loop = true;
      player.play();
      this.player = player;
    } catch {
      // A normal remote-notification sound still provides the initial alert.
      this.activeOfferId = null;
    }
  }

  stop(offerId?: string) {
    if (offerId && this.activeOfferId && this.activeOfferId !== offerId) return;
    this.activeOfferId = null;
    const player = this.player;
    this.player = null;
    if (!player) return;
    try {
      player.pause();
      player.release();
    } catch {
      // Native cleanup is best effort during teardown.
    }
  }

  onAppStateChange(nextState: AppStateStatus) {
    if (nextState !== 'active') this.stop();
  }
}

export const incomingRideAlertService = new IncomingRideAlertService();
