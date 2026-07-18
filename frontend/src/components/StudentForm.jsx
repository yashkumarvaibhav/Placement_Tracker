import React, { useEffect, useState } from 'react';
import { PROGRAM_OPTIONS } from '../batches';
import { OFFER_TYPES, isPlacementQualifyingOfferType } from '../offerTypes';
import { STUDENT_STATUS_OPTIONS } from '../lib/students';

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
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  };

  const placed = form.placement_status === 'Placed';
  // Non-placed students can only hold summer internships (the non-qualifying offer types).
  const offerTypeOptions = placed ? OFFER_TYPES : OFFER_TYPES.filter((type) => !isPlacementQualifyingOfferType(type));

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

  const addOffer = () => setForm((prev) => ({ ...prev, offers: [...(prev.offers || []), { company_id: '', offer_type: '', role: '', ctc: '', stipend: '', registration_deadline: '', offer_date: '' }] }));
  const removeOffer = (idx) => setForm((prev) => ({ ...prev, offers: (prev.offers || []).filter((_, i) => i !== idx) }));

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setSubmitError('');

        const normalizedOffers = (form.offers || []).map((o) => ({
          ...o,
          company_id: o.company_id ? Number(o.company_id) : null,
          ctc: o.ctc ? Number(o.ctc) : null,
          stipend: o.stipend ? Number(o.stipend) : null,
        }));

        const isPlaced = form.placement_status === 'Placed';
        // Non-placed students retain only non-qualifying offers (summer internships); any
        // FTE/PPO/winter-intern offer is dropped to stay consistent with the backend.
        const submitOffers = isPlaced
          ? normalizedOffers
          : normalizedOffers.filter((o) => !isPlacementQualifyingOfferType(o.offer_type));
        setSubmitting(true);
        try {
          await onSubmit({
            ...form,
            offers: submitOffers,
            company_id: isPlaced ? form.company_id : null,
            offer_type: isPlaced ? form.offer_type : null,
            ctc: isPlaced ? form.ctc : null,
            stipend: isPlaced ? form.stipend : null,
            registration_deadline: isPlaced ? form.registration_deadline : null,
            offer_date: isPlaced ? form.offer_date : null,
          });
        } catch (err) {
          setSubmitError(err?.response?.data?.message || 'Could not save. Please check the details and try again.');
        } finally {
          setSubmitting(false);
        }
      }}
    >
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px,1fr))' }}>
        <label>
          Roll Number
          <input name="roll_number" value={form.roll_number} onChange={handleChange} required />
        </label>
        <label>
          Name
          <input name="name" value={form.name} onChange={handleChange} required />
        </label>
        <label>
          Program
          <select name="program" value={form.program} onChange={handleChange}>
            {studentProgramOptions.map((program) => (
              <option key={program} value={program}>{program}</option>
            ))}
          </select>
        </label>
        <label>
          Placement Status
          <select
            name="placement_status"
            value={form.placement_status}
            onChange={(e) => {
              const nextStatus = e.target.value;
              handleChange(e);
              if (nextStatus !== 'Placed') {
                // Keep summer internships (non-qualifying offers); drop placement-grade offers
                // and the denormalized primary fields the backend will recompute.
                setForm((prev) => ({
                  ...prev,
                  offers: (prev.offers || []).filter((o) => !isPlacementQualifyingOfferType(o.offer_type)),
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
        </label>
        <div className="grid" style={{ gridTemplateColumns: '1fr' }}>
          {!placed && (
            <p style={{ fontSize: '0.85rem', opacity: 0.75, margin: '0 0 4px' }}>
              Summer internships are recorded here as outcomes — they do not count as a placement.
              To record a full-time, PPO, or winter-internship offer, set the status to Placed.
            </p>
          )}
          {(form.offers || []).map((offer, idx) => (
            <div key={idx} className="card" style={{ margin: 0, borderStyle: 'dashed' }}>
              <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px,1fr))' }}>
                <div className="field-stack">
                  <label>
                    Company
                    <select value={offer.company_id || ''} onChange={(e) => hydrateOfferFromCompany(idx, e.target.value)}>
                      <option value="">Select</option>
                      {companies.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </label>
                  {offer.company_id && (
                    <div className="flex-row" style={{ marginTop: 6, justifyContent: 'flex-end' }}>
                      <button type="button" className="secondary" onClick={() => hydrateOfferFromCompany(idx, offer.company_id, true)}>Reapply company data</button>
                    </div>
                  )}
                </div>
                <label>
                  Offer Type
                  <select value={offer.offer_type || ''} onChange={(e) => updateOfferField(idx, 'offer_type', e.target.value)}>
                    <option value="">Select</option>
                    {offerTypeOptions.map((type) => <option key={type}>{type}</option>)}
                  </select>
                </label>
                <label>
                  Role
                  <input value={offer.role || ''} onChange={(e) => updateOfferField(idx, 'role', e.target.value)} placeholder="e.g. SDE" />
                </label>
                {placed && (
                  <label>
                    CTC (₹ per annum)
                    <input type="number" min="0" step="any" placeholder="e.g. 1200000" value={offer.ctc ?? ''} onChange={(e) => updateOfferField(idx, 'ctc', e.target.value)} />
                  </label>
                )}
                <label>
                  Stipend (₹ per month)
                  <input type="number" min="0" step="any" placeholder="e.g. 50000" value={offer.stipend ?? ''} onChange={(e) => updateOfferField(idx, 'stipend', e.target.value)} />
                </label>
                <label>
                  Last Date of Registration
                  <input type="date" value={offer.registration_deadline || ''} onChange={(e) => updateOfferField(idx, 'registration_deadline', e.target.value)} />
                </label>
                <label>
                  Date of Offer
                  <input type="date" value={offer.offer_date || ''} onChange={(e) => updateOfferField(idx, 'offer_date', e.target.value)} />
                </label>
              </div>
              {(form.offers.length > 1 || !placed) && (
                <div className="flex-row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
                  <button type="button" className="secondary" onClick={() => removeOffer(idx)}>Remove</button>
                </div>
              )}
            </div>
          ))}
          <button type="button" className="secondary" onClick={addOffer}>{placed ? 'Add Another Offer' : 'Add Summer Internship'}</button>
        </div>
      </div>
      {submitError && <p className="error-text" role="alert" style={{ marginTop: 8, textAlign: 'right' }}>{submitError}</p>}
      <div className="flex-row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
        <button type="button" className="secondary" onClick={onCancel} disabled={submitting}>Cancel</button>
        <button type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
};

export { StudentForm };
