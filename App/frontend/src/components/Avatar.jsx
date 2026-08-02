// Avatar: shows an uploaded profile photo when present, otherwise a deterministic
// GitHub-style identicon derived from the user id. Fully offline — no external service.

// Small, fast string hash (FNV-1a) — deterministic across sessions and devices.
function hash(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// Build a 5x5 mirrored identicon (like GitHub). Returns { cells, color }.
function identicon(seed) {
  const h = hash(seed || 'anon')
  const hue = h % 360
  const color = `hsl(${hue} 62% 52%)`
  // 15 bits (left 3 columns x 5 rows), mirrored to the right — stable per id.
  const cells = []
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      const bit = (h >> (y * 3 + x)) & 1
      const on = !!bit
      cells.push({ x, y, on })
      if (x < 2) cells.push({ x: 4 - x, y, on })
    }
  }
  return { cells, color }
}

export default function Avatar({ id, name, src, size = 40, round = true, className = '', style }) {
  const wrap = {
    width: size, height: size, flex: 'none', borderRadius: round ? '50%' : 'var(--r-sm)',
    overflow: 'hidden', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: 'var(--surface-2)', ...style
  }
  if (src) {
    return <span className={className} style={wrap}>
      <img src={src} alt={name || ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    </span>
  }
  const { cells, color } = identicon(id || name || '')
  const pad = 0.6
  const cell = (size - pad * 2) / 5
  return <span className={className} style={wrap} aria-label={name || 'avatar'}>
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ background: 'var(--surface-3)' }}>
      {cells.map((c, i) => c.on && (
        <rect key={i} x={pad + c.x * cell} y={pad + c.y * cell} width={cell} height={cell} fill={color} />
      ))}
    </svg>
  </span>
}
