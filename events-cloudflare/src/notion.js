// Utility functions to fetch events from Notion

/**
 * Fetch all tickets for a given event from Notion Products (Tickets) table
 */
export async function getTicketsForEvent(token, productsDatabaseId, eventId) {
  // Log the request details for debugging
  console.log('Fetching tickets for event:', { eventId, productsDatabaseId });
  
  const res = await fetch("https://api.notion.com/v1/databases/" + productsDatabaseId + "/query", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Notion-Version": "2022-06-28"
    },
    body: JSON.stringify({
      filter: {
        property: "Events", // Property name in the Products database that relates to Events
        relation: { contains: eventId }
      }
    })
  });
  const data = await res.json();
  
  // Log the API response for debugging
  console.log('Tickets API response:', { 
    status: res.status,
    results: data.results ? data.results.length : 0,
    error: data.object === 'error' ? data.message : null
  });
  
  // If there's an error, log it and return an empty array
  if (data.object === 'error') {
    console.error('Error fetching tickets:', data.message);
    return [];
  }
  
  // Map the results to ticket objects
  const tickets = (data.results || []).map(page => ({
    id: page.id,
    name: page.properties.Name?.title?.[0]?.plain_text || 'Untitled',
    price: parseFloat(page.properties.Price?.number) || 0,
    stripe_payment_link: page.properties['Stripe Payment Link']?.url || ''
  }));
  
  // Log the mapped tickets for debugging
  console.log(`Found ${tickets.length} tickets for event ${eventId}:`, 
    tickets.map(t => ({ name: t.name, price: t.price })));
  
  return tickets;
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
  return (data.results || []).map(page => {
    // Extract image URL based on property type
    let imageUrl = '';
    const imageProperty = page.properties['Image'];
    
    if (imageProperty) {
      // Handle different property types for images
      if (imageProperty.type === 'url' && imageProperty.url) {
        imageUrl = imageProperty.url;
      } else if (imageProperty.type === 'files' && imageProperty.files && imageProperty.files.length > 0) {
        // For files type, get the first file
        const file = imageProperty.files[0];
        if (file.type === 'external' && file.external?.url) {
          imageUrl = file.external.url;
        } else if (file.type === 'file' && file.file?.url) {
          imageUrl = file.file.url;
        }
      } else if (imageProperty.type === 'rich_text' && imageProperty.rich_text && imageProperty.rich_text.length > 0) {
        // For text fields containing URLs
        imageUrl = imageProperty.rich_text[0].plain_text || '';
      } else if (imageProperty.type === 'text' && imageProperty.text) {
        // For simple text fields
        imageUrl = imageProperty.text.content || '';
      }
    }
    
    return {
      id: page.id,
      name: page.properties.Name?.title?.[0]?.plain_text || 'Untitled',
      description: page.properties.Description?.rich_text?.[0]?.plain_text || '',
      date: page.properties.Date?.date?.start || '',
      image: imageUrl
    };
  });
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
  
  // Debug the image property structure
  console.log('Notion page properties:', JSON.stringify(page.properties, null, 2));
  
  // Extract image URL based on property type
  let imageUrl = '';
  const imageProperty = page.properties['Image'];
  
  if (imageProperty) {
    console.log('Image property type:', imageProperty.type);
    
    // Handle different property types for images
    if (imageProperty.type === 'url' && imageProperty.url) {
      imageUrl = imageProperty.url;
    } else if (imageProperty.type === 'files' && imageProperty.files && imageProperty.files.length > 0) {
      // For files type, get the first file
      const file = imageProperty.files[0];
      if (file.type === 'external' && file.external?.url) {
        imageUrl = file.external.url;
      } else if (file.type === 'file' && file.file?.url) {
        imageUrl = file.file.url;
      }
    } else if (imageProperty.type === 'rich_text' && imageProperty.rich_text && imageProperty.rich_text.length > 0) {
      // For text fields containing URLs
      imageUrl = imageProperty.rich_text[0].plain_text || '';
    } else if (imageProperty.type === 'text' && imageProperty.text) {
      // For simple text fields
      imageUrl = imageProperty.text.content || '';
    }
    
    console.log('Extracted image URL:', imageUrl);
  }
  
  return {
    id: page.id,
    name: page.properties.Name?.title?.[0]?.plain_text || 'Untitled',
    description: page.properties.Description?.rich_text?.[0]?.plain_text || '',
    date: page.properties.Date?.date?.start || '',
    ticket_link: page.properties['Event Ticket Link']?.url || '',
    price: page.properties['Price']?.number || 0,
    image: imageUrl
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
