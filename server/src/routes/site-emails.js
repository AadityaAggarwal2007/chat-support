const express = require('express');
const { ImapFlow } = require('imapflow');
const prisma = require('../db');
const { authMiddleware } = require('../middleware/auth');
const router = express.Router({ mergeParams: true });

// The poller answers everything above last_uid, so an account saved with zero
// would auto-reply to every email already sitting in the mailbox — years of
// old threads included. Signing in here records where the mailbox stands now
// (and proves the app password works), so answering starts with the next
// email to arrive.
async function mailboxHighWaterMark(email, appPassword) {
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: email, pass: appPassword },
    logger: false,
  });

  await client.connect();
  try {
    const box = await client.mailboxOpen('INBOX', { readOnly: true });
    if (typeof box?.uidNext === 'number' && box.uidNext > 0) return box.uidNext - 1;
    const uids = await client.search({ all: true });
    return Array.isArray(uids) && uids.length ? Math.max(...uids) : 0;
  } finally {
    try { await client.logout(); } catch { /* already gone */ }
  }
}

router.use(authMiddleware);

// GET /api/sites/:siteId/emails
router.get('/', async (req, res) => {
  try {
    const accounts = await prisma.siteEmail.findMany({
      where: { siteId: req.params.siteId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true, createdAt: true }, // never return appPassword
    });
    res.json(accounts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sites/:siteId/emails
router.post('/', async (req, res) => {
  try {
    const { email, appPassword } = req.body;
    if (!email || !appPassword) return res.status(400).json({ error: 'email and appPassword required' });

    const site = await prisma.site.findUnique({ where: { id: req.params.siteId } });
    if (!site) return res.status(404).json({ error: 'Site not found' });

    const count = await prisma.siteEmail.count({ where: { siteId: req.params.siteId } });
    if (count >= 3) return res.status(400).json({ error: 'Maximum 3 email accounts per site' });

    // One mailbox belongs to one site. Two sites polling the same address would
    // both ingest every message, both auto-reply to the customer, and split the
    // thread across two inboxes.
    const normalized = email.toLowerCase().trim();
    const claimed = await prisma.siteEmail.findFirst({
      where: { email: normalized },
      include: { site: { select: { id: true, name: true } } },
    });
    if (claimed) {
      return res.status(409).json({
        error: claimed.site.id === req.params.siteId
          ? 'This address is already connected to this site'
          : `This address is already connected to "${claimed.site.name}" — remove it there first`,
      });
    }

    let lastUid;
    try {
      lastUid = await mailboxHighWaterMark(normalized, appPassword.replace(/\s+/g, ''));
    } catch (imapErr) {
      const text = String(imapErr?.message || '').toLowerCase();
      return res.status(400).json({
        error: text.includes('invalid credentials') || text.includes('authenticationfailed')
          ? 'Gmail rejected that address and app password. Use a 16-character App Password.'
          : `Could not sign in to that mailbox: ${imapErr.message}`,
      });
    }

    const account = await prisma.siteEmail.create({
      data: {
        siteId: req.params.siteId,
        email: normalized,
        appPassword: appPassword.replace(/\s+/g, ''),
        lastUid,
      },
    });

    res.status(201).json({ id: account.id, email: account.email, createdAt: account.createdAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/sites/:siteId/emails/:emailId
router.delete('/:emailId', async (req, res) => {
  try {
    const account = await prisma.siteEmail.findFirst({
      where: { id: req.params.emailId, siteId: req.params.siteId },
    });
    if (!account) return res.status(404).json({ error: 'Not found' });
    await prisma.siteEmail.delete({ where: { id: req.params.emailId } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
