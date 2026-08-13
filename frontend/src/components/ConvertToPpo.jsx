import React, { useState } from 'react';
import {
  isFullTimeOfferType,
  isInternshipOfferType,
  isSummerInternOfferType,
} from '../offerTypes';

// Admin action on an internship-only offer (Intern / Summer Intern): expands into a small
// form asking for the full-time package, then converts the offer to its "+ PPO" variant.
// Renders nothing for other offer types or offers without a persisted id.
const ConvertToPpo = ({ offer, onConvert }) => {
  const [expanded, setExpanded] = useState(false);
  const [role, setRole] = useState('');
  const [ctc, setCtc] = useState('');
  const [ctcUnknown, setCtcUnknown] = useState(false);
  const [offerDate, setOfferDate] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!offer?.id || !isInternshipOfferType(offer.offer_type) || isFullTimeOfferType(offer.offer_type)) return null;

  const targetType = isSummerInternOfferType(offer.offer_type) ? 'Summer Intern + PPO' : 'Intern + PPO';

  const openForm = () => {
    setRole(offer.role || '');
    setCtc(offer.company_ctc ?? '');
    setCtcUnknown(false);
    setOfferDate(new Date().toISOString().slice(0, 10));
    setError('');
    setExpanded(true);
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!ctcUnknown && !(Number(ctc) > 0)) {
      setError('Enter the full-time CTC (₹ p.a.) for the PPO, or mark it as not known yet.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onConvert(offer, {
        // A CTC marked "not known yet" is sent as 0 rather than omitted: the backend treats 0
        // as the explicit "known unknown" sentinel, which — unlike leaving the field blank —
        // is guaranteed to stay out of every compensation average/median until it's updated.
        ctc: ctcUnknown ? 0 : Number(ctc),
        ctc_known: !ctcUnknown,
        role: role.trim() || null,
        offer_date: offerDate || null,
      });
      setExpanded(false);
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!expanded) {
    return <button type="button" className="secondary ppo-convert-button" onClick={openForm}>Convert to PPO</button>;
  }

  return (
    <form className="ppo-convert-form" onSubmit={submit}>
      <span className="eyebrow">Convert to {targetType}</span>
      <div className="flex-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label>
          CTC (₹ p.a.)
          <input
            type="number"
            min="0"
            step="any"
            value={ctc}
            onChange={(e) => setCtc(e.target.value)}
            disabled={ctcUnknown}
            required={!ctcUnknown}
            autoFocus
          />
        </label>
        <label>
          Role
          <input value={role} onChange={(e) => setRole(e.target.value)} placeholder={offer.role || 'Role'} />
        </label>
        <label>
          PPO offer date
          <input type="date" value={offerDate} onChange={(e) => setOfferDate(e.target.value)} />
        </label>
      </div>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={ctcUnknown}
          onChange={(e) => setCtcUnknown(e.target.checked)}
        />
        CTC not known yet — record the PPO without it
      </label>
      {error && <div className="error-text">{error}</div>}
      <div className="flex-row" style={{ gap: 8 }}>
        <button type="submit" disabled={busy}>{busy ? 'Converting…' : 'Convert to PPO'}</button>
        <button type="button" className="secondary" onClick={() => setExpanded(false)} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
};

export { ConvertToPpo };
