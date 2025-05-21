// Utility for Stripe Payment Link creation and retrieval

/**
 * Fetch or create a Stripe Payment Link for a given ticket (product)
 * @param {string} stripeSecretKey
 * @param {object} ticket - Notion ticket object
 * @returns {Promise<string>} - Payment link URL
 */
export async function getOrCreateStripePaymentLink(stripeSecretKey, event) {
  // If event already has a payment link, return it
  if (event.ticket_link) return event.ticket_link;

  // Otherwise, create a new payment link via Stripe API
  const res = await fetch('https://api.stripe.com/v1/payment_links', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${stripeSecretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][product_data][name]': event.productName || event.name, // Use ticket name if available, otherwise event name
      'line_items[0][price_data][unit_amount]': Math.round((event.price || 0) * 100),
      'line_items[0][price_data][tax_behavior]': 'exclusive',
      'line_items[0][quantity]': '1',
      'after_completion[type]': 'redirect',
      'after_completion[redirect][url]': 'https://oneapp.gratis/thanks'
    })
  });
  const data = await res.json();
  return data.url;
}
