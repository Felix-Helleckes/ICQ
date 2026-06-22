import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import './themes.css';
import App from './App';
import ChatApp from './ChatApp';
import { applySavedSkin, applySkin } from './skins';

// Apply the saved skin before first paint so every window (contact list
// + each chat window) opens already wearing the right theme — no flash.
applySavedSkin();
// Live-sync skin changes made in any other window.
window.api?.onSkinChange?.((id) => applySkin(id));

const root = ReactDOM.createRoot(document.getElementById('root'));
const params = new URLSearchParams(window.location.search);

if (params.get('mode') === 'chat') {
  root.render(
    <React.StrictMode>
      <ChatApp
        chatId={params.get('chatId')}
        chatName={params.get('chatName')}
        service={params.get('service')}
        isGroup={params.get('isGroup') === '1'}
      />
    </React.StrictMode>
  );
} else {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
