import React, { useState, useEffect } from 'react';
import './LoginPanel.css';

// ── Shared QR renderer (works for both WA and TG) ────────────
function QRDisplay({ qr }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    if (!qr) return;
    import('qrcode').then(QRCode => {
      QRCode.toString(qr, { type: 'svg', width: 180, margin: 1 }).then(setSvg);
    });
  }, [qr]);
  if (!svg) return <div className="qr-box qr-loading">Generating QR…</div>;
  return (
    <div className="qr-box" dangerouslySetInnerHTML={{ __html: svg }} />
  );
}

// ── 2FA password overlay ──────────────────────────────────────
function TwoFAPanel({ hint, onSubmit }) {
  const [pw, setPw] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!pw) return;
    setLoading(true);
    await onSubmit(pw);
    setLoading(false);
  };

  return (
    <div className="twofa-overlay">
      <div className="login-icon" style={{ fontSize: 28 }}>🔐</div>
      <p className="login-hint"><b>Two-Step Verification</b></p>
      {hint && <p className="login-hint small">Hint: {hint}</p>}
      <input
        className="win98-input"
        type="password"
        placeholder="Your 2FA password"
        value={pw}
        onChange={e => setPw(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && submit()}
        autoFocus
      />
      <button className="win98-btn" onClick={submit} disabled={loading}>
        {loading ? 'Verifying…' : 'Confirm'}
      </button>
    </div>
  );
}

// ── WhatsApp panel ────────────────────────────────────────────
function WhatsAppPanel({ waStatus, waQR }) {
  return (
    <>
      {(waStatus === 'disconnected' || waStatus === 'loading') && (
        <div className="wa-loading">
          <div className="wa-spinner" />
          <p className="login-hint">
            {waStatus === 'loading' ? 'WhatsApp startet…' : 'Verbinde…'}
          </p>
          <p className="login-hint small">Chrome/Puppeteer wird gestartet,<br/>das dauert kurz beim ersten Mal.</p>
        </div>
      )}
      {waStatus === 'qr' && !waQR    && <p className="login-hint">Waiting for QR code…</p>}
      {waStatus === 'qr' && waQR && (
        <>
          <p className="login-hint">Scan with WhatsApp on your phone:</p>
          <QRDisplay qr={waQR} />
          <p className="login-hint small">
            Open WhatsApp → <b>Linked Devices</b> → <b>Link a Device</b>
          </p>
        </>
      )}
      {waStatus === 'error' && (
        <div className="wa-error">
          <p className="login-hint error">❌ WhatsApp konnte nicht gestartet werden.</p>
          <p className="login-hint small">
            Bitte installiere{' '}
            <a href="https://www.google.com/chrome" onClick={e => { e.preventDefault(); window.api?.openExternal?.('https://www.google.com/chrome'); }}>Google Chrome</a>
            {' '}und starte die App neu.
          </p>
        </div>
      )}
      {waStatus === 'ready' && <p className="login-hint ok">✓ Connected to WhatsApp!</p>}
    </>
  );
}

// ── Telegram API credentials form ────────────────────────────
function TelegramCredentialsForm({ onSave }) {
  const [apiId,   setApiId]   = useState('');
  const [apiHash, setApiHash] = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const submit = async () => {
    if (!apiId || !apiHash) { setError('Both fields are required.'); return; }
    if (isNaN(parseInt(apiId))) { setError('API ID must be a number.'); return; }
    setLoading(true); setError('');
    try { await onSave(apiId, apiHash); }
    catch (e) { setError(e.message); setLoading(false); }
  };

  return (
    <div className="credentials-form">
      <div className="login-icon" style={{ fontSize: 26 }}>✈️</div>
      <p className="login-hint"><b>Telegram API Credentials</b></p>
      <p className="login-hint small">
        Get them free at{' '}
        <a href="https://my.telegram.org/apps" target="_blank" rel="noreferrer">my.telegram.org/apps</a>
      </p>
      <input
        className="win98-input"
        type="text"
        placeholder="App api_id  (e.g. 12345678)"
        value={apiId}
        onChange={e => setApiId(e.target.value.trim())}
      />
      <input
        className="win98-input"
        type="text"
        placeholder="App api_hash  (32 hex chars)"
        value={apiHash}
        onChange={e => setApiHash(e.target.value.trim())}
      />
      {error && <p className="login-hint error">{error}</p>}
      <button className="win98-btn" onClick={submit} disabled={loading}>
        {loading ? 'Connecting…' : 'Save & Connect'}
      </button>
    </div>
  );
}

// ── Telegram panel ────────────────────────────────────────────
function TelegramPanel({ tgStatus, tgQR, tg2FA, onTgAuth, onTgQRLogin, onTg2FASubmit, onTgSetCredentials }) {
  const [loginMethod, setLoginMethod] = useState('qr'); // 'qr' | 'phone'
  const [phone,       setPhone]       = useState('');
  const [code,        setCode]        = useState('');
  const [phoneHash,   setPhoneHash]   = useState('');
  const [step,        setStep]        = useState('phone'); // 'phone' | 'code'
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');

  // Trigger QR login as soon as tab is shown and status allows
  useEffect(() => {
    if (loginMethod === 'qr' && tgStatus === 'needs-auth') {
      onTgQRLogin();
    }
  }, [loginMethod]); // eslint-disable-line

  const handlePhoneSend = async () => {
    setLoading(true); setError('');
    try {
      const hash = await onTgAuth(phone, null, null);
      setPhoneHash(hash);
      setStep('code');
    } catch (e) { setError(e.message); }
    setLoading(false);
  };

  const handleCodeSubmit = async () => {
    setLoading(true); setError('');
    try {
      await onTgAuth(phone, code, phoneHash);
    } catch (e) { setError(e.message); }
    setLoading(false);
  };

  if (tgStatus === 'no-credentials') {
    return <TelegramCredentialsForm onSave={onTgSetCredentials} />;
  }

  if (tgStatus === 'ready') {
    return <p className="login-hint ok">✓ Connected to Telegram!</p>;
  }

  // 2FA overlay takes over the whole panel
  if (tg2FA) {
    return <TwoFAPanel hint={tg2FA.hint} onSubmit={onTg2FASubmit} />;
  }

  return (
    <>
      {/* Method toggle */}
      <div className="method-tabs">
        <button
          className={`method-tab ${loginMethod === 'qr' ? 'active' : ''}`}
          onClick={() => setLoginMethod('qr')}
        >📷 QR Code</button>
        <button
          className={`method-tab ${loginMethod === 'phone' ? 'active' : ''}`}
          onClick={() => setLoginMethod('phone')}
        >📱 Phone</button>
      </div>

      {/* QR method */}
      {loginMethod === 'qr' && (
        <>
          {(tgStatus === 'needs-auth' || tgStatus === 'disconnected') && (
            <p className="login-hint">Starting QR login…</p>
          )}
          {tgStatus === 'qr' && !tgQR && (
            <p className="login-hint">Generating QR code…</p>
          )}
          {tgStatus === 'qr' && tgQR && (
            <>
              <p className="login-hint">Scan with Telegram on your phone:</p>
              <QRDisplay qr={tgQR} />
              <p className="login-hint small">
                Open Telegram → <b>Settings</b> → <b>Devices</b> → <b>Link Desktop Device</b>
              </p>
              <p className="login-hint small" style={{ color: 'var(--icq-away)' }}>
                QR code refreshes automatically every ~30s
              </p>
            </>
          )}
        </>
      )}

      {/* Phone method */}
      {loginMethod === 'phone' && step === 'phone' && (
        <>
          <p className="login-hint">Enter your phone number (with country code):</p>
          <input
            className="win98-input"
            type="tel"
            placeholder="+49 123 456789"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handlePhoneSend()}
          />
          <button className="win98-btn" onClick={handlePhoneSend} disabled={loading}>
            {loading ? 'Sending…' : 'Send Code'}
          </button>
          {error && <p className="login-hint error">{error}</p>}
        </>
      )}

      {loginMethod === 'phone' && step === 'code' && (
        <>
          <p className="login-hint">Enter the code sent to your Telegram app:</p>
          <input
            className="win98-input"
            type="text"
            placeholder="12345"
            value={code}
            onChange={e => setCode(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCodeSubmit()}
            autoFocus
          />
          <button className="win98-btn" onClick={handleCodeSubmit} disabled={loading}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
          <button
            className="win98-btn"
            style={{ background: 'transparent', border: 'none', color: 'var(--icq-text-dim)', marginTop: -4 }}
            onClick={() => setStep('phone')}
          >← Back</button>
          {error && <p className="login-hint error">{error}</p>}
        </>
      )}
    </>
  );
}

// ── Main LoginPanel ───────────────────────────────────────────
export default function LoginPanel({ service, waStatus, tgStatus, waQR, tgQR, tg2FA, onTgAuth, onTgQRLogin, onTg2FASubmit, onTgSetCredentials }) {
  const isWA = service === 'whatsapp';

  return (
    <div className="login-panel">
      <div className="login-box win98-raised">
        <div className="login-header">
          <span className="login-icon">{isWA ? '💬' : '✈️'}</span>
          <span>{isWA ? 'WhatsApp' : 'Telegram'} Login</span>
        </div>
        <div className="login-body">
          {isWA
            ? <WhatsAppPanel waStatus={waStatus} waQR={waQR} />
            : <TelegramPanel
                tgStatus={tgStatus}
                tgQR={tgQR}
                tg2FA={tg2FA}
                onTgAuth={onTgAuth}
                onTgQRLogin={onTgQRLogin}
                onTg2FASubmit={onTg2FASubmit}
                onTgSetCredentials={onTgSetCredentials}
              />
          }
        </div>
      </div>
    </div>
  );
}
