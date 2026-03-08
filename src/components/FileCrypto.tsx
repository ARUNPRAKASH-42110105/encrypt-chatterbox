import { useState, useRef, useCallback } from 'react'
import {
  Lock,
  Unlock,
  Upload,
  Download,
  FileText,
  Image as ImageIcon,
  File,
  X,
  Eye,
  EyeOff,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  Hash,
  RefreshCw,
} from 'lucide-react'

// ─── AES-256-GCM + PBKDF2 (client-side only) ─────────────────────────────

const MAGIC_BYTES = [0x45, 0x4e, 0x43, 0x31] // "ENC1"

async function deriveKey(password: string, salt: ArrayBuffer): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 310_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function sha256hex(data: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function encryptFile(file: File, password: string): Promise<{ blob: Blob; hash: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = await file.arrayBuffer()
  const hash = await sha256hex(plaintext)
  const key = await deriveKey(password, salt.buffer as ArrayBuffer)
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext,
  )
  // Binary layout: MAGIC(4) | salt(16) | iv(12) | ciphertext
  const out = new Uint8Array(4 + 16 + 12 + ciphertext.byteLength)
  out.set(MAGIC_BYTES, 0)
  out.set(salt, 4)
  out.set(iv, 20)
  out.set(new Uint8Array(ciphertext), 32)
  return { blob: new Blob([out], { type: 'application/octet-stream' }), hash }
}

async function decryptFile(file: File, password: string): Promise<{ blob: Blob; hash: string }> {
  const raw = await file.arrayBuffer()
  const buf = new Uint8Array(raw)
  // Validate magic header
  if (
    buf[0] !== MAGIC_BYTES[0] ||
    buf[1] !== MAGIC_BYTES[1] ||
    buf[2] !== MAGIC_BYTES[2] ||
    buf[3] !== MAGIC_BYTES[3]
  ) {
    throw new Error('This file was not encrypted by this tool, or is corrupted.')
  }
  const salt = buf.slice(4, 20).buffer as ArrayBuffer
  const iv = buf.slice(20, 32)
  const ciphertext = buf.slice(32)
  const key = await deriveKey(password, salt)
  let plaintext: ArrayBuffer
  try {
    plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
  } catch {
    throw new Error('Wrong password or the file is corrupted.')
  }
  const hash = await sha256hex(plaintext)
  return { blob: new Blob([plaintext]), hash }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

const FILE_ICONS: Record<string, JSX.Element> = {
  image: <ImageIcon className="w-5 h-5" />,
  text: <FileText className="w-5 h-5" />,
  default: <File className="w-5 h-5" />,
}

function fileIcon(mime: string) {
  if (mime.startsWith('image/')) return FILE_ICONS.image
  if (mime.startsWith('text/')) return FILE_ICONS.text
  return FILE_ICONS.default
}

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(2)} MB`
}

type Mode = 'encrypt' | 'decrypt'
type Status = 'idle' | 'processing' | 'done' | 'error'

// ─── Main Component ────────────────────────────────────────────────────────

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
    setFile(null)
    setImgPreview(null)
    setTextPreview(null)
    setPassword('')
    setStatus('idle')
    setProgress(0)
    setResultBlob(null)
    setResultName('')
    setResultHash('')
    setError('')
  }

  const handleMode = (m: Mode) => { setMode(m); fullReset() }

  const loadFile = useCallback(async (f: File) => {
    setFile(f)
    setResultBlob(null)
    setStatus('idle')
    setError('')
    setResultHash('')
    if (f.type.startsWith('image/')) {
      setImgPreview(URL.createObjectURL(f))
      setTextPreview(null)
    } else if (
      f.type.startsWith('text/') ||
      /\.(txt|md|csv|json|xml|html|css|js|ts|jsx|tsx|log|sh|yaml|yml)$/i.test(f.name)
    ) {
      const txt = await f.text()
      setTextPreview(txt.slice(0, 2000) + (txt.length > 2000 ? '\n\n… (truncated for preview)' : ''))
      setImgPreview(null)
    } else {
      setImgPreview(null)
      setTextPreview(null)
    }
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      const f = e.dataTransfer.files[0]
      if (f) loadFile(f)
    },
    [loadFile],
  )

  const runProcess = async () => {
    if (!file || !password) return
    setStatus('processing')
    setError('')

    // Animate progress
    let pct = 0
    const tick = setInterval(() => {
      pct = Math.min(pct + Math.random() * 18 + 5, 88)
      setProgress(Math.round(pct))
    }, 150)

    try {
      if (mode === 'encrypt') {
        const { blob, hash } = await encryptFile(file, password)
        clearInterval(tick)
        setProgress(100)
        setResultBlob(blob)
        setResultName(file.name + '.encrypted')
        setResultHash(hash)
      } else {
        const { blob, hash } = await decryptFile(file, password)
        clearInterval(tick)
        setProgress(100)
        setResultBlob(blob)
        setResultName(file.name.replace(/\.encrypted$/i, '') || file.name + '.decrypted')
        setResultHash(hash)
      }
      setStatus('done')
    } catch (e: unknown) {
      clearInterval(tick)
      setProgress(0)
      setStatus('error')
      setError(e instanceof Error ? e.message : 'An unexpected error occurred.')
    }
  }

  const handleDownload = () => {
    if (!resultBlob) return
    const url = URL.createObjectURL(resultBlob)
    const a = document.createElement('a')
    a.href = url
    a.download = resultName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const isReady = !!file && password.length > 0 && status !== 'processing'

  return (
    <div className="min-h-screen bg-background flex flex-col items-center py-14 px-4">

      {/* ── Header ── */}
      <div className="flex flex-col items-center gap-3 mb-10 text-center">
        <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center shadow-xl">
          <ShieldCheck className="w-9 h-9 text-primary-foreground" />
        </div>
        <h1 className="text-4xl font-extrabold text-foreground tracking-tight">File Encryptor</h1>
        <p className="text-muted-foreground text-sm max-w-md leading-relaxed">
          Encrypt or decrypt any file using <strong>AES-256-GCM</strong> with PBKDF2 key derivation.
          <br />Everything runs in your browser — <strong>nothing is ever uploaded</strong>.
        </p>
      </div>

      {/* ── Mode toggle ── */}
      <div className="flex bg-secondary rounded-2xl p-1.5 mb-10 gap-1">
        {(['encrypt', 'decrypt'] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => handleMode(m)}
            className={`flex items-center gap-2 px-8 py-2.5 rounded-xl font-semibold text-sm transition-all duration-200 ${
              mode === m
                ? 'bg-primary text-primary-foreground shadow-md'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {m === 'encrypt' ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
            {m === 'encrypt' ? 'Encrypt' : 'Decrypt'}
          </button>
        ))}
      </div>

      <div className="w-full max-w-2xl flex flex-col gap-6">

        {/* ── Step 1 – Drop zone ── */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2 ml-1">
            Step 1 · Select file
          </p>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => !file && inputRef.current?.click()}
            className={`relative border-2 border-dashed rounded-2xl p-8 flex flex-col items-center gap-3 transition-all duration-200
              ${dragging
                ? 'border-primary bg-accent scale-[1.01]'
                : file
                ? 'border-primary/40 bg-accent/30 cursor-default'
                : 'border-border bg-card hover:border-primary/60 hover:bg-accent/20 cursor-pointer'
              }`}
          >
            <input ref={inputRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f) }} />

            {file ? (
              <div className="w-full flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-accent flex items-center justify-center text-primary shrink-0">
                  {fileIcon(file.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-foreground text-sm truncate">{file.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {fmtSize(file.size)} · {file.type || 'unknown type'}
                  </p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); fullReset() }}
                  title="Remove file"
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <>
                <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center">
                  <Upload className="w-7 h-7 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground text-center">
                  <span className="font-semibold text-foreground">Click to browse</span> or drag &amp; drop
                </p>
                <p className="text-xs text-muted-foreground">Supports any file type — PDF, images, documents, archives…</p>
              </>
            )}
          </div>
        </div>

        {/* ── File preview ── */}
        {imgPreview && (
          <div className="rounded-2xl overflow-hidden border border-border bg-card">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest px-4 py-2 border-b border-border">
              Image Preview
            </p>
            <img src={imgPreview} alt="file preview" className="w-full max-h-64 object-contain bg-muted/20 p-2" />
          </div>
        )}
        {textPreview && (
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest px-4 py-2 border-b border-border">
              Text Preview
            </p>
            <pre className="text-xs text-foreground font-mono p-4 overflow-auto max-h-44 whitespace-pre-wrap leading-relaxed">
              {textPreview}
            </pre>
          </div>
        )}

        {/* ── Step 2 – Password ── */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2 ml-1">
            Step 2 · {mode === 'encrypt' ? 'Set password' : 'Enter password'}
          </p>
          <div className="relative">
            <input
              type={showPass ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && isReady && runProcess()}
              placeholder={mode === 'encrypt' ? 'Create a strong password…' : 'Enter the password used to encrypt…'}
              className="w-full rounded-xl border border-border bg-card px-4 py-3 pr-12 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
            />
            <button
              type="button"
              onClick={() => setShowPass(!showPass)}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors"
              title={showPass ? 'Hide password' : 'Show password'}
            >
              {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {mode === 'encrypt' && password.length > 0 && (
            <div className="mt-2 flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    password.length < 8 ? 'bg-destructive w-1/4' :
                    password.length < 12 ? 'bg-yellow-500 w-1/2' :
                    password.length < 16 ? 'bg-primary w-3/4' :
                    'bg-success w-full'
                  }`}
                />
              </div>
              <span className="text-xs text-muted-foreground w-14 text-right">
                {password.length < 8 ? 'Weak' : password.length < 12 ? 'Fair' : password.length < 16 ? 'Good' : 'Strong'}
              </span>
            </div>
          )}
          {mode === 'encrypt' && (
            <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1">
              <AlertCircle className="w-3 h-3 shrink-0" />
              Store your password safely — there is no recovery option.
            </p>
          )}
        </div>

        {/* ── Step 3 – Action button ── */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2 ml-1">
            Step 3 · Process
          </p>
          <button
            onClick={runProcess}
            disabled={!isReady}
            className="w-full py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all duration-200
              bg-primary text-primary-foreground hover:opacity-90 active:scale-[0.98]
              disabled:opacity-40 disabled:cursor-not-allowed shadow-md"
          >
            {status === 'processing' ? (
              <><RefreshCw className="w-4 h-4 animate-spin" /> Processing…</>
            ) : mode === 'encrypt' ? (
              <><Lock className="w-4 h-4" /> Encrypt File</>
            ) : (
              <><Unlock className="w-4 h-4" /> Decrypt File</>
            )}
          </button>
        </div>

        {/* ── Progress bar ── */}
        {(status === 'processing' || status === 'done') && (
          <div className="flex flex-col gap-1.5">
            <div className="w-full h-2.5 bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground text-right">{progress}%</p>
          </div>
        )}

        {/* ── Error banner ── */}
        {status === 'error' && (
          <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/8 px-4 py-3.5 text-sm text-destructive">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold mb-0.5">Failed</p>
              <p className="text-xs opacity-90">{error}</p>
            </div>
          </div>
        )}

        {/* ── Result card ── */}
        {status === 'done' && resultBlob && (
          <div className="rounded-2xl border border-border bg-card p-6 flex flex-col gap-5 shadow-sm">
            {/* Success header */}
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-accent flex items-center justify-center text-primary shrink-0">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <p className="font-bold text-foreground">
                  {mode === 'encrypt' ? '🔒 Encryption complete!' : '🔓 Decryption complete!'}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-sm">{resultName}</p>
              </div>
            </div>

            {/* Hash */}
            {resultHash && (
              <div className="rounded-xl border border-border bg-secondary/40 p-3">
                <div className="flex items-center gap-1.5 mb-1.5 text-muted-foreground">
                  <Hash className="w-3.5 h-3.5" />
                  <span className="text-xs font-semibold uppercase tracking-wide">
                    SHA-256 of {mode === 'encrypt' ? 'original' : 'decrypted'} file
                  </span>
                </div>
                <p className="text-xs font-mono text-foreground break-all leading-relaxed">{resultHash}</p>
              </div>
            )}

            {/* File size info */}
            <div className="flex gap-3 text-xs text-muted-foreground">
              <div className="flex-1 rounded-xl bg-secondary/50 px-3 py-2 flex flex-col gap-0.5">
                <span className="font-semibold text-foreground">Output file</span>
                <span>{resultName}</span>
              </div>
              <div className="flex-1 rounded-xl bg-secondary/50 px-3 py-2 flex flex-col gap-0.5">
                <span className="font-semibold text-foreground">Size</span>
                <span>{fmtSize(resultBlob.size)}</span>
              </div>
            </div>

            {/* Download button */}
            <button
              onClick={handleDownload}
              className="w-full py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 bg-primary text-primary-foreground hover:opacity-90 active:scale-[0.98] transition-all shadow-md"
            >
              <Download className="w-4 h-4" />
              Download {mode === 'encrypt' ? 'Encrypted' : 'Decrypted'} File
            </button>

            {/* Start over */}
            <button
              onClick={fullReset}
              className="w-full py-2.5 rounded-xl font-medium text-sm flex items-center justify-center gap-2 text-muted-foreground hover:text-foreground hover:bg-secondary transition-all"
            >
              <RefreshCw className="w-4 h-4" />
              Process another file
            </button>
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="mt-14 flex flex-col items-center gap-1">
        <p className="text-xs text-muted-foreground text-center">
          AES-256-GCM · PBKDF2-SHA256 (310,000 iterations) · 100% client-side
        </p>
        <p className="text-xs text-muted-foreground/60">Your files never leave your device</p>
      </div>
    </div>
  )
}
