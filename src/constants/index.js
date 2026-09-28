const freeze = Object.freeze;

/**
 * An EMPLOYEE login is optional and belongs to one employee record: it sees only that person's own data. What else it may
 * do (approve leave, add employees) comes from the employee's department. Attendance is still marked by face at a device.
 */
export const ROLES = freeze({
  SUPER_ADMIN: "SUPER_ADMIN",
  COMPANY: "COMPANY",
  ATTENDANCE_DEVICE: "ATTENDANCE_DEVICE",
  EMPLOYEE: "EMPLOYEE",
});

export const COMPANY_STATUS = freeze({ ACTIVE: "ACTIVE", SUSPENDED: "SUSPENDED", TRIAL: "TRIAL", CANCELLED: "CANCELLED" });
export const RECORD_STATUS = freeze({ ACTIVE: "ACTIVE", INACTIVE: "INACTIVE" });
export const EMPLOYEE_STATUS = freeze({ ACTIVE: "ACTIVE", INACTIVE: "INACTIVE", TERMINATED: "TERMINATED" });

export const EVENT_TYPES = freeze({
  CHECK_IN: "CHECK_IN",
  CHECK_OUT: "CHECK_OUT",
  BREAK_START: "BREAK_START",
  BREAK_END: "BREAK_END",
  MANUAL_CHECK_IN: "MANUAL_CHECK_IN",
  MANUAL_CHECK_OUT: "MANUAL_CHECK_OUT",
});
export const IN_EVENT_TYPES = freeze([EVENT_TYPES.CHECK_IN, EVENT_TYPES.MANUAL_CHECK_IN]);
export const OUT_EVENT_TYPES = freeze([EVENT_TYPES.CHECK_OUT, EVENT_TYPES.MANUAL_CHECK_OUT]);

export const EVENT_METHODS = freeze({ FACE: "FACE", MANUAL: "MANUAL", WEB: "WEB", SYSTEM: "SYSTEM" });

export const ATTENDANCE_STATUS = freeze({
  PRESENT: "PRESENT",
  ABSENT: "ABSENT",
  LATE: "LATE",
  HALF_DAY: "HALF_DAY",
  ON_LEAVE: "ON_LEAVE",
  HOLIDAY: "HOLIDAY",
  WEEK_OFF: "WEEK_OFF",
  INCOMPLETE: "INCOMPLETE",
});

export const LEAVE_STATUS = freeze({ PENDING: "PENDING", APPROVED: "APPROVED", REJECTED: "REJECTED", CANCELLED: "CANCELLED" });

/**
 * FIXED: a set in/out time (lateness applies). FLEXIBLE: come any time, but complete the required working minutes.
 * NO_TIME_BOUND: no set time and no required hours (sales / field teams) — marking attendance on the day is being present.
 */
export const TIMING_MODES = freeze({ FIXED: "FIXED", FLEXIBLE: "FLEXIBLE", NO_TIME_BOUND: "NO_TIME_BOUND" });
export const LATE_PENALTIES = freeze({ HALF_DAY: "HALF_DAY", ABSENT: "ABSENT" });
export const PENALTY_PERIODS = freeze({ WEEK: "WEEK", MONTH: "MONTH" });
/** NTH_ONWARDS: the Nth late day and every one after it. EVERY_NTH: only each Nth (e.g. 3 lates = 1 half day). */
export const PENALTY_REPEAT = freeze({ NTH_ONWARDS: "NTH_ONWARDS", EVERY_NTH: "EVERY_NTH" });
export const PENALTY_REASONS = freeze({ LATE_COUNT: "LATE_COUNT", LATE_STREAK: "LATE_STREAK" });
/** What one day of salary is: monthly salary ÷ days in the month, ÷ working days in the month, or ÷ a fixed number. */
export const SALARY_DAY_BASIS = freeze({ CALENDAR_DAYS: "CALENDAR_DAYS", WORKING_DAYS: "WORKING_DAYS", FIXED_DAYS: "FIXED_DAYS" });


export const FACE_MODES = freeze({ FACE_ONLY: "FACE_ONLY", FACE_AND_LIVENESS: "FACE_AND_LIVENESS" });
export const FACE_PROFILE_STATUS = freeze({ ACTIVE: "ACTIVE", DEACTIVATED: "DEACTIVATED", REPLACED: "REPLACED" });

export const BRANDING = freeze({
  DEFAULT_COLOR: "#4f46e5",
  MAX_LOGO_CHARS: 60_000, // a data-URI logo is stored on the company and sent with every session payload, so keep it tiny
});

export const PAGINATION = freeze({ DEFAULT_PAGE: 1, DEFAULT_LIMIT: 20, MAX_LIMIT: 100 });

export const TIME = freeze({
  MINUTES_PER_DAY: 1440,
  MS_PER_MINUTE: 60000,
  DEFAULT_WEEK_OFF: [0], // Sunday
});

export const AUTH = freeze({
  MAX_FAILED_LOGINS: 5,
  LOCK_MINUTES: 15,
  RESET_TOKEN_MINUTES: 30,
  REFRESH_COOKIE: "ams_rt",
  SESSION_HINT_COOKIE: "ams_role",
});

export const NOTIFICATION_CHANNELS = freeze({ IN_APP: "IN_APP", EMAIL: "EMAIL", WEB_PUSH: "WEB_PUSH" });
export const SUBSCRIPTION_STATUS = freeze({ TRIAL: "TRIAL", ACTIVE: "ACTIVE", PAST_DUE: "PAST_DUE", CANCELLED: "CANCELLED", EXPIRED: "EXPIRED" });
