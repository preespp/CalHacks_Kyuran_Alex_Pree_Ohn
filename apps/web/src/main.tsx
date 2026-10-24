import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import MuseLab from './MuseLab';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {window.location.pathname.replace(/\/$/, '') === '/muse' ? <MuseLab /> : <App />}
  </React.StrictMode>,
);
