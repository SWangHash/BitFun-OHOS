import { DesignSystemProvider } from '@openbitfun/ui';
import '@openbitfun/ui/styles.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import '@openbitfun/theme-openbitfun/default.css';
import App from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DesignSystemProvider>
      <App />
    </DesignSystemProvider>
  </React.StrictMode>,
);
