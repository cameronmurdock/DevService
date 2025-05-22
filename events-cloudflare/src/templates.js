// HTML templates for event page, tickets, and guestbook

export function renderGuestbookSection(eventId, status = '') {
  // Handle different status messages
  let statusMessage = '';
  if (status === 'thanks') {
    statusMessage = `<div class="success-message">Thanks for signing our guestbook!</div>`;
  } else if (status === 'error') {
    statusMessage = `<div class="error-message">Sorry, we couldn't process your submission. Please try again later.</div>`;
  }
  
  return `
    ${statusMessage}
    <p>Sign our guestbook to receive updates about this and future events.</p>
    <form method="POST" action="/api/guestbook" class="registration-form">
      <input type="hidden" name="eventId" value="${eventId}">
      
      <div class="form-group">
        <label for="name">Name</label>
        <input type="text" id="name" name="name" class="form-control" required>
      </div>
      
      <div class="form-group">
        <label for="email">Email</label>
        <input type="email" id="email" name="email" class="form-control" required>
      </div>
      
      <div class="form-group">
        <label for="phone">Phone (Optional)</label>
        <input type="tel" id="phone" name="phone" pattern="[0-9+\- ]*" class="form-control" placeholder="Your phone number">
      </div>
      
      <div class="form-group">
        <label for="contactPreference">Contact Preference</label>
        <select id="contactPreference" name="contactPreference" class="form-control">
          <option value="Share All Riverside Events With Me">Share All Riverside Events With Me</option>
          <option value="Share Similar Events With Me">Share Similar Events With Me</option>
          <option value="Do Not Contact">Do Not Contact</option>
        </select>
      </div>
      
      <div class="form-group">
        <label for="message">Message</label>
        <textarea id="message" name="message" class="form-control" rows="3" placeholder="Your message or comment"></textarea>
      </div>
      
      <!-- Membership Type is set automatically to Guest -->
      
      <button type="submit" class="button">Sign Guestbook</button>
    </form>
  `;
}

export function renderTicketsSection(ticketLink, isFreeEvent = false, hasTickets = false, ticketDescription = '', ticketsWithLinks = []) {
  // Log the inputs to the function for debugging
  console.log('renderTicketsSection called with:', { 
    ticketLink, 
    isFreeEvent, 
    hasTickets, 
    ticketDescription,
    ticketsCount: ticketsWithLinks ? ticketsWithLinks.length : 0 
  });
  
  // If it's a free event, show the free event message
  if (isFreeEvent) {
    console.log('Rendering free event ticket section');
    return `
      <p>This is a free event. No registration required.</p>
    `;
  }
  
  // If there are multiple tickets with links, display them as options
  if (ticketsWithLinks && ticketsWithLinks.length > 0) {
    console.log('Rendering multiple ticket options:', ticketsWithLinks.length);
    console.log('Ticket details:', JSON.stringify(ticketsWithLinks.map(t => ({
      name: t.name,
      price: t.price,
      isFree: t.isFree,
      hasLink: !!t.ticket_link,
      description: t.description ? t.description.substring(0, 30) + '...' : 'No description'
    }))));
    
    // Generate HTML for each ticket option
    const ticketOptionsHtml = ticketsWithLinks.map(ticket => {
      console.log(`Processing ticket for UI: ${ticket.name}, price: ${ticket.price}, hasLink: ${!!ticket.ticket_link}`);
      
      // Handle free tickets
      if (ticket.isFree) {
        return `
          <div class="ticket-option free-ticket">
            <div class="ticket-header">
              <h3 class="ticket-name">${ticket.name || 'General Admission'}</h3>
              <span class="ticket-price free">Free</span>
            </div>
            ${ticket.description ? `<div class="ticket-description-box">${ticket.description}</div>` : ''}
            <p class="ticket-status">This ticket is free. No registration required.</p>
          </div>
        `;
      }
      
      // Handle tickets without payment links
      if (!ticket.ticket_link) {
        return `
          <div class="ticket-option pending-ticket">
            <div class="ticket-header">
              <h3 class="ticket-name">${ticket.name || 'General Admission'}</h3>
              <span class="ticket-price">$${parseFloat(ticket.price).toFixed(2)}</span>
            </div>
            ${ticket.description ? `<div class="ticket-description-box">${ticket.description}</div>` : ''}
            <p class="ticket-status pending">Tickets for this option are being prepared. Please check back soon.</p>
          </div>
        `;
      }
      
      // Handle tickets with payment links
      return `
        <div class="ticket-option available-ticket">
          <div class="ticket-header">
            <h3 class="ticket-name">${ticket.name || 'General Admission'}</h3>
            <span class="ticket-price">$${parseFloat(ticket.price).toFixed(2)}</span>
          </div>
          ${ticket.description ? `<div class="ticket-description-box">${ticket.description}</div>` : ''}
          <div class="ticket-actions">
            <a href="${ticket.ticket_link}" class="button primary-button" target="_blank">Register Now</a>
            <a href="${ticket.ticket_link}" class="view-link" target="_blank">View Payment Page</a>
          </div>
        </div>
      `;
    }).join('');
    
    console.log(`Generated HTML for ${ticketsWithLinks.length} ticket options`);
    
    // Make sure we have HTML content to display
    if (!ticketOptionsHtml || ticketOptionsHtml.trim() === '') {
      console.log('No ticket options HTML generated despite having tickets');
      return `
        <p>Tickets for this event are being prepared.</p>
        <p>Please check back soon to register.</p>
      `;
    }
    
    return `
      <div class="ticket-options">
        <p class="ticket-prompt">Select a ticket option:</p>
        ${ticketOptionsHtml}
      </div>
    `;
  }
  
  // Fall back to the original single ticket display if no multiple tickets are available
  if (!ticketLink) {
    if (hasTickets) {
      console.log('Rendering tickets being prepared section');
      return `
        <p>Tickets for this event are being prepared.</p>
        <p>Please check back soon to register.</p>
      `;
    }
    
    console.log('Rendering no tickets available section');
    return `
      <p>No tickets available for this event at this time.</p>
      <p>Check back later for registration details.</p>
    `;
  }
  
  console.log('Rendering single ticket registration section with link:', ticketLink);
  console.log('Ticket description:', ticketDescription);
  
  // Display ticket description if available - with more prominent styling
  const descriptionHtml = ticketDescription 
    ? `<div class="ticket-description-box">${ticketDescription}</div>` 
    : '';
    
  // Add both the registration button and a link to view the live page
  return `
    <div class="ticket-info">
      ${descriptionHtml}
      <p class="ticket-prompt">Secure your spot at this event!</p>
      <div class="ticket-actions">
        <a href="${ticketLink}" class="button primary-button" target="_blank">Register Now</a>
        <a href="${ticketLink}" class="view-link" target="_blank">View Payment Page</a>
      </div>
    </div>
  `;
}
