const { Pool } = require('pg');

// Connects to the SAME PostgreSQL as the Tracker app
// DATABASE_URL is shared between both apps on the VPS

let _pool = null;

function getPool() {
  if (!_pool) {
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: false,
      min: 1,
      max: 5,
      idleTimeoutMillis: 30_000,
    });
    _pool.on('error', (err) => console.error('[tracker-db] pool error:', err));
  }
  return _pool;
}

function normalizePhone(phone) {
  if (!phone) return null;
  const cleaned = phone.replace(/\D/g, '').replace(/^0+/, '');
  if (cleaned.startsWith('91') && cleaned.length > 10) {
    const stripped = cleaned.slice(2);
    if (stripped.length === 10) return stripped;
  }
  return cleaned.slice(-10);
}

// Extract last 4 digits from whatever the user typed
function last4Digits(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

function normalizeOrderId(orderId) {
  if (!orderId) return null;
  const trimmed = orderId.trim();
  // Accept with or without # prefix
  if (/^\d+$/.test(trimmed)) return `#${trimmed}`;
  if (trimmed.startsWith('#')) return trimmed;
  return trimmed;
}

// Look up an order by order_id, email, phone, or last 4 digits of phone
// trackerBusinessId scopes the lookup to orders from a specific store
async function lookupOrder({ order_id, email, phone, phone_last4, name }, trackerBusinessId) {
  const pool = getPool();

  const normalizedOrderId = normalizeOrderId(order_id);
  const normalizedPhone = normalizePhone(phone);
  const normalizedEmail = email ? email.toLowerCase().trim() : null;
  const last4 = phone_last4 ? phone_last4.replace(/\D/g, '').slice(-4) : last4Digits(phone);
  const normalizedName = name ? name.trim() : null;

  if (!normalizedOrderId && !normalizedEmail && !normalizedPhone && !last4 && !normalizedName) {
    return { found: false, message: 'Please provide a name, last 4 digits of phone, email, or order ID.' };
  }

  try {
    const result = await pool.query(
      `SELECT
         o.order_id,
         o.customer_name,
         o.customer_email,
         o.customer_mobile,
         o.tracking_status,
         o.tracking_id,
         o.tracking_token,
         o.courier_partner,
         o.estimated_delivery,
         o.order_total,
         o.city,
         o.state,
         o.created_at,
         o.is_cancelled,
         o.payment_method,
         b.name AS business_name,
         b.tracking_domain AS business_tracking_domain,
         COALESCE(
           array_agg(oi.product_name ORDER BY oi.created_at)
           FILTER (WHERE oi.product_name IS NOT NULL), '{}'
         ) AS products
       FROM orders o
       LEFT JOIN order_items oi ON oi.order_id = o.order_id
       LEFT JOIN businesses b ON b.id = o.business_id
       WHERE (
         ($1::text IS NOT NULL AND o.order_id ILIKE $1) OR
         ($2::text IS NOT NULL AND LOWER(o.customer_email) = $2) OR
         ($3::text IS NOT NULL AND o.customer_mobile = $3) OR
         ($5::text IS NOT NULL AND RIGHT(o.customer_mobile, 4) = $5) OR
         ($6::text IS NOT NULL AND o.customer_name ILIKE '%' || $6 || '%')
       )
       AND ($4::uuid IS NULL OR o.business_id = $4::uuid)
       GROUP BY
         o.order_id, o.customer_name, o.customer_email, o.customer_mobile,
         o.tracking_status, o.tracking_id, o.tracking_token, o.courier_partner, o.estimated_delivery,
         o.order_total, o.city, o.state, o.created_at, o.is_cancelled,
         o.payment_method, b.name, b.tracking_domain
       ORDER BY o.created_at DESC
       LIMIT 3`,
      [normalizedOrderId, normalizedEmail, normalizedPhone, trackerBusinessId || null, last4, normalizedName]
    );

    if (result.rows.length === 0) {
      return {
        found: false,
        message: 'No order found with those details. Please double-check the order ID or try your registered email/phone.',
      };
    }

    const TRACKER_BASE = process.env.SERVER_PUBLIC_URL?.replace(':5000', '') || 'http://200.141.13.66';

    const orders = result.rows.map((row) => {
      const trackingBase = row.business_tracking_domain || TRACKER_BASE;
      const trackingLink = row.tracking_token
        ? `${trackingBase}/track/${row.tracking_token}`
        : null;

      const rawPay = (row.payment_method || '').toLowerCase();
      const isCOD = rawPay === 'cod' || rawPay.includes('cash on delivery');
      const paymentDisplay = isCOD ? 'Cash on Delivery (COD)' : 'Prepaid';

      return {
        order_id: row.order_id,
        customer_name: row.customer_name,
        status: row.tracking_status,
        tracking_id: row.tracking_id || null,
        tracking_link: trackingLink,
        courier: row.courier_partner || null,
        estimated_delivery: row.estimated_delivery || null,
        total: row.order_total,
        products: row.products || [],
        placed_on: row.created_at,
        store: row.business_name,
        cancelled: row.is_cancelled,
        payment: paymentDisplay,
      };
    });

    return { found: true, count: orders.length, orders };
  } catch (err) {
    console.error('[tracker-db] lookupOrder error:', err);
    return { found: false, message: 'Could not look up order right now. Please try again in a moment.' };
  }
}

// Get all Shopify-connected businesses (for syncing to chat sites)
async function getConnectedBusinesses() {
  const pool = getPool();
  try {
    const result = await pool.query(
      `SELECT id, name, shopify_domain
       FROM businesses
       ORDER BY created_at DESC`
    );
    return result.rows;
  } catch (err) {
    console.error('[tracker-db] getConnectedBusinesses error:', err);
    return [];
  }
}

module.exports = { lookupOrder, getConnectedBusinesses };
