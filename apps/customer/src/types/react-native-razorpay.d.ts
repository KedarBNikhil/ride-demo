declare module 'react-native-razorpay' {
  type RazorpaySuccess = {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  };

  type RazorpayOptions = {
    key: string;
    amount: string;
    currency: string;
    name: string;
    description?: string;
    order_id: string;
    theme?: { color?: string };
  };

  const RazorpayCheckout: { open(options: RazorpayOptions): Promise<RazorpaySuccess> };
  export default RazorpayCheckout;
}
