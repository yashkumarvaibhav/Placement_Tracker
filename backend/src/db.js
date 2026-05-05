
import { createClient } from '@supabase/supabase-js';
import {
    DEFAULT_BATCH_KEY,
    getBatchConfig,
    getBranchGroup,
    normalizeBatchPayload,
} from './batches.js';

// --- CONFIGURATION ---
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://bqldotdtsodmfmnxwavl.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
let pgImplPromise = null;

if (!SUPABASE_KEY) {
    console.error('[DB] CRITICAL: SUPABASE_SERVICE_ROLE_KEY is missing!');
    console.error('[DB] Falling back to direct Postgres mode for local development.');
}

const supabase = SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
    }
}) : null;

const ADMIN_TOKEN = 'admin-static-token';

if (supabase) {
    console.log(`[DB] Using Supabase HTTP API at ${SUPABASE_URL}`);
}

const getPgImpl = async () => {
    if (!pgImplPromise) pgImplPromise = import('./db.pg.js');
    return pgImplPromise;
};

const applyBatchFilter = (query, batchKey = DEFAULT_BATCH_KEY) => {
    const resolvedBatch = getBatchConfig(batchKey);
    return query.eq('batch_key', resolvedBatch.key);
};

// --- HELPER: ERROR CHECK ---
const checkError = (error, context) => {
    if (error) {
        console.error(`[DB] Error in ${context}:`, error.message, error.details || '');
        throw new Error(`Database Error: ${error.message}`);
    }
};

// --- HELPER: TRANSFORMERS ---
// The old Postgres queries returned flattened joins (e.g. company_name).
// Supabase returns nested objects (e.g. companies: { name }).
// We must flatten them back to preserve compatibility.

const transformCompanyFields = (obj, prefix = 'company') => {
    if (!obj.companies) return obj; // No relation data
    const flat = { ...obj };

    // Map fields like companies.name -> company_name
    flat[`${prefix}_name`] = obj.companies.name;
    flat[`${prefix}_category`] = obj.companies.category;
    flat[`${prefix}_type`] = obj.companies.type;
    flat[`${prefix}_ctc`] = obj.companies.ctc;
    flat[`${prefix}_stipend`] = obj.companies.stipend;

    // Remove the nested object if desired, or keep it. 
    // Removing it to be clean and match 'pg' output exactly.
    delete flat.companies;
    return flat;
};

const transformOffer = (offer) => {
    return transformCompanyFields(offer, 'company');
};

const transformStudent = (student) => {
    // 1. Flatten the student's primary company info
    let s = transformCompanyFields(student, 'company');

    // 2. Handle offers array
    if (s.offers && Array.isArray(s.offers)) {
        s.offers = s.offers.map(transformOffer);
    } else {
        s.offers = [];
    }
    s.branch_group = getBranchGroup(s.program);
    return s;
};

// --- API IMPLEMENTATION ---

export const initDb = async () => {
    if (!supabase) return (await getPgImpl()).initDb();
    // We cannot run CREATE TABLE via the JS Client easily.
    // We assume the schema exists (since we just migrated from PG).
    console.log('[DB] HTTP Mode: Skipping Schema Init (Tables should already exist).');
};

export const closeDb = async () => {
    if (!supabase) return (await getPgImpl()).closeDb();
    // No persistent connection to close in HTTP mode.
};

export const ensureOfferBackfill = async () => {
    if (!supabase) return (await getPgImpl()).ensureOfferBackfill();
    // Logic: Find students with company_id but no offers, insert offer.
    // This is complex to do efficiently in JS without a custom RPC.
    // For now, we will SKIP this auto-backfill to save bandwidth, 
    // assuming the data is already cleaner or the user creates offers manually.
    console.log('[DB] HTTP Mode: Skipping Offer Backfill (Optimization).');
};


// --- COMPANIES ---

export const listCompanies = async (batchKey = DEFAULT_BATCH_KEY) => {
    if (!supabase) return (await getPgImpl()).listCompanies(batchKey);
    let query = supabase
        .from('companies')
        .select('*');

    query = applyBatchFilter(query, batchKey);
    query = query.order('name', { ascending: true });

    const { data, error } = await query;

    checkError(error, 'listCompanies');
    return data || [];
};

export const getCompany = async (id) => {
    if (!supabase) return (await getPgImpl()).getCompany(id);
    const { data, error } = await supabase
        .from('companies')
        .select('*')
        .eq('id', id)
        .single();

    checkError(error, 'getCompany');
    return data;
};

export const createCompany = async (payload) => {
    if (!supabase) return (await getPgImpl()).createCompany(payload);
    const batchData = normalizeBatchPayload(payload);

    // Ensure strict mapping
    const row = {
        name: payload.name,
        role: payload.role || '',
        type: payload.type || null,
        ctc: payload.ctc ?? null,
        stipend: payload.stipend ?? null,
        category: payload.category || null,
        eligible_cgpa: payload.eligible_cgpa ?? null,
        backlog_allowed: payload.backlog_allowed ? true : false,
        registration_deadline: payload.registration_deadline || null,
        offer_date: payload.offer_date || null,
        ...batchData,
    };

    const { data, error } = await supabase
        .from('companies')
        .insert(row)
        .select()
        .single();

    checkError(error, 'createCompany');
    return data;
};

export const updateCompany = async (id, payload) => {
    if (!supabase) return (await getPgImpl()).updateCompany(id, payload);
    const batchData = normalizeBatchPayload(payload);

    const row = {
        name: payload.name,
        role: payload.role || '',
        type: payload.type || null,
        ctc: payload.ctc ?? null,
        stipend: payload.stipend ?? null,
        category: payload.category || null,
        eligible_cgpa: payload.eligible_cgpa ?? null,
        backlog_allowed: payload.backlog_allowed ? true : false,
        registration_deadline: payload.registration_deadline || null,
        offer_date: payload.offer_date || null,
        ...batchData,
    };

    const { data, error } = await supabase
        .from('companies')
        .update(row)
        .eq('id', id)
        .select()
        .single();

    checkError(error, 'updateCompany');
    return data;
};

export const deleteCompany = async (id) => {
    if (!supabase) return (await getPgImpl()).deleteCompany(id);
    const { error } = await supabase
        .from('companies')
        .delete()
        .eq('id', id);
    checkError(error, 'deleteCompany');
};


// --- STUDENTS ---

const normalizeProgram = (programRaw = '') => {
    const normalized = programRaw.trim().toUpperCase();
    if (normalized.startsWith('CSE R')) return 'CSE-R';
    if (normalized.startsWith('CSE')) return 'CSE';
    if (normalized.startsWith('ECE')) return 'ECE';
    if (normalized.startsWith('CB')) return 'CB';
    return programRaw || 'CSE';
};

export const listStudents = async (batchKey = DEFAULT_BATCH_KEY) => {
    if (!supabase) return (await getPgImpl()).listStudents(batchKey);
    // Fetch students + joined company info
    // Also fetch offers + joined company info for offers

    // Supabase syntax for nested joins:
    // companies (*)  -> gets the linked company for the student
    // offers ( *, companies (*) ) -> gets offers, and the company for each offer

    let query = supabase
        .from('students')
        .select(`
            *,
            companies:company_id (*),
            offers (
                *,
                companies:company_id (*)
            )
        `);

    query = applyBatchFilter(query, batchKey);
    query = query.order('roll_number', { ascending: true });

    const { data, error } = await query;

    checkError(error, 'listStudents');

    // Transform formatting
    return (data || []).map(transformStudent);
};

export const getStudent = async (id) => {
    if (!supabase) return (await getPgImpl()).getStudent(id);
    const { data, error } = await supabase
        .from('students')
        .select(`
            *,
            companies:company_id (*),
            offers (
                *,
                companies:company_id (*)
            )
        `)
        .eq('id', id)
        .single();

    checkError(error, 'getStudent');
    return transformStudent(data);
};

// Internal helper to replace offers
const replaceOffers = async (studentId, offers = []) => {
    // 1. Delete existing
    const { error: delError } = await supabase
        .from('offers')
        .delete()
        .eq('student_id', studentId);
    checkError(delError, 'replaceOffers:delete');

    if (!offers || offers.length === 0) return;

    // 2. Insert new
    const rows = offers
        .filter(o => o.company_id)
        .map(o => ({
            student_id: studentId,
            company_id: o.company_id,
            offer_type: o.offer_type || null,
            ctc: o.ctc ?? null,
            stipend: o.stipend ?? null,
            registration_deadline: o.registration_deadline || null,
            offer_date: o.offer_date || null
        }));

    if (rows.length > 0) {
        const { error: insError } = await supabase.from('offers').insert(rows);
        checkError(insError, 'replaceOffers:insert');
    }
};

export const createStudent = async (payload) => {
    if (!supabase) return (await getPgImpl()).createStudent(payload);
    const isPlaced = payload.placement_status === 'Placed';
    const primaryCompany = isPlaced ? (payload.offers?.[0]?.company_id || payload.company_id || null) : null;
    const primaryOfferType = isPlaced ? (payload.offers?.[0]?.offer_type || payload.offer_type || null) : null;
    const batchData = normalizeBatchPayload(payload);

    const row = {
        roll_number: payload.roll_number,
        name: payload.name,
        program: normalizeProgram(payload.program),
        placement_status: payload.placement_status,
        company_id: primaryCompany,
        offer_type: primaryOfferType,
        ctc: isPlaced ? payload.ctc ?? null : null,
        stipend: isPlaced ? payload.stipend ?? null : null,
        registration_deadline: isPlaced ? payload.registration_deadline || null : null,
        offer_date: isPlaced ? payload.offer_date || null : null,
        ...batchData,
    };

    const { data, error } = await supabase
        .from('students')
        .insert(row)
        .select()
        .single();

    checkError(error, 'createStudent');

    if (isPlaced && payload.offers?.length) {
        await replaceOffers(data.id, payload.offers);
    }

    // Return full object
    return getStudent(data.id);
};

export const updateStudent = async (id, payload) => {
    if (!supabase) return (await getPgImpl()).updateStudent(id, payload);
    const isPlaced = payload.placement_status === 'Placed';
    const primaryCompany = isPlaced ? (payload.offers?.[0]?.company_id || payload.company_id || null) : null;
    const primaryOfferType = isPlaced ? (payload.offers?.[0]?.offer_type || payload.offer_type || null) : null;
    const batchData = normalizeBatchPayload(payload);

    const row = {
        roll_number: payload.roll_number,
        name: payload.name,
        program: normalizeProgram(payload.program),
        placement_status: payload.placement_status,
        company_id: primaryCompany,
        offer_type: primaryOfferType,
        ctc: isPlaced ? payload.ctc ?? null : null,
        stipend: isPlaced ? payload.stipend ?? null : null,
        registration_deadline: isPlaced ? payload.registration_deadline || null : null,
        offer_date: isPlaced ? payload.offer_date || null : null,
        ...batchData,
    };

    const { error } = await supabase
        .from('students')
        .update(row)
        .eq('id', id);

    checkError(error, 'updateStudent');

    await replaceOffers(id, isPlaced ? (payload.offers || []) : []);
    return getStudent(id);
};

export const deleteStudent = async (id) => {
    if (!supabase) return (await getPgImpl()).deleteStudent(id);
    const { error } = await supabase.from('students').delete().eq('id', id);
    checkError(error, 'deleteStudent');
};

// --- STATS ---

export const buildStats = async (batchKey = DEFAULT_BATCH_KEY) => {
    if (!supabase) return (await getPgImpl()).buildStats(batchKey);
    // We already have listing functions, just reuse them!
    const batch = getBatchConfig(batchKey);
    const students = await listStudents(batch.key);
    const companies = await listCompanies(batch.key);

    // We also need all offers disjointly for some counts? 
    // Actually the logic in the old buildStats iterated over students and offers.
    // The old query `SELECT o.* FROM offers o JOIN companies ...` gets ALL offers.
    // `listStudents` gets all students and THEIR offers.
    // Since `listStudents` includes ALL students, and `offset` join includes offers,
    // we can derive everything from `students` array, OR just fetch offers separately.

    // Let's fetch offers separately to match the exact logic of "Total Offers" nicely
    const studentIds = students.map((student) => student.id);
    let offers = [];

    if (studentIds.length) {
        const { data: offersData, error } = await supabase
            .from('offers')
            .select('*, companies:company_id (*)')
            .in('student_id', studentIds);
        checkError(error, 'buildStats:offers');
        offers = (offersData || []).map(transformOffer);
    }

    // --- COPY PASTE LOGIC FROM OLD DB.JS ---
    // The logic below is pure JS processing of the arrays.

    // Create a map to attach program to standalone offers
    const studentProgramMap = students.reduce((acc, s) => {
        acc[s.id] = s.program;
        return acc;
    }, {});

    const offersWithProgram = offers.map((o) => ({ ...o, program: studentProgramMap[o.student_id] }));

    const median = (arr) => {
        if (!arr.length) return null;
        const sorted = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    };

    const average = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
    const toPct = (num, den) => (den ? Number(((num / den) * 100).toFixed(2)) : 0);

    const isIncludedInPlacementRate = (student) => !['not sitting', 'ineligible'].includes(
        String(student?.placement_status || '').trim().toLowerCase()
    );

    const summarize = (subset, offerProgramFilter = null) => {
        const total = subset.length;
        const placed = subset.filter((s) => s.placement_status === 'Placed').length;
        const placementEligibleTotal = subset.filter(isIncludedInPlacementRate).length;
        const offersSubset = offerProgramFilter
            ? offersWithProgram.filter((o) => offerProgramFilter(o.program))
            : offersWithProgram;

        const internSub = offersSubset.filter((o) => (o.offer_type || '').includes('Intern') && o.offer_type !== 'Intern+FTE');
        const fteSub = offersSubset.filter((o) => o.offer_type === 'FTE');
        const comboSub = offersSubset.filter((o) => o.offer_type === 'Intern+FTE');

        const byCategory = { Aplus: 0, A: 0, B: 0 };
        for (const o of offersSubset) {
            const cat = o.company_category;
            if (!cat) continue;
            if (cat.toUpperCase() === 'A+') byCategory.Aplus += 1;
            else if (cat.toUpperCase() === 'A') byCategory.A += 1;
            else if (cat.toUpperCase() === 'B') byCategory.B += 1;
        }

        const ctcValues = offersSubset
            .map((o) => o.ctc ?? o.company_ctc)
            .filter((v) => typeof v === 'number');
        const stipendValues = offersSubset
            .map((o) => o.stipend ?? o.company_stipend)
            .filter((v) => typeof v === 'number');

        const internCount = internSub.length + comboSub.length;
        const fteCount = fteSub.length + comboSub.length;

        return {
            total_students: total,
            placed_students: placed,
            total_offers: offersSubset.length,
            total_intern_offers: internSub.length,
            total_fte_offers: fteSub.length + comboSub.length,
            total_combo_offers: comboSub.length,
            total_Aplus_offers: byCategory.Aplus,
            total_A_offers: byCategory.A,
            total_B_offers: byCategory.B,
            highest_ctc: ctcValues.length ? Math.max(...ctcValues) : null,
            average_ctc: average(ctcValues),
            median_ctc: median(ctcValues),
            highest_stipend: stipendValues.length ? Math.max(...stipendValues) : null,
            average_stipend: average(stipendValues),
            median_stipend: median(stipendValues),
            placement_percentage: toPct(placed, placementEligibleTotal),
            internship_percentage: toPct(internCount, total),
            fte_percentage: toPct(fteCount, total),
        };
    };

    const totalStudents = students.length;
    const placementEligibleStudents = students.filter(isIncludedInPlacementRate).length;
    const inBranch = (branchGroup) => (program) => getBranchGroup(program) === branchGroup;
    const branchSummary = {
        overall: summarize(students),
        cse: summarize(students.filter((s) => getBranchGroup(s.program) === 'CSE'), inBranch('CSE')),
        ece: summarize(students.filter((s) => getBranchGroup(s.program) === 'ECE'), inBranch('ECE')),
        cb: summarize(students.filter((s) => getBranchGroup(s.program) === 'CB'), inBranch('CB')),
    };

    const overall = branchSummary.overall;
    const placedCount = overall.placed_students;
    const fteCount = overall.total_fte_offers;
    const internCount = overall.total_intern_offers;

    return {
        batch,
        number_of_companies: companies.length,
        total_offers: overall.total_offers,
        total_intern_offers: overall.total_intern_offers,
        total_fte_offers: overall.total_fte_offers,
        total_combo_offers: overall.total_combo_offers,
        total_Aplus_offers: overall.total_Aplus_offers,
        total_A_offers: overall.total_A_offers,
        total_B_offers: overall.total_B_offers,
        highest_ctc: overall.highest_ctc,
        lowest_ctc: null,
        average_ctc: overall.average_ctc,
        median_ctc: overall.median_ctc,
        highest_stipend: overall.highest_stipend,
        lowest_stipend: null,
        average_stipend: overall.average_stipend,
        median_stipend: overall.median_stipend,
        fte_percentage: toPct(fteCount, totalStudents),
        internship_percentage: toPct(internCount, totalStudents),
        overall_placement_percentage: toPct(placedCount, placementEligibleStudents),
        total_students: totalStudents,
        total_placed_students: placedCount,
        available_programs: [...new Set(students.map((student) => student.program).filter(Boolean))].sort(),
        branch_summary: branchSummary,
    };
};

export const adminToken = ADMIN_TOKEN;

export const getTableCounts = async () => {
    if (!supabase) return (await getPgImpl()).getTableCounts();
    const { count: cCount } = await supabase.from('companies').select('*', { count: 'exact', head: true });
    const { count: sCount } = await supabase.from('students').select('*', { count: 'exact', head: true });
    const { count: oCount } = await supabase.from('offers').select('*', { count: 'exact', head: true });

    return {
        companies: cCount || 0,
        students: sCount || 0,
        offers: oCount || 0,
    };
}; 
