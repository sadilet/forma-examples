export function initDb(db) {
  db.exec("PRAGMA foreign_keys = ON;");

  db.exec(`
    CREATE TABLE IF NOT EXISTS businesses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      owner_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      pricing_plan TEXT NOT NULL DEFAULT 'saas_flat',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS deposit_rules (
      business_id INTEGER PRIMARY KEY,
      deposit_type TEXT NOT NULL DEFAULT 'percent', -- 'percent' or 'fixed'
      deposit_value INTEGER NOT NULL DEFAULT 25,   -- 25% or 2000 cents ($20)
      cancel_cutoff_hours INTEGER NOT NULL DEFAULT 24,
      late_cancel_policy TEXT NOT NULL DEFAULT 'keep_100', -- 'keep_100' or 'keep_50'
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      price_cents INTEGER NOT NULL,
      duration_minutes INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT UNIQUE NOT NULL,
      business_id INTEGER NOT NULL,
      service_id INTEGER NOT NULL,
      client_name TEXT NOT NULL,
      client_email TEXT NOT NULL,
      client_phone TEXT NOT NULL,
      start_time INTEGER NOT NULL,
      end_time INTEGER NOT NULL,
      service_price_cents INTEGER NOT NULL,
      deposit_amount_cents INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_payment', -- pending_payment, confirmed, completed, cancelled, no_show
      deposit_status TEXT NOT NULL DEFAULT 'unpaid',  -- unpaid, captured, refunded, forfeited
      payment_ref TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (business_id) REFERENCES businesses(id),
      FOREIGN KEY (service_id) REFERENCES services(id)
    );

    CREATE TABLE IF NOT EXISTS deposit_audits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      appointment_id INTEGER NOT NULL,
      from_status TEXT NOT NULL,
      to_status TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      reason TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notifications_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      appointment_id INTEGER,
      channel TEXT NOT NULL, -- email, sms
      recipient TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  // Seed demo data if database is empty
  const count = db.prepare("SELECT COUNT(*) as c FROM businesses").get().c;
  if (count === 0) {
    const now = Date.now();
    const HOUR = 3600000;
    const DAY = 24 * HOUR;

    // Seed Business
    const bizRes = db.prepare(`
      INSERT INTO businesses (slug, name, owner_name, email, phone, pricing_plan, created_at)
      VALUES ('glow-grace', 'Glow & Grace Studio', 'Sarah Jenkins', 'sarah@glowandgrace.demo', '(555) 234-5678', 'Flat $29/mo SaaS + 1% Fee', ?)
    `).run(now);
    const bizId = bizRes.lastInsertRowid;

    // Seed Deposit Rules
    db.prepare(`
      INSERT INTO deposit_rules (business_id, deposit_type, deposit_value, cancel_cutoff_hours, late_cancel_policy, updated_at)
      VALUES (?, 'percent', 25, 24, 'keep_100', ?)
    `).run(bizId, now);

    // Seed Services
    const s1 = db.prepare(`
      INSERT INTO services (business_id, name, description, price_cents, duration_minutes, is_active)
      VALUES (?, 'Deep Hydration Facial', '60-minute rejuvenating skin treatment with hyaluronic infusion.', 9000, 60, 1)
    `).run(bizId).lastInsertRowid;

    const s2 = db.prepare(`
      INSERT INTO services (business_id, name, description, price_cents, duration_minutes, is_active)
      VALUES (?, 'Gel Manicure & Nail Art', 'Precision manicure with durable gel polish and custom art.', 5000, 45, 1)
    `).run(bizId).lastInsertRowid;

    const s3 = db.prepare(`
      INSERT INTO services (business_id, name, description, price_cents, duration_minutes, is_active)
      VALUES (?, 'Balayage Hair Styling', 'Hand-painted color highlighting, gloss finish, and blow-dry.', 16000, 120, 1)
    `).run(bizId).lastInsertRowid;

    // Seed Appointments relative to NOW
    // 1. Pending payment (checkout smoke target)
    db.prepare(`
      INSERT INTO appointments (id, token, business_id, service_id, client_name, client_email, client_phone, start_time, end_time, service_price_cents, deposit_amount_cents, status, deposit_status, payment_ref, created_at)
      VALUES (1, 'demo-token-checkout', ?, ?, 'Guest Booker', 'guest@example.com', '(555) 000-1111', ?, ?, 9000, 2250, 'pending_payment', 'unpaid', NULL, ?)
    `).run(bizId, s1, now + 4 * HOUR, now + 5 * HOUR, now - HOUR);

    // 2. Confirmed upcoming appointment
    const app2Id = db.prepare(`
      INSERT INTO appointments (token, business_id, service_id, client_name, client_email, client_phone, start_time, end_time, service_price_cents, deposit_amount_cents, status, deposit_status, payment_ref, created_at)
      VALUES ('demo-token-1', ?, ?, 'Elena Rostova', 'elena@example.com', '(555) 987-6543', ?, ?, 5000, 1250, 'confirmed', 'captured', 'PAY-MOCK-1001', ?)
    `).run(bizId, s2, now + 2 * HOUR, now + 2.75 * HOUR, now - 2 * DAY).lastInsertRowid;

    db.prepare(`
      INSERT INTO deposit_audits (appointment_id, from_status, to_status, amount_cents, reason, created_at)
      VALUES (?, 'unpaid', 'captured', 1250, 'Deposit authorized and captured via Mock Payment Provider (Ref: PAY-MOCK-1001)', ?)
    `).run(app2Id, now - 2 * DAY);

    db.prepare(`
      INSERT INTO notifications_log (appointment_id, channel, recipient, subject, body, created_at)
      VALUES (?, 'email', 'elena@example.com', 'Booking Confirmed - Glow & Grace Studio', 'Your appointment for Gel Manicure & Nail Art is confirmed! Deposit of $12.50 was authorized.', ?)
    `).run(app2Id, now - 2 * DAY);

    // 3. Tomorrow confirmed appointment
    const app3Id = db.prepare(`
      INSERT INTO appointments (token, business_id, service_id, client_name, client_email, client_phone, start_time, end_time, service_price_cents, deposit_amount_cents, status, deposit_status, payment_ref, created_at)
      VALUES ('demo-token-2', ?, ?, 'Marcus Vance', 'marcus@example.com', '(555) 321-7654', ?, ?, 16000, 4000, 'confirmed', 'captured', 'PAY-MOCK-1002', ?)
    `).run(bizId, s3, now + 26 * HOUR, now + 28 * HOUR, now - 1 * DAY).lastInsertRowid;

    db.prepare(`
      INSERT INTO deposit_audits (appointment_id, from_status, to_status, amount_cents, reason, created_at)
      VALUES (?, 'unpaid', 'captured', 4000, 'Deposit authorized and captured via Mock Payment Provider (Ref: PAY-MOCK-1002)', ?)
    `).run(app3Id, now - 1 * DAY);

    // 4. Past No-Show (Deposit Forfeited)
    const app4Id = db.prepare(`
      INSERT INTO appointments (token, business_id, service_id, client_name, client_email, client_phone, start_time, end_time, service_price_cents, deposit_amount_cents, status, deposit_status, payment_ref, created_at)
      VALUES ('demo-token-3', ?, ?, 'Dave Miller', 'dave@example.com', '(555) 444-8888', ?, ?, 9000, 2250, 'no_show', 'forfeited', 'PAY-MOCK-1003', ?)
    `).run(bizId, s1, now - 18 * HOUR, now - 17 * HOUR, now - 3 * DAY).lastInsertRowid;

    db.prepare(`
      INSERT INTO deposit_audits (appointment_id, from_status, to_status, amount_cents, reason, created_at)
      VALUES (?, 'unpaid', 'captured', 2250, 'Deposit payment captured', ?),
             (?, 'captured', 'forfeited', 2250, 'Owner marked No-Show. Deposit retained per 24h cutoff policy.', ?)
    `).run(app4Id, now - 3 * DAY, app4Id, now - 16 * HOUR);

    db.prepare(`
      INSERT INTO notifications_log (appointment_id, channel, recipient, subject, body, created_at)
      VALUES (?, 'email', 'dave@example.com', 'Missed Appointment Deposit Notice', 'You were marked as a no-show for your 60-min facial. Per business policy, your $22.50 deposit has been retained.', ?)
    `).run(app4Id, now - 16 * HOUR);

    // 5. Past Cancelled in Advance (Deposit Refunded)
    const app5Id = db.prepare(`
      INSERT INTO appointments (token, business_id, service_id, client_name, client_email, client_phone, start_time, end_time, service_price_cents, deposit_amount_cents, status, deposit_status, payment_ref, created_at)
      VALUES ('demo-token-4', ?, ?, 'Hannah Abbott', 'hannah@example.com', '(555) 777-9999', ?, ?, 5000, 1250, 'cancelled', 'refunded', 'PAY-MOCK-1004', ?)
    `).run(bizId, s2, now - 40 * HOUR, now - 39.25 * HOUR, now - 5 * DAY).lastInsertRowid;

    db.prepare(`
      INSERT INTO deposit_audits (appointment_id, from_status, to_status, amount_cents, reason, created_at)
      VALUES (?, 'unpaid', 'captured', 1250, 'Deposit captured', ?),
             (?, 'captured', 'refunded', 1250, 'Client cancelled with >24h notice. Full deposit refunded automatically.', ?)
    `).run(app5Id, now - 5 * DAY, app5Id, now - 3 * DAY);
  }
}
