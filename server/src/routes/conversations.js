const express = require('express');
const prisma = require('../db');
const { authMiddleware } = require('../middleware/auth');
const router = express.Router();

router.use(authMiddleware);

// List conversations (with optional site filter)
router.get('/', async (req, res) => {
  try {
    const { siteId, status, category, page = 1, limit = 500 } = req.query;
    const where = {};
    if (siteId) where.siteId = siteId;
    if (status) where.status = status;
    if (category) where.category = category;

    const [conversations, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        orderBy: { lastMessageAt: 'desc' },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
        include: {
          site: { select: { id: true, name: true, domain: true } },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      }),
      prisma.conversation.count({ where }),
    ]);

    res.json({ conversations, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single conversation with messages
router.get('/:id', async (req, res) => {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      include: {
        site: true,
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!conversation) return res.status(404).json({ error: 'Not found' });

    // Filter out internal messages (tool calls, tool results, empty AI placeholders)
    conversation.messages = conversation.messages.filter((m) => {
      if (m.sender === 'tool_result') return false;
      if (m.metadata?.hidden) return false;
      if (!m.content || m.content.trim() === '') return false;
      return true;
    });

    // Mark as read
    if (conversation.unreadCount > 0) {
      await prisma.conversation.update({
        where: { id: req.params.id },
        data: { unreadCount: 0 },
      });
    }

    res.json(conversation);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update conversation status
router.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const valid = ['ai_handling', 'agent_handling', 'resolved', 'human_needed'];
    if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });

    const updated = await prisma.conversation.update({
      where: { id: req.params.id },
      data: { status },
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
