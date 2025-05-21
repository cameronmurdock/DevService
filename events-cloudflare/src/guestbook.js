// Guestbook and Comments Notion API integration

/**
 * Add a guest to the People table in Notion
 * @param {string} token
 * @param {string} peopleDatabaseId
 * @param {object} guestData
 * @returns {Promise<object>} Notion API response
 */
export async function addGuestToNotion(token, peopleDatabaseId, guestData) {
  // Validate inputs
  if (!token) {
    console.error('Missing Notion token');
    throw new Error('Missing Notion token');
  }
  
  if (!peopleDatabaseId) {
    console.error('Missing people database ID');
    throw new Error('Missing people database ID');
  }
  
  if (!guestData.name || !guestData.email || !guestData.eventId) {
    console.error('Missing required guest data fields', { 
      hasName: !!guestData.name, 
      hasEmail: !!guestData.email, 
      hasEventId: !!guestData.eventId 
    });
    throw new Error('Missing required guest data fields');
  }
  
  // Log the request we're about to make with full details
  console.log('Preparing Notion API request', {
    endpoint: 'https://api.notion.com/v1/pages',
    databaseId: peopleDatabaseId,
    eventId: guestData.eventId,
    eventIdType: typeof guestData.eventId
  });
  
  // Log the full event ID for debugging
  console.log('Event ID for relation:', guestData.eventId);
  
  // Prepare the request body
  const requestBody = {
    parent: { database_id: peopleDatabaseId },
    properties: {
      Name: {
        title: [{ text: { content: guestData.name } }]
      },
      Email: {
        email: guestData.email
      },
      'Contact Preference': {
        select: { name: guestData.contactPreference || 'Do Not Contact' }
      },
      // We'll update the Events Attended field in a separate API call
      // This approach is more reliable for relation fields
      // Add Guestbook Date with current date
      'Guestbook Date': {
        date: { start: new Date().toISOString() }
      },
      // Add default Membership Type as multi_select
      'Membership Type': {
        multi_select: [{ name: guestData.membershipType || 'Guest' }]
      }
    }
  };
  
  // Add optional fields if present
  if (guestData.phone) {
    requestBody.properties.Phone = { phone_number: guestData.phone };
  }
  
  // If there's a message, we'll add it to the Comments database in a separate call
  // We're not adding it here since it belongs in a separate database
  
  try {
    // Make the API request
    const res = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify(requestBody)
    });
    
    // Check for HTTP errors
    if (!res.ok) {
      console.error('Notion API HTTP error', { 
        status: res.status, 
        statusText: res.statusText 
      });
    }
    
    // Parse the response
    const data = await res.json();
    
    // Log response summary
    console.log('Notion API response', { 
      success: data.object !== 'error',
      id: data.id || 'none',
      error: data.object === 'error' ? data.message : null
    });
    
    return data;
  } catch (error) {
    console.error('Error in Notion API request', { 
      message: error.message,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Update the Events Attended field for a person in the People database
 * @param {string} token - Notion API token
 * @param {string} personId - ID of the person in the People database
 * @param {string} eventId - ID of the event to add to Events Attended
 * @returns {Promise<object>} Notion API response
 */
export async function updateEventsAttended(token, personId, eventId) {
  // Validate inputs
  if (!token) {
    console.error('Missing Notion token');
    throw new Error('Missing Notion token');
  }
  
  if (!personId) {
    console.error('Missing person ID');
    throw new Error('Missing person ID');
  }
  
  if (!eventId) {
    console.error('Missing event ID');
    throw new Error('Missing event ID');
  }
  
  // Log the request we're about to make
  console.log('Preparing Notion API request to update Events Attended', {
    endpoint: `https://api.notion.com/v1/pages/${personId}`,
    personId,
    eventId,
    eventIdType: typeof eventId
  });
  
  // Try different formats of the event ID
  const formattedEventId = eventId.replace(/-/g, '');
  console.log('Formatted event ID:', formattedEventId);
  
  // Prepare the request body - only updating the Events Attended field
  const requestBody = {
    properties: {
      'Events Attended': {
        relation: [{ id: eventId }]
      }
    }
  };
  
  // Log the full request body for debugging
  console.log('Full Notion API request body for Events Attended update:', JSON.stringify(requestBody, null, 2));
  
  try {
    // Make the API request
    const res = await fetch(`https://api.notion.com/v1/pages/${personId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify(requestBody)
    });
    
    // Check for HTTP errors
    if (!res.ok) {
      console.error('Notion API HTTP error for Events Attended update', { 
        status: res.status, 
        statusText: res.statusText 
      });
    }
    
    // Parse the response
    const data = await res.json();
    
    // Log response summary
    console.log('Notion API response for Events Attended update', { 
      success: data.object !== 'error',
      id: data.id || 'none',
      error: data.object === 'error' ? data.message : null
    });
    
    return data;
  } catch (error) {
    console.error('Error in Notion API request for Events Attended update', { 
      message: error.message,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Add a comment to the Comments database in Notion
 * @param {string} token - Notion API token
 * @param {string} commentsDatabaseId - Comments database ID
 * @param {string} personId - ID of the person in the People database
 * @param {string} eventId - ID of the event in the Events database
 * @param {string} commentText - The comment text
 * @returns {Promise<object>} Notion API response
 */
export async function addCommentToNotion(token, commentsDatabaseId, personId, eventId, commentText) {
  // Validate inputs
  if (!token) {
    console.error('Missing Notion token');
    throw new Error('Missing Notion token');
  }
  
  if (!commentsDatabaseId) {
    console.error('Missing comments database ID');
    throw new Error('Missing comments database ID');
  }
  
  if (!personId || !eventId || !commentText) {
    console.error('Missing required comment data fields', { 
      hasPersonId: !!personId, 
      hasEventId: !!eventId, 
      hasCommentText: !!commentText 
    });
    throw new Error('Missing required comment data fields');
  }
  
  // Log the request we're about to make
  console.log('Preparing Notion API request for comment', {
    endpoint: 'https://api.notion.com/v1/pages',
    databaseId: commentsDatabaseId,
    personId,
    eventId
  });
  
  // Prepare the request body
  const requestBody = {
    parent: { database_id: commentsDatabaseId },
    properties: {
      Name: {
        title: [{ text: { content: commentText.substring(0, 100) } }]
      },
      People: {
        relation: [{ id: personId }]
      },
      'Event Comments': {
        relation: [{ id: eventId }]
      }
    }
  };
  
  try {
    // Make the API request
    const res = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify(requestBody)
    });
    
    // Check for HTTP errors
    if (!res.ok) {
      console.error('Notion API HTTP error for comment', { 
        status: res.status, 
        statusText: res.statusText 
      });
    }
    
    // Parse the response
    const data = await res.json();
    
    // Log response summary
    console.log('Notion API response for comment', { 
      success: data.object !== 'error',
      id: data.id || 'none',
      error: data.object === 'error' ? data.message : null
    });
    
    return data;
  } catch (error) {
    console.error('Error in Notion API request for comment', { 
      message: error.message,
      stack: error.stack
    });
    throw error;
  }
}
