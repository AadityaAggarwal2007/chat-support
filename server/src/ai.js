const OpenAI = require('openai');
const prisma = require('./db');
const { lookupOrder } = require('./tracker-db');

// Every model here was swept against the real system prompt and tool schema on
// 2026-09-05 and cleared the checks that cannot be recovered from: it never
// repeated the customer's city or state back to them, and it refused to look up
// an order from an order number alone. Escalation and tool-result scores vary a
// little between models, which is fine — a missed escalation just means the bot
// asks for the number again and the customer repeats it. DeepSeek V3, the
// incumbent, itself scores 4/5, so 4/5 is the working baseline, not a defect.
const AI_MODELS = {
  'minimax/minimax-m2.7:free': {
    name: 'MiniMax M2.7 (free)',
    inputPrice: 0,
    outputPrice: 0,
    cachedInputPrice: 0,
    cacheSupport: false,
    free: true,
  },
  'mistralai/mistral-nemo': {
    name: 'Mistral Nemo',
    inputPrice: 0.019,
    outputPrice: 0.030,
    cachedInputPrice: 0.019,
    cacheSupport: false,
  },
  'mistralai/ministral-3b-2512': {
    name: 'Ministral 3B',
    inputPrice: 0.10,
    outputPrice: 0.10,
    cachedInputPrice: 0.10,
    cacheSupport: false,
  },
  'openai/gpt-4.1-nano': {
    name: 'GPT-4.1 nano',
    inputPrice: 0.10,
    outputPrice: 0.40,
    cachedInputPrice: 0.10,
    cacheSupport: false,
  },
  'qwen/qwen3-8b': {
    name: 'Qwen3 8B',
    inputPrice: 0.117,
    outputPrice: 0.455,
    cachedInputPrice: 0.117,
    cacheSupport: false,
  },
  'mistralai/ministral-8b-2512': {
    name: 'Ministral 8B',
    inputPrice: 0.15,
    outputPrice: 0.15,
    cachedInputPrice: 0.15,
    cacheSupport: false,
  },
  'deepseek/deepseek-chat': {
    name: 'DeepSeek V3',
    inputPrice: 0.32,
    outputPrice: 0.89,
    cachedInputPrice: 0.014,
    cacheSupport: true,
  },
};

// Cheapest first, DeepSeek V3 last as the safety net. All 117 tool-capable
// OpenRouter models priced under V3 were swept on 2026-09-05; these are the
// survivors, ordered by cost.
//
//   model                    $/1k    escalate   tool result
//   minimax-m2.7:free        free      4/5          3/3
//   mistral-nemo             0.049     4/5          3/3
//   ministral-3b-2512        0.257     5/5          3/3
//   gpt-4.1-nano             0.269     5/5          3/3
//   qwen3-8b                 0.314     5/5          3/3
//   ministral-8b-2512        0.385     5/5          3/3
//   deepseek/deepseek-chat   0.844     4/5          3/3
//
// Excluded on privacy, not price: qwen3-32b ($0.213, 5/5 escalation),
// laguna-xs-2.1 and ling-3.0-flash all repeated the customer's city and state
// back to them despite the prompt forbidding it. A missed escalation is
// recoverable — the bot asks again — but a leaked address cannot be unsent, so
// no discount justifies it.
const FALLBACK_CHAIN = [
  'minimax/minimax-m2.7:free',
  'mistralai/mistral-nemo',
  'mistralai/ministral-3b-2512',
  'openai/gpt-4.1-nano',
  'qwen/qwen3-8b',
  'mistralai/ministral-8b-2512',
  'deepseek/deepseek-chat',
];

// Degrade by default. Almost every failure is specific to one model — a retired
// or mistyped id, a rejected tool schema, a rate limit, a provider outage — and
// the next model in the chain would have served the request fine. Only auth
// failures are hopeless, since every model would fail them the same way. Note
// 402 (out of credits) still degrades: the free tiers keep working without them.
function isRetryable(err) {
  const status = err?.status;
  return status !== 401 && status !== 403;
}

// One round to call a tool, one to react to the result, one spare. Beyond that
// the model is looping rather than converging.
const MAX_TOOL_ROUNDS = 3;

let activeModel = process.env.AI_MODEL || FALLBACK_CHAIN[0];

function attemptOrder() {
  return [activeModel, ...FALLBACK_CHAIN.filter((m) => m !== activeModel)];
}

function getClient() {
  return new OpenAI({
    baseURL: `${process.env.CODEX_URL || 'https://openrouter.ai/api'}/v1`,
    apiKey: process.env.AI_API_KEY || 'codex-local',
  });
}

function getActiveModel() { return activeModel; }
function setActiveModel(model) {
  if (AI_MODELS[model]) activeModel = model;
}
function getModelList() { return AI_MODELS; }
function getChain() { return [...FALLBACK_CHAIN]; }

const DEFAULT_SYSTEM_PROMPT = `You are a warm and helpful customer support assistant. Keep replies short, natural, and conversational — like a real person texting, not a formal email or robot.

IMPORTANT RULES:
- Never use asterisks, bullet points, bold, or any markdown. Plain text only.
- Never write long paragraphs. One or two short sentences max per reply.
- Sound human and caring.
- Never say you are an AI unless directly asked.

When someone mentions their order, delivery, tracking, or any order concern:
1. Ask warmly for just ONE piece of info: "Happy to help! Could you share your name, phone number, or email?"
2. The moment they give you a name, an email, a phone number, or last 4 digits of phone — call lookup_order IMMEDIATELY. Do NOT ask for more info before trying.
3. An order number ALONE is never enough to look up an order. If they give only an order number, warmly ask for one more thing: "Thanks! And could you share the name or email on the order, just to confirm it's yours?" Then call lookup_order with BOTH.
4. If lookup returns nothing, THEN ask for one more thing naturally: "I couldn't find it with that — do you also have the last 4 digits of your phone number?" Try again with the combination.
5. One ask at a time, never multiple at once. Never ask for two things upfront.
6. If a lookup result says needs_verification, do NOT share any order details. Ask for the extra identifier as described above.

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
1. FIRST check whether they have already given a phone number anywhere in the conversation, including in the message you are replying to right now. If they have, call escalate_to_human IMMEDIATELY with that number. Never ask for a number they have already given.
2. Only if you genuinely do not have a phone number yet, ask: "Sure, could you share your phone number so our team can reach out to you?"
3. The moment they give a number, call escalate_to_human with it.
4. After calling escalate_to_human, say: "Thanks! I've saved your details. Our support team will get in touch with you shortly. Is there anything else I can help with?"
5. Do NOT try to process refunds or cancellations yourself. Always escalate.
6. If they refuse to give a phone number, say: "No worries! You can reach our support team at the email on our website. They'll be happy to help with this."
7. If they ask "when will someone call" or similar, say: "Our team usually gets back within a few hours during business hours."
Never promise exact timelines. Never say you'll process the refund yourself.

THINGS YOU DO NOT KNOW — NEVER INVENT THESE:
You only know what a tool returns to you. You have NO information about store policy.
- NEVER say whether Cash on Delivery, prepaid, UPI, or any payment method is offered by the store. You do not know.
- NEVER explain how to place an order, and never try to take an order in chat. The store does not sell through this chat.
- NEVER quote shipping charges, delivery timelines, return windows, refund timelines, discounts, offers, or stock availability.
- NEVER invent a phone number, a courier contact, a delivery agent's name or number, a tracking ID, or a tracking link. Use ONLY the exact values a tool gave you.
- NEVER write a placeholder or example link such as example.com. If a tool gave you no tracking link, do not mention one.
- The payment method you may state is ONLY the "payment" value from a lookup result, and only for that specific order. It describes what that one order already used. It is NOT a statement about what the store offers.

When a customer asks about any of the above:
Say you will get it confirmed, ask for their phone number, and call escalate_to_human.
Example: "Let me get that confirmed for you by our team. Could you share your phone number so they can reach you?"
Never guess. A wrong answer here costs the store a customer.

NEVER output JSON, function names, square brackets, or tool syntax in your reply. The customer sees your words directly. If you need to use a tool, use the tool — do not type it out as text.

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
    description: 'Look up a customer order to get tracking status and order details. Requires at least one personal identifier (name, email, phone, or last 4 digits of phone). An order ID on its own will be rejected — pair it with a personal identifier.',
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

// The API rejects the whole request unless every assistant tool_call is
// answered by a matching tool message. Rows get orphaned when the 30-message
// window slices a pair in half, or when a tool result failed to persist — so
// drop half-pairs rather than let one bad row wedge a conversation forever.
function dropOrphanedToolCalls(msgs) {
  const out = [];

  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];

    if (m.role === 'assistant' && m.tool_calls?.length) {
      const answered = new Set();
      for (let j = i + 1; j < msgs.length && msgs[j].role === 'tool'; j++) {
        answered.add(msgs[j].tool_call_id);
      }
      const kept = m.tool_calls.filter((tc) => answered.has(tc.id));
      if (kept.length) out.push({ ...m, tool_calls: kept });
      else if (m.content) out.push({ role: 'assistant', content: m.content });
      continue;
    }

    if (m.role === 'tool') {
      let matched = false;
      for (let k = out.length - 1; k >= 0; k--) {
        if (out[k].role === 'tool') continue;
        matched = Boolean(out[k].role === 'assistant' && out[k].tool_calls?.some((tc) => tc.id === m.tool_call_id));
        break;
      }
      if (matched) out.push(m);
      continue;
    }

    out.push(m);
  }

  return out;
}

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

  const history = dropOrphanedToolCalls(chatMessages);

  // When a model dies partway through a conversation we retry the whole exchange
  // on the next model, which would otherwise re-run tools that already had side
  // effects — escalating twice, or writing the category again. Results are cached
  // per request so a mid-conversation switch replays them instead.
  const toolCache = new Map();

  const executeTool = async (tc) => {
    const cacheKey = tc.function.name + ':' + (tc.function.arguments || '');
    if (toolCache.has(cacheKey)) return toolCache.get(cacheKey);
    const result = await runTool(tc);
    toolCache.set(cacheKey, result);
    return result;
  };

  const runTool = async (tc) => {
    const name = tc.function.name;
    let args = {};
    try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}

    if (name === 'categorize_conversation') {
      const valid = ['wrong_tracking', 'refund', 'cancellation', 'others'];
      if (valid.includes(args.category)) {
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { category: args.category },
        });
        console.log(`[AI] Categorized conv ${conversationId} as: ${args.category}`);
      }
      return { payload: { success: true }, persist: false };
    }

    if (name === 'escalate_to_human') {
      console.log(`[AI] Escalation for conv ${conversationId}:`, args);
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { status: 'human_needed', visitorPhone: args.phone || null },
      });
      return {
        payload: { success: true, reason: args.reason, phone: args.phone },
        persist: true,
        escalated: true,
      };
    }

    if (name === 'lookup_order') {
      console.log(`[AI] Order lookup for conv ${conversationId}:`, args);
      return { payload: await lookupOrder(args, trackerBusinessId || null), persist: true };
    }

    return { payload: { error: `Unknown tool: ${name}` }, persist: false };
  };

  const runWithModel = async (model) => {
    const messages = [{ role: 'system', content: systemPrompt }, ...history];
    let toolCallMeta = null;
    let escalated = false;
    let nudged = false;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await getClient().chat.completions.create({
        model,
        messages,
        tools: [ORDER_LOOKUP_TOOL, ESCALATE_TOOL, CATEGORIZE_TOOL],
        tool_choice: 'auto',
        max_tokens: 600,
      });

      const message = response.choices[0]?.message;
      const toolCalls = message?.tool_calls || [];

      if (!toolCalls.length) {
        return {
          content: stripMarkdown(message?.content || "I'm here to help! How can I assist you?"),
          toolCallMeta,
          escalated,
        };
      }

      messages.push(message);

      for (const tc of toolCalls) {
        const { payload, persist, escalated: didEscalate } = await executeTool(tc);
        if (didEscalate) escalated = true;
        if (persist) {
          toolCallMeta = {
            tool_calls: toolCalls,
            tool_call_id: tc.id,
            tool_result: JSON.stringify(payload),
          };
        }
        messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(payload) });
      }

      if (!nudged) {
        nudged = true;
        messages.push({
          role: 'user',
          content: 'IMPORTANT: Reply in plain conversational text only. No asterisks, no bullet points, no bold, no JSON. Just talk naturally like a human.',
        });
      }
    }

    // Spent the tool budget — take the tools away and ask plainly for prose.
    const closing = await getClient().chat.completions.create({ model, messages, max_tokens: 600 });
    return {
      content: stripMarkdown(closing.choices[0]?.message?.content || "I'm here to help! How can I assist you?"),
      toolCallMeta,
      escalated,
    };
  };

  let lastErr = null;
  for (const model of attemptOrder()) {
    try {
      const result = await runWithModel(model);
      if (model !== activeModel) console.log(`[AI] Degraded to ${model}`);
      return result;
    } catch (err) {
      lastErr = err;
      console.error(`[AI] ${model} failed:`, err?.status || '', err?.message);
      if (!isRetryable(err)) break;
    }
  }

  // Every model is down. The customer must never see a stack trace, a provider
  // name, or silence, so answer like a busy human and invite them to continue.
  console.error('[AI] Every model failed:', lastErr?.message);
  return {
    content: 'Sorry, that took longer than expected on my end. Could you send that again?',
    toolCallMeta: null,
    allFailed: true,
  };
}

module.exports = { getAIResponse, getActiveModel, setActiveModel, getModelList, getChain, AI_MODELS };
