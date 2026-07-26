import { CloudOff, Copy, Download, KeyRound, Loader2, Lock, LogOut, RefreshCw, ShieldCheck, Unlock, Upload, UserRound, X } from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  fetchVaultEnvelope, saveVaultEnvelope, sendPasswordReset, signIn, signOut, signUp, updateAccountPassword,
} from './account'
import { db } from './db'
import type { Translate } from './i18n'
import { supabase } from './supabaseClient'
import { requestSync, startSyncLoop, SYNC_EVENT, syncPhase, type SyncPhase } from './sync'
import {
  changePassphrase, createVault, isVaultUnlocked, lockVault,
  unlockWithPassphrase, unlockWithRecoveryPhrase, VAULT_CHANGE_EVENT, type VaultEnvelope,
} from './vault'
import {
  adoptCloudWorkspace, cloudHasRecords, exportEncryptedBackup, importLocalWorkspace,
  localWorkspaceSummary, restoreEncryptedBackup,
} from './workspace'

type AuthView = 'signin' | 'signup' | 'reset'

function useSession() {
  const [session, setSession] = useState<Session | null>(null)
  const [recoveryMode, setRecoveryMode] = useState(false)
  useEffect(() => {
    if (!supabase) return
    void supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: subscription } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next)
      if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true)
    })
    return () => subscription.subscription.unsubscribe()
  }, [])
  return { session, recoveryMode, setRecoveryMode }
}

function useVaultUnlocked() {
  const [unlocked, setUnlocked] = useState(false)
  useEffect(() => {
    const refresh = () => void isVaultUnlocked().then(setUnlocked)
    refresh()
    window.addEventListener(VAULT_CHANGE_EVENT, refresh)
    return () => window.removeEventListener(VAULT_CHANGE_EVENT, refresh)
  }, [])
  return unlocked
}

function useSyncPhase(): SyncPhase {
  const [phase, setPhase] = useState<SyncPhase>('idle')
  useEffect(() => {
    const refresh = () => setPhase(syncPhase().phase)
    refresh()
    window.addEventListener(SYNC_EVENT, refresh)
    return () => window.removeEventListener(SYNC_EVENT, refresh)
  }, [])
  return phase
}

export default function AccountControl({ t }: { t: Translate }) {
  const [open, setOpen] = useState(false)
  const { session, recoveryMode, setRecoveryMode } = useSession()
  const unlocked = useVaultUnlocked()
  const phase = useSyncPhase()

  useEffect(() => {
    if (session && unlocked) startSyncLoop()
  }, [session, unlocked])

  useEffect(() => {
    if (recoveryMode) setOpen(true)
  }, [recoveryMode])

  if (!supabase) return null

  const statusIcon = !session
    ? <UserRound size={16} />
    : !unlocked
      ? <Lock size={16} />
      : phase === 'offline'
        ? <CloudOff size={16} />
        : phase === 'syncing'
          ? <RefreshCw size={16} className="spin" />
          : <ShieldCheck size={16} />

  return (
    <>
      <button aria-label={t('account')} className={`account-button ${session ? 'account-signed-in' : ''}`} onClick={() => setOpen(true)} title={t('account')}>
        {statusIcon}
      </button>
      {open && (
        <AccountModal
          onClose={() => { setOpen(false); setRecoveryMode(false) }}
          recoveryMode={recoveryMode}
          session={session}
          t={t}
          unlocked={unlocked}
        />
      )}
    </>
  )
}

function AccountModal({ session, unlocked, recoveryMode, onClose, t }: {
  session: Session | null
  unlocked: boolean
  recoveryMode: boolean
  onClose: () => void
  t: Translate
}) {
  return (
    <div aria-modal="true" className="account-overlay" onClick={(event) => { if (event.target === event.currentTarget) onClose() }} role="dialog">
      <div className="account-modal">
        <header>
          <h2>{t('account')}</h2>
          <button aria-label={t('close')} className="action-button" onClick={onClose}><X size={17} /></button>
        </header>
        {recoveryMode && session
          ? <NewPasswordForm t={t} />
          : !session
            ? <AuthForms t={t} />
            : <SignedIn onClose={onClose} session={session} t={t} unlocked={unlocked} />}
      </div>
    </div>
  )
}

/* ---------------------------- signed out --------------------------- */

function AuthForms({ t }: { t: Translate }) {
  const [view, setView] = useState<AuthView>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setError(''); setMessage('')
    try {
      if (view === 'signin') await signIn(email.trim(), password)
      else if (view === 'signup') { await signUp(email.trim(), password); setMessage(t('checkEmailVerify')) }
      else { await sendPasswordReset(email.trim()); setMessage(t('resetSent')) }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errorGeneric'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="account-form" onSubmit={submit}>
      <p className="account-hint">{t('localModeHint')}</p>
      <label><span>{t('email')}</span>
        <input autoComplete="email" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
      </label>
      {view !== 'reset' && (
        <label><span>{t('password')}</span>
          <input autoComplete={view === 'signup' ? 'new-password' : 'current-password'} minLength={8} onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />
        </label>
      )}
      {error && <p className="account-error" role="alert">{error}</p>}
      {message && <p className="account-message" role="status">{message}</p>}
      <button className="account-primary" disabled={busy} type="submit">
        {busy ? <Loader2 size={15} className="spin" /> : null}
        {view === 'signin' ? t('signIn') : view === 'signup' ? t('signUp') : t('sendResetLink')}
      </button>
      <div className="account-links">
        {view !== 'signup' && <button onClick={() => { setView('signup'); setError('') }} type="button">{t('noAccount')} {t('signUp')}</button>}
        {view !== 'signin' && <button onClick={() => { setView('signin'); setError('') }} type="button">{t('haveAccount')} {t('signIn')}</button>}
        {view === 'signin' && <button onClick={() => { setView('reset'); setError('') }} type="button">{t('forgotPassword')}</button>}
      </div>
    </form>
  )
}

function NewPasswordForm({ t }: { t: Translate }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      await updateAccountPassword(password)
      setMessage(t('passwordUpdated'))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errorGeneric'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="account-form" onSubmit={submit}>
      <label><span>{t('newAccountPassword')}</span>
        <input autoComplete="new-password" minLength={8} onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />
      </label>
      {error && <p className="account-error" role="alert">{error}</p>}
      {message && <p className="account-message" role="status">{message}</p>}
      <button className="account-primary" disabled={busy} type="submit">{t('updatePassword')}</button>
    </form>
  )
}

/* ---------------------------- signed in ---------------------------- */

function SignedIn({ session, unlocked, onClose, t }: { session: Session; unlocked: boolean; onClose: () => void; t: Translate }) {
  const [envelope, setEnvelope] = useState<VaultEnvelope | null | 'loading'>('loading')

  const reloadEnvelope = useCallback(() => {
    setEnvelope('loading')
    fetchVaultEnvelope().then(setEnvelope).catch(() => setEnvelope(null))
  }, [])
  useEffect(reloadEnvelope, [reloadEnvelope])

  if (envelope === 'loading') return <p className="account-hint"><Loader2 size={15} className="spin" /> {t('loadingLabel')}</p>
  if (!envelope) return <VaultCreate onCreated={reloadEnvelope} t={t} />
  if (!unlocked) return <VaultUnlock envelope={envelope} t={t} />
  return <VaultReady envelope={envelope} onClose={onClose} session={session} t={t} />
}

function VaultCreate({ onCreated, t }: { onCreated: () => void; t: Translate }) {
  const [passphrase, setPassphrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [recoveryPhrase, setRecoveryPhrase] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (passphrase.length < 8) { setError(t('weakPassphrase')); return }
    if (passphrase !== confirm) { setError(t('passphraseMismatch')); return }
    setBusy(true); setError('')
    try {
      const { envelope, recoveryPhrase: phrase } = await createVault(passphrase)
      await saveVaultEnvelope(envelope)
      setRecoveryPhrase(phrase)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errorGeneric'))
      await lockVault()
    } finally {
      setBusy(false)
    }
  }

  if (recoveryPhrase) {
    return <RecoveryReveal onDone={onCreated} phrase={recoveryPhrase} t={t} />
  }

  return (
    <form className="account-form" onSubmit={submit}>
      <h3>{t('vaultCreateTitle')}</h3>
      <p className="account-hint">{t('vaultCreateHint')}</p>
      <label><span>{t('vaultPassphrase')}</span>
        <input autoComplete="new-password" minLength={8} onChange={(event) => setPassphrase(event.target.value)} required type="password" value={passphrase} />
      </label>
      <label><span>{t('vaultConfirmPassphrase')}</span>
        <input autoComplete="new-password" minLength={8} onChange={(event) => setConfirm(event.target.value)} required type="password" value={confirm} />
      </label>
      {error && <p className="account-error" role="alert">{error}</p>}
      <button className="account-primary" disabled={busy} type="submit">
        {busy ? <Loader2 size={15} className="spin" /> : <KeyRound size={15} />} {t('vaultCreateTitle')}
      </button>
    </form>
  )
}

function RecoveryReveal({ phrase, onDone, t }: { phrase: string; onDone: () => void; t: Translate }) {
  const words = phrase.split(' ')
  const [copied, setCopied] = useState(false)
  return (
    <div className="account-form">
      <h3>{t('recoveryTitle')}</h3>
      <p className="account-hint">{t('recoveryIntro')}</p>
      <ol className="recovery-words" dir="ltr">
        {words.map((word, index) => <li key={index}>{word}</li>)}
      </ol>
      <button className="account-secondary" onClick={() => {
        void navigator.clipboard?.writeText(phrase).then(() => setCopied(true))
      }} type="button"><Copy size={14} /> {copied ? '✓' : 'Copier / Copy'}</button>
      <p className="account-warning" role="alert">{t('recoveryWarning')}</p>
      <button className="account-primary" onClick={onDone} type="button">{t('recoveryConfirm')}</button>
    </div>
  )
}

function VaultUnlock({ envelope, t }: { envelope: VaultEnvelope; t: Translate }) {
  const [secret, setSecret] = useState('')
  const [useRecovery, setUseRecovery] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      if (useRecovery) await unlockWithRecoveryPhrase(envelope, secret)
      else await unlockWithPassphrase(envelope, secret)
      requestSync(0)
    } catch {
      setError(t('wrongSecret'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="account-form" onSubmit={submit}>
      <h3>{t('vaultUnlockTitle')}</h3>
      <p className="account-hint">{t('vaultUnlockHint')}</p>
      <label><span>{useRecovery ? t('recoveryTitle') : t('vaultPassphrase')}</span>
        {useRecovery
          ? <textarea dir="ltr" onChange={(event) => setSecret(event.target.value)} placeholder={t('recoveryPlaceholder')} rows={3} value={secret} />
          : <input autoComplete="current-password" onChange={(event) => setSecret(event.target.value)} required type="password" value={secret} />}
      </label>
      {error && <p className="account-error" role="alert">{error}</p>}
      <button className="account-primary" disabled={busy || !secret.trim()} type="submit">
        {busy ? <Loader2 size={15} className="spin" /> : <Unlock size={15} />} {t('unlock')}
      </button>
      <div className="account-links">
        <button onClick={() => { setUseRecovery((value) => !value); setSecret(''); setError('') }} type="button">
          {useRecovery ? t('vaultPassphrase') : t('useRecovery')}
        </button>
      </div>
    </form>
  )
}

/* ----------------------- unlocked main screen ---------------------- */

function VaultReady({ session, envelope, onClose, t }: { session: Session; envelope: VaultEnvelope; onClose: () => void; t: Translate }) {
  const phase = useSyncPhase()
  const [importChoice, setImportChoice] = useState<'none' | 'offer-import' | 'offer-adopt'>('none')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [showPassphraseForm, setShowPassphraseForm] = useState(false)
  const restoreInput = useRef<HTMLInputElement>(null)
  const [backupPassword, setBackupPassword] = useState('')

  useEffect(() => {
    void (async () => {
      const pulled = await db.appMeta.get('initialPullDone')
      if (pulled) return
      const [remote, local] = await Promise.all([cloudHasRecords(), localWorkspaceSummary()])
      if (remote && local.total > 0) setImportChoice('offer-adopt')
      else if (!remote && local.total > 0) setImportChoice('offer-import')
      else requestSync(0)
    })().catch(() => undefined)
  }, [])

  const phaseLabel = phase === 'syncing' ? t('syncSyncing')
    : phase === 'offline' ? t('syncOffline')
      : phase === 'locked' ? t('syncLocked')
        : phase === 'error' ? `${t('syncError')} — ${syncPhase().lastError}` : t('syncUpToDate')

  async function run(action: () => Promise<unknown>, done = '') {
    setBusy(true); setError(''); setNotice('')
    try {
      await action()
      if (done) setNotice(done)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errorGeneric'))
    } finally {
      setBusy(false)
    }
  }

  async function downloadBackup() {
    if (!backupPassword) return
    await run(async () => {
      const blob = await exportEncryptedBackup(backupPassword)
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `daybook-backup-${new Date().toISOString().slice(0, 10)}.json`
      link.click()
      URL.revokeObjectURL(link.href)
      setBackupPassword('')
    })
  }

  async function restoreBackup(file?: File) {
    if (!file || !backupPassword) return
    if (!window.confirm(t('restoreConfirm'))) return
    const content = await file.text()
    await run(async () => {
      await restoreEncryptedBackup(content, backupPassword)
      requestSync(0)
      setBackupPassword('')
    }, t('backupRestored'))
  }

  if (importChoice !== 'none') {
    return (
      <div className="account-form">
        <h3>{t('importChoiceTitle')}</h3>
        {importChoice === 'offer-adopt' ? (
          <>
            <button className="account-primary" disabled={busy} onClick={() => void run(async () => { await adoptCloudWorkspace(); setImportChoice('none') })} type="button">
              {t('adoptCloudAction')}
            </button>
            <p className="account-hint">{t('adoptCloudHint')}</p>
            <button className="account-secondary" disabled={busy} onClick={() => void run(async () => { await importLocalWorkspace(); setImportChoice('none') })} type="button">
              {t('importLocalAction')}
            </button>
            <p className="account-hint">{t('importLocalHint')}</p>
          </>
        ) : (
          <>
            <button className="account-primary" disabled={busy} onClick={() => void run(async () => { await importLocalWorkspace(); setImportChoice('none') })} type="button">
              {t('importLocalAction')}
            </button>
            <p className="account-hint">{t('importLocalHint')}</p>
          </>
        )}
        <button className="account-links-button" onClick={() => setImportChoice('none')} type="button">{t('keepLocalAction')}</button>
        {error && <p className="account-error" role="alert">{error}</p>}
      </div>
    )
  }

  return (
    <div className="account-form">
      <p className="account-identity"><ShieldCheck size={15} /> {session.user.email}</p>
      <p className={`sync-status sync-${phase}`} role="status">{phaseLabel}</p>

      <div className="account-actions">
        <button className="account-secondary" disabled={busy} onClick={() => void run(async () => lockVault())} type="button">
          <Lock size={14} /> {t('lockVaultLabel')}
        </button>
        <button className="account-secondary" disabled={busy} onClick={() => void run(async () => { await signOut(); onClose() })} type="button">
          <LogOut size={14} /> {t('signOutLabel')}
        </button>
      </div>

      <section className="account-section">
        <h4>{t('backupTitle')}</h4>
        <label><span>{t('backupPassword')}</span>
          <input autoComplete="off" onChange={(event) => setBackupPassword(event.target.value)} type="password" value={backupPassword} />
        </label>
        <p className="account-hint">{t('backupHint')}</p>
        <div className="account-actions">
          <button className="account-secondary" disabled={busy || backupPassword.length < 8} onClick={() => void downloadBackup()} type="button">
            <Download size={14} /> {t('exportBackup')}
          </button>
          <button className="account-secondary" disabled={busy || backupPassword.length < 8} onClick={() => restoreInput.current?.click()} type="button">
            <Upload size={14} /> {t('importBackup')}
          </button>
          <input accept="application/json" hidden onChange={(event) => void restoreBackup(event.target.files?.[0])} ref={restoreInput} type="file" />
        </div>
      </section>

      <section className="account-section">
        <button className="account-links-button" onClick={() => setShowPassphraseForm((value) => !value)} type="button">
          <KeyRound size={14} /> {t('changePassphrase')}
        </button>
        {showPassphraseForm && <PassphraseChange envelope={envelope} t={t} />}
      </section>

      {notice && <p className="account-message" role="status">{notice}</p>}
      {error && <p className="account-error" role="alert">{error}</p>}
    </div>
  )
}

function PassphraseChange({ envelope, t }: { envelope: VaultEnvelope; t: Translate }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (next.length < 8) { setError(t('weakPassphrase')); return }
    setBusy(true); setError('')
    try {
      const updated = await changePassphrase(envelope, { passphrase: current }, next)
      await saveVaultEnvelope(updated)
      setDone(true); setCurrent(''); setNext('')
    } catch {
      setError(t('wrongSecret'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="account-form" onSubmit={submit}>
      <label><span>{t('currentPassphrase')}</span>
        <input autoComplete="current-password" onChange={(event) => setCurrent(event.target.value)} required type="password" value={current} />
      </label>
      <label><span>{t('newPassphrase')}</span>
        <input autoComplete="new-password" minLength={8} onChange={(event) => setNext(event.target.value)} required type="password" value={next} />
      </label>
      {error && <p className="account-error" role="alert">{error}</p>}
      {done && <p className="account-message" role="status">✓</p>}
      <button className="account-primary" disabled={busy} type="submit">{t('save')}</button>
    </form>
  )
}
