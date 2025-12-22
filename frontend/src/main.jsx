import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import App from './App.jsx';
import './styles.css';

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '183667160330-4jtc41mg2jf7ugk6211smgcrr7lcfo02.apps.googleusercontent.com';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <GoogleOAuthProvider clientId={googleClientId}>
      <HashRouter>
        <App />
      </HashRouter>
    </GoogleOAuthProvider>
  </React.StrictMode>
);
