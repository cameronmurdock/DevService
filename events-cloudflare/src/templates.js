// HTML templates for event page, tickets, and guestbook

export function renderGuestbookSection(eventId) {
  return `<section id="guestbook">
    <h2>Guestbook</h2>
    <form method="POST" action="/api/guestbook">
      <input type="hidden" name="eventId" value="${eventId}">
      <label>Name:<br><input type="text" name="name" required></label><br>
      <label>Email:<br><input type="email" name="email" required></label><br>
      <label>Phone:<br><input type="tel" name="phone" pattern="[0-9+\- ]*" placeholder="Optional"></label><br>
      <label>Contact Preference:<br>
        <select name="contactPreference">
          <option value="Share All Riverside Events With Me">Share All Riverside Events With Me</option>
          <option value="Share Similar Events With Me">Share Similar Events With Me</option>
          <option value="Do Not Contact">Do Not Contact</option>
        </select>
      </label><br>
      <label>Comment:<br><textarea name="comment" rows="3" placeholder="Optional"></textarea></label><br>
      <button type="submit">Sign Guestbook</button>
    </form>
  </section>`;
}

export function renderTicketsSection(ticketLink) {
  if (!ticketLink) {
    return `<section id="tickets">
      <h2>Tickets</h2>
      <p>Tickets are not available at this time.</p>
    </section>`;
  }
  return `<section id="tickets">
    <h2>Tickets</h2>
    <div class="ticket-action">
      <a href="${ticketLink}" target="_blank" class="buy-btn">Buy Tickets</a>
    </div>
  </section>`;
}
