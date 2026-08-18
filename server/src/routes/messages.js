const express = require('express');
const prisma = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { sendAgentEmailReply } = require('../email-service');
const router = express.Router();

router.use(authMiddleware);

// Send a message as agent
router.post('/', async (req, res) => {
  try {
    const { conversationId, content } = req.body;
    if (!conversationId || !content) return res.status(400).json({ error: 'conversationId and content required' });

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { siteId: true, source: true },
    });

    const message = await prisma.message.create({
      data: { conversationId, sender: 'agent', content },
    });

    await prisma.conversation.update({
      where: { id: conversationId },
      data: { status: 'agent_handling', lastMessageAt: new Date() },
    });

    const io = req.app.get('io');
    io.of('/agent').to(`conv:${conversationId}`).emit('new_message', message);
    io.of('/agent').to(`site:${conversation.siteId}`).emit('new_message', { ...message, conversationId });
    io.of('/visitor').to(`conv:${conversationId}`).emit('new_message', message);

    // If this conversation came from email, also send reply via SMTP
    if (conversation.source === 'email') {
      sendAgentEmailReply(conversationId, content, null).catch((err) =>
        console.error('[messages] email reply error:', err.message)
      );
    }

    res.status(201).json(message);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
