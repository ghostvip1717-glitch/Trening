# State.md
- Telegram Mini App Accountability (ученик/тренер): index.html + notify-worker.js (Cloudflare Worker), данные в JSONBin
- JSONBin формат v2: { version:2, pins/chatIds/names: {student, coach1, coach2}, branches: {coach1, coach2} }; ветка = debt/tasks/payments/history/debtProposal/inactivityTimer
  - старый формат автоматически мигрирует: coach → coach1
  - S = вид активной ветки (S.role 'student'|'coach'), ME = аккаунт, BR = ветка
  - PIN уникален и определяет аккаунт; регистрация второго тренера на экране PIN, пока coach2 свободен
  - save() мержит в свежий документ только изменённые ветки + свои данные входа
- Уведомления бота получает только ученик (notifyAll → S.chatIds.student)
