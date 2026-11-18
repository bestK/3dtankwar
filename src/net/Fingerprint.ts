function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Best-effort browser fingerprint used only for the 10-minute vote-kick ban.
 * The raw signals never leave the browser; only this short hash is shared.
 */
export async function computeBrowserFingerprint(): Promise<string> {
  const parts: string[] = [
    navigator.userAgent,
    navigator.language,
    (navigator.languages || []).join(','),
    `${screen.width}x${screen.height}x${screen.colorDepth}`,
    String(window.devicePixelRatio || 1),
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    String(navigator.hardwareConcurrency || 0),
    String((navigator as Navigator & { deviceMemory?: number }).deviceMemory || 0),
    String(navigator.maxTouchPoints || 0),
  ];

  try {
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 60;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.textBaseline = 'top';
      ctx.font = '16px "Arial"';
      ctx.fillStyle = '#f60';
      ctx.fillRect(0, 0, 240, 60);
      ctx.fillStyle = '#069';
      ctx.fillText('装甲战线1985-tank', 4, 8);
      ctx.strokeStyle = 'rgba(102,204,0,0.7)';
      ctx.arc(190, 32, 20, 0, Math.PI * 2);
      ctx.stroke();
      parts.push(canvas.toDataURL().slice(-96));
    }
  } catch {
    // Canvas can be blocked by privacy settings; the other signals still work.
  }

  const raw = parts.join('|');
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 16);
  } catch {
    return `${fnv1a(raw)}${fnv1a(`${raw}#tank`)}`;
  }
}
