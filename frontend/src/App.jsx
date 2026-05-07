import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Link, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { GoogleLogin } from '@react-oauth/google';
import {
  BATCHES,
  DEFAULT_BATCH_KEY,
  METRIC_DEFINITIONS,
  PROGRAM_OPTIONS,
  getBatchConfig,
  getBranchGroup,
} from './batches';

const api = axios.create({ baseURL: import.meta.env.VITE_API_BASE || '/api' });
const assetBase = import.meta.env.BASE_URL || '/';

const getBatchCacheKey = (batchKey) => `placementSnapshot:${batchKey}`;

const readBatchCache = (batchKey) => {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(getBatchCacheKey(batchKey));
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
    window.localStorage.setItem(getBatchCacheKey(batchKey), JSON.stringify({
      ...snapshot,
      cachedAt: new Date().toISOString(),
    }));
  } catch {
    // Ignore cache writes if storage is unavailable or full.
  }
};

const parseJwt = (token) => {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map((c) => `%${(`00${c.charCodeAt(0).toString(16)}`).slice(-2)}`).join(''));
    return JSON.parse(jsonPayload);
  } catch (err) {
    return null;
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

const buildProgramSummaries = (students) => {
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
    const internOffers = offersSubset.filter((offer) => (offer.offer_type || '').includes('Intern') && offer.offer_type !== 'Intern+FTE');
    const fteOffers = offersSubset.filter((offer) => offer.offer_type === 'FTE');
    const comboOffers = offersSubset.filter((offer) => offer.offer_type === 'Intern+FTE');

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
      eligible_students: placementEligibleTotal,
      excluded_students: excludedStudents,
      placed_students: placed,
      unplaced_students: unplacedStudents,
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
      placement_percentage: toPct(placed, placementEligibleTotal),
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
            <option>Intern</option>
            <option>FTE</option>
            <option>Intern+FTE</option>
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
                      <option>Intern</option>
                      <option>FTE</option>
                      <option>Intern+FTE</option>
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
  const navigate = useNavigate();
  const location = useLocation();
  const [token, setToken] = useState(localStorage.getItem('adminToken') || '');
  const [googleEmail, setGoogleEmail] = useState(localStorage.getItem('googleEmail') || '');
  const [activeBatchKey, setActiveBatchKey] = useState(localStorage.getItem('activeBatchKey') || DEFAULT_BATCH_KEY);
  const initialSnapshot = readBatchCache(activeBatchKey);
  const authHeaders = useAdminHeaders(token);
  const activeBatch = useMemo(() => getBatchConfig(activeBatchKey), [activeBatchKey]);

  const [stats, setStats] = useState(initialSnapshot?.stats || {});
  const [companies, setCompanies] = useState(initialSnapshot?.companies || []);
  const [students, setStudents] = useState(initialSnapshot?.students || []);
  const [loading, setLoading] = useState(!initialSnapshot);
  const [error, setError] = useState('');
  const [loginError, setLoginError] = useState('');
  const isInitialLoad = useRef(!initialSnapshot);
  const isGoogleAuthed = !!googleEmail;

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

  const handleGoogleSuccess = (credentialResponse) => {
    const tokenId = credentialResponse?.credential;
    const payload = tokenId ? parseJwt(tokenId) : null;
    const email = payload?.email;
    if (!email || !email.toLowerCase().endsWith('@iiitd.ac.in')) {
      setLoginError('Only iiitd.ac.in email accounts are allowed.');
      return;
    }
    setLoginError('');
    setGoogleEmail(email);
    localStorage.setItem('googleEmail', email);
    refresh();
  };

  const handleGoogleError = () => {
    setLoginError('Google sign-in failed. Please try again.');
  };

  const handleGoogleLogout = () => {
    setGoogleEmail('');
    localStorage.removeItem('googleEmail');
    setToken('');
    localStorage.removeItem('adminToken');
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
      isInitialLoad.current = false;
    } else {
      setStats({});
      setCompanies([]);
      setStudents([]);
      setLoading(true);
      isInitialLoad.current = true;
    }

    setError('');
    setCompanyFilters({ type: '', category: '', branchGroup: '' });
    setStudentFilters({ branchGroup: '', programs: [], status: '', offerType: '' });
    setDashboardBranchFilter('ALL');
    setCompanySearch('');
    setStudentSearch('');
    setSelectedCompany(null);
    setMobileNavOpen(false);
  }, [activeBatch.key]);

  useEffect(() => {
    setMobileNavOpen(false);
    setMobileHeaderHidden(false);
  }, [location.pathname]);

  useEffect(() => {
    localStorage.setItem('themeMode', themeMode);
    document.documentElement.setAttribute('data-theme', themeMode);
  }, [themeMode]);

  useEffect(() => {
    if (!isGoogleAuthed || typeof window === 'undefined') {
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
  }, [isGoogleAuthed, mobileNavOpen]);

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
    () => buildProgramSummaries(students),
    [students]
  );

  const dashboardBranchFilters = useMemo(
    () => ['ALL', ...dashboardBranchGroups],
    [dashboardBranchGroups]
  );

  const filteredProgramSummaries = useMemo(
    () => programSummaries.filter(({ branchGroup }) => dashboardBranchFilter === 'ALL' || branchGroup === dashboardBranchFilter),
    [dashboardBranchFilter, programSummaries]
  );

  const activeOverviewSummary = useMemo(
    () => dashboardBranchSummaries[dashboardBranchFilter] || EMPTY_SLICE_SUMMARY,
    [dashboardBranchFilter, dashboardBranchSummaries]
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
    const stats = {};
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
  }, [students]);

  // Filtered and sorted companies
  const filteredCompanies = useMemo(() => {
    let result = [...companies];
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
        av = companyHiringStats[a.id]?.total || 0;
        bv = companyHiringStats[b.id]?.total || 0;
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
  }, [companies, companySearch, companyFilters, companySort, companyHiringStats]);

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
      summary.hires += companyHiringStats[company.id]?.total || 0;
      if (type === 'Intern') summary.intern += 1;
      if (type === 'FTE') summary.fte += 1;
      if (type === 'Intern+FTE') summary.combo += 1;
      if (category === 'A+') summary.aplus += 1;
      return summary;
    }, { hires: 0, intern: 0, fte: 0, combo: 0, aplus: 0 });

    return {
      total: filteredCompanies.length,
      trackedHires: totals.hires,
      activeTypes: [totals.fte ? 'FTE' : null, totals.intern ? 'Intern' : null, totals.combo ? 'Hybrid' : null].filter(Boolean).join(' · ') || 'All company types',
      spotlight: totals.aplus,
    };
  }, [filteredCompanies, companyHiringStats]);

  const studentOverview = useMemo(() => {
    const placed = filteredStudents.filter((student) => student.placement_status === 'Placed').length;
    const eligible = filteredStudents.filter(isPlacementEligibleStudent).length;
    const excluded = Math.max(filteredStudents.length - eligible, 0);
    const internships = filteredStudents.filter((student) => {
      if (student.offers?.length) {
        return student.offers.some((offer) => offer.offer_type === 'Intern' || offer.offer_type === 'Intern+FTE');
      }
      return student.offer_type === 'Intern' || student.offer_type === 'Intern+FTE';
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

  const refresh = async () => {
    const cachedSnapshot = readBatchCache(activeBatch.key);
    const hasFallbackData = !!cachedSnapshot || companies.length > 0 || students.length > 0 || Object.keys(stats).length > 0;
    const initial = isInitialLoad.current && !hasFallbackData;
    if (initial) setLoading(true);

    let retries = 0;
    const maxRetries = 12; // 12 * 5s = 60s max wait

    const fetchData = async () => {
      try {
        await api.get('/ping');
        const params = { params: { batch: activeBatch.key } };
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

        setStats(nextSnapshot.stats);
        setCompanies(nextSnapshot.companies);
        setStudents(nextSnapshot.students);
        writeBatchCache(activeBatch.key, nextSnapshot);
        setError('');
        isInitialLoad.current = false;
        if (initial) setLoading(false);
      } catch (err) {
        if (retries < maxRetries) {
          retries++;
          setError(
            hasFallbackData
              ? `Showing saved data while the server wakes up. Refreshing latest data... (Attempt ${retries}/${maxRetries}).`
              : `Connecting to server... (Attempt ${retries}/${maxRetries}). Please wait while the server wakes up.`
          );
          setTimeout(fetchData, 5000);
        } else {
          setError(
            hasFallbackData
              ? `Showing saved data. Latest refresh failed: ${err.message}`
              : `Network Error: ${err.message}. The server might be down or taking too long.`
          );
          if (initial) setLoading(false);
        }
      }
    };

    fetchData();
  };

  useEffect(() => {
    if (isGoogleAuthed) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGoogleAuthed, activeBatch.key]);

  const handleLogin = async (email, password) => {
    try {
      const res = await api.post('/login', { email, password });
      setToken(res.data.token);
      localStorage.setItem('adminToken', res.data.token);
      setError('');
      navigate('/admin');
    } catch (err) {
      setError('Invalid credentials');
    }
  };

  const isAdmin = !!token;

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

  if (!isGoogleAuthed) {
    return (
      <LoginScreen
        assetBase={assetBase}
        onSuccess={handleGoogleSuccess}
        onError={handleGoogleError}
        error={loginError}
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
            <div className="flex-row nav-logo" style={{ alignItems: 'center' }}>
              <img src={`${assetBase}iiitd_logo.png`} alt="IIIT Delhi logo" />
            </div>
            <span className="badge nav-batch-badge">{activeBatch.label}</span>
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
            <Link to="/" onClick={closeMobileNav}>Dashboard</Link>
            <Link to="/companies" onClick={closeMobileNav}>Companies</Link>
            <Link to="/students" onClick={closeMobileNav}>Students</Link>
          </div>

          <div className="nav-user-row">
            {googleEmail && <span className="subtext nav-user-email">{googleEmail}</span>}
            <div className="nav-actions">
              <ThemeToggle themeMode={themeMode} onToggle={toggleThemeMode} compact />
              <button className="secondary" onClick={() => { closeMobileNav(); handleGoogleLogout(); }}>Sign out</button>
              {isAdmin ? (
                <button className="secondary" onClick={() => { closeMobileNav(); setToken(''); localStorage.removeItem('adminToken'); navigate('/'); }}>Logout</button>
              ) : (
                <Link className="nav-admin-link" to="/admin" onClick={closeMobileNav}>Admin Login</Link>
              )}
            </div>
          </div>
        </div>
      </header>

      <Routes>
        <Route
          path="/"
          element={(
            <div className="container">
              <div className="batch-tabs">
                {BATCHES.map((batch) => (
                  <button
                    key={batch.key}
                    type="button"
                    className={activeBatch.key === batch.key ? 'batch-tab active' : 'batch-tab'}
                    onClick={() => setActiveBatchKey(batch.key)}
                  >
                    {batch.label}
                  </button>
                ))}
              </div>

              <div
                className="hero"
                style={{
                  backgroundImage: `url(${assetBase}institute18-3.jpg)`,
                }}
              >
                <div className="hero-copy">
                  <div className="badge hero-badge">Selected Cohort</div>
                  <h1>Placement Data for {activeBatch.label} Passout Batch</h1>
                  <p className="subtext hero-subtext">
                    Dashboard defaults to M.Tech 2027. Use the branch filter in the overall section to narrow the actual programs shown for the selected batch.
                  </p>
                  {error && <p className="hero-error">{error}</p>}
                </div>
                <div className="grid hero-stats">
                  <div className="card hero-stat-card">
                    <div className="stat-label"><MetricLabel metricKey="number_of_companies">Total Companies</MetricLabel></div>
                    <div className="stat-value hero-stat-value">{stats.number_of_companies ?? '—'}</div>
                  </div>
                  <div className="card hero-stat-card">
                    <div className="stat-label"><MetricLabel metricKey="total_offers">Total Offers</MetricLabel></div>
                    <div className="stat-value hero-stat-value">{stats.total_offers ?? '—'}</div>
                  </div>
                  <div className="card hero-stat-card hero-stat-card--wide">
                    <div className="stat-label"><MetricLabel metricKey="overall_placement_percentage">Placement %</MetricLabel></div>
                    <div className="stat-value hero-stat-value">{formatPct(stats.overall_placement_percentage)}</div>
                  </div>
                </div>
              </div>

              <div className="section-header">
                <h3>Key Metrics</h3>
                <Link to="/admin" className="subtext">Admin actions</Link>
              </div>

              <div className="card disclaimer-card">
                <div className="stat-label disclaimer-label">Disclaimer</div>
                <p style={{ margin: '6px 0 0', fontSize: 14, lineHeight: 1.4 }}>
                  This is an unofficial side project; data is not verified by the Placement Office. If you notice any genuine discrepancy, please email yash25091@iiitd.ac.in. The author is not responsible for incorrect data.
                </p>
              </div>

              <div className="grid" style={{ gridTemplateColumns: '1fr', gap: 16 }}>
                {[{ key: 'overall', title: 'Overall', variant: 'large' }].map((section) => {
                  const data = activeOverviewSummary;
                  const metrics = [
                    { key: 'eligible_students', label: 'Eligible & Sitting', value: data.eligible_students },
                    { key: 'placed_students', label: 'Placed', value: data.placed_students },
                    { key: 'unplaced_students', label: 'Unplaced (Eligible)', value: data.unplaced_students },
                    { key: 'excluded_students', label: 'Excluded', value: data.excluded_students },
                    { key: 'total_intern_offers', label: 'Intern Offers', value: data.total_intern_offers },
                    { key: 'total_fte_offers', label: 'FTE Offers', value: data.total_fte_offers },
                    { key: 'total_combo_offers', label: 'Intern+FTE Offers', value: data.total_combo_offers },
                    { key: 'total_Aplus_offers', label: 'A+ Offers', value: data.total_Aplus_offers },
                    { key: 'total_A_offers', label: 'A Offers', value: data.total_A_offers },
                    { key: 'total_B_offers', label: 'B Offers', value: data.total_B_offers },
                    { key: 'highest_ctc', label: 'Highest CTC', value: formatInr(data.highest_ctc, 'p.a.') },
                    { key: 'average_ctc', label: 'Avg CTC', value: formatInr(data.average_ctc, 'p.a.') },
                    { key: 'median_ctc', label: 'Median CTC', value: formatInr(data.median_ctc, 'p.a.') },
                    { key: 'highest_stipend', label: 'Highest Stipend', value: formatInr(data.highest_stipend, 'p.m.') },
                    { key: 'average_stipend', label: 'Avg Stipend', value: formatInr(data.average_stipend, 'p.m.') },
                    { key: 'placement_percentage', label: 'Placement %', value: formatPct(data.placement_percentage) },
                    { key: 'internship_percentage', label: 'Internship %', value: formatPct(data.internship_percentage) },
                  ];
                  return (
                    <div key={section.key} className="card dashboard-overview-card">
                      <div className="section-header dashboard-overview-header" style={{ marginTop: 0, marginBottom: 12 }}>
                        <div>
                          <h3 style={{ margin: 0 }}>
                            {dashboardBranchFilter === 'ALL' ? section.title : `${DASHBOARD_BRANCH_LABELS[dashboardBranchFilter] || dashboardBranchFilter} Overview`}
                          </h3>
                          <span className="subtext">
                            {dashboardBranchFilter === 'ALL'
                              ? `Passing out in ${activeBatch.graduation_year}`
                              : `Consolidated data for ${DASHBOARD_BRANCH_LABELS[dashboardBranchFilter] || dashboardBranchFilter} · Passing out in ${activeBatch.graduation_year}`}
                          </span>
                        </div>
                        <div className="dashboard-filter-group">
                          <span className="subtext">Branch filter</span>
                          <div className="filter-chip-row">
                            {dashboardBranchFilters.map((branchGroup) => (
                              <button
                                key={branchGroup}
                                type="button"
                                className={dashboardBranchFilter === branchGroup ? 'filter-chip active' : 'filter-chip'}
                                onClick={() => setDashboardBranchFilter(branchGroup)}
                              >
                                {DASHBOARD_BRANCH_LABELS[branchGroup] || branchGroup}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="grid dashboard-overview-metrics" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                        {metrics.map((m) => (
                          <div key={m.label}>
                            <div className="stat-label" style={{ fontSize: 12 }}><MetricLabel metricKey={m.key}>{m.label}</MetricLabel></div>
                            <div className="stat-value" style={{ fontSize: 16 }}>{m.value ?? '—'}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}

                <div className="card dashboard-programs-panel">
                  <div className="section-header" style={{ marginTop: 0, marginBottom: 16 }}>
                    <div>
                      <h3 style={{ margin: 0 }}>Programs In {activeBatch.label}</h3>
                      <span className="subtext">
                        {dashboardBranchFilter === 'ALL'
                          ? 'Showing every program in this cohort.'
                          : `Showing programs in the ${DASHBOARD_BRANCH_LABELS[dashboardBranchFilter] || dashboardBranchFilter.toLowerCase()}.`}
                      </span>
                    </div>
                    <span className="badge">{filteredProgramSummaries.length} programs</span>
                  </div>

                  {filteredProgramSummaries.length ? (
                    <div className="program-summary-grid">
                      {filteredProgramSummaries.map(({ program, branchGroup, summary }) => {
                        const metrics = [
                          { key: 'eligible_students', label: 'Eligible & Sitting', value: summary.eligible_students },
                          { key: 'placed_students', label: 'Placed', value: summary.placed_students },
                          { key: 'unplaced_students', label: 'Unplaced (Eligible)', value: summary.unplaced_students },
                          { key: 'excluded_students', label: 'Excluded', value: summary.excluded_students },
                          { key: 'total_intern_offers', label: 'Intern Offers', value: summary.total_intern_offers },
                          { key: 'total_fte_offers', label: 'FTE Offers', value: summary.total_fte_offers },
                          { key: 'total_combo_offers', label: 'Intern+FTE Offers', value: summary.total_combo_offers },
                          { key: 'total_Aplus_offers', label: 'A+ Offers', value: summary.total_Aplus_offers },
                          { key: 'total_A_offers', label: 'A Offers', value: summary.total_A_offers },
                          { key: 'total_B_offers', label: 'B Offers', value: summary.total_B_offers },
                          { key: 'highest_ctc', label: 'Highest CTC', value: formatInr(summary.highest_ctc, 'p.a.') },
                          { key: 'average_ctc', label: 'Avg CTC', value: formatInr(summary.average_ctc, 'p.a.') },
                          { key: 'median_ctc', label: 'Median CTC', value: formatInr(summary.median_ctc, 'p.a.') },
                          { key: 'highest_stipend', label: 'Highest Stipend', value: formatInr(summary.highest_stipend, 'p.m.') },
                          { key: 'average_stipend', label: 'Avg Stipend', value: formatInr(summary.average_stipend, 'p.m.') },
                          { key: 'placement_percentage', label: 'Placement %', value: formatPct(summary.placement_percentage) },
                          { key: 'internship_percentage', label: 'Internship %', value: formatPct(summary.internship_percentage) },
                        ];

                        return (
                          <div key={program} className="program-summary-card">
                            <div className="program-summary-header">
                              <div>
                                <h3>{program}</h3>
                                <span className="subtext">Actual program in {activeBatch.label}</span>
                              </div>
                              <span className="program-summary-badge">{branchGroup}</span>
                            </div>

                            <div className="program-summary-metrics">
                              {metrics.map((metric) => (
                                <div key={metric.label} className="program-summary-metric">
                                  <div className="stat-label"><MetricLabel metricKey={metric.key}>{metric.label}</MetricLabel></div>
                                  <div className="stat-value" style={{ fontSize: 16 }}>{metric.value ?? '—'}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="program-summary-empty">
                      No programs match the selected branch filter for this batch.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        />

        <Route
          path="/companies"
          element={(
            <div className="container section-page companies-page">
              <div className="section-hero companies-hero">
                <div className="section-hero-copy">
                  <div className="badge section-badge">Companies</div>
                  <h1>Company opportunities for {activeBatch.label}</h1>
                  <p className="subtext section-hero-subtext">
                    Explore the hiring landscape with tracked branch hires, cleaner recruiter rows, and a more polished view of this batch.
                  </p>
                </div>
                <div className="section-summary-grid">
                  <div className="section-summary-card">
                    <div className="section-summary-label">Visible Companies</div>
                    <div className="section-summary-value">{companyOverview.total}</div>
                    <div className="section-summary-footnote">{companyOverview.activeTypes}</div>
                  </div>
                  <div className="section-summary-card">
                    <div className="section-summary-label">Tracked Hires</div>
                    <div className="section-summary-value">{companyOverview.trackedHires}</div>
                    <div className="section-summary-footnote">Across the visible recruiters</div>
                  </div>
                  <div className="section-summary-card">
                    <div className="section-summary-label">A+ Recruiters</div>
                    <div className="section-summary-value">{companyOverview.spotlight}</div>
                    <div className="section-summary-footnote">Premium category companies in this view</div>
                  </div>
                </div>
              </div>

              <div className="section-header section-page-header">
                <div>
                  <h3>Companies · {activeBatch.label}</h3>
                  <span className="subtext">Refined table styling with recruiter tiers, branch-hiring context, and better scanability.</span>
                </div>
                {isAdmin && (
                  <button onClick={() => { setEditCompany(null); setShowCompanyModal(true); }}>Add Company</button>
                )}
              </div>

              <div className="toolbar section-toolbar">
                <input
                  type="text"
                  className="search-input"
                  placeholder="Search company..."
                  value={companySearch}
                  onChange={(e) => setCompanySearch(e.target.value)}
                />
                <div className="filter-group">
                  <label>Type:</label>
                  <select value={companyFilters.type} onChange={(e) => setCompanyFilters((f) => ({ ...f, type: e.target.value }))}>
                    <option value="">All</option>
                    <option value="Intern">Intern</option>
                    <option value="FTE">FTE</option>
                    <option value="Intern+FTE">Intern+FTE</option>
                  </select>
                </div>
                <div className="filter-group">
                  <label>Category:</label>
                  <select value={companyFilters.category} onChange={(e) => setCompanyFilters((f) => ({ ...f, category: e.target.value }))}>
                    <option value="">All</option>
                    <option value="A+">A+</option>
                    <option value="A">A</option>
                    <option value="B">B</option>
                  </select>
                </div>
                <div className="filter-group">
                  <label>Branch group:</label>
                  <select value={companyFilters.branchGroup} onChange={(e) => setCompanyFilters((f) => ({ ...f, branchGroup: e.target.value }))}>
                    <option value="">All</option>
                    <option value="CSE">CSE</option>
                    <option value="ECE">ECE</option>
                    <option value="CB">CB</option>
                  </select>
                </div>
              </div>

              <div className="card table-shell table-shell-companies" style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th className={`sortable ${companySort.field === 'name' ? 'sorted' : ''}`} onClick={() => toggleSort(setCompanySort, companySort, 'name')}>
                        Name <SortIcon field="name" current={companySort} />
                      </th>
                      <th>Role</th>
                      <th>Type</th>
                      <th>Category</th>
                      <th className={`sortable ${companySort.field === 'ctc' ? 'sorted' : ''}`} onClick={() => toggleSort(setCompanySort, companySort, 'ctc')}>
                        CTC <SortIcon field="ctc" current={companySort} />
                      </th>
                      <th className={`sortable ${companySort.field === 'stipend' ? 'sorted' : ''}`} onClick={() => toggleSort(setCompanySort, companySort, 'stipend')}>
                        Stipend <SortIcon field="stipend" current={companySort} />
                      </th>
                      <th className={`sortable ${companySort.field === 'offer_date' ? 'sorted' : ''}`} onClick={() => toggleSort(setCompanySort, companySort, 'offer_date')}>
                        Date <SortIcon field="offer_date" current={companySort} />
                      </th>
                      <th className={`sortable ${companySort.field === 'totalHired' ? 'sorted' : ''}`} onClick={() => toggleSort(setCompanySort, companySort, 'totalHired')}>
                        Total <SortIcon field="totalHired" current={companySort} />
                      </th>
                      <th className={`sortable ${companySort.field === 'cseHired' ? 'sorted' : ''}`} onClick={() => toggleSort(setCompanySort, companySort, 'cseHired')}>
                        CSE <SortIcon field="cseHired" current={companySort} />
                      </th>
                      <th className={`sortable ${companySort.field === 'eceHired' ? 'sorted' : ''}`} onClick={() => toggleSort(setCompanySort, companySort, 'eceHired')}>
                        ECE <SortIcon field="eceHired" current={companySort} />
                      </th>
                      <th className={`sortable ${companySort.field === 'cbHired' ? 'sorted' : ''}`} onClick={() => toggleSort(setCompanySort, companySort, 'cbHired')}>
                        CB <SortIcon field="cbHired" current={companySort} />
                      </th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCompanies.map((c) => {
                      const cat = (c.category || '').toUpperCase();
                      const stats = companyHiringStats[c.id] || { total: 0, CSE: 0, 'CSE-R': 0, ECE: 0, CB: 0 };
                      const companyRowClass = cat === 'A+'
                        ? 'company-row company-row-aplus'
                        : cat === 'A'
                          ? 'company-row company-row-a'
                          : cat === 'B'
                            ? 'company-row company-row-b'
                            : 'company-row';
                      return (
                        <tr key={c.id} className={companyRowClass}>
                          <td>
                            <button
                              className="secondary company-name-button"
                              onClick={() => setSelectedCompany(c)}
                            >
                              {c.name}
                            </button>
                          </td>
                          <td>{c.role}</td>
                          <td><span className={`chip table-chip table-chip-type table-chip-${(c.type || 'other').toLowerCase().replace('+', '-').replace(/[^a-z-]/g, '')}`}>{c.type || '—'}</span></td>
                          <td><span className={`chip table-chip table-chip-category table-chip-category-${cat ? cat.toLowerCase().replace('+', 'plus') : 'other'}`}>{c.category || '—'}</span></td>
                          <td>{c.ctc ?? '—'}</td>
                          <td>{c.stipend ?? '—'}</td>
                          <td>{formatDate(c.offer_date)}</td>
                          <td className="table-cell-strong">{stats.total}</td>
                          <td>{stats.CSE}</td>
                          <td>{stats.ECE}</td>
                          <td>{stats.CB}</td>
                          <td>
                            {isAdmin && (
                              <div className="flex-row">
                                <button className="secondary" onClick={() => { setEditCompany(c); setShowCompanyModal(true); }}>Edit</button>
                                <button className="secondary" onClick={() => deleteCompanyAction(c.id)}>Delete</button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

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
                  const stats = companyHiringStats[selectedCompany.id] || { total: 0, CSE: 0, ECE: 0, CB: 0, OTHER: 0, students: [] };
                  return (
                    <div className="company-detail">
                      <h3>{selectedCompany.name}</h3>
                      <div className="info-grid">
                        <div className="info-item">
                          <div className="label">Role</div>
                          <div className="value">{selectedCompany.role || '—'}</div>
                        </div>
                        <div className="info-item">
                          <div className="label">Type</div>
                          <div className="value">{selectedCompany.type || '—'}</div>
                        </div>
                        <div className="info-item">
                          <div className="label">Category</div>
                          <div className="value">{selectedCompany.category || '—'}</div>
                        </div>
                        <div className="info-item">
                          <div className="label">CTC (LPA)</div>
                          <div className="value">{selectedCompany.ctc ?? '—'}</div>
                        </div>
                        <div className="info-item">
                          <div className="label">Stipend</div>
                          <div className="value">{selectedCompany.stipend ?? '—'}</div>
                        </div>
                        <div className="info-item">
                          <div className="label">Eligible CGPA</div>
                          <div className="value">{selectedCompany.eligible_cgpa ?? '—'}</div>
                        </div>
                        <div className="info-item">
                          <div className="label">Backlog Allowed</div>
                          <div className="value">{selectedCompany.backlog_allowed ? 'Yes' : 'No'}</div>
                        </div>
                        <div className="info-item">
                          <div className="label">Registration Deadline</div>
                          <div className="value">{formatDate(selectedCompany.registration_deadline)}</div>
                        </div>
                        <div className="info-item">
                          <div className="label">Date of Offer</div>
                          <div className="value">{formatDate(selectedCompany.offer_date)}</div>
                        </div>
                      </div>

                      <h4 style={{ marginTop: 16, marginBottom: 8 }}>Hiring Statistics</h4>
                      <div className="hiring-stats">
                        <div className="hiring-stat">
                          <div className="count">{stats.total}</div>
                          <div className="label">Total Hired</div>
                        </div>
                        <div className="hiring-stat">
                          <div className="count">{stats.CSE}</div>
                          <div className="label">CSE</div>
                        </div>
                        <div className="hiring-stat">
                          <div className="count">{stats.ECE}</div>
                          <div className="label">ECE</div>
                        </div>
                        <div className="hiring-stat">
                          <div className="count">{stats.CB}</div>
                          <div className="label">CB</div>
                        </div>
                      </div>

                      {stats.students.length > 0 && (
                        <>
                          <h4 style={{ marginTop: 16, marginBottom: 8 }}>Hired Students</h4>
                          <div className="hired-students-list">
                            <table className="table">
                              <thead>
                                <tr>
                                  <th>Roll</th>
                                  <th>Name</th>
                                  <th>Program</th>
                                </tr>
                              </thead>
                              <tbody>
                                {stats.students.map((st, idx) => (
                                  <tr key={idx}>
                                    <td>{st.roll}</td>
                                    <td>{st.name}</td>
                                    <td>{st.program}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })()}
              </Modal>
            </div>
          )}
        />

        <Route
          path="/students"
          element={(
            <div className="container section-page students-page">
              <div className="section-hero students-hero">
                <div className="section-hero-copy">
                  <div className="badge section-badge">Students</div>
                  <h1>Student outcomes for {activeBatch.label}</h1>
                  <p className="subtext section-hero-subtext">
                    Filter the roster by branch, status, offer type, and program in a cleaner view designed for scanning placement progress.
                  </p>
                </div>
                <div className="section-summary-grid">
                  <div className="section-summary-card">
                    <div className="section-summary-label">Visible Students</div>
                    <div className="section-summary-value">{studentOverview.total}</div>
                    <div className="section-summary-footnote">
                      {studentOverview.excluded
                        ? `${studentOverview.excluded} marked Ineligible or Not Sitting`
                        : 'All visible students count toward placement stats'}
                    </div>
                  </div>
                  <div className="section-summary-card">
                    <div className="section-summary-label">Placed</div>
                    <div className="section-summary-value">{studentOverview.placed}</div>
                    <div className="section-summary-footnote">{studentOverview.unplaced} eligible & sitting still unplaced</div>
                  </div>
                  <div className="section-summary-card">
                    <div className="section-summary-label">Programs Visible</div>
                    <div className="section-summary-value">{studentOverview.programs}</div>
                    <div className="section-summary-footnote">{studentOverview.internships} with internship tracks</div>
                  </div>
                </div>
              </div>

              <div className="section-header section-page-header">
                <div>
                  <h3>Students · {activeBatch.label}</h3>
                  <span className="subtext">Sharper status cues, richer chips, and a roster table that is easier to read in both themes.</span>
                </div>
                {isAdmin && (
                  <button onClick={() => { setEditStudent(null); setShowStudentModal(true); }}>Add Student</button>
                )}
              </div>

              <div className="toolbar section-toolbar">
                <input
                  type="text"
                  className="search-input"
                  placeholder="Search name or roll..."
                  value={studentSearch}
                  onChange={(e) => setStudentSearch(e.target.value)}
                />
                <div className="filter-group">
                  <label>Branch group:</label>
                  <select value={studentFilters.branchGroup} onChange={(e) => setStudentFilters((f) => ({ ...f, branchGroup: e.target.value }))}>
                    <option value="">All</option>
                    <option value="CSE">CSE</option>
                    <option value="ECE">ECE</option>
                    <option value="CB">CB</option>
                  </select>
                </div>
                <div className="filter-group">
                  <label>Status:</label>
                  <select value={studentFilters.status} onChange={(e) => setStudentFilters((f) => ({ ...f, status: e.target.value }))}>
                    <option value="">All</option>
                    {STUDENT_STATUS_OPTIONS.map((status) => (
                      <option key={status} value={status}>{status}</option>
                    ))}
                  </select>
                </div>
                <div className="filter-group">
                  <label>Offer:</label>
                  <select value={studentFilters.offerType} onChange={(e) => setStudentFilters((f) => ({ ...f, offerType: e.target.value }))}>
                    <option value="">All</option>
                    <option value="Intern">Intern</option>
                    <option value="FTE">FTE</option>
                    <option value="Intern+FTE">Intern+FTE</option>
                  </select>
                </div>
              </div>

              {availablePrograms.length > 0 && (
                <div className="toolbar toolbar-programs section-toolbar">
                  <span className="subtext">Programs</span>
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
                </div>
              )}

              <div className="card table-shell table-shell-students" style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th className={`sortable ${studentSort.field === 'roll_number' ? 'sorted' : ''}`} onClick={() => toggleSort(setStudentSort, studentSort, 'roll_number')}>
                        Roll <SortIcon field="roll_number" current={studentSort} />
                      </th>
                      <th className={`sortable ${studentSort.field === 'name' ? 'sorted' : ''}`} onClick={() => toggleSort(setStudentSort, studentSort, 'name')}>
                        Name <SortIcon field="name" current={studentSort} />
                      </th>
                      <th>Program</th>
                      <th>Status</th>
                      <th>Companies</th>
                      <th>Offer Types</th>
                      <th className={`sortable ${studentSort.field === 'ctc' ? 'sorted' : ''}`} onClick={() => toggleSort(setStudentSort, studentSort, 'ctc')}>
                        CTC <SortIcon field="ctc" current={studentSort} />
                      </th>
                      <th className={`sortable ${studentSort.field === 'stipend' ? 'sorted' : ''}`} onClick={() => toggleSort(setStudentSort, studentSort, 'stipend')}>
                        Stipend <SortIcon field="stipend" current={studentSort} />
                      </th>
                      <th className={`sortable ${studentSort.field === 'offer_date' ? 'sorted' : ''}`} onClick={() => toggleSort(setStudentSort, studentSort, 'offer_date')}>
                        Date <SortIcon field="offer_date" current={studentSort} />
                      </th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStudents.map((s) => {
                      const isPlaced = s.placement_status === 'Placed';
                      const offerDates = s.offers?.length
                        ? (s.offers.map((o) => formatDate(o.offer_date || o.company_offer_date)).filter((x) => x !== '—').join(', ') || '—')
                        : formatDate(s.offer_date ?? s.company_offer_date);
                      return (
                        <tr key={s.id} className={isPlaced ? 'student-row student-row-placed' : 'student-row student-row-unplaced'}>
                          <td>{s.roll_number}</td>
                          <td className="table-cell-strong">{s.name}</td>
                          <td><span className="chip table-chip table-chip-program">{s.program}</span></td>
                          <td><span className={`chip table-chip ${isPlaced ? 'table-chip-status-placed' : 'table-chip-status-unplaced'}`}>{s.placement_status}</span></td>
                          <td>{(s.offers?.length ? s.offers.map((o) => o.company_name).join(', ') : s.company_name) || '—'}</td>
                          <td>{(s.offers?.length ? s.offers.map((o) => o.offer_type || '—').join(', ') : s.offer_type) || '—'}</td>
                          <td>{s.offers?.length ? (s.offers.map((o) => o.ctc ?? o.company_ctc).filter(Boolean).join(', ') || '—') : (s.ctc ?? s.company_ctc ?? '—')}</td>
                          <td>{s.offers?.length ? (s.offers.map((o) => o.stipend ?? o.company_stipend).filter(Boolean).join(', ') || '—') : (s.stipend ?? s.company_stipend ?? '—')}</td>
                          <td>{offerDates}</td>
                          <td>
                            {isAdmin && (
                              <div className="flex-row">
                                <button className="secondary" onClick={() => { setEditStudent(s); setShowStudentModal(true); }}>Edit</button>
                                <button className="secondary" onClick={() => deleteStudentAction(s.id)}>Delete</button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <Modal open={showStudentModal} onClose={() => setShowStudentModal(false)}>
                <h3>{editStudent ? 'Edit Student' : 'Add Student'}</h3>
                <StudentForm
                  initial={editStudent || {}}
                  companies={companies}
                  onSubmit={saveStudent}
                  onCancel={() => setShowStudentModal(false)}
                />
              </Modal>
            </div>
          )}
        />

        <Route
          path="/admin"
          element={(
            <div className="container">
              <div className="card" style={{ maxWidth: 520, margin: '32px auto' }}>
                <h3>Admin Login</h3>
                <p className="subtext">Use institute credentials to manage the database.</p>
                <LoginForm onLogin={handleLogin} />
                {error && <p className="error-text">{error}</p>}
              </div>
            </div>
          )}
        />
      </Routes>
    </>
  );
};

const LoginScreen = ({ assetBase, onSuccess, onError, error, themeMode, onToggleTheme }) => (
  <div
    className="login-screen"
    style={{
      minHeight: '100vh',
      display: 'grid',
      placeItems: 'center',
      background: `linear-gradient(90deg, rgba(63,173,168,0.35), rgba(255,255,255,0.9)), url(${assetBase}institute18-3.jpg)`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      padding: 24,
    }}
  >
    <div className="card" style={{ maxWidth: 420, width: '100%', textAlign: 'center' }}>
      <div className="login-theme-toggle-row">
        <ThemeToggle themeMode={themeMode} onToggle={onToggleTheme} compact />
      </div>
      <div style={{ marginBottom: 16 }}>
        <img src={`${assetBase}iiitd_logo.png`} alt="IIIT Delhi" style={{ maxHeight: 72, width: 'auto' }} />
      </div>
      <h2 style={{ margin: '4px 0 8px' }}>Placement Tracker</h2>
      <p className="subtext" style={{ marginBottom: 16 }}>Sign in with your iiitd.ac.in email to continue.</p>
      {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}
      <div style={{ display: 'grid', placeItems: 'center' }}>
        <GoogleLogin onSuccess={onSuccess} onError={onError} useOneTap={false} />
      </div>
    </div>
  </div>
);

const LoginForm = ({ onLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onLogin(email, password);
      }}
    >
      <div>
        <label>Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <label>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <div className="flex-row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
        <button type="submit">Login</button>
      </div>
    </form>
  );
};

export default App;
