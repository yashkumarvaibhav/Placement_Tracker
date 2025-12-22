import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Link, Route, Routes, useNavigate } from 'react-router-dom';

const api = axios.create({ baseURL: import.meta.env.VITE_API_BASE || '/api' });
const assetBase = import.meta.env.BASE_URL || '/';

const StatCard = ({ label, value }) => (
  <div className="card">
    <div className="stat-value">{value ?? '—'}</div>
    <div className="stat-label">{label}</div>
  </div>
);

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
            <option>CSE</option>
            <option>CSE-R</option>
            <option>ECE</option>
            <option>CB</option>
          </select>
        </div>
        <div>
          <label>Placement Status</label>
          <select
            name="placement_status"
            value={form.placement_status}
            onChange={(e) => {
              handleChange(e);
              if (e.target.value === 'Unplaced') {
                // Clear any existing offers/primary company details when marking unplaced
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
            <option>Placed</option>
            <option>Unplaced</option>
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
  const [token, setToken] = useState(localStorage.getItem('adminToken') || '');
  const authHeaders = useAdminHeaders(token);

  const [stats, setStats] = useState({});
  const [companies, setCompanies] = useState([]);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const isInitialLoad = useRef(true);

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

  const [showCompanyModal, setShowCompanyModal] = useState(false);
  const [editCompany, setEditCompany] = useState(null);
  const [showStudentModal, setShowStudentModal] = useState(false);
  const [editStudent, setEditStudent] = useState(null);

  const refresh = async () => {
    const initial = isInitialLoad.current;
    if (initial) setLoading(true);
    try {
      const [statsRes, companyRes, studentRes] = await Promise.all([
        api.get('/stats'),
        api.get('/companies'),
        api.get('/students'),
      ]);
      setStats(statsRes.data);
      setCompanies(companyRes.data);
      setStudents(studentRes.data);
      if (initial) isInitialLoad.current = false;
    } catch (err) {
      setError(err.message);
    } finally {
      if (initial) setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

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

  const saveCompany = async (payload) => {
    if (!isAdmin) return;
    if (editCompany) {
      await api.put(`/companies/${editCompany.id}`, payload, authHeaders);
    } else {
      await api.post('/companies', payload, authHeaders);
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
      await api.put(`/students/${editStudent.id}`, payload, authHeaders);
    } else {
      await api.post('/students', payload, authHeaders);
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

  if (loading) return <div className="container">Loading...</div>;

  return (
    <>
      <header>
        <div className="navbar" style={{ padding: '16px 24px', gap: 20 }}>
          <div className="flex-row" style={{ alignItems: 'center', height: 96 }}>
            <img src={`${assetBase}iiitd_logo.png`} alt="IIIT Delhi logo" style={{ height: '100%', width: 'auto', maxHeight: 96, objectFit: 'contain' }} />
          </div>
          <div className="flex-row" style={{ alignItems: 'center', gap: 16 }}>
            <Link to="/">Dashboard</Link>
            <Link to="/companies">Companies</Link>
            <Link to="/students">Students</Link>
            {isAdmin ? (
              <button className="secondary" onClick={() => { setToken(''); localStorage.removeItem('adminToken'); navigate('/'); }}>Logout</button>
            ) : (
              <Link to="/admin">Admin Login</Link>
            )}
          </div>
        </div>
      </header>

      <Routes>
        <Route
          path="/"
          element={(
            <div className="container">
              <div
                className="hero"
                style={{
                  backgroundImage: `linear-gradient(90deg, rgba(63,173,168,0.3), rgba(255,255,255,0.85)), url(${assetBase}institute18-3.jpg)`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  gridTemplateColumns: '1.5fr 1fr',
                }}
              >
                <div>
                  <div className="badge" style={{ display: 'inline-block', marginBottom: 10 }}>Unofficial Dashboard</div>
                  <h1 style={{ margin: '4px 0 6px' }}>M.Tech Placement Data for Batch passing out in 2026</h1>
                  {error && <p style={{ color: '#dc2626' }}>{error}</p>}
                </div>
                <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px,1fr))', alignItems: 'stretch' }}>
                  <div className="card" style={{ textAlign: 'center', background: 'rgba(255,255,255,0.9)' }}>
                    <div className="stat-label">Total Companies</div>
                    <div className="stat-value" style={{ fontSize: 30 }}>{stats.number_of_companies ?? '—'}</div>
                  </div>
                  <div className="card" style={{ textAlign: 'center', background: 'rgba(255,255,255,0.9)' }}>
                    <div className="stat-label">Total Offers</div>
                    <div className="stat-value" style={{ fontSize: 30 }}>{stats.total_offers ?? '—'}</div>
                  </div>
                  <div className="card" style={{ textAlign: 'center', background: 'rgba(255,255,255,0.9)' }}>
                    <div className="stat-label">Placement %</div>
                    <div className="stat-value" style={{ fontSize: 30 }}>{formatPct(stats.overall_placement_percentage)}</div>
                  </div>
                </div>
              </div>

              <div className="section-header">
                <h3>Key Metrics</h3>
                <Link to="/admin" className="subtext">Admin actions</Link>
              </div>

              <div className="card" style={{ background: '#fff8e6', border: '1px solid #fcd34d', color: '#92400e' }}>
                <div className="stat-label" style={{ color: '#92400e', fontSize: 13 }}>Disclaimer</div>
                <p style={{ margin: '6px 0 0', fontSize: 14, lineHeight: 1.4 }}>
                  This is an unofficial side project; data is not verified by the Placement Office. If you notice any genuine discrepancy, please email yash25091@iiitd.ac.in. The author is not responsible for incorrect data.
                </p>
              </div>

              <div className="grid" style={{ gridTemplateColumns: '1fr', gap: 16 }}>
                {[{ key: 'overall', title: 'Overall', variant: 'large' }].map((section) => {
                  const data = stats.branch_summary?.[section.key] || {};
                  const metrics = [
                    { label: 'Total Students (2026)', value: data.total_students },
                    { label: 'Total Placed', value: data.placed_students },
                    { label: 'Intern Offers', value: data.total_intern_offers },
                    { label: 'FTE Offers', value: data.total_fte_offers },
                    { label: 'Intern+FTE Offers', value: data.total_combo_offers },
                    { label: 'A+ Offers', value: data.total_Aplus_offers },
                    { label: 'A Offers', value: data.total_A_offers },
                    { label: 'B Offers', value: data.total_B_offers },
                    { label: 'Highest CTC', value: formatInr(data.highest_ctc, 'p.a.') },
                    { label: 'Avg CTC', value: formatInr(data.average_ctc, 'p.a.') },
                    { label: 'Median CTC', value: formatInr(data.median_ctc, 'p.a.') },
                    { label: 'Highest Stipend', value: formatInr(data.highest_stipend, 'p.m.') },
                    { label: 'Avg Stipend', value: formatInr(data.average_stipend, 'p.m.') },
                    { label: 'Placement %', value: formatPct(data.placement_percentage) },
                    { label: 'Internship %', value: formatPct(data.internship_percentage) },
                  ];
                  return (
                    <div key={section.key} className="card" style={{ background: 'linear-gradient(135deg, rgba(63, 173, 168, 0.12), rgba(255, 255, 255, 0.95))' }}>
                      <div className="section-header" style={{ marginTop: 0, marginBottom: 12 }}>
                        <h3 style={{ margin: 0 }}>{section.title}</h3>
                        <span className="subtext">Graduating 2026</span>
                      </div>
                      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                        {metrics.map((m) => (
                          <div key={m.label}>
                            <div className="stat-label" style={{ fontSize: 12 }}>{m.label}</div>
                            <div className="stat-value" style={{ fontSize: 16 }}>{m.value ?? '—'}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}

                <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
                  {[{ key: 'cse', title: 'CSE & CSE Research' }, { key: 'ece', title: 'ECE' }, { key: 'cb', title: 'CB' }].map((section) => {
                    const data = stats.branch_summary?.[section.key] || {};
                    const metrics = [
                      { label: 'Total Students (2026)', value: data.total_students },
                      { label: 'Total Placed', value: data.placed_students },
                      { label: 'Intern Offers', value: data.total_intern_offers },
                      { label: 'FTE Offers', value: data.total_fte_offers },
                      { label: 'Intern+FTE Offers', value: data.total_combo_offers },
                      { label: 'A+ Offers', value: data.total_Aplus_offers },
                      { label: 'A Offers', value: data.total_A_offers },
                      { label: 'B Offers', value: data.total_B_offers },
                      { label: 'Highest CTC', value: formatInr(data.highest_ctc, 'p.a.') },
                      { label: 'Avg CTC', value: formatInr(data.average_ctc, 'p.a.') },
                      { label: 'Median CTC', value: formatInr(data.median_ctc, 'p.a.') },
                      { label: 'Highest Stipend', value: formatInr(data.highest_stipend, 'p.m.') },
                      { label: 'Avg Stipend', value: formatInr(data.average_stipend, 'p.m.') },
                      { label: 'Placement %', value: formatPct(data.placement_percentage) },
                      { label: 'Internship %', value: formatPct(data.internship_percentage) },
                    ];
                    return (
                      <div key={section.key} className="card" style={{ background: '#ffffff' }}>
                        <div className="section-header" style={{ marginTop: 0, marginBottom: 12 }}>
                          <h3 style={{ margin: 0 }}>{section.title}</h3>
                          <span className="subtext">Graduating 2026</span>
                        </div>
                        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
                          {metrics.map((m) => (
                            <div key={m.label}>
                              <div className="stat-label" style={{ fontSize: 12 }}>{m.label}</div>
                              <div className="stat-value" style={{ fontSize: 15 }}>{m.value ?? '—'}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        />

        <Route
          path="/companies"
          element={(
            <div className="container">
              <div className="section-header">
                <h3>Companies</h3>
                {isAdmin && (
                  <button onClick={() => { setEditCompany(null); setShowCompanyModal(true); }}>Add Company</button>
                )}
              </div>
              <div className="card">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Role</th>
                      <th>Type</th>
                      <th>Category</th>
                      <th>CTC</th>
                      <th>Stipend</th>
                      <th>Date of Offer</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {companies.map((c) => {
                      const cat = (c.category || '').toUpperCase();
                      const rowStyle = cat === 'A+'
                        ? { backgroundColor: '#ecfeff' }
                        : cat === 'A'
                          ? { backgroundColor: '#fefce8' }
                          : cat === 'B'
                            ? { backgroundColor: '#fef2f2' }
                            : {};
                      return (
                      <tr key={c.id} style={rowStyle}>
                        <td>{c.name}</td>
                        <td>{c.role}</td>
                        <td><span className="chip">{c.type || '—'}</span></td>
                        <td>{c.category || '—'}</td>
                        <td>{c.ctc ?? '—'}</td>
                        <td>{c.stipend ?? '—'}</td>
                        <td>{formatDate(c.offer_date)}</td>
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

              <Modal open={showCompanyModal} onClose={() => setShowCompanyModal(false)}>
                <h3>{editCompany ? 'Edit Company' : 'Add Company'}</h3>
                <CompanyForm
                  initial={editCompany || {}}
                  onSubmit={saveCompany}
                  onCancel={() => setShowCompanyModal(false)}
                />
              </Modal>
            </div>
          )}
        />

        <Route
          path="/students"
          element={(
            <div className="container">
              <div className="section-header">
                <h3>Students</h3>
                {isAdmin && (
                  <button onClick={() => { setEditStudent(null); setShowStudentModal(true); }}>Add Student</button>
                )}
              </div>
              <div className="card" style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Roll</th>
                      <th>Name</th>
                      <th>Program</th>
                      <th>Status</th>
                      <th>Companies</th>
                      <th>Offer Types</th>
                      <th>CTC</th>
                      <th>Stipend</th>
                      <th>Date of Offer</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((s) => {
                      const isPlaced = s.placement_status === 'Placed';
                      const rowStyle = isPlaced ? { backgroundColor: '#f0fdf4' } : { backgroundColor: '#fef2f2' };
                      const offerDates = s.offers?.length
                        ? (s.offers.map((o) => formatDate(o.offer_date || o.company_offer_date)).filter((x) => x !== '—').join(', ') || '—')
                        : formatDate(s.offer_date ?? s.company_offer_date);
                      return (
                      <tr key={s.id} style={rowStyle}>
                        <td>{s.roll_number}</td>
                        <td>{s.name}</td>
                        <td>{s.program}</td>
                        <td><span className="chip">{s.placement_status}</span></td>
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
                {error && <p style={{ color: '#f87171' }}>{error}</p>}
              </div>
            </div>
          )}
        />
      </Routes>
    </>
  );
};

const LoginForm = ({ onLogin }) => {
  const [email, setEmail] = useState('yash25091@iiitd.ac.in');
  const [password, setPassword] = useState('GraduateAlgo@1198');

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
