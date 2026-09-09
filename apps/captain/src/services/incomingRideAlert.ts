import { AppState, type AppStateStatus } from 'react-native';
import type { AudioPlayer } from 'expo-audio';
import { isDirectCaptainOfferAlertActive, stopDirectCaptainOfferAlert } from './directCaptainRideOffers';

/**
 * One process-wide foreground alert. When Android backgrounds the app, this
 * player is stopped and the server-driven notification loop continues through
 * the operating system instead.
 */
class IncomingRideAlertService {
  private activeOfferId: string | null = null;
  private player: AudioPlayer | null = null;

  start(offerId: string) {
    if (AppState.currentState !== 'active' || this.activeOfferId === offerId || isDirectCaptainOfferAlertActive(offerId)) return;
    this.stop();
    this.activeOfferId = offerId;
    try {
      // Keep this native require inside the Captain-only lifecycle. The
      // Customer bundle imports shared navigation modules but never loads this
      // native module.
      const { createAudioPlayer } = require('expo-audio') as typeof import('expo-audio');
      const player = createAudioPlayer(require('../../assets/sounds/incoming_ride_alert.mp3'));
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
    stopDirectCaptainOfferAlert(offerId);
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
