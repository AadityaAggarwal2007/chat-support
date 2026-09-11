require('dotenv').config();
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const authRouter = require('./routes/auth');
const sitesRouter = require('./routes/sites');
const conversationsRouter = require('./routes/conversations');
const messagesRouter = require('./routes/messages');
const widgetRouter = require('./routes/widget');
const syncRouter = require('./routes/sync');
const siteEmailsRouter = require('./routes/site-emails');
const settingsRouter = require('./routes/settings');
const { setupSocket } = require('./socket');
const { getConnectedBusinesses } = require('./tracker-db');
const { startEmailPoller } = require('./email-service');

const app = express();
const httpServer = createServer(app);

const allowedOrigins = [
  process.env.DASHBOARD_URL,
  'http://localhost:3000',
  'http://localhost:3001',
];

const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

app.use(cors({
  origin: (origin, cb) => {
    // Allow widget requests from any origin (Shopify, etc.)
    cb(null, true);
  },
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../public')));

app.set('io', io);

// Routes
app.use('/api/auth', authRouter);
app.use('/api/sites', sitesRouter);
app.use('/api/sites/:siteId/emails', siteEmailsRouter);
app.use('/api/conversations', conversationsRouter);
app.use('/api/messages', messagesRouter);
app.use('/api/widget', widgetRouter);
app.use('/api/sync', syncRouter);
app.use('/api/settings', settingsRouter);

// Widget JS — served with permissive CORS for embedding anywhere
app.get('/widget.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.sendFile(path.join(__dirname, '../public/widget.js'));
});

app.get('/health', (req, res) => res.json({ status: 'ok', ts: Date.now() }));

setupSocket(io);

// Auto-sync Tracker businesses → chat sites on startup
async function autoSync() {
  try {
    const businesses = await getConnectedBusinesses();
    if (businesses.length > 0) {
      console.log(`[sync] Found ${businesses.length} connected Shopify store(s) in Tracker — syncing to chat sites...`);
      const prisma = require('./db');
      const { v4: uuidv4 } = require('uuid');
      for (const biz of businesses) {
        const existing = await prisma.site.findFirst({ where: { trackerBusinessId: biz.id } });
        if (!existing) {
          await prisma.site.create({
            data: { name: biz.name, domain: biz.shopify_domain || 'unknown', widgetKey: uuidv4(), aiEnabled: true, trackerBusinessId: biz.id },
          });
          console.log(`[sync] Created site for: ${biz.name} (${biz.shopify_domain})`);
        }
      }
    }
  } catch (err) {
    // Tracker DB might not be set up yet — not a fatal error
    console.warn('[sync] Auto-sync skipped (Tracker DB not reachable):', err.message);
  }
}

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`\n╔═══════════════════════════════════════╗`);
  console.log(`║   Chat Support Server — Running        ║`);
  console.log(`╠═══════════════════════════════════════╣`);
  console.log(`║  API  : http://localhost:${PORT}/api      ║`);
  console.log(`║  Widget: http://localhost:${PORT}/widget.js║`);
  console.log(`╚═══════════════════════════════════════╝\n`);
  setTimeout(autoSync, 2000);
  startEmailPoller(io);
});

module.exports = { app, io };
