// Utility for Stripe Payment Link creation and retrieval

/**
 * Create a Stripe Payment Link for an event
 * @param {string} stripeSecretKey - Stripe API key
 * @param {object} event - Event object with price and name
 * @returns {Promise<string>} - Payment link URL
 */
export async function getOrCreateStripePaymentLink(stripeSecretKey, event) {
  // If event already has a payment link, return it
  if (event.ticket_link) {
    console.log(`Using existing payment link for event ${event.name}: ${event.ticket_link}`);
    return event.ticket_link;
  }

  try {
    console.log(`Creating new payment link for event ${event.name} with price $${event.price}`);
    
    // Format the event name for the product - include both event name and ticket name
    const productName = event.productName || `Ticket: ${event.name}`;
    
    // Create a payment link using the Stripe Payment Links API
    const res = await fetch('https://api.stripe.com/v1/payment_links', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeSecretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        // Line item configuration
        'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][product_data][name]': productName,
        'line_items[0][price_data][product_data][description]': event.ticketDescription || `Admission to ${event.name}`,
        'line_items[0][price_data][unit_amount]': Math.round((event.price || 0) * 100),
        'line_items[0][quantity]': '1',
        
        // Payment link settings
        'after_completion[type]': 'hosted_confirmation',
        'billing_address_collection': 'auto',
        'custom_text[submit][message]': 'Purchase Ticket',
        'submit_type': 'pay',
        
        // Metadata to track the event
        'metadata[event_id]': event.id,
        'metadata[event_name]': event.name
      })
    });
    
    const data = await res.json();
    
    if (data.error) {
      console.error('Error creating payment link:', data.error);
      return null;
    }
    
    console.log(`Successfully created payment link: ${data.url}`);
    return data.url;
  } catch (error) {
    console.error('Error in getOrCreateStripePaymentLink:', error);
    return null;
  }
}
