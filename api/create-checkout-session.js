/**
 * POST /api/create-checkout-session
 *
 * Body: { planKey, billing, email, name, successUrl, cancelUrl }
 *
 * Returns: { url } — the Stripe Checkout Session URL to redirect to.
 *
 * Required env vars:
 *   STRIPE_SECRET_KEY          — sk_live_... or sk_test_...
 *   STRIPE_PRICE_AEMT_MONTHLY
 *   STRIPE_PRICE_AEMT_YEARLY
 *   STRIPE_PRICE_PARAMEDIC_MONTHLY
 *   STRIPE_PRICE_PARAMEDIC_YEARLY
 */

import Stripe from "stripe";

const PRICE_IDS = {
  aemt: {
    monthly: process.env.STRIPE_PRICE_AEMT_MONTHLY,
    yearly:  process.env.STRIPE_PRICE_AEMT_YEARLY,
  },
  paramedic: {
    monthly: process.env.STRIPE_PRICE_PARAMEDIC_MONTHLY,
    yearly:  process.env.STRIPE_PRICE_PARAMEDIC_YEARLY,
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return res.status(500).json({ error: "Stripe is not configured on the server." });
  }

  const { planKey, billing, email, name, successUrl, cancelUrl } = req.body || {};

  if (!planKey || !billing) {
    return res.status(400).json({ error: "planKey and billing are required." });
  }

  const priceId = PRICE_IDS[planKey]?.[billing];
  if (!priceId) {
    return res.status(400).json({ error: `No Stripe price configured for ${planKey} / ${billing}.` });
  }

  try {
    const stripe = new Stripe(secretKey, { apiVersion: "2024-04-10" });

    const sessionParams = {
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl || `${req.headers.origin}?checkout=success`,
      cancel_url:  cancelUrl  || `${req.headers.origin}?checkout=cancel`,
      metadata: { planKey, billing, name: name || "" },
    };

    if (email) sessionParams.customer_email = email;

    const session = await stripe.checkout.sessions.create(sessionParams);
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Stripe error:", err.message);
    return res.status(500).json({ error: err.message || "Stripe session creation failed." });
  }
}
