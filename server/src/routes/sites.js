const express = require('express');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../db');
const { authMiddleware } = require('../middleware/auth');
const router = express.Router();

router.use(authMiddleware);

// List all sites
router.get('/', async (req, res) => {
  try {
    const sites = await prisma.site.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { conversations: true } },
      },
    });
    res.json(sites);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single site
router.get('/:id', async (req, res) => {
  try {
    const site = await prisma.site.findUnique({ where: { id: req.params.id } });
    if (!site) return res.status(404).json({ error: 'Site not found' });
    res.json(site);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create site
router.post('/', async (req, res) => {
  try {
    const { name, domain, systemPrompt, aiEnabled } = req.body;
    if (!name || !domain) return res.status(400).json({ error: 'name and domain are required' });

    const site = await prisma.site.create({
      data: {
        name,
        domain: domain.toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, ''),
        systemPrompt: systemPrompt || null,
        aiEnabled: aiEnabled !== false,
        widgetKey: uuidv4(),
      },
    });
    res.status(201).json(site);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update site
router.patch('/:id', async (req, res) => {
  try {
    const { name, domain, systemPrompt, aiEnabled } = req.body;
    const site = await prisma.site.update({
      where: { id: req.params.id },
      data: {
        ...(name && { name }),
        ...(domain && { domain: domain.toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '') }),
        ...(systemPrompt !== undefined && { systemPrompt }),
        ...(aiEnabled !== undefined && { aiEnabled }),
      },
    });
    res.json(site);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete site
router.delete('/:id', async (req, res) => {
  try {
    await prisma.site.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Regenerate widget key
router.post('/:id/regenerate-key', async (req, res) => {
  try {
    const site = await prisma.site.update({
      where: { id: req.params.id },
      data: { widgetKey: uuidv4() },
    });
    res.json({ widgetKey: site.widgetKey });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
