import { useEffect, useState } from 'react'
import { Check, LoaderCircle } from 'lucide-react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '@skill-shelf/ui'
import { useI18n } from '@skill-shelf/i18n/react'

const COLORS = [
  '#ed6a4a',
  '#cb8b24',
  '#358b68',
  '#3e77c7',
  '#8a63a8',
  '#767672',
]

export function FinderFolderDialog({
  open,
  name: initialName,
  color: initialColor,
  existingNames = [],
  onOpenChange,
  onSave,
}: {
  open: boolean
  name?: string
  color?: string
  existingNames?: string[]
  onOpenChange: (open: boolean) => void
  onSave: (name: string, color: string) => Promise<boolean>
}) {
  const { t } = useI18n()
  const [name, setName] = useState(initialName ?? '')
  const [color, setColor] = useState(initialColor ?? COLORS[0]!)
  const [submitting, setSubmitting] = useState(false)
  useEffect(() => {
    if (open) {
      setName(initialName ?? '')
      setColor(initialColor ?? COLORS[0]!)
    }
  }, [open, initialName, initialColor])
  const renaming = initialName !== undefined
  const valid =
    name.trim().length > 0 &&
    name.length <= 48 &&
    !existingNames.some(
      (item) =>
        item.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase()
    )
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!submitting) onOpenChange(value)
      }}
    >
      <DialogContent className="max-w-sm" closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>
            {t(renaming ? 'desktop.folders.rename' : 'desktop.folders.create')}
          </DialogTitle>
          <DialogDescription>
            {t(
              renaming
                ? 'desktop.folders.renameDescription'
                : 'desktop.folders.createDescription'
            )}
          </DialogDescription>
        </DialogHeader>
        <form
          className="create-folder-form"
          onSubmit={async (event) => {
            event.preventDefault()
            if (!valid || submitting) return
            setSubmitting(true)
            try {
              if (await onSave(name.trim(), color)) onOpenChange(false)
            } finally {
              setSubmitting(false)
            }
          }}
        >
          <Input
            aria-label={t('desktop.folders.name')}
            autoFocus
            maxLength={48}
            onFocus={(event) => {
              if (renaming) event.currentTarget.select()
            }}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          {!renaming ? (
            <div
              className="color-picker"
              role="radiogroup"
              aria-label={t('desktop.folders.color')}
            >
              {COLORS.map((option) => (
                <button
                  key={option}
                  role="radio"
                  aria-checked={color === option}
                  onClick={() => setColor(option)}
                  style={{ background: option }}
                  type="button"
                >
                  {color === option ? <Check /> : null}
                </button>
              ))}
            </div>
          ) : null}
          <DialogFooter>
            <Button
              onClick={() => onOpenChange(false)}
              variant="ghost"
              type="button"
              disabled={submitting}
            >
              {t('common.cancel')}
            </Button>
            <Button disabled={!valid || submitting} type="submit">
              {submitting ? <LoaderCircle className="animate-spin" /> : null}
              {t(
                renaming ? 'desktop.folders.rename' : 'desktop.folders.create'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
