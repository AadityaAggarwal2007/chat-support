const express = require('express');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../db');
const { getConnectedBusinesses } = require('../tracker-db');
const { authMiddleware } = require('../middleware/auth');
const router = express.Router();

router.use(authMiddleware);

// POST /api/sync/businesses
// Reads all Shopify-connected businesses from Tracker and creates/updates sites
router.post('/businesses', async (req, res) => {
  try {
    const businesses = await getConnectedBusinesses();
    const results = { created: 0, updated: 0, total: businesses.length };

    for (const biz of businesses) {
      const existing = await prisma.site.findFirst({
        where: { trackerBusinessId: biz.id },
      });

      if (existing) {
        await prisma.site.update({
          where: { id: existing.id },
          data: {
            name: biz.name,
            domain: biz.shopify_domain || existing.domain,
          },
        });
        results.updated++;
      } else {
        await prisma.site.create({
          data: {
            name: biz.name,
            domain: biz.shopify_domain || 'unknown',
            widgetKey: uuidv4(),
            aiEnabled: true,
            trackerBusinessId: biz.id,
          },
        });
        results.created++;
      }
    }

    console.log(`[sync] businesses → sites: ${results.created} created, ${results.updated} updated`);
    res.json({ success: true, ...results });
  } catch (err) {
    console.error('[sync] businesses error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sync/status — show current sync state
router.get('/status', async (req, res) => {
  try {
    const businesses = await getConnectedBusinesses();
    const sites = await prisma.site.findMany({
      where: { trackerBusinessId: { not: null } },
      select: { id: true, name: true, domain: true, trackerBusinessId: true, widgetKey: true },
    });
    res.json({
      trackerBusinesses: businesses.length,
      linkedSites: sites.length,
      unlinked: businesses.length - sites.length,
      sites,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
