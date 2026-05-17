import React from 'react';
import './TitleBar.css';

export default function TitleBar({ title = 'Retrogram', showVersion = false }) {
  const minimize  = () => window.api?.window.minimize();
  const maximize  = () => window.api?.window.maximize();
  const close     = () => window.api?.window.close();
  const version   = showVersion ? window.api?.appVersion : null;
  const logoSrc = process.env.PUBLIC_URL + '/icq-logo.png';

  return (
    <div className="titlebar">
      <div className="titlebar-icon">
        <img src={logoSrc} className="icq-logo" alt="ICQ" />
      </div>
      <div className="titlebar-title">
        {title}
        {version && <span className="titlebar-version">v{version}</span>}
      </div>
      <div className="titlebar-controls">
        <button className="tb-btn tb-min" onClick={minimize} title="Minimize">_</button>
        <button className="tb-btn tb-max" onClick={maximize} title="Maximize">□</button>
        <button className="tb-btn tb-close" onClick={close} title="Close">✕</button>
      </div>
    </div>
  );
}
