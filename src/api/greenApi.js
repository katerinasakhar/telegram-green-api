
/**
 * @typedef {Object} GreenApiConfig
 * @property {string} idInstance
 * @property {string} apiTokenInstance
 */

const API_URL = 'https://api.green-api.com'

function buildUrl(config, method, query = '') {
  return `${API_URL}/waInstance${config.idInstance}/${method}/${config.apiTokenInstance}${query}`
}


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

  return data 
}


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
