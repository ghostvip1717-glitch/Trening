/**
 * Cloudflare Worker для Telegram-уведомлений (trening-notify)
 *
 * Что делает: принимает POST { chatId, message } от приложения
 * и отправляет сообщение в Telegram с кнопкой «🚀 Открыть приложение»,
 * которая сразу открывает мини-приложение.
 *
 * ─────────────────────────────────────────────────────────────
 * КАК ОБНОВИТЬ WORKER (по шагам):
 * 1. Открой https://dash.cloudflare.com → Workers & Pages → trening-notify
 * 2. Нажми «Edit code» (Редактировать код)
 * 3. Выдели весь старый код (Ctrl+A) и вставь вместо него этот файл
 * 4. Найди строку BOT_TOKEN ниже и вставь туда токен своего бота.
 *    Токен берётся у @BotFather: напиши ему /mybots → выбери бота →
 *    API Token. Выглядит примерно так: 123456789:AAE-xxxxxxxxxxxxxxxxx
 * 5. Нажми «Deploy» (Развернуть) справа сверху
 *
 * ⚠️ Токен вставляй ТОЛЬКО здесь, в редакторе Cloudflare.
 *    НЕ вставляй его в файл на GitHub — там он станет виден всем.
 * ─────────────────────────────────────────────────────────────
 */

// ⬇️ ВСТАВЬ СЮДА ТОКЕН БОТА (в редакторе Cloudflare, не на GitHub!)
const BOT_TOKEN = 'PASTE_YOUR_BOT_TOKEN_HERE';

// Ссылка на приложение для кнопки. startapp открывает мини-приложение прямо в Telegram.
const APP_LINK = 'https://t.me/Abc7417bot?startapp';

export default {
  async fetch(request) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST') return new Response('OK', { headers: cors });

    let data;
    try { data = await request.json(); }
    catch { return new Response('bad json', { status: 400, headers: cors }); }

    const { chatId, message } = data || {};
    if (!chatId || !message) {
      return new Response('chatId and message required', { status: 400, headers: cors });
    }

    const resp = await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        reply_markup: {
          inline_keyboard: [[
            { text: '🚀 Открыть приложение', url: APP_LINK }
          ]]
        }
      })
    });

    const result = await resp.text();
    return new Response(result, { status: resp.status, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
};
