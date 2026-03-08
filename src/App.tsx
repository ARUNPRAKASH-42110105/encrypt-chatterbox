import { useState, useEffect } from 'react'
import { Lock, MessageSquare, Sun, Moon, ShieldCheck } from 'lucide-react'
import FileCrypto from './components/FileCrypto'
import ChatBot from './components/ChatBot'

type Tab = 'encrypt' | 'chat'

export default function App() {
  const [tab, setTab] = useState<Tab>('encrypt')
  const [dark, setDark] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('theme') === 'dark' ||
        (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches)
    }
    return false
  })

  useEffect(() => {
    const root = document.documentElement
    if (dark) {
      root.classList.add('dark')
      localStorage.setItem('theme', 'dark')
    } else {
      root.classList.remove('dark')
      localStorage.setItem('theme', 'light')
    }
  }, [dark])

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--gradient-bg)' }}>

      {/* ── Navbar ── */}
      <nav className="sticky top-0 z-20 glass-strong">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center h-16 gap-3">

          {/* Brand */}
          <div className="flex items-center gap-2.5 mr-6">
            <div className="w-8 h-8 rounded-xl btn-glow flex items-center justify-center">
              <ShieldCheck className="w-4.5 h-4.5 text-white" style={{ width: 18, height: 18 }} />
            </div>
            <span className="font-black text-base tracking-tight gradient-text">CipherVault</span>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1 bg-secondary/50 rounded-2xl p-1">
            {([
              { id: 'encrypt' as Tab, label: 'Encrypt / Decrypt', icon: Lock },
              { id: 'chat' as Tab, label: 'AI Assistant', icon: MessageSquare },
            ] as const).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200 ${
                  tab === id
                    ? 'btn-glow text-white shadow-md'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Dark mode toggle */}
          <button
            onClick={() => setDark(!dark)}
            className="w-10 h-10 rounded-xl glass flex items-center justify-center text-muted-foreground hover:text-foreground hover:shadow-md transition-all duration-200"
            title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {dark
              ? <Sun className="w-4.5 h-4.5" style={{ width: 18, height: 18 }} />
              : <Moon className="w-4.5 h-4.5" style={{ width: 18, height: 18 }} />
            }
          </button>
        </div>
      </nav>

      {/* ── Content ── */}
      <div className="flex-1 flex overflow-hidden">

        {/* Desktop — side by side */}
        <div className="hidden lg:flex w-full max-w-7xl mx-auto px-4 sm:px-6 py-6 gap-6">
          {/* Left panel */}
          <div className="flex-1 min-w-0 overflow-y-auto rounded-3xl glass-strong shadow-[var(--shadow-card)]">
            <FileCrypto />
          </div>
          {/* Right panel */}
          <div className="w-[420px] shrink-0 rounded-3xl glass-strong shadow-[var(--shadow-card)] flex flex-col overflow-hidden" style={{ height: 'calc(100vh - 100px)' }}>
            <ChatBot />
          </div>
        </div>

        {/* Mobile — tab switch */}
        <div className="lg:hidden w-full flex flex-col flex-1 overflow-hidden px-3 py-4">
          {tab === 'encrypt' ? (
            <div className="flex-1 overflow-y-auto rounded-3xl glass-strong shadow-[var(--shadow-card)]">
              <FileCrypto />
            </div>
          ) : (
            <div className="flex-1 overflow-hidden flex flex-col rounded-3xl glass-strong shadow-[var(--shadow-card)]">
              <ChatBot />
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
