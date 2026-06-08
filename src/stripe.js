/**
 * Stripe frontend config.
 *
 * 1. Create a Stripe account at https://stripe.com
 * 2. In the Stripe Dashboard → Products, create your subscription products:
 *      - AEMT Monthly / AEMT Yearly
 *      - Paramedic Monthly / Paramedic Yearly
 * 3. Copy each product's Price ID (starts with "price_")
 * 4. Set these as env vars in your deployment (Vercel, etc.):
 *
 *   VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...
 *   STRIPE_SECRET_KEY=sk_test_...            ← server-side only (api/)
 *   STRIPE_PRICE_AEMT_MONTHLY=price_...
 *   STRIPE_PRICE_AEMT_YEARLY=price_...
 *   STRIPE_PRICE_PARAMEDIC_MONTHLY=price_...
 *   STRIPE_PRICE_PARAMEDIC_YEARLY=price_...
 *
 * The publishable key is safe for the frontend. Never expose STRIPE_SECRET_KEY here.
 */

export const STRIPE_PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || null;

export const PLAN_PRICE_IDS = {
  aemt: {
    monthly: import.meta.env.VITE_STRIPE_PRICE_AEMT_MONTHLY || null,
    yearly:  import.meta.env.VITE_STRIPE_PRICE_AEMT_YEARLY  || null,
  },
  paramedic: {
    monthly: import.meta.env.VITE_STRIPE_PRICE_PARAMEDIC_MONTHLY || null,
    yearly:  import.meta.env.VITE_STRIPE_PRICE_PARAMEDIC_YEARLY  || null,
  },
};

/** Returns true once Stripe env vars have been filled in. */
export function isStripeConfigured() {
  return !!STRIPE_PUBLISHABLE_KEY && STRIPE_PUBLISHABLE_KEY !== "pk_test_REPLACE_ME";
}
