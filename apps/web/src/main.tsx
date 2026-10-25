import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

if (window.location.pathname.replace(/\/+$/, '') === '/muse') {
  window.history.replaceState(null, '', '/?view=assistant');
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
