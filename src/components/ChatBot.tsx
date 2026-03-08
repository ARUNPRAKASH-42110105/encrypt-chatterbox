import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import { Send, Bot, User, Loader2, MessageSquare, Sparkles, Lock, Hash, ShieldCheck, KeyRound, Trash2 } from 'lucide-react'

type Msg = { role: 'user' | 'assistant'; content: string }

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`

const SUGGESTIONS = [
  { icon: <Lock className="w-3.5 h-3.5" />, text: 'How does AES-256-GCM work?' },
  { icon: <KeyRound className="w-3.5 h-3.5" />, text: 'What is PBKDF2 key derivation?' },
  { icon: <Hash className="w-3.5 h-3.5" />, text: 'What is a SHA-256 hash?' },
  { icon: <ShieldCheck className="w-3.5 h-3.5" />, text: 'How do I choose a strong password?' },
]

async function streamChat(
  messages: Msg[], onDelta: (c: string) => void, onDone: () => void,
  onError: (m: string) => void, signal: AbortSignal,
) {
  const resp = await fetch(CHAT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
    body: JSON.stringify({ messages }), signal,
  })
  if (!resp.ok || !resp.body) {
    const data = await resp.json().catch(() => ({}))
    onError(data.error || 'Failed to reach AI service.'); return
  }
  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buffer = '', done = false
  while (!done) {
    const { done: rd, value } = await reader.read(); if (rd) break
    buffer += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buffer.indexOf('\n')) !== -1) {
      let line = buffer.slice(0, idx); buffer = buffer.slice(idx + 1)
      if (line.endsWith('\r')) line = line.slice(0, -1)
      if (!line.startsWith('data: ')) continue
      const json = line.slice(6).trim()
      if (json === '[DONE]') { done = true; break }
      try {
        const p = JSON.parse(json)
        const c = p.choices?.[0]?.delta?.content as string | undefined
        if (c) onDelta(c)
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

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const send = async (text: string) => {
    const trimmed = text.trim(); if (!trimmed || loading) return
    setError(''); setInput('')
    const userMsg: Msg = { role: 'user', content: trimmed }
    const nextMsgs = [...messages, userMsg]
    setMessages(nextMsgs); setLoading(true)
    abortRef.current = new AbortController()
    let assistantText = ''
    try {
      await streamChat(
        nextMsgs,
        chunk => {
          assistantText += chunk
          setMessages(prev => {
            const last = prev[prev.length - 1]
            if (last?.role === 'assistant') return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantText } : m)
            return [...prev, { role: 'assistant', content: assistantText }]
          })
        },
        () => setLoading(false),
        msg => { setError(msg); setLoading(false) },
        abortRef.current.signal,
      )
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== 'AbortError') setError('Connection error. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-border glass-strong shrink-0">
        <div className="w-9 h-9 rounded-xl btn-glow flex items-center justify-center shrink-0">
          <Sparkles className="w-4.5 h-4.5 text-white" style={{ width: 18, height: 18 }} />
        </div>
        <div className="flex-1">
          <p className="font-black text-foreground text-sm leading-tight gradient-text">Encryption Assistant</p>
          <p className="text-xs text-muted-foreground">Powered by Gemini · Ask anything about security</p>
        </div>
        {messages.length > 0 && (
          <button onClick={() => { setMessages([]); setError('') }} title="Clear chat"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all">
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center gap-5 py-8 text-center animate-fade-in">
            <div className="w-16 h-16 rounded-2xl bg-accent flex items-center justify-center">
              <MessageSquare className="w-8 h-8 text-primary" />
            </div>
            <div>
              <p className="font-black text-foreground text-lg gradient-text">How can I help?</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-xs">Ask about encryption, security, or how this tool works.</p>
            </div>
            <div className="flex flex-col gap-2 w-full max-w-xs">
              {SUGGESTIONS.map(s => (
                <button key={s.text} onClick={() => send(s.text)}
                  className="flex items-center gap-2.5 px-4 py-3 rounded-xl border border-border glass hover:border-primary/50 hover:shadow-md text-sm text-foreground text-left transition-all duration-200">
                  <span className="text-primary shrink-0">{s.icon}</span>
                  <span className="font-medium">{s.text}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className={`flex gap-2.5 animate-fade-in ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
              <div className={`w-8 h-8 rounded-xl shrink-0 flex items-center justify-center ${msg.role === 'user' ? 'btn-glow' : 'bg-accent'}`}>
                {msg.role === 'user'
                  ? <User className="w-4 h-4 text-white" />
                  : <Bot className="w-4 h-4 text-primary" />}
              </div>
              <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'text-white rounded-tr-sm'
                  : 'glass border border-border text-foreground rounded-tl-sm'
              }`}
              style={msg.role === 'user' ? { background: 'var(--gradient-primary)' } : {}}>
                {msg.role === 'assistant' ? (
                  <div className="prose prose-sm max-w-none
                    prose-p:my-1 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5
                    prose-headings:text-foreground prose-p:text-foreground prose-strong:text-foreground
                    prose-li:text-foreground prose-code:text-primary prose-code:bg-accent
                    prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:text-xs
                    prose-pre:bg-secondary prose-pre:text-foreground prose-pre:rounded-xl">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                )}
              </div>
            </div>
          ))
        )}

        {loading && (
          <div className="flex gap-2.5 animate-fade-in">
            <div className="w-8 h-8 rounded-xl bg-accent shrink-0 flex items-center justify-center">
              <Bot className="w-4 h-4 text-primary" />
            </div>
            <div className="glass border border-border rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
              <span className="text-xs text-muted-foreground">Thinking…</span>
              <span className="flex gap-1 ml-1">
                {[0,1,2].map(i => (
                  <span key={i} className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </span>
            </div>
          </div>
        )}

        {error && (
          <p className="text-xs text-destructive text-center glass border border-destructive/30 rounded-xl px-3 py-2 animate-fade-in">
            {error}
          </p>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-border glass-strong px-4 py-3 shrink-0">
        <div className="flex gap-2 items-end">
          <textarea
            rows={1}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) } }}
            placeholder="Ask about encryption, passwords, security…"
            className="flex-1 resize-none rounded-xl border border-border bg-card/60 backdrop-blur-sm px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all max-h-32 overflow-y-auto leading-relaxed"
            style={{ minHeight: '42px' }}
          />
          <button onClick={() => send(input)} disabled={!input.trim() || loading}
            className="w-10 h-10 rounded-xl btn-glow text-white flex items-center justify-center shrink-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none transition-all">
            <Send className="w-4 h-4" />
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5 text-center">Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  )
}
