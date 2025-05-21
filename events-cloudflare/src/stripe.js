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
    
    // First, create a product for this event
    console.log('Creating Stripe product for the event ticket');
    const productRes = await fetch('https://api.stripe.com/v1/products', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeSecretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        'name': productName,
        'description': event.ticketDescription || `Admission to ${event.name}`,
        'metadata[event_id]': event.id
      })
    });
    
    const productData = await productRes.json();
    if (productData.error) {
      console.error('Error creating product:', productData.error);
      return null;
    }
    
    // Then create a price for the product
    console.log('Creating Stripe price for the product');
    const priceRes = await fetch('https://api.stripe.com/v1/prices', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeSecretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        'product': productData.id,
        'unit_amount': Math.round((event.price || 0) * 100),
        'currency': 'usd'
      })
    });
    
    const priceData = await priceRes.json();
    if (priceData.error) {
      console.error('Error creating price:', priceData.error);
      return null;
    }
    
    // Now create the payment link with the price ID
    console.log('Creating payment link with the price');
    const res = await fetch('https://api.stripe.com/v1/payment_links', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeSecretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        // Use the price ID we created
        'line_items[0][price]': priceData.id,
        'line_items[0][quantity]': '1',
        
        // Payment link settings
        'after_completion[type]': 'hosted_confirmation',
        'billing_address_collection': 'auto',
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
