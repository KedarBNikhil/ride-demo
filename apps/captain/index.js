import { registerRootComponent } from 'expo';
import { configureCaptainFcmBackgroundHandling } from './src/services/directCaptainRideOffers';
import App from './App';

configureCaptainFcmBackgroundHandling();
registerRootComponent(App);
