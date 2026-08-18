const OpenAI = require('openai');
const prisma = require('./db');
const { lookupOrder } = require('./tracker-db');

const client = new OpenAI({
  baseURL: `${process.env.CODEX_URL}/v1`,
  apiKey: 'codex-local',
});

const DEFAULT_SYSTEM_PROMPT = `You are a warm and helpful customer support assistant. Keep replies short, natural, and conversational — like a real person texting, not a formal email or robot.

IMPORTANT RULES:
- Never use asterisks, bullet points, bold, or any markdown. Plain text only.
- Never write long paragraphs. One or two short sentences max per reply.
- Sound human and caring.
- Never say you are an AI unless directly asked.

When someone mentions their order, delivery, tracking, or any order concern:
1. Ask warmly for just ONE piece of info: "Happy to help! Could you share your name, phone number, email, or order number?"
2. The moment they give you ANYTHING — a name alone, an email alone, last 4 digits of phone alone, an order ID — call lookup_order IMMEDIATELY. Do NOT ask for more info before trying.
3. If lookup returns nothing, THEN ask for one more thing naturally: "I couldn't find it with that — do you also have the last 4 digits of your phone number?" Try again with the combination.
4. If still nothing, ask for email or order number. One ask at a time, never multiple at once.
5. Never ask for two things upfront. Always: get one thing → try lookup → ask for another only if needed.

When you find the order:
- ALWAYS share the tracking link, no matter what stage the order is at. Put it on its own line like: "Track your order here: [link]"
- Share: order status, tracking link, estimated delivery, payment method (Prepaid/COD), products ordered, order total.
- NEVER share or mention the customer's address, city, state, or pincode. This is private.
- NEVER say anything is missing, not assigned, not available, or unknown. Skip anything you don't have.
- State the status positively. Example: "Your order is currently being packed and will be on its way soon!"
- Keep it warm and reassuring. End with "Anything else I can help with?"

Order status — say it positively and naturally:
- Order Placed → "We've received your order and it's being prepared!"
- Processing → "Your order is being packed right now!"
- Shipped → "Great news — your order is on its way!"
- Out for Delivery → "Your order is out for delivery today!"
- Delivered → "Your order has been delivered!"

If you truly cannot find the order after trying different info, apologize warmly and ask them to email support.
Never mention what data is missing. Never say "not assigned", "null", "not available", or "no X yet".
Never make up order details.

REFUND / CANCELLATION / COMPLEX ISSUES:
If the customer asks about a refund, cancellation, exchange, return, or anything you cannot resolve yourself:
1. Ask for their phone number: "Sure, could you share your phone number so our team can reach out to you?"
2. Once they give their number, call escalate_to_human with their phone number immediately.
3. After calling escalate_to_human, say: "Thanks! I've saved your details. Our support team will get in touch with you shortly. Is there anything else I can help with?"
4. Do NOT try to process refunds or cancellations yourself. Always escalate.
5. If they refuse to give a phone number, say: "No worries! You can reach our support team at the email on our website. They'll be happy to help with this."
6. If they ask "when will someone call" or similar, say: "Our team usually gets back within a few hours during business hours."
Never promise exact timelines. Never say you'll process the refund yourself.

CONVERSATION CATEGORIZATION:
You MUST call categorize_conversation as soon as you understand what the customer's issue is. Categories:
- "wrong_tracking" — tracking ID is wrong, tracking link not working, tracking shows wrong info, order shows delivered but not received, package went to wrong address
- "refund" — wants refund, money back, return and refund, damaged product and wants money back
- "cancellation" — wants to cancel order, cancel before shipping
- "others" — general queries, order status check, delivery timing, any other topic
Call categorize_conversation ONCE when the issue type becomes clear. Do not wait — categorize early.`;

const ORDER_LOOKUP_TOOL = {
  type: 'function',
  function: {
    name: 'lookup_order',
    description: 'Look up a customer order by order ID, email address, or phone number to get tracking status and order details.',
    parameters: {
      type: 'object',
      properties: {
        order_id: {
          type: 'string',
          description: 'The order ID or order number (e.g. "#1234", "1234"). Include if customer provided it.',
        },
        email: {
          type: 'string',
          description: 'Customer email address if provided.',
        },
        phone: {
          type: 'string',
          description: 'Customer full phone number if provided.',
        },
        phone_last4: {
          type: 'string',
          description: 'Last 4 digits of customer phone number if that is all they provided.',
        },
        name: {
          type: 'string',
          description: 'Customer name if provided. Used together with last 4 digits for lookup.',
        },
      },
    },
  },
};

const ESCALATE_TOOL = {
  type: 'function',
  function: {
    name: 'escalate_to_human',
    description: 'Escalate the conversation to a human agent. Use when the customer wants a refund, cancellation, exchange, return, or has an issue that requires human intervention. Must include the customer phone number.',
    parameters: {
      type: 'object',
      properties: {
        phone: {
          type: 'string',
          description: 'Customer phone number for callback.',
        },
        reason: {
          type: 'string',
          description: 'Brief reason for escalation (e.g. "refund request", "cancellation", "exchange").',
        },
      },
      required: ['phone', 'reason'],
    },
  },
};

const CATEGORIZE_TOOL = {
  type: 'function',
  function: {
    name: 'categorize_conversation',
    description: 'Categorize the conversation based on the customer issue. Call this once when you understand the issue type.',
    parameters: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['wrong_tracking', 'refund', 'cancellation', 'others'],
          description: 'The category of the customer issue.',
        },
      },
      required: ['category'],
    },
  },
};

function stripMarkdown(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')   // bold
    .replace(/\*(.+?)\*/g, '$1')        // italic
    .replace(/^[-*•]\s+/gm, '')         // bullet points
    .replace(/^\d+\.\s+/gm, '')         // numbered lists
    .replace(/^#{1,6}\s+/gm, '')        // headers
    .replace(/`(.+?)`/g, '$1')          // inline code
    .replace(/\[(.+?)\]\((.+?)\)/g, '$1: $2') // links → "text: url"
    .trim();
}

async function getAIResponse(conversationId, siteSystemPrompt, trackerBusinessId) {
  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    take: 30,
  });

  const systemPrompt = siteSystemPrompt || DEFAULT_SYSTEM_PROMPT;

  // Build chat history — include tool results stored in metadata
  const chatMessages = [];
  for (const m of messages) {
    if (m.sender === 'visitor') {
      chatMessages.push({ role: 'user', content: m.content });
    } else if (m.sender === 'ai' || m.sender === 'agent') {
      // Check if this message has a tool call stored in metadata
      const meta = m.metadata;
      if (meta?.tool_calls) {
        chatMessages.push({ role: 'assistant', content: m.content || null, tool_calls: meta.tool_calls });
      } else {
        chatMessages.push({ role: 'assistant', content: m.content });
      }
    } else if (m.sender === 'tool_result') {
      chatMessages.push({
        role: 'tool',
        tool_call_id: m.metadata?.tool_call_id || 'unknown',
        content: m.content,
      });
    }
  }

  try {
    // First AI call — may result in a tool call
    const response = await client.chat.completions.create({
      model: process.env.AI_MODEL || 'gpt-5.6-sol',
      messages: [{ role: 'system', content: systemPrompt }, ...chatMessages],
      tools: [ORDER_LOOKUP_TOOL, ESCALATE_TOOL, CATEGORIZE_TOOL],
      tool_choice: 'auto',
      max_tokens: 600,
    });

    const choice = response.choices[0];

    // ── Tool call ────────────────────────────────────────────────
    if (choice.finish_reason === 'tool_calls' && choice.message?.tool_calls?.length > 0) {
      // Handle categorize_conversation silently (can come alongside other tools)
      const categorizeCalls = choice.message.tool_calls.filter(tc => tc.function.name === 'categorize_conversation');
      for (const cc of categorizeCalls) {
        try {
          const catArgs = JSON.parse(cc.function.arguments || '{}');
          const validCats = ['wrong_tracking', 'refund', 'cancellation', 'others'];
          if (validCats.includes(catArgs.category)) {
            await prisma.conversation.update({
              where: { id: conversationId },
              data: { category: catArgs.category },
            });
            console.log(`[AI] Categorized conv ${conversationId} as: ${catArgs.category}`);
          }
        } catch {}
      }

      // Find the primary tool call (not categorize)
      const primaryCall = choice.message.tool_calls.find(tc => tc.function.name !== 'categorize_conversation');

      // If only categorize was called, do a follow-up to get a text response
      if (!primaryCall) {
        const toolResults = categorizeCalls.map(cc => ({
          role: 'tool',
          tool_call_id: cc.id,
          content: JSON.stringify({ success: true }),
        }));
        const response2 = await client.chat.completions.create({
          model: process.env.AI_MODEL || 'gpt-5.6-sol',
          messages: [
            { role: 'system', content: systemPrompt },
            ...chatMessages,
            choice.message,
            ...toolResults,
          ],
          tools: [ORDER_LOOKUP_TOOL, ESCALATE_TOOL, CATEGORIZE_TOOL],
          tool_choice: 'auto',
          max_tokens: 600,
        });
        const r2choice = response2.choices[0];
        // If second call also has tool calls, handle them recursively-lite
        if (r2choice.finish_reason === 'tool_calls' && r2choice.message?.tool_calls?.length > 0) {
          const tc2 = r2choice.message.tool_calls.find(tc => tc.function.name !== 'categorize_conversation');
          if (tc2) {
            // We got a real tool call on the second pass — fall through to handle it below
            // but for simplicity, just return a friendly message and let the next visitor message trigger the tool
          }
        }
        return {
          content: stripMarkdown(r2choice.message?.content || "I'm here to help! How can I assist you?"),
          toolCallMeta: null,
        };
      }

      const toolCall = primaryCall;
      let args = {};
      try { args = JSON.parse(toolCall.function.arguments || '{}'); } catch {}

      // ── Escalate to human ──
      if (toolCall.function.name === 'escalate_to_human') {
        console.log(`[AI] Escalation for conv ${conversationId}:`, args);

        await prisma.conversation.update({
          where: { id: conversationId },
          data: {
            status: 'human_needed',
            visitorPhone: args.phone || null,
          },
        });

        const escalateResult = { success: true, reason: args.reason, phone: args.phone };

        const catToolResults = categorizeCalls.map(cc => ({
          role: 'tool',
          tool_call_id: cc.id,
          content: JSON.stringify({ success: true }),
        }));
        const response2 = await client.chat.completions.create({
          model: process.env.AI_MODEL || 'gpt-5.6-sol',
          messages: [
            { role: 'system', content: systemPrompt },
            ...chatMessages,
            choice.message,
            ...catToolResults,
            {
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(escalateResult),
            },
            {
              role: 'user',
              content: 'IMPORTANT: Reply in plain conversational text only. No asterisks, no bullet points, no bold, no JSON. Just talk naturally like a human. Confirm that you have saved their details and the team will get in touch shortly.',
            },
          ],
          max_tokens: 600,
        });

        const rawContent = response2.choices[0]?.message?.content || "Thanks! I've saved your details. Our support team will get in touch with you shortly.";
        return {
          content: stripMarkdown(rawContent),
          toolCallMeta: {
            tool_calls: choice.message.tool_calls,
            tool_call_id: toolCall.id,
            tool_result: JSON.stringify(escalateResult),
          },
          escalated: true,
        };
      }

      // ── Order lookup ──
      console.log(`[AI] Order lookup for conv ${conversationId}:`, args);

      const orderResult = await lookupOrder(args, trackerBusinessId || null);

      const catToolResults2 = categorizeCalls.map(cc => ({
        role: 'tool',
        tool_call_id: cc.id,
        content: JSON.stringify({ success: true }),
      }));
      const response2 = await client.chat.completions.create({
        model: process.env.AI_MODEL || 'gpt-5.6-sol',
        messages: [
          { role: 'system', content: systemPrompt },
          ...chatMessages,
          choice.message,
          ...catToolResults2,
          {
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(orderResult),
          },
          {
            role: 'user',
            content: 'IMPORTANT: Reply in plain conversational text only. No asterisks, no bullet points, no bold, no JSON. Just talk naturally like a human.',
          },
        ],
        max_tokens: 600,
      });

      const rawContent = response2.choices[0]?.message?.content || "I found your order details. Let me know if you need anything else!";
      const finalContent = stripMarkdown(rawContent);

      return {
        content: finalContent,
        toolCallMeta: {
          tool_calls: choice.message.tool_calls,
          tool_call_id: toolCall.id,
          tool_result: JSON.stringify(orderResult),
        },
      };
    }

    // ── Regular response ───────────────────────────────────────
    return {
      content: stripMarkdown(choice.message?.content || "I'm here to help! How can I assist you?"),
      toolCallMeta: null,
    };

  } catch (err) {
    console.error('[AI] getAIResponse error:', err.message);
    // Graceful fallback without tools if model doesn't support them
    try {
      const fallback = await client.chat.completions.create({
        model: process.env.AI_MODEL || 'gpt-5.6-sol',
        messages: [{ role: 'system', content: systemPrompt }, ...chatMessages],
        max_tokens: 400,
      });
      return { content: fallback.choices[0]?.message?.content || "I'm here to help!", toolCallMeta: null };
    } catch {
      return { content: "I'm here to help! How can I assist you?", toolCallMeta: null };
    }
  }
}

module.exports = { getAIResponse };
