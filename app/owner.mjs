import { renderLayout, formatCents, formatDate } from './layout.mjs';
import { logAudit, sendNotification } from './notifications.mjs';

export function registerOwnerRoutes(routes, kit) {
  const { db, esc, html, redirect } = kit;

  // 1. Owner Dashboard
  routes.push({
    method: "GET",
    path: "/owner",
    handler: (ctx) => {
      const biz = db.prepare("SELECT * FROM businesses LIMIT 1").get();
      const rules = db.prepare("SELECT * FROM deposit_rules WHERE business_id = ?").get(biz.id);

      // Financial stats calculations
      const stats = db.prepare(`
        SELECT 
          SUM(CASE WHEN deposit_status = 'captured' THEN deposit_amount_cents ELSE 0 END) as total_captured,
          SUM(CASE WHEN deposit_status = 'forfeited' THEN deposit_amount_cents ELSE 0 END) as total_forfeited,
          SUM(CASE WHEN deposit_status = 'refunded' THEN deposit_amount_cents ELSE 0 END) as total_refunded,
          COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as active_bookings,
          COUNT(CASE WHEN status = 'no_show' THEN 1 END) as noshow_count
        FROM appointments
        WHERE business_id = ?
      `).get(biz.id);

      const appointments = db.prepare(`
        SELECT a.*, s.name as service_name
        FROM appointments a
        JOIN services s ON a.service_id = s.id
        WHERE a.business_id = ?
        ORDER BY a.start_time DESC
      `).all(biz.id);

      const notice = ctx.query.notice ? getNoticeMessage(ctx.query.notice) : null;

      const body = `
        <div class="dashboard-header">
          <div>
            <h1>Owner Dashboard</h1>
            <p class="text-muted">Business: <strong>${esc(biz.name)}</strong> &bull; Pricing Plan: <strong>${esc(biz.pricing_plan)}</strong></p>
          </div>
          <div>
            <a href="/owner/services" class="btn btn-secondary">Manage Services & Deposit Rules &rarr;</a>
          </div>
        </div>

        <!-- Metric KPI Cards -->
        <div class="metrics-grid">
          <div class="metric-card">
            <span class="metric-title">Protected Revenue Saved</span>
            <span class="metric-value text-success">${formatCents(stats.total_forfeited || 0)}</span>
            <span class="metric-sub">${stats.noshow_count || 0} No-Shows covered by deposits</span>
          </div>

          <div class="metric-card">
            <span class="metric-title">Active Held Deposits</span>
            <span class="metric-value">${formatCents(stats.total_captured || 0)}</span>
            <span class="metric-sub">${stats.active_bookings || 0} upcoming confirmed bookings</span>
          </div>

          <div class="metric-card">
            <span class="metric-title">Total Deposit Refunds</span>
            <span class="metric-value text-info">${formatCents(stats.total_refunded || 0)}</span>
            <span class="metric-sub">Issued on timely cancellations</span>
          </div>

          <div class="metric-card">
            <span class="metric-title">Current Deposit Rule</span>
            <span class="metric-value">${rules.deposit_type === 'percent' ? rules.deposit_value + '%' : formatCents(rules.deposit_value)}</span>
            <span class="metric-sub">${rules.cancel_cutoff_hours}h Cancellation Cutoff</span>
          </div>
        </div>

        <!-- Appointment Schedule Table -->
        <div class="card table-card">
          <div class="card-header-flex">
            <h2>Appointments & Deposit Tracking</h2>
            <a href="/book/${esc(biz.slug)}" class="btn btn-outline btn-sm" target="_blank">View Client Booking Page ↗</a>
          </div>

          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Service</th>
                  <th>Date & Time</th>
                  <th>Deposit Status</th>
                  <th>Appt Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${appointments.map(a => `
                  <tr>
                    <td>
                      <strong>${esc(a.client_name)}</strong>
                      <div class="text-sub">${esc(a.client_email)}</div>
                      <div class="text-sub">${esc(a.client_phone)}</div>
                    </td>
                    <td>
                      <div>${esc(a.service_name)}</div>
                      <div class="text-sub">Total: ${formatCents(a.service_price_cents)}</div>
                    </td>
                    <td>
                      <div>${formatDate(a.start_time)}</div>
                      <div class="text-sub">Ref: <code>${esc(a.token)}</code></div>
                    </td>
                    <td>
                      <span class="badge ${getDepositBadgeClass(a.deposit_status)}">
                        ${esc(a.deposit_status.toUpperCase())} (${formatCents(a.deposit_amount_cents)})
                      </span>
                    </td>
                    <td>
                      <span class="badge ${getStatusBadgeClass(a.status)}">${esc(a.status.toUpperCase())}</span>
                    </td>
                    <td>
                      ${a.status === 'confirmed' ? `
                        <div class="action-buttons">
                          <form method="POST" action="/owner/appointment/${a.id}/status" style="display:inline;">
                            <input type="hidden" name="action" value="mark_completed">
                            <button type="submit" class="btn btn-success btn-xs">Complete</button>
                          </form>
                          <form method="POST" action="/owner/appointment/${a.id}/status" style="display:inline;">
                            <input type="hidden" name="action" value="mark_noshow">
                            <button type="submit" class="btn btn-danger btn-xs" onclick="return confirm('Mark client as No-Show? Deposit will be forfeited.')">No-Show</button>
                          </form>
                        </div>
                      ` : `
                        ${a.deposit_status === 'captured' ? `
                          <form method="POST" action="/owner/appointment/${a.id}/status" style="display:inline;">
                            <input type="hidden" name="action" value="force_refund">
                            <button type="submit" class="btn btn-outline btn-xs" onclick="return confirm('Refund deposit manually?')">Refund</button>
                          </form>
                        ` : `<span class="text-muted">&mdash;</span>`}
                      `}
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;

      return html(renderLayout({
        title: "Owner Dashboard | SlotGuard",
        body,
        activeNav: "owner",
        notice,
        esc
      }));
    }
  });

  // 2. Owner Appointment Status Actions (Mark No-Show / Completed / Manual Refund)
  routes.push({
    method: "POST",
    path: "/owner/appointment/:id/status",
    handler: async (ctx) => {
      const id = parseInt(ctx.params.id, 10);
      const form = await ctx.form();
      const action = form.action;

      const appt = db.prepare("SELECT * FROM appointments WHERE id = ?").get(id);
      if (!appt) return redirect('/owner');

      if (action === 'mark_noshow') {
        db.prepare("UPDATE appointments SET status = 'no_show', deposit_status = 'forfeited' WHERE id = ?").run(id);
        logAudit(db, id, appt.deposit_status, 'forfeited', appt.deposit_amount_cents, 'Owner marked client as No-Show. Deposit forfeited.');
        sendNotification(db, id, 'email', appt.client_email, 'No-Show Notice', 'You were marked as a no-show. Deposit forfeited.');
        return redirect('/owner?notice=noshow_marked');
      }

      if (action === 'mark_completed') {
        db.prepare("UPDATE appointments SET status = 'completed' WHERE id = ?").run(id);
        logAudit(db, id, appt.deposit_status, appt.deposit_status, appt.deposit_amount_cents, 'Owner marked appointment as service completed.');
        return redirect('/owner?notice=completed_marked');
      }

      if (action === 'force_refund') {
        db.prepare("UPDATE appointments SET deposit_status = 'refunded', status = 'cancelled' WHERE id = ?").run(id);
        logAudit(db, id, appt.deposit_status, 'refunded', appt.deposit_amount_cents, 'Owner issued manual deposit refund.');
        sendNotification(db, id, 'email', appt.client_email, 'Deposit Refunded', 'Your deposit has been refunded by the business.');
        return redirect('/owner?notice=refunded');
      }

      return redirect('/owner');
    }
  });

  // 3. Services & Deposit Rules Page
  routes.push({
    method: "GET",
    path: "/owner/services",
    handler: (ctx) => {
      const biz = db.prepare("SELECT * FROM businesses LIMIT 1").get();
      const rules = db.prepare("SELECT * FROM deposit_rules WHERE business_id = ?").get(biz.id);
      const services = db.prepare("SELECT * FROM services WHERE business_id = ? ORDER BY id ASC").all(biz.id);
      const notice = ctx.query.notice ? getNoticeMessage(ctx.query.notice) : null;

      const body = `
        <div class="dashboard-header">
          <h1>Services & Deposit Configuration</h1>
          <a href="/owner" class="btn btn-outline">&larr; Back to Dashboard</a>
        </div>

        <div class="settings-grid">
          <!-- Deposit Rules Config -->
          <div class="card">
            <h2>🛡️ Business Deposit & Cancel Rules</h2>
            <p class="text-muted">Configure deposit amounts and cutoff rules to guard against no-shows.</p>

            <form method="POST" action="/owner/rules/update">
              <div class="form-group">
                <label class="form-label">Deposit Type</label>
                <select name="deposit_type" class="form-control">
                  <option value="percent" ${rules.deposit_type === 'percent' ? 'selected' : ''}>Percentage of Service Price</option>
                  <option value="fixed" ${rules.deposit_type === 'fixed' ? 'selected' : ''}>Fixed Amount ($)</option>
                </select>
              </div>

              <div class="form-group">
                <label class="form-label">Deposit Value</label>
                <input type="number" name="deposit_value" class="form-control" value="${rules.deposit_value}" required min="1">
                <small class="text-muted">Enter percentage (e.g. 25 for 25%) or fixed amount in cents (e.g. 2000 for $20.00).</small>
              </div>

              <div class="form-group">
                <label class="form-label">Cancellation Cutoff Window (Hours)</label>
                <input type="number" name="cancel_cutoff_hours" class="form-control" value="${rules.cancel_cutoff_hours}" required min="1">
                <small class="text-muted">Clients cancelling before this window get a 100% refund; late cancellations forfeit deposit.</small>
              </div>

              <button type="submit" class="btn btn-primary btn-block">Save Deposit Rules</button>
            </form>
          </div>

          <!-- Services Catalog -->
          <div class="card">
            <h2>💇 Services Catalog</h2>
            <p class="text-muted">Services offered to clients on your public booking page.</p>

            <div class="services-list">
              ${services.map(s => `
                <div class="service-item">
                  <div>
                    <strong>${esc(s.name)}</strong>
                    <div class="text-sub">${esc(s.description)}</div>
                    <div class="text-sub">${s.duration_minutes} mins &bull; <strong>${formatCents(s.price_cents)}</strong></div>
                  </div>
                  <div>
                    <span class="badge ${s.is_active ? 'badge-success' : 'badge-secondary'}">
                      ${s.is_active ? 'Active' : 'Disabled'}
                    </span>
                  </div>
                </div>
              `).join('')}
            </div>

            <hr style="margin: 1.5rem 0; border: none; border-top: 1px solid var(--border-color);">

            <h3>Add New Service</h3>
            <form method="POST" action="/owner/services/add">
              <div class="form-group">
                <label class="form-label">Service Name</label>
                <input type="text" name="name" class="form-control" placeholder="e.g. Scalp Treatment" required>
              </div>
              <div class="form-group">
                <label class="form-label">Description</label>
                <input type="text" name="description" class="form-control" placeholder="Short description of service">
              </div>
              <div class="form-grid">
                <div class="form-group">
                  <label class="form-label">Price ($)</label>
                  <input type="number" step="0.01" name="price" class="form-control" placeholder="75.00" required>
                </div>
                <div class="form-group">
                  <label class="form-label">Duration (Mins)</label>
                  <input type="number" name="duration" class="form-control" placeholder="45" required>
                </div>
              </div>
              <button type="submit" class="btn btn-secondary btn-block">Add Service</button>
            </form>
          </div>
        </div>
      `;

      return html(renderLayout({
        title: "Services & Deposit Rules",
        body,
        activeNav: "services",
        notice,
        esc
      }));
    }
  });

  // 4. Update Deposit Rules Action
  routes.push({
    method: "POST",
    path: "/owner/rules/update",
    handler: async (ctx) => {
      const form = await ctx.form();
      const biz = db.prepare("SELECT id FROM businesses LIMIT 1").get();

      const depositType = form.deposit_type === 'fixed' ? 'fixed' : 'percent';
      const depositValue = parseInt(form.deposit_value, 10) || 25;
      const cutoffHours = parseInt(form.cancel_cutoff_hours, 10) || 24;

      db.prepare(`
        UPDATE deposit_rules 
        SET deposit_type = ?, deposit_value = ?, cancel_cutoff_hours = ?, updated_at = ?
        WHERE business_id = ?
      `).run(depositType, depositValue, cutoffHours, Date.now(), biz.id);

      return redirect('/owner/services?notice=updated');
    }
  });

  // 5. Add Service Action
  routes.push({
    method: "POST",
    path: "/owner/services/add",
    handler: async (ctx) => {
      const form = await ctx.form();
      const biz = db.prepare("SELECT id FROM businesses LIMIT 1").get();

      const priceCents = Math.round(parseFloat(form.price || "0") * 100);
      const duration = parseInt(form.duration, 10) || 30;

      db.prepare(`
        INSERT INTO services (business_id, name, description, price_cents, duration_minutes, is_active)
        VALUES (?, ?, ?, ?, ?, 1)
      `).run(biz.id, form.name || 'New Service', form.description || '', priceCents, duration);

      return redirect('/owner/services?notice=service_added');
    }
  });
}

function getStatusBadgeClass(status) {
  switch (status) {
    case 'confirmed': return 'badge-success';
    case 'completed': return 'badge-primary';
    case 'cancelled': return 'badge-warning';
    case 'no_show': return 'badge-danger';
    default: return 'badge-secondary';
  }
}

function getDepositBadgeClass(status) {
  switch (status) {
    case 'captured': return 'badge-success';
    case 'refunded': return 'badge-info';
    case 'forfeited': return 'badge-danger';
    default: return 'badge-secondary';
  }
}

function getNoticeMessage(code) {
  if (code === 'updated') return 'Deposit rules successfully updated.';
  if (code === 'service_added') return 'New service added to catalog.';
  if (code === 'noshow_marked') return 'Appointment marked as No-Show. Deposit forfeited per policy.';
  if (code === 'completed_marked') return 'Appointment marked as completed.';
  if (code === 'refunded') return 'Deposit manually refunded to client.';
  return null;
}
