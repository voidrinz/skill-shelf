interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export function getTrayPanelBounds(
  anchor: Rect,
  workArea: Rect,
  size = { width: 392, height: 540 }
): Rect {
  const gap = 8
  const width = Math.min(size.width, Math.max(1, workArea.width - gap * 2))
  const height = Math.min(size.height, Math.max(1, workArea.height - gap * 2))
  const clamp = (
    value: number,
    start: number,
    length: number,
    extent: number
  ) =>
    Math.round(
      Math.max(start + gap, Math.min(value, start + extent - length - gap))
    )
  const below = anchor.y + anchor.height + gap
  const y =
    below + height <= workArea.y + workArea.height - gap
      ? below
      : anchor.y - height - gap
  return {
    x: clamp(
      anchor.x + anchor.width / 2 - width / 2,
      workArea.x,
      width,
      workArea.width
    ),
    y: clamp(y, workArea.y, height, workArea.height),
    width,
    height,
  }
}
