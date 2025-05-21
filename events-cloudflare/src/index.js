// Cloudflare Worker: Serve event pages from Notion
import { getEventFromNotion, getAllEventsFromNotion, getTicketsForEvent, updateEventTicketLink } from './notion.js';
import { renderGuestbookSection, renderTicketsSection } from './templates.js';
import { getOrCreateStripePaymentLink } from './stripe.js';
import { addGuestToNotion } from './guestbook.js';

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
      const formData = await request.formData();
      const guestData = {
        name: formData.get('name'),
        email: formData.get('email'),
        phone: formData.get('phone'),
        comment: formData.get('comment'),
        contactPreference: formData.get('contactPreference'),
        eventId: formData.get('eventId'),
      };
      let notionResponse = null;
      try {
        notionResponse = await addGuestToNotion(env.NOTION_TOKEN, env.NOTION_PEOPLE_DATABASE_ID, guestData);
      } catch (err) {
        return new Response(renderDebugPage('Guestbook Notion Error', {
          guestData,
          error: err.message,
          env: { ...env, NOTION_TOKEN: env.NOTION_TOKEN ? '***' + env.NOTION_TOKEN.slice(-4) : undefined },
          notionResponse
        }), { status: 500, headers: { 'content-type': 'text/html' } });
      }
      if (notionResponse && notionResponse.object === 'error') {
        return new Response(renderDebugPage('Notion API Error (Guestbook)', {
          guestData,
          notionResponse,
          env: { ...env, NOTION_TOKEN: env.NOTION_TOKEN ? '***' + env.NOTION_TOKEN.slice(-4) : undefined }
        }), { status: 500, headers: { 'content-type': 'text/html' } });
      }
      // Must use absolute URL for Response.redirect in Cloudflare Workers
      const redirectUrl = url.searchParams.get('redirect') || 
        `${url.protocol}//${url.hostname}/events/${guestData.eventId}?guestbook=thanks`;
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
        let stripeResponse = null;
        try {
          if (!ticketLink) {
            // Get tickets/products for this event to find prices
            const tickets = await getTicketsForEvent(env.NOTION_TOKEN, env.NOTION_PRODUCTS_DATABASE_ID, eventId);
            debugInfo.tickets = tickets;
            
            if (!tickets || tickets.length === 0) {
              return new Response(renderDebugPage('No tickets found for event', { ...debugInfo, message: 'No tickets/products found for this event. Please add tickets with prices to your Products database and relate them to this event.' }), { status: 500, headers: { 'content-type': 'text/html' } });
            }
            
            // Use the first ticket's price if there are multiple
            const ticketPrice = tickets[0].price || 0;
            if (ticketPrice <= 0) {
              return new Response(renderDebugPage('No ticket price found', { ...debugInfo, message: 'Tickets exist but have no price. Please set a price on at least one ticket in your Products database.' }), { status: 500, headers: { 'content-type': 'text/html' } });
            }
            
            // Create a payment link using the ticket price
            const eventWithPrice = { ...event, price: ticketPrice, productName: tickets[0].name };
            ticketLink = await getOrCreateStripePaymentLink(env.STRIPE_SECRET_KEY, eventWithPrice);
            stripeResponse = ticketLink;
            await updateEventTicketLink(env.NOTION_TOKEN, event.id, ticketLink);
          }
        } catch (err) {
          return new Response(renderDebugPage('Stripe/Notion error', { ...debugInfo, error: err.message, stripeResponse }), { status: 500, headers: { 'content-type': 'text/html' } });
        }
        return new Response(renderEventPage({ ...event, ticket_link: ticketLink }), { headers: { 'content-type': 'text/html' } });
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
    <title>Events</title>
    <style>
      body {
        font-family: 'Montserrat', sans-serif;
        background: #f7f9fa;
        margin: 0;
        padding: 20px;
        color: #333;
      }
      main {
        max-width: 1200px;
        margin: 0 auto;
      }
      header {
        text-align: center;
        margin-bottom: 40px;
      }
      h1 {
        color: #2193b0;
        font-size: 2.5rem;
        margin-bottom: 10px;
      }
      .subtitle {
        color: #666;
        font-size: 1.2rem;
      }
      .events-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
        gap: 25px;
      }
      .event-card {
        background: #fff;
        border-radius: 16px;
        box-shadow: 0 4px 24px #0001;
        padding: 28px 24px 24px 24px;
        margin: 0 0 32px 0;
        transition: box-shadow .2s, transform .2s;
        position: relative;
        overflow: hidden;
      }
      .event-card-img {
        width: 100%;
        max-height: 220px;
        object-fit: cover;
        border-radius: 12px 12px 0 0;
        box-shadow: 0 2px 12px #0001;
        margin-bottom: 14px;
        display: block;
      }
      .event-card:hover {
        transform: translateY(-5px);
        box-shadow: 0 12px 20px rgba(0,0,0,0.12);
      }
      .event-card a {
        text-decoration: none;
        color: inherit;
        display: block;
      }
      .event-date {
        background: #2193b0;
        color: white;
        padding: 10px 15px;
        font-weight: 600;
        display: flex;
        justify-content: space-between;
      }
      .event-content {
        padding: 20px;
      }
      .event-title {
        color: #2193b0;
        font-size: 1.4rem;
        margin: 0 0 10px 0;
      }
      .event-description {
        color: #666;
        margin: 0;
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
        line-height: 1.5;
      }
      .event-view {
        display: inline-block;
        margin-top: 15px;
        background: #2193b0;
        color: white;
        padding: 8px 15px;
        border-radius: 5px;
        font-size: 0.9rem;
        font-weight: 600;
      }
    </style>
    <link href="https://fonts.googleapis.com/css?family=Montserrat:400,500,600,700&display=swap" rel="stylesheet">
  </head>
  <body>
    <main>
      <header>
        <h1>Upcoming Events</h1>
        <p class="subtitle">Browse and register for our upcoming events</p>
      </header>
      
      <div class="events-grid">
        ${events.map(ev => `
          <div class="event-card">
            <a href="/events/${ev.id}">
              ${ev.image ? `<img src="${ev.image}" alt="${ev.name}" class="event-card-img">` : ''}
              <div class="event-date">
                <span>${formatDate(ev.date) || 'Date TBA'}</span>
              </div>
              <div class="event-content">
                <h2 class="event-title">${ev.name}</h2>
                <p class="event-description">${ev.description || 'No description available'}</p>
                <span class="event-view">View Details</span>
              </div>
            </a>
          </div>
        `).join('')}
      </div>
    </main>
  </body>
  </html>`;
}

// Helper function to format dates nicely
function formatDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (isNaN(date)) return dateString;
  
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric', 
    year: 'numeric'
  });
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
      body { font-family: monospace; padding: 20px; line-height: 1.5; }
      h1 { color: #d44; }
      .card { border: 1px solid #ddd; padding: 15px; border-radius: 4px; margin-bottom: 20px; }
      pre { background: #f4f4f4; padding: 10px; overflow: auto; }
    </style>
  </head>
  <body>
    <h1>${title}</h1>
    
    <div class="card">
      <h2>Configuration</h2>
      <p><strong>Database ID:</strong> ${details.databaseId || 'Not provided'}</p>
      <p><strong>Token:</strong> ${details.token || 'Not provided'}</p>
    </div>
    
    ${details.error ? `<div class="card">
      <h2>Error</h2>
      <pre>${details.error}</pre>
    </div>` : ''}
    
    ${details.message ? `<div class="card">
      <h2>Message</h2>
      <p>${details.message}</p>
    </div>` : ''}
    
    <div class="card">
      <h2>Troubleshooting Steps</h2>
      <ol>
        <li>Make sure your Notion integration has access to the database. Go to your database in Notion, click Share, and add your integration.</li>
        <li>Verify the database ID is correct and includes hyphens.</li>
        <li>Check that your database has the expected properties: Name (title), Description (text), Date (date).</li>
        <li>Make sure you have at least one item in your Events database.</li>
      </ol>
    </div>
    
    <div class="card">
      <h2>Try Direct Page Access</h2>
      <p>If you know a page ID, try accessing it directly:<br>
      <a href="/events/page_id_here">/events/page_id_here</a></p>
      <p>Replace 'page_id_here' with an actual page ID from your Notion database.</p>
    </div>
  </body>
  </html>`;
}

function renderEventPage(event) {
  return `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${event.name}</title>
    <style>
      body { font-family: 'Montserrat', sans-serif; background: #f7f9fa; margin: 0; padding: 0; color: #222; }
      .container { max-width: 600px; margin: 40px auto; background: #fff; border-radius: 16px; box-shadow: 0 4px 24px #0001; padding: 32px; }
      h1 { font-size: 2.2rem; margin-bottom: 0.5em; }
      .event-date { color: #888; font-size: 1.1em; margin-bottom: 1.5em; }
      .desc { font-size: 1.2em; margin-bottom: 2em; }
      #tickets { margin-bottom: 2em; }
      .buy-btn { display: inline-block; background: linear-gradient(90deg, #4f8cff 0%, #38e8ff 100%); color: #fff; font-weight: bold; padding: 16px 32px; border-radius: 8px; text-decoration: none; font-size: 1.2em; transition: box-shadow .2s; box-shadow: 0 2px 8px #4f8cff33; }
      .buy-btn:hover { box-shadow: 0 4px 24px #38e8ff44; }
      #guestbook { background: #f3f7fa; border-radius: 12px; padding: 24px; }
      .event-img {
        display: block;
        max-width: 100%;
        max-height: 320px;
        margin: 0 auto 2em auto;
        border-radius: 16px;
        box-shadow: 0 4px 24px #0001;
        object-fit: cover;
      }
      @media (max-width: 700px) { .container { padding: 12px; } }
    </style>
  </head>
  <body>
    <main class="container">
      ${event.image ? `<img src="${event.image}" alt="${event.name}" class="event-img">` : ''}
      <h1>${event.name}</h1>
      <div class="event-date">${formatDate(event.date)}</div>
      <div class="desc">${event.description}</div>
      ${renderTicketsSection(event.ticket_link)}
      ${renderGuestbookSection(event.id)}
    </main>
  </body>
  </html>`;
}
