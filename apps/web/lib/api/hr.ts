import type {
  HrAttendanceList,
  HrAttendanceRecord,
  HrBankDetails,
  HrCompensation,
  HrDashboard,
  HrEmployeeDetail,
  HrEmployeeDocument,
  HrEmployeeList,
  HrEmploymentHistoryItem,
  HrExpenseCategory,
  HrExpenseClaim,
  HrExpenseClaimList,
  HrIncentive,
  HrIncentiveList,
  HrLeaveBalance,
  HrLeaveCalendarItem,
  HrLeaveRequest,
  HrLeaveRequestList,
  HrLeaveType,
  HrMe,
  HrOrgChart,
  HrOrgUnit,
  HrPayrollHistoryItem,
  HrPayrollPeriod,
  HrPayrollPeriodDetail,
  HrPayrollPeriodList,
  HrPerformanceGoal,
  HrPerformancePeriod,
  HrPerformanceReview,
  HrWorkLocation,
  HrWorkSchedule,
} from '@aivoryx/contracts';
import { API_V1_PREFIX } from '@aivoryx/contracts';
import { webEnv } from '../env';
import { apiFetch } from './client';

/**
 * HR & Workforce API client (Phase 12, ADR 0041). Ownership (tenant, actor,
 * self-service employee) is always resolved server-side — these calls never
 * pass an identity the server would trust.
 */

const json = (body: unknown, method = 'POST'): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const qs = (params: Record<string, string | number | boolean | undefined>): string => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
};

// ---- dashboard --------------------------------------------------
export const hrDashboard = () => apiFetch<HrDashboard>('/hr/dashboard', { cache: 'no-store' });

// ---- organisation --------------------------------------------
export const listDepartments = () =>
  apiFetch<HrOrgUnit[]>('/hr/departments', { cache: 'no-store' });
export const createDepartment = (body: { name: string; code: string }) =>
  apiFetch<HrOrgUnit>('/hr/departments', json(body));
export const updateDepartment = (
  id: string,
  body: { name?: string; code?: string; status?: string },
) => apiFetch<HrOrgUnit>(`/hr/departments/${id}`, json(body, 'PATCH'));

export const listDesignations = () =>
  apiFetch<HrOrgUnit[]>('/hr/designations', { cache: 'no-store' });
export const createDesignation = (body: { name: string; code: string }) =>
  apiFetch<HrOrgUnit>('/hr/designations', json(body));
export const updateDesignation = (
  id: string,
  body: { name?: string; code?: string; status?: string },
) => apiFetch<HrOrgUnit>(`/hr/designations/${id}`, json(body, 'PATCH'));

export const listLocations = () =>
  apiFetch<HrWorkLocation[]>('/hr/locations', { cache: 'no-store' });
export const createLocation = (body: Record<string, unknown>) =>
  apiFetch<HrWorkLocation>('/hr/locations', json(body));
export const updateLocation = (id: string, body: Record<string, unknown>) =>
  apiFetch<HrWorkLocation>(`/hr/locations/${id}`, json(body, 'PATCH'));

export const listSchedules = () =>
  apiFetch<HrWorkSchedule[]>('/hr/schedules', { cache: 'no-store' });
export const createSchedule = (body: Record<string, unknown>) =>
  apiFetch<HrWorkSchedule>('/hr/schedules', json(body));

export const orgChart = () => apiFetch<HrOrgChart>('/hr/organization/chart', { cache: 'no-store' });

// ---- employees ---------------------------------------------
export const listEmployees = (opts: {
  q?: string;
  departmentId?: string;
  designationId?: string;
  workLocationId?: string;
  status?: string;
  employmentType?: string;
  page?: number;
  pageSize?: number;
}) => apiFetch<HrEmployeeList>(`/hr/employees${qs(opts)}`, { cache: 'no-store' });

export const getEmployee = (id: string) =>
  apiFetch<HrEmployeeDetail>(`/hr/employees/${id}`, { cache: 'no-store' });

export const createEmployee = (body: Record<string, unknown>) =>
  apiFetch<HrEmployeeDetail>('/hr/employees', json(body));

export const updateEmployee = (id: string, body: Record<string, unknown>) =>
  apiFetch<HrEmployeeDetail>(`/hr/employees/${id}`, json(body, 'PATCH'));

export const changeEmployeeStatus = (id: string, body: { status: string; reason?: string }) =>
  apiFetch<HrEmployeeDetail>(`/hr/employees/${id}/status`, json(body));

export const employeeHistory = (id: string) =>
  apiFetch<HrEmploymentHistoryItem[]>(`/hr/employees/${id}/history`, { cache: 'no-store' });

export const linkMembership = (id: string, membershipId: string) =>
  apiFetch<HrEmployeeDetail>(`/hr/employees/${id}/membership`, json({ membershipId }));
export const unlinkMembership = (id: string) =>
  apiFetch<HrEmployeeDetail>(`/hr/employees/${id}/membership`, { method: 'DELETE' });

export const listEmployeeDocuments = (id: string) =>
  apiFetch<HrEmployeeDocument[]>(`/hr/employees/${id}/documents`, { cache: 'no-store' });
export const uploadEmployeeDocument = (id: string, form: FormData) =>
  apiFetch<HrEmployeeDocument[]>(`/hr/employees/${id}/documents`, { method: 'POST', body: form });
export const employeeDocumentUrl = (id: string, documentId: string) =>
  `${webEnv.NEXT_PUBLIC_API_BASE_URL}${API_V1_PREFIX}/hr/employees/${id}/documents/${documentId}/download`;

// compensation (sensitive)
export const compensationHistory = (id: string) =>
  apiFetch<HrCompensation[]>(`/hr/employees/${id}/compensation`, { cache: 'no-store' });
export const createCompensation = (id: string, body: Record<string, unknown>) =>
  apiFetch<HrCompensation>(`/hr/employees/${id}/compensation`, json(body));

// bank details (highly sensitive; masked)
export const getBankDetails = (id: string) =>
  apiFetch<HrBankDetails>(`/hr/employees/${id}/bank-details`, { cache: 'no-store' });
export const upsertBankDetails = (id: string, body: Record<string, unknown>) =>
  apiFetch<HrBankDetails>(`/hr/employees/${id}/bank-details`, json(body));

// ---- attendance ------------------------------------------
export const listAttendance = (opts: {
  employeeId?: string;
  from?: string;
  to?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}) => apiFetch<HrAttendanceList>(`/hr/attendance${qs(opts)}`, { cache: 'no-store' });

export const checkIn = (body: Record<string, unknown>) =>
  apiFetch<HrAttendanceRecord>('/hr/attendance/check-in', json(body));
export const checkOut = (body: Record<string, unknown>) =>
  apiFetch<HrAttendanceRecord>('/hr/attendance/check-out', json(body));
export const recordAttendance = (body: Record<string, unknown>) =>
  apiFetch<HrAttendanceRecord>('/hr/attendance/record', json(body));
export const correctAttendance = (id: string, body: Record<string, unknown>) =>
  apiFetch<HrAttendanceRecord>(`/hr/attendance/${id}/corrections`, json(body));

// ---- leave ---------------------------------------------
export const listLeaveTypes = () =>
  apiFetch<HrLeaveType[]>('/hr/leave/types', { cache: 'no-store' });
export const createLeaveType = (body: Record<string, unknown>) =>
  apiFetch<HrLeaveType>('/hr/leave/types', json(body));
export const updateLeaveType = (id: string, body: Record<string, unknown>) =>
  apiFetch<HrLeaveType>(`/hr/leave/types/${id}`, json(body, 'PATCH'));

export const leaveBalances = (employeeId: string) =>
  apiFetch<HrLeaveBalance[]>(`/hr/leave/balances/${employeeId}`, { cache: 'no-store' });
export const adjustLeaveBalance = (body: Record<string, unknown>) =>
  apiFetch<HrLeaveBalance[]>('/hr/leave/balances/adjust', json(body));

export const listLeaveRequests = (opts: Record<string, string | number | undefined>) =>
  apiFetch<HrLeaveRequestList>(`/hr/leave/requests${qs(opts)}`, { cache: 'no-store' });
export const myLeaveRequests = (opts: Record<string, string | number | undefined> = {}) =>
  apiFetch<HrLeaveRequestList>(`/hr/leave/my-requests${qs(opts)}`, { cache: 'no-store' });
export const leaveApprovalQueue = () =>
  apiFetch<HrLeaveRequest[]>('/hr/leave/approval-queue', { cache: 'no-store' });
export const leaveCalendar = (opts: { from: string; to: string; departmentId?: string }) =>
  apiFetch<HrLeaveCalendarItem[]>(`/hr/leave/calendar${qs(opts)}`, { cache: 'no-store' });
export const createLeaveRequest = (body: Record<string, unknown>) =>
  apiFetch<HrLeaveRequest>('/hr/leave/requests', json(body));
export const getLeaveRequest = (id: string) =>
  apiFetch<HrLeaveRequest>(`/hr/leave/requests/${id}`, { cache: 'no-store' });
export const approveLeave = (id: string, body: { reason?: string } = {}) =>
  apiFetch<HrLeaveRequest>(`/hr/leave/requests/${id}/approve`, json(body));
export const rejectLeave = (id: string, body: { reason?: string } = {}) =>
  apiFetch<HrLeaveRequest>(`/hr/leave/requests/${id}/reject`, json(body));
export const cancelLeave = (id: string) =>
  apiFetch<HrLeaveRequest>(`/hr/leave/requests/${id}/cancel`, json({}));

// ---- expenses -----------------------------------------
export const listExpenseCategories = () =>
  apiFetch<HrExpenseCategory[]>('/hr/expenses/categories', { cache: 'no-store' });
export const createExpenseCategory = (body: Record<string, unknown>) =>
  apiFetch<HrExpenseCategory>('/hr/expenses/categories', json(body));
export const updateExpenseCategory = (id: string, body: Record<string, unknown>) =>
  apiFetch<HrExpenseCategory>(`/hr/expenses/categories/${id}`, json(body, 'PATCH'));

export const listExpenseClaims = (opts: Record<string, string | number | undefined>) =>
  apiFetch<HrExpenseClaimList>(`/hr/expenses${qs(opts)}`, { cache: 'no-store' });
export const myExpenseClaims = (opts: Record<string, string | number | undefined> = {}) =>
  apiFetch<HrExpenseClaimList>(`/hr/expenses/my-claims${qs(opts)}`, { cache: 'no-store' });
export const createExpenseClaim = (body: Record<string, unknown>) =>
  apiFetch<HrExpenseClaim>('/hr/expenses', json(body));
export const getExpenseClaim = (id: string) =>
  apiFetch<HrExpenseClaim>(`/hr/expenses/${id}`, { cache: 'no-store' });
export const submitExpenseClaim = (id: string) =>
  apiFetch<HrExpenseClaim>(`/hr/expenses/${id}/submit`, json({}));
export const approveExpenseClaim = (
  id: string,
  body: { approvedAmount?: string; reason?: string } = {},
) => apiFetch<HrExpenseClaim>(`/hr/expenses/${id}/approve`, json(body));
export const rejectExpenseClaim = (id: string, body: { reason?: string } = {}) =>
  apiFetch<HrExpenseClaim>(`/hr/expenses/${id}/reject`, json(body));
export const cancelExpenseClaim = (id: string) =>
  apiFetch<HrExpenseClaim>(`/hr/expenses/${id}/cancel`, json({}));
export const reimburseExpenseClaim = (id: string, body: Record<string, unknown>) =>
  apiFetch<HrExpenseClaim>(`/hr/expenses/${id}/reimburse`, json(body));
export const uploadExpenseReceipt = (id: string, form: FormData) =>
  apiFetch<HrExpenseClaim>(`/hr/expenses/${id}/receipt`, { method: 'POST', body: form });
export const expenseReceiptUrl = (id: string) =>
  `${webEnv.NEXT_PUBLIC_API_BASE_URL}${API_V1_PREFIX}/hr/expenses/${id}/receipt`;

// ---- incentives --------------------------------------
export const listIncentives = (opts: Record<string, string | number | undefined>) =>
  apiFetch<HrIncentiveList>(`/hr/incentives${qs(opts)}`, { cache: 'no-store' });
export const createIncentive = (body: Record<string, unknown>) =>
  apiFetch<HrIncentive>('/hr/incentives', json(body));
export const approveIncentive = (id: string) =>
  apiFetch<HrIncentive>(`/hr/incentives/${id}/approve`, json({}));

// ---- payroll ----------------------------------------
export const listPayrollPeriods = (opts: { status?: string; page?: number } = {}) =>
  apiFetch<HrPayrollPeriodList>(`/hr/payroll/periods${qs(opts)}`, { cache: 'no-store' });
export const getPayrollPeriod = (id: string) =>
  apiFetch<HrPayrollPeriodDetail>(`/hr/payroll/periods/${id}`, { cache: 'no-store' });
export const createPayrollPeriod = (body: Record<string, unknown>) =>
  apiFetch<HrPayrollPeriod>('/hr/payroll/periods', json(body));
export const processPayrollPeriod = (id: string) =>
  apiFetch<HrPayrollPeriodDetail>(`/hr/payroll/periods/${id}/process`, json({}));
export const finalizePayrollPeriod = (id: string) =>
  apiFetch<HrPayrollPeriodDetail>(`/hr/payroll/periods/${id}/finalize`, json({}));
export const recordPayrollPayment = (id: string, body: Record<string, unknown>) =>
  apiFetch<HrPayrollPeriodDetail>(`/hr/payroll/periods/${id}/payments`, json(body));
export const payslipPdfUrl = (entryId: string) =>
  `${webEnv.NEXT_PUBLIC_API_BASE_URL}${API_V1_PREFIX}/hr/payroll/entries/${entryId}/payslip`;
export const myPayslipPdfUrl = (entryId: string) =>
  `${webEnv.NEXT_PUBLIC_API_BASE_URL}${API_V1_PREFIX}/hr/payroll/me/entries/${entryId}/payslip`;

// ---- performance -----------------------------------
export const listPerformancePeriods = () =>
  apiFetch<HrPerformancePeriod[]>('/hr/performance/periods', { cache: 'no-store' });
export const createPerformancePeriod = (body: Record<string, unknown>) =>
  apiFetch<HrPerformancePeriod>('/hr/performance/periods', json(body));
export const setPerformancePeriodStatus = (id: string, action: 'open' | 'close') =>
  apiFetch<HrPerformancePeriod>(`/hr/performance/periods/${id}/${action}`, json({}));
export const listPerformanceGoals = (opts: Record<string, string | undefined>) =>
  apiFetch<HrPerformanceGoal[]>(`/hr/performance/goals${qs(opts)}`, { cache: 'no-store' });
export const createPerformanceGoal = (body: Record<string, unknown>) =>
  apiFetch<HrPerformanceGoal>('/hr/performance/goals', json(body));
export const listPerformanceReviews = (opts: Record<string, string | undefined>) =>
  apiFetch<HrPerformanceReview[]>(`/hr/performance/reviews${qs(opts)}`, { cache: 'no-store' });
export const createPerformanceReview = (body: Record<string, unknown>) =>
  apiFetch<HrPerformanceReview>('/hr/performance/reviews', json(body));
export const updatePerformanceReview = (id: string, body: Record<string, unknown>) =>
  apiFetch<HrPerformanceReview>(`/hr/performance/reviews/${id}`, json(body, 'PATCH'));
export const submitPerformanceReview = (id: string) =>
  apiFetch<HrPerformanceReview>(`/hr/performance/reviews/${id}/submit`, json({}));
export const closePerformanceReview = (id: string) =>
  apiFetch<HrPerformanceReview>(`/hr/performance/reviews/${id}/close`, json({}));

// ---- self-service (/hr/me) --------------------------
export const hrMe = () => apiFetch<HrMe>('/hr/me', { cache: 'no-store' });
export const myLeaveBalances = () =>
  apiFetch<HrLeaveBalance[]>('/hr/me/leave-balances', { cache: 'no-store' });
export const myAttendance = (opts: Record<string, string | number | undefined> = {}) =>
  apiFetch<HrAttendanceList>(`/hr/me/attendance${qs(opts)}`, { cache: 'no-store' });
export const myExpenses = (opts: Record<string, string | number | undefined> = {}) =>
  apiFetch<HrExpenseClaimList>(`/hr/me/expenses${qs(opts)}`, { cache: 'no-store' });
export const myPayrollHistory = () =>
  apiFetch<HrPayrollHistoryItem[]>('/hr/me/payroll-history', { cache: 'no-store' });
