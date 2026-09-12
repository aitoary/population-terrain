import { useState } from 'react';
import { sharedViewUrl, type SharedView } from '../domain/shareLink';

export function ShareLink({ disabled, view, label = 'この表示をコピー', statusTestId = 'share-status' }: {
  disabled: boolean; view?: SharedView; label?: string; statusTestId?: string;
}) {
  const [status, setStatus] = useState<'idle' | 'copying' | 'success' | 'error'>('idle');
  const [manualUrl, setManualUrl] = useState('');

  async function copy() {
    const url = view ? sharedViewUrl(window.location.href, view) : window.location.href;
    setStatus('copying');
    try {
      await navigator.clipboard.writeText(url);
      setStatus('success');
    } catch {
      // Includes denied permission and browsers without the Clipboard API.
      setManualUrl(url);
      setStatus('error');
    }
  }

  return <div className="share-link">
    <button type="button" disabled={disabled || status === 'copying'} onClick={() => void copy()}>{label}</button>
    <p className={`share-message${status === 'error' ? ' error-message' : ' muted'}`} role={status === 'error' ? 'alert' : 'status'} aria-atomic="true" data-testid={statusTestId} data-state={status}>
      {disabled ? '人口データの読込後にコピーできます。' : status === 'copying' ? 'コピー中…' : status === 'success' ? '共有リンクをコピーしました。' : status === 'error' ? view ? 'リンクをコピーできませんでした。下のURLを選択してコピーしてください。' : 'リンクをコピーできませんでした。ブラウザーのアドレス欄からURLをコピーしてください。' : ''}
    </p>
    {status === 'error' && view && <input className="share-manual-url" aria-label={`${label}：手動コピー用URL`} readOnly value={manualUrl} onFocus={(event) => event.target.select()} />}
  </div>;
}
