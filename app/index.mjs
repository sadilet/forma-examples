import { initDb } from './db.mjs';
import { renderLayout } from './layout.mjs';
import { registerBookingRoutes } from './booking.mjs';
import { registerOwnerRoutes } from './owner.mjs';
import { registerNotificationRoutes } from './notifications.mjs';
import { renderAboutPage } from './about.mjs';

export default function setup(kit) {
  const { db, esc, html, redirect } = kit;

  // Initialize SQLite schema and seed relative demo data
  initDb(db);

  const routes = [
    // Landing / Main route
    {
      method: "GET",
      path: "/",
      handler: (ctx) => {
        const business = db.prepare("SELECT * FROM businesses LIMIT 1").get();
        const noticeMsg = ctx.query.notice ? getNoticeMessage(ctx.query.notice) : null;
        
        const body = `
          <div class="hero-banner">
            <div class="hero-content">
              <span class="badge badge-accent">No-Show Protection for Local Business</span>
              <h1>Stop Losing Money to Empty Slots</h1>
              <p>SlotGuard collects a small refundable deposit at booking time, clearly enforcing cancellation windows and keeping your revenue protected.</p>
              <div class="hero-actions">
                <a href="/book/${esc(business.slug)}" class="btn btn-primary btn-lg">Try Public Booking Link &rarr;</a>
                <a href="/owner" class="btn btn-secondary btn-lg">Owner Dashboard Portal</a>
              </div>
            </div>
          </div>

          <div class="features-grid">
            <div class="card feature-card">
              <div class="feature-icon">🛡️</div>
              <h3>Deposit Safeguard</h3>
              <p>Clients lock in their slot with a percentage or fixed deposit. Automatic enforcement deters casual no-shows.</p>
            </div>
            <div class="card feature-card">
              <div class="feature-icon">📋</div>
              <h3>Transparent Cancel Rules</h3>
              <p>Clear cancellation windows displayed prior to checkout. Automatic full refunds for timely client cancellations.</p>
            </div>
            <div class="card feature-card">
              <div class="feature-icon">📊</div>
              <h3>Protected Revenue Dashboard</h3>
              <p>Track captured deposits, forfeited no-show funds, completed services, and audit state logs in real time.</p>
            </div>
          </div>

          <div class="card quick-demo-box">
            <h3>Quick Navigation & Demo Shortcuts</h3>
            <p>Explore both sides of SlotGuard as a business owner or a client:</p>
            <div class="button-group">
              <a href="/book/glow-grace" class="btn btn-outline">Client Booking Page</a>
              <a href="/owner" class="btn btn-outline">Owner Dashboard</a>
              <a href="/owner/services" class="btn btn-outline">Services & Deposit Rules</a>
              <a href="/owner/logs" class="btn btn-outline">Audit & Outbox Logs</a>
              <a href="/about" class="btn btn-outline">About & Decisions</a>
            </div>
          </div>
        `;

        return html(renderLayout({
          title: "SlotGuard | Eliminate No-Show Losses",
          body,
          activeNav: "home",
          notice: noticeMsg,
          esc
        }));
      }
    },

    // About route
    {
      method: "GET",
      path: "/about",
      handler: (ctx) => html(renderAboutPage(kit))
    }
  ];

  // Register domain sub-routes
  registerBookingRoutes(routes, kit);
  registerOwnerRoutes(routes, kit);
  registerNotificationRoutes(routes, kit);

  return {
    routes,
    smoke: [
      "/",
      "/about",
      "/owner",
      "/owner/services",
      "/owner/logs",
      "/book/glow-grace",
      "/booking/demo-token-1",
      "/checkout/1"
    ]
  };
}

function getNoticeMessage(code) {
  const messages = {
    "paid": "Deposit confirmed! Your booking is secured.",
    "cancelled": "Booking cancellation processed.",
    "rescheduled": "Appointment successfully rescheduled.",
    "updated": "Settings updated successfully.",
    "service_added": "New service added to catalog.",
    "noshow_marked": "Appointment marked as No-Show. Deposit forfeited per policy.",
    "completed_marked": "Appointment marked as completed.",
    "refunded": "Deposit manually refunded to client."
  };
  return messages[code] || null;
}
