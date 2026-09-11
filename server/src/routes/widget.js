const express = require('express');
const prisma = require('../db');
const { getAIResponse } = require('../ai');
const router = express.Router();

// No auth — widget API is public, identified by widgetKey

// Get or create a conversation for a visitor
router.post('/conversation', async (req, res) => {
  try {
    const { siteKey, visitorId, visitorName } = req.body;
    if (!siteKey || !visitorId) return res.status(400).json({ error: 'siteKey and visitorId required' });

    const site = await prisma.site.findUnique({ where: { widgetKey: siteKey } });
    if (!site) return res.status(404).json({ error: 'Invalid site key' });

    let conversation = await prisma.conversation.findFirst({
      where: { siteId: site.id, visitorId, status: { not: 'resolved' } },
      orderBy: { createdAt: 'desc' },
    });

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          siteId: site.id,
          visitorId,
          visitorName: visitorName || 'Visitor',
          status: 'ai_handling',
          lastMessageAt: new Date(),
        },
      });
    }

    res.json({ conversationId: conversation.id, status: conversation.status, siteName: site.name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Visitor sends a message
router.post('/message', async (req, res) => {
  try {
    const { conversationId, siteKey, content } = req.body;
    if (!conversationId || !siteKey || !content) {
      return res.status(400).json({ error: 'conversationId, siteKey, content required' });
    }

    const site = await prisma.site.findUnique({ where: { widgetKey: siteKey } });
    if (!site) return res.status(404).json({ error: 'Invalid site key' });

    const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation || conversation.siteId !== site.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Save visitor message
    const visitorMessage = await prisma.message.create({
      data: { conversationId, sender: 'visitor', content },
    });

    await prisma.conversation.update({
      where: { id: conversationId },
      data: { unreadCount: { increment: 1 }, lastMessageAt: new Date() },
    });

    // Emit to dashboard agents
    const io = req.app.get('io');
    io.of('/agent').to(`site:${site.id}`).emit('new_message', { ...visitorMessage, conversationId });
    io.of('/agent').to(`conv:${conversationId}`).emit('new_message', visitorMessage);

    // AI response if in ai_handling mode
    let aiMessage = null;
    if (conversation.status === 'ai_handling' && site.aiEnabled) {
      try {
        const aiResult = await getAIResponse(conversationId, site.systemPrompt, site.trackerBusinessId);

        // If AI made a tool call, store the tool exchange as hidden messages for context
        if (aiResult.toolCallMeta) {
          const { tool_calls, tool_call_id, tool_result } = aiResult.toolCallMeta;
          // Store AI's tool_call decision (hidden from UI, used for conversation context)
          await prisma.message.create({
            data: {
              conversationId,
              sender: 'ai',
              content: '',
              metadata: { tool_calls, hidden: true },
            },
          });
          // Store tool result (hidden from UI)
          await prisma.message.create({
            data: {
              conversationId,
              sender: 'tool_result',
              content: tool_result,
              metadata: { tool_call_id, hidden: true },
            },
          });
        }

        // Save the visible AI response
        aiMessage = await prisma.message.create({
          data: { conversationId, sender: 'ai', content: aiResult.content },
        });

        await prisma.conversation.update({
          where: { id: conversationId },
          data: { lastMessageAt: new Date() },
        });

        io.of('/agent').to(`conv:${conversationId}`).emit('new_message', aiMessage);
        io.of('/visitor').to(`conv:${conversationId}`).emit('new_message', aiMessage);

        if (aiResult.escalated) {
          const updated = await prisma.conversation.findUnique({ where: { id: conversationId } });
          io.of('/agent').to(`site:${site.id}`).emit('conversation_updated', updated);
          io.of('/agent').to(`conv:${conversationId}`).emit('conversation_updated', updated);
        }
      } catch (aiErr) {
        // Never leave the visitor with a spinning typing indicator and no reply.
        console.error('[widget] AI error:', aiErr.message);
        try {
          aiMessage = await prisma.message.create({
            data: {
              conversationId,
              sender: 'ai',
              content: 'Sorry, that took longer than expected on my end. Could you send that again?',
            },
          });
          io.of('/agent').to(`conv:${conversationId}`).emit('new_message', aiMessage);
          io.of('/visitor').to(`conv:${conversationId}`).emit('new_message', aiMessage);
        } catch (saveErr) {
          console.error('[widget] fallback save failed:', saveErr.message);
        }
      }
    }

    res.status(201).json({ message: visitorMessage, aiResponse: aiMessage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Poll for new messages (widget polls every 2-3 seconds)
router.get('/messages/:conversationId', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { since, siteKey } = req.query;
    if (!siteKey) return res.status(400).json({ error: 'siteKey required' });

    const site = await prisma.site.findUnique({ where: { widgetKey: siteKey } });
    if (!site) return res.status(404).json({ error: 'Invalid site key' });

    const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation || conversation.siteId !== site.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const where = { conversationId };
    if (since) where.createdAt = { gt: new Date(since) };

    const messages = await prisma.message.findMany({
      where,
      orderBy: { createdAt: 'asc' },
    });

    // Filter out all hidden/internal messages — tool calls, tool results, empty AI messages
    const visible = messages.filter((m) => {
      if (m.sender === 'tool_result') return false;
      if (m.metadata?.hidden) return false;
      if (!m.content || m.content.trim() === '') return false;
      return true;
    });

    res.json({ messages: visible, status: conversation.status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save visitor phone to conversation (for cross-device resume)
router.post('/save-phone', async (req, res) => {
  try {
    const { conversationId, siteKey, phone } = req.body;
    if (!conversationId || !siteKey || !phone) {
      return res.status(400).json({ error: 'conversationId, siteKey, phone required' });
    }
    const site = await prisma.site.findUnique({ where: { widgetKey: siteKey } });
    if (!site) return res.status(404).json({ error: 'Invalid site key' });

    const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation || conversation.siteId !== site.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await prisma.conversation.update({
      where: { id: conversationId },
      data: { visitorPhone: phone },
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Resume conversation by phone number
router.post('/resume', async (req, res) => {
  try {
    const { siteKey, phone } = req.body;
    if (!siteKey || !phone) return res.status(400).json({ error: 'siteKey and phone required' });

    const site = await prisma.site.findUnique({ where: { widgetKey: siteKey } });
    if (!site) return res.status(404).json({ error: 'Invalid site key' });

    const conversation = await prisma.conversation.findFirst({
      where: { siteId: site.id, visitorPhone: phone },
      orderBy: { lastMessageAt: 'desc' },
    });

    if (!conversation) return res.json({ found: false });

    const messages = await prisma.message.findMany({
      where: {
        conversationId: conversation.id,
        NOT: [{ sender: 'tool_result' }, { metadata: { path: ['hidden'], equals: true } }],
        content: { not: '' },
      },
      orderBy: { createdAt: 'asc' },
    });

    res.json({ found: true, conversationId: conversation.id, status: conversation.status, messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
