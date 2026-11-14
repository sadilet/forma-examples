import { renderLayout, formatCents, formatDate } from './layout.mjs';
import { logAudit, sendNotification } from './notifications.mjs';

export function registerBookingRoutes(routes, kit) {
  const { db, esc, html, redirect } = kit;

  // 1. Public Booking Page
  routes.push({
    method: "GET",
    path: "/book/:slug",
    handler: (ctx) => {
      const slug = ctx.params.slug;
      const business = db.prepare("SELECT * FROM businesses WHERE slug = ?").get(slug);
      if (!business) {
        return html(renderLayout({ title: "Business Not Found", body: "<h2>Business Not Found</h2>", esc }), 404);
      }

      const rules = db.prepare("SELECT * FROM deposit_rules WHERE business_id = ?").get(business.id) || {
        deposit_type: 'percent',
        deposit_value: 25,
        cancel_cutoff_hours: 24,
        late_cancel_policy: 'keep_100'
      };

      const services = db.prepare("SELECT * FROM services WHERE business_id = ? AND is_active = 1").all(business.id);

      // Generate available slot timestamps relative to today
      const availableSlots = generateSlotOptions();

      const body = `
        <div class="booking-header card">
          <span class="badge badge-primary">SlotGuard Protected Booking</span>
          <h1>${esc(business.name)}</h1>
          <p class="text-muted">Owner: ${esc(business.owner_name)} &bull; Phone: ${esc(business.phone)}</p>
          
          <div class="policy-callout">
            <div class="policy-icon">ℹ️</div>
            <div class="policy-text">
              <strong>Deposit & Cancellation Policy:</strong>
              This location collects a ${rules.deposit_type === 'percent' ? rules.deposit_value + '%' : formatCents(rules.deposit_value)} refundable deposit at booking. 
              You can cancel or reschedule for a <strong>100% refund up to ${rules.cancel_cutoff_hours} hours</strong> before your appointment time.
            </div>
          </div>
        </div>

        <form method="POST" action="/book/${esc(slug)}/create" class="card booking-form">
          <h2>1. Select Service & Time</h2>

          <div class="form-group">
            <label class="form-label">Service Required</label>
            <div class="services-selection">
              ${services.map((s, idx) => {
                const depositAmt = rules.deposit_type === 'percent' 
                  ? Math.round(s.price_cents * (rules.deposit_value / 100))
                  : Math.min(s.price_cents, rules.deposit_value);
                return `
                  <label class="service-radio-card">
                    <input type="radio" name="service_id" value="${s.id}" ${idx === 0 ? 'checked' : ''} required>
                    <div class="service-info">
                      <div class="service-title-row">
                        <strong>${esc(s.name)}</strong>
                        <span class="service-price">${formatCents(s.price_cents)}</span>
                      </div>
                      <p class="service-desc">${esc(s.description)}</p>
                      <div class="service-meta">
                        <span>⏱️ ${s.duration_minutes} mins</span>
                        <span class="deposit-tag">🛡️ Deposit Required: ${formatCents(depositAmt)}</span>
                      </div>
                    </div>
                  </label>
                `;
              }).join('')}
            </div>
          </div>

          <div class="form-group">
            <label for="start_time" class="form-label">Available Time Slots</label>
            <select name="start_time" id="start_time" class="form-control" required>
              ${availableSlots.map(slot => `
                <option value="${slot.time}">${esc(slot.label)}</option>
              `).join('')}
            </select>
          </div>

          <h2 style="margin-top: 1.5rem;">2. Your Contact Information</h2>

          <div class="form-grid">
            <div class="form-group">
              <label for="client_name" class="form-label">Full Name</label>
              <input type="text" id="client_name" name="client_name" class="form-control" placeholder="Jane Doe" required>
            </div>
            <div class="form-group">
              <label for="client_email" class="form-label">Email Address</label>
              <input type="email" id="client_email" name="client_email" class="form-control" placeholder="jane@example.com" required>
            </div>
            <div class="form-group">
              <label for="client_phone" class="form-label">Phone Number</label>
              <input type="tel" id="client_phone" name="client_phone" class="form-control" placeholder="(555) 123-4567" required>
            </div>
          </div>

          <div class="form-actions">
            <button type="submit" class="btn btn-primary btn-block">Continue to Deposit Checkout &rarr;</button>
          </div>
        </form>
      `;

      return html(renderLayout({
        title: `Book - ${business.name}`,
        body,
        activeNav: "booking",
        esc
      }));
    }
  });

  // 2. Process Booking Submission -> Redirect to Checkout
  routes.push({
    method: "POST",
    path: "/book/:slug/create",
    handler: async (ctx) => {
      const form = await ctx.form();
      const slug = ctx.params.slug;

      const business = db.prepare("SELECT * FROM businesses WHERE slug = ?").get(slug);
      if (!business) return redirect("/");

      const serviceId = parseInt(form.service_id, 10);
      const service = db.prepare("SELECT * FROM services WHERE id = ?").get(serviceId);
      if (!service) return redirect(`/book/${slug}`);

      const startTime = parseInt(form.start_time, 10);
      const endTime = startTime + (service.duration_minutes * 60 * 1000);

      // Concurrency rule check: Prevent double booking
      const conflict = db.prepare(`
        SELECT id FROM appointments 
        WHERE business_id = ? 
          AND status IN ('pending_payment', 'confirmed')
          AND ((start_time < ? AND end_time > ?) OR (start_time >= ? AND start_time < ?))
      `).get(business.id, endTime, startTime, startTime, endTime);

      if (conflict) {
        return html(renderLayout({
          title: "Slot Unavailable",
          body: `
            <div class="card warning-card">
              <h2>Slot No Longer Available</h2>
              <p>Someone else just reserved that time slot. Please choose another available time.</p>
              <a href="/book/${esc(slug)}" class="btn btn-primary">Back to Schedule</a>
            </div>
          `,
          esc
        }));
      }

      // Calculate deposit based on rules
      const rules = db.prepare("SELECT * FROM deposit_rules WHERE business_id = ?").get(business.id);
      let depositCents = 0;
      if (rules.deposit_type === 'percent') {
        depositCents = Math.round(service.price_cents * (rules.deposit_value / 100));
      } else {
        depositCents = Math.min(service.price_cents, rules.deposit_value);
      }

      const token = 'token-' + Date.now() + '-' + Math.floor(Math.random() * 10000);

      const res = db.prepare(`
        INSERT INTO appointments (
          token, business_id, service_id, client_name, client_email, client_phone,
          start_time, end_time, service_price_cents, deposit_amount_cents,
          status, deposit_status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_payment', 'unpaid', ?)
      `).run(
        token,
        business.id,
        service.id,
        form.client_name || 'Guest',
        form.client_email || 'guest@example.com',
        form.client_phone || '',
        startTime,
        endTime,
        service.price_cents,
        depositCents,
        Date.now()
      );

      return redirect(`/checkout/${res.lastInsertRowid}`);
    }
  });

  // 3. Deposit Checkout Screen
  routes.push({
    method: "GET",
    path: "/checkout/:id",
    handler: (ctx) => {
      const apptId = parseInt(ctx.params.id, 10);
      const appt = db.prepare(`
        SELECT a.*, s.name as service_name, b.name as business_name, b.slug as business_slug,
               r.cancel_cutoff_hours
        FROM appointments a
        JOIN services s ON a.service_id = s.id
        JOIN businesses b ON a.business_id = b.id
        LEFT JOIN deposit_rules r ON b.id = r.business_id
        WHERE a.id = ?
      `).get(apptId);

      if (!appt) {
        return html(renderLayout({ title: "Booking Not Found", body: "<h2>Booking Not Found</h2>", esc }), 404);
      }

      if (appt.status === 'confirmed') {
        return redirect(`/booking/${appt.token}?notice=paid`);
      }

      const body = `
        <div class="checkout-wrapper">
          <div class="card checkout-card">
            <span class="badge badge-accent">Mock Deposit Gateway</span>
            <h1>Confirm Deposit Payment</h1>
            <p class="text-muted">Pay a refundable deposit to reserve your slot at <strong>${esc(appt.business_name)}</strong>.</p>

            <div class="summary-box">
              <div class="summary-row">
                <span>Service:</span>
                <strong>${esc(appt.service_name)}</strong>
              </div>
              <div class="summary-row">
                <span>Appointment Time:</span>
                <strong>${formatDate(appt.start_time)}</strong>
              </div>
              <div class="summary-row">
                <span>Total Service Price:</span>
                <span>${formatCents(appt.service_price_cents)}</span>
              </div>
              <div class="summary-row highlight">
                <span>Deposit Due Now:</span>
                <span class="deposit-amount">${formatCents(appt.deposit_amount_cents)}</span>
              </div>
            </div>

            <div class="policy-notice">
              <h4>🛡️ Refund & Cancellation Terms</h4>
              <p>Full 100% deposit refund (${formatCents(appt.deposit_amount_cents)}) if cancelled or rescheduled at least <strong>${appt.cancel_cutoff_hours || 24} hours</strong> before start time.</p>
            </div>

            <div class="card payment-mock-box">
              <p class="mock-badge"><strong>Demo Build Notice:</strong> No real payment card will be charged. Clicking below simulates Stripe PaymentIntent authorization & instant capture.</p>
              
              <form method="POST" action="/checkout/${appt.id}/pay">
                <div class="form-group">
                  <label class="form-label">Simulated Payment Method</label>
                  <input type="text" class="form-control" value="•••• •••• •••• 4242 (Demo Visa)" disabled>
                </div>
                <button type="submit" class="btn btn-success btn-block btn-lg">
                  Pay ${formatCents(appt.deposit_amount_cents)} Deposit & Confirm Booking &rarr;
                </button>
              </form>
            </div>
          </div>
        </div>
      `;

      return html(renderLayout({
        title: "Deposit Checkout",
        body,
        activeNav: "booking",
        esc
      }));
    }
  });

  // 4. Handle Mock Checkout Payment
  routes.push({
    method: "POST",
    path: "/checkout/:id/pay",
    handler: (ctx) => {
      const apptId = parseInt(ctx.params.id, 10);
      const appt = db.prepare("SELECT * FROM appointments WHERE id = ?").get(apptId);
      if (!appt) return redirect("/");

      const paymentRef = 'PAY-MOCK-' + Math.floor(1000 + Math.random() * 9000);

      db.prepare(`
        UPDATE appointments 
        SET status = 'confirmed', deposit_status = 'captured', payment_ref = ?
        WHERE id = ?
      `).run(paymentRef, apptId);

      // Log Audit Event
      logAudit(db, apptId, 'unpaid', 'captured', appt.deposit_amount_cents, `Deposit authorized and captured via Mock Stripe Gateway (Ref: ${paymentRef})`);

      // Log Notification
      sendNotification(
        db,
        apptId,
        'email',
        appt.client_email,
        `Deposit Confirmed - Appointment Reserved`,
        `Your deposit of ${formatCents(appt.deposit_amount_cents)} is confirmed (Ref: ${paymentRef}). Appointment set for ${formatDate(appt.start_time)}.`
      );

      return redirect(`/booking/${appt.token}?notice=paid`);
    }
  });

  // 5. Client View / Cancel / Reschedule Screen
  routes.push({
    method: "GET",
    path: "/booking/:token",
    handler: (ctx) => {
      const token = ctx.params.token;
      const appt = db.prepare(`
        SELECT a.*, s.name as service_name, s.duration_minutes, b.name as business_name, b.phone as business_phone,
               r.cancel_cutoff_hours
        FROM appointments a
        JOIN services s ON a.service_id = s.id
        JOIN businesses b ON a.business_id = b.id
        LEFT JOIN deposit_rules r ON b.id = r.business_id
        WHERE a.token = ?
      `).get(token);

      if (!appt) {
        return html(renderLayout({ title: "Appointment Not Found", body: "<h2>Appointment Not Found</h2>", esc }), 404);
      }

      const notice = ctx.query.notice ? getNoticeMessage(ctx.query.notice) : null;
      const now = Date.now();
      const hoursUntil = (appt.start_time - now) / (1000 * 60 * 60);
      const isWithinCutoff = hoursUntil < (appt.cancel_cutoff_hours || 24);

      const availableSlots = generateSlotOptions();

      const body = `
        <div class="manage-booking-wrapper card">
          <div class="booking-status-header">
            <div>
              <span class="badge ${getStatusBadgeClass(appt.status)}">${esc(appt.status.toUpperCase())}</span>
              <span class="badge ${getDepositBadgeClass(appt.deposit_status)}">Deposit: ${esc(appt.deposit_status.toUpperCase())}</span>
            </div>
            <p class="text-muted" style="margin-top:0.5rem;">Booking Reference: <code>${esc(appt.token)}</code></p>
          </div>

          <h1>Appointment Details</h1>

          <div class="details-grid">
            <div>
              <strong>Business:</strong>
              <p>${esc(appt.business_name)} (${esc(appt.business_phone)})</p>
            </div>
            <div>
              <strong>Service:</strong>
              <p>${esc(appt.service_name)} (${appt.duration_minutes} mins)</p>
            </div>
            <div>
              <strong>Scheduled Time:</strong>
              <p class="highlight-text">${formatDate(appt.start_time)}</p>
            </div>
            <div>
              <strong>Client Details:</strong>
              <p>${esc(appt.client_name)} (${esc(appt.client_email)})</p>
            </div>
            <div>
              <strong>Service Price:</strong>
              <p>${formatCents(appt.service_price_cents)}</p>
            </div>
            <div>
              <strong>Deposit Amount:</strong>
              <p>${formatCents(appt.deposit_amount_cents)} (${appt.payment_ref ? 'Ref: ' + esc(appt.payment_ref) : 'Unpaid'})</p>
            </div>
          </div>

          ${appt.status === 'confirmed' ? `
            <hr style="margin: 2rem 0; border: none; border-top: 1px solid var(--border-color);">

            <div class="manage-actions-grid">
              <!-- Reschedule Form -->
              <div class="card inner-card">
                <h3>🗓️ Reschedule Appointment</h3>
                <p>Select a new time for your service. Your deposit will automatically transfer.</p>
                <form method="POST" action="/booking/${esc(appt.token)}/reschedule">
                  <div class="form-group">
                    <label class="form-label">New Time Slot</label>
                    <select name="new_start_time" class="form-control" required>
                      ${availableSlots.map(slot => `<option value="${slot.time}">${esc(slot.label)}</option>`).join('')}
                    </select>
                  </div>
                  <button type="submit" class="btn btn-secondary btn-block">Confirm Reschedule</button>
                </form>
              </div>

              <!-- Cancel Form -->
              <div class="card inner-card danger-zone">
                <h3>❌ Cancel Appointment</h3>
                <div class="cancellation-policy-eval">
                  ${isWithinCutoff ? `
                    <div class="alert alert-warning">
                      ⚠️ <strong>Late Cancellation Warning:</strong> Your appointment is less than <strong>${appt.cancel_cutoff_hours} hours</strong> away. 
                      Per policy, cancelling now will <strong>forfeit your ${formatCents(appt.deposit_amount_cents)} deposit</strong> to compensate the provider.
                    </div>
                  ` : `
                    <div class="alert alert-success">
                      ✅ <strong>Full Refund Eligible:</strong> You are cancelling more than ${appt.cancel_cutoff_hours} hours in advance. 
                      Your <strong>${formatCents(appt.deposit_amount_cents)} deposit will be fully refunded</strong>.
                    </div>
                  `}
                </div>
                <form method="POST" action="/booking/${esc(appt.token)}/cancel">
                  <button type="submit" class="btn btn-danger btn-block" onclick="return confirm('Are you sure you want to cancel this appointment?')">
                    ${isWithinCutoff ? 'Cancel & Forfeit Deposit' : 'Cancel & Request Full Refund'}
                  </button>
                </form>
              </div>
            </div>
          ` : `
            <div class="alert alert-info" style="margin-top: 1.5rem;">
              This appointment is currently marked as <strong>${esc(appt.status)}</strong>. Further modifications are disabled.
            </div>
          `}
        </div>
      `;

      return html(renderLayout({
        title: "Manage Appointment",
        body,
        activeNav: "booking",
        notice,
        esc
      }));
    }
  });

  // 6. Handle Cancellation Logic
  routes.push({
    method: "POST",
    path: "/booking/:token/cancel",
    handler: (ctx) => {
      const token = ctx.params.token;
      const appt = db.prepare(`
        SELECT a.*, r.cancel_cutoff_hours 
        FROM appointments a
        JOIN businesses b ON a.business_id = b.id
        LEFT JOIN deposit_rules r ON b.id = r.business_id
        WHERE a.token = ?
      `).get(token);

      if (!appt || appt.status !== 'confirmed') return redirect('/');

      const now = Date.now();
      const hoursUntil = (appt.start_time - now) / (1000 * 60 * 60);
      const isLateCancel = hoursUntil < (appt.cancel_cutoff_hours || 24);

      let newDepositStatus = 'refunded';
      let reasonText = '';

      if (isLateCancel) {
        newDepositStatus = 'forfeited';
        reasonText = `Late cancellation within ${appt.cancel_cutoff_hours}h cutoff. Deposit forfeited.`;
      } else {
        newDepositStatus = 'refunded';
        reasonText = `Client cancelled prior to ${appt.cancel_cutoff_hours}h cutoff. Full deposit refunded.`;
      }

      db.prepare(`
        UPDATE appointments 
        SET status = 'cancelled', deposit_status = ? 
        WHERE id = ?
      `).run(newDepositStatus, appt.id);

      logAudit(db, appt.id, appt.deposit_status, newDepositStatus, appt.deposit_amount_cents, reasonText);

      sendNotification(
        db,
        appt.id,
        'email',
        appt.client_email,
        `Appointment Cancelled - ${newDepositStatus === 'refunded' ? 'Refund Processed' : 'Deposit Forfeited'}`,
        `Your appointment was cancelled. ${reasonText}`
      );

      return redirect(`/booking/${token}?notice=cancelled`);
    }
  });

  // 7. Handle Reschedule Logic
  routes.push({
    method: "POST",
    path: "/booking/:token/reschedule",
    handler: async (ctx) => {
      const token = ctx.params.token;
      const form = await ctx.form();
      const newStartTime = parseInt(form.new_start_time, 10);

      const appt = db.prepare("SELECT a.*, s.duration_minutes FROM appointments a JOIN services s ON a.service_id = s.id WHERE a.token = ?").get(token);
      if (!appt || appt.status !== 'confirmed') return redirect('/');

      const newEndTime = newStartTime + (appt.duration_minutes * 60 * 1000);

      // Check conflict
      const conflict = db.prepare(`
        SELECT id FROM appointments 
        WHERE business_id = ? 
          AND id != ?
          AND status IN ('pending_payment', 'confirmed')
          AND ((start_time < ? AND end_time > ?) OR (start_time >= ? AND start_time < ?))
      `).get(appt.business_id, appt.id, newEndTime, newStartTime, newStartTime, newEndTime);

      if (conflict) {
        return redirect(`/booking/${token}?notice=slot_busy`);
      }

      db.prepare(`
        UPDATE appointments 
        SET start_time = ?, end_time = ? 
        WHERE id = ?
      `).run(newStartTime, newEndTime, appt.id);

      logAudit(db, appt.id, appt.deposit_status, appt.deposit_status, appt.deposit_amount_cents, `Appointment rescheduled to ${formatDate(newStartTime)}`);

      sendNotification(
        db,
        appt.id,
        'email',
        appt.client_email,
        'Appointment Rescheduled',
        `Your appointment has been moved to ${formatDate(newStartTime)}.`
      );

      return redirect(`/booking/${token}?notice=rescheduled`);
    }
  });
}

function generateSlotOptions() {
  const options = [];
  const now = Date.now();
  const HOUR = 3600000;
  
  // Create 6 upcoming realistic time slots
  const offsets = [3, 25, 28, 49, 52, 73];
  offsets.forEach((offsetHours) => {
    const timeMs = now + (offsetHours * HOUR);
    options.push({
      time: timeMs,
      label: formatDate(timeMs)
    });
  });

  return options;
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
  if (code === 'paid') return 'Deposit successfully processed! Your appointment is confirmed.';
  if (code === 'cancelled') return 'Your booking has been cancelled and deposit rule applied.';
  if (code === 'rescheduled') return 'Your appointment was successfully rescheduled.';
  if (code === 'slot_busy') return 'Selected time slot is unavailable. Please try another time.';
  return null;
}
