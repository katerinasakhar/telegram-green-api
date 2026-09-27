// Тонкая обёртка над GREEN-API (раздел Telegram: https://green-api.com/telegram/).
// Используются методы GREEN-API для поиска, отправки и получения сообщений:
//   1. CheckAccount          — поиск Telegram-аккаунта по телефону или username
//   2. SendMessage           — отправка текстового сообщения
//   3. ReceiveNotification   — получение одного уведомления из очереди (long polling)
//   4. DeleteNotification    — удаление обработанного уведомления из очереди

/**
 * @typedef {Object} GreenApiConfig
 * @property {string} apiUrl          Базовый URL инстанса, например https://7105.api.green-api.com
 * @property {string} idInstance
 * @property {string} apiTokenInstance
 */

function buildUrl(config, method, query = '') {
  const base = config.apiUrl.replace(/\/+$/, '')
  return `${base}/waInstance${config.idInstance}/${method}/${config.apiTokenInstance}${query}`
}

/**
 * Отправить текстовое сообщение.
 * POST {{apiUrl}}/waInstance{{idInstance}}/sendMessage/{{apiTokenInstance}}
 * body: { chatId, message }
 */
export async function sendMessage(config, chatId, message) {
  const res = await fetch(buildUrl(config, 'sendMessage'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId, message }),
  })

  const data = await res.json().catch(() => ({}))

  if (!res.ok) {
    throw new Error(data?.message || `SendMessage: HTTP ${res.status}`)
  }

  return data // { idMessage }
}

/**
 * Найти Telegram-аккаунт по международному номеру телефона или username.
 */
export async function checkAccount(config, identifier) {
  const res = await fetch(buildUrl(config, 'checkAccount'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(identifier),
  })

  const data = await res.json().catch(() => ({}))

  if (!res.ok || data.status === false) {
    throw new Error(data.reason || data.message || `CheckAccount: HTTP ${res.status}`)
  }

  return data
}

/**
 * Получить одно уведомление из очереди (ждёт до receiveTimeout секунд).
 * GET {{apiUrl}}/waInstance{{idInstance}}/receiveNotification/{{apiTokenInstance}}?receiveTimeout=5
 * Возвращает null, если очередь пуста.
 */
export async function receiveNotification(config, receiveTimeout = 5, signal) {
  const res = await fetch(
    buildUrl(config, 'receiveNotification', `?receiveTimeout=${receiveTimeout}`),
    { signal }
  )

  if (res.status === 204 || res.status === 408) return null

  const responseText = await res.text().catch(() => '')
  let data = null
  try {
    data = responseText ? JSON.parse(responseText) : null
  } catch {
    data = null
  }
  if (!res.ok) {
    throw new Error(
      data?.message || data?.error || data?.reason || responseText || `ReceiveNotification: HTTP ${res.status}`
    )
  }
  if (!data) return null

  return data // { receiptId, body }
}

/**
 * Удалить обработанное уведомление из очереди.
 * DELETE {{apiUrl}}/waInstance{{idInstance}}/deleteNotification/{{apiTokenInstance}}/{{receiptId}}
 */
export async function deleteNotification(config, receiptId, signal) {
  const res = await fetch(buildUrl(config, `deleteNotification`, '') + `/${receiptId}`, {
    method: 'DELETE',
    signal,
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(
      data?.message || data?.error || data?.reason || `DeleteNotification: HTTP ${res.status}`
    )
  }
  return res.ok
}

/**
 * Достаём из тела уведомления только то, что нужно для отображения
 * текстового входящего сообщения. Прочие типы уведомлений (статусы
 * доставки, исходящие сообщения с других устройств и т.д.) игнорируются.
 */
export function parseIncomingText(notificationBody) {
  if (!notificationBody) return null
  if (notificationBody.typeWebhook !== 'incomingMessageReceived') return null

  const messageData = notificationBody.messageData
  if (!messageData || messageData.typeMessage !== 'textMessage') return null

  const text = messageData.textMessageData?.textMessage
  if (!text) return null

  return {
    chatId: notificationBody.senderData?.chatId,
    senderName:
      notificationBody.senderData?.senderContactName ||
      notificationBody.senderData?.senderName ||
      notificationBody.senderData?.chatId,
    text,
    idMessage: notificationBody.idMessage,
    timestamp: notificationBody.timestamp,
  }
}
