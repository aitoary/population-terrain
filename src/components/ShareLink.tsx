import { useState } from 'react';

export function ShareLink({ disabled }: { disabled: boolean }) {
  const [status, setStatus] = useState<'idle' | 'copying' | 'success' | 'error'>('idle');

  async function copy() {
    setStatus('copying');
    try {
      await navigator.clipboard.writeText(window.location.href);
      setStatus('success');
    } catch {
      // Includes denied permission and browsers without the Clipboard API.
      setStatus('error');
    }
  }

  return <div className="share-link">
    <button type="button" disabled={disabled || status === 'copying'} onClick={() => void copy()}>この表示をコピー</button>
    <p className={`share-message${status === 'error' ? ' error-message' : ' muted'}`} role={status === 'error' ? 'alert' : 'status'} aria-atomic="true" data-testid="share-status" data-state={status}>
      {disabled ? '人口データの読込後にコピーできます。' : status === 'copying' ? 'コピー中…' : status === 'success' ? '共有リンクをコピーしました。' : status === 'error' ? 'リンクをコピーできませんでした。ブラウザーのアドレス欄からURLをコピーしてください。' : ''}
    </p>
  </div>;
}
