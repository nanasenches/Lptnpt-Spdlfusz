import React from 'react';
import { createRoot } from 'react-dom/client';

import '@/app/globals.css';
import Home from '@/app/page';

const root = document.getElementById('root');
if (!root) throw new Error('O elemento raiz do aplicativo não foi encontrado.');

createRoot(root).render(
  <React.StrictMode>
    <Home />
  </React.StrictMode>,
);
