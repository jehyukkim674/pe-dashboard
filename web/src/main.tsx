import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd';
import koKR from 'antd/locale/ko_KR';
import App from './App';
import 'antd/dist/reset.css';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={koKR}>
      <App />
    </ConfigProvider>
  </React.StrictMode>,
);
