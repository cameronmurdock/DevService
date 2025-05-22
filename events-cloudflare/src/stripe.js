// Utility for Stripe Payment Link creation and retrieval

/**
 * Create a Stripe Payment Link for an event
 * @param {string} stripeSecretKey - Stripe API key
 * @param {object} event - Event object with price and name
 * @returns {Promise<string>} - Payment link URL
 */
// Cache for payment links to avoid creating duplicates in a single session
const paymentLinkCache = new Map();

export async function getOrCreateStripePaymentLink(stripeSecretKey, event) {
  // Generate a cache key based on event ID and ticket name/price
  const cacheKey = `${event.id}_${event.productName}_${event.price}`;
  
  // Check if we already have a payment link for this event/ticket in the cache
  if (paymentLinkCache.has(cacheKey)) {
    const cachedLink = paymentLinkCache.get(cacheKey);
    console.log(`Using cached payment link for ${event.productName}: ${cachedLink}`);
    return cachedLink;
  }
  
  // If event already has a payment link, use it and cache it
  if (event.ticket_link) {
    console.log(`Using existing payment link for event ${event.name}: ${event.ticket_link}`);
    paymentLinkCache.set(cacheKey, event.ticket_link);
    return event.ticket_link;
  }
  
  // If the ticket already has a Stripe payment link, use it
  if (event.stripe_payment_link) {
    console.log(`Using existing Stripe payment link for ticket: ${event.stripe_payment_link}`);
    paymentLinkCache.set(cacheKey, event.stripe_payment_link);
    return event.stripe_payment_link;
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
    
    // Prepare the URL to the event page for the receipt and after-payment redirect
    const eventPageUrl = event.url || `https://oneapp.gratis/events/${event.id}`;
    
    // Get current date/time for the Revenue object name
    const now = new Date();
    const formattedDate = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const formattedTime = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: 'numeric', hour12: true });
    const revenueName = `${formattedDate} ${formattedTime}`;
    
    // Prepare the payment link parameters
    const paymentLinkParams = {
      // Use the price ID we created
      'line_items[0][price]': priceData.id,
      'line_items[0][quantity]': '1',
      'line_items[0][adjustable_quantity][enabled]': 'true',  // Allow multiple tickets
      'line_items[0][adjustable_quantity][minimum]': '1',     // Minimum 1 ticket
      'line_items[0][adjustable_quantity][maximum]': '10',    // Maximum 10 tickets
      
      // Payment link settings
      'after_completion[type]': 'redirect',
      'after_completion[redirect][url]': eventPageUrl,  // Redirect back to event page
      'billing_address_collection': 'auto',
      'customer_creation': 'always',  // Always create a customer to capture buyer info
      'submit_type': 'pay',
      
      // Enable email receipts with enhanced settings
      'invoice_creation[enabled]': 'true',
      'invoice_creation[invoice_data][description]': `Ticket purchase for ${event.name}`,
      'invoice_creation[invoice_data][footer]': `Thank you for your purchase! Visit ${eventPageUrl} for event details.`,
      
      // Metadata to track the event and revenue object
      'metadata[event_id]': event.id,
      'metadata[event_name]': event.name,
      'metadata[event_url]': eventPageUrl,
      'metadata[revenue_name]': revenueName,
      'metadata[revenue_object]': 'true',
      'metadata[attach_buyer]': 'true'
    };
    
    // Add any additional event details to the metadata if available
    if (event.date) {
      paymentLinkParams['metadata[event_date]'] = event.date;
    }
    
    if (event.location) {
      paymentLinkParams['metadata[event_location]'] = event.location;
    }
    
    const res = await fetch('https://api.stripe.com/v1/payment_links', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeSecretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams(paymentLinkParams)
    });
    
    const data = await res.json();
    
    if (data.error) {
      console.error('Error creating payment link:', JSON.stringify(data.error));
      console.error('Payment link parameters:', JSON.stringify(paymentLinkParams));
      return null;
    }
    
    console.log(`Successfully created payment link: ${data.url}`);
    
    // Cache the payment link to avoid creating duplicates
    paymentLinkCache.set(cacheKey, data.url);
    
    return data.url;
  } catch (error) {
    console.error('Error in getOrCreateStripePaymentLink:', error);
    return null;
  }
}
