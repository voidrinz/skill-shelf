import { useState } from 'react'
import { Cloud, Monitor, LoaderCircle } from 'lucide-react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@skill-shelf/ui'
import { useI18n } from '@skill-shelf/i18n/react'
import type {
  SyncCloudSnapshot,
  SyncImportStrategy,
} from '../../shared/sync-contract'

export function SyncCloudBrowser({
  snapshots,
  busy,
  open = true,
  onClose,
  onPreview,
}: {
  snapshots: SyncCloudSnapshot[]
  busy: boolean
  open?: boolean
  onClose: () => void
  onPreview: (id: string, strategy: SyncImportStrategy) => void
}) {
  const { t, date } = useI18n()
  const [selected, setSelected] = useState(snapshots[0]?.id ?? '')
  const [strategy, setStrategy] = useState<SyncImportStrategy>('merge')
  const shared = snapshots.find((snapshot) => snapshot.kind === 'shared')
  const history = snapshots.filter((snapshot) => snapshot.kind === 'device')
  const selectedSnapshot = snapshots.find(
    (snapshot) => snapshot.id === selected
  )
  const snapshotDate = (snapshot: SyncCloudSnapshot) =>
    date(snapshot.exportedAt, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
  const sourceName = (snapshot: SyncCloudSnapshot) =>
    snapshot.source?.deviceName ?? t('desktop.sync.unknownSource')
  const selectedSource = selectedSnapshot
    ? selectedSnapshot.kind === 'shared'
      ? t('desktop.sync.sharedSnapshot')
      : t('desktop.sync.historySource', {
          date: snapshotDate(selectedSnapshot),
          name: sourceName(selectedSnapshot),
        })
    : ''
  const snapshotOption = (snapshot: SyncCloudSnapshot) => (
    <label
      key={snapshot.id}
      className="sync-cloud-item"
      data-selected={selected === snapshot.id}
    >
      {snapshot.kind === 'shared' ? (
        <Cloud aria-hidden="true" />
      ) : (
        <Monitor aria-hidden="true" />
      )}
      <span className="sync-cloud-item-body">
        <span className="sync-cloud-item-heading">
          <strong>
            {snapshot.kind === 'shared' ? (
              t('desktop.sync.sharedSnapshot')
            ) : (
              <time dateTime={snapshot.exportedAt}>
                {snapshotDate(snapshot)}
              </time>
            )}
          </strong>
          <small className="sync-cloud-item-counts">
            {t('desktop.sync.snapshotCounts', {
              skills: snapshot.skills,
              packs: snapshot.packs,
            })}
          </small>
        </span>
        <small className="sync-cloud-item-detail">
          {snapshot.kind === 'shared'
            ? t('desktop.sync.sharedSnapshotDescription')
            : t('desktop.sync.deviceSnapshot', { name: sourceName(snapshot) })}
        </small>
      </span>
      <input
        type="radio"
        disabled={busy}
        name="sync-cloud-snapshot"
        value={snapshot.id}
        checked={selected === snapshot.id}
        onChange={() => setSelected(snapshot.id)}
      />
    </label>
  )
  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent
        className="sync-preview-dialog sync-cloud-dialog"
        closeLabel={t('common.close')}
        onInteractOutside={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest('[data-slot="toaster"]')
          )
            event.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('desktop.sync.cloudTitle')}</DialogTitle>
          <DialogDescription>
            {t('desktop.sync.cloudDescription')}
          </DialogDescription>
        </DialogHeader>
        <div className="sync-preview-scroll">
          {snapshots.length ? (
            <div
              className="sync-cloud-list"
              role="group"
              aria-label={t('desktop.sync.chooseSnapshot')}
            >
              <h3 className="sync-cloud-source-heading">
                {t('desktop.sync.chooseSnapshot')}
              </h3>
              {shared ? snapshotOption(shared) : null}
              <div className="sync-cloud-history">
                <h4>
                  {t('desktop.sync.uploadHistory', { count: history.length })}
                </h4>
                <p>{t('desktop.sync.uploadHistoryDescription')}</p>
                {history.length ? (
                  <div className="sync-cloud-list-scroll">
                    {history.map(snapshotOption)}
                  </div>
                ) : (
                  <p>{t('desktop.sync.uploadHistoryEmpty')}</p>
                )}
              </div>
            </div>
          ) : (
            <p className="sync-warning">{t('desktop.sync.cloudEmpty')}</p>
          )}
          {snapshots.length ? (
            <fieldset className="sync-import-strategy" disabled={busy}>
              <legend>{t('desktop.sync.importStrategy')}</legend>
              <p className="sync-import-source">
                {t('desktop.sync.selectedCloudSource', {
                  source: selectedSource,
                })}
              </p>
              {(['merge', 'replace'] as const).map((value) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="sync-import-strategy"
                    checked={strategy === value}
                    onChange={() => setStrategy(value)}
                  />
                  <span>
                    <strong>
                      {t(
                        value === 'merge'
                          ? 'desktop.sync.mergeStrategy'
                          : 'desktop.sync.replaceStrategy'
                      )}
                    </strong>
                    <small>
                      {t(
                        value === 'merge'
                          ? 'desktop.sync.mergeStrategyDescription'
                          : 'desktop.sync.replaceStrategyDescription'
                      )}
                    </small>
                  </span>
                </label>
              ))}
            </fieldset>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={busy || !selected}
            onClick={() => onPreview(selected, strategy)}
          >
            {busy ? <LoaderCircle className="animate-spin" /> : null}
            {t('desktop.sync.previewChanges')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
