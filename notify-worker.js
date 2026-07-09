/**
 * Cloudflare Worker для Telegram-уведомлений (trening-notify)
 *
 * Что делает: принимает POST { chatId, message } от приложения
 * и отправляет сообщение в Telegram с кнопкой «🚀 Открыть приложение»,
 * которая сразу открывает мини-приложение.
 *
 * КАК ОБНОВИТЬ WORKER:
 * 1. Открой https://dash.cloudflare.com → Workers & Pages → trening-notify
 * 2. Нажми «Edit code» и замени весь код на этот файл
 * 3. Токен бота: либо в Settings → Variables добавь переменную BOT_TOKEN,
 *    либо впиши токен прямо в строку ниже вместо env.BOT_TOKEN
 *    (токен выдаёт @BotFather)
 * 4. Нажми «Deploy»
 */

const APP_URL = 'https://ghostvip1717-glitch.github.io/Trening/';

export default {
  async fetch(request, env) {
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

    const resp = await fetch('https://api.telegram.org/bot' + env.BOT_TOKEN + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        reply_markup: {
          inline_keyboard: [[
            { text: '🚀 Открыть приложение', web_app: { url: APP_URL } }
          ]]
        }
      })
    });

    const result = await resp.text();
    return new Response(result, { status: resp.status, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
};
