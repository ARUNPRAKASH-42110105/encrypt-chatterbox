import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import {
  Send,
  Bot,
  User,
  Loader2,
  MessageSquare,
  Sparkles,
  Lock,
  Hash,
  ShieldCheck,
  KeyRound,
  Trash2,
} from 'lucide-react'

type Msg = { role: 'user' | 'assistant'; content: string }

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`

const SUGGESTIONS = [
  { icon: <Lock className="w-3.5 h-3.5" />, text: 'How does AES-256-GCM work?' },
  { icon: <KeyRound className="w-3.5 h-3.5" />, text: 'What is PBKDF2 key derivation?' },
  { icon: <Hash className="w-3.5 h-3.5" />, text: 'What is a SHA-256 hash?' },
  { icon: <ShieldCheck className="w-3.5 h-3.5" />, text: 'How do I choose a strong password?' },
]

async function streamChat(
  messages: Msg[],
  onDelta: (chunk: string) => void,
  onDone: () => void,
  onError: (msg: string) => void,
  signal: AbortSignal,
) {
  const resp = await fetch(CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
    },
    body: JSON.stringify({ messages }),
    signal,
  })

  if (!resp.ok || !resp.body) {
    const data = await resp.json().catch(() => ({}))
    onError(data.error || 'Failed to reach AI service.')
    return
  }

  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let done = false

  while (!done) {
    const { done: rd, value } = await reader.read()
    if (rd) break
    buffer += decoder.decode(value, { stream: true })

    let idx: number
    while ((idx = buffer.indexOf('\n')) !== -1) {
      let line = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 1)
      if (line.endsWith('\r')) line = line.slice(0, -1)
      if (!line.startsWith('data: ')) continue
      const json = line.slice(6).trim()
      if (json === '[DONE]') { done = true; break }
      try {
        const parsed = JSON.parse(json)
        const chunk = parsed.choices?.[0]?.delta?.content as string | undefined
        if (chunk) onDelta(chunk)
      } catch { buffer = line + '\n' + buffer; break }
    }
  }
  onDone()
}

export default function ChatBot() {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || loading) return
    setError('')
    setInput('')
    const userMsg: Msg = { role: 'user', content: trimmed }
    const nextMsgs = [...messages, userMsg]
    setMessages(nextMsgs)
    setLoading(true)

    abortRef.current = new AbortController()
    let assistantText = ''

    try {
      await streamChat(
        nextMsgs,
        (chunk) => {
          assistantText += chunk
          setMessages((prev) => {
            const last = prev[prev.length - 1]
            if (last?.role === 'assistant') {
              return prev.map((m, i) =>
                i === prev.length - 1 ? { ...m, content: assistantText } : m,
              )
            }
            return [...prev, { role: 'assistant', content: assistantText }]
          })
        },
        () => setLoading(false),
        (msg) => { setError(msg); setLoading(false) },
        abortRef.current.signal,
      )
    } catch (e: unknown) {
      // Ignore abort errors (user cancelled)
      if (e instanceof Error && e.name !== 'AbortError') {
        setError('Connection error. Please try again.')
      }
      setLoading(false)
    }
  }

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }

  return (
    <div className="flex flex-col h-full bg-background">

      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-border bg-card shrink-0">
        <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center shrink-0">
          <Sparkles className="w-5 h-5 text-primary-foreground" />
        </div>
        <div className="flex-1">
          <p className="font-bold text-foreground text-sm leading-tight">Encryption Assistant</p>
          <p className="text-xs text-muted-foreground">Ask me anything about encryption &amp; security</p>
        </div>
        {messages.length > 0 && (
          <button
            onClick={() => { setMessages([]); setError('') }}
            title="Clear chat"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center gap-5 py-8 text-center">
            <div className="w-16 h-16 rounded-2xl bg-accent flex items-center justify-center">
              <MessageSquare className="w-8 h-8 text-primary" />
            </div>
            <div>
              <p className="font-bold text-foreground mb-1">How can I help you?</p>
              <p className="text-sm text-muted-foreground max-w-xs">
                Ask me about encryption, decryption, passwords, or how this tool works.
              </p>
            </div>
            <div className="flex flex-col gap-2 w-full max-w-xs">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.text}
                  onClick={() => send(s.text)}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border bg-card hover:bg-accent hover:border-primary/40 text-sm text-foreground text-left transition-all"
                >
                  <span className="text-primary">{s.icon}</span>
                  {s.text}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className={`flex gap-2.5 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
              {/* Avatar */}
              <div className={`w-8 h-8 rounded-xl shrink-0 flex items-center justify-center ${
                msg.role === 'user' ? 'bg-primary' : 'bg-accent'
              }`}>
                {msg.role === 'user'
                  ? <User className="w-4 h-4 text-primary-foreground" />
                  : <Bot className="w-4 h-4 text-primary" />
                }
              </div>
              {/* Bubble */}
              <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground rounded-tr-sm'
                  : 'bg-card border border-border text-foreground rounded-tl-sm'
              }`}>
                {msg.role === 'assistant' ? (
                  <div className="prose prose-sm max-w-none
                    prose-p:my-1 prose-ul:my-1 prose-ol:my-1
                    prose-headings:text-foreground prose-p:text-foreground
                    prose-strong:text-foreground prose-li:text-foreground
                    prose-code:text-primary prose-code:bg-accent prose-code:px-1 prose-code:rounded
                    prose-pre:bg-secondary prose-pre:text-foreground">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                )}
              </div>
            </div>
          ))
        )}

        {/* Loading dots */}
        {loading && (
          <div className="flex gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-accent shrink-0 flex items-center justify-center">
              <Bot className="w-4 h-4 text-primary" />
            </div>
            <div className="bg-card border border-border rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin" />
              <span className="text-xs text-muted-foreground">Thinking…</span>
            </div>
          </div>
        )}

        {error && (
          <p className="text-xs text-destructive text-center bg-destructive/10 rounded-xl px-3 py-2">
            {error}
          </p>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-border bg-card px-4 py-3 shrink-0">
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask about encryption, passwords, security…"
            className="flex-1 resize-none rounded-xl border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all max-h-32 overflow-y-auto leading-relaxed"
            style={{ minHeight: '42px' }}
          />
          <button
            onClick={() => send(input)}
            disabled={!input.trim() || loading}
            className="w-10 h-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shrink-0 hover:opacity-90 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
          Press Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  )
}
