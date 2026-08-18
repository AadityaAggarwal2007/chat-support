const express = require('express');
const prisma = require('../db');
const { authMiddleware } = require('../middleware/auth');
const router = express.Router({ mergeParams: true });

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

    const account = await prisma.siteEmail.create({
      data: { siteId: req.params.siteId, email: email.toLowerCase().trim(), appPassword },
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
