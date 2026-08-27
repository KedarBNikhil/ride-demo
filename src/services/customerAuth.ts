import { registerPushNotifications } from './pushNotifications';
import { createProductionAuthService } from './productionAuth';

const productionAuth = createProductionAuthService('customer');

export const customerAuthService = {
  sendOtp: productionAuth.sendOtp,
  async verifyOtp(phone: string, otp: string) {
    await productionAuth.verifyOtp(phone, otp);
    void registerPushNotifications('customer').catch(() => undefined);
    return { verified: true };
  },
};
