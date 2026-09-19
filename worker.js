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
      let userText = message?.text?.trim();
      const voiceFileId = message?.voice?.file_id;

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
if (voiceFileId) {
  userText = await transcribeTelegramVoice(
    telegramApi,
    telegramToken,
    openaiKey,
    voiceFileId
  );
}
      const memoryKey = `chat:${userId}`;
      const factsKey = `facts:${userId}`;
const autoMemoryPatterns = [
  /^меня зовут/i,
  /^я живу/i,
  /^моя цель/i,
  /^я работаю/i,
  /^я изучаю/i,
  /^мне нравится/i,
  /^я предпочитаю/i,
  /^обычно я/i,
  /^мой любимый/i,
  /^для меня важно/i,
];

if (
  env.CHAT_MEMORY &&
  userText &&
  !userText.startsWith("/") &&
  autoMemoryPatterns.some((pattern) => pattern.test(userText))
) {
  const savedFacts = await env.CHAT_MEMORY.get(factsKey, "json");
  const facts = Array.isArray(savedFacts) ? savedFacts : [];

  if (!facts.includes(userText)) {
    facts.push(userText);
    await env.CHAT_MEMORY.put(
      factsKey,
      JSON.stringify(facts.slice(-50))
    );
  }
}
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
if (userText?.startsWith("/remember ")) {
  const fact = userText.slice("/remember ".length).trim();

  const savedFacts = env.CHAT_MEMORY
    ? await env.CHAT_MEMORY.get(factsKey, "json")
    : [];

  const facts = Array.isArray(savedFacts) ? savedFacts : [];
  facts.push(fact);

  if (env.CHAT_MEMORY) {
    await env.CHAT_MEMORY.put(
      factsKey,
      JSON.stringify(facts.slice(-50))
    );
  }

  await sendTelegram(
    telegramApi,
    chatId,
    `Запомнил ✅\n${fact}`
  );
  return new Response("ok");
}
            if (userText === "/memory") {
  const savedFacts = env.CHAT_MEMORY
    ? await env.CHAT_MEMORY.get(factsKey, "json")
    : [];

  const facts = Array.isArray(savedFacts) ? savedFacts : [];
  const memoryText = facts.length
    ? `Я помню:\n${facts.map((fact, index) => `${index + 1}. ${fact}`).join("\n")}`
    : "Постоянная память пока пуста.";

  await sendTelegram(
    telegramApi,
    chatId,
    memoryText
  );
  return new Response("ok");
}
if (userText?.startsWith("/forget ")) {
  const factNumber = Number(
    userText.slice("/forget ".length).trim()
  );

  const savedFacts = env.CHAT_MEMORY
    ? await env.CHAT_MEMORY.get(factsKey, "json")
    : [];

  const facts = Array.isArray(savedFacts) ? savedFacts : [];
  const factIndex = factNumber - 1;

  if (
    !Number.isInteger(factNumber) ||
    factIndex < 0 ||
    factIndex >= facts.length
  ) {
    await sendTelegram(
      telegramApi,
      chatId,
      "Укажите номер факта из команды /memory.\nНапример: /forget 3"
    );
    return new Response("ok");
  }

  const [deletedFact] = facts.splice(factIndex, 1);

  if (facts.length) {
    await env.CHAT_MEMORY.put(
      factsKey,
      JSON.stringify(facts)
    );
  } else {
    await env.CHAT_MEMORY.delete(factsKey);
  }

  await sendTelegram(
    telegramApi,
    chatId,
    `Удалено из памяти ✅\n${deletedFact}`
  );
  return new Response("ok");
}
      if (userText === "/forget") {
  if (env.CHAT_MEMORY) {
    await env.CHAT_MEMORY.delete(factsKey);
  }

  await sendTelegram(
    telegramApi,
    chatId,
    "Постоянная память очищена ✅"
  );
  return new Response("ok");
}
  if (userText === "/cancel" || userText?.startsWith("/cancel ")) {
  const reminderNumber = Number(
    userText.slice("/cancel".length).trim()
  );

  const reminderList = await env.CHAT_MEMORY.list({
    prefix: `reminder:${userId}:`,
  });

  const reminders = (
    await Promise.all(
      reminderList.keys.map(async ({ name }) => {
        const reminder = await env.CHAT_MEMORY.get(name, "json");
        return reminder ? { key: name, ...reminder } : null;
      })
    )
  )
    .filter((reminder) => reminder && reminder.dueAt > Date.now())
    .sort((a, b) => a.dueAt - b.dueAt);

  const reminderIndex = reminderNumber - 1;

  if (
    !Number.isInteger(reminderNumber) ||
    reminderIndex < 0 ||
    reminderIndex >= reminders.length
  ) {
    await sendTelegram(
      telegramApi,
      chatId,
      "Укажите номер напоминания из команды /reminders.\nНапример: /cancel 1"
    );

    return new Response("ok");
  }

  const reminder = reminders[reminderIndex];

  await env.CHAT_MEMORY.delete(reminder.key);

  const date = new Date(reminder.dueAt).toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  await sendTelegram(
    telegramApi,
    chatId,
    `Напоминание отменено ✅\n${date}\n${reminder.text}`
  );

  return new Response("ok");
}    
      if (userText === "/reminders") {
  const reminderList = await env.CHAT_MEMORY.list({
    prefix: `reminder:${userId}:`,
  });

  const reminders = (
    await Promise.all(
      reminderList.keys.map(async ({ name }) => {
        const reminder = await env.CHAT_MEMORY.get(name, "json");
        return reminder ? { key: name, ...reminder } : null;
      })
    )
  )
    .filter((reminder) => reminder && reminder.dueAt > Date.now())
    .sort((a, b) => a.dueAt - b.dueAt);

  const remindersText = reminders.length
    ? `Будущие напоминания:\n\n${reminders
        .map((reminder, index) => {
          const date = new Date(reminder.dueAt).toLocaleString("ru-RU", {
            timeZone: "Europe/Moscow",
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          });
const repeatText = reminder.repeat === "weekly" ? " (еженедельно)" : "";
          return `${index + 1}. ${date}${repeatText}\n${reminder.text}`;
        })
        .join("\n\n")}`
    : "Будущих напоминаний пока нет.";

  await sendTelegram(
    telegramApi,
    chatId,
    remindersText
  );

  return new Response("ok");
}
let reminderInput = userText;
let reminderRepeat = null;
      
const relativeReminderMatch = userText?.match(
  /^напомни(?:\s+мне)?\s+через\s+(\d+|час)\s*(минуту|минуты|минут|час|часа|часов)?\s+(.+)$/i
);

if (relativeReminderMatch) {
  const [, amountText, unitText, reminderText] =
    relativeReminderMatch;

  const isHours =
    amountText.toLowerCase() === "час" ||
    unitText?.startsWith("час");

  const amount =
    amountText.toLowerCase() === "час"
      ? 1
      : Number(amountText);

  const delayMs =
    amount * (isHours ? 60 * 60 * 1000 : 60 * 1000);

  const moscowDate = new Date(
    Date.now() + delayMs + 3 * 60 * 60 * 1000
  );

  const dateText = moscowDate
    .toISOString()
    .slice(0, 10);

  const timeText = moscowDate
    .toISOString()
    .slice(11, 16);

  reminderInput =
    `/remind ${dateText} ${timeText} ${reminderText}`;
}
const weeklyReminderMatch = userText?.match(
  /^напоминай(?:\s+мне)?\s+каждый\s+(понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье)\s+в\s+([01]?\d|2[0-3]):([0-5]\d)\s+(.+)$/i
);
let weekdayReminderText = userText;

if (weeklyReminderMatch) {
  const [, weekdayText, hourText, minuteText, reminderText] =
    weeklyReminderMatch;

  weekdayReminderText =
    `Напомни мне в ${weekdayText} в ${hourText}:${minuteText} ${reminderText}`;

  reminderRepeat = "weekly";
}      
const weekdayReminderMatch = weekdayReminderText?.match(
  /^напомни(?:\s+мне)?\s+в\s+(понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье)\s+в\s+([01]?\d|2[0-3]):([0-5]\d)\s+(.+)$/i
);

if (weekdayReminderMatch) {
  const [, weekdayText, hourText, minuteText, reminderText] =
    weekdayReminderMatch;

  const weekdayNumbers = {
    "воскресенье": 0,
    "понедельник": 1,
    "вторник": 2,
    "среду": 3,
    "четверг": 4,
    "пятницу": 5,
    "субботу": 6,
  };

  const moscowDate = new Date(
    Date.now() + 3 * 60 * 60 * 1000
  );

  const targetDay =
    weekdayNumbers[weekdayText.toLowerCase()];

  let daysAhead =
    (targetDay - moscowDate.getUTCDay() + 7) % 7;

  const targetMinutes =
    Number(hourText) * 60 + Number(minuteText);

  const currentMinutes =
    moscowDate.getUTCHours() * 60 +
    moscowDate.getUTCMinutes();

  if (daysAhead === 0 && targetMinutes <= currentMinutes) {
    daysAhead = 7;
  }

  moscowDate.setUTCDate(
    moscowDate.getUTCDate() + daysAhead
  );

  const dateText = [
    moscowDate.getUTCFullYear(),
    String(moscowDate.getUTCMonth() + 1).padStart(2, "0"),
    String(moscowDate.getUTCDate()).padStart(2, "0"),
  ].join("-");

  const timeText =
    `${String(hourText).padStart(2, "0")}:${minuteText}`;

  reminderInput =
    `/remind ${dateText} ${timeText} ${reminderText}`;
}      
const naturalReminderMatch = userText?.match(
  /^напомни(?:\s+мне)?\s+(сегодня|завтра)\s+в\s+(\d{1,2}):(\d{2})\s+(.+)$/i
);

if (naturalReminderMatch) {
  const [, dayWord, hourText, minuteText, reminderText] =
    naturalReminderMatch;

  const moscowDate = new Date(
    Date.now() + 3 * 60 * 60 * 1000
  );

  if (dayWord.toLowerCase() === "завтра") {
    moscowDate.setUTCDate(moscowDate.getUTCDate() + 1);
  }

  const dateText = [
    moscowDate.getUTCFullYear(),
    String(moscowDate.getUTCMonth() + 1).padStart(2, "0"),
    String(moscowDate.getUTCDate()).padStart(2, "0"),
  ].join("-");

  const timeText =
    `${String(hourText).padStart(2, "0")}:${minuteText}`;

  reminderInput =
    `/remind ${dateText} ${timeText} ${reminderText}`;
}
      if (
  !reminderInput?.startsWith("/remind") &&
  /напом|не забуд/i.test(userText)
) {
  try {
    const parsedReminder = await parseReminderWithAI(
      openaiKey,
      userText
    );

    if (parsedReminder.intent === "clarify") {
      await sendTelegram(
        telegramApi,
        chatId,
        parsedReminder.question ||
          "Уточни, пожалуйста, дату или время напоминания."
      );

      return new Response("ok");
    }

    if (
      parsedReminder.intent === "reminder" &&
      parsedReminder.repeat === "weekly"
    ) {
      const weekdays = Array.isArray(parsedReminder.weekdays)
        ? [...new Set(parsedReminder.weekdays)]
        : [];

      const timeMatch =
        parsedReminder.time?.match(/^(\d{2}):(\d{2})$/);

      if (
        !timeMatch ||
        weekdays.length === 0 ||
        !parsedReminder.text
      ) {
        await sendTelegram(
          telegramApi,
          chatId,
          parsedReminder.question ||
            "Уточни дни недели, время и текст напоминания."
        );

        return new Response("ok");
      }

      const hour = Number(timeMatch[1]);
      const minute = Number(timeMatch[2]);

      if (
        hour > 23 ||
        minute > 59
      ) {
        await sendTelegram(
          telegramApi,
          chatId,
          "Укажи правильное время напоминания."
        );

        return new Response("ok");
      }

      const moscowNow = new Date(
        Date.now() + 3 * 60 * 60 * 1000
      );

      const weekdayNames = [
        "воскресенье",
        "понедельник",
        "вторник",
        "среда",
        "четверг",
        "пятница",
        "суббота",
      ];

      const savedDays = [];

      for (const weekday of weekdays) {
        let daysAhead =
          (weekday - moscowNow.getUTCDay() + 7) % 7;

        let dueAt = Date.UTC(
          moscowNow.getUTCFullYear(),
          moscowNow.getUTCMonth(),
          moscowNow.getUTCDate() + daysAhead,
          hour - 3,
          minute
        );

        if (dueAt <= Date.now()) {
          dueAt += 7 * 24 * 60 * 60 * 1000;
        }

        const reminderKey =
          `reminder:${userId}:${dueAt}:${crypto.randomUUID()}`;

        await env.CHAT_MEMORY.put(
          reminderKey,
          JSON.stringify({
            chatId,
            text: parsedReminder.text,
            dueAt,
            repeat: "weekly",
          })
        );

        savedDays.push(weekdayNames[weekday]);
      }

      await sendTelegram(
        telegramApi,
        chatId,
        `Напоминание сохранено ✅\n` +
          `${savedDays.join(", ")} в ${parsedReminder.time} по Москве\n` +
          `${parsedReminder.text}`
      );

      return new Response("ok");
    }

    if (
      parsedReminder.intent === "reminder" &&
      parsedReminder.repeat === "none"
    ) {
      if (
        !parsedReminder.date ||
        !parsedReminder.time ||
        !parsedReminder.text
      ) {
        await sendTelegram(
          telegramApi,
          chatId,
          parsedReminder.question ||
            "Уточни дату, время и текст напоминания."
        );

        return new Response("ok");
      }

      reminderInput =
        `/remind ${parsedReminder.date} ` +
        `${parsedReminder.time} ${parsedReminder.text}`;
    }
  } catch (error) {
    console.error("Reminder AI error:", error);

    await sendTelegram(
      telegramApi,
      chatId,
      "Не получилось разобрать напоминание. Попробуй сформулировать ещё раз."
    );

    return new Response("ok");
  }
}
if (reminderInput?.startsWith("/remind")) {
  const match = reminderInput.match(
          /^\/remind\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+(.+)$/s
        );

        if (!match) {
          await sendTelegram(
            telegramApi,
            chatId,
            "Используйте формат:\n/remind ГГГГ-ММ-ДД ЧЧ:ММ текст\n\nНапример:\n/remind 2026-09-08 19:00 Оплатить кредит"
          );
          return new Response("ok");
        }

        const [, dateText, timeText, reminderText] = match;
        const [year, month, day] = dateText.split("-").map(Number);
        const [hour, minute] = timeText.split(":").map(Number);

        const dateCheck = new Date(
          Date.UTC(year, month - 1, day, hour, minute)
        );

        const validDate =
          dateCheck.getUTCFullYear() === year &&
          dateCheck.getUTCMonth() === month - 1 &&
          dateCheck.getUTCDate() === day &&
          dateCheck.getUTCHours() === hour &&
          dateCheck.getUTCMinutes() === minute;

        const dueAt = Date.UTC(
          year,
          month - 1,
          day,
          hour - 3,
          minute
        );

        if (!validDate || dueAt <= Date.now()) {
          await sendTelegram(
            telegramApi,
            chatId,
            "Укажите правильные будущие дату и время по Москве."
          );
          return new Response("ok");
        }

        const reminderKey =
          `reminder:${userId}:${dueAt}:${crypto.randomUUID()}`;

        await env.CHAT_MEMORY.put(
          reminderKey,
          JSON.stringify({
            chatId,
            text: reminderText,
            dueAt,
            repeat: reminderRepeat,
          })
        );

        await sendTelegram(
          telegramApi,
          chatId,
          `Напоминание сохранено ✅\n${dateText} в ${timeText} по Москве\n${reminderText}`
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

      if (userText === "/help") {
  await sendTelegram(
    telegramApi,
    chatId,
    [
      "🤖 Команды помощника:",
      "",
      "/start — запустить бота",
      "/help — показать команды",
      "/id — показать Telegram ID",
      "/clear — очистить историю диалога",
      "/remember текст — сохранить факт",
      "/memory — показать сохранённые факты",
      "/forget N — удалить факт по номеру",
      "/forget — удалить все факты",
      "/remind YYYY-MM-DD HH:MM текст — создать напоминание",
      "/reminders — показать будущие напоминания",
      "/cancel N — отменить напоминание",
      "",
      "Можно написать обычной фразой:",
      "Напомни мне завтра в 12:00 позвонить",
      "Напомни мне через 30 минут проверить почту",
"Напомни мне в пятницу в 18:00 проверить отчёт",
      "Напоминай мне каждый понедельник в 09:00 отправить отчёт",
    ].join("\n")
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
        const savedFacts = env.CHAT_MEMORY
  ? await env.CHAT_MEMORY.get(factsKey, "json")
  : [];
const facts = Array.isArray(savedFacts) ? savedFacts : [];

        const conversation = [
          ...(facts.length
  ? [{
      role: "developer",
      content: `Постоянные факты о пользователе:\n${facts
        .map((fact) => `• ${fact}`)
        .join("\n")}`,
    }]
  : []),
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
                "Ты личный ИИ-помощник Вячеслава. Отвечай по-русски, понятно, доброжелательно и без лишней воды.  Не используй Markdown. Пиши обычным текстом без решёток и звёздочек.",
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

    if (!telegramToken) return;

    const telegramApi =
      `https://api.telegram.org/bot${telegramToken}`;

    if (event.cron === "0 19 * * *" && chatId) {
  const moscowDate = new Date(
    event.scheduledTime + 3 * 60 * 60 * 1000
  )
    .toISOString()
    .slice(0, 10);

  const dailyReminderKey =
    `daily-automation-reminder:${moscowDate}`;

  ctx.waitUntil(
    (async () => {
      const alreadySent =
        await env.CHAT_MEMORY.get(dailyReminderKey);

      if (alreadySent) return;

      await env.CHAT_MEMORY.put(
        dailyReminderKey,
        "sent",
        { expirationTtl: 172800 }
      );

      await sendTelegram(
        telegramApi,
        chatId,
        "🔔 Уже 22:00 — время заниматься автоматизацией!"
      );
    })()
  );

  return;
}

    if (event.cron === "*/5 * * * *") {
      ctx.waitUntil(processDueReminders(env, telegramApi));
    }
  },
};
async function processDueReminders(env, telegramApi) {
  if (!env.CHAT_MEMORY) return;

  let cursor;

  do {
    const page = await env.CHAT_MEMORY.list({
      prefix: "reminder:",
      cursor,
    });

    for (const key of page.keys) {
      const reminder = await env.CHAT_MEMORY.get(
        key.name,
        "json"
      );

      if (!reminder || reminder.dueAt > Date.now()) {
        continue;
      }

      const response = await sendTelegram(
        telegramApi,
        reminder.chatId,
        `🔔 Напоминание\n${reminder.text}`
      );
        if (response.ok) {
  if (reminder.repeat === "weekly") {
    const weekMs = 7 * 24 * 60 * 60 * 1000;

    do {
      reminder.dueAt += weekMs;
    } while (reminder.dueAt <= Date.now());

    await env.CHAT_MEMORY.put(
      key.name,
      JSON.stringify(reminder)
    );
  } else {
    await env.CHAT_MEMORY.delete(key.name);
  }
}
    }

    cursor = page.list_complete
      ? undefined
      : page.cursor;
  } while (cursor);
}
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
async function transcribeTelegramVoice(
  telegramApi,
  telegramToken,
  openaiKey,
  voiceFileId
) {
  if (!openaiKey) {
    throw new Error("Missing OPENAI_API_KEY");
  }

  const fileInfoResponse = await fetch(
    `${telegramApi}/getFile?file_id=${encodeURIComponent(voiceFileId)}`
  );
  const fileInfo = await fileInfoResponse.json();

  if (!fileInfoResponse.ok || !fileInfo.ok || !fileInfo.result?.file_path) {
    throw new Error("Telegram getFile failed");
  }

  const audioResponse = await fetch(
    `https://api.telegram.org/file/bot${telegramToken}/${fileInfo.result.file_path}`
  );

  if (!audioResponse.ok) {
    throw new Error("Telegram audio download failed");
  }

  const audioBlob = await audioResponse.blob();
  const formData = new FormData();

  formData.append("model", "gpt-4o-mini-transcribe");
  formData.append("language", "ru");
  formData.append("file", audioBlob, "voice.ogg");

  const transcriptionResponse = await fetch(
    "https://api.openai.com/v1/audio/transcriptions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
      },
      body: formData,
    }
  );

  const transcription = await transcriptionResponse.json();

  if (!transcriptionResponse.ok || !transcription.text?.trim()) {
    throw new Error(
      transcription.error?.message || "OpenAI transcription failed"
    );
  }

  return transcription.text.trim();
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


async function parseReminderWithAI(openaiKey, userText) {
  const moscowNow = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date());

  const response = await fetch(
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
          `Разбери русскую фразу как напоминание. ` +
          `Текущее московское время: ${moscowNow}. ` +
          `Воскресенье — 0, понедельник — 1, вторник — 2, ` +
          `среда — 3, четверг — 4, пятница — 5, суббота — 6. ` +
          `Для неоднозначной фразы выбери intent clarify и задай короткий вопрос. ` +
          `Не придумывай отсутствующие дату или время.`,
        input: userText,
        max_output_tokens: 500,
        text: {
          format: {
            type: "json_schema",
            name: "reminder_parser",
            strict: true,
            schema: {
              type: "object",
              properties: {
                intent: {
                  type: "string",
                  enum: ["reminder", "clarify", "not_reminder"],
                },
                repeat: {
                  type: "string",
                  enum: ["none", "weekly"],
                },
                date: {
                  type: "string",
                  description:
                    "Дата YYYY-MM-DD для разового напоминания или пустая строка",
                },
                time: {
                  type: "string",
                  description: "Время HH:MM или пустая строка",
                },
                weekdays: {
                  type: "array",
                  items: {
                    type: "integer",
                    enum: [0, 1, 2, 3, 4, 5, 6],
                  },
                },
                text: {
                  type: "string",
                  description: "Что именно нужно напомнить",
                },
                question: {
                  type: "string",
                  description:
                    "Уточняющий вопрос или пустая строка",
                },
              },
              required: [
                "intent",
                "repeat",
                "date",
                "time",
                "weekdays",
                "text",
                "question",
              ],
              additionalProperties: false,
            },
          },
        },
      }),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.error?.message || "Reminder AI parsing failed"
    );
  }

  const outputText = data.output
    ?.flatMap((item) => item.content || [])
    .find((item) => item.type === "output_text")
    ?.text;

  if (!outputText) {
    throw new Error("Reminder AI returned no text");
  }

  return JSON.parse(outputText);
}
