export function renderLayout({ title, body, activeNav, notice, esc }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title || "SlotGuard")}</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <header class="app-header">
    <div class="header-container">
      <a href="/" class="brand">
        <span class="brand-shield">🛡️</span>
        <span class="brand-name">SlotGuard</span>
      </a>
      <nav class="main-nav">
        <a href="/book/glow-grace" class="nav-link ${activeNav === 'booking' ? 'active' : ''}">Book Appointment</a>
        <a href="/owner" class="nav-link ${activeNav === 'owner' ? 'active' : ''}">Owner Dashboard</a>
        <a href="/owner/services" class="nav-link ${activeNav === 'services' ? 'active' : ''}">Services & Rules</a>
        <a href="/owner/logs" class="nav-link ${activeNav === 'logs' ? 'active' : ''}">Audit & Outbox</a>
        <a href="/about" class="nav-link ${activeNav === 'about' ? 'active' : ''}">About</a>
      </nav>
    </div>
  </header>

  <main class="app-main">
    <div class="main-container">
      ${notice ? `<div class="notice-banner">${esc(notice)}</div>` : ''}
      ${body}
    </div>
  </main>

  <footer class="app-footer">
    <div class="footer-container">
      <p>SlotGuard Demo Build &bull; Deposit-protected scheduling for local service businesses.</p>
      <div class="footer-links">
        <a href="/">Home</a> &bull; 
        <a href="/book/glow-grace">Public Booking</a> &bull; 
        <a href="/owner">Dashboard</a> &bull; 
        <a href="/about">About & Assumptions</a>
      </div>
    </div>
  </footer>
</body>
</html>`;
}

export function formatCents(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function formatDate(epochMs) {
  if (!epochMs) return '';
  const d = new Date(epochMs);
  return d.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}
