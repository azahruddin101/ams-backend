import { AttendanceEvent, AttendanceRecord, Employee } from "../models/index.js";
import { EVENT_TYPES, EVENT_METHODS, IN_EVENT_TYPES } from "../constants/index.js";
import { BadRequestError, ConflictError, NotFoundError } from "../utils/errors.js";
import { distanceMeters } from "../utils/geo.js";
import { paginateQuery } from "../utils/pagination.js";
import { recordAudit } from "./audit.service.js";
import { loadEmployeeContext, recomputeDay } from "./attendance/recompute.js";
import { resolveAttendanceDate } from "./attendance/engine.js";

const MAX_GPS_ACCURACY_METERS = 200;

/** A person is "in" when their latest effective event is a check-in; anything else means the next scan is a check-in. */
const isCheckedIn = (events) => IN_EVENT_TYPES.includes(events.at(-1)?.type);

function assertGeofence({ policy, company }, location) {
  if (!policy.geofenceEnabled) return null;
  const g = company.settings.geofence;
  if (g?.latitude == null || g?.longitude == null) return null; // enabled but office coordinates not configured yet
  if (location?.latitude == null || location?.longitude == null) throw new BadRequestError("Device location is required", "LOCATION_REQUIRED");
  if (location.accuracy == null || location.accuracy > MAX_GPS_ACCURACY_METERS) throw new BadRequestError("Device location is not accurate enough", "LOCATION_INACCURATE");
  const distance = distanceMeters(g.latitude, g.longitude, location.latitude, location.longitude);
  if (distance > policy.geofenceRadius) throw new BadRequestError("This device is outside the allowed attendance area", "OUTSIDE_GEOFENCE");
  return Math.round(distance);
}

async function insertEvent(doc) {
  try {
    return await AttendanceEvent.create(doc);
  } catch (err) {
    if (err?.code === 11000) throw new ConflictError("Another attendance request is already being processed. Please try again.", "CONCURRENT_REQUEST");
    throw err;
  }
}

/**
 * Records one face scan for an identified employee: toggles check-in / check-out using the SERVER clock, the employee's
 * shift and the company timezone. The toggle decision and `seq` come from the same snapshot, so two racing scans of the
 * same person cannot both succeed (unique index on companyId+employeeId+date+seq).
 * Returns `{ cooldown }` instead of recording when the person was recorded moments ago.
 */
export async function recordScan({ companyId, employeeId, deviceUserId, score, location, ip, userAgent, cooldownSeconds = 0 }) {
  const context = await loadEmployeeContext(companyId, employeeId);
  const { policy, shift, tz } = context;
  const now = new Date();
  const distance = assertGeofence(context, location);

  const date = resolveAttendanceDate(now, shift, tz);
  const snapshot = await AttendanceEvent.find({ companyId, employeeId, date }).sort({ timestamp: 1, seq: 1 }).lean();
  const events = snapshot.filter((e) => !e.voidedAt);
  const seq = snapshot.reduce((m, e) => Math.max(m, e.seq), 0) + 1;

  // Cooldown uses the SAME snapshot as the toggle, so a scan racing a just-recorded one can never turn into a spurious check-out.
  const latest = events.at(-1);
  if (latest && Date.now() - latest.timestamp.getTime() < cooldownSeconds * 1000) return { cooldown: { previous: latest.type, timestamp: latest.timestamp } };

  const checkingOut = isCheckedIn(events);
  const type = checkingOut ? EVENT_TYPES.CHECK_OUT : EVENT_TYPES.CHECK_IN;
  if (!checkingOut && events.some((e) => IN_EVENT_TYPES.includes(e.type)) && !policy.multipleCheckInAllowed) {
    throw new ConflictError("Attendance for today is already complete", "MULTIPLE_CHECKIN_DISABLED");
  }
  if (checkingOut && events.some((e) => e.type === EVENT_TYPES.CHECK_OUT) && !policy.multipleCheckOutAllowed) {
    throw new ConflictError("Multiple check-outs are not allowed", "MULTIPLE_CHECKOUT_DISABLED");
  }

  const event = await insertEvent({
    companyId, employeeId, date, type, timestamp: now, seq, method: EVENT_METHODS.FACE, ipAddress: ip, deviceUserId,
    location: location ? { ...location, distanceMeters: distance ?? undefined } : undefined,
    metadata: { faceScore: score, userAgent: userAgent?.slice(0, 200) },
  });
  const record = await recomputeDay(companyId, employeeId, date, { context, now });
  return { event, record };
}

/** Company correction: appends a new event (audited); history is never overwritten. */
export async function addManualEvent(ctx, companyId, employeeId, { type, timestamp, reason }) {
  const context = await loadEmployeeContext(companyId, employeeId);
  const at = new Date(timestamp);
  if (at > new Date()) throw new BadRequestError("Manual attendance cannot be in the future");
  const date = resolveAttendanceDate(at, context.shift, context.tz);
  const last = await AttendanceEvent.findOne({ companyId, employeeId, date }).sort({ seq: -1 }).select("seq").lean();
  const event = await insertEvent({
    companyId, employeeId, date, type, timestamp: at, seq: (last?.seq ?? 0) + 1,
    method: EVENT_METHODS.MANUAL, ipAddress: ctx.ip, recordedBy: ctx.user.id, reason,
  });
  const record = await recomputeDay(companyId, employeeId, date, { context });
  if (record) await AttendanceRecord.updateOne({ _id: record._id }, { isManuallyAdjusted: true });
  await recordAudit(ctx, { action: "attendance.manual_event_added", entityType: "AttendanceEvent", entityId: event._id, after: { employeeId, type, timestamp: at, reason }, companyId });
  return { event, record };
}

export async function voidEvent(ctx, companyId, eventId, reason) {
  const ev = await AttendanceEvent.findOneAndUpdate({ _id: eventId, companyId, voidedAt: null }, { voidedAt: new Date(), voidedBy: ctx.user.id, reason }, { returnDocument: "after" });
  if (!ev) throw new NotFoundError("Attendance event not found");
  const record = await recomputeDay(companyId, ev.employeeId, ev.date);
  if (record) await AttendanceRecord.updateOne({ _id: record._id }, { isManuallyAdjusted: true });
  await recordAudit(ctx, { action: "attendance.event_voided", entityType: "AttendanceEvent", entityId: ev._id, before: { type: ev.type, timestamp: ev.timestamp }, after: { reason }, companyId });
  return record;
}

export function buildRecordFilter(companyId, q, { employeeIds } = {}) {
  const filter = { companyId };
  if (q.employeeId) filter.employeeId = q.employeeId;
  if (employeeIds) filter.employeeId = q.employeeId ? { $in: employeeIds.filter((id) => String(id) === String(q.employeeId)) } : { $in: employeeIds };
  if (q.date) filter.date = q.date;
  else if (q.from || q.to) filter.date = { ...(q.from && { $gte: q.from }), ...(q.to && { $lte: q.to }) };
  if (q.status) filter.status = q.status;
  if (q.late !== undefined) filter.isLate = q.late;
  if (q.halfDay !== undefined) filter.isHalfDay = q.halfDay;
  return filter;
}

export async function listRecords(companyId, q) {
  let employeeIds;
  if (q.department) employeeIds = (await Employee.find({ companyId, departmentId: q.department }).select("_id").lean()).map((e) => e._id);
  return paginateQuery(AttendanceRecord, buildRecordFilter(companyId, q, { employeeIds }), q, {
    sortable: ["date", "status", "totalWorkingMinutes", "lateMinutes"], defaultSort: "date",
    populate: { path: "employeeId", select: "firstName lastName employeeCode departmentId" },
  });
}
