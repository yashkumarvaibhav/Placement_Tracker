import React, { useState } from 'react';
import { OFFER_TYPES } from '../offerTypes';
import { BRANCH_OPTIONS, branchToken, formatBranchToken } from '../lib/branches';

const CompanyForm = ({ initial = {}, onSubmit, onCancel }) => {
  const initialRoles = initial.roles?.length
    ? initial.roles
    : (initial.role || initial.type || initial.ctc != null || initial.stipend != null)
      ? [{ role: initial.role || '', degree: 'All', offer_type: initial.type || 'FTE', ctc: initial.ctc ?? '', stipend: initial.stipend ?? '' }]
      : [{ role: '', degree: 'All', offer_type: 'FTE', ctc: '', stipend: '' }];

  const [form, setForm] = useState({
    name: '',
    category: '',
    eligible_cgpa: '',
    backlog_allowed: false,
    registration_deadline: '',
    registration_open_date: '',
    offer_date: '',
    branches: [],
    ...initial,
    roles: initialRoles,
  });

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((f) => ({ ...f, [name]: type === 'checkbox' ? checked : value }));
  };

  const toggleBranch = (token) => {
    setForm((f) => {
      const set = new Set(f.branches || []);
      if (set.has(token)) set.delete(token); else set.add(token);
      return { ...f, branches: [...set] };
    });
  };

  const setDegreeBranches = (degree, branches, selectAll) => {
    setForm((f) => {
      const set = new Set(f.branches || []);
      branches.forEach((branch) => {
        const token = branchToken(degree, branch);
        if (selectAll) set.add(token); else set.delete(token);
      });
      return { ...f, branches: [...set] };
    });
  };

  const updateRole = (idx, key, value) => setForm((f) => {
    const roles = [...(f.roles || [])];
    roles[idx] = { ...roles[idx], [key]: value };
    return { ...f, roles };
  });
  const addRole = () => setForm((f) => ({ ...f, roles: [...(f.roles || []), { role: '', degree: 'All', offer_type: 'FTE', ctc: '', stipend: '' }] }));
  const removeRole = (idx) => setForm((f) => ({ ...f, roles: (f.roles || []).filter((_, i) => i !== idx) }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const normalizedRoles = (form.roles || [])
          .filter((r) => (r.role || '').trim() || r.offer_type || r.ctc || r.stipend)
          .map((r) => ({
            role: (r.role || '').trim(),
            degree: r.degree || 'All',
            offer_type: r.offer_type || null,
            ctc: r.ctc ? Number(r.ctc) : null,
            stipend: r.stipend ? Number(r.stipend) : null,
          }));
        const primary = normalizedRoles[0] || {};
        onSubmit({
          ...form,
          roles: normalizedRoles,
          role: primary.role || '',
          type: primary.offer_type || 'FTE',
          ctc: primary.ctc ?? null,
          stipend: primary.stipend ?? null,
          eligible_cgpa: form.eligible_cgpa ? Number(form.eligible_cgpa) : null,
        });
      }}
    >
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px,1fr))' }}>
        <label>
          Name
          <input name="name" value={form.name} onChange={handleChange} required />
        </label>
        <label>
          Category
          <select name="category" value={form.category || ''} onChange={handleChange}>
            <option value="">Select</option>
            <option value="A+">A+</option>
            <option value="A">A</option>
            <option value="B">B</option>
          </select>
        </label>
        <label>
          Eligible CGPA
          <input name="eligible_cgpa" type="number" step="0.1" value={form.eligible_cgpa ?? ''} onChange={handleChange} />
        </label>
        <label>
          Backlog Allowed
          <span className="checkbox-row">
            <input name="backlog_allowed" type="checkbox" checked={!!form.backlog_allowed} onChange={handleChange} />
            <span>Yes</span>
          </span>
        </label>
        <label>
          Last Date of Registration
          <input name="registration_deadline" type="date" value={form.registration_deadline || ''} onChange={handleChange} />
        </label>
        <label>
          Registration Opens
          <input name="registration_open_date" type="date" value={form.registration_open_date || ''} onChange={handleChange} />
        </label>
        <label>
          Date of Offer
          <input name="offer_date" type="date" value={form.offer_date || ''} onChange={handleChange} />
        </label>
      </div>
      <fieldset className="role-packages" style={{ border: '1px solid var(--border, #d8d8e0)', borderRadius: 10, padding: 12, marginTop: 12 }}>
        <legend>Roles &amp; packages</legend>
        <p style={{ fontSize: '0.85rem', opacity: 0.75, margin: '0 0 8px' }}>One row per role. Use "Applies to" to set different salaries for B.Tech vs M.Tech (or All).</p>
        {(form.roles || []).map((pkg, idx) => (
          <div key={idx} className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px,1fr))', gap: 8, marginBottom: 8, alignItems: 'end' }}>
            <label>
              Role
              <input value={pkg.role || ''} onChange={(e) => updateRole(idx, 'role', e.target.value)} placeholder="e.g. SDE" />
            </label>
            <label>
              Applies to
              <select value={pkg.degree || 'All'} onChange={(e) => updateRole(idx, 'degree', e.target.value)}>
                {['All', 'B.Tech', 'M.Tech'].map((d) => <option key={d}>{d}</option>)}
              </select>
            </label>
            <label>
              Offer Type
              <select value={pkg.offer_type || ''} onChange={(e) => updateRole(idx, 'offer_type', e.target.value)}>
                <option value="">Select</option>
                {OFFER_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </label>
            <label>
              CTC (₹ p.a.)
              <input type="number" min="0" step="any" value={pkg.ctc ?? ''} onChange={(e) => updateRole(idx, 'ctc', e.target.value)} />
            </label>
            <label>
              Stipend (₹ p.m.)
              <input type="number" min="0" step="any" value={pkg.stipend ?? ''} onChange={(e) => updateRole(idx, 'stipend', e.target.value)} />
            </label>
            {(form.roles || []).length > 1 && (
              <button type="button" className="secondary" onClick={() => removeRole(idx)}>Remove</button>
            )}
          </div>
        ))}
        <button type="button" className="secondary" onClick={addRole}>Add role</button>
      </fieldset>
      <fieldset className="branch-multiselect" style={{ border: '1px solid var(--border, #d8d8e0)', borderRadius: 10, padding: 12, marginTop: 12 }}>
        <legend>Recruiting branches</legend>
        {BRANCH_OPTIONS.map(({ degree, branches }) => {
          const allSelected = branches.every((branch) => (form.branches || []).includes(branchToken(degree, branch)));
          return (
          <div key={degree} style={{ marginBottom: 8 }}>
            <div className="flex-row" style={{ gap: 10, marginBottom: 4, alignItems: 'center' }}>
              <strong>{degree}</strong>
              <label className="checkbox-row" style={{ gap: 4 }}>
                <input type="checkbox" checked={allSelected} onChange={(e) => setDegreeBranches(degree, branches, e.target.checked)} />
                <span>Select all</span>
              </label>
            </div>
            <div className="flex-row" style={{ flexWrap: 'wrap', gap: 10 }}>
              {branches.map((branch) => {
                const token = branchToken(degree, branch);
                return (
                  <label key={token} className="checkbox-row" style={{ gap: 4 }}>
                    <input type="checkbox" checked={(form.branches || []).includes(token)} onChange={() => toggleBranch(token)} />
                    <span>{branch}</span>
                  </label>
                );
              })}
            </div>
          </div>
          );
        })}
      </fieldset>
      <div className="flex-row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
        <button type="submit">Save</button>
      </div>
    </form>
  );
};

export { CompanyForm };
