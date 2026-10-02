/**
 * Cloudflare Worker «trening-notify» — единственная дверь к данным приложения
 *
 * Что делает:
 *  - хранит ключ JSONBin у себя (в секретах Cloudflare), приложение его не видит;
 *  - проверяет PIN-коды (в базе лежат только их хеши) и выдаёт токен входа;
 *  - читает и записывает данные только по токену: тренер меняет только свою ветку;
 *  - отправляет уведомления бота ученику (тоже только по токену);
 *  - хранит фото отчётов отдельно от общего документа: фото режется на части по 90 КБ,
 *    каждая часть — свой бин JSONBin (лимит 100 КБ на бин). В задаче остаётся только
 *    id частей через точку; после проверки отчёта бины удаляются.
 *
 * ─────────────────────────────────────────────────────────────
 * НАСТРОЙКА (один раз):
 * 1. https://dash.cloudflare.com → Workers & Pages → trening-notify
 * 2. Settings → Variables and Secrets → Add, тип «Secret»:
 *      BOT_TOKEN    — токен бота от @BotFather
 *      JSONBIN_KEY  — X-Master-Key из https://jsonbin.io/app/app/api-keys
 * 3. Edit code → выделить весь старый код → вставить этот файл → Deploy
 *
 * ⚠️ Токены вставляй ТОЛЬКО в секреты Cloudflare, не в этот файл.
 * ─────────────────────────────────────────────────────────────
 */

const BIN_ID = '6a418902f5f4af5e293e9047';
const BIN_URL = 'https://api.jsonbin.io/v3/b/' + BIN_ID;
const APP_LINK = 'https://t.me/Abc7417bot?startapp';

const ACCOUNTS = ['student', 'coach1', 'coach2'];
const COACHES = ['coach1', 'coach2'];
const BIN_LIMIT = 98000;          // бесплатный JSONBin не принимает документы больше 100 КБ
const TOKEN_TTL = 7 * 24 * 3600;  // сек
const MAX_FAILS = 10;             // неверных PIN подряд до блокировки
const LOCK_MIN = 15;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// ── КРИПТО ──
const enc = new TextEncoder();
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}

// Секрет подписи выводим из ключа JSONBin: смена ключа заодно отзывает все токены
const signSecret = env => hmac(env.JSONBIN_KEY, 'trening-session');
const pinHash = async (env, acc, pin) => 'h1:' + await hmac(await signSecret(env), 'pin:' + acc + ':' + pin);

async function makeToken(env, acc) {
  const body = b64url(enc.encode(JSON.stringify({ acc, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL })));
  return body + '.' + await hmac(await signSecret(env), body);
}

async function readToken(env, request) {
  const m = (request.headers.get('Authorization') || '').match(/^Bearer (.+)\.(.+)$/);
  if (!m || m[2] !== await hmac(await signSecret(env), m[1])) return null;
  try {
    const p = JSON.parse(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')));
    return ACCOUNTS.includes(p.acc) && p.exp > Date.now() / 1000 ? p.acc : null;
  } catch { return null; }
}

// ── ДАННЫЕ ──
async function readDB(env) {
  const r = await fetch(BIN_URL + '/latest', { headers: { 'X-Master-Key': env.JSONBIN_KEY, 'X-Bin-Meta': 'false' } });
  if (!r.ok) throw new Error('read ' + r.status);
  const data = await r.json();
  return normalize(data?.record || data);
}

async function writeDB(env, db) {
  // Фото нужно только пока отчёт ждёт проверки; бины проверенных фото удаляем после записи
  const stale = [], inline = [];
  COACHES.forEach(c => (db.branches[c]?.tasks || []).forEach(t => {
    if (t.status === 'reported') { if (t.photo) inline.push(t); return; }
    if (t.photo) t.photo = null;
    if (t.photoId) { stale.push(t.photoId); t.photoId = null; }
  }));
  // Старые отчёты с фото внутри документа: выносим фото в отдельные бины, чтобы освободить место
  for (const t of inline) {
    const ids = [];
    for (let i = 0; i < t.photo.length; i += PHOTO_CHUNK) {
      const id = await createPhotoBin(env, t.photo.slice(i, i + PHOTO_CHUNK));
      if (!id) break;
      ids.push(id);
    }
    if (ids.length * PHOTO_CHUNK >= t.photo.length) { t.photoId = ids.join('.'); t.photo = null; }
    else await deletePhoto(env, ids.join('.'));
  }
  const body = JSON.stringify(db);
  if (enc.encode(body).length > BIN_LIMIT) return 'too_big';
  const r = await fetch(BIN_URL, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Master-Key': env.JSONBIN_KEY },
    body,
  });
  if (!r.ok) return 'write_failed';
  await deletePhoto(env, stale.join('.'));
  return 'ok';
}

// ── ФОТО ОТЧЁТОВ: отдельный бин на каждое фото ──
const PHOTO_URL = 'https://api.jsonbin.io/v3/b';

async function createPhotoBin(env, data) {
  const r = await fetch(PHOTO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Master-Key': env.JSONBIN_KEY, 'X-Bin-Private': 'true', 'X-Bin-Name': 'report-photo' },
    body: JSON.stringify({ data }),
  });
  if (!r.ok) return null;
  const res = await r.json().catch(() => ({}));
  return res?.metadata?.id || null;
}

const PHOTO_CHUNK = 90000;        // символов base64 в одной части (бин ≤ 100 КБ)
const PHOTO_MAX = 10 * PHOTO_CHUNK; // до ~900 КБ на одно фото
const ID_RE = /^[a-f0-9]{24}(\.[a-f0-9]{24}){0,9}$/i;

async function deletePhoto(env, ids) {
  const list = String(ids || '').split('.').filter(Boolean);
  await Promise.allSettled(list.map(id => fetch(PHOTO_URL + '/' + encodeURIComponent(id), {
    method: 'DELETE', headers: { 'X-Master-Key': env.JSONBIN_KEY },
  })));
}

async function photoPut(env, acc, { data }) {
  if (acc !== 'student') return json({ error: 'forbidden' }, 403);
  data = String(data || '');
  if (!data.startsWith('data:image/')) return json({ error: 'bad_photo' }, 400);
  if (data.length > PHOTO_MAX) return json({ error: 'too_big' }, 413);
  const ids = [];
  for (let i = 0; i < data.length; i += PHOTO_CHUNK) {
    const id = await createPhotoBin(env, data.slice(i, i + PHOTO_CHUNK));
    if (!id) { await deletePhoto(env, ids.join('.')); return json({ error: 'photo_failed' }, 502); }
    ids.push(id);
  }
  return json({ id: ids.join('.') });
}

async function photoGet(env, { id }) {
  if (!ID_RE.test(String(id || ''))) return json({ error: 'bad_id' }, 400);
  const parts = await Promise.all(String(id).split('.').map(async part => {
    const r = await fetch(PHOTO_URL + '/' + part + '/latest', { headers: { 'X-Master-Key': env.JSONBIN_KEY, 'X-Bin-Meta': 'false' } });
    if (!r.ok) return null;
    const rec = await r.json();
    return (rec?.record || rec)?.data ?? null;
  }));
  if (parts.some(p => p === null)) return json({ error: 'not_found' }, 404);
  return json({ data: parts.join('') });
}

const obj = v => (v && typeof v === 'object' ? v : {});

// Формат v2; старый формат с одним тренером переезжает в coach1
function normalize(raw) {
  raw = obj(raw);
  if (raw.branches) {
    return { ...raw, version: 2, pins: obj(raw.pins), chatIds: obj(raw.chatIds), names: obj(raw.names), branches: obj(raw.branches) };
  }
  const move = src => { src = obj(src); const d = {}; if (src.student) d.student = src.student; if (src.coach) d.coach1 = src.coach; return d; };
  const { pins, chatIds, names, ...branch } = raw;
  return { version: 2, pins: move(pins), chatIds: move(chatIds), names: move(names), branches: { coach1: branch, coach2: {} } };
}

// Что видит приложение: всё, кроме PIN-кодов и служебных полей
function publicView(db) {
  const registered = {};
  ACCOUNTS.forEach(a => { registered[a] = !!db.pins[a]; });
  return { version: 2, registered, chatIds: db.chatIds, names: db.names, branches: db.branches };
}

async function pinMatches(env, db, acc, pin) {
  const stored = db.pins[acc];
  if (!stored) return false;
  return stored.startsWith('h1:') ? stored === await pinHash(env, acc, pin) : stored === pin;
}

// ── ОБРАБОТЧИКИ ──
async function login(env, { pin }) {
  if (!/^\d{4}$/.test(String(pin))) return json({ error: 'bad_pin' }, 400);
  const db = await readDB(env);
  const lock = obj(db.lock);
  if (lock.until && lock.until > Date.now()) return json({ error: 'locked', until: lock.until }, 429);

  let acc = null;
  for (const a of ACCOUNTS) if (await pinMatches(env, db, a, pin)) { acc = a; break; }

  if (!acc) {
    const fails = (lock.fails || 0) + 1;
    db.lock = fails >= MAX_FAILS ? { fails: 0, until: Date.now() + LOCK_MIN * 60000 } : { fails };
    await writeDB(env, db);
    return json({ error: 'wrong_pin' }, 401);
  }
  // Сброс счётчика и перевод старого PIN в хеш
  const upgrade = !db.pins[acc].startsWith('h1:');
  if (upgrade) db.pins[acc] = await pinHash(env, acc, pin);
  if (upgrade || lock.fails) { db.lock = {}; await writeDB(env, db); }
  return json({ acc, token: await makeToken(env, acc), db: publicView(db) });
}

async function register(env, { acc, pin }) {
  if (!ACCOUNTS.includes(acc) || !/^\d{4}$/.test(String(pin))) return json({ error: 'bad_request' }, 400);
  const db = await readDB(env);
  if (db.pins[acc]) return json({ error: 'taken' }, 409);
  // PIN определяет аккаунт при входе, поэтому он должен быть уникальным
  for (const a of ACCOUNTS) if (await pinMatches(env, db, a, pin)) return json({ error: 'pin_taken' }, 409);
  db.pins[acc] = await pinHash(env, acc, pin);
  const res = await writeDB(env, db);
  if (res !== 'ok') return json({ error: res }, 502);
  return json({ acc, token: await makeToken(env, acc), db: publicView(db) });
}

// Подменяем в свежем документе только присланные ветки (свои) и свои данные входа
async function save(env, acc, { branches, identity }) {
  const db = await readDB(env);
  const allowed = acc === 'student' ? COACHES : [acc];
  for (const [b, data] of Object.entries(obj(branches))) {
    if (!allowed.includes(b)) return json({ error: 'forbidden_branch' }, 403);
    db.branches[b] = obj(data);
  }
  identity = obj(identity);
  if (identity.chatId !== undefined) db.chatIds[acc] = identity.chatId;
  if (identity.name !== undefined) db.names[acc] = String(identity.name).slice(0, 64);
  const res = await writeDB(env, db);
  if (res === 'too_big') return json({ error: res, bytes: enc.encode(JSON.stringify(db)).length }, 413);
  if (res !== 'ok') return json({ error: res }, 502);
  return json({ ok: true });
}

// Уведомления получает только ученик
async function notify(env, { message }) {
  if (!message) return json({ error: 'message required' }, 400);
  const db = await readDB(env);
  const chatId = db.chatIds.student;
  if (!chatId) return json({ ok: false, error: 'no_student_chat' });
  const resp = await fetch('https://api.telegram.org/bot' + env.BOT_TOKEN + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: String(message).slice(0, 4000),
      reply_markup: { inline_keyboard: [[{ text: '🚀 Открыть приложение', url: APP_LINK }]] },
    }),
  });
  return json({ ok: resp.ok }, resp.ok ? 200 : 502);
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (!env.JSONBIN_KEY) return json({ error: 'JSONBIN_KEY не задан в секретах воркера' }, 500);
    const path = new URL(request.url).pathname;
    try {
      // Без входа: какие роли уже заняты (для экрана выбора роли)
      if (request.method === 'GET' && path === '/status') {
        return json({ registered: publicView(await readDB(env)).registered });
      }
      if (request.method !== 'POST' && path !== '/data') return json({ error: 'not_found' }, 404);

      let body = /** @type {any} */ ({});
      if (request.method === 'POST') {
        try { body = obj(await request.json()); } catch { return json({ error: 'bad json' }, 400); }
      }
      if (path === '/login') return login(env, body);
      if (path === '/register') return register(env, body);

      const acc = await readToken(env, request);
      if (!acc) return json({ error: 'unauthorized' }, 401);
      if (path === '/data') return json({ acc, db: publicView(await readDB(env)) });
      if (path === '/save') return save(env, acc, body);
      if (path === '/notify') return notify(env, body);
      if (path === '/photo') return photoPut(env, acc, body);
      if (path === '/photo-get') return photoGet(env, body);
      return json({ error: 'not_found' }, 404);
    } catch (e) {
      return json({ error: 'upstream', detail: String(e.message || e) }, 502);
    }
  },
};
