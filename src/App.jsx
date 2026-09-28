import { useEffect, useRef, useState } from 'react'
import { sendMessage, checkAccount, receiveNotification, deleteNotification, parseIncomingText } from './api/greenApi.js'

const STORAGE_KEY = 'green-api-telegram-settings'
const CHATS_STORAGE_KEY = 'green-api-telegram-chats'
const ACTIVE_CHAT_STORAGE_KEY = 'green-api-telegram-active-chat'

const defaultSettings = {
  idInstance: '',
  apiTokenInstance: '',
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultSettings
    const savedSettings = JSON.parse(raw)
    return {
      idInstance: savedSettings.idInstance || '',
      apiTokenInstance: savedSettings.apiTokenInstance || '',
    }
  } catch {
    return defaultSettings
  }
}

function loadLegacyChatId() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}').chatId || ''
  } catch {
    return ''
  }
}

function loadChats(initialChatId) {
  try {
    const raw = localStorage.getItem(CHATS_STORAGE_KEY)
    const chats = raw ? JSON.parse(raw) : []
    if (!Array.isArray(chats)) return []
    if (initialChatId && !chats.some((chat) => chat.chatId === initialChatId)) {
      return [...chats, { chatId: initialChatId, messages: [] }]
    }
    return chats
  } catch {
    return initialChatId ? [{ chatId: initialChatId, messages: [] }] : []
  }
}

function formatTime(ts) {
  const date = ts ? new Date(ts * 1000) : new Date()
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

export default function App() {
  const [settings, setSettings] = useState(loadSettings)
  const [activeChatId, setActiveChatId] = useState(() => (
    localStorage.getItem(ACTIVE_CHAT_STORAGE_KEY) || loadLegacyChatId()
  ))
  const [mobileView, setMobileView] = useState(() => (
    localStorage.getItem(ACTIVE_CHAT_STORAGE_KEY) || loadLegacyChatId() ? 'chat' : 'list'
  ))
  const [chats, setChats] = useState(() => loadChats(loadLegacyChatId()))
  const [settingsOpen, setSettingsOpen] = useState(() => {
    const s = loadSettings()
    return !s.idInstance || !s.apiTokenInstance
  })
  const [draft, setDraft] = useState(settings)

  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState('')
  const [newChatOpen, setNewChatOpen] = useState(false)
  const [newChatId, setNewChatId] = useState('')
  const [newChatMode, setNewChatMode] = useState('phone')
  const [resolvingChat, setResolvingChat] = useState(false)
  const [newChatError, setNewChatError] = useState('')

  const bottomRef = useRef(null)
  const seenIds = useRef(new Set())

  const configured = settings.idInstance && settings.apiTokenInstance
  const messages = chats.find((chat) => chat.chatId === activeChatId)?.messages || []

  useEffect(() => {
    localStorage.setItem(CHATS_STORAGE_KEY, JSON.stringify(chats))
  }, [chats])

  useEffect(() => {
    if (activeChatId) {
      localStorage.setItem(ACTIVE_CHAT_STORAGE_KEY, activeChatId)
    } else {
      localStorage.removeItem(ACTIVE_CHAT_STORAGE_KEY)
    }
  }, [activeChatId])

  // --- long polling: ReceiveNotification -> DeleteNotification -------------
  useEffect(() => {
    if (!configured) return

    const controller = new AbortController()
    const { signal } = controller

    async function poll() {
      while (!signal.aborted) {
        try {
          const notification = await receiveNotification(settings, 5, signal)
          if (signal.aborted) return
          setConnected(true)
          setError('')

          if (!notification) {
            await new Promise((resolve) => setTimeout(resolve, 250))
            continue
          }

          const parsed = parseIncomingText(notification.body)

          if (parsed && !seenIds.current.has(parsed.idMessage)) {
            seenIds.current.add(parsed.idMessage)
            setChats((prev) => {
              const chatExists = prev.some((chat) => chat.chatId === parsed.chatId)
              const next = chatExists
                ? prev
                : [...prev, { chatId: parsed.chatId, displayName: parsed.senderName, messages: [], unreadCount: 0 }]
              return next.map((chat) => chat.chatId === parsed.chatId
                ? {
                  ...chat,
                  displayName: chat.displayName || parsed.senderName,
                  unreadCount: parsed.chatId === activeChatId ? 0 : (chat.unreadCount || 0) + 1,
                  messages: [...chat.messages, {
                id: parsed.idMessage || `${Date.now()}`,
                text: parsed.text,
                fromMe: false,
                author: parsed.senderName,
                time: formatTime(parsed.timestamp),
                }] }
                : chat)
            })
          }

          await deleteNotification(settings, notification.receiptId, signal)
        } catch (e) {
          if (signal.aborted) return
          setConnected(false)
          setError(e.message || 'Ошибка соединения с GREEN-API')
          await new Promise((resolve) => setTimeout(resolve, 3000))
        }
      }
    }

    const startTimer = setTimeout(poll, 0)
    return () => {
      clearTimeout(startTimer)
      controller.abort()
    }
  }, [settings, configured, activeChatId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // --- sending ---------------------------------------------------------
  async function handleSend() {
    const text = input.trim()
    if (!text || !activeChatId || sending) return

    setSending(true)
    setError('')
    const tempId = `local-${Date.now()}`

    setChats((prev) => prev.map((chat) => chat.chatId === activeChatId
      ? { ...chat, messages: [...chat.messages, { id: tempId, text, fromMe: true, time: formatTime() }] }
      : chat))
    setInput('')

    try {
      await sendMessage(settings, activeChatId, text)
    } catch (e) {
      setError(e.message || 'Не удалось отправить сообщение')
      setChats((prev) => prev.map((chat) => chat.chatId === activeChatId
        ? { ...chat, messages: chat.messages.filter((message) => message.id !== tempId) }
        : chat))
      setInput(text)
    } finally {
      setSending(false)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // --- settings ---------------------------------------------------------
  function saveSettings() {
    const cleaned = {
      idInstance: draft.idInstance.trim(),
      apiTokenInstance: draft.apiTokenInstance.trim(),
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned))
    setSettings(cleaned)
    seenIds.current.clear()
    setSettingsOpen(false)
  }

  function openNewChat() {
    setNewChatId('')
    setNewChatMode('phone')
    setNewChatError('')
    setNewChatOpen(true)
  }

  async function createChat(event) {
    event.preventDefault()
    if (!configured || resolvingChat) return

    const value = newChatId.trim()
    const digits = value.replace(/\D/g, '')
    let identifier

    if (newChatMode === 'phone') {
      if (!/^\d{8,15}$/.test(digits)) {
        setNewChatError('Введите номер в международном формате, например +79991234567.')
        return
      }
      identifier = { phoneNumber: Number(digits) }
    } else {
      const username = value.startsWith('@') ? value : `@${value}`
      if (!/^@[A-Za-z0-9_]{5,32}$/.test(username)) {
        setNewChatError('Введите Telegram-ник длиной от 5 до 32 символов.')
        return
      }
      identifier = { username }
    }

    setResolvingChat(true)
    setNewChatError('')
    try {
      const account = await checkAccount(settings, identifier)
      if (!account.exist || !account.chatId) {
        throw new Error('Аккаунт не найден. Проверьте данные или настройки приватности Telegram.')
      }

      const chatId = account.chatId
      const displayName = account.username || account.phoneNumber?.toString() || value
      setChats((prev) => {
        const exists = prev.some((chat) => chat.chatId === chatId)
        return exists
          ? prev.map((chat) => chat.chatId === chatId
            ? { ...chat, displayName: chat.displayName || displayName }
            : chat)
          : [...prev, { chatId, displayName, messages: [], unreadCount: 0 }]
      })
      setActiveChatId(chatId)
      setMobileView('chat')
      setInput('')
      setError('')
      setNewChatOpen(false)
    } catch (lookupError) {
      setNewChatError(lookupError.message || 'Не удалось найти собеседника.')
    } finally {
      setResolvingChat(false)
    }
  }

  function selectChat(chatId) {
    setActiveChatId(chatId)
    setMobileView('chat')
    setChats((prev) => prev.map((chat) => chat.chatId === chatId
      ? { ...chat, unreadCount: 0 }
      : chat))
    setInput('')
    setError('')
  }

  const activeChat = chats.find((chat) => chat.chatId === activeChatId)
  const chatTitle = activeChat?.displayName || activeChatId || 'Выберите собеседника'

  return (
    <div className={`app ${mobileView === 'chat' ? 'app--mobile-chat' : 'app--mobile-list'}`}>
      <aside className="sidebar">
        <div className="sidebar__top">
          <div className="sidebar__header">Telegram</div>
          <button className="new-chat-btn" onClick={openNewChat} aria-label="Новый диалог" title="Новый диалог">
            +
          </button>
        </div>
        <div className="chat-list">
          {chats.map((chat) => {
            const lastMessage = chat.messages[chat.messages.length - 1]
            return (
              <button
                key={chat.chatId}
                className={`chat-item ${activeChatId === chat.chatId ? 'chat-item--active' : ''}`}
                onClick={() => selectChat(chat.chatId)}
              >
                <span className="avatar">{chat.chatId.slice(-2)}</span>
                <span className="chat-item__info">
                  <span className="chat-item__name">{chat.displayName || chat.chatId}</span>
                  <span className="chat-item__preview">{lastMessage?.text || 'Нет сообщений'}</span>
                </span>
                {chat.unreadCount > 0 && (
                  <span className="unread-badge" aria-label={`${chat.unreadCount} непрочитанных сообщений`}>
                    {chat.unreadCount > 99 ? '99+' : chat.unreadCount}
                  </span>
                )}
              </button>
            )
          })}
        </div>
        <button className="settings-btn" onClick={() => { setDraft(settings); setSettingsOpen(true) }}>
          ⚙ Настройки GREEN-API
        </button>
      </aside>

      <main className="chat">
        <header className="chat__header">
          <button
            className="mobile-back-btn"
            onClick={() => setMobileView('list')}
            aria-label="Вернуться к списку чатов"
            title="К списку чатов"
          >
            ‹
          </button>
          <div className="chat__title">{chatTitle}</div>
          <div className={`status ${connected ? 'status--on' : 'status--off'}`}>
            {connected ? 'В сети' : 'Нет соединения'}
          </div>
        </header>

        <div className="chat__messages">
          {!configured && (
            <div className="hint">
              Заполните настройки GREEN-API (idInstance и apiTokenInstance)
              чтобы начать переписку, создайте диалог кнопкой +.
            </div>
          )}

          {messages.map((m) => (
            <div key={m.id} className={`bubble ${m.fromMe ? 'bubble--out' : 'bubble--in'}`}>
              <div className="bubble__text">{m.text}</div>
              <div className="bubble__time">{m.time}</div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {error && <div className="error-bar">{error}</div>}

        <footer className="chat__input">
          <textarea
            rows={1}
            placeholder="Написать сообщение..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={!configured || !activeChatId}
          />
          <button
            className="send-btn"
            onClick={handleSend}
            disabled={!configured || !activeChatId || !input.trim() || sending}
          >
            Отправить
          </button>
        </footer>
      </main>

      {settingsOpen && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>Настройки GREEN-API</h2>

            <label>
              idInstance
              <input
                type="text"
                placeholder="1101000001"
                value={draft.idInstance}
                onChange={(e) => setDraft({ ...draft, idInstance: e.target.value })}
              />
            </label>

            <label>
              apiTokenInstance
              <input
                type="text"
                placeholder="d75b3a66374942c5b3c019..."
                value={draft.apiTokenInstance}
                onChange={(e) => setDraft({ ...draft, apiTokenInstance: e.target.value })}
              />
            </label>

            <div className="modal__actions">
              {configured && (
                <button className="btn btn--ghost" onClick={() => setSettingsOpen(false)}>
                  Отмена
                </button>
              )}
              <button className="btn btn--primary" onClick={saveSettings}>
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}

      {newChatOpen && (
        <div className="modal-overlay">
          <form className="modal" onSubmit={createChat}>
            <h2>Новый диалог</h2>
            <div className="new-chat-modes" role="group" aria-label="Способ поиска собеседника">
              <button
                className={newChatMode === 'phone' ? 'new-chat-mode new-chat-mode--active' : 'new-chat-mode'}
                type="button"
                aria-pressed={newChatMode === 'phone'}
                onClick={() => { setNewChatMode('phone'); setNewChatError('') }}
              >
                Телефон
              </button>
              <button
                className={newChatMode === 'username' ? 'new-chat-mode new-chat-mode--active' : 'new-chat-mode'}
                type="button"
                aria-pressed={newChatMode === 'username'}
                onClick={() => { setNewChatMode('username'); setNewChatError('') }}
              >
                Ник
              </button>
            </div>
            <label>
              {newChatMode === 'phone' ? 'Номер телефона (международный формат)' : 'Имя пользователя Telegram'}
              <input
                autoFocus
                type="text"
                inputMode={newChatMode === 'phone' ? 'tel' : 'text'}
                placeholder={newChatMode === 'phone' ? '+79991234567' : '@username'}
                value={newChatId}
                onChange={(event) => setNewChatId(event.target.value)}
              />
            </label>
            {newChatError && <div className="new-chat-error" role="alert">{newChatError}</div>}
            <div className="modal__actions">
              <button className="btn btn--ghost" type="button" onClick={() => setNewChatOpen(false)}>
                Отмена
              </button>
              <button className="btn btn--primary" type="submit" disabled={!newChatId.trim() || !configured || resolvingChat}>
                {resolvingChat ? 'Поиск...' : 'Найти и открыть'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
