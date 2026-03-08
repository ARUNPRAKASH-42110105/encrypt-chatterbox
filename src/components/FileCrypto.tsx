import { useState, useRef, useCallback } from 'react'
import {
  Lock,
  Unlock,
  Upload,
  Download,
  FileText,
  Image,
  File,
  X,
  Eye,
  EyeOff,
  ShieldCheck,
  AlertCircle,
} from 'lucide-react'

// ─── Crypto helpers (AES-256-GCM + PBKDF2) ────────────────────────────────

const MAGIC = new TextEncoder().encode('ENC1') // 4-byte header tag

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const raw = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 310_000, hash: 'SHA-256' },
    raw,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function encryptFile(file: File, password: string): Promise<Blob> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(password, salt)
  const plaintext = await file.arrayBuffer()
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
  // Layout: MAGIC(4) | salt(16) | iv(12) | ciphertext
  const out = new Uint8Array(4 + 16 + 12 + ciphertext.byteLength)
  out.set(MAGIC, 0)
  out.set(salt, 4)
  out.set(iv, 20)
  out.set(new Uint8Array(ciphertext), 32)
  return new Blob([out], { type: 'application/octet-stream' })
}

async function decryptFile(file: File, password: string): Promise<Blob> {
  const buf = new Uint8Array(await file.arrayBuffer())
  const magic = buf.slice(0, 4)
  if (magic.toString() !== MAGIC.toString()) throw new Error('Not an encrypted file or wrong format.')
  const salt = buf.slice(4, 20)
  const iv = buf.slice(20, 32)
  const ciphertext = buf.slice(32)
  const key = await deriveKey(password, salt)
  let plaintext: ArrayBuffer
  try {
    plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
  } catch {
    throw new Error('Wrong password or file is corrupted.')
  }
  return new Blob([plaintext])
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function getIcon(mime: string) {
  if (mime.startsWith('image/')) return <Image className="w-5 h-5" />
  if (mime.startsWith('text/')) return <FileText className="w-5 h-5" />
  return <File className="w-5 h-5" />
}

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(2)} MB`
}

type Mode = 'encrypt' | 'decrypt'
type Status = 'idle' | 'processing' | 'done' | 'error'

// ─── Component ────────────────────────────────────────────────────────────

export default function FileCrypto() {
  const [mode, setMode] = useState<Mode>('encrypt')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [previewText, setPreviewText] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [progress, setProgress] = useState(0)
  const [resultBlob, setResultBlob] = useState<Blob | null>(null)
  const [resultName, setResultName] = useState('')
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setFile(null)
    setPreview(null)
    setPreviewText(null)
    setPassword('')
    setStatus('idle')
    setProgress(0)
    setResultBlob(null)
    setResultName('')
    setError('')
  }

  const handleMode = (m: Mode) => {
    setMode(m)
    reset()
  }

  const loadFile = useCallback(async (f: File) => {
    setFile(f)
    setResultBlob(null)
    setStatus('idle')
    setError('')
    if (f.type.startsWith('image/')) {
      setPreview(URL.createObjectURL(f))
      setPreviewText(null)
    } else if (f.type.startsWith('text/') || f.name.endsWith('.txt') || f.name.endsWith('.md')) {
      const txt = await f.text()
      setPreviewText(txt.slice(0, 1500) + (txt.length > 1500 ? '\n…(truncated)' : ''))
      setPreview(null)
    } else {
      setPreview(null)
      setPreviewText(null)
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

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) loadFile(f)
  }

  const fakeProgress = (onDone: () => void) => {
    setProgress(0)
    const steps = [10, 30, 55, 75, 90]
    let i = 0
    const id = setInterval(() => {
      if (i < steps.length) setProgress(steps[i++])
      else { clearInterval(id); onDone() }
    }, 120)
  }

  const handleProcess = async () => {
    if (!file || !password) return
    setStatus('processing')
    setError('')
    fakeProgress(async () => {
      try {
        if (mode === 'encrypt') {
          const blob = await encryptFile(file, password)
          setResultBlob(blob)
          setResultName(file.name + '.encrypted')
        } else {
          const blob = await decryptFile(file, password)
          const origName = file.name.replace(/\.encrypted$/, '') || file.name + '.decrypted'
          setResultBlob(blob)
          setResultName(origName)
        }
        setProgress(100)
        setStatus('done')
      } catch (e: unknown) {
        setStatus('error')
        setError(e instanceof Error ? e.message : 'Unknown error')
      }
    })
  }

  const handleDownload = () => {
    if (!resultBlob) return
    const url = URL.createObjectURL(resultBlob)
    const a = document.createElement('a')
    a.href = url
    a.download = resultName
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center py-12 px-4">
      {/* Header */}
      <div className="flex flex-col items-center gap-2 mb-10">
        <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center shadow-lg">
          <ShieldCheck className="w-8 h-8 text-primary-foreground" />
        </div>
        <h1 className="text-3xl font-bold text-foreground tracking-tight">File Encryptor</h1>
        <p className="text-muted-foreground text-sm text-center max-w-sm">
          AES-256-GCM encryption — everything stays in your browser, nothing is uploaded.
        </p>
      </div>

      {/* Mode toggle */}
      <div className="flex bg-secondary rounded-xl p-1 mb-8 gap-1">
        {(['encrypt', 'decrypt'] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => handleMode(m)}
            className={`flex items-center gap-2 px-6 py-2 rounded-lg font-medium text-sm transition-all ${
              mode === m
                ? 'bg-primary text-primary-foreground shadow'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {m === 'encrypt' ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
            {m.charAt(0).toUpperCase() + m.slice(1)}
          </button>
        ))}
      </div>

      <div className="w-full max-w-xl flex flex-col gap-5">
        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={`relative border-2 border-dashed rounded-2xl p-8 flex flex-col items-center gap-3 cursor-pointer transition-all
            ${dragging ? 'border-primary bg-accent' : file ? 'border-primary/50 bg-accent/40' : 'border-border bg-card hover:border-primary/50 hover:bg-accent/20'}`}
        >
          <input ref={inputRef} type="file" className="hidden" onChange={onInputChange} />
          {file ? (
            <>
              <div className="flex items-center gap-2 text-primary">{getIcon(file.type)}<span className="font-semibold text-foreground">{file.name}</span></div>
              <span className="text-xs text-muted-foreground">{fmtSize(file.size)}</span>
              <button
                onClick={(e) => { e.stopPropagation(); reset() }}
                className="absolute top-3 right-3 text-muted-foreground hover:text-destructive transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </>
          ) : (
            <>
              <Upload className="w-10 h-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground text-center">
                <span className="font-semibold text-foreground">Click to browse</span> or drag & drop a file here
              </p>
              <p className="text-xs text-muted-foreground">Any file type supported</p>
            </>
          )}
        </div>

        {/* File preview */}
        {preview && (
          <div className="rounded-2xl overflow-hidden border border-border bg-card">
            <p className="text-xs font-medium text-muted-foreground px-4 pt-3 pb-1">Preview</p>
            <img src={preview} alt="preview" className="w-full max-h-52 object-contain bg-muted/30" />
          </div>
        )}
        {previewText && (
          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="text-xs font-medium text-muted-foreground mb-2">Preview</p>
            <pre className="text-xs text-foreground whitespace-pre-wrap font-mono overflow-auto max-h-40">{previewText}</pre>
          </div>
        )}

        {/* Password */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-foreground">Password</label>
          <div className="relative">
            <input
              type={showPass ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'encrypt' ? 'Set a strong password…' : 'Enter the decryption password…'}
              className="w-full rounded-xl border border-border bg-card px-4 py-3 pr-11 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition"
            />
            <button
              type="button"
              onClick={() => setShowPass(!showPass)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {mode === 'encrypt' && (
            <p className="text-xs text-muted-foreground">⚠️ If you lose the password, the file cannot be recovered.</p>
          )}
        </div>

        {/* Action button */}
        <button
          onClick={handleProcess}
          disabled={!file || !password || status === 'processing'}
          className="w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all
            bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed shadow"
        >
          {mode === 'encrypt' ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
          {status === 'processing'
            ? 'Processing…'
            : mode === 'encrypt'
            ? 'Encrypt File'
            : 'Decrypt File'}
        </button>

        {/* Progress bar */}
        {(status === 'processing' || status === 'done') && (
          <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}

        {/* Error */}
        {status === 'error' && (
          <div className="flex items-center gap-2 rounded-xl bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Result card */}
        {status === 'done' && resultBlob && (
          <div className="rounded-2xl border border-border bg-card p-5 flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center text-primary">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <p className="font-semibold text-foreground text-sm">
                  {mode === 'encrypt' ? 'Encryption complete!' : 'Decryption complete!'}
                </p>
                <p className="text-xs text-muted-foreground truncate max-w-xs">{resultName}</p>
              </div>
            </div>
            <button
              onClick={handleDownload}
              className="w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 bg-primary text-primary-foreground hover:opacity-90 transition shadow"
            >
              <Download className="w-4 h-4" />
              Download {mode === 'encrypt' ? 'Encrypted' : 'Decrypted'} File
            </button>
          </div>
        )}
      </div>

      <p className="mt-12 text-xs text-muted-foreground text-center">
        AES-256-GCM · PBKDF2 (310,000 iterations) · 100% client-side
      </p>
    </div>
  )
}
