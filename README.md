# My AI Assistant Telegram Bot

Личный Telegram ИИ-помощник, работающий на Cloudflare Workers и использующий OpenAI API для генерации ответов.

## Возможности

* Общение с ИИ на русском языке
* Команда `/start` для запуска бота
* Команда `/id` для получения Telegram ID
* Команда `/remind` для проверки уведомлений
* Автоматические напоминания по расписанию
* Ограничение доступа по Telegram ID
* Проверка секретного токена Webhook
* Отображение статуса «печатает…» во время генерации ответа

## Технологии

* JavaScript
* Cloudflare Workers
* Cloudflare Cron Triggers
* Telegram Bot API
* OpenAI Responses API
* GitHub

## Ссылки

* Telegram-бот: [@Myaiasistant12_bot](https://t.me/Myaiasistant12_bot)
* Cloudflare Worker: [myaiassistant12-bot.solo032592.workers.dev](https://myaiassistant12-bot.solo032592.workers.dev)

## Переменные окружения

Для работы проекта в Cloudflare необходимо создать следующие секреты:

```text
TELEGRAM_BOT_TOKEN
OPENAI_API_KEY
ALLOWED_USER_ID
WEBHOOK_SECRET
```

Секретные значения не должны добавляться в код или публиковаться в GitHub.

## Автоматические уведомления

Cloudflare Cron Trigger запускает обработчик `scheduled()` каждый день по расписанию:

```text
0 19 * * *
```

Это соответствует 22:00 по московскому времени.

## Безопасность

Доступ к боту ограничивается переменной `ALLOWED_USER_ID`. Токены Telegram и OpenAI хранятся в секретах Cloudflare и отсутствуют в публичном репозитории.

## Статус проекта

Рабочая версия развёрнута в Cloudflare Workers. Telegram Webhook и автоматические уведомления подключены.

## Автор

Вячеслав Соломатин — начинающий разработчик решений на основе ИИ и автоматизации.

## Лицензия

Проект распространяется по лицензии MIT.

