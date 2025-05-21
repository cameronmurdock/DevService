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
          
          // Check if we already have a ticket link
          if (!ticketLink && tickets && tickets.length > 0) {
            // Use the first ticket's price if there are multiple
            const ticketPrice = tickets[0].price || 0;
            
            // Check if this is a free event (price is 0)
            if (ticketPrice <= 0) {
              console.log('Free event detected - no payment link needed');
              isFreeEvent = true;
            } else {
              // Create a payment link using the ticket price and ticket details
              console.log(`Creating payment link for event ${event.name} with price $${ticketPrice}`);
              
              // Prepare event object with all necessary details for the payment link
              const eventWithPrice = { 
                ...event, 
                price: ticketPrice, 
                productName: tickets[0].name || `Ticket: ${event.name}`,
                // Add any additional metadata needed for the ticket
                ticketDescription: tickets[0].description || `Admission to ${event.name}`
              };
              
              // Generate the Stripe payment link
              ticketLink = await getOrCreateStripePaymentLink(env.STRIPE_SECRET_KEY, eventWithPrice);
              stripeResponse = ticketLink;
              
              // Update the event in Notion with the new ticket link
              if (ticketLink) {
                await updateEventTicketLink(env.NOTION_TOKEN, event.id, ticketLink);
                console.log(`Updated event ${event.id} with ticket link: ${ticketLink}`);
                
                // Make sure to update the event object with the ticket link
                event.ticket_link = ticketLink;
              } else {
                console.error(`Failed to create payment link for event ${event.id}`);
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
        
        // Log the final event object being passed to the renderer
        console.log('Final event object for rendering:', {
          id: event.id,
          name: event.name,
          ticket_link: event.ticket_link,
          isFreeEvent: event.isFreeEvent,
          hasTickets: event.hasTickets
        });
        
        return new Response(renderEventPage(event, guestbookStatus), { headers: { 'content-type': 'text/html' } });
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
            ${renderTicketsSection(event.ticket_link, event.isFreeEvent, event.hasTickets)}
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
