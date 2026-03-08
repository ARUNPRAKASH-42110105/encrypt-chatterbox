import { useState, useRef, useCallback } from 'react'
import {
  Lock, Unlock, Upload, Download, FileText,
  Image as ImageIcon, File, X, Eye, EyeOff,
  ShieldCheck, AlertCircle, CheckCircle2, Hash, RefreshCw,
} from 'lucide-react'

// ─── AES-256-GCM + PBKDF2 ────────────────────────────────────────────────

const MAGIC_BYTES = [0x45, 0x4e, 0x43, 0x31]

async function deriveKey(password: string, salt: ArrayBuffer): Promise<CryptoKey> {
  const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 310_000, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

async function sha256hex(data: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function encryptFile(file: File, password: string): Promise<{ blob: Blob; hash: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = await file.arrayBuffer()
  const hash = await sha256hex(plaintext)
  const key = await deriveKey(password, salt.buffer as ArrayBuffer)
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
  const out = new Uint8Array(4 + 16 + 12 + ciphertext.byteLength)
  out.set(MAGIC_BYTES, 0); out.set(salt, 4); out.set(iv, 20); out.set(new Uint8Array(ciphertext), 32)
  return { blob: new Blob([out], { type: 'application/octet-stream' }), hash }
}

async function decryptFile(file: File, password: string): Promise<{ blob: Blob; hash: string }> {
  const raw = await file.arrayBuffer()
  const buf = new Uint8Array(raw)
  if (buf[0] !== MAGIC_BYTES[0] || buf[1] !== MAGIC_BYTES[1] || buf[2] !== MAGIC_BYTES[2] || buf[3] !== MAGIC_BYTES[3])
    throw new Error('This file was not encrypted by this tool, or is corrupted.')
  const salt = buf.slice(4, 20).buffer as ArrayBuffer
  const iv = buf.slice(20, 32)
  const ciphertext = buf.slice(32)
  const key = await deriveKey(password, salt)
  let plaintext: ArrayBuffer
  try { plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext) }
  catch { throw new Error('Wrong password or the file is corrupted.') }
  return { blob: new Blob([plaintext]), hash: await sha256hex(plaintext) }
}

function fileIcon(mime: string) {
  if (mime.startsWith('image/')) return <ImageIcon className="w-5 h-5" />
  if (mime.startsWith('text/')) return <FileText className="w-5 h-5" />
  return <File className="w-5 h-5" />
}

function fmtSize(b: number) {
  if (b < 1024) return `${b} B`
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 ** 2).toFixed(2)} MB`
}

type Mode = 'encrypt' | 'decrypt'
type Status = 'idle' | 'processing' | 'done' | 'error'

export default function FileCrypto() {
  const [mode, setMode] = useState<Mode>('encrypt')
  const [file, setFile] = useState<File | null>(null)
  const [imgPreview, setImgPreview] = useState<string | null>(null)
  const [textPreview, setTextPreview] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [progress, setProgress] = useState(0)
  const [resultBlob, setResultBlob] = useState<Blob | null>(null)
  const [resultName, setResultName] = useState('')
  const [resultHash, setResultHash] = useState('')
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const fullReset = () => {
    setFile(null); setImgPreview(null); setTextPreview(null); setPassword('')
    setStatus('idle'); setProgress(0); setResultBlob(null); setResultName(''); setResultHash(''); setError('')
  }

  const handleMode = (m: Mode) => { setMode(m); fullReset() }

  const loadFile = useCallback(async (f: File) => {
    setFile(f); setResultBlob(null); setStatus('idle'); setError(''); setResultHash('')
    if (f.type.startsWith('image/')) { setImgPreview(URL.createObjectURL(f)); setTextPreview(null) }
    else if (f.type.startsWith('text/') || /\.(txt|md|csv|json|xml|html|css|js|ts|log|yaml|yml)$/i.test(f.name)) {
      const txt = await f.text()
      setTextPreview(txt.slice(0, 2000) + (txt.length > 2000 ? '\n\n…(truncated)' : ''))
      setImgPreview(null)
    } else { setImgPreview(null); setTextPreview(null) }
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    const f = e.dataTransfer.files[0]; if (f) loadFile(f)
  }, [loadFile])

  const runProcess = async () => {
    if (!file || !password) return
    setStatus('processing'); setError('')
    let pct = 0
    const tick = setInterval(() => { pct = Math.min(pct + Math.random() * 15 + 5, 88); setProgress(Math.round(pct)) }, 150)
    try {
      if (mode === 'encrypt') {
        const { blob, hash } = await encryptFile(file, password)
        clearInterval(tick); setProgress(100)
        setResultBlob(blob); setResultName(file.name + '.encrypted'); setResultHash(hash)
      } else {
        const { blob, hash } = await decryptFile(file, password)
        clearInterval(tick); setProgress(100)
        setResultBlob(blob); setResultName(file.name.replace(/\.encrypted$/i, '') || file.name + '.decrypted'); setResultHash(hash)
      }
      setStatus('done')
    } catch (e: unknown) {
      clearInterval(tick); setProgress(0); setStatus('error')
      setError(e instanceof Error ? e.message : 'An unexpected error occurred.')
    }
  }

  const handleDownload = () => {
    if (!resultBlob) return
    const url = URL.createObjectURL(resultBlob)
    const a = document.createElement('a'); a.href = url; a.download = resultName
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
  }

  const pwStrength = password.length === 0 ? 0 : password.length < 8 ? 1 : password.length < 12 ? 2 : password.length < 16 ? 3 : 4
  const pwLabel = ['', 'Weak', 'Fair', 'Good', 'Strong'][pwStrength]
  const pwColor = ['', 'bg-destructive', 'bg-yellow-500', 'bg-primary', 'bg-success'][pwStrength]

  return (
    <div className="p-6 sm:p-8 flex flex-col gap-6 animate-fade-in">

      {/* Header */}
      <div className="text-center flex flex-col items-center gap-3">
        <div className="relative">
          <div className="w-16 h-16 rounded-2xl btn-glow flex items-center justify-center animate-pulse-glow">
            <ShieldCheck className="w-8 h-8 text-white" />
          </div>
        </div>
        <div>
          <h1 className="text-3xl font-black gradient-text tracking-tight">CipherVault</h1>
          <p className="text-muted-foreground text-sm mt-1">AES-256-GCM · 100% client-side · nothing uploaded</p>
        </div>
      </div>

      {/* Mode toggle */}
      <div className="flex bg-secondary/60 rounded-2xl p-1.5 gap-1">
        {(['encrypt', 'decrypt'] as Mode[]).map(m => (
          <button key={m} onClick={() => handleMode(m)}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold text-sm transition-all duration-200 ${
              mode === m ? 'btn-glow text-white shadow' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {m === 'encrypt' ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
            {m === 'encrypt' ? 'Encrypt File' : 'Decrypt File'}
          </button>
        ))}
      </div>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !file && inputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-2xl p-7 flex flex-col items-center gap-3 transition-all duration-200 cursor-pointer group
          ${dragging ? 'border-primary bg-accent/40 scale-[1.01]' : file ? 'border-primary/50 bg-accent/20 cursor-default' : 'border-border hover:border-primary/60 hover:bg-accent/10'}`}
        style={dragging ? { boxShadow: 'var(--shadow-glow)' } : {}}
      >
        <input ref={inputRef} type="file" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) loadFile(f) }} />
        {file ? (
          <div className="w-full flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-accent flex items-center justify-center text-primary shrink-0">{fileIcon(file.type)}</div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-foreground text-sm truncate">{file.name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{fmtSize(file.size)} · {file.type || 'binary'}</p>
            </div>
            <button onClick={e => { e.stopPropagation(); fullReset() }}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <>
            <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center group-hover:scale-110 transition-transform duration-200">
              <Upload className="w-7 h-7 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground text-center"><span className="font-bold text-foreground">Click to browse</span> or drag &amp; drop</p>
            <p className="text-xs text-muted-foreground">Any file type · PDF, images, docs, archives…</p>
          </>
        )}
      </div>

      {/* Preview */}
      {imgPreview && (
        <div className="rounded-2xl overflow-hidden border border-border glass animate-fade-in">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-4 py-2 border-b border-border">Preview</p>
          <img src={imgPreview} alt="preview" className="w-full max-h-48 object-contain bg-secondary/20 p-2" />
        </div>
      )}
      {textPreview && (
        <div className="rounded-2xl border border-border glass overflow-hidden animate-fade-in">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-4 py-2 border-b border-border">Text Preview</p>
          <pre className="text-xs text-foreground font-mono p-4 overflow-auto max-h-36 whitespace-pre-wrap leading-relaxed">{textPreview}</pre>
        </div>
      )}

      {/* Password */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
          {mode === 'encrypt' ? 'Set Password' : 'Enter Password'}
        </label>
        <div className="relative">
          <input
            type={showPass ? 'text' : 'password'}
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && file && password && runProcess()}
            placeholder={mode === 'encrypt' ? 'Create a strong password…' : 'Enter decryption password…'}
            className="w-full rounded-xl border border-border bg-card/60 px-4 py-3 pr-12 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all backdrop-blur-sm"
          />
          <button type="button" onClick={() => setShowPass(!showPass)}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors">
            {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        {mode === 'encrypt' && password.length > 0 && (
          <div className="flex items-center gap-3">
            <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden flex gap-0.5">
              {[1,2,3,4].map(i => (
                <div key={i} className={`flex-1 h-full rounded-full transition-all duration-300 ${i <= pwStrength ? pwColor : 'bg-transparent'}`} />
              ))}
            </div>
            <span className={`text-xs font-bold w-12 text-right ${pwStrength <= 1 ? 'text-destructive' : pwStrength === 2 ? 'text-yellow-500' : 'text-success'}`}>{pwLabel}</span>
          </div>
        )}
        {mode === 'encrypt' && (
          <p className="text-[11px] text-muted-foreground flex items-center gap-1">
            <AlertCircle className="w-3 h-3 shrink-0" /> No recovery if you lose the password.
          </p>
        )}
      </div>

      {/* Action button */}
      <button onClick={runProcess} disabled={!file || !password || status === 'processing'}
        className="w-full py-3.5 rounded-xl font-black text-sm flex items-center justify-center gap-2 btn-glow text-white disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none transition-all">
        {status === 'processing'
          ? <><RefreshCw className="w-4 h-4 animate-spin" /> Processing…</>
          : mode === 'encrypt'
          ? <><Lock className="w-4 h-4" /> Encrypt File</>
          : <><Unlock className="w-4 h-4" /> Decrypt File</>}
      </button>

      {/* Progress */}
      {(status === 'processing' || status === 'done') && (
        <div className="flex flex-col gap-1.5 animate-fade-in">
          <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-300 ease-out"
              style={{ width: `${progress}%`, background: 'var(--gradient-primary)' }} />
          </div>
          <p className="text-xs text-muted-foreground text-right font-mono">{progress}%</p>
        </div>
      )}

      {/* Error */}
      {status === 'error' && (
        <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/8 px-4 py-3.5 text-sm text-destructive animate-fade-in">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <div><p className="font-bold">Failed</p><p className="text-xs opacity-90 mt-0.5">{error}</p></div>
        </div>
      )}

      {/* Result */}
      {status === 'done' && resultBlob && (
        <div className="rounded-2xl border border-border glass p-5 flex flex-col gap-4 animate-fade-in" style={{ boxShadow: 'var(--shadow-glow)' }}>
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-accent flex items-center justify-center text-primary shrink-0">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <p className="font-black text-foreground">{mode === 'encrypt' ? '🔒 Encrypted!' : '🔓 Decrypted!'}</p>
              <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-xs">{resultName}</p>
            </div>
          </div>

          {resultHash && (
            <div className="rounded-xl border border-border bg-secondary/40 p-3">
              <div className="flex items-center gap-1.5 mb-1.5 text-muted-foreground">
                <Hash className="w-3.5 h-3.5" />
                <span className="text-[10px] font-bold uppercase tracking-widest">SHA-256 · {mode === 'encrypt' ? 'Original' : 'Decrypted'} file</span>
              </div>
              <p className="text-[11px] font-mono text-foreground break-all leading-relaxed opacity-80">{resultHash}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
            <div className="rounded-xl bg-secondary/50 px-3 py-2.5">
              <span className="font-bold text-foreground block mb-0.5">Output file</span>
              <span className="truncate block">{resultName}</span>
            </div>
            <div className="rounded-xl bg-secondary/50 px-3 py-2.5">
              <span className="font-bold text-foreground block mb-0.5">Size</span>
              <span>{fmtSize(resultBlob.size)}</span>
            </div>
          </div>

          <button onClick={handleDownload}
            className="w-full py-3 rounded-xl font-black text-sm flex items-center justify-center gap-2 btn-glow text-white">
            <Download className="w-4 h-4" /> Download {mode === 'encrypt' ? 'Encrypted' : 'Decrypted'} File
          </button>

          <button onClick={fullReset}
            className="w-full py-2.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 text-muted-foreground hover:text-foreground hover:bg-secondary transition-all">
            <RefreshCw className="w-4 h-4" /> Process another file
          </button>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground text-center pt-2">
        AES-256-GCM · PBKDF2-SHA256 (310k iters) · Your files never leave this device
      </p>
    </div>
  )
}
