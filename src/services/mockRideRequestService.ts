export type MockRideRequest = { customerName: string; maskedCustomerNumber: string; pickupArea: string; destinationArea: string; distanceKm: number; etaMinutes: number; fare: number; pickup: { latitude: number; longitude: number }; drop: { latitude: number; longitude: number } };
const randomRideDelay = () => 5000 + Math.floor(Math.random() * 10001);
const request: MockRideRequest = { customerName: 'Lakshmi', maskedCustomerNumber: '+919876543210', pickupArea: 'Nandyal Bus Stand', destinationArea: 'Government General Hospital, Nandyal', distanceKm: 1.2, etaMinutes: 4, fare: 85, pickup: { latitude: 15.4871, longitude: 78.4814 }, drop: { latitude: 15.4921, longitude: 78.4862 } };
/** Demo replacement for a socket/push subscription. Unsubscribe stops the pending request. */
export const mockRideRequestService = {
  subscribe(onRequest: (request: MockRideRequest) => void) {
    const timer = setTimeout(() => onRequest(request), randomRideDelay());
    return () => clearTimeout(timer);
  },
};
