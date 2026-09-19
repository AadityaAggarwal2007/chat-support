const { ImapFlow } = require('imapflow');
const nodemailer = require('nodemailer');
const { simpleParser } = require('mailparser');
const prisma = require('./db');
const { getAIResponse } = require('./ai');

const POLL_INTERVAL = 60_000;

// ── HTML email template ────────────────────────────────────────────────────
function buildEmailHtml(text, storeName) {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #f0f4f8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 32px 16px; }
    .wrap { max-width: 580px; margin: 0 auto; }
    .header { background: #2563eb; border-radius: 12px 12px 0 0; padding: 20px 24px; display: flex; align-items: center; gap: 12px; }
    .header-icon { width: 36px; height: 36px; background: rgba(255,255,255,0.2); border-radius: 8px; display: flex; align-items: center; justify-content: center; }
    .header-icon svg { width: 20px; height: 20px; fill: white; }
    .header-title { color: white; font-size: 16px; font-weight: 600; }
    .header-sub { color: rgba(255,255,255,0.75); font-size: 12px; margin-top: 2px; }
    .body { background: white; padding: 28px 24px; }
    .message-wrap { background: #f0f4f8; border-radius: 12px; padding: 16px 18px; }
    .message-label { font-size: 11px; font-weight: 600; color: #2563eb; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
    .message-text { font-size: 15px; color: #1a1a2e; line-height: 1.65; }
    .footer { background: #f8fafc; border-radius: 0 0 12px 12px; padding: 16px 24px; border-top: 1px solid #e8edf2; }
    .footer-text { font-size: 12px; color: #94a3b8; line-height: 1.5; }
    .footer-reply { font-size: 12px; color: #2563eb; margin-top: 4px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <div class="header-icon">
        <svg viewBox="0 0 24 24"><path d="M20 2H4C2.9 2 2 2.9 2 4v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>
      </div>
      <div>
        <div class="header-title">${storeName} Support</div>
        <div class="header-sub">Customer support reply</div>
      </div>
    </div>
    <div class="body">
      <div class="message-wrap">
        <div class="message-label">Support Team</div>
        <div class="message-text">${escaped}</div>
      </div>
    </div>
    <div class="footer">
      <div class="footer-text">This message was sent by ${storeName} support.</div>
      <div class="footer-reply">Simply reply to this email to continue the conversation.</div>
    </div>
  </div>
</body>
</html>`;
}

// ── Strip quoted replies (everything after "On ... wrote:" or "--Original--") ──
function stripQuotedReply(text) {
  if (!text) return '';
  const patterns = [
    /^On .+ wrote:[\s\S]*/m,
    /^-{3,}.*original.*-{3,}[\s\S]*/im,
    /^_{3,}[\s\S]*/m,
    /^>+\s.*/m,
  ];
  let result = text;
  for (const p of patterns) {
    const match = result.match(p);
    if (match) result = result.slice(0, match.index).trim();
  }
  return result.trim();
}

// ── Send via Gmail SMTP ────────────────────────────────────────────────────
async function sendEmailReply({ fromEmail, appPassword, toEmail, subject, htmlBody, textBody, replyToMessageId, references }) {
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { user: fromEmail, pass: appPassword },
    tls: { rejectUnauthorized: false },
  });

  const replySubject = subject && !subject.startsWith('Re:') ? `Re: ${subject}` : (subject || 'Re: Your enquiry');
  const headers = {};
  if (replyToMessageId) {
    headers['In-Reply-To'] = replyToMessageId;
    headers['References'] = references ? `${references} ${replyToMessageId}` : replyToMessageId;
  }

  await transporter.sendMail({
    from: `"Support" <${fromEmail}>`,
    to: toEmail,
    subject: replySubject,
    html: htmlBody,
    text: textBody,
    headers,
  });
}

// ── Poll a single email account via IMAP ──────────────────────────────────
async function pollEmailAccount(siteEmail, site, io) {
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: siteEmail.email, pass: siteEmail.appPassword },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    let maxUid = siteEmail.lastUid || 0;

    try {
      const searchFrom = maxUid + 1;
      const uids = await client.search({ uid: `${searchFrom}:*` });
      if (!uids || uids.length === 0) return;

      for await (const msg of client.fetch(uids, { uid: true, source: true })) {
        if (msg.uid <= siteEmail.lastUid) continue;
        maxUid = Math.max(maxUid, msg.uid);

        let parsed;
        try {
          parsed = await simpleParser(msg.source);
        } catch { continue; }

        const fromAddr = parsed.from?.value?.[0]?.address?.toLowerCase() || '';
        const fromName = parsed.from?.value?.[0]?.name || fromAddr;

        // Skip emails sent by this account (avoid reply loops)
        if (fromAddr === siteEmail.email.toLowerCase()) continue;

        const subject = parsed.subject || '(no subject)';
        const messageId = parsed.messageId || '';
        const inReplyTo = parsed.inReplyTo || '';
        const references = (parsed.references || []).join(' ');
        const rawText = parsed.text || '';
        const cleanText = stripQuotedReply(rawText) || rawText.slice(0, 2000);

        // Find existing conversation via thread headers or prior messageId
        let conversation = null;

        if (inReplyTo) {
          const prevMsg = await prisma.message.findFirst({
            where: { emailMessageId: inReplyTo },
            select: { conversationId: true },
          });
          if (prevMsg) {
            conversation = await prisma.conversation.findUnique({ where: { id: prevMsg.conversationId } });
          }
        }

        if (!conversation && references) {
          const refIds = references.split(/\s+/);
          for (const ref of refIds.reverse()) {
            const prevMsg = await prisma.message.findFirst({
              where: { emailMessageId: ref },
              select: { conversationId: true },
            });
            if (prevMsg) {
              conversation = await prisma.conversation.findUnique({ where: { id: prevMsg.conversationId } });
              break;
            }
          }
        }

        if (!conversation) {
          conversation = await prisma.conversation.create({
            data: {
              siteId: site.id,
              visitorId: `email:${fromAddr}`,
              visitorName: fromName,
              status: site.aiEnabled ? 'ai_handling' : 'agent_handling',
              source: 'email',
              emailThreadId: messageId,
              lastMessageAt: new Date(),
            },
          });
        }

        // Store incoming email as visitor message
        const visitorMsg = await prisma.message.create({
          data: {
            conversationId: conversation.id,
            sender: 'visitor',
            content: cleanText,
            emailMessageId: messageId,
            metadata: { source: 'email', subject, fromEmail: fromAddr, fromName },
          },
        });

        await prisma.conversation.update({
          where: { id: conversation.id },
          data: { unreadCount: { increment: 1 }, lastMessageAt: new Date() },
        });

        // Emit to dashboard
        if (io) {
          io.of('/agent').to(`site:${site.id}`).emit('new_message', { ...visitorMsg, conversationId: conversation.id });
          io.of('/agent').to(`conv:${conversation.id}`).emit('new_message', visitorMsg);
        }

        // ── AI auto-reply ──────────────────────────────────────────────
        // Routine questions (order status, tracking) are answered and sent.
        // Anything the AI escalates, and anything it could not answer at all,
        // is held back: the draft stays in the thread for an agent and the
        // customer hears nothing rather than being told something unverified.
        if (site.aiEnabled && conversation.status === 'ai_handling') {
          try {
            const aiResult = await getAIResponse(conversation.id, site.systemPrompt, site.trackerBusinessId);

            // The same hidden tool context the chat path stores. Without it the
            // next email in this thread rebuilds the history with no record of
            // the order already looked up, so the AI asks for the phone number
            // again and the customer repeats themselves.
            if (aiResult.toolCallMeta) {
              const { tool_calls, tool_call_id, tool_result } = aiResult.toolCallMeta;
              await prisma.message.create({
                data: {
                  conversationId: conversation.id,
                  sender: 'ai',
                  content: '',
                  metadata: { tool_calls, hidden: true },
                },
              });
              await prisma.message.create({
                data: {
                  conversationId: conversation.id,
                  sender: 'tool_result',
                  content: tool_result,
                  metadata: { tool_call_id, hidden: true },
                },
              });
            }

            // Every model was down, so there is no answer to send. The filler
            // getAIResponse returns ("could you send that again?") reads as
            // nonsense in an email the customer wrote once, so it is not sent
            // and not stored — the thread goes to a human instead.
            if (aiResult.allFailed) {
              await prisma.conversation.update({
                where: { id: conversation.id },
                data: { status: 'human_needed', lastMessageAt: new Date() },
              });
              const flagged = await prisma.conversation.findUnique({ where: { id: conversation.id } });
              if (io) {
                io.of('/agent').to(`site:${site.id}`).emit('conversation_updated', flagged);
                io.of('/agent').to(`conv:${conversation.id}`).emit('conversation_updated', flagged);
              }
              console.warn(`[email] No model available — held ${fromAddr} for a human ("${site.name}")`);
              continue;
            }

            // escalate_to_human has already moved the conversation to
            // human_needed; the reply is kept as an unsent draft.
            const held = Boolean(aiResult.escalated);

            // Stored as not-yet-emailed and flipped once SMTP confirms. A
            // message that claims it was sent when the send threw would leave
            // the thread looking answered while the customer got nothing.
            const aiMsg = await prisma.message.create({
              data: {
                conversationId: conversation.id,
                sender: 'ai',
                content: aiResult.content,
                metadata: held
                  ? { emailed: false, withheld: 'escalated' }
                  : { emailed: false, withheld: 'sending' },
              },
            });

            await prisma.conversation.update({
              where: { id: conversation.id },
              data: { lastMessageAt: new Date() },
            });

            if (io) {
              io.of('/agent').to(`conv:${conversation.id}`).emit('new_message', aiMsg);
            }

            if (held) {
              // escalate_to_human sets this too, but it is set again here so a
              // model that reports an escalation the tool never persisted still
              // leaves a flagged thread rather than a silently dropped refund.
              await prisma.conversation.update({
                where: { id: conversation.id },
                data: { status: 'human_needed' },
              });
              // Surface the flag in the inbox straight away — the customer is
              // waiting on a person, not on us.
              const flagged = await prisma.conversation.findUnique({ where: { id: conversation.id } });
              if (io) {
                io.of('/agent').to(`site:${site.id}`).emit('conversation_updated', flagged);
                io.of('/agent').to(`conv:${conversation.id}`).emit('conversation_updated', flagged);
              }
              console.log(`[email] Escalated ${fromAddr} for site "${site.name}" — reply held, not sent`);
              continue;
            }

            // Send via SMTP
            try {
              const html = buildEmailHtml(aiResult.content, site.name);
              await sendEmailReply({
                fromEmail: siteEmail.email,
                appPassword: siteEmail.appPassword,
                toEmail: fromAddr,
                subject,
                htmlBody: html,
                textBody: aiResult.content,
                replyToMessageId: messageId,
                references,
              });

              await prisma.message.update({
                where: { id: aiMsg.id },
                data: { metadata: { emailed: true } },
              });
              console.log(`[email] Auto-replied to ${fromAddr} for site "${site.name}"`);
            } catch (sendErr) {
              // The answer exists but never left the building, so the thread
              // must not look answered. Hand it to a human with the draft intact.
              await prisma.message.update({
                where: { id: aiMsg.id },
                data: { metadata: { emailed: false, withheld: 'send_failed' } },
              });
              await prisma.conversation.update({
                where: { id: conversation.id },
                data: { status: 'human_needed' },
              });
              const flagged = await prisma.conversation.findUnique({ where: { id: conversation.id } });
              if (io) {
                io.of('/agent').to(`site:${site.id}`).emit('conversation_updated', flagged);
                io.of('/agent').to(`conv:${conversation.id}`).emit('conversation_updated', flagged);
              }
              console.error(`[email] SMTP failed for ${fromAddr} ("${site.name}"):`, sendErr.message);
            }
          } catch (aiErr) {
            console.error('[email] AI error:', aiErr.message);
          }
        }
      }
    } finally {
      lock.release();
    }

    if (maxUid > (siteEmail.lastUid || 0)) {
      await prisma.siteEmail.update({
        where: { id: siteEmail.id },
        data: { lastUid: maxUid },
      });
    }

    await client.logout();
  } catch (err) {
    console.error(`[email] IMAP error for ${siteEmail.email}:`, err.message);
    try { await client.logout(); } catch {}
  }
}

// ── Start the global poller ────────────────────────────────────────────────
async function startEmailPoller(io) {
  async function runPoll() {
    try {
      const accounts = await prisma.siteEmail.findMany({ include: { site: true } });
      for (const account of accounts) {
        await pollEmailAccount(account, account.site, io);
      }
    } catch (err) {
      console.error('[email] Poll cycle error:', err.message);
    }
  }

  setTimeout(runPoll, 8000); // first poll 8s after boot
  setInterval(runPoll, POLL_INTERVAL);
  console.log('[email] Email poller started — checking every 60s');
}

// ── Send an agent reply from inbox ────────────────────────────────────────
async function sendAgentEmailReply(conversationId, content, senderEmail) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { site: { include: { emailAccounts: true } }, messages: { take: 1, orderBy: { createdAt: 'asc' } } },
  });
  if (!conversation || conversation.source !== 'email') return;

  const visitorEmail = conversation.visitorId.replace('email:', '');
  const firstMsg = conversation.messages[0];
  const subject = firstMsg?.metadata?.subject || 'Your enquiry';
  const lastMsgId = conversation.emailThreadId;

  // Use the configured email account for this site
  const emailAccount = conversation.site.emailAccounts.find(a => a.email === senderEmail)
    || conversation.site.emailAccounts[0];

  if (!emailAccount) {
    console.warn('[email] No email account configured for site', conversation.site.name);
    return;
  }

  const html = buildEmailHtml(content, conversation.site.name);
  await sendEmailReply({
    fromEmail: emailAccount.email,
    appPassword: emailAccount.appPassword,
    toEmail: visitorEmail,
    subject,
    htmlBody: html,
    textBody: content,
    replyToMessageId: lastMsgId,
    references: lastMsgId,
  });
}

module.exports = { startEmailPoller, sendAgentEmailReply, buildEmailHtml };
