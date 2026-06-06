import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { GoogleLogin, googleLogout } from '@react-oauth/google';
import {
  BATCHES,
  DEFAULT_BATCH_KEY,
  METRIC_DEFINITIONS,
  PROGRAM_OPTIONS,
  getBatchConfig,
  getBranchGroup,
} from './batches';
import {
  OFFER_TYPES,
  isCombinedOfferType,
  isFullTimeOfferType,
  isInternshipOfferType,
} from './offerTypes';
import { OFFICIAL_2025 } from './official2025';
import { OFFICIAL_2026 } from './official2026';

const api = axios.create({ baseURL: import.meta.env.VITE_API_BASE || '/api' });
const assetBase = import.meta.env.BASE_URL || '/';
const VIEWER_TOKEN_STORAGE_KEY = 'viewerToken';
const readInitialBatchKey = () => {
  const stored = localStorage.getItem('activeBatchKey');
  return stored === 'mtech-cse-2025' ? 'mtech-2025' : stored || DEFAULT_BATCH_KEY;
};

const readStoredViewerToken = () => {
  const storedToken = localStorage.getItem(VIEWER_TOKEN_STORAGE_KEY);
  if (storedToken) return storedToken;

  const legacyToken = sessionStorage.getItem(VIEWER_TOKEN_STORAGE_KEY);
  if (legacyToken) {
    localStorage.setItem(VIEWER_TOKEN_STORAGE_KEY, legacyToken);
    sessionStorage.removeItem(VIEWER_TOKEN_STORAGE_KEY);
  }

  return legacyToken || '';
};

const storeViewerToken = (token) => {
  if (token) {
    localStorage.setItem(VIEWER_TOKEN_STORAGE_KEY, token);
  } else {
    localStorage.removeItem(VIEWER_TOKEN_STORAGE_KEY);
  }
};

const getBatchCacheKey = (batchKey) => `placementSnapshot:${batchKey}`;

const readBatchCache = (batchKey) => {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.sessionStorage.getItem(getBatchCacheKey(batchKey));
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;

    return {
      stats: parsed.stats && typeof parsed.stats === 'object' ? parsed.stats : {},
      companies: Array.isArray(parsed.companies) ? parsed.companies : [],
      students: Array.isArray(parsed.students) ? parsed.students : [],
    };
  } catch {
    return null;
  }
};

const writeBatchCache = (batchKey, snapshot) => {
  if (typeof window === 'undefined') return;

  try {
    window.sessionStorage.setItem(getBatchCacheKey(batchKey), JSON.stringify({
      ...snapshot,
      cachedAt: new Date().toISOString(),
    }));
  } catch {
    // Ignore cache writes if storage is unavailable or full.
  }
};

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

const DonutChart = ({ value = 0, total = 0, label, detail, tone = 'accent' }) => {
  const safeTotal = Math.max(Number(total) || 0, 0);
  const safeValue = Math.min(Math.max(Number(value) || 0, 0), safeTotal || Number(value) || 0);
  const percentage = safeTotal ? Math.round((safeValue / safeTotal) * 100) : 0;
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const dash = (percentage / 100) * circumference;

  return (
    <div className={`donut-chart donut-chart-${tone}`}>
      <svg viewBox="0 0 132 132" role="img" aria-label={`${label}: ${percentage}%`}>
        <circle className="donut-track" cx="66" cy="66" r={radius} />
        <circle
          className="donut-value"
          cx="66"
          cy="66"
          r={radius}
          strokeDasharray={`${dash} ${circumference - dash}`}
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

const StatusPill = ({ status }) => (
  <span className={`status-pill status-${String(status || 'unknown').toLowerCase().replace(/\s+/g, '-')}`}>
    <span className="status-dot" />
    {status || 'Unknown'}
  </span>
);

const BRANCH_GROUP_ORDER = { CSE: 0, ECE: 1, CB: 2, OTHER: 3 };
const STUDENT_STATUS_OPTIONS = ['Placed', 'Unplaced', 'Ineligible', 'Not Sitting'];
const isPlacementEligibleStudent = (student) => !['not sitting', 'ineligible'].includes(
  String(student?.placement_status || '').trim().toLowerCase()
);

const DASHBOARD_BRANCH_LABELS = {
  ALL: 'All programs',
  CSE: 'CSE group',
  ECE: 'ECE group',
  CB: 'CB group',
  OTHER: 'Other programs',
};

const EMPTY_SLICE_SUMMARY = {
  total_students: 0,
  eligible_students: 0,
  excluded_students: 0,
  placed_students: 0,
  unplaced_students: 0,
  total_offers: 0,
  total_intern_offers: 0,
  total_fte_offers: 0,
  total_combo_offers: 0,
  total_Aplus_offers: 0,
  total_A_offers: 0,
  total_B_offers: 0,
  highest_ctc: null,
  average_ctc: null,
  median_ctc: null,
  highest_stipend: null,
  average_stipend: null,
  median_stipend: null,
  placement_percentage: 0,
  internship_percentage: 0,
  fte_percentage: 0,
};

const sortPrograms = (programs) => [...programs].sort((left, right) => {
  const leftGroup = BRANCH_GROUP_ORDER[getBranchGroup(left)] ?? 99;
  const rightGroup = BRANCH_GROUP_ORDER[getBranchGroup(right)] ?? 99;
  if (leftGroup !== rightGroup) return leftGroup - rightGroup;
  return left.localeCompare(right);
});

const getStudentOffers = (student) => {
  if (student.offers?.length) return student.offers;
  if (!student.company_id) return [];

  return [{
    offer_type: student.offer_type,
    ctc: student.ctc,
    stipend: student.stipend,
    company_category: student.company_category,
    company_ctc: student.company_ctc,
    company_stipend: student.company_stipend,
  }];
};

const buildProgramSummaries = (students, placementsOnly = false) => {
  if (!students.length) {
    return { branchGroups: [], branchSummaries: { ALL: EMPTY_SLICE_SUMMARY }, programSummaries: [] };
  }

  const offersWithProgram = students.flatMap((student) => (
    getStudentOffers(student).map((offer) => ({ ...offer, program: student.program }))
  ));

  const median = (values) => {
    if (!values.length) return null;
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };

  const average = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
  const toPct = (value, total) => (total ? Number(((value / total) * 100).toFixed(2)) : 0);

  const summarize = (subset, offerProgramFilter) => {
    const total = subset.length;
    const placed = subset.filter((student) => student.placement_status === 'Placed').length;
    const placementEligibleTotal = subset.filter(isPlacementEligibleStudent).length;
    const excludedStudents = Math.max(total - placementEligibleTotal, 0);
    const unplacedStudents = Math.max(placementEligibleTotal - placed, 0);
    const offersSubset = offersWithProgram.filter((offer) => offerProgramFilter(offer.program));
    const comboOffers = offersSubset.filter((offer) => isCombinedOfferType(offer.offer_type));
    const internOffers = offersSubset.filter((offer) => isInternshipOfferType(offer.offer_type) && !isCombinedOfferType(offer.offer_type));
    const fteOffers = offersSubset.filter((offer) => isFullTimeOfferType(offer.offer_type) && !isCombinedOfferType(offer.offer_type));

    const categories = { Aplus: 0, A: 0, B: 0 };
    offersSubset.forEach((offer) => {
      const category = offer.company_category?.toUpperCase();
      if (category === 'A+') categories.Aplus += 1;
      else if (category === 'A') categories.A += 1;
      else if (category === 'B') categories.B += 1;
    });

    const ctcValues = offersSubset
      .map((offer) => offer.ctc ?? offer.company_ctc)
      .filter((value) => typeof value === 'number');
    const stipendValues = offersSubset
      .map((offer) => offer.stipend ?? offer.company_stipend)
      .filter((value) => typeof value === 'number');

    const internshipCount = internOffers.length + comboOffers.length;
    const fteCount = fteOffers.length + comboOffers.length;

    return {
      total_students: total,
      eligible_students: placementsOnly ? null : placementEligibleTotal,
      excluded_students: placementsOnly ? null : excludedStudents,
      placed_students: placed,
      unplaced_students: placementsOnly ? null : unplacedStudents,
      total_offers: offersSubset.length,
      total_intern_offers: internOffers.length,
      total_fte_offers: fteCount,
      total_combo_offers: comboOffers.length,
      total_Aplus_offers: categories.Aplus,
      total_A_offers: categories.A,
      total_B_offers: categories.B,
      highest_ctc: ctcValues.length ? Math.max(...ctcValues) : null,
      average_ctc: average(ctcValues),
      median_ctc: median(ctcValues),
      highest_stipend: stipendValues.length ? Math.max(...stipendValues) : null,
      average_stipend: average(stipendValues),
      median_stipend: median(stipendValues),
      placement_percentage: placementsOnly ? null : toPct(placed, placementEligibleTotal),
      internship_percentage: toPct(internshipCount, total),
      fte_percentage: toPct(fteCount, total),
    };
  };

  const programs = sortPrograms([...new Set(students.map((student) => student.program).filter(Boolean))]);
  const branchGroups = [...new Set(programs.map((program) => getBranchGroup(program)))].sort(
    (left, right) => (BRANCH_GROUP_ORDER[left] ?? 99) - (BRANCH_GROUP_ORDER[right] ?? 99)
  );
  const branchSummaries = branchGroups.reduce((accumulator, branchGroup) => ({
    ...accumulator,
    [branchGroup]: summarize(
      students.filter((student) => getBranchGroup(student.program) === branchGroup),
      (offerProgram) => getBranchGroup(offerProgram) === branchGroup
    ),
  }), {
    ALL: summarize(students, () => true),
  });

  return {
    branchGroups,
    branchSummaries,
    programSummaries: programs.map((program) => ({
      program,
      branchGroup: getBranchGroup(program),
      summary: summarize(students.filter((student) => student.program === program), (offerProgram) => offerProgram === program),
    })),
  };
};

const Modal = ({ open, onClose, children }) => {
  if (!open) return null;
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
};

const CompanyForm = ({ initial = {}, onSubmit, onCancel }) => {
  const [form, setForm] = useState({
    name: '',
    role: '',
    type: 'FTE',
    ctc: '',
    stipend: '',
    category: '',
    eligible_cgpa: '',
    backlog_allowed: false,
    registration_deadline: '',
    offer_date: '',
    ...initial,
  });

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((f) => ({ ...f, [name]: type === 'checkbox' ? checked : value }));
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          ...form,
          ctc: form.ctc ? Number(form.ctc) : null,
          stipend: form.stipend ? Number(form.stipend) : null,
          eligible_cgpa: form.eligible_cgpa ? Number(form.eligible_cgpa) : null,
        });
      }}
    >
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px,1fr))' }}>
        <div>
          <label>Name</label>
          <input name="name" value={form.name} onChange={handleChange} required />
        </div>
        <div>
          <label>Role</label>
          <input name="role" value={form.role} onChange={handleChange} />
        </div>
        <div>
          <label>Type</label>
          <select name="type" value={form.type} onChange={handleChange}>
            {OFFER_TYPES.map((type) => <option key={type}>{type}</option>)}
          </select>
        </div>
        <div>
          <label>CTC (LPA)</label>
          <input name="ctc" type="number" step="0.1" value={form.ctc ?? ''} onChange={handleChange} />
        </div>
        <div>
          <label>Stipend</label>
          <input name="stipend" type="number" step="0.1" value={form.stipend ?? ''} onChange={handleChange} />
        </div>
        <div>
          <label>Category</label>
          <select name="category" value={form.category || ''} onChange={handleChange}>
            <option value="">Select</option>
            <option value="A+">A+</option>
            <option value="A">A</option>
            <option value="B">B</option>
          </select>
        </div>
        <div>
          <label>Eligible CGPA</label>
          <input name="eligible_cgpa" type="number" step="0.1" value={form.eligible_cgpa ?? ''} onChange={handleChange} />
        </div>
        <div>
          <label>Backlog Allowed</label>
          <div className="flex-row">
            <input name="backlog_allowed" type="checkbox" checked={!!form.backlog_allowed} onChange={handleChange} />
            <span>Yes</span>
          </div>
        </div>
        <div>
          <label>Last Date of Registration</label>
          <input name="registration_deadline" type="date" value={form.registration_deadline || ''} onChange={handleChange} />
        </div>
        <div>
          <label>Date of Offer</label>
          <input name="offer_date" type="date" value={form.offer_date || ''} onChange={handleChange} />
        </div>
      </div>
      <div className="flex-row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
        <button type="submit">Save</button>
      </div>
    </form>
  );
};

const StudentForm = ({ initial = {}, companies = [], onSubmit, onCancel }) => {
  const initialOffers = initial.offers?.length
    ? initial.offers
    : initial.company_id
      ? [{
        company_id: initial.company_id,
        offer_type: initial.offer_type || '',
        ctc: initial.ctc ?? '',
        stipend: initial.stipend ?? '',
        registration_deadline: initial.registration_deadline || '',
        offer_date: initial.offer_date || '',
      }]
      : [];

  const [form, setForm] = useState({
    roll_number: '',
    name: '',
    program: 'CSE',
    placement_status: 'Unplaced',
    offers: initialOffers,
    ...initial,
  });
  const studentProgramOptions = [...new Set([...PROGRAM_OPTIONS, form.program].filter(Boolean))];

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  };

  const placed = form.placement_status === 'Placed';

  const updateOfferField = (idx, key, value) => {
    setForm((prev) => {
      const nextOffers = [...(prev.offers || [])];
      nextOffers[idx] = { ...nextOffers[idx], [key]: value };
      return { ...prev, offers: nextOffers };
    });
  };

  const hydrateOfferFromCompany = (idx, companyId, force = false) => {
    const company = companies.find((c) => String(c.id) === String(companyId));
    if (!company) {
      updateOfferField(idx, 'company_id', companyId);
      return;
    }

    setForm((prev) => {
      const nextOffers = [...(prev.offers || [])];
      const existing = nextOffers[idx] || {};
      const sameCompany = !force && String(existing.company_id) === String(companyId);
      const pick = (val, fallback) => (val === '' || val === null || val === undefined ? fallback : val);

      nextOffers[idx] = sameCompany
        ? {
          ...existing,
          company_id: companyId,
          offer_type: pick(existing.offer_type, company.type || ''),
          ctc: pick(existing.ctc, company.ctc ?? ''),
          stipend: pick(existing.stipend, company.stipend ?? ''),
          registration_deadline: pick(existing.registration_deadline, company.registration_deadline || ''),
          offer_date: pick(existing.offer_date, company.offer_date || ''),
        }
        : {
          ...existing,
          company_id: companyId,
          offer_type: company.type || '',
          ctc: company.ctc ?? '',
          stipend: company.stipend ?? '',
          registration_deadline: company.registration_deadline || '',
          offer_date: company.offer_date || '',
        };

      return { ...prev, offers: nextOffers };
    });
  };

  const addOffer = () => setForm((prev) => ({ ...prev, offers: [...(prev.offers || []), { company_id: '', offer_type: '', ctc: '', stipend: '', registration_deadline: '', offer_date: '' }] }));
  const removeOffer = (idx) => setForm((prev) => ({ ...prev, offers: (prev.offers || []).filter((_, i) => i !== idx) }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();

        const normalizedOffers = (form.offers || []).map((o) => ({
          ...o,
          company_id: o.company_id ? Number(o.company_id) : null,
          ctc: o.ctc ? Number(o.ctc) : null,
          stipend: o.stipend ? Number(o.stipend) : null,
        }));

        const isPlaced = form.placement_status === 'Placed';
        onSubmit({
          ...form,
          offers: isPlaced ? normalizedOffers : [],
          company_id: isPlaced ? form.company_id : null,
          offer_type: isPlaced ? form.offer_type : null,
          ctc: isPlaced ? form.ctc : null,
          stipend: isPlaced ? form.stipend : null,
          registration_deadline: isPlaced ? form.registration_deadline : null,
          offer_date: isPlaced ? form.offer_date : null,
        });
      }}
    >
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px,1fr))' }}>
        <div>
          <label>Roll Number</label>
          <input name="roll_number" value={form.roll_number} onChange={handleChange} required />
        </div>
        <div>
          <label>Name</label>
          <input name="name" value={form.name} onChange={handleChange} required />
        </div>
        <div>
          <label>Program</label>
          <select name="program" value={form.program} onChange={handleChange}>
            {studentProgramOptions.map((program) => (
              <option key={program} value={program}>{program}</option>
            ))}
          </select>
        </div>
        <div>
          <label>Placement Status</label>
          <select
            name="placement_status"
            value={form.placement_status}
            onChange={(e) => {
              const nextStatus = e.target.value;
              handleChange(e);
              if (nextStatus !== 'Placed') {
                // Clear any existing offers/primary company details for non-placed statuses.
                setForm((prev) => ({
                  ...prev,
                  offers: [],
                  company_id: null,
                  offer_type: '',
                  ctc: '',
                  stipend: '',
                  registration_deadline: '',
                  offer_date: '',
                }));
              } else if (!form.offers?.length) addOffer();
            }}
          >
            {STUDENT_STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
        </div>
        {placed && (
          <div className="grid" style={{ gridTemplateColumns: '1fr' }}>
            {(form.offers || []).map((offer, idx) => (
              <div key={idx} className="card" style={{ margin: 0, borderStyle: 'dashed' }}>
                <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px,1fr))' }}>
                  <div>
                    <label>Company</label>
                    <select value={offer.company_id || ''} onChange={(e) => hydrateOfferFromCompany(idx, e.target.value)}>
                      <option value="">Select</option>
                      {companies.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                    {offer.company_id && (
                      <div className="flex-row" style={{ marginTop: 6, justifyContent: 'flex-end' }}>
                        <button type="button" className="secondary" onClick={() => hydrateOfferFromCompany(idx, offer.company_id, true)}>Reapply company data</button>
                      </div>
                    )}
                  </div>
                  <div>
                    <label>Offer Type</label>
                    <select value={offer.offer_type || ''} onChange={(e) => updateOfferField(idx, 'offer_type', e.target.value)}>
                      <option value="">Select</option>
                      {OFFER_TYPES.map((type) => <option key={type}>{type}</option>)}
                    </select>
                  </div>
                  <div>
                    <label>CTC (LPA)</label>
                    <input type="number" step="0.1" value={offer.ctc ?? ''} onChange={(e) => updateOfferField(idx, 'ctc', e.target.value)} />
                  </div>
                  <div>
                    <label>Stipend</label>
                    <input type="number" step="0.1" value={offer.stipend ?? ''} onChange={(e) => updateOfferField(idx, 'stipend', e.target.value)} />
                  </div>
                  <div>
                    <label>Last Date of Registration</label>
                    <input type="date" value={offer.registration_deadline || ''} onChange={(e) => updateOfferField(idx, 'registration_deadline', e.target.value)} />
                  </div>
                  <div>
                    <label>Date of Offer</label>
                    <input type="date" value={offer.offer_date || ''} onChange={(e) => updateOfferField(idx, 'offer_date', e.target.value)} />
                  </div>
                </div>
                {form.offers.length > 1 && (
                  <div className="flex-row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
                    <button type="button" className="secondary" onClick={() => removeOffer(idx)}>Remove</button>
                  </div>
                )}
              </div>
            ))}
            <button type="button" className="secondary" onClick={addOffer}>Add Another Offer</button>
          </div>
        )}
      </div>
      <div className="flex-row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
        <button type="submit">Save</button>
      </div>
    </form>
  );
};

const useAdminHeaders = (token) => useMemo(() => ({ headers: { Authorization: `Bearer ${token}` } }), [token]);

const App = () => {
  const location = useLocation();
  const [viewerToken, setViewerToken] = useState(readStoredViewerToken);
  const [token, setToken] = useState('');
  const [activeBatchKey, setActiveBatchKey] = useState(readInitialBatchKey);
  const initialSnapshot = readBatchCache(activeBatchKey);
  const authHeaders = useAdminHeaders(token);
  const viewerHeaders = useAdminHeaders(viewerToken);
  const isAdmin = !!token;
  const activeBatch = useMemo(() => getBatchConfig(activeBatchKey), [activeBatchKey]);
  const isAggregateOnly = !!activeBatch.aggregate_only;
  const isPlacementRecordsOnly = !!activeBatch.placements_only;
  const isOfficial2025 = activeBatch.graduation_year === 2025 && isPlacementRecordsOnly;
  const isOfficial2026 = activeBatch.graduation_year === 2026 && !isAggregateOnly;
  const official2025Programs = OFFICIAL_2025.programs[activeBatch.degree] || [];
  const official2025AverageLpa = activeBatch.degree === 'B.Tech'
    ? OFFICIAL_2025.average_btech_lpa
    : OFFICIAL_2025.average_mtech_lpa;
  const official2025HighestIndianLpa = activeBatch.degree === 'B.Tech'
    ? OFFICIAL_2025.highest_indian_btech_lpa
    : OFFICIAL_2025.highest_indian_mtech_lpa;
  const official2026Programs = OFFICIAL_2026.programs[activeBatch.degree] || [];
  const official2026AverageLpa = activeBatch.degree === 'B.Tech'
    ? OFFICIAL_2026.average_btech_lpa
    : OFFICIAL_2026.average_mtech_lpa;
  const official2026HighestIndianLpa = activeBatch.degree === 'B.Tech'
    ? OFFICIAL_2026.highest_indian_btech_lpa
    : OFFICIAL_2026.highest_indian_mtech_lpa;

  const [stats, setStats] = useState(initialSnapshot?.stats || {});
  const [companies, setCompanies] = useState(initialSnapshot?.companies || []);
  const [students, setStudents] = useState(initialSnapshot?.students || []);
  const [loading, setLoading] = useState(!initialSnapshot);
  const [error, setError] = useState('');
  const [loginError, setLoginError] = useState('');
  const [authPending, setAuthPending] = useState(false);
  const refreshRequestId = useRef(0);
  const isViewerAuthed = !!viewerToken;

  const formatInr = (val, period = 'p.a.') => {
    if (val === null || val === undefined || Number.isNaN(Number(val))) return '—';
    return `INR ${Number(val).toLocaleString('en-IN', { maximumFractionDigits: 2 })} ${period}`;
  };

  const formatPct = (val) => (val === null || val === undefined || Number.isNaN(Number(val)) ? '—' : `${val}%`);

  const formatDate = (val) => {
    if (!val) return '—';
    const date = new Date(val);
    if (Number.isNaN(date.getTime())) return '—';
    const day = date.getDate();
    const suffix = (d) => {
      if (d >= 11 && d <= 13) return 'th';
      const last = d % 10;
      if (last === 1) return 'st';
      if (last === 2) return 'nd';
      if (last === 3) return 'rd';
      return 'th';
    };
    const month = date.toLocaleString('en-US', { month: 'long' });
    const year = date.getFullYear();
    return `${day}${suffix(day)} ${month}, ${year}`;
  };

  const handleGoogleSuccess = async (credentialResponse) => {
    setAuthPending(true);
    setLoginError('');

    try {
      const response = await api.post('/auth/google', { credential: credentialResponse?.credential });
      setViewerToken(response.data.token);
      storeViewerToken(response.data.token);
      if (response.data.is_admin) {
        setToken(response.data.token);
      } else {
        setToken('');
      }
    } catch (err) {
      googleLogout();
      setLoginError(err.response?.data?.message || 'Google sign-in could not be verified.');
    } finally {
      setAuthPending(false);
    }
  };

  const handleGoogleError = () => {
    googleLogout();
    setLoginError('Google sign-in failed. Please try again.');
  };

  const handleViewerLogin = async ({ username, password }) => {
    setAuthPending(true);
    setLoginError('');

    try {
      const response = await api.post('/auth/viewer', { username, password });
      setViewerToken(response.data.token);
      storeViewerToken(response.data.token);
      setToken('');
    } catch (err) {
      setLoginError(err.response?.data?.message || 'Viewer sign-in could not be completed.');
    } finally {
      setAuthPending(false);
    }
  };

  const handleGoogleLogout = () => {
    googleLogout();
    setViewerToken('');
    storeViewerToken('');
    BATCHES.forEach((batch) => sessionStorage.removeItem(getBatchCacheKey(batch.key)));
    setToken('');
    setStats({});
    setCompanies([]);
    setStudents([]);
  };

  const [showCompanyModal, setShowCompanyModal] = useState(false);
  const [editCompany, setEditCompany] = useState(null);
  const [showStudentModal, setShowStudentModal] = useState(false);
  const [editStudent, setEditStudent] = useState(null);

  // Companies page: search, sort, filter, detail
  const [companySearch, setCompanySearch] = useState('');
  const [companySort, setCompanySort] = useState({ field: 'name', asc: true });
  const [companyFilters, setCompanyFilters] = useState({ type: '', category: '', branchGroup: '' });
  const [selectedCompany, setSelectedCompany] = useState(null);

  // Students page: search, sort, filter
  const [studentSearch, setStudentSearch] = useState('');
  const [studentSort, setStudentSort] = useState({ field: 'roll_number', asc: true });
  const [studentFilters, setStudentFilters] = useState({ branchGroup: '', programs: [], status: '', offerType: '' });
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [dashboardBranchFilter, setDashboardBranchFilter] = useState('ALL');
  const [mobileHeaderHidden, setMobileHeaderHidden] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [themeMode, setThemeMode] = useState(localStorage.getItem('themeMode') || 'light');

  useEffect(() => {
    localStorage.setItem('activeBatchKey', activeBatch.key);
    const cachedSnapshot = readBatchCache(activeBatch.key);

    if (cachedSnapshot) {
      setStats(cachedSnapshot.stats);
      setCompanies(cachedSnapshot.companies);
      setStudents(cachedSnapshot.students);
      setLoading(false);
    } else {
      setStats({});
      setCompanies([]);
      setStudents([]);
      setLoading(true);
    }

    setError('');
    setCompanyFilters({ type: '', category: '', branchGroup: '' });
    setStudentFilters({ branchGroup: '', programs: [], status: '', offerType: '' });
    setDashboardBranchFilter('ALL');
    setCompanySearch('');
    setStudentSearch('');
    setSelectedCompany(null);
    setSelectedStudent(null);
    setMobileNavOpen(false);
  }, [activeBatch.key]);

  useEffect(() => {
    if (!viewerToken) {
      setToken('');
      return;
    }

    let active = true;
    api.get('/auth/session', viewerHeaders)
      .then((response) => {
        if (!active) return;
        setToken(response.data.is_admin ? viewerToken : '');
      })
      .catch(() => {
        if (!active) return;
        handleGoogleLogout();
        setLoginError('Your viewer session expired. Please sign in again.');
      });

    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerHeaders, viewerToken]);

  useEffect(() => {
    const handleStorageChange = (event) => {
      if (event.key !== VIEWER_TOKEN_STORAGE_KEY) return;

      const nextToken = event.newValue || '';
      setViewerToken(nextToken);
      if (!nextToken) {
        setToken('');
        BATCHES.forEach((batch) => sessionStorage.removeItem(getBatchCacheKey(batch.key)));
        setStats({});
        setCompanies([]);
        setStudents([]);
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  useEffect(() => {
    setMobileNavOpen(false);
    setMobileHeaderHidden(false);
  }, [location.pathname]);

  useEffect(() => {
    localStorage.setItem('themeMode', themeMode);
    document.documentElement.setAttribute('data-theme', themeMode);
  }, [themeMode]);

  useEffect(() => {
    if (!isViewerAuthed || typeof window === 'undefined') {
      setMobileHeaderHidden(false);
      return undefined;
    }

    const mobileMedia = window.matchMedia('(max-width: 1180px)');
    let lastScrollY = window.scrollY;
    let ticking = false;

    const updateHeaderVisibility = () => {
      const currentScrollY = window.scrollY;
      const delta = currentScrollY - lastScrollY;

      if (!mobileMedia.matches || mobileNavOpen || currentScrollY <= 24) {
        setMobileHeaderHidden(false);
      } else if (delta > 8 && currentScrollY > 120) {
        setMobileHeaderHidden(true);
      } else if (delta < -8) {
        setMobileHeaderHidden(false);
      }

      lastScrollY = currentScrollY;
      ticking = false;
    };

    const handleScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(updateHeaderVisibility);
    };

    const handleViewportChange = () => {
      lastScrollY = window.scrollY;
      if (!mobileMedia.matches) {
        setMobileHeaderHidden(false);
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });

    if (mobileMedia.addEventListener) {
      mobileMedia.addEventListener('change', handleViewportChange);
    } else {
      mobileMedia.addListener(handleViewportChange);
    }

    updateHeaderVisibility();

    return () => {
      window.removeEventListener('scroll', handleScroll);

      if (mobileMedia.removeEventListener) {
        mobileMedia.removeEventListener('change', handleViewportChange);
      } else {
        mobileMedia.removeListener(handleViewportChange);
      }
    };
  }, [isViewerAuthed, mobileNavOpen]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const drawerMedia = window.matchMedia('(min-width: 901px)');
    const handleViewportChange = (event) => {
      if (event.matches) {
        setMobileNavOpen(false);
      }
    };

    if (drawerMedia.addEventListener) {
      drawerMedia.addEventListener('change', handleViewportChange);
    } else {
      drawerMedia.addListener(handleViewportChange);
    }

    return () => {
      if (drawerMedia.removeEventListener) {
        drawerMedia.removeEventListener('change', handleViewportChange);
      } else {
        drawerMedia.removeListener(handleViewportChange);
      }
    };
  }, []);

  const toggleMobileNav = () => {
    setMobileHeaderHidden(false);
    setMobileNavOpen((previous) => !previous);
  };

  const closeMobileNav = () => {
    setMobileNavOpen(false);
  };

  const toggleThemeMode = () => {
    setThemeMode((current) => (current === 'light' ? 'dark' : 'light'));
  };

  const availablePrograms = useMemo(
    () => sortPrograms([...new Set((stats.available_programs || students.map((student) => student.program)).filter(Boolean))]),
    [stats.available_programs, students]
  );

  const { branchGroups: dashboardBranchGroups, branchSummaries: dashboardBranchSummaries, programSummaries } = useMemo(
    () => buildProgramSummaries(students, isPlacementRecordsOnly),
    [isPlacementRecordsOnly, students]
  );

  const dashboardBranchFilters = useMemo(
    () => (isAggregateOnly ? ['ALL'] : ['ALL', ...dashboardBranchGroups]),
    [dashboardBranchGroups, isAggregateOnly]
  );

  const filteredProgramSummaries = useMemo(
    () => programSummaries.filter(({ branchGroup }) => dashboardBranchFilter === 'ALL' || branchGroup === dashboardBranchFilter),
    [dashboardBranchFilter, programSummaries]
  );

  const activeOverviewSummary = useMemo(
    () => (isAggregateOnly
      ? stats.branch_summary?.overall || EMPTY_SLICE_SUMMARY
      : dashboardBranchSummaries[dashboardBranchFilter] || EMPTY_SLICE_SUMMARY),
    [dashboardBranchFilter, dashboardBranchSummaries, isAggregateOnly, stats.branch_summary]
  );

  const toggleProgramFilter = (program) => {
    setStudentFilters((prev) => ({
      ...prev,
      programs: prev.programs.includes(program)
        ? prev.programs.filter((item) => item !== program)
        : [...prev.programs, program],
    }));
  };

  // Compute hiring stats per company from students data
  const companyHiringStats = useMemo(() => {
    const stats = companies.reduce((accumulator, company) => {
      const reportedOffers = Number(company.reported_offer_count) || 0;
      accumulator[company.id] = { total: 0, reported: reportedOffers, CSE: 0, ECE: 0, CB: 0, OTHER: 0, students: [] };
      return accumulator;
    }, {});
    students.forEach((s) => {
      (s.offers || []).forEach((o) => {
        const cid = o.company_id;
        if (!cid) return;
        const branchGroup = s.branch_group || getBranchGroup(s.program);
        if (!stats[cid]) stats[cid] = { total: 0, CSE: 0, ECE: 0, CB: 0, OTHER: 0, students: [] };
        stats[cid].total++;
        if (stats[cid][branchGroup] !== undefined) stats[cid][branchGroup]++;
        else stats[cid].OTHER++;
        stats[cid].students.push({ name: s.name, roll: s.roll_number, program: s.program, branch_group: branchGroup });
      });
    });
    return stats;
  }, [companies, students]);

  // Filtered and sorted companies
  const filteredCompanies = useMemo(() => {
    let result = [...companies];
    if (!isAdmin) {
      result = result.filter((company) => {
        const hiring = companyHiringStats[company.id];
        return (hiring?.total || 0) > 0 || (hiring?.reported || 0) > 0;
      });
    }
    // Search
    if (companySearch.trim()) {
      const q = companySearch.toLowerCase();
      result = result.filter((c) => c.name?.toLowerCase().includes(q));
    }
    // Filter by type
    if (companyFilters.type) {
      result = result.filter((c) => c.type === companyFilters.type);
    }
    // Filter by category
    if (companyFilters.category) {
      result = result.filter((c) => (c.category || '').toUpperCase() === companyFilters.category.toUpperCase());
    }
    if (companyFilters.branchGroup) {
      result = result.filter((c) => (companyHiringStats[c.id]?.[companyFilters.branchGroup] || 0) > 0);
    }
    // Sort
    const { field, asc } = companySort;
    result.sort((a, b) => {
      let av, bv;
      if (field === 'totalHired') {
        av = companyHiringStats[a.id]?.total || companyHiringStats[a.id]?.reported || 0;
        bv = companyHiringStats[b.id]?.total || companyHiringStats[b.id]?.reported || 0;
      } else if (field === 'cseHired') {
        av = companyHiringStats[a.id]?.CSE || 0;
        bv = companyHiringStats[b.id]?.CSE || 0;
      } else if (field === 'eceHired') {
        av = companyHiringStats[a.id]?.ECE || 0;
        bv = companyHiringStats[b.id]?.ECE || 0;
      } else if (field === 'cbHired') {
        av = companyHiringStats[a.id]?.CB || 0;
        bv = companyHiringStats[b.id]?.CB || 0;
      } else if (field === 'ctc' || field === 'stipend') {
        av = a[field] ?? -Infinity;
        bv = b[field] ?? -Infinity;
      } else if (field === 'offer_date') {
        av = a.offer_date ? new Date(a.offer_date).getTime() : 0;
        bv = b.offer_date ? new Date(b.offer_date).getTime() : 0;
      } else {
        av = (a[field] || '').toString().toLowerCase();
        bv = (b[field] || '').toString().toLowerCase();
      }
      if (av < bv) return asc ? -1 : 1;
      if (av > bv) return asc ? 1 : -1;
      return 0;
    });
    return result;
  }, [companies, companySearch, companyFilters, companySort, companyHiringStats, isAdmin]);

  // Filtered and sorted students
  const filteredStudents = useMemo(() => {
    let result = [...students];
    // Search by name or roll
    if (studentSearch.trim()) {
      const q = studentSearch.toLowerCase();
      result = result.filter((s) => s.name?.toLowerCase().includes(q) || s.roll_number?.toLowerCase().includes(q));
    }
    // Filter by program
    if (studentFilters.branchGroup) {
      result = result.filter((s) => (s.branch_group || getBranchGroup(s.program)) === studentFilters.branchGroup);
    }
    if (studentFilters.programs.length) {
      result = result.filter((s) => studentFilters.programs.includes(s.program));
    }
    // Filter by status
    if (studentFilters.status) {
      result = result.filter((s) => s.placement_status === studentFilters.status);
    }
    // Filter by offer type
    if (studentFilters.offerType) {
      result = result.filter((s) => {
        if (s.offers?.length) {
          return s.offers.some((o) => o.offer_type === studentFilters.offerType);
        }
        return s.offer_type === studentFilters.offerType;
      });
    }
    // Sort
    const { field, asc } = studentSort;
    result.sort((a, b) => {
      const participationRank = (student) => (
        ['Not Sitting', 'Ineligible'].includes(student.placement_status) ? 1 : 0
      );
      const rankDifference = participationRank(a) - participationRank(b);
      if (rankDifference !== 0) return rankDifference;

      let av, bv;
      if (field === 'ctc' || field === 'stipend') {
        // Use max from offers or direct value
        const getVal = (s, f) => {
          if (s.offers?.length) {
            const vals = s.offers.map((o) => o[f] ?? o[`company_${f}`]).filter(Boolean);
            return vals.length ? Math.max(...vals) : -Infinity;
          }
          return s[f] ?? s[`company_${f}`] ?? -Infinity;
        };
        av = getVal(a, field);
        bv = getVal(b, field);
      } else if (field === 'offer_date') {
        const getDate = (s) => {
          if (s.offers?.length) {
            const dates = s.offers.map((o) => o.offer_date || o.company_offer_date).filter(Boolean).map((d) => new Date(d).getTime());
            return dates.length ? Math.max(...dates) : 0;
          }
          return s.offer_date ? new Date(s.offer_date).getTime() : 0;
        };
        av = getDate(a);
        bv = getDate(b);
      } else {
        av = (a[field] || '').toString().toLowerCase();
        bv = (b[field] || '').toString().toLowerCase();
      }
      if (av < bv) return asc ? -1 : 1;
      if (av > bv) return asc ? 1 : -1;
      return 0;
    });
    return result;
  }, [students, studentSearch, studentFilters, studentSort]);

  const companyOverview = useMemo(() => {
    const totals = filteredCompanies.reduce((summary, company) => {
      const type = company.type || 'OTHER';
      const category = (company.category || '').toUpperCase();
      const hiring = companyHiringStats[company.id];
      summary.hires += isAggregateOnly ? hiring?.reported || 0 : hiring?.total || 0;
      if (isInternshipOfferType(type)) summary.intern += 1;
      if (isFullTimeOfferType(type)) summary.fte += 1;
      if (isCombinedOfferType(type)) summary.combo += 1;
      if (category === 'A+') summary.aplus += 1;
      return summary;
    }, { hires: 0, intern: 0, fte: 0, combo: 0, aplus: 0 });

    return {
      total: filteredCompanies.length,
      trackedHires: totals.hires,
      activeTypes: isAggregateOnly ? 'M.Tech CSE aggregate' : [totals.fte ? 'FTE' : null, totals.intern ? 'Intern' : null, totals.combo ? 'Hybrid' : null].filter(Boolean).join(' · ') || 'All company types',
      spotlight: totals.aplus,
    };
  }, [filteredCompanies, companyHiringStats, isAggregateOnly]);

  const studentOverview = useMemo(() => {
    const placed = filteredStudents.filter((student) => student.placement_status === 'Placed').length;
    const eligible = filteredStudents.filter(isPlacementEligibleStudent).length;
    const excluded = Math.max(filteredStudents.length - eligible, 0);
    const internships = filteredStudents.filter((student) => {
      if (student.offers?.length) {
        return student.offers.some((offer) => isInternshipOfferType(offer.offer_type));
      }
      return isInternshipOfferType(student.offer_type);
    }).length;

    return {
      total: filteredStudents.length,
      eligible,
      excluded,
      placed,
      unplaced: Math.max(eligible - placed, 0),
      internships,
      programs: new Set(filteredStudents.map((student) => student.program).filter(Boolean)).size,
    };
  }, [filteredStudents]);

  const dashboardVisuals = useMemo(() => {
    const cohortStudents = students.filter((student) => (
      dashboardBranchFilter === 'ALL'
      || getBranchGroup(student.program) === dashboardBranchFilter
    ));
    const cohortOffers = cohortStudents.flatMap(getStudentOffers);
    const ctcValues = cohortOffers
      .map((offer) => Number(offer.ctc ?? offer.company_ctc))
      .filter((value) => Number.isFinite(value) && value > 0);
    const compensationBands = [
      { label: '< 10 LPA', min: 0, max: 1000000 },
      { label: '10–15 LPA', min: 1000000, max: 1500000 },
      { label: '15–20 LPA', min: 1500000, max: 2000000 },
      { label: '20–30 LPA', min: 2000000, max: 3000000 },
      { label: '30+ LPA', min: 3000000, max: Infinity },
    ].map((band) => ({
      label: band.label,
      value: ctcValues.filter((value) => value >= band.min && value < band.max).length,
    }));

    const branchComparison = programSummaries.map(({ program, summary }) => ({
      label: program,
      value: summary.placement_percentage || 0,
      placed: summary.placed_students,
      eligible: summary.eligible_students,
    }));

    const recentCompanies = [...companies]
      .filter((company) => company.offer_date)
      .sort((left, right) => new Date(right.offer_date) - new Date(left.offer_date))
      .slice(0, 5);

    return { compensationBands, branchComparison, recentCompanies };
  }, [companies, dashboardBranchFilter, programSummaries, students]);

  const companyVisuals = useMemo(() => ({
    categories: [
      { label: 'A+', value: filteredCompanies.filter((company) => String(company.category).toUpperCase() === 'A+').length, tone: 'accent' },
      { label: 'A', value: filteredCompanies.filter((company) => String(company.category).toUpperCase() === 'A').length, tone: 'blue' },
      { label: 'B', value: filteredCompanies.filter((company) => String(company.category).toUpperCase() === 'B').length, tone: 'amber' },
    ],
    types: OFFER_TYPES.map((type) => ({
      label: type,
      value: filteredCompanies.filter((company) => company.type === type).length,
    })),
    topOffers: [...filteredCompanies]
      .sort((left, right) => (Number(right.reported_offer_count) || 0) - (Number(left.reported_offer_count) || 0))
      .slice(0, 8)
      .map((company) => ({ label: company.name, value: Number(company.reported_offer_count) || 0 })),
  }), [filteredCompanies]);

  const studentVisuals = useMemo(() => ({
    statuses: STUDENT_STATUS_OPTIONS.map((status, index) => ({
      label: status,
      value: filteredStudents.filter((student) => student.placement_status === status).length,
      tone: ['accent', 'blue', 'amber', 'muted'][index],
    })),
    programs: availablePrograms.map((program) => ({
      label: program,
      value: filteredStudents.filter((student) => student.program === program).length,
    })),
  }), [availablePrograms, filteredStudents]);

  // Toggle sort handler
  const toggleSort = (setter, current, field) => {
    if (current.field === field) {
      setter({ field, asc: !current.asc });
    } else {
      setter({ field, asc: true });
    }
  };

  const SortIcon = ({ field, current }) => {
    const active = current.field === field;
    return <span className="sort-icon">{active ? (current.asc ? '▲' : '▼') : '⇅'}</span>;
  };

  const refresh = (batchKey = activeBatch.key) => {
    const requestId = ++refreshRequestId.current;
    const controller = new AbortController();
    const cachedSnapshot = readBatchCache(batchKey);
    const hasFallbackData = !!cachedSnapshot;
    let retryTimer = null;
    let cancelled = false;

    if (!hasFallbackData) setLoading(true);

    let retries = 0;
    const maxRetries = 12; // 12 * 5s = 60s max wait
    const isCurrentRequest = () => !cancelled && refreshRequestId.current === requestId;

    const fetchData = async () => {
      try {
        await api.get('/ping', { signal: controller.signal });
        const params = {
          params: { batch: batchKey },
          headers: viewerHeaders.headers,
          signal: controller.signal,
        };
        const [statsRes, companyRes, studentRes] = await Promise.all([
          api.get('/stats', params),
          api.get('/companies', params),
          api.get('/students', params),
        ]);

        const nextSnapshot = {
          stats: statsRes.data,
          companies: companyRes.data,
          students: studentRes.data,
        };

        if (!isCurrentRequest()) return;
        setStats(nextSnapshot.stats);
        setCompanies(nextSnapshot.companies);
        setStudents(nextSnapshot.students);
        writeBatchCache(batchKey, nextSnapshot);
        setError('');
        setLoading(false);
      } catch (err) {
        if (!isCurrentRequest() || axios.isCancel(err)) return;

        if (err.response?.status === 401) {
          handleGoogleLogout();
          setLoginError('Your viewer session expired. Please sign in again.');
          setLoading(false);
          return;
        }

        if (retries < maxRetries) {
          retries++;
          setError(
            hasFallbackData
              ? `Showing saved data while the server wakes up. Refreshing latest data... (Attempt ${retries}/${maxRetries}).`
              : `Connecting to server... (Attempt ${retries}/${maxRetries}). Please wait while the server wakes up.`
          );
          retryTimer = window.setTimeout(fetchData, 5000);
        } else {
          setError(
            hasFallbackData
              ? `Showing saved data. Latest refresh failed: ${err.message}`
              : `Network Error: ${err.message}. The server might be down or taking too long.`
          );
          setLoading(false);
        }
      }
    };

    fetchData();

    return () => {
      cancelled = true;
      controller.abort();
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  };

  useEffect(() => {
    if (isViewerAuthed) return refresh(activeBatch.key);
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isViewerAuthed, activeBatch.key]);

  const batchPayload = {
    batch_key: activeBatch.key,
    degree: activeBatch.degree,
    graduation_year: activeBatch.graduation_year,
  };

  const saveCompany = async (payload) => {
    if (!isAdmin) return;
    if (editCompany) {
      await api.put(`/companies/${editCompany.id}`, { ...payload, ...batchPayload }, authHeaders);
    } else {
      await api.post('/companies', { ...payload, ...batchPayload }, authHeaders);
    }
    setShowCompanyModal(false);
    setEditCompany(null);
    refresh();
  };

  const deleteCompanyAction = async (id) => {
    if (!isAdmin) return;
    await api.delete(`/companies/${id}`, authHeaders);
    refresh();
  };

  const saveStudent = async (payload) => {
    if (!isAdmin) return;
    if (editStudent) {
      await api.put(`/students/${editStudent.id}`, { ...payload, ...batchPayload }, authHeaders);
    } else {
      await api.post('/students', { ...payload, ...batchPayload }, authHeaders);
    }
    setShowStudentModal(false);
    setEditStudent(null);
    refresh();
  };

  const deleteStudentAction = async (id) => {
    if (!isAdmin) return;
    await api.delete(`/students/${id}`, authHeaders);
    refresh();
  };

  if (!isViewerAuthed) {
    return (
      <LoginScreen
        assetBase={assetBase}
        onSuccess={handleGoogleSuccess}
        onError={handleGoogleError}
        onViewerLogin={handleViewerLogin}
        error={loginError}
        pending={authPending}
        themeMode={themeMode}
        onToggleTheme={toggleThemeMode}
      />
    );
  }

  if (loading) return <div className="container">Loading...</div>;

  return (
    <>
      <header className={[
        mobileHeaderHidden && !mobileNavOpen ? 'header-hidden' : '',
        mobileNavOpen ? 'header-nav-open' : '',
      ].filter(Boolean).join(' ')}>
        <div className="navbar">
          <div className="nav-brand-row">
            <Link to="/" className="nav-logo" onClick={closeMobileNav}>
              <img src={`${assetBase}iiitd_logo.png`} alt="IIIT Delhi logo" />
              <span className="nav-wordmark">
                <strong>Placement Atlas</strong>
                <small>Placement dashboard</small>
              </span>
            </Link>
            <button
              type="button"
              className={mobileNavOpen ? 'nav-toggle active' : 'nav-toggle'}
              aria-label={mobileNavOpen ? 'Close navigation menu' : 'Open navigation menu'}
              aria-expanded={mobileNavOpen}
              aria-controls="primary-navigation"
              onClick={toggleMobileNav}
            >
              <span />
              <span />
              <span />
            </button>
          </div>

          <div id="primary-navigation" className="nav-main-links">
            <Link className={location.pathname === '/' ? 'active' : ''} to="/" onClick={closeMobileNav}>Overview</Link>
            <Link className={location.pathname === '/companies' ? 'active' : ''} to="/companies" onClick={closeMobileNav}>Companies</Link>
            <Link className={location.pathname === '/students' ? 'active' : ''} to="/students" onClick={closeMobileNav}>Students</Link>
          </div>

          <div className="nav-user-row">
            <label className="nav-batch-select">
              <span>Cohort</span>
              <select value={activeBatch.key} onChange={(event) => setActiveBatchKey(event.target.value)}>
                {BATCHES.map((batch) => <option key={batch.key} value={batch.key}>{batch.label}</option>)}
              </select>
            </label>
            <div className="nav-actions">
              <ThemeToggle themeMode={themeMode} onToggle={toggleThemeMode} compact />
              <button className="secondary nav-signout" title="End viewer session" onClick={() => { closeMobileNav(); handleGoogleLogout(); }}>Sign out</button>
              {isAdmin && <Link className="nav-admin-link" to="/admin" onClick={closeMobileNav}>Viewer Access</Link>}
            </div>
          </div>
        </div>
      </header>

      <Routes>
        <Route
          path="/"
          element={(
            <main className="container dashboard-page">
              <div className="batch-tabs" aria-label="Select placement cohort">
                {BATCHES.map((batch) => (
                  <button key={batch.key} type="button" className={activeBatch.key === batch.key ? 'batch-tab active' : 'batch-tab'} onClick={() => setActiveBatchKey(batch.key)}>
                    <span>{batch.degree}</span><strong>{batch.academic_year || batch.graduation_year}</strong>
                  </button>
                ))}
              </div>

              <section className="editorial-hero">
                <div className="editorial-hero-copy">
                  <span className="eyebrow">{isOfficial2026 ? 'Tracker dataset' : 'Placement intelligence'} · {activeBatch.label}</span>
                  <h1>{isAggregateOnly ? 'A historical view of M.Tech CSE hiring.' : isOfficial2025 ? 'The official picture for the graduating class of 2025.' : isPlacementRecordsOnly ? 'Recorded outcomes from an earlier placement season.' : 'The shape of a cohort, beyond a spreadsheet.'}</h1>
                  <p>
                    {isAggregateOnly
                      ? `Company-level roles and reported offer counts for academic year ${activeBatch.academic_year}. Student-level and compensation data were not included in the source.`
                      : isOfficial2025
                        ? `Official institute-level placement statistics for the batch graduating in 2025. Uploaded student records remain available in the directories but are not used to infer placement percentages.`
                      : isPlacementRecordsOnly
                        ? `Student-level placement records for students passing out in ${activeBatch.graduation_year}. The source lists placed students only, so a cohort placement percentage is not shown.`
                        : `An evidence-led view of opportunity, outcomes, and compensation for students passing out in ${activeBatch.graduation_year}.`}
                  </p>
                  <div className="hero-actions">
                    <Link className="primary-link" to="/companies">Explore companies</Link>
                    {!isAggregateOnly && <Link className="text-link" to="/students">Browse student outcomes <span aria-hidden="true">→</span></Link>}
                  </div>
                  {error && <p className="hero-error">{error}</p>}
                </div>
                <div className="hero-outcome-panel">
                  {isAggregateOnly ? (
                    <div className="historical-total">
                      <span className="eyebrow">Reported offers</span>
                      <strong>{activeOverviewSummary.total_offers || 0}</strong>
                      <p>M.Tech CSE aggregate</p>
                    </div>
                  ) : isOfficial2025 ? (
                    <div className="historical-total">
                      <span className="eyebrow">Official campus placement</span>
                      <strong>{OFFICIAL_2025.campus_placement_percentage}%</strong>
                      <p>Batch graduated in 2025</p>
                    </div>
                  ) : isPlacementRecordsOnly ? (
                    <div className="historical-total">
                      <span className="eyebrow">Recorded placed students</span>
                      <strong>{activeOverviewSummary.placed_students || 0}</strong>
                      <p>Placement records only</p>
                    </div>
                  ) : (
                    <>
                      <div className="hero-outcome-topline">
                        <span>Overall placement</span>
                        <small>{activeOverviewSummary.eligible_students || 0} eligible students</small>
                      </div>
                      <DonutChart
                        value={activeOverviewSummary.placed_students}
                        total={activeOverviewSummary.eligible_students}
                        label="Placement rate"
                        detail={`${activeOverviewSummary.placed_students || 0} placed`}
                      />
                    </>
                  )}
                  <div className="hero-mini-facts">
                    <div><strong>{isOfficial2025 ? OFFICIAL_2025.companies : stats.number_of_companies ?? 0}</strong><span>companies</span></div>
                    <div><strong>{isOfficial2025 ? OFFICIAL_2025.total_offers : activeOverviewSummary.total_offers || 0}</strong><span>offers</span></div>
                    <div><strong>{isOfficial2025 ? `${official2025AverageLpa} LPA` : isAggregateOnly ? stats.total_companies_listed || 0 : isPlacementRecordsOnly ? activeOverviewSummary.placed_students || 0 : activeOverviewSummary.unplaced_students || 0}</strong><span>{isOfficial2025 ? `${activeBatch.degree} average` : isAggregateOnly ? 'listed' : isPlacementRecordsOnly ? 'students' : 'seeking'}</span></div>
                  </div>
                </div>
              </section>

              {isAggregateOnly && (
                <section className="historical-overview">
                  <div className="section-intro">
                    <div><span className="eyebrow">Aggregate source</span><h2>Offer volume by recruiter.</h2></div>
                    <p>This archive covers M.Tech CSE only. Counts are reported offers, not unique students, and companies with zero offers are retained in the source total.</p>
                  </div>
                  <div className="historical-summary-grid">
                    <MetricTile label="Reported offers" value={stats.total_offers || 0} note={`Academic year ${activeBatch.academic_year}`} />
                    <MetricTile label="Companies with offers" value={stats.number_of_companies || 0} note="Positive offer count" />
                    <MetricTile label="Recruiters listed" value={stats.total_companies_listed || 0} note="Includes zero-offer rows" />
                  </div>
                  <article className="insight-panel historical-ranking">
                    <div className="panel-heading"><div><span className="eyebrow">Leading recruiters</span><h2>Highest reported offer counts</h2></div></div>
                    <HorizontalBars items={companyVisuals.topOffers} />
                  </article>
                </section>
              )}

              {!isAggregateOnly && (
                <>
              {isOfficial2025 && (
                <section className="official-placement-dashboard">
                  <aside className="official-data-note">
                    <div>
                      <span className="eyebrow">Official 2025 statistics</span>
                      <h2>Placement percentage cannot be inferred from uploaded offer lists.</h2>
                    </div>
                    <p>The student files contain placement outcomes but not the complete eligible graduating cohort. Therefore, this dashboard uses only the officially provided 2025 figures for percentages and campus totals. Student and company directories are retained as record-level references.</p>
                  </aside>

                  <section className="metric-ledger official-metric-ledger">
                    <MetricTile label="Companies visited" value={OFFICIAL_2025.companies} note={`${OFFICIAL_2025.full_time_companies} full time · ${OFFICIAL_2025.summer_internship_companies} summer internship`} />
                    <MetricTile label="Total offers" value={OFFICIAL_2025.total_offers} note={`${OFFICIAL_2025.full_time_offers} full time · ${OFFICIAL_2025.internship_offers} internship`} />
                    <MetricTile label={`${activeBatch.degree} average`} value={`${official2025AverageLpa.toFixed(2)} LPA`} note={`Overall campus average ${OFFICIAL_2025.overall_average_lpa} LPA`} />
                    <MetricTile label="Highest overseas" value={`${OFFICIAL_2025.highest_overseas_lpa} LPA`} note={`${OFFICIAL_2025.overseas_offers} overseas offers`} />
                  </section>

                  <section className="insight-grid official-insight-grid">
                    <article className="insight-panel outcome-panel">
                      <div className="panel-heading"><div><span className="eyebrow">Offer composition</span><h2>Full-time and internship outcomes</h2></div><span className="panel-number">{OFFICIAL_2025.total_offers}</span></div>
                      <SegmentedBar label="Official offers" items={[
                        { label: 'Full time', value: OFFICIAL_2025.full_time_offers, tone: 'accent' },
                        { label: 'Internship', value: OFFICIAL_2025.internship_offers, tone: 'blue' },
                      ]} />
                      <div className="official-offer-geography">
                        <div><span>Indian full-time offers</span><strong>{OFFICIAL_2025.indian_offers}</strong></div>
                        <div><span>Overseas offers</span><strong>{OFFICIAL_2025.overseas_offers}</strong></div>
                        <div><span>Highest Indian, {activeBatch.degree}</span><strong>{official2025HighestIndianLpa} LPA</strong></div>
                      </div>
                    </article>

                    <article className="insight-panel">
                      <div className="panel-heading"><div><span className="eyebrow">Full-time quality</span><h2>Official offer categories</h2></div></div>
                      <SegmentedBar label="559 full-time offers" items={OFFICIAL_2025.categories.map((category, index) => ({
                        label: category.label,
                        value: category.value,
                        tone: index === 0 ? 'accent' : index === 1 ? 'blue' : 'amber',
                      }))} />
                      <div className="offer-type-ledger official-category-notes">
                        {OFFICIAL_2025.categories.map((category) => <div key={category.label}><span>{category.label}</span><strong>{category.note}</strong></div>)}
                      </div>
                    </article>
                  </section>

                  <section className="dashboard-section branch-section official-program-rates">
                    <div className="section-intro">
                      <div><span className="eyebrow">Official program percentages</span><h2>{activeBatch.degree} placement outcomes</h2></div>
                      <p>These percentages are official figures for the batch graduating in 2025, not calculations from the uploaded student records.</p>
                    </div>
                    <div className="branch-comparison-list">
                      {official2025Programs.map((program) => (
                        <div key={program.label} className="branch-comparison-row">
                          <div className="branch-name"><strong>{program.label}</strong><span>Official placement percentage</span></div>
                          <div className="branch-progress"><span style={{ width: `${program.value}%` }} /></div>
                          <strong className="branch-rate">{program.value.toFixed(2)}%</strong>
                        </div>
                      ))}
                    </div>
                  </section>
                </section>
              )}
              {isOfficial2026 && (
                <section className="official-placement-dashboard official-2026-dashboard">
                  <aside className="official-data-note">
                    <div>
                      <span className="eyebrow">College-published statistics · 2026</span>
                      <h2>Official institute figures, shown separately from this tracker.</h2>
                    </div>
                    <p>These campus-wide figures were officially published for the batch graduating in 2026. They are not calculated from our uploaded student and company records, so differences may reflect publication timing, coverage, or institute methodology.</p>
                  </aside>

                  <section className="metric-ledger official-metric-ledger">
                    <MetricTile label="Companies visited" value={OFFICIAL_2026.companies} note={`${OFFICIAL_2026.full_time_companies} full time · ${OFFICIAL_2026.summer_internship_companies} summer internship`} />
                    <MetricTile label="Total offers" value={OFFICIAL_2026.total_offers} note={`${OFFICIAL_2026.full_time_offers} full time · ${OFFICIAL_2026.internship_offers} summer internship`} />
                    <MetricTile label={`${activeBatch.degree} average`} value={`${official2026AverageLpa.toFixed(2)} LPA`} note={`Overall campus average ${OFFICIAL_2026.overall_average_lpa} LPA`} />
                    <MetricTile label="Campus placement" value={`${OFFICIAL_2026.campus_placement_percentage.toFixed(2)}%`} note="Official campus-wide percentage" />
                  </section>

                  <section className="insight-grid official-insight-grid">
                    <article className="insight-panel outcome-panel">
                      <div className="panel-heading"><div><span className="eyebrow">Official offer composition</span><h2>Full-time and summer internship offers</h2></div><span className="panel-number">{OFFICIAL_2026.total_offers}</span></div>
                      <SegmentedBar label="College-published offers" items={[
                        { label: 'Full time', value: OFFICIAL_2026.full_time_offers, tone: 'accent' },
                        { label: 'Summer internship', value: OFFICIAL_2026.internship_offers, tone: 'blue' },
                      ]} />
                      <div className="official-offer-geography">
                        <div><span>Indian full-time offers</span><strong>{OFFICIAL_2026.indian_offers}</strong></div>
                        <div><span>Overseas offers</span><strong>{OFFICIAL_2026.overseas_offers}</strong></div>
                        <div><span>Highest Indian, {activeBatch.degree}</span><strong>{official2026HighestIndianLpa.toFixed(2)} LPA</strong></div>
                        <div><span>Highest overseas</span><strong>{OFFICIAL_2026.highest_overseas_lpa.toFixed(2)} LPA</strong></div>
                      </div>
                    </article>

                    <article className="insight-panel">
                      <div className="panel-heading"><div><span className="eyebrow">Official full-time quality</span><h2>Published offer categories</h2></div></div>
                      <SegmentedBar label={`${OFFICIAL_2026.full_time_offers} full-time offers`} items={OFFICIAL_2026.categories.map((category, index) => ({
                        label: category.label,
                        value: category.value,
                        tone: index === 0 ? 'accent' : index === 1 ? 'blue' : 'amber',
                      }))} />
                      <div className="offer-type-ledger official-category-notes">
                        {OFFICIAL_2026.categories.map((category) => <div key={category.label}><span>{category.label}</span><strong>{category.note}</strong></div>)}
                      </div>
                      <p className="official-publication-note">{OFFICIAL_2026.note}</p>
                    </article>
                  </section>

                  <section className="dashboard-section branch-section official-program-rates">
                    <div className="section-intro">
                      <div><span className="eyebrow">Official program percentages</span><h2>{activeBatch.degree} placement outcomes</h2></div>
                      <p>College-published percentages for the batch graduating in 2026. The tracker-derived program comparison remains available below.</p>
                    </div>
                    <div className="branch-comparison-list">
                      {official2026Programs.map((program) => (
                        <div key={program.label} className="branch-comparison-row">
                          <div className="branch-name"><strong>{program.label}</strong><span>Official placement percentage</span></div>
                          <div className="branch-progress"><span style={{ width: `${program.value}%` }} /></div>
                          <strong className="branch-rate">{program.value.toFixed(2)}%</strong>
                        </div>
                      ))}
                    </div>
                  </section>

                  <div className="dataset-divider">
                    <span className="eyebrow">Tracker dataset · {activeBatch.label}</span>
                    <h2>Recorded data on this website</h2>
                    <p>The dashboard below is calculated only from student, company, and offer records currently stored in this tracker. It is intentionally separate from the official publication above.</p>
                  </div>
                </section>
              )}
              {isPlacementRecordsOnly && !isOfficial2025 && (
                <aside className="disclaimer-card">
                  <span className="eyebrow">Historical source scope</span>
                  <p>This source contains placement outcomes, not the full graduating roster. Counts and compensation are shown, but placement percentages and unplaced-student totals are intentionally not inferred.</p>
                  {stats.historical_reported_offers > 0 && <p>The same M.Tech 2025 view also includes the 2024-25 CSE aggregate: {stats.historical_reported_offers} reported offers across {stats.historical_recruiters} recruiters. These aggregate counts are labeled separately from student-linked offers.</p>}
                </aside>
              )}
              {!isOfficial2025 && <section className="dashboard-control-row">
                <div>
                  <span className="eyebrow">Current lens</span>
                  <h2>{dashboardBranchFilter === 'ALL' ? 'All programs' : DASHBOARD_BRANCH_LABELS[dashboardBranchFilter]}</h2>
                </div>
                <div className="filter-chip-row">
                  {dashboardBranchFilters.map((branchGroup) => (
                    <button key={branchGroup} type="button" className={dashboardBranchFilter === branchGroup ? 'filter-chip active' : 'filter-chip'} onClick={() => setDashboardBranchFilter(branchGroup)}>
                      {DASHBOARD_BRANCH_LABELS[branchGroup] || branchGroup}
                    </button>
                  ))}
                </div>
              </section>}

              {!isOfficial2025 && <section className="metric-ledger comp-ledger">
                <MetricTile metricKey="highest_ctc" label="Highest CTC" value={formatInr(activeOverviewSummary.highest_ctc, 'p.a.')} note="Peak recorded package" />
                <MetricTile metricKey="median_ctc" label="Median CTC" value={formatInr(activeOverviewSummary.median_ctc, 'p.a.')} note="Middle of recorded offers" />
                <MetricTile metricKey="average_ctc" label="Average CTC" value={formatInr(activeOverviewSummary.average_ctc, 'p.a.')} note="Mean of recorded offers" />
                <MetricTile metricKey="median_stipend" label="Median stipend" value={formatInr(activeOverviewSummary.median_stipend, 'p.m.')} note="Middle of recorded stipends" />
                <MetricTile metricKey="average_stipend" label="Average stipend" value={formatInr(activeOverviewSummary.average_stipend, 'p.m.')} note="Across available stipend data" />
                <MetricTile metricKey="total_Aplus_offers" label="A+ offers" value={activeOverviewSummary.total_Aplus_offers || 0} note="Premium category outcomes" />
              </section>}

              {!isOfficial2025 && <section className="insight-grid">
                <article className="insight-panel outcome-panel">
                  <div className="panel-heading">
                    <div><span className="eyebrow">Outcome composition</span><h2>{isPlacementRecordsOnly ? 'Recorded placed students' : 'Where the cohort stands'}</h2></div>
                    <span className="panel-number">{activeOverviewSummary.total_students || 0}</span>
                  </div>
                  <SegmentedBar label={isPlacementRecordsOnly ? 'Source records' : 'Student status'} items={isPlacementRecordsOnly ? [
                    { label: 'Placed records', value: activeOverviewSummary.placed_students || 0, tone: 'accent' },
                  ] : [
                    { label: 'Placed', value: activeOverviewSummary.placed_students || 0, tone: 'accent' },
                    { label: 'Eligible, unplaced', value: activeOverviewSummary.unplaced_students || 0, tone: 'blue' },
                    { label: 'Excluded', value: activeOverviewSummary.excluded_students || 0, tone: 'muted' },
                  ]} />
                  <div className="dual-donuts">
                    <DonutChart value={activeOverviewSummary.total_fte_offers} total={activeOverviewSummary.total_students} label="FTE intensity" detail={`${activeOverviewSummary.total_fte_offers || 0} offers`} tone="blue" />
                    <DonutChart
                      value={(activeOverviewSummary.total_intern_offers || 0) + (activeOverviewSummary.total_combo_offers || 0)}
                      total={activeOverviewSummary.total_students}
                      label="Internship intensity"
                      detail={`${(activeOverviewSummary.total_intern_offers || 0) + (activeOverviewSummary.total_combo_offers || 0)} offers with internship`}
                    />
                  </div>
                </article>

                <article className="insight-panel">
                  <div className="panel-heading"><div><span className="eyebrow">Offer quality</span><h2>Category mix</h2></div></div>
                  <SegmentedBar label="Recorded offers" items={[
                    { label: 'A+', value: activeOverviewSummary.total_Aplus_offers || 0, tone: 'accent' },
                    { label: 'A', value: activeOverviewSummary.total_A_offers || 0, tone: 'blue' },
                    { label: 'B', value: activeOverviewSummary.total_B_offers || 0, tone: 'amber' },
                  ]} />
                  <div className="offer-type-ledger">
                    <div><span>FTE</span><strong>{activeOverviewSummary.total_fte_offers || 0}</strong></div>
                    <div><span>Intern only</span><strong>{activeOverviewSummary.total_intern_offers || 0}</strong></div>
                    <div><span>Combined</span><strong>{activeOverviewSummary.total_combo_offers || 0}</strong></div>
                  </div>
                </article>

                <article className="insight-panel compensation-panel">
                  <div className="panel-heading"><div><span className="eyebrow">Compensation</span><h2>CTC distribution</h2></div><small>Offer count by band</small></div>
                  <HorizontalBars items={dashboardVisuals.compensationBands} />
                </article>
              </section>}

              {!isPlacementRecordsOnly && <section className="dashboard-section branch-section">
                <div className="section-intro">
                  <div><span className="eyebrow">Program comparison</span><h2>Every discipline has its own story.</h2></div>
                  <p>Placement rates use eligible and sitting students as the denominator. Offer counts may exceed placed students where multiple offers are recorded.</p>
                </div>
                <div className="branch-comparison-list">
                  {dashboardVisuals.branchComparison.map((item) => (
                    <div key={item.label} className="branch-comparison-row">
                      <div className="branch-name"><strong>{item.label}</strong><span>{item.placed} of {item.eligible} placed</span></div>
                      <div className="branch-progress"><span style={{ width: `${Math.min(item.value, 100)}%` }} /></div>
                      <strong className="branch-rate">{formatPct(item.value)}</strong>
                    </div>
                  ))}
                </div>
              </section>}

              {!isOfficial2025 && <section className="dashboard-section program-section">
                <div className="section-intro">
                  <div><span className="eyebrow">Program notes</span><h2>A closer reading.</h2></div>
                  <span className="section-count">{filteredProgramSummaries.length} programs</span>
                </div>
                <div className="program-editorial-grid">
                  {filteredProgramSummaries.map(({ program, branchGroup, summary }) => (
                    <article key={program} className="program-editorial-card">
                      <div className="program-card-top"><span>{branchGroup}</span><strong>{isPlacementRecordsOnly ? `${summary.placed_students} placed` : formatPct(summary.placement_percentage)}</strong></div>
                      <h3>{program}</h3>
                      <p>{isPlacementRecordsOnly ? `${summary.placed_students} placed students with ${summary.total_offers} recorded offers.` : `${summary.placed_students} placed from ${summary.eligible_students} eligible students, with ${summary.total_offers} recorded offers.`}</p>
                      <dl>
                        <div><dt>Median CTC</dt><dd>{formatInr(summary.median_ctc, 'p.a.')}</dd></div>
                        <div><dt>Average CTC</dt><dd>{formatInr(summary.average_ctc, 'p.a.')}</dd></div>
                        <div><dt>Highest CTC</dt><dd>{formatInr(summary.highest_ctc, 'p.a.')}</dd></div>
                        <div><dt>A+ offers</dt><dd>{summary.total_Aplus_offers}</dd></div>
                      </dl>
                    </article>
                  ))}
                </div>
              </section>}

              {!isOfficial2025 && <section className="dashboard-section recent-section">
                <div className="section-intro"><div><span className="eyebrow">Recent records</span><h2>Latest offer dates.</h2></div><Link className="text-link" to="/companies">All companies →</Link></div>
                <div className="recent-company-list">
                  {dashboardVisuals.recentCompanies.map((company, index) => (
                    <button key={company.id} type="button" onClick={() => { setSelectedCompany(company); navigate('/companies'); }}>
                      <span className="recent-index">{String(index + 1).padStart(2, '0')}</span>
                      <span className="company-monogram">{initialsFor(company.name)}</span>
                      <span className="recent-company-copy"><strong>{company.name}</strong><small>{company.role || company.type}</small></span>
                      <span className="recent-company-date">{formatDate(company.offer_date)}</span>
                    </button>
                  ))}
                </div>
              </section>}
                </>
              )}

              <aside className="disclaimer-card">
                <span className="eyebrow">Data note</span>
                <p>This is an unofficial side project and is not verified by the Placement Office. Report genuine discrepancies to yash25091@iiitd.ac.in.</p>
                <Link to="/admin">Administrative access</Link>
              </aside>
            </main>
          )}
        />

        <Route
          path="/companies"
          element={(
            <main className="container section-page companies-page">
              <section className="directory-hero">
                <div className="directory-hero-copy">
                  <span className="eyebrow">Company index · {activeBatch.label}</span>
                  <h1>Recruiters, roles, and the opportunities they created.</h1>
                  <p>{isAggregateOnly ? 'Explore company roles and reported M.Tech CSE offer counts from the historical aggregate.' : 'Explore compensation, eligibility, offer type, and the actual branch footprint of every recorded company.'}</p>
                </div>
                <div className="directory-hero-stats">
                  <MetricTile label="Visible companies" value={companyOverview.total} note={companyOverview.activeTypes} />
                  <MetricTile label={isAggregateOnly ? 'Reported offers' : 'Tracked hires'} value={companyOverview.trackedHires} note="Across current filters" />
                  <MetricTile label={isAggregateOnly ? 'Data scope' : 'A+ recruiters'} value={isAggregateOnly ? 'CSE' : companyOverview.spotlight} note={isAggregateOnly ? activeBatch.academic_year : 'Premium category'} />
                </div>
              </section>

              <MobileDisclosure summary="Recruiter insights" className="insight-disclosure" contentClassName="directory-insights">
                <div className="directory-insight-copy">
                  <span className="eyebrow">Market composition</span>
                  <h2>A quick read of the recruiter set.</h2>
                  <p>Filters update the visual summaries and opportunity cards together.</p>
                </div>
                {isAggregateOnly ? (
                  <div style={{ gridColumn: 'span 2' }}><HorizontalBars items={companyVisuals.topOffers.slice(0, 5)} /></div>
                ) : (
                  <><SegmentedBar label="Company categories" items={companyVisuals.categories} /><HorizontalBars items={companyVisuals.types} /></>
                )}
              </MobileDisclosure>

              <section className={isAggregateOnly ? 'directory-toolbar aggregate-directory-toolbar' : 'directory-toolbar'}>
                <input
                  type="text"
                  className="search-input"
                  placeholder="Search companies by name"
                  value={companySearch}
                  onChange={(e) => setCompanySearch(e.target.value)}
                />
                <MobileDisclosure
                  summary={`Filters & sort${Object.values(companyFilters).filter(Boolean).length ? ` · ${Object.values(companyFilters).filter(Boolean).length} active` : ''}`}
                  className="toolbar-disclosure"
                  contentClassName="toolbar-controls"
                >
                  {!isAggregateOnly && <div className="filter-group">
                    <label>Opportunity</label>
                    <select value={companyFilters.type} onChange={(e) => setCompanyFilters((f) => ({ ...f, type: e.target.value }))}>
                      <option value="">All</option>
                      {OFFER_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                    </select>
                  </div>}
                  {!isAggregateOnly && <div className="filter-group">
                    <label>Category</label>
                    <select value={companyFilters.category} onChange={(e) => setCompanyFilters((f) => ({ ...f, category: e.target.value }))}>
                      <option value="">All</option>
                      <option value="A+">A+</option>
                      <option value="A">A</option>
                      <option value="B">B</option>
                    </select>
                  </div>}
                  {!isAggregateOnly && <div className="filter-group">
                    <label>Hiring branch</label>
                    <select value={companyFilters.branchGroup} onChange={(e) => setCompanyFilters((f) => ({ ...f, branchGroup: e.target.value }))}>
                      <option value="">All</option>
                      <option value="CSE">CSE</option>
                      <option value="ECE">ECE</option>
                      <option value="CB">CB</option>
                    </select>
                  </div>}
                  <label className="sort-control">Sort
                    <select value={companySort.field} onChange={(event) => setCompanySort({ field: event.target.value, asc: event.target.value === 'name' })}>
                      <option value="name">Company name</option><option value="ctc">Highest CTC</option><option value="stipend">Highest stipend</option><option value="totalHired">Most hires</option><option value="offer_date">Latest offer date</option>
                    </select>
                  </label>
                  {isAdmin && <button onClick={() => { setEditCompany(null); setShowCompanyModal(true); }}>Add company</button>}
                </MobileDisclosure>
              </section>

              <div className="directory-result-heading">
                <div><span className="eyebrow">Opportunity catalogue</span><h2>{filteredCompanies.length} companies</h2></div>
                <button type="button" className="text-button" onClick={() => setCompanySort((current) => ({ ...current, asc: !current.asc }))}>{companySort.asc ? 'Ascending' : 'Descending'} <SortIcon field={companySort.field} current={companySort} /></button>
              </div>

              <section className="company-card-grid">
                {filteredCompanies.map((company) => {
                  const hiring = companyHiringStats[company.id] || { total: 0, reported: 0, CSE: 0, ECE: 0, CB: 0 };
                  const showReportedAggregate = !isAggregateOnly && hiring.reported > 0;
                  const categoryClass = String(company.category || 'other').toLowerCase().replace('+', 'plus');
                  return (
                    <article key={company.id} className={`company-card company-card-${categoryClass}`}>
                      <button type="button" className="company-card-main" onClick={() => setSelectedCompany(company)}>
                        <div className={`company-monogram company-monogram-${categoryClass}`}>{initialsFor(company.name)}</div>
                        <div className="company-card-copy">
                          <div className="company-card-kicker">
                            {isAggregateOnly ? <><span>M.Tech CSE</span><span>{company.reported_offer_count || 0} reported offers</span></> : <><span>{company.type || 'Opportunity'}</span><span>{showReportedAggregate ? `${hiring.reported} reported CSE offers` : `Category ${company.category || '—'}`}</span></>}
                          </div>
                          <h3>{company.name}</h3>
                          <p>{company.role || 'Role details not recorded'}</p>
                        </div>
                        <span className="company-card-arrow" aria-hidden="true">↗</span>
                      </button>
                      <div className="company-card-facts">
                        {isAggregateOnly ? (
                          <>
                            <div><span>Reported offers</span><strong>{company.reported_offer_count || 0}</strong></div>
                            <div><span>Scope</span><strong>M.Tech CSE</strong></div>
                            <div><span>Academic year</span><strong>{activeBatch.academic_year}</strong></div>
                          </>
                        ) : (
                          <>
                            <div><span>CTC</span><strong>{formatInr(company.ctc, 'p.a.')}</strong></div>
                            <div><span>Stipend</span><strong>{formatInr(company.stipend, 'p.m.')}</strong></div>
                            <div><span>{showReportedAggregate ? 'Reported CSE offers' : 'Eligibility'}</span><strong>{showReportedAggregate ? hiring.reported : company.eligible_cgpa ? `${company.eligible_cgpa} CGPA` : 'Not listed'}</strong></div>
                          </>
                        )}
                      </div>
                      <div className="company-hiring-footprint">
                        <div className="footprint-head"><span>{isAggregateOnly || (!hiring.total && hiring.reported) ? 'Reported aggregate' : 'Hiring footprint'}</span><strong>{isAggregateOnly || (!hiring.total && hiring.reported) ? hiring.reported : hiring.total} {isAggregateOnly || (!hiring.total && hiring.reported) ? 'offers' : 'hires'}</strong></div>
                        <div className="footprint-bars">
                          {(isAggregateOnly || (!hiring.total && hiring.reported) ? ['CSE'] : ['CSE', 'ECE', 'CB']).map((branch) => (
                            <div key={branch}><span>{branch}</span><i><b style={{ width: `${isAggregateOnly || (!hiring.total && hiring.reported) ? 100 : hiring.total ? (hiring[branch] / hiring.total) * 100 : 0}%` }} /></i><strong>{isAggregateOnly || (!hiring.total && hiring.reported) ? hiring.reported : hiring[branch]}</strong></div>
                          ))}
                        </div>
                      </div>
                      {isAdmin && <div className="card-admin-actions"><button className="secondary" onClick={() => { setEditCompany(company); setShowCompanyModal(true); }}>Edit</button><button className="danger-button" onClick={() => deleteCompanyAction(company.id)}>Delete</button></div>}
                    </article>
                  );
                })}
                {!filteredCompanies.length && <div className="empty-directory-state"><h3>No companies found.</h3><p>Try widening the current search or filters.</p></div>}
              </section>

              {/* Add/Edit Company Modal */}
              <Modal open={showCompanyModal} onClose={() => setShowCompanyModal(false)}>
                <h3>{editCompany ? 'Edit Company' : 'Add Company'}</h3>
                <CompanyForm
                  initial={editCompany || {}}
                  onSubmit={saveCompany}
                  onCancel={() => setShowCompanyModal(false)}
                />
              </Modal>

              {/* Company Detail Modal */}
              <Modal open={!!selectedCompany} onClose={() => setSelectedCompany(null)}>
                {selectedCompany && (() => {
                  const stats = companyHiringStats[selectedCompany.id] || { total: 0, reported: 0, CSE: 0, ECE: 0, CB: 0, OTHER: 0, students: [] };
                  return (
                    <div className="company-detail">
                      <div className="detail-hero-row">
                        <span className="company-monogram company-monogram-large">{initialsFor(selectedCompany.name)}</span>
                        <div>
                          <span className="eyebrow">{selectedCompany.type || 'Opportunity'} · Category {selectedCompany.category || '—'}</span>
                          <h2>{selectedCompany.name}</h2>
                          <p>{selectedCompany.role || 'Role details not recorded'}</p>
                        </div>
                      </div>
                      <div className="info-grid">
                        {isAggregateOnly ? (
                          <>
                            <div className="info-item"><div className="label">Reported offers</div><div className="value">{selectedCompany.reported_offer_count || 0}</div></div>
                            <div className="info-item"><div className="label">Scope</div><div className="value">M.Tech CSE</div></div>
                            <div className="info-item"><div className="label">Academic year</div><div className="value">{activeBatch.academic_year}</div></div>
                          </>
                        ) : (
                          <>
                        <div className="info-item">
                          <div className="label">CTC</div>
                          <div className="value">{formatInr(selectedCompany.ctc, 'p.a.')}</div>
                        </div>
                        <div className="info-item">
                          <div className="label">Stipend</div>
                          <div className="value">{formatInr(selectedCompany.stipend, 'p.m.')}</div>
                        </div>
                        <div className="info-item">
                          <div className="label">Eligible CGPA</div>
                          <div className="value">{selectedCompany.eligible_cgpa ?? '—'}</div>
                        </div>
                        <div className="info-item">
                          <div className="label">Backlog policy</div>
                          <div className="value">{selectedCompany.backlog_allowed ? 'Allowed' : 'Not allowed'}</div>
                        </div>
                        <div className="info-item">
                          <div className="label">Registration deadline</div>
                          <div className="value">{formatDate(selectedCompany.registration_deadline)}</div>
                        </div>
                        <div className="info-item">
                          <div className="label">Offer date</div>
                          <div className="value">{formatDate(selectedCompany.offer_date)}</div>
                        </div>
                        {stats.reported > 0 && <div className="info-item">
                          <div className="label">Reported CSE offers</div>
                          <div className="value">{stats.reported}</div>
                        </div>}
                          </>
                        )}
                      </div>

                      <h3 className="detail-section-title">{isAggregateOnly ? 'Reported aggregate' : 'Hiring footprint'}</h3>
                      <div className="hiring-stats">
                        <div className="hiring-stat">
                          <div className="count">{isAggregateOnly ? stats.reported : stats.total}</div>
                          <div className="label">{isAggregateOnly ? 'Reported offers' : 'Linked student offers'}</div>
                        </div>
                        {!isAggregateOnly && <div className="hiring-stat">
                          <div className="count">{stats.CSE}</div>
                          <div className="label">CSE</div>
                        </div>}
                        {!isAggregateOnly && <div className="hiring-stat">
                          <div className="count">{stats.ECE}</div>
                          <div className="label">ECE</div>
                        </div>}
                        {!isAggregateOnly && <div className="hiring-stat">
                          <div className="count">{stats.CB}</div>
                          <div className="label">CB</div>
                        </div>}
                      </div>

                      {!isAggregateOnly && stats.students.length > 0 && (
                        <>
                          <h3 className="detail-section-title">Hired students</h3>
                          <div className="hired-students-list">
                            {stats.students.map((student, index) => (
                              <div key={`${student.roll}-${index}`}><span className="student-avatar">{initialsFor(student.name)}</span><div><strong>{student.name}</strong><small>{student.roll} · {student.program}</small></div></div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })()}
              </Modal>
            </main>
          )}
        />

        <Route
          path="/students"
          element={(
            isAggregateOnly ? (
              <main className="container section-page students-page">
                <section className="directory-hero">
                  <div className="directory-hero-copy">
                    <span className="eyebrow">Aggregate archive · {activeBatch.label}</span>
                    <h1>Student-level records were not included.</h1>
                    <p>This historical source contains M.Tech CSE company names, roles, and aggregate offer counts only. No student names, roll numbers, placement rates, or compensation figures are inferred.</p>
                    <div className="hero-actions"><Link className="primary-link" to="/companies">View reported offers</Link><Link className="text-link" to="/">Return to overview</Link></div>
                  </div>
                </section>
              </main>
            ) : (
              <main className="container section-page students-page">
              <section className="directory-hero student-directory-hero">
                <div className="directory-hero-copy">
                  <span className="eyebrow">Student outcomes · {activeBatch.label}</span>
                  <h1>A living directory of progress, offers, and possibility.</h1>
                  <p>Read the cohort by status, discipline, and offer journey without reducing people to spreadsheet rows.</p>
                </div>
                <div className="student-hero-outcome">
                  <DonutChart value={studentOverview.placed} total={studentOverview.eligible} label="Visible placement rate" detail={`${studentOverview.placed} placed`} />
                </div>
              </section>

              <MobileDisclosure summary="Selection overview" className="insight-disclosure" contentClassName="student-status-overview">
                <div className="student-status-copy"><span className="eyebrow">Current selection</span><h2>{studentOverview.total} students across {studentOverview.programs} programs.</h2><p>{studentOverview.internships} students have an internship or combined track in the visible result set.</p></div>
                <SegmentedBar label="Placement status" items={studentVisuals.statuses} />
                <HorizontalBars items={studentVisuals.programs} />
              </MobileDisclosure>

              <section className="directory-toolbar student-toolbar">
                <input
                  type="text"
                  className="search-input"
                  placeholder="Search by student name or roll number"
                  value={studentSearch}
                  onChange={(e) => setStudentSearch(e.target.value)}
                />
                <MobileDisclosure
                  summary={`Filters & sort${[studentFilters.branchGroup, studentFilters.status, studentFilters.offerType, ...studentFilters.programs].filter(Boolean).length ? ` · ${[studentFilters.branchGroup, studentFilters.status, studentFilters.offerType, ...studentFilters.programs].filter(Boolean).length} active` : ''}`}
                  className="toolbar-disclosure"
                  contentClassName="toolbar-controls"
                >
                  <div className="filter-group">
                    <label>Branch group</label>
                    <select value={studentFilters.branchGroup} onChange={(e) => setStudentFilters((f) => ({ ...f, branchGroup: e.target.value }))}>
                      <option value="">All</option>
                      <option value="CSE">CSE</option>
                      <option value="ECE">ECE</option>
                      <option value="CB">CB</option>
                    </select>
                  </div>
                  <div className="filter-group">
                    <label>Status</label>
                    <select value={studentFilters.status} onChange={(e) => setStudentFilters((f) => ({ ...f, status: e.target.value }))}>
                      <option value="">All</option>
                      {STUDENT_STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status}>{status}</option>
                      ))}
                    </select>
                  </div>
                  <div className="filter-group">
                    <label>Offer type</label>
                    <select value={studentFilters.offerType} onChange={(e) => setStudentFilters((f) => ({ ...f, offerType: e.target.value }))}>
                      <option value="">All</option>
                      {OFFER_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                    </select>
                  </div>
                  <label className="sort-control">Sort by
                    <select value={studentSort.field} onChange={(event) => setStudentSort({ field: event.target.value, asc: true })}>
                      <option value="roll_number">Roll number</option><option value="name">Name</option><option value="ctc">Highest CTC</option><option value="stipend">Highest stipend</option><option value="offer_date">Latest offer</option>
                    </select>
                  </label>
                  {isAdmin && <button onClick={() => { setEditStudent(null); setShowStudentModal(true); }}>Add student</button>}
                </MobileDisclosure>
              </section>

              {availablePrograms.length > 0 && (
                <MobileDisclosure summary={`Programs${studentFilters.programs.length ? ` · ${studentFilters.programs.length} selected` : ''}`} className="program-disclosure" contentClassName="program-filter-strip">
                  <span className="eyebrow">Programs</span>
                  <div className="filter-chip-row">
                    {availablePrograms.map((program) => {
                      const isSelected = studentFilters.programs.includes(program);
                      return (
                        <button
                          key={program}
                          type="button"
                          className={isSelected ? 'filter-chip active' : 'filter-chip'}
                          onClick={() => toggleProgramFilter(program)}
                        >
                          {program}
                        </button>
                      );
                    })}
                    {!!studentFilters.programs.length && (
                      <button type="button" className="secondary" onClick={() => setStudentFilters((f) => ({ ...f, programs: [] }))}>
                        Clear programs
                      </button>
                    )}
                  </div>
                </MobileDisclosure>
              )}

              <div className="directory-result-heading student-result-heading">
                <div><span className="eyebrow">Student directory</span><h2>{filteredStudents.length} visible records</h2></div>
              </div>

              <section className="student-directory-list">
                {filteredStudents.map((student) => {
                  const offers = getStudentOffers(student);
                  const highestCtc = Math.max(...offers.map((offer) => Number(offer.ctc ?? offer.company_ctc) || 0), 0);
                  const companyNames = offers.map((offer) => offer.company_name).filter(Boolean);
                  const statusClass = String(student.placement_status || 'unknown').toLowerCase().replace(/\s+/g, '-');
                  return (
                    <article key={student.id} className={`student-profile-row student-profile-${statusClass}`}>
                      <button type="button" className="student-profile-main" onClick={() => setSelectedStudent(student)}>
                        <span className="student-avatar">{initialsFor(student.name)}</span>
                        <span className="student-identity"><strong>{student.name}</strong><small>{student.roll_number} · {student.program}</small></span>
                        <StatusPill status={student.placement_status} />
                      </button>
                      <div className="student-offer-summary">
                        {companyNames.length ? (
                          <><span className="offer-company-stack">{companyNames.slice(0, 2).join(' · ')}{companyNames.length > 2 ? ` +${companyNames.length - 2}` : ''}</span><small>{offers.map((offer) => offer.offer_type).filter(Boolean).join(' · ')}</small></>
                        ) : <span className="no-offer-copy">No recorded offer yet</span>}
                      </div>
                      <div className="student-compensation"><span>Best recorded CTC</span><strong>{formatInr(highestCtc || null, 'p.a.')}</strong></div>
                      <button type="button" className="row-open-button" aria-label={`Open ${student.name}`} onClick={() => setSelectedStudent(student)}>→</button>
                      {isAdmin && <div className="row-admin-actions"><button className="secondary" onClick={() => { setEditStudent(student); setShowStudentModal(true); }}>Edit</button><button className="danger-button" onClick={() => deleteStudentAction(student.id)}>Delete</button></div>}
                    </article>
                  );
                })}
                {!filteredStudents.length && <div className="empty-directory-state"><h3>No student records found.</h3><p>Try widening the current search or filters.</p></div>}
              </section>

              <Modal open={showStudentModal} onClose={() => setShowStudentModal(false)}>
                <h3>{editStudent ? 'Edit Student' : 'Add Student'}</h3>
                <StudentForm
                  initial={editStudent || {}}
                  companies={companies}
                  onSubmit={saveStudent}
                  onCancel={() => setShowStudentModal(false)}
                />
              </Modal>

              <Modal open={!!selectedStudent} onClose={() => setSelectedStudent(null)}>
                {selectedStudent && (() => {
                  const offers = getStudentOffers(selectedStudent);
                  return (
                    <div className="student-detail">
                      <div className="detail-hero-row">
                        <span className="student-avatar student-avatar-large">{initialsFor(selectedStudent.name)}</span>
                        <div><span className="eyebrow">{selectedStudent.roll_number} · {selectedStudent.program}</span><h2>{selectedStudent.name}</h2><StatusPill status={selectedStudent.placement_status} /></div>
                      </div>
                      <div className="offer-timeline">
                        {offers.length ? offers.map((offer, index) => (
                          <article key={offer.id || index}>
                            <span className="timeline-marker">{String(index + 1).padStart(2, '0')}</span>
                            <div><span className="eyebrow">{offer.offer_type || 'Offer'} · {formatDate(offer.offer_date)}</span><h3>{offer.company_name || selectedStudent.company_name || 'Company not recorded'}</h3><p>{formatInr(offer.ctc ?? offer.company_ctc, 'p.a.')} · {formatInr(offer.stipend ?? offer.company_stipend, 'p.m.')}</p></div>
                          </article>
                        )) : <div className="empty-detail-state">No offer journey has been recorded for this student.</div>}
                      </div>
                    </div>
                  );
                })()}
              </Modal>
              </main>
            )
          )}
        />

        <Route
          path="/admin"
          element={isAdmin ? <ViewerAccessSettings authHeaders={authHeaders} /> : <Navigate to="/" replace />}
        />
      </Routes>
    </>
  );
};

const LoginScreen = ({ assetBase, onSuccess, onError, onViewerLogin, error, pending, themeMode, onToggleTheme }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  return (
    <main className="landing-page">
    <nav className="landing-nav">
      <a className="landing-brand" href="#top" aria-label="Placement Atlas home">
        <img src={`${assetBase}iiitd_logo.png`} alt="IIIT Delhi" />
        <span><strong>Placement Atlas</strong><small>Community dashboard</small></span>
      </a>
      <div className="landing-nav-actions">
        <span className="unofficial-pill">Unofficial side project</span>
        <ThemeToggle themeMode={themeMode} onToggle={onToggleTheme} compact />
      </div>
    </nav>

    <section id="top" className="landing-hero">
      <div className="landing-hero-copy">
        <span className="eyebrow">Placement information, thoughtfully organised</span>
        <h1>A clearer view of the IIIT Delhi placement journey.</h1>
        <p>
          Placement Atlas brings cohort outcomes, recruiter records, compensation context,
          and student offer journeys into one searchable, student-built reference.
        </p>
        <div className="landing-principles" aria-label="Access and privacy summary">
          <span><i>01</i> Restricted to IIIT Delhi students</span>
          <span><i>02</i> Verified with Google or viewer credentials</span>
          <span><i>03</i> Built for internal, responsible use</span>
        </div>
      </div>

      <aside className="access-card" aria-labelledby="access-heading">
        <div className="access-card-image" style={{ backgroundImage: `url(${assetBase}institute18-3.jpg)` }}>
          <span>Community access</span>
        </div>
        <div className="access-card-body">
          <span className="eyebrow">Verified access</span>
          <h2 id="access-heading">Continue with IIITD Google</h2>
          <p>Use your <strong>@iiitd.ac.in</strong> account to view the placement data.</p>
          {error && <div className="error-text access-error" role="alert">{error}</div>}
          <div className={pending ? 'google-login-wrap is-pending' : 'google-login-wrap'}>
            <GoogleLogin
              onSuccess={onSuccess}
              onError={onError}
              useOneTap={false}
              auto_select={false}
              button_auto_select={false}
              use_fedcm_for_button={false}
              hd="iiitd.ac.in"
              ux_mode="popup"
              text="signin_with"
            />
          </div>
          <div className="access-divider"><span>or use viewer access</span></div>
          <form
            className="viewer-login-form"
            onSubmit={(event) => {
              event.preventDefault();
              onViewerLogin({ username, password });
            }}
          >
            <p>Contact the developer for a viewer username and password.</p>
            <label>
              Username
              <input
                type="text"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                disabled={pending}
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={pending}
                required
              />
            </label>
            <button type="submit" disabled={pending}>{pending ? 'Verifying...' : 'Continue as viewer'}</button>
          </form>
          {pending && <span className="verification-status">Verifying access...</span>}
          <div className="privacy-note">
            <strong>Viewer access is read-only and cannot grant admin permissions.</strong>
            <span>Google email addresses are checked only for eligibility and are not stored.</span>
          </div>
        </div>
      </aside>
    </section>

    <section className="landing-about" aria-labelledby="about-heading">
      <div className="landing-section-heading">
        <span className="eyebrow">What is inside</span>
        <h2 id="about-heading">From scattered records to useful context.</h2>
        <p>The underlying information remains private until your institute account is verified.</p>
      </div>
      <div className="landing-feature-grid">
        <article><span>01</span><h3>Cohort overview</h3><p>Understand placement progress and offer composition across batches and programs.</p></article>
        <article><span>02</span><h3>Company directory</h3><p>Explore recruiters, roles, eligibility, compensation, and recorded hiring footprints.</p></article>
        <article><span>03</span><h3>Student outcomes</h3><p>Review verified internal records through searchable, structured offer journeys.</p></article>
      </div>
    </section>

    <footer className="landing-footer">
      <p><strong>Important:</strong> Placement Atlas is an unofficial student side project. It is not operated by, endorsed by, or a substitute for the IIIT Delhi Placement Office.</p>
      <span>Use the information responsibly and report genuine discrepancies to yash25091@iiitd.ac.in.</span>
    </footer>
    </main>
  );
};

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

export default App;
