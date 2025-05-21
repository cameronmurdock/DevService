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

export function renderTicketsSection(ticketLink, isFreeEvent = false, hasTickets = false, ticketDescription = '') {
  // Log the inputs to the function for debugging
  console.log('renderTicketsSection called with:', { ticketLink, isFreeEvent, hasTickets, ticketDescription });
  
  if (isFreeEvent) {
    console.log('Rendering free event ticket section');
    return `
      <p>This is a free event. No registration required.</p>
    `;
  }
  
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
  
  console.log('Rendering ticket registration section with link:', ticketLink);
  
  // Display ticket description if available
  const descriptionHtml = ticketDescription 
    ? `<p class="ticket-description">${ticketDescription}</p>` 
    : '';
    
  // Add both the registration button and a link to view the live page
  return `
    <div class="ticket-info">
      ${descriptionHtml}
      <p>Secure your spot at this event!</p>
      <div class="ticket-actions">
        <a href="${ticketLink}" class="button primary-button" target="_blank">Register Now</a>
        <a href="${ticketLink}" class="view-link" target="_blank">View Payment Page</a>
      </div>
    </div>
  `;
}
