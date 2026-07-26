import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { googleLogout } from '@react-oauth/google';
import axios from 'axios';
import { api } from './api';
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
  isPlacementQualifyingOfferType,
  isSummerInternOfferType,
} from './offerTypes';
import { OFFICIAL_2025 } from './official2025';
import { OFFICIAL_2026 } from './official2026';
import { InfoTip, MetricLabel, MobileDisclosure, SortIcon, StatCard, StatusPill, ThemeToggle, initialsFor } from './components/ui';
import { DonutChart, HorizontalBars, MetricTile, SegmentedBar } from './components/charts';
import { Modal } from './components/Modal';
import { ConvertToPpo } from './components/ConvertToPpo';
import { CompanyForm } from './components/CompanyForm';
import { StudentForm } from './components/StudentForm';
import { LoginScreen } from './components/LoginScreen';
import { ViewerAccessSettings } from './components/ViewerAccessSettings';
import { BRANCH_OPTIONS, branchToken, companyRecruitsDegree, formatBranchToken } from './lib/branches';
import {
  BRANCH_GROUP_ORDER,
  DASHBOARD_BRANCH_LABELS,
  EMPTY_SLICE_SUMMARY,
  STUDENT_STATUS_OPTIONS,
  buildProgramSummaries,
  getStudentOffers,
  isPlacementEligibleStudent,
  sortPrograms,
} from './lib/students';
import { formatDate, formatInr, formatPct, formatRelative } from './lib/format';

// Admin-only bundle: viewers never need the calendar admin page, so load it on demand.
const PlacementCalendarAdmin = lazy(() => import('./PlacementCalendarAdmin'));


const assetBase = import.meta.env.BASE_URL || '/';
const VIEWER_TOKEN_STORAGE_KEY = 'viewerToken';
const COMPANY_SORT_FIELDS = new Set(['name', 'ctc', 'stipend', 'totalHired', 'offer_date']);
const STUDENT_SORT_FIELDS = new Set(['roll_number', 'name', 'ctc', 'stipend', 'offer_date']);
const VIEW_MODES = new Set(['cards', 'table']);

const DASHBOARD_VIEWS = new Set(['overview', 'official', 'tracker', 'programs', 'compensation', 'recent']);
const DEFAULT_COMPANY_FILTERS = { type: '', category: '', branchGroup: '' };
const DEFAULT_STUDENT_FILTERS = { branchGroup: '', programs: [], status: '', offerType: '' };
const LATEST_CYCLE_KEY = `cycle-${Math.max(...BATCHES.map((batch) => batch.graduation_year))}`;
const readInitialBatchKey = () => {
  const stored = localStorage.getItem('activeBatchKey');
  if (stored === 'mtech-cse-2025') return 'mtech-2025';
  return stored || LATEST_CYCLE_KEY;
};

const isKnownBatchKey = (key) => (
  BATCHES.some((batch) => batch.key === key)
  || (/^cycle-\d+$/.test(key || '') && BATCHES.some((batch) => `cycle-${batch.graduation_year}` === key))
);
const normalizeSortDirection = (value, fallback = true) => (value === 'desc' ? false : value === 'asc' ? true : fallback);
const splitProgramsParam = (value) => (value ? value.split(',').map((item) => item.trim()).filter(Boolean) : []);
const readDashboardView = (searchParams) => {
  const view = searchParams.get('view');
  return DASHBOARD_VIEWS.has(view) ? view : 'overview';
};

const readCompanyQueryState = (searchParams) => {
  const sort = searchParams.get('companySort');
  const view = searchParams.get('companyView');
  return {
    search: searchParams.get('companySearch') || '',
    filters: {
      type: searchParams.get('companyType') || '',
      category: searchParams.get('companyCategory') || '',
      branchGroup: searchParams.get('companyBranch') || '',
    },
    sort: {
      field: COMPANY_SORT_FIELDS.has(sort) ? sort : 'name',
      asc: normalizeSortDirection(searchParams.get('companyDir'), !sort || sort === 'name'),
    },
    view: VIEW_MODES.has(view) ? view : 'cards',
  };
};

const readStudentQueryState = (searchParams) => {
  const sort = searchParams.get('studentSort');
  const view = searchParams.get('studentView');
  return {
    search: searchParams.get('studentSearch') || '',
    filters: {
      branchGroup: searchParams.get('studentBranch') || '',
      programs: splitProgramsParam(searchParams.get('studentPrograms')),
      status: searchParams.get('studentStatus') || '',
      offerType: searchParams.get('studentOfferType') || '',
    },
    sort: {
      field: STUDENT_SORT_FIELDS.has(sort) ? sort : 'roll_number',
      asc: normalizeSortDirection(searchParams.get('studentDir'), !sort || sort === 'roll_number' || sort === 'name'),
    },
    view: VIEW_MODES.has(view) ? view : 'cards',
  };
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
      cachedAt: parsed.cachedAt || null,
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

const useAdminHeaders = (token) => useMemo(() => ({ headers: { Authorization: `Bearer ${token}` } }), [token]);

const App = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const routeSearchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const initialCompanyQuery = useMemo(() => readCompanyQueryState(routeSearchParams), []);
  const initialStudentQuery = useMemo(() => readStudentQueryState(routeSearchParams), []);
  const initialDashboardView = useMemo(() => readDashboardView(routeSearchParams), []);
  const [viewerToken, setViewerToken] = useState(readStoredViewerToken);
  const [token, setToken] = useState('');
  const [activeBatchKey, setActiveBatchKey] = useState(() => {
    const queryBatch = routeSearchParams.get('batch');
    return isKnownBatchKey(queryBatch) ? queryBatch : readInitialBatchKey();
  });
  const initialSnapshot = readBatchCache(activeBatchKey);
  const authHeaders = useAdminHeaders(token);
  const viewerHeaders = useAdminHeaders(viewerToken);
  const isAdmin = !!token;
  const activeBatch = useMemo(() => getBatchConfig(activeBatchKey), [activeBatchKey]);
  const isOverallScope = activeBatch.degree === 'Overall';
  const isAggregateOnly = !!activeBatch.aggregate_only;
  const isPlacementRecordsOnly = !!activeBatch.placements_only;
  // Official report overlays are degree-specific; the Overall (cycle) view uses the standard
  // aggregate dashboard computed across both degrees.
  const isOfficial2025 = !isOverallScope && activeBatch.graduation_year === 2025 && isPlacementRecordsOnly;
  const isOfficial2026 = !isOverallScope && activeBatch.graduation_year === 2026 && !isAggregateOnly;
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
  const [cycleStudents, setCycleStudents] = useState([]);
  const [offerSearch, setOfferSearch] = useState('');
  const [offerStudentId, setOfferStudentId] = useState('');
  const [offerType, setOfferType] = useState('');
  const [offerRole, setOfferRole] = useState('');
  const [offerCtc, setOfferCtc] = useState('');
  const [offerStipend, setOfferStipend] = useState('');
  const [offerBusy, setOfferBusy] = useState(false);
  const [offerError, setOfferError] = useState('');
  const [loading, setLoading] = useState(!initialSnapshot);
  const [dataUpdatedAt, setDataUpdatedAt] = useState(initialSnapshot?.cachedAt || null);
  const [loadedBatchKey, setLoadedBatchKey] = useState(initialSnapshot ? activeBatchKey : null);
  const [error, setError] = useState('');
  const [loginError, setLoginError] = useState('');
  const [authPending, setAuthPending] = useState(false);
  const [sessionChecking, setSessionChecking] = useState(() => !!viewerToken);
  const refreshRequestId = useRef(0);
  const internalSearchRef = useRef('');
  const hydratingFromUrlRef = useRef(false);
  const isViewerAuthed = !!viewerToken;
  const isAdminRoute = location.pathname.startsWith('/admin');

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
    setDataUpdatedAt(null);
    setLoadedBatchKey(null);
  };

  const [showCompanyModal, setShowCompanyModal] = useState(false);
  const [editCompany, setEditCompany] = useState(null);
  const [showStudentModal, setShowStudentModal] = useState(false);
  const [editStudent, setEditStudent] = useState(null);

  // Companies page: search, sort, filter, detail
  const [companySearch, setCompanySearch] = useState(initialCompanyQuery.search);
  const [companySort, setCompanySort] = useState(initialCompanyQuery.sort);
  const [companyFilters, setCompanyFilters] = useState(initialCompanyQuery.filters);
  const [companyView, setCompanyView] = useState(initialCompanyQuery.view);
  const [selectedCompanyId, setSelectedCompanyId] = useState(routeSearchParams.get('company') || '');
  const [selectedCompany, setSelectedCompany] = useState(null);

  // Students page: search, sort, filter
  const [studentSearch, setStudentSearch] = useState(initialStudentQuery.search);
  const [studentSort, setStudentSort] = useState(initialStudentQuery.sort);
  const [studentFilters, setStudentFilters] = useState(initialStudentQuery.filters);
  const [studentView, setStudentView] = useState(initialStudentQuery.view);
  const [selectedStudentId, setSelectedStudentId] = useState(routeSearchParams.get('student') || '');
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [dashboardBranchFilter, setDashboardBranchFilter] = useState('ALL');
  const [dashboardView, setDashboardView] = useState(initialDashboardView);
  const [mobileHeaderHidden, setMobileHeaderHidden] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [themeMode, setThemeMode] = useState(localStorage.getItem('themeMode') || 'light');
  const canonicalDashboardView = useMemo(() => {
    if (dashboardView === 'overview') return dashboardView;
    if (dashboardView === 'official') return isOfficial2025 || isOfficial2026 ? dashboardView : 'overview';
    if (dashboardView === 'tracker') return !isAggregateOnly ? dashboardView : 'overview';
    if (dashboardView === 'programs') return !isAggregateOnly && !isPlacementRecordsOnly ? dashboardView : 'overview';
    if (dashboardView === 'compensation' || dashboardView === 'recent') return !isAggregateOnly && !isOfficial2025 ? dashboardView : 'overview';
    return 'overview';
  }, [dashboardView, isAggregateOnly, isOfficial2025, isOfficial2026, isPlacementRecordsOnly]);

  useEffect(() => {
    if (internalSearchRef.current === location.search) {
      internalSearchRef.current = '';
      return;
    }

    hydratingFromUrlRef.current = true;

    const searchParams = new URLSearchParams(location.search);
    const queryBatch = searchParams.get('batch');
    if (isKnownBatchKey(queryBatch)) {
      setActiveBatchKey((current) => (current === queryBatch ? current : queryBatch));
    }

    if (location.pathname === '/') {
      setDashboardView(readDashboardView(searchParams));
    } else if (location.pathname === '/companies') {
      const query = readCompanyQueryState(searchParams);
      setCompanySearch(query.search);
      setCompanyFilters(query.filters);
      setCompanySort(query.sort);
      setCompanyView(query.view);
      setSelectedCompanyId(searchParams.get('company') || '');
    } else if (location.pathname === '/students') {
      const query = readStudentQueryState(searchParams);
      setStudentSearch(query.search);
      setStudentFilters(query.filters);
      setStudentSort(query.sort);
      setStudentView(query.view);
      setSelectedStudentId(searchParams.get('student') || '');
    }
  }, [location.pathname, location.search]);

  useEffect(() => {
    localStorage.setItem('activeBatchKey', activeBatch.key);
    const cachedSnapshot = readBatchCache(activeBatch.key);

    if (cachedSnapshot) {
      setStats(cachedSnapshot.stats);
      setCompanies(cachedSnapshot.companies);
      setStudents(cachedSnapshot.students);
      setDataUpdatedAt(cachedSnapshot.cachedAt || null);
      setLoadedBatchKey(activeBatch.key);
      setLoading(false);
    } else {
      setStats({});
      setCompanies([]);
      setStudents([]);
      setDataUpdatedAt(null);
      setLoadedBatchKey(null);
      setLoading(true);
    }

    setError('');
    setDashboardBranchFilter('ALL');
    setSelectedCompany(null);
    setSelectedStudent(null);
    setMobileNavOpen(false);
  }, [activeBatch.key]);

  useEffect(() => {
    if (!isViewerAuthed || isAdminRoute) return;
    if (hydratingFromUrlRef.current) {
      hydratingFromUrlRef.current = false;
      return;
    }

    const params = new URLSearchParams(location.search);
    params.set('batch', activeBatch.key);

    if (location.pathname === '/') {
      canonicalDashboardView !== 'overview' ? params.set('view', canonicalDashboardView) : params.delete('view');
      ['companySearch', 'companyType', 'companyCategory', 'companyBranch', 'companySort', 'companyDir', 'companyView', 'company', 'studentSearch', 'studentBranch', 'studentPrograms', 'studentStatus', 'studentOfferType', 'studentSort', 'studentDir', 'studentView', 'student'].forEach((key) => params.delete(key));
    } else if (location.pathname === '/companies') {
      companySearch ? params.set('companySearch', companySearch) : params.delete('companySearch');
      companyFilters.type ? params.set('companyType', companyFilters.type) : params.delete('companyType');
      companyFilters.category ? params.set('companyCategory', companyFilters.category) : params.delete('companyCategory');
      companyFilters.branchGroup ? params.set('companyBranch', companyFilters.branchGroup) : params.delete('companyBranch');
      companySort.field !== 'name' ? params.set('companySort', companySort.field) : params.delete('companySort');
      companySort.asc === false ? params.set('companyDir', 'desc') : params.delete('companyDir');
      companyView !== 'cards' ? params.set('companyView', companyView) : params.delete('companyView');
      selectedCompanyId ? params.set('company', selectedCompanyId) : params.delete('company');
      ['view', 'studentSearch', 'studentBranch', 'studentPrograms', 'studentStatus', 'studentOfferType', 'studentSort', 'studentDir', 'studentView', 'student'].forEach((key) => params.delete(key));
    } else if (location.pathname === '/students') {
      studentSearch ? params.set('studentSearch', studentSearch) : params.delete('studentSearch');
      studentFilters.branchGroup ? params.set('studentBranch', studentFilters.branchGroup) : params.delete('studentBranch');
      studentFilters.programs.length ? params.set('studentPrograms', studentFilters.programs.join(',')) : params.delete('studentPrograms');
      studentFilters.status ? params.set('studentStatus', studentFilters.status) : params.delete('studentStatus');
      studentFilters.offerType ? params.set('studentOfferType', studentFilters.offerType) : params.delete('studentOfferType');
      studentSort.field !== 'roll_number' ? params.set('studentSort', studentSort.field) : params.delete('studentSort');
      studentSort.asc === false ? params.set('studentDir', 'desc') : params.delete('studentDir');
      studentView !== 'cards' ? params.set('studentView', studentView) : params.delete('studentView');
      selectedStudentId ? params.set('student', selectedStudentId) : params.delete('student');
      ['view', 'companySearch', 'companyType', 'companyCategory', 'companyBranch', 'companySort', 'companyDir', 'companyView', 'company'].forEach((key) => params.delete(key));
    }

    const nextSearch = params.toString();
    const nextSearchWithPrefix = nextSearch ? `?${nextSearch}` : '';
    if (nextSearchWithPrefix !== location.search) {
      internalSearchRef.current = nextSearchWithPrefix;
      navigate({ pathname: location.pathname, search: nextSearchWithPrefix }, { replace: true });
    }
  }, [activeBatch.key, canonicalDashboardView, companyFilters, companySearch, companySort, companyView, isAdminRoute, isViewerAuthed, location.pathname, location.search, navigate, selectedCompanyId, selectedStudentId, studentFilters, studentSearch, studentSort, studentView]);

  useEffect(() => {
    if (location.pathname !== '/companies') return;

    if (!selectedCompanyId) {
      if (selectedCompany) setSelectedCompany(null);
      return;
    }
    if (loadedBatchKey !== activeBatch.key) {
      if (selectedCompany) setSelectedCompany(null);
      return;
    }
    const matchedCompany = companies.find((company) => String(company.id) === String(selectedCompanyId));
    if (matchedCompany && String(selectedCompany?.id) !== String(matchedCompany.id)) {
      setSelectedCompany(matchedCompany);
    } else if (!matchedCompany && selectedCompany) {
      setSelectedCompany(null);
    }
  }, [activeBatch.key, companies, loadedBatchKey, location.pathname, selectedCompany, selectedCompanyId]);

  useEffect(() => {
    if (location.pathname !== '/students') return;

    if (!selectedStudentId) {
      if (selectedStudent) setSelectedStudent(null);
      return;
    }
    if (loadedBatchKey !== activeBatch.key) {
      if (selectedStudent) setSelectedStudent(null);
      return;
    }
    const matchedStudent = students.find((student) => String(student.id) === String(selectedStudentId));
    if (matchedStudent && String(selectedStudent?.id) !== String(matchedStudent.id)) {
      setSelectedStudent(matchedStudent);
    } else if (!matchedStudent && selectedStudent) {
      setSelectedStudent(null);
    }
  }, [activeBatch.key, loadedBatchKey, location.pathname, selectedStudent, selectedStudentId, students]);

  useEffect(() => {
    if (!viewerToken) {
      setToken('');
      setSessionChecking(false);
      return;
    }

    let active = true;
    setSessionChecking(true);
    api.get('/auth/session', viewerHeaders)
      .then((response) => {
        if (!active) return;
        setToken(response.data.is_admin ? viewerToken : '');
      })
      .catch(() => {
        if (!active) return;
        handleGoogleLogout();
        setLoginError('Your viewer session expired. Please sign in again.');
      })
      .finally(() => {
        if (active) setSessionChecking(false);
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
        setLoadedBatchKey(null);
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
    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta) themeColorMeta.setAttribute('content', themeMode === 'dark' ? '#10191b' : '#ffffff');
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

  const copyCurrentLink = async () => {
    if (typeof window === 'undefined' || !navigator.clipboard) return;
    await navigator.clipboard.writeText(window.location.href);
  };

  const resetOfferForm = () => {
    setOfferSearch('');
    setOfferStudentId('');
    setOfferType('');
    setOfferRole('');
    setOfferCtc('');
    setOfferStipend('');
    setOfferError('');
  };

  const openCompanyDetail = (company) => {
    setSelectedCompany(company);
    setSelectedCompanyId(company?.id ? String(company.id) : '');
    resetOfferForm();
  };

  const closeCompanyDetail = () => {
    setSelectedCompany(null);
    setSelectedCompanyId('');
    resetOfferForm();
  };

  const offerCandidates = useMemo(() => {
    const q = offerSearch.trim().toLowerCase();
    if (!q || offerStudentId) return [];
    return cycleStudents
      .filter((s) => s.name?.toLowerCase().includes(q) || String(s.roll_number).toLowerCase().includes(q))
      .slice(0, 8);
  }, [offerSearch, offerStudentId, cycleStudents]);

  const offerStudent = useMemo(
    () => cycleStudents.find((s) => String(s.id) === String(offerStudentId)) || null,
    [cycleStudents, offerStudentId]
  );
  // Company role packages applicable to the chosen student (their degree or "All").
  const offerPackages = useMemo(
    () => (selectedCompany?.roles || []).filter((p) => !p.degree || p.degree === 'All' || p.degree === offerStudent?.degree),
    [selectedCompany, offerStudent]
  );
  const applyOfferPackage = (pkg) => {
    setOfferRole(pkg.role || '');
    setOfferType(pkg.offer_type || '');
    setOfferCtc(pkg.ctc ?? '');
    setOfferStipend(pkg.stipend ?? '');
  };

  const addCompanyOffer = async () => {
    if (!isAdmin || !selectedCompany || !offerStudentId) return;
    setOfferBusy(true);
    setOfferError('');
    try {
      await api.post('/offers', {
        student_id: Number(offerStudentId),
        company_id: selectedCompany.id,
        offer_type: offerType || selectedCompany.type || null,
        role: offerRole || null,
        ctc: offerCtc ? Number(offerCtc) : null,
        stipend: offerStipend ? Number(offerStipend) : null,
      }, authHeaders);
      resetOfferForm();
      refresh();
    } catch (err) {
      setOfferError(err.response?.data?.message || err.message);
    } finally {
      setOfferBusy(false);
    }
  };

  // Converts an Intern / Summer Intern offer to its "+ PPO" variant. The backend returns the
  // refreshed student, so an open student detail modal updates immediately; refresh() then
  // reconciles the directory lists and company hiring stats.
  const convertOfferToPpoAction = async (offer, payload) => {
    const { data } = await api.post(`/offers/${offer.id}/convert-to-ppo`, payload, authHeaders);
    setSelectedStudent((prev) => (prev && String(prev.id) === String(data.id) ? data : prev));
    refresh();
  };

  const openStudentDetail = (student) => {
    setSelectedStudent(student);
    setSelectedStudentId(student?.id ? String(student.id) : '');
  };

  const closeStudentDetail = () => {
    setSelectedStudent(null);
    setSelectedStudentId('');
  };

  const handleBatchChange = (batchKey) => {
    if (!isKnownBatchKey(batchKey) || batchKey === activeBatch.key) return;
    closeCompanyDetail();
    closeStudentDetail();
    setActiveBatchKey(batchKey);
  };

  // Placement cycles = graduation years, each grouping the degree-batches of that year.
  const CYCLES = useMemo(() => {
    const order = [];
    const byYear = new Map();
    for (const batch of BATCHES) {
      if (!byYear.has(batch.graduation_year)) {
        const cycle = { year: batch.graduation_year, batches: [] };
        byYear.set(batch.graduation_year, cycle);
        order.push(cycle);
      }
      byYear.get(batch.graduation_year).batches.push(batch);
    }
    return order;
  }, []);
  const activeCycle = CYCLES.find((cycle) => cycle.year === activeBatch.graduation_year) || CYCLES[0];
  const handleCycleChange = (year) => {
    const cycle = CYCLES.find((entry) => entry.year === year);
    if (!cycle) return;
    // Keep the degree the reader is already on when the new year offers it; otherwise multi-degree
    // cycles fall back to Overall (the cycle is the parent) and single-degree cycles (e.g. the
    // M.Tech-CSE aggregates) go straight to their one degree.
    const sameDegree = cycle.batches.find((batch) => batch.degree === activeBatch.degree);
    const key = sameDegree ? sameDegree.key : cycle.batches.length >= 2 ? `cycle-${year}` : cycle.batches[0].key;
    handleBatchChange(key);
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

  // One short line about where the numbers come from. Longer methodology stays in the metric
  // tooltips rather than as standing page copy.
  const dataProvenance = useMemo(() => {
    if (isOfficial2026) return { label: 'Official + tracker', note: 'College-published 2026 figures sit in the Official tab and are never merged with tracker records.' };
    if (isOfficial2025) return { label: 'Official statistics', note: 'Percentages come from official 2025 figures; uploaded records stay browsable but are not used to infer rates.' };
    if (isAggregateOnly) return { label: 'Aggregate archive', note: 'Company-level M.Tech CSE counts only — no student, rate, or compensation data in this source.' };
    if (isPlacementRecordsOnly) return { label: 'Placed-record archive', note: 'The source lists placed students only, so unplaced counts and placement rates are withheld.' };
    return { label: 'Tracker dataset', note: 'Placement rates use eligible and sitting students as the denominator.' };
  }, [isAggregateOnly, isOfficial2025, isOfficial2026, isPlacementRecordsOnly]);

  const dashboardViews = useMemo(() => {
    const views = [{ key: 'overview', label: 'Overview' }];

    if (isOfficial2025 || isOfficial2026) {
      views.push({ key: 'official', label: 'Official' });
    }

    if (!isAggregateOnly) {
      views.push({ key: 'tracker', label: isOfficial2025 ? 'Records' : 'Tracker' });
    }

    if (!isAggregateOnly && !isPlacementRecordsOnly) {
      views.push({ key: 'programs', label: 'Programs' });
    }

    if (!isAggregateOnly && !isOfficial2025) {
      views.push({ key: 'compensation', label: 'Compensation' });
      views.push({ key: 'recent', label: 'Recent' });
    }

    return views;
  }, [isAggregateOnly, isOfficial2025, isOfficial2026, isPlacementRecordsOnly]);

  useEffect(() => {
    if (dashboardViews.some((view) => view.key === dashboardView)) return;
    setDashboardView('overview');
  }, [dashboardView, dashboardViews]);

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
        stats[cid].students.push({ name: s.name, roll: s.roll_number, program: s.program, branch_group: branchGroup, offer: o });
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

  const companyFilterCounts = useMemo(() => {
    const visibleCompanies = isAdmin ? companies : companies.filter((company) => {
      const hiring = companyHiringStats[company.id];
      return (hiring?.total || 0) > 0 || (hiring?.reported || 0) > 0;
    });
    return {
      types: OFFER_TYPES.reduce((acc, type) => ({ ...acc, [type]: visibleCompanies.filter((company) => company.type === type).length }), {}),
      categories: ['A+', 'A', 'B'].reduce((acc, category) => ({ ...acc, [category]: visibleCompanies.filter((company) => (company.category || '').toUpperCase() === category).length }), {}),
      branches: ['CSE', 'ECE', 'CB'].reduce((acc, branch) => ({ ...acc, [branch]: visibleCompanies.filter((company) => (companyHiringStats[company.id]?.[branch] || 0) > 0).length }), {}),
    };
  }, [companies, companyHiringStats, isAdmin]);

  const studentOverview = useMemo(() => {
    const placed = filteredStudents.filter((student) => student.placement_status === 'Placed').length;
    const eligible = filteredStudents.filter(isPlacementEligibleStudent).length;
    const excluded = Math.max(filteredStudents.length - eligible, 0);

    return {
      total: filteredStudents.length,
      eligible,
      excluded,
      placed,
      unplaced: Math.max(eligible - placed, 0),
      programs: new Set(filteredStudents.map((student) => student.program).filter(Boolean)).size,
    };
  }, [filteredStudents]);

  const studentFilterCounts = useMemo(() => ({
    branches: ['CSE', 'ECE', 'CB'].reduce((acc, branch) => ({ ...acc, [branch]: students.filter((student) => (student.branch_group || getBranchGroup(student.program)) === branch).length }), {}),
    statuses: STUDENT_STATUS_OPTIONS.reduce((acc, status) => ({ ...acc, [status]: students.filter((student) => student.placement_status === status).length }), {}),
    offerTypes: OFFER_TYPES.reduce((acc, type) => ({
      ...acc,
      [type]: students.filter((student) => {
        if (student.offers?.length) return student.offers.some((offer) => offer.offer_type === type);
        return student.offer_type === type;
      }).length,
    }), {}),
    programs: availablePrograms.reduce((acc, program) => ({ ...acc, [program]: students.filter((student) => student.program === program).length }), {}),
  }), [availablePrograms, students]);

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

  const selectedCompanyIndex = selectedCompany
    ? filteredCompanies.findIndex((company) => String(company.id) === String(selectedCompany.id))
    : -1;
  const selectedStudentIndex = selectedStudent
    ? filteredStudents.findIndex((student) => String(student.id) === String(selectedStudent.id))
    : -1;
  const moveSelectedCompany = (offset) => {
    if (selectedCompanyIndex < 0 || !filteredCompanies.length) return;
    const nextIndex = (selectedCompanyIndex + offset + filteredCompanies.length) % filteredCompanies.length;
    openCompanyDetail(filteredCompanies[nextIndex]);
  };
  const moveSelectedStudent = (offset) => {
    if (selectedStudentIndex < 0 || !filteredStudents.length) return;
    const nextIndex = (selectedStudentIndex + offset + filteredStudents.length) % filteredStudents.length;
    openStudentDetail(filteredStudents[nextIndex]);
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
        const batchConfig = getBatchConfig(batchKey);
        const cycleParams = {
          params: { cycle: batchConfig.graduation_year },
          headers: viewerHeaders.headers,
          signal: controller.signal,
        };
        // Cycle-first: load the whole cycle once (Overall is the source of truth), then the
        // active scope (Overall vs a degree) is a filter over that single dataset.
        const [statsRes, companyRes, studentRes] = await Promise.all([
          api.get('/stats', cycleParams),
          api.get('/companies', cycleParams),
          api.get('/students', cycleParams),
        ]);

        const allStudents = studentRes.data || [];
        const allCompanies = companyRes.data || [];
        const cycleStats = statsRes.data || {};
        const isOverall = batchConfig.degree === 'Overall';

        const scopedStudents = isOverall ? allStudents : allStudents.filter((s) => s.degree === batchConfig.degree);
        const scopedCompanies = isOverall ? allCompanies : allCompanies.filter((c) => companyRecruitsDegree(c, batchConfig.degree));
        let scopedStats = cycleStats;
        if (!isOverall && !batchConfig.aggregate_only) {
          const withOffers = new Set();
          scopedStudents.forEach((s) => (s.offers || []).forEach((o) => o.company_id && withOffers.add(String(o.company_id))));
          scopedStats = {
            ...cycleStats,
            number_of_companies: scopedCompanies.filter((c) => withOffers.has(String(c.id))).length,
            total_companies_listed: scopedCompanies.length,
            available_programs: [...new Set(scopedStudents.map((s) => s.program).filter(Boolean))].sort(),
          };
        }

        const nextSnapshot = {
          stats: scopedStats,
          companies: scopedCompanies,
          students: scopedStudents,
        };

        if (!isCurrentRequest()) return;
        setStats(nextSnapshot.stats);
        setCompanies(nextSnapshot.companies);
        setStudents(nextSnapshot.students);
        setCycleStudents(allStudents);
        writeBatchCache(batchKey, nextSnapshot);
        setLoadedBatchKey(batchKey);
        setDataUpdatedAt(new Date().toISOString());
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
    if (isViewerAuthed && !isAdminRoute) return refresh(activeBatch.key);
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isViewerAuthed, isAdminRoute, activeBatch.key]);

  const batchPayload = {
    batch_key: activeBatch.key,
    degree: activeBatch.degree,
    graduation_year: activeBatch.graduation_year,
  };

  // The Overall view is a synthetic cross-degree scope; its `cycle-<year>` key must never be
  // written onto a record — it fails the backend's company batch check and would clobber the
  // record's real B.Tech/M.Tech identity. When editing from that scope keep the record's own
  // batch; otherwise use the active batch.
  const resolveRecordBatch = (record) => (
    isOverallScope && record?.batch_key
      ? { batch_key: record.batch_key, degree: record.degree, graduation_year: record.graduation_year }
      : batchPayload
  );

  // Companies are cycle-scoped, so they can be added from the Overall view too — but a row
  // must be stored under a real batch of the cycle (never the synthetic `cycle-<year>` key).
  // Derive it from the branches picked in the form: M.Tech-only tags file the company under
  // the cycle's M.Tech batch, anything else under B.Tech.
  const cycleBatchForBranches = (branches) => {
    const tokens = (Array.isArray(branches) ? branches : []).map(String);
    const mtechOnly = tokens.length > 0 && tokens.every((token) => token.startsWith('M.Tech'));
    const cycleBatches = BATCHES.filter((batch) => batch.graduation_year === activeBatch.graduation_year);
    const chosen = cycleBatches.find((batch) => batch.degree === (mtechOnly ? 'M.Tech' : 'B.Tech'))
      || cycleBatches.find((batch) => !batch.aggregate_only)
      || cycleBatches[0];
    return chosen
      ? { batch_key: chosen.key, degree: chosen.degree, graduation_year: chosen.graduation_year }
      : batchPayload;
  };

  const saveCompany = async (payload) => {
    if (!isAdmin) return;
    const recordBatch = editCompany
      ? resolveRecordBatch(editCompany)
      : (isOverallScope ? cycleBatchForBranches(payload.branches) : batchPayload);
    if (editCompany) {
      await api.put(`/companies/${editCompany.id}`, { ...payload, ...recordBatch }, authHeaders);
    } else {
      await api.post('/companies', { ...payload, ...recordBatch }, authHeaders);
    }
    setShowCompanyModal(false);
    setEditCompany(null);
    refresh();
  };

  const deleteCompanyAction = async (id) => {
    if (!isAdmin) return;
    try {
      await api.delete(`/companies/${id}`, authHeaders);
      refresh();
    } catch (err) {
      window.alert(err.response?.data?.message || err.message);
    }
  };

  const saveStudent = async (payload) => {
    if (!isAdmin) return;
    const recordBatch = resolveRecordBatch(editStudent);
    if (editStudent) {
      await api.put(`/students/${editStudent.id}`, { ...payload, ...recordBatch }, authHeaders);
    } else {
      await api.post('/students', { ...payload, ...recordBatch }, authHeaders);
    }
    setShowStudentModal(false);
    setEditStudent(null);
    refresh();
  };

  const deleteStudentAction = async (id) => {
    if (!isAdmin) return;
    try {
      await api.delete(`/students/${id}`, authHeaders);
      refresh();
    } catch (err) {
      window.alert(err.response?.data?.message || err.message);
    }
  };

  const adminRoute = (element) => {
    if (sessionChecking) {
      return (
        <main className="container section-page admin-checking-page">
          <div className="card admin-settings-card">
            <span className="eyebrow">Admin session</span>
            <h2>Checking access</h2>
            <p className="subtext">Verifying your admin session before loading this page.</p>
          </div>
        </main>
      );
    }
    return isAdmin ? element : <Navigate to="/" replace />;
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

  return (
    <>
      <header className={[
        mobileHeaderHidden && !mobileNavOpen ? 'header-hidden' : '',
        mobileNavOpen ? 'header-nav-open' : '',
      ].filter(Boolean).join(' ')}>
        <div className="navbar">
          <div className="nav-brand-row">
            <Link to="/" className="nav-logo" onClick={closeMobileNav}>
              <span className="nav-wordmark">
                <strong>IIIT Delhi</strong>
                <small>Placement Dashboard</small>
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

          <div className="nav-scope">
            <label className="nav-scope-select">
              <span>Year</span>
              <select value={activeCycle.year} onChange={(event) => handleCycleChange(Number(event.target.value))}>
                {CYCLES.map((cycle) => <option key={cycle.year} value={cycle.year}>{cycle.year}</option>)}
              </select>
            </label>
            <label className="nav-scope-select">
              <span>Batch</span>
              <select value={activeBatch.key} onChange={(event) => handleBatchChange(event.target.value)}>
                {activeCycle.batches.length >= 2 && <option value={`cycle-${activeCycle.year}`}>Overall</option>}
                {activeCycle.batches.map((batch) => (
                  <option key={batch.key} value={batch.key}>{batch.degree}{batch.academic_year ? ` · ${batch.academic_year}` : ''}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="nav-user-row">
            <div className="nav-actions">
              <ThemeToggle themeMode={themeMode} onToggle={toggleThemeMode} compact />
              <button className="secondary nav-signout" title="End viewer session" onClick={() => { closeMobileNav(); handleGoogleLogout(); }}>Sign out</button>
              {isAdmin && <Link className="nav-admin-link" to="/admin/calendar" onClick={closeMobileNav}>Calendar</Link>}
              {isAdmin && <Link className="nav-admin-link" to="/admin" onClick={closeMobileNav}>Viewer Access</Link>}
            </div>
          </div>
        </div>
      </header>

      {loading && !isAdminRoute ? (
        <main className="container loading-main" aria-busy="true">
          <div className="skeleton-page" role="status" aria-label={`Loading ${activeBatch.label}`}>
            <div className="skeleton skeleton-eyebrow" />
            <div className="skeleton skeleton-title" />
            <div className="skeleton-ledger">
              {Array.from({ length: 4 }).map((_, index) => <div key={index} className="skeleton skeleton-tile" />)}
            </div>
            <div className="skeleton-cards">
              {Array.from({ length: 6 }).map((_, index) => <div key={index} className="skeleton skeleton-card" />)}
            </div>
            {error && <p className="loading-note">{error}</p>}
          </div>
        </main>
      ) : (
      <Routes>
        <Route
          path="/"
          element={(
            <main className="container dashboard-page">
              {dashboardViews.length > 1 && (
                <div className="dashboard-view-tabs" aria-label="Dashboard view">
                  {dashboardViews.map((view) => (
                    <button
                      key={view.key}
                      type="button"
                      className={dashboardView === view.key ? 'active' : ''}
                      aria-pressed={dashboardView === view.key}
                      onClick={() => setDashboardView(view.key)}
                    >
                      {view.label}
                    </button>
                  ))}
                </div>
              )}

              {dashboardView === 'overview' && (
                <>
              <section className="editorial-hero">
                <div className="editorial-hero-copy">
                  <h1>{isOverallScope ? `${activeBatch.graduation_year} placements` : `${activeBatch.degree} ${activeBatch.graduation_year}`}</h1>
                  <p className="hero-provenance"><span className="badge">{dataProvenance.label}</span>{dataProvenance.note}</p>
                  {error && <p className="hero-error">{error}</p>}
                  {dataUpdatedAt && <p className="data-updated-note" title={`Data as of ${formatDate(dataUpdatedAt)}`}>Updated {formatRelative(dataUpdatedAt)}</p>}
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

              <section className="metric-ledger overview-metric-ledger">
                {isAggregateOnly ? (
                  <>
                    <MetricTile label="Reported offers" value={stats.total_offers || 0} note={`Academic year ${activeBatch.academic_year}`} />
                    <MetricTile label="Companies with offers" value={stats.number_of_companies || 0} note="Positive offer count" />
                    <MetricTile label="Recruiters listed" value={stats.total_companies_listed || 0} note="Includes zero-offer rows" />
                  </>
                ) : isOfficial2025 ? (
                  <>
                    <MetricTile label="Official campus placement" value={`${OFFICIAL_2025.campus_placement_percentage}%`} note="Official figure" />
                    <MetricTile label="Companies visited" value={OFFICIAL_2025.companies} note="Official campus total" />
                    <MetricTile label="Total offers" value={OFFICIAL_2025.total_offers} note="Official offer count" />
                    <MetricTile label={`${activeBatch.degree} average`} value={`${official2025AverageLpa.toFixed(2)} LPA`} note="Official average" />
                  </>
                ) : isOfficial2026 ? (
                  <>
                    <MetricTile label="Official campus placement" value={`${OFFICIAL_2026.campus_placement_percentage.toFixed(2)}%`} note="College-published" />
                    <MetricTile label="Tracker companies" value={stats.number_of_companies ?? 0} note="Recorded on this site" />
                    <MetricTile label="Tracker offers" value={activeOverviewSummary.total_offers || 0} note="Recorded offer rows" />
                    <MetricTile label="Median CTC" value={formatInr(activeOverviewSummary.median_ctc, 'p.a.')} note="Tracker-derived" />
                  </>
                ) : (
                  <>
                    <MetricTile label={isPlacementRecordsOnly ? 'Recorded placed' : 'Placed students'} value={activeOverviewSummary.placed_students || 0} note={isPlacementRecordsOnly ? 'Source records only' : `${activeOverviewSummary.eligible_students || 0} eligible`} />
                    <MetricTile label="Companies" value={stats.number_of_companies ?? 0} note="Current cohort" />
                    <MetricTile label="Total offers" value={activeOverviewSummary.total_offers || 0} note="Recorded offer rows" />
                    <MetricTile label="Median CTC" value={formatInr(activeOverviewSummary.median_ctc, 'p.a.')} note="Tracker-derived" />
                  </>
                )}
              </section>

                </>
              )}

              {isAggregateOnly && dashboardView === 'overview' && (
                <section className="historical-overview">
                  <div className="section-intro">
                    <h2>Offer volume by recruiter</h2>
                    <p>Reported offers, not unique students. Zero-offer companies stay in the source total.</p>
                  </div>
                  <div className="historical-summary-grid">
                    <MetricTile label="Reported offers" value={stats.total_offers || 0} note={`Academic year ${activeBatch.academic_year}`} />
                    <MetricTile label="Companies with offers" value={stats.number_of_companies || 0} note="Positive offer count" />
                    <MetricTile label="Recruiters listed" value={stats.total_companies_listed || 0} note="Includes zero-offer rows" />
                  </div>
                  <article className="insight-panel historical-ranking">
                    <div className="panel-heading"><h2>Leading recruiters</h2></div>
                    <HorizontalBars items={companyVisuals.topOffers} />
                  </article>
                </section>
              )}

              {!isAggregateOnly && (
                <>
              {isOfficial2025 && dashboardView === 'official' && (
                <section className="official-placement-dashboard">
                  <aside className="official-data-note">
                    <span className="eyebrow">Official 2025 statistics</span>
                    <p>The uploaded files list placement outcomes, not the full eligible cohort, so every percentage and campus total below is the officially published 2025 figure.</p>
                  </aside>

                  <section className="metric-ledger official-metric-ledger">
                    <MetricTile label="Companies visited" value={OFFICIAL_2025.companies} note={`${OFFICIAL_2025.full_time_companies} full time · ${OFFICIAL_2025.summer_internship_companies} summer internship`} />
                    <MetricTile label="Total offers" value={OFFICIAL_2025.total_offers} note={`${OFFICIAL_2025.full_time_offers} full time · ${OFFICIAL_2025.internship_offers} internship`} />
                    <MetricTile label={`${activeBatch.degree} average`} value={`${official2025AverageLpa.toFixed(2)} LPA`} note={`Overall campus average ${OFFICIAL_2025.overall_average_lpa} LPA`} />
                    <MetricTile label="Highest overseas" value={`${OFFICIAL_2025.highest_overseas_lpa} LPA`} note={`${OFFICIAL_2025.overseas_offers} overseas offers`} />
                  </section>

                  <section className="insight-grid official-insight-grid">
                    <article className="insight-panel outcome-panel">
                      <div className="panel-heading"><h2>Offer composition</h2><span className="panel-number">{OFFICIAL_2025.total_offers}</span></div>
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
                      <div className="panel-heading"><h2>Official offer categories</h2></div>
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
                      <h2>{activeBatch.degree} placement outcomes</h2>
                      <p>Official 2025 figures, not calculations from uploaded records.</p>
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
              {isOfficial2026 && dashboardView === 'official' && (
                <section className="official-placement-dashboard official-2026-dashboard">
                  <aside className="official-data-note">
                    <span className="eyebrow">College-published statistics · 2026</span>
                    <p>Campus-wide figures published by the institute. They are not calculated from tracker records, so differences may reflect publication timing, coverage, or methodology.</p>
                  </aside>

                  <section className="metric-ledger official-metric-ledger">
                    <MetricTile label="Companies visited" value={OFFICIAL_2026.companies} note={`${OFFICIAL_2026.full_time_companies} full time · ${OFFICIAL_2026.summer_internship_companies} summer internship`} />
                    <MetricTile label="Total offers" value={OFFICIAL_2026.total_offers} note={`${OFFICIAL_2026.full_time_offers} full time · ${OFFICIAL_2026.internship_offers} summer internship`} />
                    <MetricTile label={`${activeBatch.degree} average`} value={`${official2026AverageLpa.toFixed(2)} LPA`} note={`Overall campus average ${OFFICIAL_2026.overall_average_lpa} LPA`} />
                    <MetricTile label="Campus placement" value={`${OFFICIAL_2026.campus_placement_percentage.toFixed(2)}%`} note="Official campus-wide percentage" />
                  </section>

                  <section className="insight-grid official-insight-grid">
                    <article className="insight-panel outcome-panel">
                      <div className="panel-heading"><h2>Official offer composition</h2><span className="panel-number">{OFFICIAL_2026.total_offers}</span></div>
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
                      <div className="panel-heading"><h2>Published offer categories</h2></div>
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
                      <h2>{activeBatch.degree} placement outcomes</h2>
                      <p>College-published percentages for the 2026 batch.</p>
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

                </section>
              )}
              {isOfficial2025 && dashboardView === 'tracker' && (
                <section className="dashboard-section record-reference-section">
                  <div className="section-intro">
                    <h2>Record-level references</h2>
                    <p>2025 rows are kept for lookup only; percentages come from official statistics.</p>
                  </div>
                  <div className="dashboard-jump-grid">
                    <Link to="/companies"><strong>Companies</strong><span>Recorded recruiters</span></Link>
                    <Link to="/students"><strong>Students</strong><span>Uploaded outcomes</span></Link>
                  </div>
                </section>
              )}
              {isPlacementRecordsOnly && !isOfficial2025 && dashboardView === 'tracker' && (
                <aside className="disclaimer-card">
                  <span className="eyebrow">Historical source scope</span>
                  <p>This source contains placement outcomes, not the full graduating roster. Counts and compensation are shown, but placement percentages and unplaced-student totals are intentionally not inferred.</p>
                  {stats.historical_reported_offers > 0 && <p>The same M.Tech 2025 view also includes the 2024-25 CSE aggregate: {stats.historical_reported_offers} reported offers across {stats.historical_recruiters} recruiters. These aggregate counts are labeled separately from student-linked offers.</p>}
                </aside>
              )}
              {!isOfficial2025 && (dashboardView === 'tracker' || dashboardView === 'programs' || dashboardView === 'compensation') && <section className="dashboard-control-row">
                <span className="eyebrow">Branch</span>
                <div className="filter-chip-row">
                  {dashboardBranchFilters.map((branchGroup) => (
                    <button key={branchGroup} type="button" className={dashboardBranchFilter === branchGroup ? 'filter-chip active' : 'filter-chip'} aria-pressed={dashboardBranchFilter === branchGroup} onClick={() => setDashboardBranchFilter(branchGroup)}>
                      {DASHBOARD_BRANCH_LABELS[branchGroup] || branchGroup}
                    </button>
                  ))}
                </div>
              </section>}

              {!isOfficial2025 && dashboardView === 'compensation' && <section className="metric-ledger comp-ledger">
                <MetricTile metricKey="highest_ctc" label="Highest CTC" value={formatInr(activeOverviewSummary.highest_ctc, 'p.a.')} note="Peak recorded package" />
                <MetricTile metricKey="median_ctc" label="Median CTC" value={formatInr(activeOverviewSummary.median_ctc, 'p.a.')} note="Middle of recorded offers" />
                <MetricTile metricKey="average_ctc" label="Average CTC" value={formatInr(activeOverviewSummary.average_ctc, 'p.a.')} note="Mean of recorded offers" />
                <MetricTile metricKey="median_stipend" label="Median stipend" value={formatInr(activeOverviewSummary.median_stipend, 'p.m.')} note="Middle of recorded stipends" />
                <MetricTile metricKey="average_stipend" label="Average stipend" value={formatInr(activeOverviewSummary.average_stipend, 'p.m.')} note="Across available stipend data" />
                <MetricTile metricKey="total_Aplus_offers" label="A+ offers" value={activeOverviewSummary.total_Aplus_offers || 0} note="Premium category outcomes" />
              </section>}

              {!isOfficial2025 && dashboardView === 'compensation' && (
                <section className="dashboard-section compensation-focus-section">
                  <article className="insight-panel compensation-panel">
                    <div className="panel-heading"><h2>CTC distribution</h2><small>Offers by band</small></div>
                    <HorizontalBars items={dashboardVisuals.compensationBands} />
                  </article>
                </section>
              )}

              {!isOfficial2025 && dashboardView === 'tracker' && <section className="insight-grid tracker-insight-grid">
                <article className="insight-panel outcome-panel">
                  <div className="panel-heading">
                    <h2>{isPlacementRecordsOnly ? 'Recorded placed students' : 'Cohort status'}</h2>
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
                  <div className="panel-heading"><h2>Category mix</h2></div>
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

              </section>}

              {!isPlacementRecordsOnly && dashboardView === 'programs' && <section className="dashboard-section branch-section">
                <div className="section-intro">
                  <h2>Program comparison</h2>
                  <p>Offer counts can exceed placed students where multiple offers are recorded.</p>
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

              {!isOfficial2025 && dashboardView === 'programs' && <section className="dashboard-section program-section">
                <div className="section-intro">
                  <h2>Program detail</h2>
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

              {!isOfficial2025 && dashboardView === 'recent' && <section className="dashboard-section recent-section">
                <div className="section-intro"><h2>Latest offer dates</h2><Link className="text-link" to="/companies">All companies →</Link></div>
                <div className="recent-company-list">
                  {dashboardVisuals.recentCompanies.map((company, index) => (
                    <button key={company.id} type="button" onClick={() => { openCompanyDetail(company); navigate(`/companies?batch=${activeBatch.key}&company=${company.id}`); }}>
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
                <p>Unofficial side project, not verified by the Placement Office. Report discrepancies to yash25091@iiitd.ac.in.</p>
                <Link to="/admin">Administrative access</Link>
              </aside>
            </main>
          )}
        />

        <Route
          path="/companies"
          element={(
            <main className="container section-page companies-page">
              {error && <p className="page-alert" role="alert">{error}</p>}
              <section className="directory-hero">
                <div className="directory-hero-copy">
                  <h1>Companies</h1>
                  <p>{activeBatch.label}</p>
                  {!isAdmin && !isAggregateOnly && <p className="directory-scope-note">Only companies with recorded hiring outcomes for this cohort are listed.</p>}
                </div>
                <div className="directory-hero-stats">
                  <MetricTile label="Visible companies" value={companyOverview.total} note={companyOverview.activeTypes} />
                  <MetricTile label={isAggregateOnly ? 'Reported offers' : 'Tracked hires'} value={companyOverview.trackedHires} note="Across current filters" />
                  <MetricTile label={isAggregateOnly ? 'Data scope' : 'A+ recruiters'} value={isAggregateOnly ? 'CSE' : companyOverview.spotlight} note={isAggregateOnly ? activeBatch.academic_year : 'Premium category'} />
                </div>
              </section>

              <MobileDisclosure summary="Recruiter insights" className="insight-disclosure" contentClassName="directory-insights">
                {isAggregateOnly ? (
                  <div style={{ gridColumn: 'span 2' }}><HorizontalBars items={companyVisuals.topOffers.slice(0, 5)} /></div>
                ) : (
                  <><SegmentedBar label="Company categories" items={companyVisuals.categories} /><HorizontalBars items={companyVisuals.types} /></>
                )}
              </MobileDisclosure>

              <section className={isAggregateOnly ? 'directory-toolbar aggregate-directory-toolbar' : 'directory-toolbar'}>
                <input
                  type="search"
                  className="search-input"
                  aria-label="Search companies by name"
                  placeholder="Search companies by name"
                  value={companySearch}
                  onChange={(e) => setCompanySearch(e.target.value)}
                />
                <MobileDisclosure
                  summary={`Filters & sort${Object.values(companyFilters).filter(Boolean).length ? ` · ${Object.values(companyFilters).filter(Boolean).length} active` : ''}`}
                  className="toolbar-disclosure"
                  contentClassName="toolbar-controls"
                >
                  {!isAggregateOnly && <label className="filter-group">
                    <span>Opportunity</span>
                    <select value={companyFilters.type} onChange={(e) => setCompanyFilters((f) => ({ ...f, type: e.target.value }))}>
                      <option value="">All</option>
                      {OFFER_TYPES.map((type) => <option key={type} value={type}>{type} ({companyFilterCounts.types[type] || 0})</option>)}
                    </select>
                  </label>}
                  {!isAggregateOnly && <label className="filter-group">
                    <span>Category</span>
                    <select value={companyFilters.category} onChange={(e) => setCompanyFilters((f) => ({ ...f, category: e.target.value }))}>
                      <option value="">All</option>
                      <option value="A+">A+ ({companyFilterCounts.categories['A+'] || 0})</option>
                      <option value="A">A ({companyFilterCounts.categories.A || 0})</option>
                      <option value="B">B ({companyFilterCounts.categories.B || 0})</option>
                    </select>
                  </label>}
                  {!isAggregateOnly && <label className="filter-group">
                    <span>Hiring branch</span>
                    <select value={companyFilters.branchGroup} onChange={(e) => setCompanyFilters((f) => ({ ...f, branchGroup: e.target.value }))}>
                      <option value="">All</option>
                      <option value="CSE">CSE ({companyFilterCounts.branches.CSE || 0})</option>
                      <option value="ECE">ECE ({companyFilterCounts.branches.ECE || 0})</option>
                      <option value="CB">CB ({companyFilterCounts.branches.CB || 0})</option>
                    </select>
                  </label>}
                  <label className="sort-control">Sort
                    <select value={companySort.field} onChange={(event) => setCompanySort({ field: event.target.value, asc: event.target.value === 'name' })}>
                      <option value="name">Company name</option><option value="ctc">Highest CTC</option><option value="stipend">Highest stipend</option><option value="totalHired">Most hires</option><option value="offer_date">Latest offer date</option>
                    </select>
                  </label>
                  {(companySearch || Object.values(companyFilters).some(Boolean)) && <button type="button" className="secondary clear-filters-button" onClick={() => { setCompanySearch(''); setCompanyFilters(DEFAULT_COMPANY_FILTERS); }}>Clear filters</button>}
                  {isAdmin && <button onClick={() => { setEditCompany(null); setShowCompanyModal(true); }}>Add company</button>}
                </MobileDisclosure>
              </section>

              {(companyFilters.type || companyFilters.category || companyFilters.branchGroup) && (
                <div className="applied-filter-row" aria-label="Active filters">
                  {companyFilters.type && <button type="button" className="applied-chip" aria-label={`Remove filter ${companyFilters.type}`} onClick={() => setCompanyFilters((f) => ({ ...f, type: '' }))}>{companyFilters.type}<span aria-hidden="true">×</span></button>}
                  {companyFilters.category && <button type="button" className="applied-chip" aria-label={`Remove category ${companyFilters.category}`} onClick={() => setCompanyFilters((f) => ({ ...f, category: '' }))}>Category {companyFilters.category}<span aria-hidden="true">×</span></button>}
                  {companyFilters.branchGroup && <button type="button" className="applied-chip" aria-label={`Remove hiring branch ${companyFilters.branchGroup}`} onClick={() => setCompanyFilters((f) => ({ ...f, branchGroup: '' }))}>{companyFilters.branchGroup} hiring<span aria-hidden="true">×</span></button>}
                </div>
              )}

              <div className="directory-result-heading">
                <div><h2>{filteredCompanies.length} companies</h2>{dataUpdatedAt && <span className="data-updated-note" title={`Data as of ${formatDate(dataUpdatedAt)}`}>Updated {formatRelative(dataUpdatedAt)}</span>}</div>
                <div className="result-actions">
                  <div className="view-toggle" aria-label="Company view mode">
                    <button type="button" className={companyView === 'cards' ? 'active' : ''} aria-pressed={companyView === 'cards'} onClick={() => setCompanyView('cards')}>Cards</button>
                    <button type="button" className={companyView === 'table' ? 'active' : ''} aria-pressed={companyView === 'table'} onClick={() => setCompanyView('table')}>Table</button>
                  </div>
                  <button type="button" className="text-button" onClick={() => setCompanySort((current) => ({ ...current, asc: !current.asc }))}>{companySort.asc ? 'Ascending' : 'Descending'} <SortIcon field={companySort.field} current={companySort} /></button>
                </div>
              </div>

              {companyView === 'table' ? (
                <section className="directory-table-wrap" aria-label="Company comparison table">
                  <table className="directory-table">
                    <thead>
                      <tr>
                        <th>Company</th>
                        <th>Role</th>
                        <th>Type</th>
                        <th>Category</th>
                        <th>CTC</th>
                        <th>Stipend</th>
                        <th>Hires</th>
                        <th>Offer date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCompanies.map((company) => {
                        const hiring = companyHiringStats[company.id] || { total: 0, reported: 0 };
                        return (
                          <tr key={company.id}>
                            <td><button type="button" className="table-open-button" onClick={() => openCompanyDetail(company)}>{company.name}</button></td>
                            <td>{company.role || '—'}</td>
                            <td>{company.type || '—'}</td>
                            <td><span className={`category-badge category-${String(company.category || 'other').toLowerCase().replace('+', 'plus')}`}>{company.category || '—'}</span></td>
                            <td>{formatInr(company.ctc, 'p.a.')}</td>
                            <td>{formatInr(company.stipend, 'p.m.')}</td>
                            <td>{isAggregateOnly ? (hiring.reported || 0) : (hiring.total || hiring.reported || 0)}</td>
                            <td>{formatDate(company.offer_date)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {!filteredCompanies.length && <div className="empty-directory-state"><h3>No companies found.</h3><p>{companySearch || Object.values(companyFilters).some(Boolean) ? 'No company matches the active filters.' : 'No company records are available for this cohort yet.'}</p>{(companySearch || Object.values(companyFilters).some(Boolean)) && <button type="button" className="secondary" onClick={() => { setCompanySearch(''); setCompanyFilters(DEFAULT_COMPANY_FILTERS); }}>Clear filters</button>}</div>}
                </section>
              ) : (
              <section className="company-card-grid">
                {filteredCompanies.map((company) => {
                  const hiring = companyHiringStats[company.id] || { total: 0, reported: 0, CSE: 0, ECE: 0, CB: 0 };
                  const showReportedAggregate = !isAggregateOnly && hiring.reported > 0;
                  const categoryClass = String(company.category || 'other').toLowerCase().replace('+', 'plus');
                  const reportedOnly = isAggregateOnly || (!hiring.total && hiring.reported);
                  return (
                    <article key={company.id} className={`company-card company-card-${categoryClass}`}>
                      <button type="button" className="company-card-main" onClick={() => openCompanyDetail(company)}>
                        <div className={`company-monogram company-monogram-${categoryClass}`}>{initialsFor(company.name)}</div>
                        <div className="company-card-copy">
                          <h3>{company.name}</h3>
                          <p>{company.role || (isAggregateOnly ? 'M.Tech CSE' : 'Role not recorded')}</p>
                        </div>
                        <span className="company-card-tags">
                          {!isAggregateOnly && <span className={`category-badge category-${categoryClass}`}>{company.category || '—'}</span>}
                          <span className="company-card-type">{isAggregateOnly ? activeBatch.academic_year : company.type || 'Opportunity'}</span>
                        </span>
                      </button>
                      <dl className="company-card-facts">
                        {isAggregateOnly ? (
                          <>
                            <div><dt>Reported offers</dt><dd>{company.reported_offer_count || 0}</dd></div>
                            <div><dt>Scope</dt><dd>M.Tech CSE</dd></div>
                          </>
                        ) : (
                          <>
                            <div><dt>CTC</dt><dd>{formatInr(company.ctc, 'p.a.')}</dd></div>
                            <div><dt>Stipend</dt><dd>{formatInr(company.stipend, 'p.m.')}</dd></div>
                            <div><dt>Eligibility</dt><dd>{company.eligible_cgpa ? `${company.eligible_cgpa} CGPA` : 'Not listed'}</dd></div>
                            <div><dt>{reportedOnly ? 'Reported offers' : 'Hires'}</dt><dd>{reportedOnly ? hiring.reported : hiring.total}</dd></div>
                          </>
                        )}
                      </dl>
                      {!isAggregateOnly && (hiring.total > 0 || showReportedAggregate) && (
                        <div className="company-card-branches">
                          {showReportedAggregate && <span>CSE {hiring.reported} reported</span>}
                          {['CSE', 'ECE', 'CB'].filter((branch) => hiring[branch] > 0).map((branch) => <span key={branch}>{branch} {hiring[branch]}</span>)}
                        </div>
                      )}
                      {isAdmin && <div className="card-admin-actions"><button className="secondary" onClick={() => { setEditCompany(company); setShowCompanyModal(true); }}>Edit</button><button className="danger-button" onClick={() => deleteCompanyAction(company.id)}>Delete</button></div>}
                    </article>
                  );
                })}
                {!filteredCompanies.length && <div className="empty-directory-state"><h3>No companies found.</h3><p>{companySearch || Object.values(companyFilters).some(Boolean) ? 'No company matches the active filters.' : 'No company records are available for this cohort yet.'}</p>{(companySearch || Object.values(companyFilters).some(Boolean)) && <button type="button" className="secondary" onClick={() => { setCompanySearch(''); setCompanyFilters(DEFAULT_COMPANY_FILTERS); }}>Clear filters</button>}</div>}
              </section>
              )}

              {/* Add/Edit Company Modal */}
              <Modal open={showCompanyModal} onClose={() => setShowCompanyModal(false)} label={editCompany ? 'Edit company' : 'Add company'}>
                <h3>{editCompany ? 'Edit Company' : 'Add Company'}</h3>
                <CompanyForm
                  initial={editCompany || {}}
                  onSubmit={saveCompany}
                  onCancel={() => setShowCompanyModal(false)}
                />
              </Modal>

              {/* Company Detail Modal */}
              <Modal open={!!selectedCompany} onClose={closeCompanyDetail} label={selectedCompany ? `${selectedCompany.name} details` : 'Company details'}>
                {selectedCompany && (() => {
                  const stats = companyHiringStats[selectedCompany.id] || { total: 0, reported: 0, CSE: 0, ECE: 0, CB: 0, OTHER: 0, students: [] };
                  return (
                    <div className="company-detail">
                      <div className="detail-hero-row">
                        <span className={`company-monogram company-monogram-large company-monogram-${String(selectedCompany.category || 'other').toLowerCase().replace('+', 'plus')}`}>{initialsFor(selectedCompany.name)}</span>
                        <div>
                          <span className="detail-kicker">
                            <span className="eyebrow">{selectedCompany.type || 'Opportunity'}</span>
                            <span className={`category-badge category-${String(selectedCompany.category || 'other').toLowerCase().replace('+', 'plus')}`}>{selectedCompany.category || '—'}</span>
                          </span>
                          <h2>{selectedCompany.name}</h2>
                          <p>{selectedCompany.role || 'Role details not recorded'}</p>
                        </div>
                      </div>
                      <div className="detail-action-row">
                        <button type="button" className="secondary" onClick={() => moveSelectedCompany(-1)} disabled={filteredCompanies.length < 2}>Previous</button>
                        <button type="button" className="secondary" onClick={() => moveSelectedCompany(1)} disabled={filteredCompanies.length < 2}>Next</button>
                        <button type="button" className="secondary" onClick={copyCurrentLink}>Copy link</button>
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
                          <div className="label">Registration opens</div>
                          <div className="value">{formatDate(selectedCompany.registration_open_date)}</div>
                        </div>
                        <div className="info-item">
                          <div className="label">Offer date</div>
                          <div className="value">{formatDate(selectedCompany.offer_date)}</div>
                        </div>
                        {selectedCompany.branches?.length > 0 && (
                          <div className="info-item">
                            <div className="label">Recruiting branches</div>
                            <div className="value">{selectedCompany.branches.map(formatBranchToken).join(', ')}</div>
                          </div>
                        )}
                        {stats.reported > 0 && <div className="info-item">
                          <div className="label">Reported CSE offers</div>
                          <div className="value">{stats.reported}</div>
                        </div>}
                          </>
                        )}
                      </div>

                      {selectedCompany.roles?.length > 0 && (
                        <>
                          <h3 className="detail-section-title">Roles &amp; packages</h3>
                          <div className="info-grid">
                            {selectedCompany.roles.map((pkg, i) => (
                              <div className="info-item" key={i}>
                                <div className="label">{pkg.role || pkg.offer_type || 'Role'}{pkg.degree && pkg.degree !== 'All' ? ` · ${pkg.degree}` : ''}</div>
                                <div className="value">{[pkg.offer_type, pkg.ctc ? formatInr(pkg.ctc, 'p.a.') : null, pkg.stipend ? formatInr(pkg.stipend, 'p.m.') : null].filter(Boolean).join(' · ') || '—'}</div>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
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
                              <div key={`${student.roll}-${index}`}>
                                <span className="student-avatar">{initialsFor(student.name)}</span>
                                <div><strong>{student.name}</strong><small>{student.roll} · {student.program}{student.offer?.offer_type ? ` · ${student.offer.offer_type}` : ''}</small></div>
                                {isAdmin && <ConvertToPpo offer={student.offer} onConvert={convertOfferToPpoAction} />}
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                      {isAdmin && !isAggregateOnly && (
                        <div className="company-add-offer" style={{ marginTop: 16, borderTop: '1px solid var(--border, #d8d8e0)', paddingTop: 12 }}>
                          <h3 className="detail-section-title">Add offer</h3>
                          <p style={{ fontSize: '0.85rem', opacity: 0.75, margin: '0 0 8px' }}>Search a student in the {activeCycle.year} cycle by name or roll number, then attach this company's offer.</p>
                          <input type="text" placeholder="Search name or roll number…" value={offerSearch} onChange={(e) => { setOfferSearch(e.target.value); setOfferStudentId(''); }} style={{ width: '100%' }} />
                          {offerSearch.trim() && !offerStudentId && (
                            <div className="offer-candidate-list" style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6, maxHeight: 220, overflowY: 'auto' }}>
                              {offerCandidates.length ? offerCandidates.map((s) => (
                                <button key={s.id} type="button" className="secondary" style={{ justifyContent: 'flex-start', textAlign: 'left' }} onClick={() => { setOfferStudentId(String(s.id)); setOfferSearch(`${s.name} · ${s.roll_number}`); }}>
                                  {s.name} · {s.roll_number}{s.degree ? ` · ${s.degree}` : ''}{s.program ? ` ${s.program}` : ''}
                                </button>
                              )) : <span style={{ fontSize: '0.85rem', opacity: 0.7 }}>No matching students in this cycle.</span>}
                            </div>
                          )}
                          {offerStudentId && (
                            <div style={{ marginTop: 8 }}>
                              {offerPackages.length > 0 && (
                                <div className="flex-row" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                                  <span style={{ fontSize: '0.85rem', opacity: 0.7, alignSelf: 'center' }}>Quick-fill package:</span>
                                  {offerPackages.map((pkg, i) => (
                                    <button key={i} type="button" className="secondary" onClick={() => applyOfferPackage(pkg)}>
                                      {(pkg.role || pkg.offer_type || 'Role')}{pkg.degree && pkg.degree !== 'All' ? ` · ${pkg.degree}` : ''}{pkg.ctc ? ` · ${formatInr(pkg.ctc, 'p.a.')}` : pkg.stipend ? ` · ${formatInr(pkg.stipend, 'p.m.')}` : ''}
                                    </button>
                                  ))}
                                </div>
                              )}
                              <div className="flex-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                                <label>
                                  Role
                                  <input value={offerRole} onChange={(e) => setOfferRole(e.target.value)} placeholder={selectedCompany.role || 'Role'} />
                                </label>
                                <label>
                                  Offer type
                                  <select value={offerType || selectedCompany.type || ''} onChange={(e) => setOfferType(e.target.value)}>
                                    {OFFER_TYPES.map((t) => <option key={t}>{t}</option>)}
                                  </select>
                                </label>
                                <label>
                                  CTC (₹ p.a.)
                                  <input type="number" min="0" step="any" value={offerCtc} onChange={(e) => setOfferCtc(e.target.value)} />
                                </label>
                                <label>
                                  Stipend (₹ p.m.)
                                  <input type="number" min="0" step="any" value={offerStipend} onChange={(e) => setOfferStipend(e.target.value)} />
                                </label>
                                <button type="button" onClick={addCompanyOffer} disabled={offerBusy}>{offerBusy ? 'Adding…' : 'Add offer'}</button>
                                <button type="button" className="secondary" onClick={resetOfferForm}>Clear</button>
                              </div>
                            </div>
                          )}
                          {offerError && <p style={{ color: 'var(--danger, #c0392b)', fontSize: '0.85rem', marginTop: 6 }}>{offerError}</p>}
                        </div>
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
                    <h1>No student records</h1>
                    <p>{activeBatch.label} is a company-level aggregate: names, rolls, rates, and compensation were not in the source.</p>
                    <div className="hero-actions"><Link className="primary-link" to="/companies">View reported offers</Link><Link className="text-link" to="/">Return to overview</Link></div>
                  </div>
                </section>
              </main>
            ) : (
              <main className="container section-page students-page">
              {error && <p className="page-alert" role="alert">{error}</p>}
              <section className="directory-hero student-directory-hero">
                <div className="directory-hero-copy">
                  <h1>Students</h1>
                  <p>{activeBatch.label} · {studentOverview.total} records across {studentOverview.programs} programs</p>
                </div>
                <div className="student-hero-outcome">
                  <DonutChart value={studentOverview.placed} total={studentOverview.eligible} label="Visible placement rate" detail={`${studentOverview.placed} placed`} />
                </div>
              </section>

              <MobileDisclosure summary="Selection overview" className="insight-disclosure" contentClassName="student-status-overview">
                <SegmentedBar label="Placement status" items={studentVisuals.statuses} />
                <HorizontalBars items={studentVisuals.programs} />
              </MobileDisclosure>

              <section className="directory-toolbar student-toolbar">
                <input
                  type="search"
                  className="search-input"
                  aria-label="Search students by name or roll number"
                  placeholder="Search by student name or roll number"
                  value={studentSearch}
                  onChange={(e) => setStudentSearch(e.target.value)}
                />
                <MobileDisclosure
                  summary={`Filters & sort${[studentFilters.branchGroup, studentFilters.status, studentFilters.offerType, ...studentFilters.programs].filter(Boolean).length ? ` · ${[studentFilters.branchGroup, studentFilters.status, studentFilters.offerType, ...studentFilters.programs].filter(Boolean).length} active` : ''}`}
                  className="toolbar-disclosure"
                  contentClassName="toolbar-controls"
                >
                  <label className="filter-group">
                    <span>Branch group</span>
                    <select value={studentFilters.branchGroup} onChange={(e) => setStudentFilters((f) => ({ ...f, branchGroup: e.target.value }))}>
                      <option value="">All</option>
                      <option value="CSE">CSE ({studentFilterCounts.branches.CSE || 0})</option>
                      <option value="ECE">ECE ({studentFilterCounts.branches.ECE || 0})</option>
                      <option value="CB">CB ({studentFilterCounts.branches.CB || 0})</option>
                    </select>
                  </label>
                  <label className="filter-group">
                    <span>Status</span>
                    <select value={studentFilters.status} onChange={(e) => setStudentFilters((f) => ({ ...f, status: e.target.value }))}>
                      <option value="">All</option>
                      {STUDENT_STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status}>{status} ({studentFilterCounts.statuses[status] || 0})</option>
                      ))}
                    </select>
                  </label>
                  <label className="filter-group">
                    <span>Offer type</span>
                    <select value={studentFilters.offerType} onChange={(e) => setStudentFilters((f) => ({ ...f, offerType: e.target.value }))}>
                      <option value="">All</option>
                      {OFFER_TYPES.map((type) => <option key={type} value={type}>{type} ({studentFilterCounts.offerTypes[type] || 0})</option>)}
                    </select>
                  </label>
                  <label className="sort-control">Sort by
                    <select value={studentSort.field} onChange={(event) => { const field = event.target.value; setStudentSort({ field, asc: field === 'name' || field === 'roll_number' }); }}>
                      <option value="roll_number">Roll number</option><option value="name">Name</option><option value="ctc">Highest CTC</option><option value="stipend">Highest stipend</option><option value="offer_date">Latest offer</option>
                    </select>
                  </label>
                  {(studentSearch || studentFilters.branchGroup || studentFilters.status || studentFilters.offerType || studentFilters.programs.length > 0) && <button type="button" className="secondary clear-filters-button" onClick={() => { setStudentSearch(''); setStudentFilters(DEFAULT_STUDENT_FILTERS); }}>Clear filters</button>}
                  {isAdmin && (isOverallScope
                    ? <span className="subtext add-scope-hint" title="The Overall view spans both degrees">Switch to a specific batch (B.Tech / M.Tech) to add a student</span>
                    : <button onClick={() => { setEditStudent(null); setShowStudentModal(true); }}>Add student</button>)}
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
                          aria-pressed={isSelected}
                          onClick={() => toggleProgramFilter(program)}
                        >
                          {program} <span className="chip-count">{studentFilterCounts.programs[program] || 0}</span>
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

              {(studentFilters.branchGroup || studentFilters.status || studentFilters.offerType || studentFilters.programs.length > 0) && (
                <div className="applied-filter-row" aria-label="Active filters">
                  {studentFilters.branchGroup && <button type="button" className="applied-chip" aria-label={`Remove branch ${studentFilters.branchGroup}`} onClick={() => setStudentFilters((f) => ({ ...f, branchGroup: '' }))}>{studentFilters.branchGroup}<span aria-hidden="true">×</span></button>}
                  {studentFilters.status && <button type="button" className="applied-chip" aria-label={`Remove status ${studentFilters.status}`} onClick={() => setStudentFilters((f) => ({ ...f, status: '' }))}>{studentFilters.status}<span aria-hidden="true">×</span></button>}
                  {studentFilters.offerType && <button type="button" className="applied-chip" aria-label={`Remove offer type ${studentFilters.offerType}`} onClick={() => setStudentFilters((f) => ({ ...f, offerType: '' }))}>{studentFilters.offerType}<span aria-hidden="true">×</span></button>}
                  {studentFilters.programs.map((program) => <button key={program} type="button" className="applied-chip" aria-label={`Remove program ${program}`} onClick={() => toggleProgramFilter(program)}>{program}<span aria-hidden="true">×</span></button>)}
                </div>
              )}

              <div className="directory-result-heading student-result-heading">
                <div><h2>{filteredStudents.length} students</h2>{dataUpdatedAt && <span className="data-updated-note" title={`Data as of ${formatDate(dataUpdatedAt)}`}>Updated {formatRelative(dataUpdatedAt)}</span>}</div>
                <div className="result-actions">
                  <div className="view-toggle" aria-label="Student view mode">
                    <button type="button" className={studentView === 'cards' ? 'active' : ''} aria-pressed={studentView === 'cards'} onClick={() => setStudentView('cards')}>List</button>
                    <button type="button" className={studentView === 'table' ? 'active' : ''} aria-pressed={studentView === 'table'} onClick={() => setStudentView('table')}>Table</button>
                  </div>
                  <button type="button" className="text-button" onClick={() => setStudentSort((current) => ({ ...current, asc: !current.asc }))}>{studentSort.asc ? 'Ascending' : 'Descending'} <SortIcon field={studentSort.field} current={studentSort} /></button>
                </div>
              </div>

              {studentView === 'table' ? (
                <section className="directory-table-wrap" aria-label="Student comparison table">
                  <table className="directory-table">
                    <thead>
                      <tr>
                        <th>Student</th>
                        <th>Roll</th>
                        <th>Program</th>
                        <th>Status</th>
                        <th>Company</th>
                        <th>Offer type</th>
                        <th>Best CTC</th>
                        <th>Latest offer</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredStudents.map((student) => {
                        const offers = getStudentOffers(student);
                        const highestCtc = Math.max(...offers.map((offer) => Number(offer.ctc ?? offer.company_ctc) || 0), 0);
                        const latestOffer = offers.map((offer) => offer.offer_date || offer.company_offer_date).filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0];
                        const companyNames = offers.map((offer) => offer.company_name).filter(Boolean);
                        return (
                          <tr key={student.id}>
                            <td><button type="button" className="table-open-button" onClick={() => openStudentDetail(student)}>{student.name}</button></td>
                            <td>{student.roll_number}</td>
                            <td>{student.program}</td>
                            <td><StatusPill status={student.placement_status} /></td>
                            <td>{companyNames.length ? companyNames.slice(0, 2).join(' · ') : '—'}</td>
                            <td>{offers.map((offer) => offer.offer_type).filter(Boolean).join(' · ') || '—'}</td>
                            <td>{formatInr(highestCtc || null, 'p.a.')}</td>
                            <td>{formatDate(latestOffer)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {!filteredStudents.length && <div className="empty-directory-state"><h3>No student records found.</h3><p>{studentSearch || studentFilters.branchGroup || studentFilters.status || studentFilters.offerType || studentFilters.programs.length > 0 ? 'No student matches the active filters.' : 'No student records are available for this cohort yet.'}</p>{(studentSearch || studentFilters.branchGroup || studentFilters.status || studentFilters.offerType || studentFilters.programs.length > 0) && <button type="button" className="secondary" onClick={() => { setStudentSearch(''); setStudentFilters(DEFAULT_STUDENT_FILTERS); }}>Clear filters</button>}</div>}
                </section>
              ) : (
              <section className="student-directory-list">
                {filteredStudents.map((student) => {
                  const offers = getStudentOffers(student);
                  const highestCtc = Math.max(...offers.map((offer) => Number(offer.ctc ?? offer.company_ctc) || 0), 0);
                  const companyNames = offers.map((offer) => offer.company_name).filter(Boolean);
                  const latestOffer = offers.map((offer) => offer.offer_date || offer.company_offer_date).filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0];
                  const statusClass = String(student.placement_status || 'unknown').toLowerCase().replace(/\s+/g, '-');
                  return (
                    <article key={student.id} className={`student-profile-row student-profile-${statusClass}`}>
                      <button type="button" className="student-profile-main" onClick={() => openStudentDetail(student)}>
                        <span className="student-avatar">{initialsFor(student.name)}</span>
                        <span className="student-identity"><strong>{student.name}</strong><small>{student.roll_number} · {student.program}</small></span>
                        <StatusPill status={student.placement_status} />
                      </button>
                      <div className="student-offer-summary">
                        {companyNames.length ? (
                          <><span className="offer-company-stack">{companyNames.slice(0, 2).join(' · ')}{companyNames.length > 2 ? ` +${companyNames.length - 2}` : ''}</span><small>{[offers.map((offer) => offer.offer_type).filter(Boolean).join(' · '), latestOffer ? formatDate(latestOffer) : null].filter(Boolean).join(' · ')}</small></>
                        ) : <span className="no-offer-copy">No recorded offer yet</span>}
                      </div>
                      <div className="student-compensation"><span>Best CTC</span><strong>{formatInr(highestCtc || null, 'p.a.')}</strong></div>
                      <button type="button" className="row-open-button" aria-label={`Open ${student.name}`} onClick={() => openStudentDetail(student)}>→</button>
                      {isAdmin && <div className="row-admin-actions"><button className="secondary" onClick={() => { setEditStudent(student); setShowStudentModal(true); }}>Edit</button><button className="danger-button" onClick={() => deleteStudentAction(student.id)}>Delete</button></div>}
                    </article>
                  );
                })}
                {!filteredStudents.length && <div className="empty-directory-state"><h3>No student records found.</h3><p>{studentSearch || studentFilters.branchGroup || studentFilters.status || studentFilters.offerType || studentFilters.programs.length > 0 ? 'No student matches the active filters.' : 'No student records are available for this cohort yet.'}</p>{(studentSearch || studentFilters.branchGroup || studentFilters.status || studentFilters.offerType || studentFilters.programs.length > 0) && <button type="button" className="secondary" onClick={() => { setStudentSearch(''); setStudentFilters(DEFAULT_STUDENT_FILTERS); }}>Clear filters</button>}</div>}
              </section>
              )}

              <Modal open={showStudentModal} onClose={() => setShowStudentModal(false)} label={editStudent ? 'Edit student' : 'Add student'}>
                <h3>{editStudent ? 'Edit Student' : 'Add Student'}</h3>
                <StudentForm
                  initial={editStudent || {}}
                  companies={companies}
                  onSubmit={saveStudent}
                  onCancel={() => setShowStudentModal(false)}
                />
              </Modal>

              <Modal open={!!selectedStudent} onClose={closeStudentDetail} label={selectedStudent ? `${selectedStudent.name} details` : 'Student details'}>
                {selectedStudent && (() => {
                  const offers = getStudentOffers(selectedStudent);
                  return (
                    <div className="student-detail">
                      <div className="detail-hero-row">
                        <span className="student-avatar student-avatar-large">{initialsFor(selectedStudent.name)}</span>
                        <div><span className="eyebrow">{selectedStudent.roll_number} · {selectedStudent.program}</span><h2>{selectedStudent.name}</h2><StatusPill status={selectedStudent.placement_status} /></div>
                      </div>
                      <div className="detail-action-row">
                        <button type="button" className="secondary" onClick={() => moveSelectedStudent(-1)} disabled={filteredStudents.length < 2}>Previous</button>
                        <button type="button" className="secondary" onClick={() => moveSelectedStudent(1)} disabled={filteredStudents.length < 2}>Next</button>
                        <button type="button" className="secondary" onClick={copyCurrentLink}>Copy link</button>
                      </div>
                      <div className="offer-timeline">
                        {offers.length ? offers.map((offer, index) => (
                          <article key={offer.id || index}>
                            <span className="timeline-marker">{String(index + 1).padStart(2, '0')}</span>
                            <div>
                              <span className="eyebrow">{offer.offer_type || 'Offer'} · {formatDate(offer.offer_date)}</span><h3>{offer.company_name || selectedStudent.company_name || 'Company not recorded'}</h3><p>{formatInr(offer.ctc ?? offer.company_ctc, 'p.a.')} · {formatInr(offer.stipend ?? offer.company_stipend, 'p.m.')}</p>
                              {isAdmin && <ConvertToPpo offer={offer} onConvert={convertOfferToPpoAction} />}
                            </div>
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
          element={adminRoute(<ViewerAccessSettings authHeaders={authHeaders} />)}
        />
        <Route
          path="/admin/calendar"
          element={adminRoute(
            <Suspense fallback={<main className="container section-page"><div className="card">Loading calendar admin…</div></main>}>
              <PlacementCalendarAdmin authHeaders={authHeaders} />
            </Suspense>
          )}
        />
      </Routes>
      )}
    </>
  );
};

export default App;
