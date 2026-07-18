import React, { useEffect, useState } from 'react';
import { api } from '../api';

const ViewerAccessSettings = ({ authHeaders }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api.get('/admin/viewer-access', authHeaders)
      .then((response) => {
        if (active) setUsername(response.data.username || '');
      })
      .catch((err) => {
        if (active) setError(err.response?.data?.message || 'Viewer access settings could not be loaded.');
      });
    return () => { active = false; };
  }, [authHeaders]);

  const submit = async (event) => {
    event.preventDefault();
    setMessage('');
    setError('');

    if (password !== confirmPassword) {
      setError('The passwords do not match.');
      return;
    }

    setPending(true);
    try {
      const response = await api.put('/admin/viewer-access', { username, password }, authHeaders);
      setUsername(response.data.username);
      setPassword('');
      setConfirmPassword('');
      setMessage('Viewer credentials updated. Existing viewer sessions remain valid until they expire.');
    } catch (err) {
      setError(err.response?.data?.message || 'Viewer access settings could not be updated.');
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="container section-page admin-settings-page">
      <div className="card admin-settings-card">
        <span className="eyebrow">Admin settings</span>
        <h2>Viewer access</h2>
        <p className="subtext">Change the shared read-only login shown on the landing screen. These credentials cannot create an admin session.</p>
        <form onSubmit={submit}>
          <label>
            Viewer username
            <input type="text" autoComplete="off" value={username} onChange={(event) => setUsername(event.target.value)} required />
          </label>
          <label>
            New password
            <input type="password" autoComplete="new-password" minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} required />
          </label>
          <label>
            Confirm new password
            <input type="password" autoComplete="new-password" minLength={12} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required />
          </label>
          <button type="submit" disabled={pending}>{pending ? 'Updating...' : 'Update viewer credentials'}</button>
        </form>
        {message && <p className="success-text" role="status">{message}</p>}
        {error && <p className="error-text" role="alert">{error}</p>}
      </div>
    </main>
  );
};

export { ViewerAccessSettings };
