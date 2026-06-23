import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { PageLoader } from '@/components/page-loader'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  getActionStatus,
  getSkills,
  getStoreAuth,
  getStoreSkills,
  installStoreSkill,
  publishSkillToStore,
  uninstallStoreSkill
} from '@/hermes'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { notify, notifyError } from '@/store/notifications'
import type { ActionResponse, SkillInfo, StoreSkillInfo } from '@/types/hermes'

import { SETTINGS_ROUTE } from '../routes'
import { asText, includesQuery } from '../settings/helpers'

// Mirror of system-actions.ts::awaitAction — poll a backend action to
// completion (bounded), throwing on a non-zero exit so the caller can toast a
// failure. Install/publish run as detached `hermes` subprocesses whose progress
// the dashboard tails via /api/actions/<name>/status.
const POLL_ATTEMPTS = 60
const POLL_INTERVAL_MS = 1500
const POLL_TIMEOUT_S = 240

async function awaitAction(started: ActionResponse & { pid?: number }): Promise<void> {
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    await new Promise(resolve => window.setTimeout(resolve, POLL_INTERVAL_MS))
    const status = await getActionStatus(started.name, POLL_TIMEOUT_S)

    if (!status.running) {
      if (status.exit_code != null && status.exit_code !== 0) {
        const tail = status.lines.filter(Boolean).slice(-1)[0] || ''
        throw new Error(tail || `${started.name} failed`)
      }

      return
    }
  }

  throw new Error(`${started.name} timed out`)
}

function filterStore(skills: StoreSkillInfo[], query: string): StoreSkillInfo[] {
  const q = query.trim().toLowerCase()

  return skills
    .filter(skill => {
      if (!q) {
        return true
      }

      return includesQuery(skill.name, q) || includesQuery(skill.description, q)
    })
    .sort((a, b) => asText(a.name).localeCompare(asText(b.name)))
}

interface StoreViewProps {
  query: string
}

export function StoreView({ query }: StoreViewProps) {
  const { t } = useI18n()

  const [skills, setSkills] = useState<StoreSkillInfo[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [publishDialogOpen, setPublishDialogOpen] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setSkills(await getStoreSkills())
    } catch (err) {
      notifyError(err, t.skills.storeLoadFailed)
      setSkills([])
    }
  }, [t])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const visible = useMemo(() => (skills ? filterStore(skills, query) : []), [query, skills])

  async function handleInstall(skill: StoreSkillInfo) {
    setBusy(skill.identifier)

    try {
      await awaitAction(await installStoreSkill(skill.identifier))
      setSkills(current =>
        current?.map(row => (row.identifier === skill.identifier ? { ...row, installed: true } : row)) ?? current
      )
      notify({ kind: 'success', message: t.skills.skillInstalled(skill.name) })
    } catch (err) {
      notifyError(err, t.skills.skillInstallFailed(skill.name))
    } finally {
      setBusy(null)
    }
  }

  async function handleUninstall(skill: StoreSkillInfo) {
    setBusy(skill.identifier)

    try {
      await awaitAction(await uninstallStoreSkill(skill.name))
      setSkills(current =>
        current?.map(row => (row.identifier === skill.identifier ? { ...row, installed: false } : row)) ?? current
      )
      notify({ kind: 'success', message: t.skills.skillUninstalled(skill.name) })
    } catch (err) {
      notifyError(err, t.skills.skillUninstallFailed(skill.name))
    } finally {
      setBusy(null)
    }
  }

  function handlePublish() {
    setPublishDialogOpen(true)
  }

  if (!skills) {
    return <PageLoader label={t.skills.loading} />
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">{t.skills.publishPickSkill}</div>
        <Button onClick={handlePublish} size="xs" type="button" variant="secondary">
          <Codicon name="cloud-upload" size="0.8125rem" />
          {t.skills.publish}
        </Button>
      </div>

      {visible.length === 0 ? (
        <EmptyState description={t.skills.storeEmptyDesc} title={t.skills.storeEmptyTitle} />
      ) : (
        <div>
          {visible.map(skill => {
            const isBusy = busy === skill.identifier

            return (
              <div
                className="grid gap-3 px-0 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                key={skill.identifier}
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{skill.name}</div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {asText(skill.description) || t.skills.noDescription}
                  </p>
                </div>
                {skill.installed ? (
                  <Button
                    className={cn('justify-self-start sm:justify-self-end')}
                    disabled={isBusy}
                    onClick={() => void handleUninstall(skill)}
                    size="xs"
                    type="button"
                    variant="outline"
                  >
                    {isBusy ? t.skills.uninstalling : t.skills.uninstall}
                  </Button>
                ) : (
                  <Button
                    className={cn('justify-self-start sm:justify-self-end')}
                    disabled={isBusy}
                    onClick={() => void handleInstall(skill)}
                    size="xs"
                    type="button"
                    variant="secondary"
                  >
                    {isBusy ? t.skills.installing : t.skills.install}
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      )}
      <PublishDialog
        onClose={() => setPublishDialogOpen(false)}
        onPublished={refresh}
        open={publishDialogOpen}
      />
    </div>
  )
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="grid min-h-52 place-items-center text-center">
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="mt-1 text-xs text-muted-foreground">{description}</div>
      </div>
    </div>
  )
}

function PublishDialog({
  open,
  onClose,
  onPublished
}: {
  open: boolean
  onClose: () => void
  onPublished: () => void
}) {
  const { t } = useI18n()
  const navigate = useNavigate()

  const [step, setStep] = useState<'confirm' | 'init' | 'select'>('init')
  const [localSkills, setLocalSkills] = useState<SkillInfo[]>([])
  const [selected, setSelected] = useState<SkillInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!open) {return}
    setStep('init')
    setSelected(null)
    setError(null)
    setBusy(false)
    setSearch('')

    getStoreAuth()
      .then(auth => {
        if (!auth.authenticated) {
          setError('auth')

          return
        }

        getSkills()
          .then(skills => {
            if (skills.length === 0) {
              setError('empty')

              return
            }

            setLocalSkills(skills)
            setStep('select')
          })
          .catch(() => setError('load-failed'))
      })
      .catch(() => setError('auth-failed'))
  }, [open])

  function handleSelect(skill: SkillInfo) {
    setSelected(skill)
    setStep('confirm')
  }

  function handleBack() {
    setSelected(null)
    setStep('select')
  }

  async function handlePublishConfirm() {
    if (!selected) {return}
    setBusy(true)

    try {
      await awaitAction(await publishSkillToStore(selected.name))
      notify({ kind: 'success', message: t.skills.skillPublished(selected.name) })
      onPublished()
      onClose()
    } catch (err) {
      notifyError(err, t.skills.skillPublishFailed(selected.name))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog onOpenChange={value => !value && !busy && onClose()} open={open}>
      <DialogContent className="max-w-md">
        {error === 'auth' ? (
          <>
            <DialogHeader>
              <DialogTitle>{t.skills.storeAuthMissingTitle}</DialogTitle>
              <DialogDescription>{t.skills.storeAuthMissingDesc}</DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2">
              <Button onClick={onClose} size="xs" type="button" variant="ghost">
                {t.common.cancel}
              </Button>
              <Button
                onClick={() => {
                  onClose()
                  navigate(`${SETTINGS_ROUTE}?tab=keys`)
                }}
                size="xs"
                type="button"
                variant="secondary"
              >
                {t.skills.storeAuthConfigure}
              </Button>
            </div>
          </>
        ) : error === 'empty' ? (
          <>
            <DialogHeader>
              <DialogTitle>{t.skills.publish}</DialogTitle>
              <DialogDescription>{t.skills.publishNoLocalSkills}</DialogDescription>
            </DialogHeader>
            <div className="flex justify-end">
              <Button onClick={onClose} size="xs" type="button" variant="ghost">
                {t.common.cancel}
              </Button>
            </div>
          </>
        ) : error === 'load-failed' || error === 'auth-failed' ? (
          <>
            <DialogHeader>
              <DialogTitle>{t.skills.publish}</DialogTitle>
              <DialogDescription>{t.skills.storeLoadFailed}</DialogDescription>
            </DialogHeader>
            <div className="flex justify-end">
              <Button onClick={onClose} size="xs" type="button" variant="ghost">
                {t.common.cancel}
              </Button>
            </div>
          </>
        ) : step === 'select' ? (
          <>
            <DialogHeader>
              <DialogTitle>{t.skills.publishPickSkill}</DialogTitle>
              <DialogDescription>{t.skills.publishPickPlaceholder}</DialogDescription>
            </DialogHeader>
            <input
              autoFocus
              className="w-full rounded-md border border-(--ui-border-primary) bg-(--ui-bg-secondary) px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:border-(--ui-ring) focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-(--ui-ring)"
              onChange={e => setSearch(e.target.value)}
              placeholder={t.skills.searchSkills}
              type="search"
              value={search}
            />
            <div className="max-h-64 space-y-0.5 overflow-y-auto">
              {localSkills
                .filter(s => {
                  if (!search.trim()) {return true}
                  const q = search.trim().toLowerCase()

                  return s.name.toLowerCase().includes(q) || (s.description && asText(s.description).toLowerCase().includes(q))
                })
                .map(skill => (
                <button
                  className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-(--ui-bg-quaternary) focus-visible:bg-(--ui-bg-quaternary) focus-visible:outline-none"
                  key={skill.name}
                  onClick={() => handleSelect(skill)}
                  type="button"
                >
                  <div className="font-medium">{skill.name}</div>
                  {skill.description && (
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {asText(skill.description)}
                    </div>
                  )}
                </button>
              ))}
            </div>
            <div className="flex justify-end">
              <Button onClick={onClose} size="xs" type="button" variant="ghost">
                {t.common.cancel}
              </Button>
            </div>
          </>
        ) : step === 'confirm' && selected ? (
          <>
            <DialogHeader>
              <DialogTitle>{t.skills.publish}</DialogTitle>
              <DialogDescription>{t.skills.publishConfirm(selected.name)}</DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2">
              <Button disabled={busy} onClick={handleBack} size="xs" type="button" variant="ghost">
                {t.common.cancel}
              </Button>
              <Button
                disabled={busy}
                onClick={() => void handlePublishConfirm()}
                size="xs"
                type="button"
                variant="secondary"
              >
                {busy ? t.skills.publishing : t.skills.publish}
              </Button>
            </div>
          </>
        ) : (
          <PageLoader label={t.skills.loading} />
        )}
      </DialogContent>
    </Dialog>
  )
}
