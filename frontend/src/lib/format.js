// Display formatting shared across pages and components.

const formatInr = (val, period = 'p.a.') => {
  if (val === null || val === undefined || Number.isNaN(Number(val))) return '—';
  const number = Number(val);
  // Annual figures read more naturally in LPA for a placement audience; monthly stays in rupees.
  if (period === 'p.a.') {
    const lpa = number / 100000;
    return `₹${lpa.toLocaleString('en-IN', { maximumFractionDigits: 2 })} LPA`;
  }
  if (period === 'p.m.') {
    return `₹${number.toLocaleString('en-IN', { maximumFractionDigits: 0 })}/mo`;
  }
  return `₹${number.toLocaleString('en-IN', { maximumFractionDigits: 2 })} ${period}`;
};

const formatPct = (val) => (val === null || val === undefined || Number.isNaN(Number(val)) ? '—' : `${val}%`);

const formatRelative = (val) => {
  if (!val) return '';
  const date = new Date(val);
  if (Number.isNaN(date.getTime())) return '';
  const diffMinutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hr${diffHours > 1 ? 's' : ''} ago`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 30) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  return formatDate(val);
};

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

export { formatInr, formatPct, formatRelative, formatDate };
