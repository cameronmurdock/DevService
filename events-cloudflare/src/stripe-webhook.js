// Stripe webhook handler for processing payment events
import { Client } from '@notionhq/client';

/**
 * Process a Stripe webhook event
 * @param {Object} event - The Stripe event object
 * @param {Object} env - Environment variables
 * @returns {Promise<Object>} - Processing result
 */
export async function handleStripeWebhook(event, env) {
  console.log(`Processing Stripe webhook event: ${event.type}`);
  
  // Only process checkout.session.completed events
  if (event.type !== 'checkout.session.completed') {
    return { success: true, message: `Event type ${event.type} ignored` };
  }
  
  const session = event.data.object;
  
  // Check if we should create a Revenue object based on metadata
  if (!session.metadata || session.metadata.revenue_object !== 'true') {
    return { success: true, message: 'No Revenue object requested in metadata' };
  }
  
  try {
    // Initialize Notion client
    const notion = new Client({ auth: env.NOTION_TOKEN });
    
    // Get customer information for the buyer
    const customer = await getStripeCustomer(session.customer, env.STRIPE_SECRET_KEY);
    
    // Create a Revenue object in Notion using the database ID from environment variables
    const revenuePage = await createRevenueObject(
      notion, 
      env.NOTION_REVENUE_DATABASE_ID,
      session,
      customer
    );
    
    return { 
      success: true, 
      message: 'Revenue object created successfully', 
      revenueId: revenuePage.id 
    };
  } catch (error) {
    console.error('Error processing webhook:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get customer information from Stripe
 * @param {string} customerId - Stripe customer ID
 * @param {string} stripeSecretKey - Stripe API key
 * @returns {Promise<Object>} - Customer data
 */
async function getStripeCustomer(customerId, stripeSecretKey) {
  if (!customerId) {
    return null;
  }
  
  try {
    const response = await fetch(`https://api.stripe.com/v1/customers/${customerId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${stripeSecretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });
    
    const data = await response.json();
    
    if (data.error) {
      console.error('Error fetching customer:', data.error);
      return null;
    }
    
    return data;
  } catch (error) {
    console.error('Error fetching customer:', error);
    return null;
  }
}

/**
 * Create a Revenue object in Notion
 * @param {Object} notion - Notion client
 * @param {string} databaseId - Notion Revenue database ID
 * @param {Object} session - Stripe checkout session
 * @param {Object} customer - Stripe customer data
 * @returns {Promise<Object>} - Created Notion page
 */
async function createRevenueObject(notion, databaseId, session, customer) {
  // Use the revenue name from metadata or generate a timestamp
  const revenueName = session.metadata.revenue_name || new Date().toLocaleString();
  
  // Prepare properties for the Revenue object
  const properties = {
    // Name property (title)
    "Name": {
      "title": [
        {
          "text": {
            "content": revenueName
          }
        }
      ]
    },
    // Product property (relation to Products database)
    "product": {
      "relation": [
        {
          "id": session.metadata.event_id || ""
        }
      ]
    },
    // Income property (number)
    "Income": {
      "number": session.amount_total / 100 // Convert from cents to dollars
    },
    // Created time property (date)
    "Created time": {
      "date": {
        "start": new Date().toISOString()
      }
    }
  };
  
  // Add buyer information if available and attach_buyer is true
  if (customer && session.metadata.attach_buyer === 'true') {
    // Add buyer email
    if (customer.email) {
      properties["Buyer"] = {
        "rich_text": [
          {
            "text": {
              "content": customer.email
            }
          }
        ]
      };
    }
    
    // Add buyer name if available
    if (customer.name) {
      properties["Buyer Name"] = {
        "rich_text": [
          {
            "text": {
              "content": customer.name
            }
          }
        ]
      };
    }
  }
  
  // Create the Revenue object in Notion
  const response = await notion.pages.create({
    parent: { database_id: databaseId },
    properties: properties
  });
  
  console.log(`Created Revenue object: ${response.id}`);
  return response;
}
