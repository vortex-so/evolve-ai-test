"use client"

import * as React from "react"

import { Button } from "@vortex/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@vortex/ui/components/dialog"

type ConfirmDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => Promise<void> | void
  variant?: "destructive" | "default"
  loading?: boolean
}

function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  variant = "default",
  loading,
}: ConfirmDialogProps) {
  const [internalPending, setInternalPending] = React.useState(false)
  const pending = loading ?? internalPending

  const handleConfirm = async () => {
    if (loading !== undefined) {
      await onConfirm()
      return
    }

    try {
      setInternalPending(true)
      await onConfirm()
      onOpenChange(false)
    } finally {
      setInternalPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (pending ? undefined : onOpenChange(nextOpen))}>
      <DialogContent showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription asChild>
            <div>{description}</div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button variant={variant} onClick={handleConfirm} disabled={pending}>
            {pending ? "Working..." : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { ConfirmDialog, type ConfirmDialogProps }
