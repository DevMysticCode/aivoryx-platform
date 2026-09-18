'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '@/lib/api/hr';
import { useMutationWithFeedback } from '@/lib/api/use-mutation-with-feedback';

/** TanStack Query hooks for the HR & Workforce surface (Phase 12, ADR 0041). */

export const hrKeys = {
  all: ['hr'] as const,
  dashboard: ['hr', 'dashboard'] as const,
  departments: ['hr', 'departments'] as const,
  designations: ['hr', 'designations'] as const,
  locations: ['hr', 'locations'] as const,
  schedules: ['hr', 'schedules'] as const,
  orgChart: ['hr', 'org-chart'] as const,
  employees: (f: Record<string, unknown>) => ['hr', 'employees', f] as const,
  employee: (id: string) => ['hr', 'employee', id] as const,
  employeeHistory: (id: string) => ['hr', 'employee', id, 'history'] as const,
  employeeDocuments: (id: string) => ['hr', 'employee', id, 'documents'] as const,
  compensation: (id: string) => ['hr', 'employee', id, 'compensation'] as const,
  bankDetails: (id: string) => ['hr', 'employee', id, 'bank-details'] as const,
  attendance: (f: Record<string, unknown>) => ['hr', 'attendance', f] as const,
  leaveTypes: ['hr', 'leave', 'types'] as const,
  leaveBalances: (id: string) => ['hr', 'leave', 'balances', id] as const,
  leaveRequests: (f: Record<string, unknown>) => ['hr', 'leave', 'requests', f] as const,
  myLeave: (f: Record<string, unknown>) => ['hr', 'leave', 'mine', f] as const,
  leaveQueue: ['hr', 'leave', 'queue'] as const,
  leaveCalendar: (f: Record<string, unknown>) => ['hr', 'leave', 'calendar', f] as const,
  expenseCategories: ['hr', 'expenses', 'categories'] as const,
  expenseClaims: (f: Record<string, unknown>) => ['hr', 'expenses', 'claims', f] as const,
  myExpenses: (f: Record<string, unknown>) => ['hr', 'expenses', 'mine', f] as const,
  expenseClaim: (id: string) => ['hr', 'expenses', 'claim', id] as const,
  incentives: (f: Record<string, unknown>) => ['hr', 'incentives', f] as const,
  payrollPeriods: (f: Record<string, unknown>) => ['hr', 'payroll', 'periods', f] as const,
  payrollPeriod: (id: string) => ['hr', 'payroll', 'period', id] as const,
  performancePeriods: ['hr', 'performance', 'periods'] as const,
  performanceGoals: (f: Record<string, unknown>) => ['hr', 'performance', 'goals', f] as const,
  performanceReviews: (f: Record<string, unknown>) => ['hr', 'performance', 'reviews', f] as const,
  me: ['hr', 'me'] as const,
  myPayrollHistory: ['hr', 'me', 'payroll-history'] as const,
};

const invalidateAll = (qc: ReturnType<typeof useQueryClient>) =>
  qc.invalidateQueries({ queryKey: hrKeys.all });

// ---- dashboard / org --------------------------------------
export const useHrDashboard = () =>
  useQuery({ queryKey: hrKeys.dashboard, queryFn: api.hrDashboard });

export const useDepartments = () =>
  useQuery({ queryKey: hrKeys.departments, queryFn: api.listDepartments });
export const useDesignations = () =>
  useQuery({ queryKey: hrKeys.designations, queryFn: api.listDesignations });
export const useLocations = () =>
  useQuery({ queryKey: hrKeys.locations, queryFn: api.listLocations });
export const useSchedules = () =>
  useQuery({ queryKey: hrKeys.schedules, queryFn: api.listSchedules });
export const useOrgChart = () => useQuery({ queryKey: hrKeys.orgChart, queryFn: api.orgChart });

function mutation<TArgs, TResult>(
  fn: (a: TArgs) => Promise<TResult>,
  successMessage?: string | ((data: TResult, variables: TArgs) => string),
) {
  return function useHrMutation() {
    const qc = useQueryClient();
    return useMutationWithFeedback({
      mutationFn: fn,
      successMessage,
      onSuccess: () => invalidateAll(qc),
    });
  };
}

export const useCreateDepartment = mutation(api.createDepartment, 'Department created');
export const useCreateDesignation = mutation(api.createDesignation, 'Designation created');
export const useCreateLocation = mutation(api.createLocation, 'Location created');
export const useCreateSchedule = mutation(api.createSchedule, 'Schedule created');

// ---- employees ------------------------------------------
export const useEmployees = (filters: Parameters<typeof api.listEmployees>[0]) =>
  useQuery({ queryKey: hrKeys.employees(filters), queryFn: () => api.listEmployees(filters) });
export const useEmployee = (id: string) =>
  useQuery({ queryKey: hrKeys.employee(id), queryFn: () => api.getEmployee(id), enabled: !!id });
export const useEmployeeHistory = (id: string) =>
  useQuery({
    queryKey: hrKeys.employeeHistory(id),
    queryFn: () => api.employeeHistory(id),
    enabled: !!id,
  });
export const useEmployeeDocuments = (id: string) =>
  useQuery({
    queryKey: hrKeys.employeeDocuments(id),
    queryFn: () => api.listEmployeeDocuments(id),
    enabled: !!id,
  });
export function useDeleteEmployeeDocument(id: string) {
  const qc = useQueryClient();
  return useMutationWithFeedback({
    mutationFn: (documentId: string) => api.deleteEmployeeDocument(id, documentId),
    successMessage: 'Document deleted',
    onSuccess: () => qc.invalidateQueries({ queryKey: hrKeys.employeeDocuments(id) }),
  });
}
export const useCompensationHistory = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: hrKeys.compensation(id),
    queryFn: () => api.compensationHistory(id),
    enabled: !!id && enabled,
    retry: false,
  });
export const useBankDetails = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: hrKeys.bankDetails(id),
    queryFn: () => api.getBankDetails(id),
    enabled: !!id && enabled,
    retry: false,
  });

// No successMessage: the call site (apps/web/app/hr/employees/page.tsx) redirects
// to the new employee's detail page on success, which already confirms creation.
export const useCreateEmployee = mutation(api.createEmployee);
export function useUpdateEmployee(id: string) {
  const qc = useQueryClient();
  return useMutationWithFeedback({
    mutationFn: (body: Record<string, unknown>) => api.updateEmployee(id, body),
    successMessage: 'Employee updated',
    onSuccess: () => invalidateAll(qc),
  });
}
export function useChangeEmployeeStatus(id: string) {
  const qc = useQueryClient();
  return useMutationWithFeedback({
    mutationFn: (body: { status: string; reason?: string }) => api.changeEmployeeStatus(id, body),
    successMessage: (_data, variables) =>
      `Employee status changed to ${variables.status.replace(/_/g, ' ').toLowerCase()}`,
    onSuccess: () => invalidateAll(qc),
  });
}
export function useLinkMembership(id: string) {
  const qc = useQueryClient();
  return useMutationWithFeedback({
    mutationFn: (membershipId: string) => api.linkMembership(id, membershipId),
    successMessage: 'Employee linked to user account',
    onSuccess: () => invalidateAll(qc),
  });
}
export function useUnlinkMembership(id: string) {
  const qc = useQueryClient();
  return useMutationWithFeedback({
    mutationFn: () => api.unlinkMembership(id),
    successMessage: 'Employee unlinked from user account',
    onSuccess: () => invalidateAll(qc),
  });
}
export function useCreateCompensation(id: string) {
  const qc = useQueryClient();
  return useMutationWithFeedback({
    mutationFn: (body: Record<string, unknown>) => api.createCompensation(id, body),
    successMessage: 'Compensation record added',
    onSuccess: () => invalidateAll(qc),
  });
}
export function useUpsertBankDetails(id: string) {
  const qc = useQueryClient();
  return useMutationWithFeedback({
    mutationFn: (body: Record<string, unknown>) => api.upsertBankDetails(id, body),
    successMessage: 'Bank details saved',
    onSuccess: () => invalidateAll(qc),
  });
}

// ---- attendance ---------------------------------------
export const useAttendance = (filters: Parameters<typeof api.listAttendance>[0]) =>
  useQuery({ queryKey: hrKeys.attendance(filters), queryFn: () => api.listAttendance(filters) });
export const useRecordAttendance = mutation(api.recordAttendance, 'Attendance recorded');
export const useCheckIn = mutation(api.checkIn, 'Checked in');
export const useCheckOut = mutation(api.checkOut, 'Checked out');
export function useCorrectAttendance(id: string) {
  const qc = useQueryClient();
  return useMutationWithFeedback({
    mutationFn: (body: Record<string, unknown>) => api.correctAttendance(id, body),
    successMessage: 'Attendance correction applied',
    onSuccess: () => invalidateAll(qc),
  });
}

// ---- leave -------------------------------------------
export const useLeaveTypes = () =>
  useQuery({ queryKey: hrKeys.leaveTypes, queryFn: api.listLeaveTypes });
export const useLeaveBalances = (employeeId: string) =>
  useQuery({
    queryKey: hrKeys.leaveBalances(employeeId),
    queryFn: () => api.leaveBalances(employeeId),
    enabled: !!employeeId,
  });
export const useLeaveRequests = (filters: Record<string, string | number | undefined>) =>
  useQuery({
    queryKey: hrKeys.leaveRequests(filters),
    queryFn: () => api.listLeaveRequests(filters),
  });
export const useMyLeaveRequests = (filters: Record<string, string | number | undefined> = {}) =>
  useQuery({ queryKey: hrKeys.myLeave(filters), queryFn: () => api.myLeaveRequests(filters) });
export const useLeaveQueue = () =>
  useQuery({ queryKey: hrKeys.leaveQueue, queryFn: api.leaveApprovalQueue });
export const useLeaveCalendar = (filters: { from: string; to: string; departmentId?: string }) =>
  useQuery({ queryKey: hrKeys.leaveCalendar(filters), queryFn: () => api.leaveCalendar(filters) });

export const useCreateLeaveType = mutation(api.createLeaveType, 'Leave type created');
export const useCreateLeaveRequest = mutation(api.createLeaveRequest, 'Leave request submitted');
export const useAdjustLeaveBalance = mutation(api.adjustLeaveBalance, 'Leave balance adjusted');
export function useLeaveDecision(id: string) {
  const qc = useQueryClient();
  return {
    approve: useMutationWithFeedback({
      mutationFn: (body: { reason?: string }) => api.approveLeave(id, body),
      successMessage: 'Leave request approved',
      onSuccess: () => invalidateAll(qc),
    }),
    reject: useMutationWithFeedback({
      mutationFn: (body: { reason?: string }) => api.rejectLeave(id, body),
      successMessage: 'Leave request rejected',
      onSuccess: () => invalidateAll(qc),
    }),
    cancel: useMutationWithFeedback({
      mutationFn: () => api.cancelLeave(id),
      successMessage: 'Leave request cancelled',
      onSuccess: () => invalidateAll(qc),
    }),
  };
}

// ---- expenses ---------------------------------------
export const useExpenseCategories = () =>
  useQuery({ queryKey: hrKeys.expenseCategories, queryFn: api.listExpenseCategories });
export const useExpenseClaims = (filters: Record<string, string | number | undefined>) =>
  useQuery({
    queryKey: hrKeys.expenseClaims(filters),
    queryFn: () => api.listExpenseClaims(filters),
  });
export const useMyExpenseClaims = (filters: Record<string, string | number | undefined> = {}) =>
  useQuery({ queryKey: hrKeys.myExpenses(filters), queryFn: () => api.myExpenseClaims(filters) });
export const useExpenseClaim = (id: string) =>
  useQuery({
    queryKey: hrKeys.expenseClaim(id),
    queryFn: () => api.getExpenseClaim(id),
    enabled: !!id,
  });

export const useCreateExpenseCategory = mutation(
  api.createExpenseCategory,
  'Expense category created',
);
export const useCreateExpenseClaim = mutation(api.createExpenseClaim, 'Expense claim created');
export function useExpenseActions(id: string) {
  const qc = useQueryClient();
  const ok = () => invalidateAll(qc);
  return {
    submit: useMutationWithFeedback({
      mutationFn: () => api.submitExpenseClaim(id),
      successMessage: 'Expense claim submitted',
      onSuccess: ok,
    }),
    approve: useMutationWithFeedback({
      mutationFn: (b: { approvedAmount?: string; reason?: string }) =>
        api.approveExpenseClaim(id, b),
      successMessage: 'Expense claim approved',
      onSuccess: ok,
    }),
    reject: useMutationWithFeedback({
      mutationFn: (b: { reason?: string }) => api.rejectExpenseClaim(id, b),
      successMessage: 'Expense claim rejected',
      onSuccess: ok,
    }),
    cancel: useMutationWithFeedback({
      mutationFn: () => api.cancelExpenseClaim(id),
      successMessage: 'Expense claim cancelled',
      onSuccess: ok,
    }),
    reimburse: useMutationWithFeedback({
      mutationFn: (b: Record<string, unknown>) => api.reimburseExpenseClaim(id, b),
      successMessage: 'Reimbursement recorded',
      onSuccess: ok,
    }),
  };
}

// ---- incentives ------------------------------------
export const useIncentives = (filters: Record<string, string | number | undefined>) =>
  useQuery({ queryKey: hrKeys.incentives(filters), queryFn: () => api.listIncentives(filters) });
export const useCreateIncentive = mutation(api.createIncentive, 'Incentive created');
export function useApproveIncentive() {
  const qc = useQueryClient();
  return useMutationWithFeedback({
    mutationFn: api.approveIncentive,
    successMessage: 'Incentive approved',
    onSuccess: () => invalidateAll(qc),
  });
}

// ---- payroll -------------------------------------
export const usePayrollPeriods = (filters: { status?: string; page?: number } = {}) =>
  useQuery({
    queryKey: hrKeys.payrollPeriods(filters),
    queryFn: () => api.listPayrollPeriods(filters),
  });
export const usePayrollPeriod = (id: string) =>
  useQuery({
    queryKey: hrKeys.payrollPeriod(id),
    queryFn: () => api.getPayrollPeriod(id),
    enabled: !!id,
  });
export const useCreatePayrollPeriod = mutation(api.createPayrollPeriod, 'Payroll period created');
export function usePayrollActions(id: string) {
  const qc = useQueryClient();
  const ok = () => invalidateAll(qc);
  return {
    process: useMutationWithFeedback({
      mutationFn: () => api.processPayrollPeriod(id),
      successMessage: 'Payroll period processed',
      onSuccess: ok,
    }),
    finalize: useMutationWithFeedback({
      mutationFn: () => api.finalizePayrollPeriod(id),
      successMessage: 'Payroll period finalized',
      onSuccess: ok,
    }),
    recordPayment: useMutationWithFeedback({
      mutationFn: (b: Record<string, unknown>) => api.recordPayrollPayment(id, b),
      successMessage: 'Payment recorded',
      onSuccess: ok,
    }),
  };
}

// ---- performance --------------------------------
export const usePerformancePeriods = () =>
  useQuery({ queryKey: hrKeys.performancePeriods, queryFn: api.listPerformancePeriods });
export const usePerformanceGoals = (filters: Record<string, string | undefined>) =>
  useQuery({
    queryKey: hrKeys.performanceGoals(filters),
    queryFn: () => api.listPerformanceGoals(filters),
  });
export const usePerformanceReviews = (filters: Record<string, string | undefined>) =>
  useQuery({
    queryKey: hrKeys.performanceReviews(filters),
    queryFn: () => api.listPerformanceReviews(filters),
  });
export const useCreatePerformancePeriod = mutation(
  api.createPerformancePeriod,
  'Performance period created',
);
export const useCreatePerformanceGoal = mutation(api.createPerformanceGoal, 'Goal added');
export const useCreatePerformanceReview = mutation(api.createPerformanceReview, 'Review created');
export function usePerformancePeriodStatus() {
  const qc = useQueryClient();
  return useMutationWithFeedback({
    mutationFn: ({ id, action }: { id: string; action: 'open' | 'close' }) =>
      api.setPerformancePeriodStatus(id, action),
    successMessage: (_data, variables) =>
      variables.action === 'open' ? 'Performance period opened' : 'Performance period closed',
    onSuccess: () => invalidateAll(qc),
  });
}
export function useReviewActions(id: string) {
  const qc = useQueryClient();
  const ok = () => invalidateAll(qc);
  return {
    update: useMutationWithFeedback({
      mutationFn: (b: Record<string, unknown>) => api.updatePerformanceReview(id, b),
      successMessage: 'Review updated',
      onSuccess: ok,
    }),
    submit: useMutationWithFeedback({
      mutationFn: () => api.submitPerformanceReview(id),
      successMessage: 'Review submitted to employee',
      onSuccess: ok,
    }),
    close: useMutationWithFeedback({
      mutationFn: () => api.closePerformanceReview(id),
      successMessage: 'Review closed',
      onSuccess: ok,
    }),
  };
}

// ---- self-service ------------------------------
export const useHrMe = () => useQuery({ queryKey: hrKeys.me, queryFn: api.hrMe, retry: false });
export const useMyPayrollHistory = () =>
  useQuery({ queryKey: hrKeys.myPayrollHistory, queryFn: api.myPayrollHistory, retry: false });
