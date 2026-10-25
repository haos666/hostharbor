import { useEffect, useRef, type ReactNode } from 'react'

export function Dialog({ children, className = '', labelledBy, onDismiss }: {
  children: ReactNode
  className?: string
  labelledBy: string
  onDismiss: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const dismiss = useRef(onDismiss)
  dismiss.current = onDismiss
  useEffect(() => {
    const dialog = ref.current!
    const previous = document.activeElement as HTMLElement | null
    dialog.showModal()
    dialog.querySelector<HTMLElement>('[data-initial-focus]')?.focus()
    return () => { dialog.close(); previous?.isConnected && previous.focus() }
  }, [])
  return <dialog ref={ref} className={className} aria-labelledby={labelledBy}
    onCancel={(event) => { event.preventDefault(); event.stopPropagation(); dismiss.current() }}
    onClick={(event) => {
      if (event.target !== event.currentTarget) return
      const bounds = event.currentTarget.getBoundingClientRect()
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dismiss.current()
    }}>{children}</dialog>
}
