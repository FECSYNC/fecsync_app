import React, { useEffect, useRef, useState } from 'react';
import { X, Sparkles, FileDown, LogOut } from 'lucide-react';
import ChatMessage from './ChatMessage';
import ChatInput from './ChatInput';
import {
  streamFashionConsultation,
  getChatHistory,
  getOrCreateChatSessionId,
  loadSavedContact,
  saveContactLocally,
  cacheChatMessages,
  loadCachedChatMessages,
  clearFashionChatSession,
  endFashionChatSession,
  startFashionChatSession,
  rotateChatSessionId,
  FASHION_CHAT_SESSION_MINUTES,
  formatTimer,
  isFashionSessionExpiredError,
  sessionEndsAtFromCreated,
  type ChatMessage as ChatMessageType,
  type FashionContact,
  type FashionConversation,
} from '@/services/fashionChat';
import {
  FASHION_CHAT_SECURITY_WARNING,
  isFashionChatSecurityBlockedMessage,
  scanFashionChatContactName,
  scanFashionChatMessage,
} from '@/lib/fashionChatSecurity';
import {
  logHandledClientIssue,
  toCustomerChatMessage,
} from '@/lib/customerFacingErrors';
import { useAuthStore } from '@/store/authStore';

interface ChatWindowProps {
  onClose: () => void;
}

function roleLabel(role: ChatMessageType['role']) {
  if (role === 'user') return 'You';
  if (role === 'staff') return 'Style consultant';
  return 'StyleForge AI';
}

function downloadChatAsPdf(opts: {
  botName: string;
  contact: FashionContact | null;
  messages: ChatMessageType[];
}) {
  const { botName, contact, messages } = opts;
  const rows = messages
    .filter((m) => m.content?.trim() && !m.streaming)
    .map((m) => {
      const when = m.timestamp || m.createdAt;
      const time = when ? new Date(when).toLocaleString() : '';
      const safe = m.content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br/>')
        // Strip markdown image/link syntax for a cleaner printable transcript
        .replace(/\[!\[(.*?)\]\((.*?)\)\]\((.*?)\)/g, '[$1 — $3]')
        .replace(/!\[(.*?)\]\((.*?)\)/g, '[$1]')
        .replace(/\[(.*?)\]\((.*?)\)/g, '$1 ($2)')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      return `<div class="msg"><div class="meta"><strong>${roleLabel(
        m.role
      )}</strong>${time ? ` · ${time}` : ''}</div><div class="body">${safe}</div></div>`;
    })
    .join('');

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${botName} — Style consultation</title>
  <style>
    body { font-family: Georgia, "Times New Roman", serif; color: #1a1a1a; margin: 32px; line-height: 1.45; }
    h1 { font-size: 22px; margin: 0 0 4px; }
    .sub { color: #555; font-size: 13px; margin-bottom: 24px; }
    .msg { margin: 0 0 16px; padding-bottom: 14px; border-bottom: 1px solid #e8e8e8; }
    .meta { font-size: 12px; color: #666; margin-bottom: 6px; }
    .body { font-size: 14px; white-space: normal; }
    @media print { body { margin: 16px; } }
  </style>
</head>
<body>
  <h1>${botName}</h1>
  <p class="sub">Style consultation${
    contact?.name ? ` for ${contact.name}` : ''
  }${contact?.email ? ` (${contact.email})` : ''} · ${new Date().toLocaleString()}</p>
  ${rows || '<p>No messages yet.</p>'}
  <script>window.onload = function () { window.print(); };</script>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank', 'noopener,noreferrer');
  if (!win) {
    // Popup blocked — fall back to same-tab print document
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(html);
      doc.close();
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    }
    setTimeout(() => {
      URL.revokeObjectURL(url);
      iframe.remove();
    }, 60_000);
    return;
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const ChatWindow: React.FC<ChatWindowProps> = ({ onClose }) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const authUser = useAuthStore((s) => s.user);
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [botName, setBotName] = useState('StyleForge AI');
  const [sessionId, setSessionId] = useState('');
  const [contact, setContact] = useState<FashionContact | null>(null);
  const [contactForm, setContactForm] = useState({
    name: '',
    email: '',
    phone: '',
  });
  const [contactError, setContactError] = useState('');
  const [handoffNotice, setHandoffNotice] = useState(false);

  const [endingChat, setEndingChat] = useState(false);
  const streamAbortRef = useRef<AbortController | null>(null);
  /** Bumps when chat ends or contact gate resets — stale history polls are ignored. */
  const historyLoadGen = useRef(0);
  const [timerEndsAt, setTimerEndsAt] = useState<number | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const [conversationExpired, setConversationExpired] = useState(false);
  const [showSessionStartNotice, setShowSessionStartNotice] = useState(false);
  const [oneMinWarningActive, setOneMinWarningActive] = useState(false);
  const [sessionDurationMinutes, setSessionDurationMinutes] = useState(
    FASHION_CHAT_SESSION_MINUTES
  );
  const conversationExpiredRef = useRef(false);
  const sessionStartNoticeShownRef = useRef(false);
  /** True right after contact submit — skip restore spinner until server syncs. */
  const isNewSessionRef = useRef(false);
  /** True while POST /fashion-chat/start is in flight — ignore empty history polls. */
  const sessionStartingRef = useRef(false);

  const revertContactGate = (message: string) => {
    isNewSessionRef.current = false;
    sessionStartingRef.current = false;
    historyLoadGen.current += 1;
    setContact(null);
    setContactError(message);
    setTimerEndsAt(null);
    setSecondsRemaining(0);
    setConversationExpired(false);
    setShowSessionStartNotice(false);
    setOneMinWarningActive(false);
    conversationExpiredRef.current = false;
    sessionStartNoticeShownRef.current = false;
  };

  const applySessionTimer = (
    chat: FashionConversation | null,
    opts?: { forceExpired?: boolean }
  ) => {
    const ends = chat?.sessionEndsAt
      ? new Date(chat.sessionEndsAt).getTime()
      : chat?.createdAt
        ? sessionEndsAtFromCreated(chat.createdAt, sessionDurationMinutes)
        : Date.now() + sessionDurationMinutes * 60_000;

    if (chat?.createdAt && chat?.sessionEndsAt) {
      const mins = Math.round(
        (new Date(chat.sessionEndsAt).getTime() -
          new Date(chat.createdAt).getTime()) /
          60_000
      );
      if (mins > 0) setSessionDurationMinutes(mins);
    }

    setTimerEndsAt(ends);
    const remaining = Math.max(0, Math.ceil((ends - Date.now()) / 1000));
    setSecondsRemaining(remaining);

    const expired =
      opts?.forceExpired ||
      conversationExpiredRef.current ||
      remaining <= 0 ||
      chat?.status === 'resolved';

    if (expired) {
      conversationExpiredRef.current = true;
      setConversationExpired(true);
      setShowSessionStartNotice(false);
      setOneMinWarningActive(false);
    } else {
      conversationExpiredRef.current = false;
      setConversationExpired(false);
      if (!sessionStartNoticeShownRef.current) {
        sessionStartNoticeShownRef.current = true;
        setShowSessionStartNotice(true);
      }
      if (remaining <= 60) {
        setOneMinWarningActive(true);
      } else {
        setOneMinWarningActive(false);
      }
    }
  };

  const expireConversation = () => {
    conversationExpiredRef.current = true;
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    setIsLoading(false);
    setStatusText(null);
    setConversationExpired(true);
    setShowSessionStartNotice(false);
    setSecondsRemaining(0);
    setOneMinWarningActive(false);
    setMessages((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].role === 'assistant' && next[i].streaming) {
          next[i] = {
            ...next[i],
            content:
              next[i].content?.trim() ||
              'Your conversation time has ended.',
            streaming: false,
          };
          break;
        }
      }
      return next;
    });
  };

  /** Server closed the thread — keep transcript and switch to read-only. */
  const enterReadOnlyFromLocalCache = (sid: string) => {
    if (isNewSessionRef.current) return;
    const cached = loadCachedChatMessages(sid);
    setMessages((prev) => {
      if (prev.some((m) => m.streaming)) return prev;
      if (prev.length > 0) return prev;
      return cached;
    });
    expireConversation();
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, statusText]);

  // Persist transcript whenever it changes (survives leave/reopen)
  useEffect(() => {
    if (!sessionId || messages.length === 0 || conversationExpired) return;
    cacheChatMessages(sessionId, messages);
  }, [sessionId, messages, conversationExpired]);

  // Countdown timer for the active conversation window
  useEffect(() => {
    if (!contact || !timerEndsAt || conversationExpired) return;

    const tick = () => {
      const remaining = Math.max(
        0,
        Math.ceil((timerEndsAt - Date.now()) / 1000)
      );
      setSecondsRemaining(remaining);

      if (remaining <= 60) {
        setOneMinWarningActive(true);
      }
      if (remaining <= 0) {
        expireConversation();
      }
    };

    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact, timerEndsAt, conversationExpired]);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      const sid = getOrCreateChatSessionId();
      if (cancelled) return;
      setSessionId(sid);

      try {
        const { messages: history, chat } = await getChatHistory(sid);
        if (cancelled) return;

        if (chat) {
          const saved = loadSavedContact();
          const contactFromChat = chat.contact;
          const nextContact =
            saved ||
            (contactFromChat?.name && contactFromChat?.email
              ? {
                  name: contactFromChat.name,
                  email: contactFromChat.email,
                  phone: contactFromChat.phone || undefined,
                }
              : null);

          if (nextContact) {
            setContact(nextContact);
            setContactForm({
              name: nextContact.name,
              email: nextContact.email,
              phone: nextContact.phone || '',
            });
            setHandoffNotice(Boolean(chat.handoffRequired));
            applySessionTimer(chat);
            if (history.length > 0) {
              setMessages(history);
            } else {
              const cached = loadCachedChatMessages(sid);
              if (cached.length > 0) setMessages(cached);
            }
          }
        } else {
          // No open chat — keep cached transcript in expired state when possible.
          const cached = loadCachedChatMessages(sid);
          const saved = loadSavedContact();
          if (saved && cached.length > 0) {
            setContact(saved);
            setContactForm({
              name: saved.name,
              email: saved.email,
              phone: saved.phone || '',
            });
            setMessages(cached);
            conversationExpiredRef.current = true;
            setConversationExpired(true);
            setShowSessionStartNotice(false);
            setTimerEndsAt(null);
            setSecondsRemaining(0);
          } else {
            clearFashionChatSession();
            setSessionId(rotateChatSessionId());
          }
        }
      } catch {
        const cached = loadCachedChatMessages(sid);
        const saved = loadSavedContact();
        if (!cancelled && saved && cached.length > 0) {
          setContact(saved);
          setContactForm({
            name: saved.name,
            email: saved.email,
            phone: saved.phone || '',
          });
          setMessages(cached);
        }
      }

      if (cancelled) return;
      try {
        const res = await fetch('/api/ai-settings', { credentials: 'omit' });
        if (res.ok) {
          const data = await res.json();
          if (data?.data?.settings?.botName) {
            setBotName(data.data.settings.botName);
          }
          const mins = Number(data?.data?.settings?.fashionChatSessionMinutes);
          if (Number.isFinite(mins) && mins > 0) {
            setSessionDurationMinutes(mins);
          }
        }
      } catch (err) {
        console.warn('Failed to fetch AI settings:', err);
      }
    };

    void bootstrap();
    return () => {
      cancelled = true;
    };
    // Intentionally once on mount — auth prefill is separate
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Prefill contact form from logged-in user when no saved contact yet
  useEffect(() => {
    if (contact || !authUser?.email) return;
    setContactForm((prev) => {
      if (prev.name || prev.email) return prev;
      return {
        name:
          authUser.fullName ||
          authUser.name ||
          authUser.email.split('@')[0] ||
          '',
        email: authUser.email,
        phone: '',
      };
    });
  }, [authUser?.email, authUser?.fullName, authUser?.name, contact]);

  // Load + poll history once contact + session ready (skip poll after expiry)
  useEffect(() => {
    if (!sessionId || !contact || conversationExpired) return;

    let cancelled = false;
    const loadGen = historyLoadGen.current;

    const load = async (showSpinner: boolean) => {
      const showRestoreSpinner = showSpinner && !isNewSessionRef.current;
      if (showRestoreSpinner) setHistoryLoading(true);
      try {
        const { messages: history, chat } = await getChatHistory(sessionId);
        if (cancelled || loadGen !== historyLoadGen.current) return;
        if (chat) {
          isNewSessionRef.current = false;
          setHandoffNotice(Boolean(chat.handoffRequired));
          applySessionTimer(chat);
          if (history.length > 0) {
            setMessages((prev) => {
              if (prev.some((m) => m.streaming)) return prev;
              if (chat.status === 'resolved' || conversationExpiredRef.current) {
                return history;
              }
              if (history.length >= prev.length) return history;
              return prev;
            });
          }
        } else {
          if (isNewSessionRef.current || sessionStartingRef.current) {
            return;
          }
          enterReadOnlyFromLocalCache(sessionId);
          return;
        }
      } finally {
        if (!cancelled && loadGen === historyLoadGen.current && showRestoreSpinner) {
          setHistoryLoading(false);
        }
      }
    };
    void load(true);
    const timer = setInterval(() => void load(false), 12_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [sessionId, contact, conversationExpired]);

  const syncSessionOnServer = async (
    sid: string,
    next: FashionContact
  ) => {
    sessionStartingRef.current = true;
    try {
      const started = await startFashionChatSession({
        sessionId: sid,
        contact: next,
      });
      if (!started) {
        revertContactGate(
          'Could not start chat with the server. Check your connection and try again.'
        );
        return;
      }
      isNewSessionRef.current = false;
      applySessionTimer(started);
    } catch {
      revertContactGate(
        'Could not start chat with the server. Check your connection and try again.'
      );
    } finally {
      sessionStartingRef.current = false;
    }
  };

  const updateLastAssistant = (
    updater: (msg: ChatMessageType) => ChatMessageType
  ) => {
    setMessages((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].role === 'assistant') {
          next[i] = updater(next[i]);
          break;
        }
      }
      return next;
    });
  };

  const handleContactSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const name = contactForm.name.trim();
    const email = contactForm.email.trim().toLowerCase();
    const phone = contactForm.phone.trim();
    if (!name || !email) {
      setContactError('Name and email are required');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setContactError('Enter a valid email address');
      return;
    }
    if (!scanFashionChatContactName(name)) {
      setContactError(
        'Name contains characters or patterns that are not allowed. Use a plain name.'
      );
      return;
    }
    const sid = sessionId || getOrCreateChatSessionId();
    if (!sessionId) setSessionId(sid);
    const next: FashionContact = { name, email, phone: phone || undefined };
    saveContactLocally(next);
    setContactError('');

    // Open chat immediately — sync with server in the background.
    isNewSessionRef.current = true;
    sessionStartNoticeShownRef.current = false;
    setContact(next);
    applySessionTimer({
      id: '',
      contact: next,
      status: 'open',
      handoffRequired: false,
      messages: [],
      createdAt: new Date().toISOString(),
    });

    void syncSessionOnServer(sid, next);
  };

  const resetToContactGate = () => {
    historyLoadGen.current += 1;
    isNewSessionRef.current = false;
    sessionStartingRef.current = false;
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    clearFashionChatSession();
    setMessages([]);
    setContact(null);
    setHandoffNotice(false);
    setStatusText(null);
    setHistoryLoading(false);
    setContactError('');
    setContactForm({ name: '', email: '', phone: '' });
    setSessionId(rotateChatSessionId());
    setIsLoading(false);
    setTimerEndsAt(null);
    setSecondsRemaining(0);
    setConversationExpired(false);
    setShowSessionStartNotice(false);
    setOneMinWarningActive(false);
    conversationExpiredRef.current = false;
    sessionStartNoticeShownRef.current = false;
  };

  /** After session expiry — one tap clears local state and opens a fresh contact form. */
  const handleStartNewChat = async () => {
    if (endingChat) return;
    setEndingChat(true);
    historyLoadGen.current += 1;
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    const endedSessionId = sessionId;
    const endedContact = contact;
    try {
      if (endedSessionId) {
        await endFashionChatSession({
          sessionId: endedSessionId,
          contact: endedContact,
        });
      }
    } finally {
      resetToContactGate();
      setEndingChat(false);
    }
  };

  const handleEndChat = async () => {
    if (endingChat) return;
    if (conversationExpired) {
      await handleStartNewChat();
      return;
    }
    const ok = window.confirm(
      'End this chat? It will be marked resolved in the admin inbox with your details. Next time you open chat, you will fill in your contact form again.'
    );
    if (!ok) return;

    const endedSessionId = sessionId;
    const endedContact = contact;

    setEndingChat(true);
    resetToContactGate();

    try {
      if (endedSessionId) {
        await endFashionChatSession({
          sessionId: endedSessionId,
          contact: endedContact,
        });
      }
    } finally {
      setEndingChat(false);
    }
  };

  const handleSavePdf = () => {
    if (messages.filter((m) => m.content?.trim() && !m.streaming).length === 0) {
      return;
    }
    downloadChatAsPdf({ botName, contact, messages });
  };

  const handleMinimize = () => {
    onClose();
  };

  const handleSendMessage = async (messageText: string, image?: string) => {
    if (!contact || !sessionId || conversationExpired) return;

    const preflight = scanFashionChatMessage({
      content: messageText || (image ? 'Please analyze this outfit image.' : ''),
      image,
    });
    if (!preflight.allowed) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: preflight.reason,
          timestamp: new Date().toISOString(),
        },
      ]);
      return;
    }

    const userMessage: ChatMessageType = {
      role: 'user',
      content: preflight.content,
      image: preflight.image,
      timestamp: new Date().toISOString(),
    };

    const assistantPlaceholder: ChatMessageType = {
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      streaming: true,
    };

    setMessages((prev) => [...prev, userMessage, assistantPlaceholder]);
    setIsLoading(true);
    setStatusText('Thinking…');

    const abort = new AbortController();
    streamAbortRef.current?.abort();
    streamAbortRef.current = abort;

    try {
      await streamFashionConsultation(
        {
          message: userMessage.content,
          image: userMessage.image,
          sessionId,
          contact,
        },
        {
          signal: abort.signal,
          onStatus: (msg) => setStatusText(msg),
          onReset: () => {
            updateLastAssistant((m) => ({
              ...m,
              content: '',
              streaming: true,
            }));
          },
          onDelta: (chunk) => {
            setStatusText(null);
            updateLastAssistant((m) => ({
              ...m,
              content: (m.content || '') + chunk,
              streaming: true,
            }));
          },
          onDone: (reply, meta) => {
            setStatusText(null);
            setHandoffNotice(Boolean(meta?.handoffRequired));
            updateLastAssistant(() => ({
              ...reply,
              streaming: false,
            }));
          },
          onError: (err) => {
            setStatusText(null);
            if (isFashionSessionExpiredError(err)) {
              expireConversation();
            }
          },
        }
      );
    } catch (error) {
      if (abort.signal.aborted) {
        setStatusText(null);
        updateLastAssistant((m) => ({
          ...m,
          content:
            m.content?.trim() ||
            (conversationExpiredRef.current
              ? 'Your conversation time has ended.'
              : 'Chat ended.'),
          streaming: false,
        }));
      } else {
        const message =
          error instanceof Error ? error.message : "Something went wrong.";
        if (isFashionSessionExpiredError(message)) {
          expireConversation();
        }
        logHandledClientIssue('Chat', error);
        setStatusText(null);
        if (isFashionChatSecurityBlockedMessage(message)) {
          setMessages((prev) => {
            const next = [...prev];
            if (
              next.length >= 2 &&
              next[next.length - 1].role === 'assistant' &&
              next[next.length - 2].role === 'user'
            ) {
              next.pop();
              next.pop();
            }
            next.push({
              role: 'assistant',
              content: message.includes('blocked')
                ? message
                : FASHION_CHAT_SECURITY_WARNING,
              timestamp: new Date().toISOString(),
            });
            return next;
          });
        } else {
          updateLastAssistant((m) => ({
            ...m,
            content:
              m.content?.trim() ||
              (isFashionSessionExpiredError(message)
                ? message
                : toCustomerChatMessage(message)),
            streaming: false,
          }));
        }
      }
    } finally {
      if (streamAbortRef.current === abort) {
        streamAbortRef.current = null;
      }
      setIsLoading(false);
      setStatusText(null);
    }
  };

  const canSavePdf =
    messages.some((m) => m.content?.trim() && !m.streaming) && Boolean(contact);

  return (
    <div className="flex flex-col h-[500px] w-[300px] md:h-[450px] md:w-[340px] bg-white rounded-2xl shadow-2xl overflow-hidden ">
      <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-[#D4AF37] to-[#B8941F] text-white gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 bg-white/20 rounded-full flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-base truncate">{botName}</h3>
            <p className="text-xs text-white/80 truncate">
              {contact && timerEndsAt && !conversationExpired
                ? `${formatTimer(secondsRemaining)} left`
                : contact && conversationExpired
                  ? 'Session ended'
                  : 'Style Consultant'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {canSavePdf && (
            <button
              type="button"
              onClick={handleSavePdf}
              className="w-8 h-8 bg-white/15 hover:bg-white/25 rounded-full flex items-center justify-center transition-colors"
              aria-label="Print or save chat as PDF"
              title="Print / Save as PDF"
            >
              <FileDown className="w-4 h-4 text-white" />
            </button>
          )}
          {contact && !conversationExpired && (
            <button
              type="button"
              onClick={() => void handleEndChat()}
              disabled={endingChat}
              className="w-8 h-8 bg-white/15 hover:bg-white/25 rounded-full flex items-center justify-center transition-colors disabled:opacity-50"
              aria-label="End chat"
              title="End chat"
            >
              <LogOut className="w-4 h-4 text-white" />
            </button>
          )}
          <button
            type="button"
            onClick={handleMinimize}
            className="w-8 h-8 bg-[#D4AF37] hover:bg-[#B8941F] rounded-full flex items-center justify-center transition-colors shadow-lg cursor-pointer"
            aria-label="Minimize chat"
            title="Minimize chat"
          >
            <X className="w-4 h-4 text-white" />
          </button>
        </div>
      </div>

      {!contact ? (
        <form
          onSubmit={handleContactSubmit}
          autoComplete="on"
          className="flex-1 overflow-y-auto px-4 py-4 bg-gray-50 space-y-3"
        >
          <div className="text-center mb-2">
            <h4 className="font-semibold text-gray-900 text-sm">
              Before we start
            </h4>
            <p className="text-xs text-gray-600 mt-1">
              Share your contact so our team can follow up if you need a human
              stylist.
            </p>
          </div>
          <div>
            <label
              htmlFor="styleforge-contact-name"
              className="block text-xs font-medium text-gray-700 mb-1"
            >
              Full name *
            </label>
            <input
              id="styleforge-contact-name"
              name="name"
              type="text"
              autoComplete="name"
              autoCapitalize="words"
              spellCheck={false}
              value={contactForm.name}
              onChange={(e) =>
                setContactForm((c) => ({ ...c, name: e.target.value }))
              }
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
              placeholder="Your name"
              required
            />
          </div>
          <div>
            <label
              htmlFor="styleforge-contact-email"
              className="block text-xs font-medium text-gray-700 mb-1"
            >
              Email *
            </label>
            <input
              id="styleforge-contact-email"
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              spellCheck={false}
              value={contactForm.email}
              onChange={(e) =>
                setContactForm((c) => ({ ...c, email: e.target.value }))
              }
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
              placeholder="you@example.com"
              required
            />
          </div>
          <div>
            <label
              htmlFor="styleforge-contact-phone"
              className="block text-xs font-medium text-gray-700 mb-1"
            >
              Phone (optional)
            </label>
            <input
              id="styleforge-contact-phone"
              name="tel"
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              spellCheck={false}
              value={contactForm.phone}
              onChange={(e) =>
                setContactForm((c) => ({ ...c, phone: e.target.value }))
              }
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#D4AF37]"
              placeholder="+234…"
            />
          </div>
          {contactError && (
            <p className="text-xs text-red-600">{contactError}</p>
          )}
          <button
            type="submit"
            className="w-full py-2.5 rounded-lg bg-[#D4AF37] hover:bg-[#B8941F] text-white text-sm font-medium"
          >
            Continue to chat
          </button>
        </form>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto px-4 py-4 bg-gray-50">
            {showSessionStartNotice && !conversationExpired && (
              <div className="mb-3 rounded-lg border border-[#D4AF37]/40 bg-[#D4AF37]/10 px-3 py-2 text-xs text-[#6b5a12]">
                You have {sessionDurationMinutes} minutes to complete this
                conversation. Save or download your chat before time runs out.
              </div>
            )}
            {oneMinWarningActive && !conversationExpired && (
              <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 font-medium">
                1 minute left — please wrap up your question soon.
              </div>
            )}
            {conversationExpired && (
              <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                Your conversation time has ended. Download your chat below, then
                tap <strong>Start new chat</strong> to begin again.
              </div>
            )}
            {handoffNotice && !conversationExpired && (
              <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                A fashion consultant may reply here. Keep this chat open to see
                their message.
              </div>
            )}
            {historyLoading && messages.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-xs text-gray-500 animate-pulse">
                  Restoring your conversation…
                </p>
              </div>
            ) : messages.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center max-w-xs px-4">
                  <div className="w-14 h-14 bg-[#D4AF37]/10 rounded-full flex items-center justify-center mx-auto mb-3">
                    <Sparkles className="w-7 h-7 text-[#D4AF37]" />
                  </div>
                  <h4 className="font-semibold text-gray-900 mb-1.5 text-sm">
                    Welcome, {contact.name.split(' ')[0]}!
                  </h4>
                  <p className="text-xs text-gray-600">
                    Ask me anything about fashion trends, styling tips, or our
                    products.
                  </p>
                </div>
              </div>
            ) : (
              <>
                {messages.map((message, idx) => (
                  <ChatMessage key={message.id || idx} message={message} />
                ))}
                {isLoading && statusText && (
                  <div className="flex gap-2 items-center text-gray-400 text-xs animate-pulse mb-4">
                    <Sparkles className="w-3 h-3" />
                    <span>{statusText}</span>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          {conversationExpired ? (
            <>
              <ChatInput
                onSend={() => {}}
                disabled
                readOnly
                hideHint
                placeholder="Session ended — read-only. Review your messages above."
              />
              <div className="border-t border-gray-200 px-4 pb-4 pt-2 bg-white space-y-2">
                {canSavePdf && (
                  <button
                    type="button"
                    onClick={handleSavePdf}
                    className="w-full py-2.5 rounded-lg border border-[#D4AF37] text-[#8a7010] text-sm font-medium hover:bg-[#D4AF37]/10"
                  >
                    Download conversation
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleStartNewChat()}
                  disabled={endingChat}
                  className="w-full py-2.5 rounded-lg bg-[#D4AF37] hover:bg-[#B8941F] text-white text-sm font-medium disabled:opacity-60"
                >
                  {endingChat ? 'Starting…' : 'Start new chat'}
                </button>
              </div>
            </>
          ) : (
            <ChatInput
              onSend={handleSendMessage}
              disabled={isLoading || conversationExpired}
              placeholder="Ask me about fashion..."
            />
          )}
        </>
      )}
    </div>
  );
};

export default ChatWindow;
