import React, { useEffect, useRef, useState } from 'react';
import { METRIC_DEFINITIONS } from '../batches';

const StatCard = ({ label, value }) => (
  <div className="card">
    <div className="stat-value">{value ?? '—'}</div>
    <div className="stat-label">{label}</div>
  </div>
);

const ThemeToggle = ({ themeMode, onToggle, compact = false }) => (
  <button
    type="button"
    className={compact ? 'secondary theme-toggle theme-toggle-compact' : 'secondary theme-toggle'}
    onClick={onToggle}
    aria-label={`Switch to ${themeMode === 'light' ? 'dark' : 'light'} theme`}
    title={`Switch to ${themeMode === 'light' ? 'dark' : 'light'} theme`}
  >
    <span className="theme-toggle-icon" aria-hidden="true">{themeMode === 'light' ? '◐' : '☼'}</span>
    <span>{themeMode === 'light' ? 'Dark mode' : 'Light mode'}</span>
  </button>
);

const InfoTip = ({ text }) => {
  if (!text) return null;

  return (
    <span className="info-tip" tabIndex={0} aria-label={text}>
      i
      <span className="info-tooltip">{text}</span>
    </span>
  );
};

const MetricLabel = ({ metricKey, children }) => (
  <span className="metric-label-inline">
    <span>{children}</span>
    <InfoTip text={METRIC_DEFINITIONS[metricKey]} />
  </span>
);

const MobileDisclosure = ({ summary, className = '', contentClassName = '', children }) => {
  const [open, setOpen] = useState(false);

  return (
    <div className={`mobile-disclosure ${open ? 'is-open' : ''} ${className}`.trim()}>
      <button
        type="button"
        className="mobile-disclosure-toggle"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{summary}</span>
        <span className="disclosure-icon" aria-hidden="true">+</span>
      </button>
      <div className={`mobile-disclosure-content ${contentClassName}`.trim()}>{children}</div>
    </div>
  );
};

const initialsFor = (value = '') => value
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((word) => word[0]?.toUpperCase())
  .join('') || 'II';

const StatusPill = ({ status }) => (
  <span className={`status-pill status-${String(status || 'unknown').toLowerCase().replace(/\s+/g, '-')}`}>
    <span className="status-dot" />
    {status || 'Unknown'}
  </span>
);

const SortIcon = ({ field, current }) => {
    const active = current.field === field;
    return <span className="sort-icon" aria-hidden="true">{active ? (current.asc ? '▲' : '▼') : '⇅'}</span>;
  };


export { StatCard, ThemeToggle, InfoTip, MetricLabel, MobileDisclosure, initialsFor, StatusPill, SortIcon };
