// Utility functions to fetch events from Notion

/**
 * Fetch all tickets for a given event from Notion Products (Tickets) table
 */
export async function getTicketsForEvent(token, productsDatabaseId, eventId) {
  const res = await fetch("https://api.notion.com/v1/databases/" + productsDatabaseId + "/query", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Notion-Version": "2022-06-28"
    },
    body: JSON.stringify({
      filter: {
        property: "Events",
        relation: { contains: eventId }
      }
    })
  });
  const data = await res.json();
  return (data.results || []).map(page => ({
    id: page.id,
    name: page.properties.Name?.title?.[0]?.plain_text || 'Untitled',
    price: parseFloat(page.properties.Price?.number) || 0,
    stripe_payment_link: page.properties['Stripe Payment Link']?.url || ''
  }));
}

/**
 * Fetch all events from Notion database
 */
export async function getAllEventsFromNotion(token, databaseId) {
  const res = await fetch("https://api.notion.com/v1/databases/" + databaseId + "/query", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Notion-Version": "2022-06-28"
    },
    body: JSON.stringify({})
  });
  const data = await res.json();
  return (data.results || []).map(page => ({
    id: page.id,
    name: page.properties.Name?.title?.[0]?.plain_text || 'Untitled',
    description: page.properties.Description?.rich_text?.[0]?.plain_text || '',
    date: page.properties.Date?.date?.start || '',
    image: page.properties['Image']?.url || ''
  }));
}

/**
 * Fetch a single event by ID from Notion
 */
export async function getEventFromNotion(token, databaseId, eventId) {
  const res = await fetch("https://api.notion.com/v1/pages/" + eventId, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Notion-Version": "2022-06-28"
    }
  });
  const page = await res.json();
  if (!page || !page.id) return null;
  return {
    id: page.id,
    name: page.properties.Name?.title?.[0]?.plain_text || 'Untitled',
    description: page.properties.Description?.rich_text?.[0]?.plain_text || '',
    date: page.properties.Date?.date?.start || '',
    ticket_link: page.properties['Event Ticket Link']?.url || '',
    price: page.properties['Price']?.number || 0,
    image: page.properties['Image']?.url || ''
  };
}

// Update the Event Ticket Link property for an event in Notion
export async function updateEventTicketLink(token, eventId, link) {
  return fetch("https://api.notion.com/v1/pages/" + eventId, {
    method: "PATCH",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Notion-Version": "2022-06-28"
    },
    body: JSON.stringify({
      properties: {
        'Event Ticket Link': { url: link }
      }
    })
  });
}
