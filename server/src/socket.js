const jwt = require('jsonwebtoken');
const prisma = require('./db');

function setupSocket(io) {
  // Dashboard agents connect to this namespace
  const agentNs = io.of('/agent');

  agentNs.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Unauthorized'));
    try {
      jwt.verify(token, process.env.JWT_SECRET);
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  agentNs.on('connection', (socket) => {
    console.log('[Socket] Agent connected:', socket.id);

    // Agent joins site rooms they want to monitor
    socket.on('join_site', (siteId) => {
      socket.join(`site:${siteId}`);
    });

    socket.on('join_conversation', (conversationId) => {
      socket.join(`conv:${conversationId}`);
    });

    // Agent sends a message to a visitor
    socket.on('agent_message', async ({ conversationId, content }) => {
      try {
        const message = await prisma.message.create({
          data: { conversationId, sender: 'agent', content },
        });

        await prisma.conversation.update({
          where: { id: conversationId },
          data: {
            status: 'agent_handling',
            lastMessageAt: new Date(),
          },
        });

        // Broadcast to all dashboard agents watching this conversation
        agentNs.to(`conv:${conversationId}`).emit('new_message', message);

        // Also emit to the visitor namespace so the widget can poll or receive it
        io.of('/visitor').to(`conv:${conversationId}`).emit('new_message', message);
      } catch (err) {
        console.error('[Socket] agent_message error:', err);
      }
    });

    // Agent takes over a conversation (stops AI)
    socket.on('take_over', async ({ conversationId }) => {
      try {
        const updated = await prisma.conversation.update({
          where: { id: conversationId },
          data: { status: 'agent_handling' },
        });
        agentNs.to(`conv:${conversationId}`).emit('conversation_updated', updated);
      } catch (err) {
        console.error('[Socket] take_over error:', err);
      }
    });

    // Agent hands back to AI
    socket.on('hand_to_ai', async ({ conversationId }) => {
      try {
        const updated = await prisma.conversation.update({
          where: { id: conversationId },
          data: { status: 'ai_handling' },
        });
        agentNs.to(`conv:${conversationId}`).emit('conversation_updated', updated);
      } catch (err) {
        console.error('[Socket] hand_to_ai error:', err);
      }
    });

    // Agent resolves conversation
    socket.on('resolve', async ({ conversationId }) => {
      try {
        const updated = await prisma.conversation.update({
          where: { id: conversationId },
          data: { status: 'resolved', unreadCount: 0 },
        });
        agentNs.to(`conv:${conversationId}`).emit('conversation_updated', updated);
      } catch (err) {
        console.error('[Socket] resolve error:', err);
      }
    });

    socket.on('disconnect', () => {
      console.log('[Socket] Agent disconnected:', socket.id);
    });
  });

  // Visitor namespace (used to push messages to widget in real-time as a bonus)
  const visitorNs = io.of('/visitor');
  visitorNs.on('connection', (socket) => {
    const convId = socket.handshake.query?.conversationId;
    if (convId) socket.join(`conv:${convId}`);
  });

  return { agentNs };
}

module.exports = { setupSocket };
