import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

const STATUS_TABS = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'denied', label: 'Denied' },
  { key: 'all', label: 'All' },
];

const formatDateTime = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
};

const AccessRequests = ({ authHeaders }) => {
  const [requests, setRequests] = useState([]);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = async () => {
    try {
      const response = await api.get('/admin/access-requests', authHeaders);
      setRequests(response.data);
      setError('');
    } catch (err) {
      setError(err.response?.data?.message || 'Access requests could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authHeaders]);

  const decide = async (request, status) => {
    setBusyId(request.id);
    setMessage('');
    setError('');
    try {
      const response = await api.put(`/admin/access-requests/${request.id}`, { status }, authHeaders);
      setRequests((current) => current.map((row) => (row.id === request.id ? response.data : row)));
      setMessage(status === 'approved'
        ? `${request.email} can now sign in.`
        : `${request.email} can no longer see the data.`);
    } catch (err) {
      setError(err.response?.data?.message || 'The decision could not be saved.');
    } finally {
      setBusyId(null);
    }
  };

  const counts = useMemo(() => requests.reduce((totals, row) => {
    totals[row.status] = (totals[row.status] || 0) + 1;
    return totals;
  }, {}), [requests]);

  const visible = useMemo(() => (
    statusFilter === 'all' ? requests : requests.filter((row) => row.status === statusFilter)
  ), [requests, statusFilter]);

  return (
    <main className="container section-page admin-settings-page">
      <div className="card admin-settings-card access-requests-card">
        <span className="eyebrow">Admin settings</span>
        <h2>Access requests</h2>
        <p className="subtext">
          Students sitting in the 2027 placement process and the Placement Cell accounts sign in
          automatically. Every other IIIT Delhi address lands here and sees nothing until you
          approve it. Denying an approved account cuts its access off immediately.
        </p>

        <div className="access-filter-strip" role="tablist" aria-label="Filter access requests">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={statusFilter === tab.key}
              className={statusFilter === tab.key ? 'is-active' : ''}
              onClick={() => setStatusFilter(tab.key)}
            >
              {tab.label}
              <span>{tab.key === 'all' ? requests.length : (counts[tab.key] || 0)}</span>
            </button>
          ))}
        </div>

        {message && <p className="success-text" role="status">{message}</p>}
        {error && <p className="error-text" role="alert">{error}</p>}

        {loading ? <p className="subtext">Loading access requests…</p> : (
          visible.length === 0
            ? <p className="subtext empty-detail-state">No {statusFilter === 'all' ? '' : statusFilter} access requests.</p>
            : (
              <div className="access-request-list">
                {visible.map((row) => (
                  <article key={row.id} className="access-request-row">
                    <div className="access-request-identity">
                      <strong>{row.name || row.email}</strong>
                      <span>{row.email}</span>
                    </div>
                    <div className="access-request-meta">
                      <span className={`status-pill status-${row.status}`}>{row.status}</span>
                      <small>
                        First asked {formatDateTime(row.requested_at)}
                        {row.attempts > 1 ? ` · ${row.attempts} attempts` : ''}
                        {row.decided_at ? ` · decided ${formatDateTime(row.decided_at)}` : ''}
                      </small>
                    </div>
                    <div className="access-request-actions">
                      {row.status !== 'approved' && (
                        <button type="button" disabled={busyId === row.id} onClick={() => decide(row, 'approved')}>
                          {busyId === row.id ? 'Saving…' : 'Approve'}
                        </button>
                      )}
                      {row.status !== 'denied' && (
                        <button
                          type="button"
                          className="secondary"
                          disabled={busyId === row.id}
                          onClick={() => decide(row, 'denied')}
                        >
                          {row.status === 'approved' ? 'Revoke' : 'Deny'}
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )
        )}
      </div>
    </main>
  );
};

export { AccessRequests };
