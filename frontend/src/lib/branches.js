// Branch/degree tagging shared by the company form and directory filtering.

// Branches a company can recruit from, grouped by degree (cross-degree per the cycle model).
const BRANCH_OPTIONS = [
  { degree: 'B.Tech', branches: ['CSE', 'CSE-R', 'CSAI', 'CSAM', 'CSB', 'CSD', 'CSSS', 'ECE', 'EVE', 'CB'] },
  { degree: 'M.Tech', branches: ['CSE', 'ECE', 'CB'] },
];
const branchToken = (degree, branch) => `${degree}:${branch}`;
const formatBranchToken = (token) => String(token || '').replace(':', ' · ');
// True if a company recruits a given degree (by its branch tags; legacy rows with no tags
// fall back to their stored degree so existing per-degree companies keep showing as before).
const companyRecruitsDegree = (company, degree) => {
  const branches = Array.isArray(company?.branches) ? company.branches : [];
  if (branches.length) return branches.some((token) => token.startsWith(`${degree}:`));
  return company?.degree === degree;
};

export { BRANCH_OPTIONS, branchToken, formatBranchToken, companyRecruitsDegree };
