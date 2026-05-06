import React from 'react';
import './TitleBar.css';

export default function TitleBar({ title = 'ICQ Messenger' }) {
  const minimize = () => window.api?.window.minimize();
  const close    = () => window.api?.window.close();

  return (
    <div className="titlebar">
      <div className="titlebar-icon">
        <span className="icq-flower">✿</span>
      </div>
      <div className="titlebar-title">{title}</div>
      <div className="titlebar-controls">
        <button className="tb-btn tb-min" onClick={minimize} title="Minimize">_</button>
        <button className="tb-btn tb-close" onClick={close} title="Close">✕</button>
      </div>
    </div>
  );
}
