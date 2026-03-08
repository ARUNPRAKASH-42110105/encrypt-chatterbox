import { useState } from 'react'
import { Lock, MessageSquare } from 'lucide-react'
import FileCrypto from './components/FileCrypto'
import ChatBot from './components/ChatBot'

type Tab = 'encrypt' | 'chat'

export default function App() {
  const [tab, setTab] = useState<Tab>('encrypt')

  return (
    <div className="min-h-screen bg-background flex flex-col">

      {/* ── Top nav tabs ── */}
      <nav className="sticky top-0 z-10 bg-card border-b border-border shadow-sm">
        <div className="max-w-6xl mx-auto px-4 flex items-center gap-1 h-14">
          <div className="flex items-center gap-2 mr-6">
            <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
              <Lock className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-extrabold text-foreground text-sm tracking-tight">File Encryptor</span>
          </div>

          {[
            { id: 'encrypt' as Tab, label: 'Encrypt / Decrypt', icon: <Lock className="w-4 h-4" /> },
            { id: 'chat' as Tab, label: 'AI Assistant', icon: <MessageSquare className="w-4 h-4" /> },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                tab === t.id
                  ? 'bg-primary text-primary-foreground shadow'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      {/* ── Content ── */}
      <div className="flex-1 flex overflow-hidden">

        {/* Desktop: side by side */}
        <div className="hidden lg:flex w-full">
          {/* Left — File tool */}
          <div className="flex-1 overflow-y-auto">
            <FileCrypto />
          </div>
          {/* Divider */}
          <div className="w-px bg-border shrink-0" />
          {/* Right — Chatbot */}
          <div className="w-[420px] shrink-0 flex flex-col" style={{ height: 'calc(100vh - 56px)' }}>
            <ChatBot />
          </div>
        </div>

        {/* Mobile: tab switch */}
        <div className="lg:hidden w-full flex flex-col flex-1 overflow-hidden">
          {tab === 'encrypt' ? (
            <div className="flex-1 overflow-y-auto">
              <FileCrypto />
            </div>
          ) : (
            <div className="flex-1 overflow-hidden flex flex-col">
              <ChatBot />
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
