import { renderLayout } from './layout.mjs';

export function renderAboutPage({ esc }) {
  const body = `
    <div class="about-container">
      <div class="card">
        <h1>About SlotGuard</h1>
        <p class="lead-text">SlotGuard is a lightweight deposit safeguard platform that enables local service businesses (salons, clinics, tutors, studios) to eliminate empty slots and severe revenue loss from client no-shows.</p>
        
        <h2>Simulated Subsystems & Demo Mechanics</h2>
        <div class="sim-list">
          <div class="sim-item">
            <strong>💳 Mock Payments Gateway:</strong> No actual money is moved. Deposit checkout simulates instant card authorization and capture via a simulated Stripe Payment Intent.
          </div>
          <div class="sim-item">
            <strong>📧 Simulated Outbox:</strong> All booking confirmations, deposit receipts, and no-show warning emails/SMS are recorded in the internal audit outbox.
          </div>
          <div class="sim-item">
            <strong>🔓 Open Authentication:</strong> Owner area and client management links are fully open in this demo build without requiring real passwords.
          </div>
        </div>

        <h2>Decisions & Assumptions</h2>
        <div class="table-responsive" style="margin-top: 1rem;">
          <table class="data-table">
            <thead>
              <tr>
                <th>Decision / Open Block</th>
                <th>Selected Default Build Strategy</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Pricing Model</strong></td>
                <td>Flat SaaS subscription ($29/month per location) plus 1% deposit fee to align incentives without taking huge cuts of service prices.</td>
              </tr>
              <tr>
                <td><strong>Deposit Rules</strong></td>
                <td>25% refundable deposit required at booking. Free 100% refund for cancellations at least 24 hours in advance. Cancellations within 24 hours or no-shows forfeit 100% of the deposit to compensate for open slot loss.</td>
              </tr>
              <tr>
                <td><strong>Payments Provider</strong></td>
                <td>Mocked Stripe PaymentIntents API with automatic instant capture on form submission and immutable SQLite audit logging.</td>
              </tr>
              <tr>
                <td><strong>Booking Engine Concurrency</strong></td>
                <td>Synchronous SQLite time-range overlap query executed on booking creation to guarantee zero double-booking.</td>
              </tr>
              <tr>
                <td><strong>Notifications</strong></td>
                <td>In-app structured notification log table simulating Email & SMS triggers upon booking confirmation, cancellation, and no-show events.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  return renderLayout({
    title: "About SlotGuard & Assumptions",
    body,
    activeNav: "about",
    esc
  });
}
