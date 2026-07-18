import React, { useEffect, useState } from 'react';
import { MetricLabel } from './ui';

const DonutChart = ({ value = 0, total = 0, label, detail, tone = 'accent' }) => {
  const safeTotal = Math.max(Number(total) || 0, 0);
  const safeValue = Math.min(Math.max(Number(value) || 0, 0), safeTotal || Number(value) || 0);
  const percentage = safeTotal ? Math.round((safeValue / safeTotal) * 100) : 0;
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const dash = (percentage / 100) * circumference;
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className={`donut-chart donut-chart-${tone}`}>
      <svg viewBox="0 0 132 132" role="img" aria-label={`${label}: ${percentage}%`}>
        <circle className="donut-track" cx="66" cy="66" r={radius} />
        <circle
          className="donut-value"
          cx="66"
          cy="66"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={drawn ? circumference - dash : circumference}
        />
      </svg>
      <div className="donut-center">
        <strong>{percentage}%</strong>
        <span>{detail}</span>
      </div>
      <div className="donut-caption">{label}</div>
    </div>
  );
};

const SegmentedBar = ({ items, label }) => {
  const total = items.reduce((sum, item) => sum + (Number(item.value) || 0), 0);
  return (
    <div className="segmented-chart">
      <div className="segmented-chart-head">
        <span>{label}</span>
        <strong>{total}</strong>
      </div>
      <div className="segmented-bar" role="img" aria-label={`${label}: ${items.map((item) => `${item.label} ${item.value}`).join(', ')}`}>
        {items.map((item) => (
          <span
            key={item.label}
            className={`segment segment-${item.tone || 'accent'}`}
            style={{ width: `${total ? ((Number(item.value) || 0) / total) * 100 : 0}%` }}
          />
        ))}
      </div>
      <div className="chart-legend">
        {items.map((item) => (
          <div key={item.label} className="legend-item">
            <span className={`legend-dot legend-${item.tone || 'accent'}`} />
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
};

const HorizontalBars = ({ items, valueFormatter = (value) => value }) => {
  const maximum = Math.max(...items.map((item) => Number(item.value) || 0), 1);
  return (
    <div className="horizontal-bars">
      {items.map((item) => (
        <div key={item.label} className="horizontal-bar-row">
          <div className="horizontal-bar-label">
            <span>{item.label}</span>
            <strong>{valueFormatter(item.value)}</strong>
          </div>
          <div className="horizontal-bar-track">
            <span style={{ width: `${((Number(item.value) || 0) / maximum) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
};

const MetricTile = ({ label, value, note, metricKey }) => (
  <div className="metric-tile">
    <div className="metric-tile-label"><MetricLabel metricKey={metricKey}>{label}</MetricLabel></div>
    <div className="metric-tile-value">{value}</div>
    {note && <div className="metric-tile-note">{note}</div>}
  </div>
);

export { DonutChart, SegmentedBar, HorizontalBars, MetricTile };
