export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const telegramToken = env.TELEGRAM_BOT_TOKEN;
    const openaiKey = env.OPENAI_API_KEY;

    if (!telegramToken) {
      return new Response("Missing TELEGRAM_BOT_TOKEN", { status: 500 });
    }

    const telegramApi = `https://api.telegram.org/bot${telegramToken}`;

    if (request.method === "GET" && url.pathname === "/") {
      return new Response("Telegram AI Worker is running");
    }

    if (request.method === "GET" && url.pathname === "/setup") {
      const webhookData = {
        url: `${url.origin}/telegram`,
        drop_pending_updates: true,
      };

      if (env.WEBHOOK_SECRET) {
        webhookData.secret_token = env.WEBHOOK_SECRET;
      }

      const setup = await (
        await fetch(`${telegramApi}/setWebhook`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(webhookData),
        })
      ).json();

      const bot = await (await fetch(`${telegramApi}/getMe`)).json();
      const webhook = await (
        await fetch(`${telegramApi}/getWebhookInfo`)
      ).json();

      return Response.json({ setup, bot, webhook });
    }

    if (request.method === "POST" && url.pathname === "/telegram") {
      if (
        env.WEBHOOK_SECRET &&
        request.headers.get("X-Telegram-Bot-Api-Secret-Token") !==
          env.WEBHOOK_SECRET
      ) {
        return new Response("Forbidden", { status: 403 });
      }

      const update = await request.json();
      const message = update.message;
      const chatId = message?.chat?.id;
      const userId = message?.from?.id;
      const userText = message?.text?.trim();

      if (!chatId) return new Response("ok");

      if (userText === "/id") {
        await sendTelegram(
          telegramApi,
          chatId,
          `Ваш Telegram ID: ${userId}`
        );
        return new Response("ok");
      }

      const allowedUserId = env.ALLOWED_USER_ID?.trim();

      if (allowedUserId && String(userId) !== allowedUserId) {
        await sendTelegram(
          telegramApi,
          chatId,
          "Доступ к этому боту закрыт."
        );
        return new Response("ok");
      }

      const memoryKey = `chat:${userId}`;

      if (userText === "/clear") {
        if (env.CHAT_MEMORY) {
          await env.CHAT_MEMORY.delete(memoryKey);
        }

        await sendTelegram(
          telegramApi,
          chatId,
          "Память диалога очищена ✅"
        );
        return new Response("ok");
      }

      if (userText === "/remind") {
        await sendTelegram(
          telegramApi,
          chatId,
          "🔔 Тестовое напоминание: пора заниматься автоматизацией!"
        );
        return new Response("ok");
      }

      if (userText === "/start") {
        await sendTelegram(
          telegramApi,
          chatId,
          "Привет, Вячеслав! Я твой личный ИИ-помощник ✅"
        );
        return new Response("ok");
      }

      if (!userText) {
        await sendTelegram(
          telegramApi,
          chatId,
          "Пока я умею работать только с текстовыми сообщениями."
        );
        return new Response("ok");
      }

      if (!openaiKey) {
        await sendTelegram(
          telegramApi,
          chatId,
          "Ошибка: OPENAI_API_KEY не подключён."
        );
        return new Response("ok");
      }

      try {
        await sendChatAction(telegramApi, chatId);

        const history = await loadMemory(env, memoryKey);

        const conversation = [
          ...history,
          {
            role: "user",
            content: userText,
          },
        ];

        const openaiResponse = await fetch(
          "https://api.openai.com/v1/responses",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${openaiKey}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model: "gpt-5.6-luna",
              instructions:
                "Ты личный ИИ-помощник Вячеслава. Отвечай по-русски, понятно, доброжелательно и без лишней воды.",
              input: conversation,
              max_output_tokens: 700,
            }),
          }
        );

        const data = await openaiResponse.json();

        if (!openaiResponse.ok) {
          console.log("OpenAI error:", JSON.stringify(data));
          await sendTelegram(
            telegramApi,
            chatId,
            "OpenAI пока не ответил. Проверьте баланс API."
          );
          return new Response("ok");
        }

        const answer =
          data.output
            ?.flatMap((item) => item.content || [])
            .find((part) => part.type === "output_text")?.text ||
          "Не удалось получить ответ.";

        await saveMemory(env, memoryKey, [
          ...conversation,
          {
            role: "assistant",
            content: answer,
          },
        ]);

        await sendTelegram(telegramApi, chatId, answer.slice(0, 4000));
        return new Response("ok");
      } catch (error) {
        console.log("Worker error:", error.message);
        await sendTelegram(
          telegramApi,
          chatId,
          "Произошла техническая ошибка. Попробуйте ещё раз."
        );
        return new Response("ok");
      }
    }

    return new Response("Not found", { status: 404 });
  },

  async scheduled(event, env, ctx) {
    const telegramToken = env.TELEGRAM_BOT_TOKEN;
    const chatId = env.ALLOWED_USER_ID?.trim();

    if (!telegramToken || !chatId) return;

    const telegramApi = `https://api.telegram.org/bot${telegramToken}`;

    ctx.waitUntil(
      sendTelegram(
        telegramApi,
        chatId,
        "🔔 Уже 22:00 — время заниматься автоматизацией!"
      )
    );
  },
};

async function loadMemory(env, memoryKey) {
  if (!env.CHAT_MEMORY) return [];

  try {
    const history = await env.CHAT_MEMORY.get(memoryKey, "json");
    return Array.isArray(history) ? history : [];
  } catch (error) {
    console.log("Memory read error:", error.message);
    return [];
  }
}

async function saveMemory(env, memoryKey, conversation) {
  if (!env.CHAT_MEMORY) return;

  try {
    const recentMessages = conversation.slice(-12);

    await env.CHAT_MEMORY.put(
      memoryKey,
      JSON.stringify(recentMessages),
      {
        expirationTtl: 60 * 60 * 24 * 30,
      }
    );
  } catch (error) {
    console.log("Memory write error:", error.message);
  }
}

async function sendTelegram(api, chatId, text) {
  return fetch(`${api}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

async function sendChatAction(api, chatId) {
  return fetch(`${api}/sendChatAction`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      action: "typing",
    }),
  });
}
