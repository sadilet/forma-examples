import { renderLayout, formatCents, formatDate } from './layout.mjs';

export function logAudit(db, appointmentId, fromStatus, toStatus, amountCents, reason) {
  db.prepare(`
    INSERT INTO deposit_audits (appointment_id, from_status, to_status, amount_cents, reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(appointmentId, fromStatus, toStatus, amountCents, reason, Date.now());
}

export function sendNotification(db, appointmentId, channel, recipient, subject, body) {
  db.prepare(`
    INSERT INTO notifications_log (appointment_id, channel, recipient, subject, body, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(appointmentId, channel, recipient, subject, body, Date.now());
}

export function registerNotificationRoutes(routes, kit) {
  const { db, esc, html } = kit;

  // Audit Logs & Simulated Outbox
  routes.push({
    method: "GET",
    path: "/owner/logs",
    handler: (ctx) => {
      const audits = db.prepare(`
        SELECT da.*, a.token, a.client_name
        FROM deposit_audits da
        LEFT JOIN appointments a ON da.appointment_id = a.id
        ORDER BY da.created_at DESC
      `).all();

      const notifications = db.prepare(`
        SELECT nl.*, a.token
        FROM notifications_log nl
        LEFT JOIN appointments a ON nl.appointment_id = a.id
        ORDER BY nl.created_at DESC
      `).all();

      const body = `
        <div class="dashboard-header">
          <h1>Audit Trail & Simulated Notifications Log</h1>
          <a href="/owner" class="btn btn-outline">&larr; Back to Dashboard</a>
        </div>

        <div class="settings-grid">
          <!-- Audit Trail -->
          <div class="card">
            <h2>🛡️ Deposit State Change Audit Log</h2>
            <p class="text-muted">Immutable record of every deposit transition (captured, refunded, forfeited).</p>

            <div class="audit-list">
              ${audits.map(log => `
                <div class="audit-item">
                  <div class="audit-time">${formatDate(log.created_at)}</div>
                  <div class="audit-details">
                    <strong>${esc(log.client_name || 'Appointment #' + log.appointment_id)}</strong>
                    <span class="badge badge-secondary">${esc(log.from_status)} &rarr; ${esc(log.to_status)}</span>
                    <div class="audit-reason">${esc(log.reason)}</div>
                    <div class="text-sub">Amount: <strong>${formatCents(log.amount_cents)}</strong></div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Simulated Outbox -->
          <div class="card">
            <h2>✉️ Simulated Email & SMS Outbox</h2>
            <p class="text-muted">Outbound confirmation and cancellation messages logged locally in demo build.</p>

            <div class="outbox-list">
              ${notifications.map(n => `
                <div class="outbox-item">
                  <div class="outbox-header">
                    <span class="badge badge-accent">${esc(n.channel.toUpperCase())}</span>
                    <span class="text-sub">${formatDate(n.created_at)}</span>
                  </div>
                  <div class="outbox-to">To: <strong>${esc(n.recipient)}</strong></div>
                  <div class="outbox-subject">Subject: ${esc(n.subject)}</div>
                  <p class="outbox-body">${esc(n.body)}</p>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `;

      return html(renderLayout({
        title: "Audit & Outbox Logs",
        body,
        activeNav: "logs",
        esc
      }));
    }
  });
}
