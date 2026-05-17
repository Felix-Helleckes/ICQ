import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import './themes.css';
import App from './App';
import ChatApp from './ChatApp';

const root = ReactDOM.createRoot(document.getElementById('root'));
const params = new URLSearchParams(window.location.search);

if (params.get('mode') === 'chat') {
  root.render(
    <React.StrictMode>
      <ChatApp
        chatId={params.get('chatId')}
        chatName={params.get('chatName')}
        service={params.get('service')}
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
