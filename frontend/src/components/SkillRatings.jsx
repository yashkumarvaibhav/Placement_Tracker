import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { formatRelative } from '../lib/format';
import { Modal } from './Modal';

const SKILLS = [
  { key: 'overall', averageKey: 'rating_overall', label: 'Overall' },
  { key: 'dsa', averageKey: 'rating_dsa', label: 'DSA' },
  { key: 'ml', averageKey: 'rating_ml', label: 'ML' },
];

const scoreLabel = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return number.toFixed(1);
};

const SkillRatingSummary = ({ student, compact = false }) => {
  const count = Number(student?.rating_count) || 0;

  return (
    <div className={compact ? 'skill-rating-summary compact' : 'skill-rating-summary'}>
      <div className="skill-rating-summary-heading">
        <span>{compact ? 'Skills' : 'Batchmate skill ratings'}</span>
        <small>{count ? `${count} ${count === 1 ? 'rating' : 'ratings'}` : 'No ratings yet'}</small>
      </div>
      <div className="skill-rating-scores">
        {SKILLS.map((skill) => (
          <span key={skill.key}>
            <small>{skill.label}</small>
            <strong>{count ? scoreLabel(student?.[skill.averageKey]) : '—'}</strong>
            <i>/10</i>
          </span>
        ))}
      </div>
    </div>
  );
};

const SkillRatingForm = ({
  student,
  existing,
  onSubmit,
  onCancel,
  busy = false,
  error = '',
}) => {
  const initial = useMemo(() => ({
    overall: Number(existing?.overall) || 5,
    dsa: Number(existing?.dsa) || 5,
    ml: Number(existing?.ml) || 5,
  }), [existing]);
  const [scores, setScores] = useState(initial);

  useEffect(() => setScores(initial), [initial]);

  const unchanged = Boolean(existing)
    && SKILLS.every((skill) => Number(existing[skill.key]) === scores[skill.key]);

  return (
    <form
      className="skill-rating-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(scores);
      }}
    >
      <div className="rating-dialog-heading">
        <span className="eyebrow">{existing ? 'Change your rating' : 'Private submission'}</span>
        <h2>{student?.name}</h2>
        <p>{student?.roll_number}{student?.program ? ` · ${student.program}` : ''}</p>
      </div>

      <div className="rating-privacy-note">
        <strong>Your name stays hidden from viewers.</strong>
        <span>Only averages and the number of ratings are public. Admins can audit who submitted each rating.</span>
      </div>

      <div className="rating-scale-list">
        {SKILLS.map((skill) => (
          <label key={skill.key} className="rating-scale">
            <span>
              <strong>{skill.label}</strong>
              <small>{skill.key === 'overall' ? 'Your holistic assessment' : skill.key === 'dsa' ? 'Problem solving and algorithms' : 'Machine learning knowledge and practice'}</small>
            </span>
            <output htmlFor={`rating-${skill.key}`}>{scores[skill.key]}<i>/10</i></output>
            <input
              id={`rating-${skill.key}`}
              type="range"
              min="1"
              max="10"
              step="1"
              value={scores[skill.key]}
              onChange={(event) => setScores((current) => ({
                ...current,
                [skill.key]: Number(event.target.value),
              }))}
              disabled={busy}
            />
            <span className="rating-scale-ends"><small>1 · Developing</small><small>10 · Exceptional</small></span>
          </label>
        ))}
      </div>

      {existing && <p className="rating-change-warning">Changing a saved rating always asks for confirmation before it is updated.</p>}
      {error && <p className="error-text" role="alert">{error}</p>}

      <div className="rating-form-actions">
        <button type="button" className="secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="submit" disabled={busy || unchanged}>
          {busy ? 'Saving…' : existing ? 'Review & change rating' : 'Submit rating'}
        </button>
      </div>
    </form>
  );
};

const RatingsIntro = ({
  open,
  canRate,
  selfStudent,
  onClose,
  onRateSelf,
  onBrowse,
}) => (
  <Modal open={open} onClose={onClose} label="New skill ratings walkthrough">
    <div className="ratings-intro">
      <span className="eyebrow">New in Placement Atlas</span>
      <h2>Recognise the skills in your batch</h2>
      <p className="ratings-intro-lead">Rate yourself or a batchmate from 1–10 across Overall, DSA, and ML skills. This quick demo shows exactly what becomes visible.</p>

      <div className="ratings-demo-card" aria-label="Skill rating example">
        <div><span className="student-avatar">AK</span><span><strong>Example batchmate</strong><small>Skill rating preview</small></span></div>
        <SkillRatingSummary student={{ rating_count: 8, rating_overall: 8.4, rating_dsa: 9.1, rating_ml: 7.6 }} />
      </div>

      <ol className="ratings-intro-steps">
        <li><i>1</i><span><strong>Choose anyone</strong><small>Open a student card and select Rate skills.</small></span></li>
        <li><i>2</i><span><strong>Move three simple scales</strong><small>Give a whole-number score from 1 to 10.</small></span></li>
        <li><i>3</i><span><strong>Stay anonymous to classmates</strong><small>Viewers see averages only; admins can audit attribution from their private analytics button.</small></span></li>
      </ol>

      {!canRate && (
        <div className="rating-eligibility-note">
          Shared viewer access can see averages but cannot submit ratings. Sign out and use your IIIT Delhi Google account so attribution can be audited.
        </div>
      )}

      <div className="ratings-intro-actions">
        {canRate && selfStudent && <button type="button" onClick={onRateSelf}>Rate myself</button>}
        <button type="button" className={canRate && selfStudent ? 'secondary' : ''} onClick={onBrowse}>
          {canRate ? 'Browse batchmates' : 'See skill averages'}
        </button>
      </div>
    </div>
  </Modal>
);

const RatingsAnalytics = ({ open, onClose, authHeaders }) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      setData(null);
      setError('');
      return undefined;
    }

    let active = true;
    api.get('/ratings/analytics', authHeaders)
      .then((response) => {
        if (active) setData(response.data);
      })
      .catch((err) => {
        if (active) setError(err.response?.data?.message || 'Ratings analytics could not be loaded.');
      });
    return () => { active = false; };
  }, [authHeaders, open]);

  const summary = data?.summary || {};
  const ratings = data?.ratings || [];

  return (
    <Modal open={open} onClose={onClose} label="Private ratings analytics">
      <div className="ratings-analytics">
        <span className="eyebrow">Admin only · private attribution</span>
        <h2>Skill ratings analytics</h2>
        <p className="ratings-analytics-lead">This is the only screen that reveals who submitted a rating. Do not share or export attribution.</p>

        {error && <p className="error-text" role="alert">{error}</p>}
        {!data && !error && <div className="ratings-loading">Loading private analytics…</div>}

        {data && (
          <>
            <div className="ratings-analytics-summary">
              <div><strong>{summary.total_ratings || 0}</strong><span>ratings</span></div>
              <div><strong>{summary.participating_raters || 0}</strong><span>raters</span></div>
              <div><strong>{summary.students_rated || 0}</strong><span>students rated</span></div>
            </div>

            <div className="ratings-analytics-table-wrap">
              <table className="ratings-analytics-table">
                <thead>
                  <tr><th>Rater</th><th>Rated student</th><th>Overall</th><th>DSA</th><th>ML</th><th>Updated</th></tr>
                </thead>
                <tbody>
                  {ratings.map((rating) => (
                    <tr key={rating.id}>
                      <td>
                        <strong>{rating.rater_name || rating.rater_email}</strong>
                        <small>{rating.rater_name ? `${rating.rater_roll_number} · ${rating.rater_email}` : 'Google account'}</small>
                      </td>
                      <td><strong>{rating.target_name}</strong><small>{rating.target_roll_number} · {rating.target_program}</small></td>
                      <td>{rating.overall}/10</td>
                      <td>{rating.dsa}/10</td>
                      <td>{rating.ml}/10</td>
                      <td>{formatRelative(rating.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!ratings.length && <div className="empty-directory-state"><h3>No ratings yet.</h3><p>Submitted ratings will appear here with private attribution.</p></div>}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};

export {
  RatingsAnalytics,
  RatingsIntro,
  SkillRatingForm,
  SkillRatingSummary,
};
