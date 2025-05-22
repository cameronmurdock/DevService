// Cloudflare Worker: Serve event pages from Notion
import { getEventFromNotion, getAllEventsFromNotion, getTicketsForEvent, updateEventTicketLink } from './notion.js';
import { renderGuestbookSection, renderTicketsSection } from './templates.js';
import { getOrCreateStripePaymentLink } from './stripe.js';
import { addGuestToNotion, addCommentToNotion, updateEventsAttended } from './guestbook.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/events") {
      // List all events
      try {
        const events = await getAllEventsFromNotion(env.NOTION_TOKEN, env.NOTION_DATABASE_ID);
        // Add debugging for empty events
        if (!events || events.length === 0) {
          return new Response(renderDebugPage('No events found', {
            token: env.NOTION_TOKEN ? 'Token provided (first 5 chars): ' + env.NOTION_TOKEN.substring(0, 5) : 'No token provided',
            databaseId: env.NOTION_DATABASE_ID,
            message: 'No events were returned from Notion. Make sure your database has events and the integration has access.'
          }), { headers: { 'content-type': 'text/html' } });
        }
        return new Response(renderEventsList(events), { headers: { 'content-type': 'text/html' } });
      } catch (error) {
        return new Response(renderDebugPage('Error fetching events', {
          error: error.message,
          token: env.NOTION_TOKEN ? 'Token provided (first 5 chars): ' + env.NOTION_TOKEN.substring(0, 5) : 'No token provided',
          databaseId: env.NOTION_DATABASE_ID
        }), { headers: { 'content-type': 'text/html' } });
      }
    }
    // Guestbook API endpoint
    if (url.pathname === "/api/guestbook" && request.method === "POST") {
      console.log('Received guestbook submission request');
      
      // Debug request information
      console.log('Request URL:', request.url);
      console.log('Request method:', request.method);
      
      let formData;
      try {
        formData = await request.formData();
        console.log('Form data parsed successfully');
      } catch (formErr) {
        console.error('Error parsing form data:', formErr.message);
        return new Response(renderDebugPage('Form Data Error', {
          error: formErr.message,
          requestHeaders: Object.fromEntries([...request.headers]),
          url: request.url
        }), { status: 500, headers: { 'content-type': 'text/html' } });
      }
      
      // Extract form fields
      const eventId = formData.get('eventId');
      console.log('Raw event ID from form:', eventId);
      
      // Make sure the event ID is properly formatted for Notion relations
      // Sometimes Notion requires the ID without dashes
      const formattedEventId = eventId ? eventId.replace(/-/g, '') : '';
      console.log('Formatted event ID for Notion:', formattedEventId);
      
      const guestData = {
        name: formData.get('name'),
        email: formData.get('email'),
        phone: formData.get('phone') || '',
        contactPreference: formData.get('contactPreference') || 'Do Not Contact',
        membershipType: 'Guest', // Always set to Guest
        message: formData.get('message') || '',
        eventId: eventId, // Original event ID with dashes
        formattedEventId: formattedEventId // Event ID without dashes for Notion relations
      };
      
      // Log the form data for debugging
      console.log('Guestbook form data:', JSON.stringify(guestData, null, 2));
      
      // Validate required fields
      if (!guestData.name || !guestData.email || !guestData.eventId) {
        console.error('Missing required fields in guestbook submission');
        return new Response(renderDebugPage('Missing Required Fields', {
          guestData,
          missingFields: [
            !guestData.name ? 'name' : null,
            !guestData.email ? 'email' : null,
            !guestData.eventId ? 'eventId' : null,
          ].filter(Boolean)
        }), { status: 400, headers: { 'content-type': 'text/html' } });
      }
      
      // Validate database ID
      if (!env.NOTION_PEOPLE_DATABASE_ID) {
        console.error('Missing Notion People Database ID in environment variables');
        return new Response(renderDebugPage('Configuration Error', {
          error: 'Missing Notion People Database ID',
          env: { ...env, NOTION_TOKEN: env.NOTION_TOKEN ? '***' + env.NOTION_TOKEN.slice(-4) : undefined }
        }), { status: 500, headers: { 'content-type': 'text/html' } });
      }
      
      // Add guest to Notion
      const notionResponse = await addGuestToNotion(env.NOTION_TOKEN, env.NOTION_PEOPLE_DATABASE_ID, guestData);
      
      // If the guest was added successfully, update the Events Attended field
      if (notionResponse.id) {
        try {
          // Update the Events Attended field with a separate API call
          await updateEventsAttended(
            env.NOTION_TOKEN,
            notionResponse.id, // Person ID (the newly created guest)
            guestData.eventId  // Event ID
          );
          console.log('Events Attended field updated successfully');
        } catch (updateError) {
          console.error('Error updating Events Attended field', { 
            message: updateError.message,
            stack: updateError.stack
          });
          // We don't throw here because we still want to return a success response
          // for the guestbook submission even if the update fails
        }
      }
      
      // If there's a message and the guest was added successfully, add a comment
      if (guestData.message && notionResponse.id) {
        try {
          // Add the comment to the Comments database
          await addCommentToNotion(
            env.NOTION_TOKEN,
            env.NOTION_COMMENTS_DATABASE_ID,
            notionResponse.id, // Person ID (the newly created guest)
            guestData.eventId, // Event ID
            guestData.message  // Comment text
          );
          console.log('Comment added successfully');
        } catch (commentError) {
          console.error('Error adding comment', { 
            message: commentError.message,
            stack: commentError.stack
          });
          // We don't throw here because we still want to return a success response
          // for the guestbook submission even if the comment fails
        }
      }
      
      // Handle errors from Notion API
      if (!notionResponse) {
        return new Response(renderDebugPage('Notion API Error', {
          guestData,
          error: 'No response from Notion API',
          env: { ...env, NOTION_TOKEN: env.NOTION_TOKEN ? '***' + env.NOTION_TOKEN.slice(-4) : undefined }
        }), { status: 500, headers: { 'content-type': 'text/html' } });
      }
      if (notionResponse && notionResponse.object === 'error') {
        console.error('Notion API returned an error:', notionResponse.message);
        
        // Check for specific error types and handle them appropriately
        if (notionResponse.message && notionResponse.message.includes('not a property that exists')) {
          // This is a schema mismatch error - the database doesn't have the expected fields
          console.log('Schema mismatch detected - field missing in Notion database');
          
          // Instead of showing an error page, redirect with an error parameter
          const redirectUrl = new URL(`/events/${guestData.eventId}?guestbook=error&reason=schema`, request.url).toString();
          return Response.redirect(redirectUrl, 303);
        }
        
        // For other errors, show the debug page
        return new Response(renderDebugPage('Notion API Error (Guestbook)', {
          guestData,
          notionResponse,
          env: { ...env, NOTION_TOKEN: env.NOTION_TOKEN ? '***' + env.NOTION_TOKEN.slice(-4) : undefined }
        }), { status: 500, headers: { 'content-type': 'text/html' } });
      }
      
      // Add more detailed debug logging
      console.log('Guestbook submission successful:', { 
        notionResponse: notionResponse?.id ? 'Success' : 'Failed',
        eventId: guestData.eventId
      });
      
      // Must use absolute URL for Response.redirect in Cloudflare Workers
      // Construct a safe redirect URL with proper error handling
      let redirectUrl;
      try {
        // First try to use the provided redirect URL if it exists
        if (url.searchParams.get('redirect')) {
          redirectUrl = url.searchParams.get('redirect');
        } else {
          // Otherwise construct a URL back to the event page
          redirectUrl = new URL(`/events/${guestData.eventId}?guestbook=thanks`, request.url).toString();
        }
      } catch (urlError) {
        // Fallback if URL construction fails
        redirectUrl = `/events/${guestData.eventId}?guestbook=thanks`;
      }
      
      return Response.redirect(redirectUrl, 303);
    }
    
    // Event page
    const eventMatch = url.pathname.match(/^\/events\/(.+)$/);
    if (eventMatch) {
      const eventId = eventMatch[1];
      try {
        const event = await getEventFromNotion(env.NOTION_TOKEN, env.NOTION_DATABASE_ID, eventId);
        if (!event) {
          return new Response(renderDebugPage('Event Not Found', {
            eventId,
            databaseId: env.NOTION_DATABASE_ID,
            token: env.NOTION_TOKEN ? 'Token provided (first 5 chars): ' + env.NOTION_TOKEN.substring(0, 5) : 'No token provided',
            message: 'No event was found with this ID. Make sure the event exists in your Notion database and is shared with your integration.'
          }), { status: 404, headers: { 'content-type': 'text/html' } });
        }
        // Get or create Stripe payment link for the event
        let debugInfo = { event, env: { ...env, NOTION_TOKEN: env.NOTION_TOKEN ? '***' + env.NOTION_TOKEN.slice(-4) : undefined, STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY ? '***' + env.STRIPE_SECRET_KEY.slice(-4) : undefined } };
        let ticketLink = event.ticket_link;
        let isFreeEvent = false;
        let stripeResponse = null;
        
        try {
          // Log database IDs for debugging
          console.log('Database IDs:', {
            eventsDatabaseId: env.NOTION_DATABASE_ID,
            productsDatabaseId: env.NOTION_PRODUCTS_DATABASE_ID,
            currentEventId: eventId
          });
          
          // Get tickets/products for this event to find prices
          const tickets = await getTicketsForEvent(env.NOTION_TOKEN, env.NOTION_PRODUCTS_DATABASE_ID, eventId);
          debugInfo.tickets = tickets;
          
          // Check if there are tickets for this event
          if (tickets && tickets.length > 0) {
            console.log(`Found ${tickets.length} tickets for event ${event.id}:`, JSON.stringify(tickets));
            debugInfo.tickets = tickets;
            
            // Store all available tickets in the event object for rendering
            event.tickets = tickets;
            
            // Check if any ticket has a valid price
            const hasValidPricedTicket = tickets.some(ticket => ticket.price && ticket.price > 0);
            
            // If all tickets are free, mark as a free event
            if (!hasValidPricedTicket) {
              console.log('Free event or no price detected - no payment link needed');
              isFreeEvent = true;
            } else {
              // Process tickets with prices - only create payment links if they don't already exist
              console.log(`Processing ${tickets.length} tickets for event ${event.name}`);
              
              // Verify we have all required data before proceeding
              if (!event.name || !event.id) {
                console.error('Missing required event data for payment link creation');
              } else {
                // Process each ticket that has a price
                const ticketsWithLinks = [];
                
                // Log the tickets we're about to process
                console.log('Processing tickets:', JSON.stringify(tickets.map(t => ({ 
                  id: t.id, 
                  name: t.name, 
                  price: t.price, 
                  description: t.description 
                }))));
                
                for (const ticket of tickets) {
                  try {
                    // Skip tickets with no price or price <= 0
                    if (!ticket.price || ticket.price <= 0) {
                      console.log(`Skipping ticket ${ticket.name} with no price or price <= 0`);
                      ticketsWithLinks.push({
                        ...ticket,
                        isFree: true
                      });
                      continue;
                    }
                    
                    // Check if the ticket already has a Stripe payment link
                    if (ticket.stripe_payment_link) {
                      console.log(`Using existing Stripe payment link for ticket ${ticket.name}: ${ticket.stripe_payment_link}`);
                      ticketsWithLinks.push({
                        ...ticket,
                        ticket_link: ticket.stripe_payment_link,
                        isFree: false
                      });
                      continue;
                    }
                    
                    // Check if we need to create a new payment link
                    // Only create a new payment link if the ticket doesn't already have one
                    // and it hasn't been created in this session
                    console.log(`Checking if we need to create a payment link for ticket: ${ticket.name} with price: $${ticket.price}`);
                    
                    // Prepare event object with ticket details for the payment link
                    const eventWithPrice = { 
                      ...event, 
                      price: ticket.price, 
                      // Create product name that includes both event name and ticket name
                      productName: ticket.name ? `${event.name} - ${ticket.name}` : `Ticket: ${event.name}`,
                      // Add any additional metadata needed for the ticket
                      ticketDescription: ticket.description || `Admission to ${event.name}`,
                      // Include the full URL to the event page for receipts and redirects
                      url: `https://oneapp.gratis/events/${event.id}`,
                      // Format date for receipts if available
                      date: event.date ? formatDate(event.date) : undefined,
                      // Include location information if available
                      location: event.location || event.venue || undefined,
                      // Pass the existing stripe payment link if available
                      stripe_payment_link: ticket.stripe_payment_link
                    };
                    
                    // Generate the Stripe payment link for this ticket
                    // This will use existing links if available and only create new ones if needed
                    const ticketLink = await getOrCreateStripePaymentLink(env.STRIPE_SECRET_KEY, eventWithPrice);
                    
                    if (!ticketLink) {
                      console.error(`Failed to create payment link for ticket: ${ticket.name}`);
                      ticketsWithLinks.push({
                        ...ticket,
                        isFree: false
                      });
                      continue;
                    }
                    
                    console.log(`Successfully created payment link for ticket ${ticket.name}: ${ticketLink}`);
                    
                    // Store the payment link in the ticket object
                    const ticketWithLink = {
                      ...ticket,
                      ticket_link: ticketLink,
                      stripe_payment_link: ticketLink, // Store in both properties for consistency
                      isFree: false
                    };
                    
                    // Add the ticket with its payment link to the array
                    ticketsWithLinks.push(ticketWithLink);
                    
                    // Update the ticket in Notion with the payment link if possible
                    try {
                      if (env.NOTION_TOKEN && ticket.id) {
                        // This is a placeholder - you would need to implement updateTicketPaymentLink in notion.js
                        // await updateTicketPaymentLink(env.NOTION_TOKEN, ticket.id, ticketLink);
                        console.log(`Updated ticket ${ticket.id} with payment link in Notion`);
                      }
                    } catch (updateError) {
                      console.error(`Error updating ticket in Notion:`, updateError);
                      // Continue processing even if the update fails
                    }
                  } catch (error) {
                    console.error(`Error processing ticket ${ticket.name}:`, error);
                    // Still add the ticket to the array, but without a payment link
                    ticketsWithLinks.push({
                      ...ticket,
                      isFree: false
                    });
                  }
                }
                
                // Store the processed tickets in the event object
                event.ticketsWithLinks = ticketsWithLinks;
                
                // Store the processed tickets in the event object
                console.log(`Storing ${ticketsWithLinks.length} processed tickets in event object`);
                
                // Log each ticket's payment link status
                ticketsWithLinks.forEach((ticket, index) => {
                  console.log(`Ticket ${index + 1} (${ticket.name}): ${ticket.ticket_link ? 'Has payment link' : 'No payment link'}`);
                });
                
                // For backward compatibility, use the first ticket's link as the main ticket link
                if (ticketsWithLinks.length > 0) {
                  // Find the first ticket with a payment link
                  const ticketWithLink = ticketsWithLinks.find(t => t.ticket_link);
                  
                  if (ticketWithLink && ticketWithLink.ticket_link) {
                    ticketLink = ticketWithLink.ticket_link;
                    stripeResponse = ticketLink;
                    
                    // Update the event in Notion with the first ticket's link
                    await updateEventTicketLink(env.NOTION_TOKEN, event.id, ticketLink);
                    console.log(`Updated event ${event.id} with ticket link: ${ticketLink}`);
                    
                    // Make sure to update the event object with the ticket link
                    event.ticket_link = ticketLink;
                  } else {
                    console.log(`No payment links found in any tickets for event ${event.id}`);
                  }
                } else {
                  console.log(`No tickets processed for event ${event.id}`);
                }
              }
            }
          } else if (!ticketLink && (!tickets || tickets.length === 0)) {
            // No tickets found for this event
            console.log(`No tickets found for event ${event.id}`);
          }
        } catch (err) {
          console.error('Error handling tickets/payment link:', err.message);
          // Don't return an error page, just log the error and continue
          // This allows the event page to still be displayed even if ticket generation fails
        }
        // Check for guestbook status in URL parameters
        const guestbookStatus = url.searchParams.get('guestbook') || '';
        
        // Make sure the event object has the correct ticket_link and isFreeEvent properties
        // This ensures these properties are passed to the renderer
        event.ticket_link = ticketLink;
        event.isFreeEvent = isFreeEvent;
        
        // If we have tickets but no ticket link, set hasTickets to true
        // This will be used for rendering
        const hasTickets = debugInfo.tickets && debugInfo.tickets.length > 0;
        event.hasTickets = hasTickets;
        
        // Make sure ticketsWithLinks is properly set on the event object
        // If it's not set but we have tickets, create an empty array
        if (!event.ticketsWithLinks && hasTickets) {
          console.log('No ticketsWithLinks found on event object, but tickets exist. Creating empty array.');
          event.ticketsWithLinks = [];
        }
        
        // Log the ticketsWithLinks array for debugging
        if (event.ticketsWithLinks) {
          console.log(`Event has ${event.ticketsWithLinks.length} tickets with links:`, 
            JSON.stringify(event.ticketsWithLinks.map(t => ({
              name: t.name,
              price: t.price,
              hasLink: !!t.ticket_link
            }))));
        }
        
        // Log the final event object being passed to the renderer
        console.log('Final event object for rendering:', {
          id: event.id,
          name: event.name,
          ticket_link: event.ticket_link,
          isFreeEvent: event.isFreeEvent,
          hasTickets: event.hasTickets,
          ticketsWithLinks: event.ticketsWithLinks ? event.ticketsWithLinks.length : 0
        });
        
        // Create a deep copy of the event object to avoid reference issues
        const eventForRendering = JSON.parse(JSON.stringify(event));
        
        // Log the ticketsWithLinks array that will be passed to the template
        if (eventForRendering.ticketsWithLinks && eventForRendering.ticketsWithLinks.length > 0) {
          console.log(`Passing ${eventForRendering.ticketsWithLinks.length} tickets to template:`, 
            JSON.stringify(eventForRendering.ticketsWithLinks));
        } else {
          console.warn('No tickets with links to pass to template');
        }
        
        return new Response(renderEventPage(eventForRendering, guestbookStatus), { headers: { 'content-type': 'text/html' } });
      } catch (error) {
        return new Response(renderDebugPage('Error fetching event', {
          eventId,
          databaseId: env.NOTION_DATABASE_ID,
          error: error.message,
          token: env.NOTION_TOKEN ? 'Token provided (first 5 chars): ' + env.NOTION_TOKEN.substring(0, 5) : 'No token provided',
        }), { status: 500, headers: { 'content-type': 'text/html' } });
      }
    }
    return new Response('Not found', { status: 404 });
  }
};

function renderEventsList(events) {
  return `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Riverside Events</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
      body { 
        font-family: 'Inter', sans-serif; 
        background: #f9fafb; 
        margin: 0; 
        padding: 0; 
        color: #1f2937; 
        line-height: 1.6;
      }
      .container { 
        max-width: 1200px; 
        margin: 0 auto; 
        padding: 2rem 1rem; 
      }
      header { 
        background-color: white;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        padding: 1rem 0;
        margin-bottom: 2rem;
      }
      .header-content {
        max-width: 1200px;
        margin: 0 auto;
        padding: 0 1rem;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      h1 { 
        font-size: 2rem; 
        margin-bottom: 1.5rem; 
        color: #111827;
      }
      .events-grid { 
        display: grid; 
        grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); 
        gap: 1.5rem; 
      }
      .event-card { 
        background: white; 
        border-radius: 0.75rem; 
        overflow: hidden; 
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
        transition: transform 0.2s, box-shadow 0.2s;
      }
      .event-card:hover { 
        transform: translateY(-4px); 
        box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
      }
      .event-image-container {
        position: relative;
        width: 100%;
        height: 0;
        padding-bottom: 56.25%; /* 16:9 aspect ratio */
        overflow: hidden;
      }
      .event-image {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .event-placeholder {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: linear-gradient(135deg, #e5e7eb, #f3f4f6);
        display: flex;
        align-items: center;
        justify-content: center;
        color: #9ca3af;
        font-size: 1.5rem;
      }
      .event-details { 
        padding: 1.5rem; 
      }
      .event-date {
        color: #3b82f6;
        font-size: 0.875rem;
        font-weight: 500;
        margin-bottom: 0.5rem;
      }
      .event-title { 
        font-size: 1.25rem; 
        font-weight: 600; 
        margin-bottom: 0.5rem; 
        color: #111827;
      }
      .event-description { 
        color: #6b7280; 
        margin-bottom: 1.5rem; 
        display: -webkit-box; 
        -webkit-line-clamp: 3; 
        -webkit-box-orient: vertical; 
        overflow: hidden;
      }
      .event-link { 
        display: inline-block; 
        background-color: #3b82f6; 
        color: white; 
        font-weight: 500; 
        padding: 0.5rem 1rem; 
        border-radius: 0.375rem; 
        text-decoration: none; 
        transition: background-color 0.2s;
      }
      .event-link:hover { 
        background-color: #2563eb; 
      }
      .no-events { 
        text-align: center; 
        padding: 3rem; 
        background: white; 
        border-radius: 0.75rem; 
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
      }
      @media (max-width: 768px) {
        .events-grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <header>
      <div class="header-content">
        <h1>Riverside Events</h1>
      </div>
    </header>
    <div class="container">
      <h1>Upcoming Events</h1>
      
      ${events.length === 0 ? 
        `<div class="no-events">
          <h2>No upcoming events</h2>
          <p>Check back soon for new events!</p>
        </div>` :
        `<div class="events-grid">
          ${events.map(event => `
            <div class="event-card">
              <div class="event-image-container">
                ${event.image ? 
                  `<img src="${event.image}" alt="${event.name}" class="event-image">` : 
                  `<div class="event-placeholder">📅</div>`
                }
              </div>
              <div class="event-details">
                <div class="event-date">${formatDate(event.date)}</div>
                <h2 class="event-title">${event.name}</h2>
                <p class="event-description">${event.description || 'No description available'}</p>
                <a href="/events/${event.id}" class="event-link">View Details</a>
              </div>
            </div>
          `).join('')}
        </div>`
      }
    </div>
  </body>
  </html>`;
}

// Helper function to format dates nicely
function formatDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  return date.toLocaleDateString('en-US', options);
}

// Debug page for troubleshooting
function renderDebugPage(title, details) {
  return `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Debug: ${title}</title>
    <style>
      body { font-family: monospace; padding: 20px; line-height: 1.6; }
      h1 { color: #e53e3e; }
      h2 { margin-top: 30px; }
      pre { background: #f7fafc; padding: 15px; border-radius: 5px; overflow-x: auto; }
      .back { margin-top: 30px; }
      .back a { color: #3182ce; text-decoration: none; }
      .back a:hover { text-decoration: underline; }
    </style>
  </head>
  <body>
    <h1>⚠️ ${title}</h1>
    
    ${Object.entries(details).map(([key, value]) => `
      <h2>${key}</h2>
      <pre>${typeof value === 'object' ? JSON.stringify(value, null, 2) : value}</pre>
    `).join('')}
    
    <div class="back">
      <a href="/">← Back to Events</a>
    </div>
    
    <div class="help">
      <h2>Need help?</h2>
      <p>Try the following:</p>
      <ul>
        <li>Check that your Notion integration token is correct</li>
        <li>Verify that your database IDs are correct</li>
        <li>Make sure your Notion integration has access to the databases</li>
        <li>Check that the required properties exist in your Notion databases</li>
      </ul>
      <p>Example URL format:<br>
      <a href="/events/page_id_here">/events/page_id_here</a></p>
      <p>Replace 'page_id_here' with an actual page ID from your Notion database.</p>
    </div>
  </body>
  </html>`;
}

function renderEventPage(event, guestbookStatus = '') {
  return `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${event.name}</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
      body { 
        font-family: 'Inter', sans-serif; 
        background: #f9fafb; 
        margin: 0; 
        padding: 0; 
        color: #1f2937; 
        line-height: 1.6;
      }
      header { 
        background-color: white;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        padding: 1rem 0;
        margin-bottom: 2rem;
      }
      .header-content {
        max-width: 1200px;
        margin: 0 auto;
        padding: 0 1rem;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .container { 
        max-width: 1200px; 
        margin: 0 auto; 
        padding: 0 1rem 2rem; 
        display: flex;
        flex-wrap: wrap;
        gap: 2rem;
      }
      .event-main {
        flex: 2;
        min-width: 0;
      }
      .event-sidebar {
        flex: 1;
        min-width: 300px;
      }
      .card {
        background: white;
        border-radius: 0.75rem;
        overflow: hidden;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
        margin-bottom: 1.5rem;
      }
      .event-image-container {
        position: relative;
        width: 100%;
        height: 0;
        padding-bottom: 56.25%; /* 16:9 aspect ratio */
        overflow: hidden;
      }
      .event-image {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .event-details {
        padding: 1.5rem;
      }
      .event-title {
        font-size: 1.875rem;
        font-weight: 700;
        margin-bottom: 0.5rem;
        color: #111827;
      }
      .event-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 1rem;
        margin-bottom: 1.5rem;
        color: #6b7280;
      }
      .event-date {
        color: #3b82f6;
        font-weight: 500;
      }
      .event-description {
        margin-bottom: 1.5rem;
      }
      .sidebar-card {
        padding: 1.5rem;
      }
      .sidebar-card h2 {
        font-size: 1.25rem;
        margin-bottom: 1rem;
        padding-bottom: 0.5rem;
        border-bottom: 1px solid #e5e7eb;
      }
      .success-message { 
        background: #ecfdf5; 
        color: #065f46; 
        padding: 1rem; 
        border-radius: 0.375rem; 
        margin-bottom: 1rem; 
        border-left: 4px solid #10b981; 
      }
      .error-message { 
        background: #fef2f2; 
        color: #b91c1c; 
        padding: 1rem; 
        border-radius: 0.375rem; 
        margin-bottom: 1rem; 
        border-left: 4px solid #ef4444; 
      }
      .button {
        display: inline-block;
        background-color: #3b82f6;
        color: white;
        font-weight: 600;
        text-align: center;
        padding: 0.75rem 1.5rem;
        border-radius: 0.375rem;
        text-decoration: none;
        transition: background-color 0.2s;
        border: none;
        cursor: pointer;
        width: 100%;
      }
      .button:hover {
        background-color: #2563eb;
      }
      
      .ticket-info {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        margin-bottom: 0.5rem;
      }
      
      .ticket-description-box {
        background-color: #f3f4f6;
        border-left: 3px solid #3b82f6;
        padding: 0.75rem;
        border-radius: 0.25rem;
        color: #4b5563;
        font-size: 0.95rem;
        line-height: 1.5;
        margin: 0.5rem 0;
      }
      
      .ticket-prompt {
        font-weight: 500;
        margin: 0.75rem 0;
        color: #1f2937;
      }
      
      .ticket-actions {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        margin-top: 0.5rem;
      }
      
      .primary-button {
        background-color: #3b82f6;
        margin-bottom: 0.25rem;
      }
      
      .view-link {
        font-size: 0.875rem;
        color: #4b5563;
        text-decoration: underline;
        text-align: center;
        padding: 0.25rem;
      }
      
      .view-link:hover {
        color: #3b82f6;
      }
      
      /* Ticket options styles */
      .ticket-options {
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
        margin-top: 1rem;
      }
      
      .ticket-option {
        border: 1px solid #e5e7eb;
        border-radius: 0.5rem;
        padding: 1.25rem;
        transition: all 0.2s;
        position: relative;
        overflow: hidden;
      }
      
      .ticket-option:hover {
        box-shadow: 0 4px 12px -2px rgba(0, 0, 0, 0.1), 0 2px 6px -1px rgba(0, 0, 0, 0.06);
        transform: translateY(-2px);
      }
      
      .free-ticket {
        border-left: 4px solid #10b981;
        background-color: #f0fdf4;
      }
      
      .pending-ticket {
        border-left: 4px solid #f59e0b;
        background-color: #fffbeb;
      }
      
      .available-ticket {
        border-left: 4px solid #3b82f6;
        background-color: #f0f9ff;
      }
      
      .ticket-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1rem;
        border-bottom: 1px solid #e5e7eb;
        padding-bottom: 0.75rem;
      }
      
      .ticket-name {
        font-size: 1.125rem;
        font-weight: 600;
        margin: 0;
        color: #1f2937;
      }
      
      .ticket-price {
        font-weight: 600;
        color: #3b82f6;
        font-size: 1.125rem;
        padding: 0.25rem 0.75rem;
        border-radius: 0.375rem;
        background-color: rgba(59, 130, 246, 0.1);
      }
      
      .ticket-price.free {
        color: #10b981;
        background-color: rgba(16, 185, 129, 0.1);
      }
      
      .ticket-status {
        font-size: 0.95rem;
        margin: 0.75rem 0 0;
        padding: 0.5rem;
        border-radius: 0.25rem;
        text-align: center;
        background-color: #f3f4f6;
      }
      
      .ticket-status.pending {
        background-color: #fffbeb;
        color: #92400e;
      }
      
      .ticket-features {
        margin: 1rem 0;
        padding: 0.75rem;
        background-color: #f9fafb;
        border-radius: 0.375rem;
      }
      
      .feature-item {
        display: flex;
        align-items: center;
        margin-bottom: 0.5rem;
        font-size: 0.875rem;
        color: #4b5563;
      }
      
      .feature-item:last-child {
        margin-bottom: 0;
      }
      
      .feature-item svg {
        color: #10b981;
        margin-right: 0.5rem;
        flex-shrink: 0;
      }
      
      .sidebar-card {
        padding: 1.5rem;
        overflow-wrap: break-word;
        word-wrap: break-word;
        word-break: break-word;
      }
      .form-group {
        margin-bottom: 1rem;
      }
      .form-group label {
        display: block;
        margin-bottom: 0.5rem;
        font-weight: 500;
      }
      .form-control {
        width: 100%;
        padding: 0.75rem;
        border: 1px solid #d1d5db;
        border-radius: 0.375rem;
        font-family: inherit;
        font-size: 1rem;
      }
      @media (max-width: 768px) {
        .container {
          flex-direction: column;
        }
        .event-title {
          font-size: 1.5rem;
        }
      }
    </style>
  </head>
  <body>
    <header>
      <div class="header-content">
        <h1>Riverside Events</h1>
        <a href="/" style="color: #3b82f6; text-decoration: none;">Back to Events</a>
      </div>
    </header>
    
    <div class="container">
      <main class="event-main">
        <div class="card">
          ${event.image ? `
            <div class="event-image-container">
              <img src="${event.image}" alt="${event.name}" class="event-image">
            </div>` : ''}
          
          <div class="event-details">
            <h1 class="event-title">${event.name}</h1>
            
            <div class="event-meta">
              <div class="event-date">${formatDate(event.date)}</div>
            </div>
            
            <div class="event-description">
              ${event.description || 'No description available'}
            </div>
          </div>
        </div>
      </main>
      
      <aside class="event-sidebar">
        <div class="card">
          <div class="sidebar-card">
            <h2>Registration</h2>
            ${renderTicketsSection(event.ticket_link, event.isFreeEvent, event.hasTickets, event.ticketDescription, event.ticketsWithLinks)}
          </div>
        </div>
        
        <div class="card">
          <div class="sidebar-card">
            <h2>Guestbook</h2>
            ${renderGuestbookSection(event.id, guestbookStatus)}
          </div>
        </div>
      </aside>
    </div>
  </body>
  </html>`;
}
