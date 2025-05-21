// Guestbook Notion API integration

/**
 * Add a guest to the People table in Notion
 * @param {string} token
 * @param {string} peopleDatabaseId
 * @param {object} guestData
 * @returns {Promise<object>} Notion API response
 */
export async function addGuestToNotion(token, peopleDatabaseId, guestData) {
  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28'
    },
    body: JSON.stringify({
      parent: { database_id: peopleDatabaseId },
      properties: {
        Name: {
          title: [{ text: { content: guestData.name } }]
        },
        Email: {
          email: guestData.email
        },
        'Contact Preference': {
          select: { name: guestData.contactPreference }
        },
        'Events Attended': {
          relation: [{ id: guestData.eventId }]
        },
        ...(guestData.phone ? { Phone: { phone_number: guestData.phone } } : {}),
        ...(guestData.comment ? { Comment: { rich_text: [{ text: { content: guestData.comment } }] } } : {})
      }
    })
  });
  return res.json();
}
